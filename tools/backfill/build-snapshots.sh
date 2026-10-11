#!/usr/bin/env bash
# Turn downloaded old builds into snapshots, diff consecutive snapshots, and fetch their patch notes.
#
# Usage:  tools/backfill/build-snapshots.sh <download-root> [--force]
#   <download-root>  folder with one sub-folder per version (as written by download-builds.ps1),
#                    e.g. /mnt/c/Users/me/depot/sm2-builds
#   --force          rebuild snapshots that already exist under data/
#
# Reads tools/backfill/versions.csv for the version list and manifest ids. Run from anywhere.
set -euo pipefail

root="${1:?usage: $0 <download-root> [--force]}"
force="${2:-}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
csv="$repo/tools/backfill/versions.csv"
cd "$repo"

built=() skipped=() missing=() failed=()
earliest=""
# version,released,next_release,manifest,notes  (notes may contain commas: keep the rest of the line)
while IFS=, read -r version released next manifest notes; do
  [[ "$version" == "version" || -z "$version" ]] && continue
  [[ -z "$earliest" || "$released" < "$earliest" ]] && earliest="$released"
  dir="$root/$version"
  if [[ ! -f "$dir/client_pc/root/paks/client/default/default_other.pak" ]]; then
    missing+=("$version"); continue
  fi
  if [[ -d "data/$version" && "$force" != "--force" ]]; then
    skipped+=("$version"); continue
  fi
  echo "== building snapshot $version (manifest ${manifest:-?})"
  if uv run extractor/build.py --game-dir "$dir" --build-id "$version" --no-icons \
      ${manifest:+--manifest "$manifest"} --note "released $released; ${notes:-}"; then
    built+=("$version")
  else
    failed+=("$version")
  fi
done < "$csv"

echo "== diffing consecutive snapshots"
uv run extractor/diff.py --all

if [[ -n "$earliest" ]]; then
  echo "== fetching patch notes since $earliest"
  uv run tools/fetch_changelog.py --since "$earliest" || echo "(patch note fetch failed; snapshots are fine)"
fi

echo
echo "built:   ${built[*]:-none}"
echo "skipped: ${skipped[*]:-none} (already in data/; use --force to rebuild)"
echo "missing: ${missing[*]:-none} (no download found under $root)"
[[ ${#failed[@]} -gt 0 ]] && echo "FAILED:  ${failed[*]}  <- see output above" && exit 1
exit 0
