"""UI texture lookup and decoding (.pct.resource header + .pct_mip pixel data)."""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image

from .pak import PakIndex

# Swarm engine pixel formats seen on UI textures.
FORMAT_RGBA8 = 0
FORMAT_BC7 = 52


class UnsupportedTexture(Exception):
    pass


class TextureIndex:
    """Resolves texture names (e.g. ``perk_soldier_15_rework``) to decoded images."""

    def __init__(self, pak: PakIndex, prefix: str = "textures/ui/"):
        self.pak = pak
        self._by_name: dict[str, str] = {}
        for res in pak.names(prefix, ".pct.resource"):
            name = res.rsplit("/", 1)[1][: -len(".pct.resource")]
            self._by_name.setdefault(name, res)
        self._mip_paths: dict[str, str] | None = None

    def __contains__(self, name: str) -> bool:
        return name in self._by_name

    def header(self, name: str) -> dict:
        text = self.pak.read(self._by_name[name]).decode("utf-8", "replace")

        def num(key: str) -> int:
            m = re.search(rf"^\s*{key}: (\d+)", text, re.M)
            if not m:
                raise UnsupportedTexture(f"{name}: no {key} in header")
            return int(m.group(1))

        mips = re.findall(r"^- (\S+\.pct_mip)\s*$", text, re.M)
        return {"format": num("format"), "sx": num("sx"), "sy": num("sy"), "mips": mips}

    def _mip_member(self, mip_file: str, name: str) -> str:
        # Mip data lives next to the header path, inside one of the default_pct_* paks.
        res = self._by_name[name]
        candidate = res.rsplit("/", 1)[0] + "/" + mip_file
        if candidate in self.pak:
            return candidate
        if self._mip_paths is None:
            self._mip_paths = {n.rsplit("/", 1)[1]: n for n in self.pak.names(suffix=".pct_mip")}
        if mip_file in self._mip_paths:
            return self._mip_paths[mip_file]
        raise UnsupportedTexture(f"{name}: mip data {mip_file} not found")

    def image(self, name: str) -> Image.Image:
        h = self.header(name)
        if not h["mips"]:
            raise UnsupportedTexture(f"{name}: no mip list")
        data = self.pak.read(self._mip_member(h["mips"][0], name))
        w, hgt = h["sx"], h["sy"]
        if h["format"] == FORMAT_BC7:
            bw, bh = (w + 3) // 4, (hgt + 3) // 4
            img = Image.frombytes("RGBA", (bw * 4, bh * 4), data[: bw * bh * 16], "bcn", 7)
            return img.crop((0, 0, w, hgt)) if (bw * 4, bh * 4) != (w, hgt) else img
        if h["format"] == FORMAT_RGBA8:
            return Image.frombytes("RGBA", (w, hgt), data[: w * hgt * 4])
        raise UnsupportedTexture(f"{name}: pixel format {h['format']} not supported")

    def save_png(self, name: str, out: Path) -> None:
        out.parent.mkdir(parents=True, exist_ok=True)
        self.image(name).save(out, optimize=True)
