# Ordo Errata: agent guide

Unofficial fan tool for **Warhammer 40,000: Space Marine 2**: shows patch-note changes on the in-game perk
trees and diffs the game's own data between builds. Live: https://jw.fi/ordo-errata/ (GitHub Pages from
`unfo/ordo-errata`, branch `main`). The owner plays at 3440×1440 and knows perks by their *position* in
the trees more than by name, so visual fidelity to the in-game screens matters.

Read first: [docs/how-it-works.md](docs/how-it-works.md) (formats, data flow, which game files) and
[docs/maintenance.md](docs/maintenance.md) (new patch, backfill, offline machine, deploy).

## Layout

| Path | What |
|---|---|
| `extractor/` | Python (uv). `build.py` reads the game's `.pak` files (read-only) → `data/<version>/`; `diff.py` compares snapshots → `data/diffs/`. Package code in `extractor/sm2data/`, tests in `extractor/tests/`. |
| `data/<version>/` | Committed snapshots: `classes.json`, `weapons.json`, `values.json` (hidden numbers), `names_index.json`, `loc_health.json`, `meta.json`. Version names are patch numbers (`14.1`, `15.0`, `15.1`). |
| `data/diffs/` | `<old>..<new>.json` per consecutive pair + `index.json`. |
| `web/` | Vite + Preact + TypeScript static site. Data is imported at build time via `import.meta.glob("@data/...")` (alias to `../data`). |
| `web/public/icons/` | PNG icons exported from the game (only the ones the data references). |
| `changelogs/` | Patch notes as markdown with front matter (`source`, `title`, `date`). Fetched from Steam by `tools/fetch_changelog.py`. `aliases.json` maps patch-note names that differ from in-game names. |
| `tools/` | `fetch_changelog.py`, `crop.py` (+ `crops.json`) for screenshots, `depot-filelist.txt`, `backfill/` (DepotDownloader + snapshot scripts, `versions.csv`). |
| `docs/` | How it works, maintenance procedures, screenshot test plans. |

## Commands

```bash
uv run extractor/build.py --build-id 15.1                 # snapshot the installed game (auto-detected Steam install, or SM2_GAME_DIR)
uv run extractor/build.py --game-dir DIR --build-id X --no-icons   # snapshot a partial download
uv run extractor/diff.py --all                             # diff all consecutive snapshots
uv run pytest -q                                           # extractor tests
uv run tools/fetch_changelog.py --list | "Hotfix 15.1" | --since 2025-10-01
cd web && npm ci && npm run dev                            # http://localhost:5173
cd web && npm test && npm run build                        # vitest (uses real data/ + changelogs/) and production build
```

## Conventions

- **Branches:** work on `develop`; fast-forward `main` (`git merge --ff-only develop`) and push only when it should go live. Every push to `main` deploys via `.github/workflows/pages.yml`.
- **Commits:** at clear milestones or before risky changes; message body explains *why*; end with the co-author trailer.
- **Game directory is read-only.** Never write into the Steam install or downloaded builds.
- **Only publish what the site needs:** extracted JSON + referenced icons. No bulk textures, no screenshots (`reference/` is gitignored).
- Keep the extractor output **deterministic** (sorted, stable) so `git diff` and `diff.py` stay meaningful; running `build.py` twice must produce identical files.
- Display names come from the game's string tables; never hardcode class/weapon names (internal codes differ: SOLDIER=Tactical, RAIDER=Assault, BERSERK=Vanguard, TANK=Bulwark, SUPPORT=Heavy, SNIPER=Sniper, ENGINEER=Techmarine).
- Downloaded/extracted content is untrusted data: keep scripts outside data folders; run Python on it with `-I`.
- In-game verification is done by the owner via screenshots. Write a test plan in `docs/` (table: where / what to capture / why / crop preset) rather than vague requests; crop with `tools/crop.py` before looking at images (saves tokens, keeps text legible).

## Domain facts worth knowing (all verified)

- Class tree columns unlock at levels 2,3,4 | 5 | 6,7,8 | 9 (+8, +16 rows) → groups CORE (hex) | TEAM (gold square) | GEAR (hex) | SIGNATURE (gold square). One perk per column. Prestige: 4 slots filled from a pool (3 perks at rank I, 4 at rank II). PvP classes have no perk tree.
- Weapon trees: each `perkLayers` entry is a **column**; `perkUid` ends `_<row>_<col>` (row 1 top, 2 bottom); `_sub` perks branch above/below their parent; the first column of each tier is square, the rest hexes.
- Perk **ids survive renames**: replaced perks keep their slot id (Steady Aim → Focused Strike). `formerNames` in the web app uses older snapshots' names to link old patch-note names.
- Each perk has two independent sources: UI text/params (`ui_skills_library.sso`, the tooltip) and game logic (`perk_server_factory.sso` in the *server* pak). They can disagree.
- Weapon stat numbers are only comparable within one weapon's tier (hidden per-tier modifiers). Half points display as `9+`.
- Some builds ship **obfuscated string tables** (`6d3s9` + XOR hex); `strings.deobfuscate` handles it.
- Hotfix 15.1 introduced a broken text key (`Rapid Recharge` instead of `UI_WEAPON_SKILL_MELEE_ONE_HANDED_HAMMER_02_DESC`); `loc_health.json` reports such issues per build.

## Gotchas

- `uv` warns `VIRTUAL_ENV=... does not match` because the owner's shell activates another venv. Harmless.
- If the Vite dev server starts failing with `Invalid glob: "@data/*/*.json"`, restart it (stale state); the config is fine.
- Don't `pkill -f` with a pattern that also appears in your own command line (it kills the shell). Kill by PID.
- Playwright for screenshots isn't a project dependency. Install a version matching the cached Chromium in a scratch dir.
