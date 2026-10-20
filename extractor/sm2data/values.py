"""Hidden gameplay numbers (damage, fire rate, perk bonuses...) flattened for diffing.

Output maps entity keys (same keys the web app highlights) to flat
``{"dotted.path": value}`` dicts of numbers and booleans:

  perk:<perk type>          server perk definitions (perk_server_factory.sso)
  weapon:<weapon id>        firearm / melee descriptions, prefixed "pve." / "pvp."
  variant:<weapon>/<id>     per-variant modifiers (firearm_modificators_library.sso)

Numbers, booleans and enum-like strings are kept; visual/audio settings are skipped.
"""

from __future__ import annotations

import re
from typing import Any, Iterator

from . import ssl
from .pak import PakIndex

SERVER_PAK = "server_pc/root/paks/server/default/default_other.pak"
PERKS_SERVER = "ssl/player/perks/perk_server_factory.sso"
FIREARMS = {"pve": "ssl/weapons/creator/firearm_library_pve.sso", "pvp": "ssl/weapons/creator/firearm_library_pvp.sso"}
FIREARM_MODS = "ssl/weapons/creator/customization/firearm_modificators_library.sso"
MELEE_DESC = "ssl/weapons/melee/weapon_descriptions/melee_weapon_descs/{}_desc.sso"
MELEE_PVP = "ssl/weapons/melee/weapon_descriptions/melee_descriptions_library_pvp.sso"

# Path segments (whole key names) that only affect presentation. Matched against the full
# key, case-sensitively, so gameplay keys like "Light1Charged" or "statusEffect" survive.
_SKIP = re.compile(
    r"(.*[Ss]ound.*|.*[Vv]fx.*|.*[Ss]fx.*|[Cc]amera.*|cam[A-Z].*|.*[Aa]nimation.*|anim[A-Z].*|[Vv]isual.*|.*[Dd]ecal.*"
    r"|geom|nameTpl|.*[Mm]esh.*|[Tt]rail.*|.*[Ss]hake.*|[Ii]con.*|.*[Cc]olou?r|debug.*|editor.*|viewData|[Ss]corch.*"
    r"|blood.*|gore.*|pickupVisual.*|flyBy.*|tracer.*|endEffects?.*|sslModule|__type)"
)
# Enum-like strings ("MAJORIS", "SCALE_DAMAGE_AMOUNT_FROM_MELEE") carry gameplay meaning; other strings
# (asset names, node ids) are noise.
_ENUM = re.compile(r"^[A-Z][A-Z0-9_]+$")


# Editor-only layout inside behaviour graphs (node positions, group boxes, captions).
_GRAPH_LAYOUT = {"groups", "captionVar", "pdNodePosX", "pdNodePosY", "hitConditionPropDiagramRootX", "hitConditionPropDiagramRootY"}
# Lists of identifiers that carry gameplay meaning, e.g. which melee strikes a perk reacts to.
_ID_LISTS = {"strikeUids"}


def flatten(obj: Any, prefix: str = "") -> Iterator[tuple[str, float | int | bool | str]]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if _SKIP.fullmatch(k) or k in _GRAPH_LAYOUT:
                continue
            if k in _ID_LISTS and isinstance(v, list) and all(isinstance(x, str) for x in v):
                yield (f"{prefix}.{k}" if prefix else k), ", ".join(sorted(v))
                continue
            yield from flatten(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(obj, list):
        # Lists of objects are keyed by a stable field where one exists, else by index.
        for i, v in enumerate(obj):
            key = v.get("type") if isinstance(v, dict) and isinstance(v.get("type"), str) else str(i)
            yield from flatten(v, f"{prefix}[{key}]")
    elif isinstance(obj, bool) or isinstance(obj, (int, float)):
        yield prefix, obj
    elif isinstance(obj, str) and _ENUM.match(obj):
        yield prefix, obj


def is_layout_path(path: str) -> bool:
    """True for editor-layout paths, so diffs can ignore them even in snapshots built before they were filtered."""
    return any(seg.split("[")[0] in _GRAPH_LAYOUT for seg in path.split("."))


def _flat(obj: Any, prefix: str = "") -> dict[str, float | int | bool | str]:
    return dict(flatten(obj, prefix))


def camel_desc(weapon_id: str) -> str:
    """melee_thunder_hammer_one_handed -> MeleeThunderHammerOneHandedDesc"""
    return "".join(p.title() for p in weapon_id.split("_")) + "Desc"


def extract_values(pak: PakIndex, weapon_ids: list[str], perk_types: set[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}

    # Perks: only those the UI shows (class and weapon perks).
    server = ssl.loads(pak.read_from(SERVER_PAK, PERKS_SERVER))
    all_perks = {t: d for cat in server.get("categories", {}).values() for t, d in cat.get("descs", {}).items()}
    for perk_type in sorted(perk_types & all_perks.keys()):
        desc = all_perks[perk_type].get("type", all_perks[perk_type])
        vals = _flat(desc)
        # Some perks delegate their effect to a helper perk (PerkApplicationAttachPerk); include its values
        # so a bonus moved into the helper still shows up (Perfect Reprisal in 15.2).
        seen = {perk_type}
        link = desc.get("application", {}).get("perkLink")
        while link and link in all_perks and link not in seen:
            seen.add(link)
            helper = all_perks[link].get("type", all_perks[link])
            vals.update(_flat(helper, "linked"))
            link = helper.get("application", {}).get("perkLink")
        if vals:
            out[f"perk:{perk_type}"] = vals

    wanted = set(weapon_ids)
    for mode, path in FIREARMS.items():
        if path not in pak:
            continue
        for wid, desc in ssl.loads(pak.read(path)).get("firearms", {}).items():
            if wid in wanted:
                out.setdefault(f"weapon:{wid}", {}).update(_flat(desc, mode))

    for group in ssl.loads(pak.read(FIREARM_MODS)).get("modificatorsGroups", []):
        wid = group.get("firearmUid")
        if wid not in wanted:
            continue
        for gid, g in group.get("modificatorsGroups", {}).items():
            vid = gid.removeprefix(f"{wid}_")
            vals = _flat(g.get("modificators", {}))
            if vals:
                out[f"variant:{wid}/{vid}"] = vals

    pvp_melee = ssl.loads(pak.read(MELEE_PVP)).get("meleeDescs", {}) if MELEE_PVP in pak else {}
    for wid in weapon_ids:
        path = MELEE_DESC.format(wid)
        if path in pak:
            out.setdefault(f"weapon:{wid}", {}).update(_flat(ssl.loads(pak.read(path)), "pve"))
        pvp = pvp_melee.get(camel_desc(wid))
        if isinstance(pvp, dict) and pvp:
            out.setdefault(f"weapon:{wid}", {}).update(_flat(pvp, "pvp"))

    return {k: dict(sorted(v.items())) for k, v in sorted(out.items())}


def _apply(base: float, mod: dict) -> float:
    m = mod.get("modificator", 0)
    if mod.get("applyType") == "PERCENT":
        return base * (1 + m / 100)
    return base + m  # ABSOLUTE is the default for these modifiers


def firearm_extra_stats(pak: PakIndex, weapon_ids: list[str]) -> dict[str, dict[str, dict]]:
    """Stats the game lists below the stat bars but which are not in the UI stat data:
    magazine capacity, ammo reserve and headshot multiplier, per weapon variant.

    Computed like the game does: the PvE firearm description (or a heroic variant's
    "godlike" preset override) plus the variant's clip/ammo/headshot modifiers.
    Verified against in-game screenshots (Bolt Rifle relic 25/125/x2.8, Heavy Bolter 450/x2,
    heroic Plasma Pistol 100).
    """
    descs = ssl.loads(pak.read(FIREARMS["pve"])).get("firearms", {})
    mods = ssl.loads(pak.read(FIREARM_MODS))
    presets = mods.get("godlikeModificatorPresets", {})
    groups = {g.get("firearmUid"): g.get("modificatorsGroups", {}) for g in mods.get("modificatorsGroups", [])}

    out: dict[str, dict[str, dict]] = {}
    for wid in weapon_ids:
        if wid not in descs:
            continue
        variants: dict[str, dict] = {}
        for gid, group in {f"{wid}_01": {}, **groups.get(wid, {})}.items():
            vid = gid.removeprefix(f"{wid}_")
            m = group.get("modificators", {}) if group else {}
            desc = descs[wid]
            preset = m.get("ModificatorUsingGodlikeModificatorPreset", {}).get("godlikeModificatorPresetName")
            if preset and presets.get(preset, {}).get("descriptionOverride"):
                desc = presets[preset]["descriptionOverride"]
            barrels = desc.get("barrelDescriptions", {})
            barrel = barrels.get("auto") or next(iter(barrels.values()), {})
            clip_name = barrel.get("clipName", "default_clip")
            clip = desc.get("clipsSettings", {}).get(clip_name, {})
            cart = desc.get("cartridgeDescriptions", {}).get(barrel.get("cartridgeName", ""), {})
            stats: dict = {}
            if "maxAmmo" in clip:
                stats["magazine"] = _apply(clip["maxAmmo"], m.get("ModificatorClipAmmo", {}))
            reserve = desc.get("ammoSettings", {}).get("typeData", {}).get(clip.get("ammoType", ""), {}).get("maxAmount")
            if reserve:
                stats["ammoReserve"] = _apply(reserve, m.get("ModificatorAmmoPool", {}))
            hs = cart.get("shotCreatorSettings", {}).get("headshotMult")
            if hs is not None:
                stats["headshotMult"] = round(_apply(hs, m.get("ModificatorHeadshotMultiplier", {})), 3)
            variants[vid] = stats
        out[wid] = variants
    return out
