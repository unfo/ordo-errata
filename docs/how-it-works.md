# How Ordo Errata works

Space Marine 2 runs on Saber Interactive's own **Swarm engine** (not Unity or Unreal), so generic asset tools don't
apply. They aren't needed either: everything here uses Python's standard library plus Pillow.

## 1. Game files

A full install is about **93 GB** (`client_pc/` ~84 GB, `server_pc/` ~9 GB). Every `.pak` is a **plain ZIP archive**
(stored or deflated members), so `zipfile` reads members directly without unpacking anything to disk.

What the extractor actually reads, measured on build 15.1:

| Pak (under `…/root/paks/`) | Size | Members read | Bytes read | What for |
|---|---:|---:|---:|---|
| `client/default/default_other.pak` | 482 MB | 26 | 5.7 MB | Perk trees, perk UI data, weapon trees, weapon UI/stat data, firearm descriptions and modifiers, melee descriptions, icon lookup tables |
| `client/default/default.pak` | 777 MB | 1 | 5.6 MB | `texts/strings_english.str`: every display name and description |
| `server/default/default_other.pak` | 77 MB | 1 | 1.4 MB | `ssl/player/perks/perk_server_factory.sso`: the perks' real game-logic values |
| `client/resources.pak` | 87 MB | 373 | 0.2 MB | Texture headers (format, size, which mip file) |
| `client/default/default_pct_*.pak` (32 paks) | 50 GB | 373 | 1.9 MB | Icon pixels (only for the icons the data references) |

So a snapshot reads **~15 MB out of 93 GB**. The first four paks (**~1.4 GB**, listed in `tools/depot-filelist.txt`)
are enough for a data snapshot. The texture paks are only needed when new icons appear.

## 2. Formats

### SSL data files (`.sso`, also `.cls`, `.prop`)
Readable key/value text, the engine's serialised objects:
```
perkUid   =   "melee_thunder_hammer_one_handed_mastercrafted_1_3"
type   =   "PvEMeleeThunderHammerOneHandedPowerIncreaseOnMaxCharges"
parameters   =   [ { text = "10%" }, { text = "20" } ]
__type   =   "UiWeaponSkillData"
```
`extractor/sm2data/ssl.py` parses them into dicts and lists (`True`/`False`, numbers, strings; `#ssl_begin…#ssl_end`
script blocks are skipped). All ~11,000 `.sso` files in the game parse. Compiled `.sslbin` files (game code) are not
readable; changes that live only in code are invisible to the diff.

### String tables (`texts/strings_<lang>.str` in `default.pak`)
UTF-16LE, one `KEY<tabs>"value"` per line, about 34,000 entries. Values use placeholders `{STRING1}`, `{STRING2}` (or
bare `{STRING}`) and style tags such as `[majoris]Majoris[/majoris]`. For enemy-tier perks (`UiEnemyPresenceSkillData`),
`{STRING1}` is the enemy-tier *icon* and the parameters fill `{STRING2}` onwards. Some builds store every value
**obfuscated** as `6d3s9` + hex: UTF-16LE bytes XOR-ed with a one-byte key, recoverable because ASCII high bytes are 0
(`strings.deobfuscate`).

### Textures
`resources.pak: textures/ui/**/<name>.pct.resource` is a YAML-ish header (`format`, `sx`, `sy`, `mipMaps`). The pixels are
`<name>_0.pct_mip` inside one of the 32 `default_pct_*.pak`. Formats in use: **52 = BC7** (most icons; decoded with
Pillow's `bcn` decoder, mode 7) and **0 = raw RGBA8**. Icon *ids* used by the data are keys into UI "switcher" files
(`ssl/ui/fusion/assets/switchers/…`), e.g. `perk_berserk_12` → texture `perk_berserk_12_upd`.

## 3. The data chain (one perk, end to end)

```
mastery_library.sso      PVE_SOLDIER tiers[col].levels[LEVEL_11].skill → "PVE_Soldier_Progression.Level11"
mastery_skills_library   PVE_Soldier_Progression.Level11.perks → ["PveSoldierRestoreChargeForAuspexTargetsQuantity"]
ui_skills_library.sso    that type → nameUid/descUid, parameters ["40%", "50%"], icon "perk_soldier_15_rework"
strings_english.str      UI_MASTERY_PERK_SOLDIER_T5_01_NAME → "Marksman's Mandate"
switcher + resources.pak icon id → texture header → BC7 pixels in default_pct_11.pak → PNG
perk_server_factory.sso  (server pak) same type → game-logic modifiers, e.g. bonus 40
```
Weapon trees: `weapon_perks_progression_library.sso` (tiers → columns → perks), names and variant stats from
`ui_firearms_library.sso` / `ui_abilities_library.sso`, XP thresholds and variant→tier from
`weapon_mastery_progression_library.sso`, hidden numbers from `firearm_library_pve/pvp.sso`,
`firearm_modificators_library.sso` (per-variant modifiers and heroic "godlike" presets) and
`melee_weapon_descs/<weapon>_desc.sso`.

## 4. Snapshot files (`data/<version>/`)

| File | Content |
|---|---|
| `classes.json` | Per class: base kit, 7 perk columns (with unlock levels), team column, prestige pool, PvP kit. Each perk: id, name, rendered description (`parts` keep values and enemy icons), params, icon, text issues. |
| `weapons.json` | Per weapon: variants (tier, displayed stats incl. magazine/reserve/headshot), tiers → columns → perks (row, sub), heroic perks; stat/tier labels from the game's strings. |
| `values.json` | Hidden numbers flattened to `path: value` per entity (`perk:<type>`, `weapon:<id>` with `pve.`/`pvp.` prefixes, `variant:<weapon>/<id>`). Presentation keys (sound, VFX, camera, meshes…) are filtered out. |
| `names_index.json` | Normalised display name → entity references, for linking patch notes. |
| `loc_health.json` | Malformed or missing text keys (e.g. the 15.1 Charge Overflow bug). |
| `meta.json` | Version name, Steam build id, manifest and provenance note. |

Sizes: about 2.5 MB per snapshot, plus a few hundred KB per diff.

## 5. Diffs (`extractor/diff.py`)

Per entity: perk added/removed/moved, tooltip text or numbers (stored as before/after rendered tooltips), name/icon,
variant stats, and every changed hidden value with its percentage. Perk values are keyed by perk *type* and fan out
in the UI to every perk slot that uses that type.

## 6. Web app (`web/src/`)

| File | Role |
|---|---|
| `data.ts` | Types, snapshot loading (code-split per build), `formerNames` from older snapshots |
| `changelog.ts` | Markdown → items; heading scope; name matching (emphasis, scope scan, plain-text weapon names, aliases, former names); PvE/PvP and buff/nerf classification |
| `diff-view.tsx` | Data diff page, grouping (class/weapon), row building (Tooltip vs Game logic), glossary-based labels |
| `views.tsx`, `weapon-view.tsx` | Class and weapon screens modelled on the in-game layouts |
| `perk-panel.tsx` | Hover preview, pinned cards, SVG leader lines |
| `mini-tree.tsx` | Mini perk-tree popovers in the patch notes |
| `glossary.ts` | Human wording for engine identifiers (the game has no text for them) |
