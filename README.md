# SM2 Patch Helper

An unofficial fan tool for **Warhammer 40,000: Space Marine 2** that shows patch-note changes on the game's own perk trees and weapon trees, using the game's icons.

Patch notes name perks and weapons by text only. This tool shows *which* hex in *which* tree changed, whether it was a buff, nerf, fix or replacement, and whether it affects PvE, PvP or both.

## How it works

1. `extractor/` (Python) reads a local game install **read-only**. The game's `.pak` archives are plain ZIP files, and its data files are a readable key/value text format. The extractor writes:
   - `data/<steam build id>/*.json`: class perk trees, weapon perk trees, names, descriptions with values, and a localization health report
   - `web/public/icons/*.png`: only the icons those files reference
2. `changelogs/*.md` hold the patch notes. Optional front matter `source:` links the official post. `changelogs/aliases.json` maps patch-note names that differ from in-game names (for example, the notes say "Heavy Melta Rifle" but the game calls it "Multi-Melta").
3. `web/` (Vite + Preact + TypeScript) is a static site that parses the notes, links each line to game entities and highlights them.

Each game update gets its own `data/<build id>/` snapshot, so later versions can diff the game data directly, including changes the notes don't mention.

## Usage

```bash
uv run extractor/build.py            # extract from ~/work/sm2 (or set SM2_GAME_DIR / --game-dir)
uv run pytest                        # extractor tests
cd web && npm ci && npm run dev      # local site
cd web && npm test                   # changelog parser tests (uses the extracted data)
```

## Disclaimer

This is an unofficial fan-made tool. It is not affiliated with, endorsed or sponsored by Games Workshop, Saber Interactive or Focus Entertainment.

Warhammer 40,000: Space Marine 2 © Games Workshop Limited 2024. Space Marine, the Space Marine logo, GW, Games Workshop, 40K, Warhammer, Warhammer 40,000, 40,000, the 'Aquila' Double-headed Eagle logo, and all associated logos, illustrations, images, names, creatures, races, vehicles, locations, weapons, characters, and the distinctive likeness thereof, are either ® or TM, and/or © Games Workshop Limited, variably registered around the world, and used under licence. Focus Entertainment and its logos are trademarks, registered or not, of Focus Entertainment. Saber Interactive and its logos are trademarks, registered or not, of Saber Interactive.

Game icons, names and descriptions in `data/` and `web/public/icons/` are the property of their respective owners. They are **not** covered by this project's license.

This software and data are provided "as is", without warranty of any kind, express or implied. Data is extracted automatically and may be incomplete, wrong or out of date.

## Rights holders / takedown

If you represent a rights holder and have concerns about any content here, please open an issue on this repository or email the maintainer at [emperor-protects@localhost.exposed](mailto:emperor-protects@localhost.exposed). Content will be reviewed and removed promptly on request.

## License

TODO: a Creative Commons license for this project's own code and content is still to be chosen. Until then, all rights are reserved by the author for the project's own work. Third-party game content is excluded, as described above.
