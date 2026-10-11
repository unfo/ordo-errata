"""Read-only access to the game's .pak archives (plain ZIP files)."""

from __future__ import annotations

import os
import re
import zipfile
from pathlib import Path

GAME_FOLDER = "Space Marine 2"
# Steam installs to check (WSL view of Windows drives, and native Linux).
_STEAM_ROOTS = [
    Path("/mnt/c/Program Files (x86)/Steam"),
    Path("/mnt/c/Program Files/Steam"),
    Path.home() / ".steam/steam",
    Path.home() / ".local/share/Steam",
]


def _wsl_path(win_path: str) -> Path:
    """'E:\\SteamLibrary' -> /mnt/e/SteamLibrary (WSL); other paths unchanged."""
    m = re.match(r"^([A-Za-z]):[\\/](.*)$", win_path)
    if m:
        return Path("/mnt") / m.group(1).lower() / m.group(2).replace("\\", "/")
    return Path(win_path)


def find_game_dir() -> Path | None:
    """Locate the installed game: $SM2_GAME_DIR, else every Steam library listed in
    steamapps/libraryfolders.vdf (so extra libraries on other drives are found too)."""
    if os.environ.get("SM2_GAME_DIR"):
        return Path(os.environ["SM2_GAME_DIR"])
    libraries: list[Path] = []
    for root in _STEAM_ROOTS:
        vdf = root / "steamapps" / "libraryfolders.vdf"
        if vdf.is_file():
            libraries += [_wsl_path(p.replace("\\\\", "\\")) for p in re.findall(r'"path"\s+"([^"]+)"', vdf.read_text(errors="replace"))]
        libraries.append(root)
    for lib in libraries:
        game = lib / "steamapps" / "common" / GAME_FOLDER
        if (game / "client_pc").is_dir():
            return game
    return None


DEFAULT_GAME_DIR = find_game_dir()
STEAM_APP_ID = 2183900

# Paks that never contain data we use; skipping them keeps indexing fast.
_SKIP_PREFIXES = ("default_sound", "default_video", "default_animation", "default_pso")


class PakIndex:
    """Maps archive member names to the pak that holds them.

    Later paks override earlier ones (client before server, so server-only
    files are still found, and the client copy wins for shared files).
    """

    def __init__(self, game_dir: Path | None = DEFAULT_GAME_DIR):
        if game_dir is None:
            raise FileNotFoundError("Space Marine 2 install not found; pass --game-dir or set SM2_GAME_DIR")
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
