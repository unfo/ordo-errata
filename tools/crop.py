"""Crop Space Marine 2 screenshots down to the UI region that matters.

Usage:
  uv run tools/crop.py class_perks                 # newest screenshot
  uv run tools/crop.py weapon_tree --last 3        # three newest screenshots
  uv run tools/crop.py weapon_stats FILE.jpg ...   # specific files
  uv run tools/crop.py --list

Presets live in tools/crops.json, defined on the centred 2550x1440 UI area of a
3440x1440 screenshot and scaled by height for other resolutions. Output goes to
reference/crops/ (gitignored); screenshots are only read.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PRESETS = ROOT / "tools" / "crops.json"
OUT = ROOT / "reference" / "crops"
SCREENSHOT_DIR = Path(
    os.environ.get(
        "SM2_SCREENSHOT_DIR",
        "/mnt/c/Program Files (x86)/Steam/userdata/<steam-account-id>/760/remote/2183900/screenshots",
    )
)
UI_W, UI_H = 2550, 1440


def crop_box(size: tuple[int, int], box: list[int]) -> tuple[int, int, int, int]:
    w, h = size
    scale = h / UI_H
    left = (w - UI_W * scale) / 2  # UI area is centred horizontally
    l, t, r, b = box
    return (round(left + l * scale), round(t * scale), round(left + r * scale), round(b * scale))


def main() -> int:
    presets = {k: v for k, v in json.loads(PRESETS.read_text()).items() if not k.startswith("_")}
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("preset", nargs="?", choices=sorted(presets))
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--last", type=int, default=1, help="use the N newest screenshots when no files are given")
    ap.add_argument("--max-width", type=int, default=0, help="downscale output to at most this width")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list or not args.preset:
        for k, v in presets.items():
            print(f"{k:14} {v}")
        return 0

    files = args.files or sorted(SCREENSHOT_DIR.glob("*.jpg"), key=lambda p: p.stat().st_mtime)[-args.last :]
    OUT.mkdir(parents=True, exist_ok=True)
    for f in files:
        with Image.open(f) as im:
            out = im.crop(crop_box(im.size, presets[args.preset]))
        if args.max_width and out.width > args.max_width:
            out = out.resize((args.max_width, round(out.height * args.max_width / out.width)), Image.LANCZOS)
        target = OUT / f"{f.stem}_{args.preset}.png"
        out.save(target)
        print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
