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


def flatten(obj: Any, prefix: str = "") -> Iterator[tuple[str, float | int | bool | str]]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if _SKIP.fullmatch(k):
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


def _flat(obj: Any, prefix: str = "") -> dict[str, float | int | bool | str]:
    return dict(flatten(obj, prefix))


def camel_desc(weapon_id: str) -> str:
    """melee_thunder_hammer_one_handed -> MeleeThunderHammerOneHandedDesc"""
    return "".join(p.title() for p in weapon_id.split("_")) + "Desc"


def extract_values(pak: PakIndex, weapon_ids: list[str], perk_types: set[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}

    # Perks: only those the UI shows (class and weapon perks).
    server = ssl.loads(pak.read_from(SERVER_PAK, PERKS_SERVER))
    for cat in server.get("categories", {}).values():
        for perk_type, desc in cat.get("descs", {}).items():
            if perk_type in perk_types:
                vals = _flat(desc.get("type", desc))
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
