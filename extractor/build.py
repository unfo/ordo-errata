"""Extract class/weapon perk data and icons from a local Space Marine 2 install.

Usage:  uv run extractor/build.py [--game-dir PATH] [--lang english]

Writes:
  data/<steam build id>/{meta,classes,weapons,names_index,loc_health}.json
  web/public/icons/<texture name>.png   (only icons referenced by the data)

The game directory is only ever read.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sm2data import ssl  # noqa: E402
from sm2data.pak import DEFAULT_GAME_DIR, PakIndex  # noqa: E402
from sm2data.strings import StringTable, load_strings, render_description  # noqa: E402
from sm2data.textures import TextureIndex, UnsupportedTexture  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

MASTERY = "ssl/main/user/mastery/mastery_library.sso"
MASTERY_SKILLS = "ssl/main/user/mastery/mastery_skills_library.sso"
ARMORY_ORDER = "ssl/main/user/mastery/ui_armory_ordered_mastery_library.sso"
UI_SKILLS = "ssl/player/perks/ui/ui_skills_library.sso"
WEAPON_PERKS = "ssl/main/user/progression/weapons_mastery/perks/weapon_perks_progression_library.sso"
WEAPON_MASTERY = "ssl/main/user/progression/weapons_mastery/weapon_mastery_progression_library.sso"
WEAPON_HEROIC = "ssl/main/user/progression/weapons_mastery/perks/weapon_heroic_perks_library.sso"
UI_FIREARMS = "ssl/weapons/ui/ui_firearms_library.sso"
UI_ABILITIES = "ssl/abilities/ui/ui_abilities_library.sso"
WEAPON_ICON_KEYS = "ssl/ui/fusion/assets/switchers/weapon_icons/ui_weapon_icon_converter.sso"
WEAPON_ICON_SWITCHER = "ssl/ui/fusion/assets/switchers/weapon_icons/ui_switcher_weapon_icons_big.sso"
PERK_ICON_SWITCHER = "ssl/ui/fusion/assets/switchers/perk_icons/ui_switcher_perk_icons.sso"

TIER_NAME_KEYS = {
    "COMMON": "UI_RARITY_COMMON",
    "MASTERCRAFTED": "UI_RARITY_MASTERCRAFTED",
    "ARTIFICER": "UI_RARITY_ARTIFICER",
    "RELIC": "UI_RARITY_RELIC",
}
TIER_FALLBACK = {"COMMON": "Standard-Issue"}

# Weapon stat fields in ui_*_library versions -> UI_WEAPON_PARAMETER_<X>_NAME label keys.
STAT_LABEL_KEYS = {
    "firePower": "FIRE_POWER",
    "accuracy": "ACCURACY",
    "fireRate": "FIRE_RATE",
    "reloadingSpeed": "RELOAD_SPEED",
    "cooling": "COOLING",
    "chargingSpeed": "CHARGING_SPEED",
    "piercing": "PIERCING",
    "range": "RANGE",
    "strikePower": "STRIKE_POWER",
    "strikeSpeed": "STRIKE_SPEED",
    "control": "CONTROL",
    "defense": "DEFENSE",
}
_PERK_POS = re.compile(r"_(\d+)(?:_(\d+))?(_sub)?$")


def perk_position(perk_uid: str) -> dict:
    """Weapon perk uids end in _<row>_<column>[_sub] (or _<row> in the first tier)."""
    m = _PERK_POS.search(perk_uid)
    if not m:
        return {}
    pos = {"row": int(m.group(1))}
    if m.group(3):
        pos["sub"] = True
    return pos


def unwrap(v):
    """``{"__value": x}`` wrappers -> x."""
    return v["__value"] if isinstance(v, dict) and set(v) == {"__value"} else v


class Builder:
    def __init__(self, pak: PakIndex, lang: str):
        self.pak = pak
        self.s: StringTable = load_strings(pak, lang)
        self.tex = TextureIndex(pak)
        self.icons: set[str] = set()
        self.missing_icons: set[str] = set()
        self.missing_text: dict[str, set[str]] = {}
        self.recovered_text: dict[str, dict] = {}
        self.ui_skills = self._load_ui_skills()
        self.skill_links = ssl.loads(pak.read(MASTERY_SKILLS))["skills"]
        # Perk icon ids are switcher keys, e.g. perk_berserk_12 -> perk_berserk_12_upd texture.
        self.perk_icon_textures = switcher_textures(self.load(PERK_ICON_SWITCHER))

    def load(self, name: str) -> dict:
        return ssl.loads(self.pak.read(name))

    def _load_ui_skills(self) -> dict[str, dict]:
        flat: dict[str, dict] = {}
        for cat, body in self.load(UI_SKILLS)["skillsCategories"].items():
            for perk_type, ui in body.get("skillsData", {}).items():
                if isinstance(ui, dict):
                    flat.setdefault(perk_type, {**ui, "_category": cat})
        return flat

    # -- text ---------------------------------------------------------------

    def text(self, key: str | None, used_by: str) -> str | None:
        if not key:
            return None
        val = self.s.get(key)
        if val is None:
            self.missing_text.setdefault(key, set()).add(used_by)
        return val

    def perk_icon(self, icon_id: str | None) -> str | None:
        if not icon_id:
            return None
        return self.icon(self.perk_icon_textures.get(icon_id, icon_id))

    def icon(self, name: str | None) -> str | None:
        if not name:
            return None
        if name in self.tex:
            self.icons.add(name)
            return name
        self.missing_icons.add(name)
        return None

    # -- perks --------------------------------------------------------------

    def perk(self, perk_type: str, perk_id: str | None = None) -> dict:
        """A perk as the UI presents it. ``perk_type`` is the gameplay perk class
        (the key into ui_skills_library); ``perk_id`` an optional unique id."""
        out: dict = {"id": perk_id or perk_type, "type": perk_type}
        ui = self.ui_skills.get(perk_type)
        if ui is None:
            out["noUi"] = True
            return out
        params = [p if isinstance(p, dict) else {"text": str(p)} for p in ui.get("parameters", [])]
        presence = [unwrap(p) for p in ui.get("affectedPresences", [])]
        name_key, desc_key = ui.get("nameUid"), ui.get("descUid")
        name = self.text(name_key, perk_type)
        template = self.text(desc_key, perk_type)
        if template is None and desc_key:
            rec = self.s.recover(desc_key)
            if rec:
                template = rec["text"]
                out["textIssue"] = {
                    "kind": "brokenKey",
                    "note": f'In the game files this text is stored under the key "{rec["key"]}" '
                    f"(line {rec['line']}) instead of {desc_key}, so the game shows the raw key.",
                }
                self.recovered_text[desc_key] = {**rec, "usedBy": perk_type}
            else:
                out["textIssue"] = {"kind": "missing", "note": f"No text for {desc_key} in the game files."}
        out.update(
            {
                "name": name or name_key,
                "nameKey": name_key,
                "descKey": desc_key,
                "params": [{"text": p.get("text", ""), **({"kind": p["type"]} if p.get("type") else {})} for p in params],
                "icon": self.perk_icon(ui.get("icon")),
            }
        )
        if presence:
            out["presence"] = presence
            for p in presence:
                self.icon(f"icn_{p.lower()}")
        if template is not None:
            out["desc"] = render_description(template, params, presence)
        if name is None and name_key:
            out.setdefault("textIssue", {"kind": "missing", "note": f"No text for {name_key} in the game files."})
        return out

    def skill_perks(self, link: str | None) -> list[dict]:
        if not link:
            return []
        cat, _, key = link.partition(".")
        skill = self.skill_links.get(cat, {}).get(key)
        if not skill:
            return [{"id": link, "type": link, "noUi": True, "brokenLink": True}]
        return [self.perk(t) for t in skill.get("perks", [])]

    # -- classes ------------------------------------------------------------

    def classes(self) -> dict:
        mastery = self.load(MASTERY)
        order = [k.removeprefix("PVE_") for k in self.load(ARMORY_ORDER)["pveMasteriesArmoryOrdered"]]
        classes = []
        for code in order:
            pve = mastery["pveMasteries"][f"PVE_{code}"]
            pvp = mastery["pvpMasteries"].get(f"PVP_{code}", {})
            display = self.text(f"UI_CHARACTER_{code}_NAME", code) or code
            columns = []
            for idx, tier in enumerate(pve["tiers"]):
                levels = tier.get("levels", {})
                slots = [
                    {"level": int(lvl.removeprefix("LEVEL_")), "perks": self.skill_perks(ld.get("skill", {}).get("skillLink"))}
                    for lvl, ld in sorted(levels.items())
                    if "skill" in ld
                ]
                if slots:
                    columns.append({"tierIndex": idx, "slots": slots})
            team = [
                {"level": int(lvl.removeprefix("LEVEL_")), "perks": self.skill_perks(ld.get("skill", {}).get("skillLink"))}
                for lvl, ld in sorted(pve.get("teamSkills", {}).items())
            ]
            prestige = [
                {
                    "slot": slot,
                    "requires": ps.get("requiredPrestigeLevel"),
                    "perks": self.skill_perks(ps.get("skillLink", {}).get("skillLink")),
                }
                for slot, ps in sorted(pve.get("prestigeSkills", {}).items(), key=lambda kv: int(kv[0].split("_")[-1]))
            ]
            classes.append(
                {
                    "id": code,
                    "name": display.title(),
                    "icon": self.icon(next((n for n in (f"lobby_{code.lower()}", f"lobby_{display.lower()}") if n in self.tex), None)),
                    "pve": {
                        "base": self.skill_perks(pve.get("masterSkill", {}).get("skillLink")),
                        "columns": columns,
                        "team": team,
                        "prestige": prestige,
                    },
                    "pvp": {"base": self.skill_perks(pvp.get("masterSkill", {}).get("skillLink"))},
                }
            )
        return {
            "groups": {g: self.text(f"UI_PERK_GROUP_{g}", "perk groups") for g in ("CORE", "TEAM", "GEAR", "SIGNATURE")},
            "classes": classes,
        }

    # -- weapons ------------------------------------------------------------

    def weapons(self) -> dict:
        progression = self.load(WEAPON_PERKS)["weapons"]
        heroic = self.load(WEAPON_HEROIC)["weapons"]
        firearms = self.load(UI_FIREARMS)["uiDataList"]
        melee = self.load(UI_ABILITIES)["meleeData"]
        icon_keys = self.load(WEAPON_ICON_KEYS)
        key_bind = {
            **{k: unwrap(v) for k, v in icon_keys.get("rangedWeaponIconKeysBinding", {}).items()},
            **{k: unwrap(v) for k, v in icon_keys.get("meleeWeaponIconKeysBinding", {}).items()},
        }
        switcher = switcher_textures(self.load(WEAPON_ICON_SWITCHER))
        mastery_doc = self.load(WEAPON_MASTERY)
        mastery = {**mastery_doc.get("firearmProgression", {}), **mastery_doc.get("meleeProgression", {})}

        out = []
        for wid, wdata in progression.items():
            ui = firearms.get(wid) or melee.get(wid) or {}
            kind = "melee" if wid in melee else "ranged"
            prog = mastery.get(wid, {})
            version_tier: dict[str, str] = {}
            for tier_id, t in prog.get("tiers", {}).items():
                for v in [t.get("baseVersion", {}), *t.get("subVersions", {}).values()]:
                    if v.get("version"):
                        version_tier[v["version"]] = tier_id
            for v in prog.get("heroicVersions", {}).values():
                if isinstance(v, dict) and v.get("version"):
                    version_tier[v["version"]] = "HEROIC"
            variants = []
            for vid, v in sorted(ui.get("versions", {}).items()):
                vkey = v.get("nameUid") or v.get("versionName")
                stats = {k: v[k] for k in STAT_LABEL_KEYS if k in v}
                if v.get("hasCoolingParameter"):
                    stats["_venting"] = True
                variants.append(
                    {
                        "id": vid,
                        "name": self.text(vkey, wid) or vid,
                        "nameKey": vkey,
                        "tier": version_tier.get(vid),
                        "stats": stats,
                    }
                )
            tiers = []
            for tier_id, tier in wdata.get("tiers", {}).items():
                layers = []
                for layer in tier.get("perkLayers", []):
                    row = []
                    for entry in layer:
                        p = {**self.perk(entry["type"], entry["perkUid"]), **perk_position(entry["perkUid"])}
                        if entry.get("blockedByPerks"):
                            p["blockedBy"] = entry["blockedByPerks"]
                        if entry.get("unlocksPerks"):
                            p["unlocks"] = entry["unlocksPerks"]
                        row.append(p)
                    layers.append(row)
                tiers.append(
                    {
                        "id": tier_id,
                        "name": self.s.get(TIER_NAME_KEYS.get(tier_id)) or TIER_FALLBACK.get(tier_id, tier_id.title()),
                        "requiredExperience": prog.get("tiers", {}).get(tier_id, {}).get("requiredExperience", 0),
                        "layers": layers,
                    }
                )
            heroic_perks = [
                {"variant": vid, **self.perk(h["type"], h["perkUid"].replace(" ", ""))}
                for vid, h in sorted(heroic.get(wid, {}).get("perks", {}).items())
            ]
            icon_key = key_bind.get(wid)
            out.append(
                {
                    "id": wid,
                    "kind": kind,
                    "name": self.text(ui.get("usualName"), wid) or wid,
                    "nameKey": ui.get("usualName"),
                    "icon": self.icon(switcher.get(icon_key)) if icon_key else None,
                    "variants": variants,
                    "tiers": tiers,
                    "heroic": heroic_perks,
                }
            )
        labels = {k: self.s.get(f"UI_WEAPON_PARAMETER_{v}_NAME") or k for k, v in STAT_LABEL_KEYS.items()}
        defense = {d: self.s.get(f"UI_WEAPON_PARAMETER_DEFENSE_{d}_NAME") or d.title() for d in ("BLOCK", "BALANCED", "FENCING")}
        tier_names = {**{t: self.s.get(k) or TIER_FALLBACK.get(t, t.title()) for t, k in TIER_NAME_KEYS.items()}, "HEROIC": self.s.get("UI_TIER_HEROIC") or "Heroic"}
        return {"statLabels": labels, "defenseLabels": defense, "tierNames": tier_names, "weapons": out}

    # -- indexes and reports -----------------------------------------------

    @staticmethod
    def names_index(classes: dict, weapons: dict) -> dict:
        idx: dict[str, list[dict]] = {}

        def add(name: str | None, ref: dict) -> None:
            if not name:
                return
            key = normalize_name(name)
            if ref not in idx.setdefault(key, []):
                idx[key].append(ref)

        for c in classes["classes"]:
            add(c["name"], {"kind": "class", "class": c["id"]})
            sections = [("base", c["pve"]["base"], "pve")]
            sections += [(f"col{col['tierIndex']}", s["perks"], "pve") for col in c["pve"]["columns"] for s in col["slots"]]
            sections += [("team", s["perks"], "pve") for s in c["pve"]["team"]]
            sections += [("prestige", s["perks"], "pve") for s in c["pve"]["prestige"]]
            sections += [("base", c["pvp"]["base"], "pvp")]
            for where, perks, mode in sections:
                for p in perks:
                    if not p.get("noUi"):
                        add(p["name"], {"kind": "classPerk", "class": c["id"], "perk": p["id"], "where": where, "mode": mode})
        for w in weapons["weapons"]:
            add(w["name"], {"kind": "weapon", "weapon": w["id"]})
            for v in w["variants"]:
                add(v["name"], {"kind": "weaponVariant", "weapon": w["id"], "variant": v["id"]})
            for t in w["tiers"]:
                for layer in t["layers"]:
                    for p in layer:
                        if not p.get("noUi"):
                            add(p["name"], {"kind": "weaponPerk", "weapon": w["id"], "perk": p["id"], "tier": t["id"]})
            for h in w["heroic"]:
                if not h.get("noUi"):
                    add(h["name"], {"kind": "heroicPerk", "weapon": w["id"], "perk": h["id"], "variant": h["variant"]})
        return dict(sorted(idx.items()))

    def loc_health(self) -> dict:
        return {
            "lang": self.s.lang,
            "malformedKeys": [{k: v for k, v in m.items()} for m in self.s.malformed],
            "recovered": dict(sorted(self.recovered_text.items())),
            "missingKeys": {k: sorted(v) for k, v in sorted(self.missing_text.items())},
            "missingIcons": sorted(self.missing_icons),
        }


def switcher_textures(doc) -> dict[str, str]:
    """UI switcher assets map keys to bitmaps: key -> texture name."""
    found: dict[str, str] = {}

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                t = v.get("type") if isinstance(v, dict) else None
                if isinstance(t, dict) and t.get("textureAsset"):
                    found.setdefault(k, t["textureAsset"].rsplit("/", 1)[-1].removesuffix(".texture.asset"))
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(doc)
    return found


def normalize_name(name: str) -> str:
    n = name.lower().replace("’", "'").replace("–", "-").replace("—", "-")
    n = re.sub(r"[\s\-]+", " ", n)
    return re.sub(r"[^a-z0-9' ]", "", n).strip()


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--lang", default="english")
    ap.add_argument("--out", type=Path, default=ROOT / "data")
    ap.add_argument("--icons", type=Path, default=ROOT / "web" / "public" / "icons")
    args = ap.parse_args()

    pak = PakIndex(args.game_dir)
    build_id = pak.build_id()
    b = Builder(pak, args.lang)
    classes = b.classes()
    weapons = b.weapons()

    out = args.out / build_id
    write_json(out / "meta.json", {"buildId": build_id, "lang": args.lang})
    write_json(out / "classes.json", classes)
    write_json(out / "weapons.json", weapons)
    write_json(out / "names_index.json", b.names_index(classes, weapons))
    write_json(out / "loc_health.json", b.loc_health())

    failed = []
    for name in sorted(b.icons):
        target = args.icons / f"{name}.png"
        if target.exists():
            continue
        try:
            b.tex.save_png(name, target)
        except UnsupportedTexture as e:
            failed.append(str(e))

    builds = sorted(p.name for p in args.out.iterdir() if p.is_dir() and (p / "meta.json").exists())
    write_json(args.out / "builds.json", {"builds": builds, "latest": build_id})

    print(f"build {build_id}: {len(classes['classes'])} classes, {len(weapons['weapons'])} weapons, {len(b.icons)} icons")
    if b.missing_text:
        print(f"  {len(b.missing_text)} missing text keys, {len(b.s.malformed)} malformed keys (see loc_health.json)")
    for f in failed:
        print("  icon failed:", f)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
