"""Compare two extracted game builds and list every change, per entity.

Usage:  uv run extractor/diff.py OLD_BUILD NEW_BUILD      (build ids under data/)
        uv run extractor/diff.py                          (the two newest builds)

Writes data/diffs/<old>..<new>.json and updates data/diffs/index.json. Entity keys match
the web app's highlight keys: perk:<id>, perkType:<type>, weapon:<id>, variant:<weapon>/<id>.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build import version_key, write_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def load(build: str) -> dict:
    d = DATA / build
    out = {name: json.loads((d / f"{name}.json").read_text()) for name in ("classes", "weapons")}
    values = d / "values.json"
    out["values"] = json.loads(values.read_text()) if values.exists() else {}
    return out


# --------------------------------------------------------------------- perks


def perk_index(snap: dict) -> dict[str, dict]:
    """perk id -> {perk, where} with a human-readable location."""
    idx: dict[str, dict] = {}
    for c in snap["classes"]["classes"]:
        pve = c["pve"]
        for p in pve["base"]:
            idx.setdefault(p["id"], {"perk": p, "where": f"{c['name']} · base kit"})
        for p in c["pvp"]["base"]:
            idx.setdefault(p["id"], {"perk": p, "where": f"{c['name']} · PvP kit"})
        for n, col in enumerate(pve["columns"], 1):
            for s in col["slots"]:
                for p in s["perks"]:
                    idx[p["id"]] = {"perk": p, "where": f"{c['name']} · column {n} · level {s['level']}"}
        for s in pve["team"]:
            for p in s["perks"]:
                idx[p["id"]] = {"perk": p, "where": f"{c['name']} · team · level {s['level']}"}
        for s in pve["prestige"]:
            for p in s["perks"]:
                idx[p["id"]] = {"perk": p, "where": f"{c['name']} · prestige ({s['requires']})"}
    for w in snap["weapons"]["weapons"]:
        for t in w["tiers"]:
            for n, layer in enumerate(t["layers"], 1):
                for p in layer:
                    idx[p["id"]] = {"perk": p, "where": f"{w['name']} · {t['name']} · column {n} · row {p.get('row', '?')}"}
        for h in w["heroic"]:
            idx[h["id"]] = {"perk": h, "where": f"{w['name']} · heroic ({h['variant']})"}
    return idx


def _norm_text(t: str | None) -> str | None:
    """Ignore line-break/spacing-only edits (literal "\\n" or whitespace)."""
    return " ".join(t.replace("\\n", " ").split()) if t else t  # also collapses real newlines


PERK_FIELDS = {
    "name": lambda p: p.get("name"),
    "description": lambda p: _norm_text((p.get("desc") or {}).get("text")),
    "values": lambda p: [x.get("text") for x in p.get("params", [])],
    "icon": lambda p: p.get("icon"),
    "type": lambda p: p.get("type"),
}


TOOLTIP_FIELDS = ("description", "values")


def diff_perks(old: dict, new: dict) -> dict[str, list[dict]]:
    a, b = perk_index(old), perk_index(new)
    out: dict[str, list[dict]] = {}
    for pid in sorted(a.keys() | b.keys()):
        if pid not in b:
            out[f"perk:{pid}"] = [{"kind": "removed", "name": a[pid]["perk"].get("name"), "where": a[pid]["where"]}]
            continue
        if pid not in a:
            out[f"perk:{pid}"] = [{"kind": "added", "name": b[pid]["perk"].get("name"), "where": b[pid]["where"]}]
            continue
        changes = []
        for field, get in PERK_FIELDS.items():
            if field in TOOLTIP_FIELDS:
                continue
            ov, nv = get(a[pid]["perk"]), get(b[pid]["perk"])
            if ov != nv:
                changes.append({"kind": "field", "field": field, "old": ov, "new": nv})
        # Text and its numbers are shown as before/after tooltips rather than as table rows.
        if any(PERK_FIELDS[f](a[pid]["perk"]) != PERK_FIELDS[f](b[pid]["perk"]) for f in TOOLTIP_FIELDS):
            changes.append({"kind": "tooltip", "old": a[pid]["perk"].get("desc"), "new": b[pid]["perk"].get("desc")})
        if a[pid]["where"] != b[pid]["where"]:
            changes.append({"kind": "moved", "old": a[pid]["where"], "new": b[pid]["where"]})
        if changes:
            out[f"perk:{pid}"] = changes
    return out


# --------------------------------------------------------------------- weapons


def diff_weapons(old: dict, new: dict) -> dict[str, list[dict]]:
    a = {w["id"]: w for w in old["weapons"]["weapons"]}
    b = {w["id"]: w for w in new["weapons"]["weapons"]}
    out: dict[str, list[dict]] = {}
    for wid in sorted(a.keys() | b.keys()):
        if wid not in b:
            out[f"weapon:{wid}"] = [{"kind": "removed", "name": a[wid]["name"]}]
            continue
        if wid not in a:
            out[f"weapon:{wid}"] = [{"kind": "added", "name": b[wid]["name"]}]
            continue
        if a[wid]["name"] != b[wid]["name"]:
            out[f"weapon:{wid}"] = [{"kind": "field", "field": "name", "old": a[wid]["name"], "new": b[wid]["name"]}]
        av = {v["id"]: v for v in a[wid]["variants"]}
        bv = {v["id"]: v for v in b[wid]["variants"]}
        for vid in sorted(av.keys() | bv.keys()):
            key = f"variant:{wid}/{vid}"
            if vid not in bv:
                out[key] = [{"kind": "removed", "name": av[vid]["name"]}]
            elif vid not in av:
                out[key] = [{"kind": "added", "name": bv[vid]["name"]}]
            else:
                ch = []
                if av[vid]["name"] != bv[vid]["name"]:
                    ch.append({"kind": "field", "field": "name", "old": av[vid]["name"], "new": bv[vid]["name"]})
                for stat in sorted(av[vid].get("stats", {}).keys() | bv[vid].get("stats", {}).keys()):
                    o, n = av[vid].get("stats", {}).get(stat), bv[vid].get("stats", {}).get(stat)
                    if o != n and not stat.startswith("_"):
                        ch.append({"kind": "stat", "field": stat, "old": o, "new": n})
                if ch:
                    out[key] = ch
    return out


# --------------------------------------------------------------------- values


def diff_values(old: dict, new: dict) -> dict[str, list[dict]]:
    a, b = old["values"], new["values"]
    out: dict[str, list[dict]] = {}
    for ent in sorted(a.keys() | b.keys()):
        av, bv = a.get(ent, {}), b.get(ent, {})
        ch = []
        for path in sorted(av.keys() | bv.keys()):
            o, n = av.get(path), bv.get(path)
            if o == n:
                continue
            c = {"kind": "value", "field": path, "old": o, "new": n}
            if isinstance(o, (int, float)) and isinstance(n, (int, float)) and not isinstance(o, bool) and o:
                c["pct"] = round((n - o) / abs(o) * 100, 2)
            ch.append(c)
        if ch:
            # Server perk values are keyed by perk type, shared by every perk of that type.
            key = ent.replace("perk:", "perkType:", 1) if ent.startswith("perk:") else ent
            out[key] = ch
    return out


def diff(old_build: str, new_build: str) -> dict:
    old, new = load(old_build), load(new_build)
    entities: dict[str, list[dict]] = {}
    for part in (diff_perks(old, new), diff_weapons(old, new), diff_values(old, new)):
        for k, v in part.items():
            entities.setdefault(k, []).extend(v)
    return {"from": old_build, "to": new_build, "entities": dict(sorted(entities.items()))}


def builds() -> list[str]:
    return sorted((p.name for p in DATA.iterdir() if (p / "meta.json").exists()), key=version_key)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("old", nargs="?")
    ap.add_argument("new", nargs="?")
    ap.add_argument("--all", action="store_true", help="diff every pair of consecutive snapshots")
    args = ap.parse_args()
    known = builds()
    if args.all:
        for old, new in zip(known, known[1:]):
            run_one(old, new)
        return 0
    if not (args.old and args.new):
        if len(known) < 2:
            print(f"need two builds under data/, have {known}")
            return 1
        args.old, args.new = known[-2], known[-1]
    run_one(args.old, args.new)
    return 0


def run_one(old: str, new: str) -> None:
    result = diff(old, new)
    name = f"{old}..{new}"
    write_json(DATA / "diffs" / f"{name}.json", result)
    index = sorted({p.stem for p in (DATA / "diffs").glob("*..*.json")})
    write_json(DATA / "diffs" / "index.json", {"diffs": index})
    counts: dict[str, int] = {}
    for k in result["entities"]:
        counts[k.split(":")[0]] = counts.get(k.split(":")[0], 0) + 1
    print(f"{name}: {sum(counts.values())} changed entities {counts}")


if __name__ == "__main__":
    raise SystemExit(main())
