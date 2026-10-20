#!/usr/bin/env bash
# Copy the 4 paks a snapshot needs (~1.4 GB) from the installed game to a per-version folder, so that version can
# be re-extracted later (e.g. after extractor improvements) even once Steam has updated the game.
#
# Usage:  tools/backfill/keep-current-build.sh <version> [dest-root]      (dest-root default: ~/sm2-builds)
# The game folder comes from SM2_GAME_DIR or the extractor's Steam auto-detection.
set -euo pipefail
version="${1:?usage: $0 <version> [dest-root]}"
dest="${2:-$HOME/sm2-builds}/$version"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
game="${SM2_GAME_DIR:-$(cd "$repo" && uv run python -I -c 'import sys; sys.path.insert(0, "extractor"); from sm2data.pak import find_game_dir; print(find_game_dir() or "")' 2>/dev/null)}"
[[ -d "$game/client_pc" ]] || { echo "game folder not found; set SM2_GAME_DIR" >&2; exit 1; }
for f in client_pc/root/paks/client/default/default.pak client_pc/root/paks/client/default/default_other.pak \
         client_pc/root/paks/client/resources.pak server_pc/root/paks/server/default/default_other.pak; do
  mkdir -p "$dest/$(dirname "$f")"
  cp -v "$game/$f" "$dest/$f"
done
echo "kept $version in $dest  (snapshot later with: uv run extractor/build.py --game-dir \"$dest\" --build-id $version --no-icons)"
