# Screenshot test plan #2

Take each screenshot with F12, in order. Then: `uv run tools/crop.py class_perks --last 1` (shot 1) and `ui` (shot 2).

| # | Where | What to show | Checks | Crop preset |
|---|---|---|---|---|
| 1 | Tactical → **Perks** | Hover the class emblem / ability (top left) so its tooltip shows | The data has two "Auspex Scan" texts: a correct one ("…for **8** seconds… penetrate **1** more enemies… increases by **20%**") and a broken one ("…for **10** seconds… penetrate **8** more enemies… increases by **{STRING3}**"). Which one does the game show? | `class_perks` |
| 2 | Tactical → **Perks** | Hover **Vital Data** (GEAR, top of the third column; the plan first said Signature by mistake) | A two-tier perk (Extremis + Terminus icons): icon placement and value position | `ui` |

## Results (2026-10-11)

1. The game shows the **correct** Auspex Scan text (8 s / penetrate 1 / +20%). The second text with the unfilled
   `{STRING3}` (perk `PveSoldierReloadHolsterWeapon`) exists in the data but is not displayed. It stays listed in
   `loc_health.json` as a data issue; the site now always prefers the clean entry when base-kit names repeat.
2. Shot of **Marked for Death** instead (also two tiers): text, icon order (Majoris, then Extremis) and the 100% value
   match the site exactly, confirming the fix for perks with two enemy tiers.
