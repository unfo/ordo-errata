"""Read-only access to the game's .pak archives (plain ZIP files)."""

from __future__ import annotations

import os
import zipfile
from pathlib import Path

DEFAULT_GAME_DIR = Path(os.environ.get("SM2_GAME_DIR", Path.home() / "work" / "sm2"))
STEAM_APP_ID = 2183900

# Paks that never contain data we use; skipping them keeps indexing fast.
_SKIP_PREFIXES = ("default_sound", "default_video", "default_animation", "default_pso")


class PakIndex:
    """Maps archive member names to the pak that holds them.

    Later paks override earlier ones (client before server, so server-only
    files are still found, and the client copy wins for shared files).
    """

    def __init__(self, game_dir: Path = DEFAULT_GAME_DIR):
        self.game_dir = Path(game_dir)
        self._zips: dict[Path, zipfile.ZipFile] = {}
        self._where: dict[str, Path] = {}
        for pak in self._pak_files():
            zf = self._open(pak)
            for name in zf.namelist():
                self._where.setdefault(name, pak)

    def _pak_files(self) -> list[Path]:
        roots = [
            self.game_dir / "client_pc/root/paks/client",
            self.game_dir / "server_pc/root/paks/server",
        ]
        paks: list[Path] = []
        for root in roots:
            if not root.is_dir():
                continue
            for p in sorted(root.rglob("*.pak")):
                if p.name.startswith(_SKIP_PREFIXES) or "scenes" in p.parts:
                    continue
                paks.append(p)
        if not paks:
            raise FileNotFoundError(f"no .pak files under {self.game_dir}; set SM2_GAME_DIR")
        return paks

    def _open(self, pak: Path) -> zipfile.ZipFile:
        if pak not in self._zips:
            self._zips[pak] = zipfile.ZipFile(pak)
        return self._zips[pak]

    def __contains__(self, name: str) -> bool:
        return name in self._where

    def names(self, prefix: str = "", suffix: str = "") -> list[str]:
        return sorted(n for n in self._where if n.startswith(prefix) and n.endswith(suffix))

    def read(self, name: str) -> bytes:
        return self._open(self._where[name]).read(name)

    def read_from(self, pak_relpath: str, name: str) -> bytes:
        """Read a member from a specific pak (e.g. the server copy of a shared file)."""
        return self._open(self.game_dir / pak_relpath).read(name)

    def build_id(self) -> str:
        manifest = self.game_dir.resolve().parent.parent / f"appmanifest_{STEAM_APP_ID}.acf"
        if manifest.is_file():
            for line in manifest.read_text(errors="replace").splitlines():
                parts = line.split('"')
                if len(parts) >= 4 and parts[1] == "buildid":
                    return parts[3]
        return "unknown"
