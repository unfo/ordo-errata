# Maintenance procedures

## When a new patch or hotfix comes out

Steam updates the game in place, so the old version disappears from disk. Either snapshot **before** letting Steam
update, or fetch the old version later with DepotDownloader (see backfill below).

1. *(optional, before updating)* `uv run extractor/build.py --build-id <old version>` if that snapshot doesn't exist yet.
2. Let Steam update, then snapshot the new build with icons:
   ```bash
   uv run extractor/build.py --build-id 15.2
   ```
   It prints any missing text keys and malformed keys. New icons are exported to `web/public/icons/`.
3. Diff and fetch the notes:
   ```bash
   uv run extractor/diff.py --all
   uv run tools/fetch_changelog.py "Hotfix 15.2"      # or --since <date>
   ```
4. Check the patch notes page for unmatched names (bottom of the page). If a perk or weapon is named differently in
   the notes than in game, add it to `changelogs/aliases.json`.
5. Add the release to `tools/backfill/versions.csv` (version, release date, next release, manifest id from
   `~/steam-c/../appmanifest_2183900.acf` → `InstalledDepots.2183901.manifest`).
6. Run the tests (`uv run pytest -q`, `cd web && npm test && npm run build`), commit on `develop`, fast-forward `main`,
   push. GitHub Actions deploys.

## Backfilling older versions

Needs: Windows with [DepotDownloader](https://github.com/SteamRE/DepotDownloader) and your own Steam account (you must
own the game); WSL with this repo.

1. **Pick manifests.** Open https://steamdb.info/depot/2183901/manifests/ in a browser (SteamDB blocks scripts). For each
   row in `tools/backfill/versions.csv` choose the **newest manifest dated after `released` and before `next_release`**:
   that is the final state of that version, including silent fixes. Put its id in the `manifest` column.
   (Note: SteamDB shows dates in your locale. The first attempt here picked a "09/01" manifest that was 1 September,
   not 9 January.)
2. **Download** (Windows PowerShell; copy `tools/backfill/` and `tools/depot-filelist.txt` to Windows first, or run from
   `\\wsl.localhost\<distro>\home\…`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\download-builds.ps1 -Username <steam login>
   ```
   Downloads only the 4 needed paks (~1.4 GB per version) to `%USERPROFILE%\depot\sm2-builds\<version>\` and
   skips versions already done. `-Only 13.0,13.2` limits the run.
3. **Snapshot, diff, fetch notes** (WSL, repo root):
   ```bash
   tools/backfill/build-snapshots.sh /mnt/c/Users/<you>/depot/sm2-builds
   ```
   Existing snapshots are skipped (`--force` rebuilds). The downloads can be deleted afterwards.
4. Review, test, commit, deploy as above.

Older builds may contain structures the extractor hasn't seen. If a build fails, the script reports it and continues
with the others. Fix the extractor (keep current builds producing identical output), then re-run that version with `--force`.

## Working on another machine (cloud VM, no game install)

Everything except new icons works from the repo alone: the snapshots in `data/` are committed. To make **new**
snapshots elsewhere, copy just these four files (~1.4 GB), keeping their relative paths:
```
client_pc/root/paks/client/default/default.pak
client_pc/root/paks/client/default/default_other.pak
client_pc/root/paks/client/resources.pak
server_pc/root/paks/server/default/default_other.pak
```
then `uv run extractor/build.py --game-dir <copy> --build-id <v> --no-icons`. If the build needs icons that aren't in
`web/public/icons/`, it prints which `default_pct_*.pak` files contain them. Copy only those (about 1.5 GB each) and run
again without `--no-icons`.

Setup on a fresh machine: `uv sync` (Python 3.11+), `cd web && npm ci` (Node 24). Game path: `--game-dir` or `SM2_GAME_DIR`.

## In-game verification

Visual or wording questions are settled with screenshots from the owner. Write a numbered test plan in `docs/`
(see `screenshot-test-plan.md`), then crop with `uv run tools/crop.py <preset> --last N`. Screenshots are read from the
Steam screenshot folder (`SM2_SCREENSHOT_DIR` overrides it). Presets assume a centred 2550×1440 UI area and scale by
height for other resolutions.

## Deploy

GitHub Pages via Actions (`.github/workflows/pages.yml`, Node 24 actions, runner pinned to `ubuntu-24.04`). The site
uses a relative base, so it works at `https://jw.fi/ordo-errata/` (custom domain on the owner's GitHub Pages) and at any
sub-path. Pages source must be set to "GitHub Actions" in the repo settings (done).
