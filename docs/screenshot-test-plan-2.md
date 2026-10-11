# Screenshot test plan #2

Take each screenshot with F12, in order. Then: `uv run tools/crop.py class_perks --last 1` (shot 1) and `ui` (shot 2).

| # | Where | What to show | Checks | Crop preset |
|---|---|---|---|---|
| 1 | Tactical → **Perks** | Hover the class emblem / ability (top left) so its tooltip shows | The data has two "Auspex Scan" texts: a correct one ("…for **8** seconds… penetrate **1** more enemies… increases by **20%**") and a broken one ("…for **10** seconds… penetrate **8** more enemies… increases by **{STRING3}**"). Which one does the game show? | `class_perks` |
| 2 | Tactical → **Perks** | Hover **Vital Data** (Signature column) | A two-tier perk (Extremis + Terminus icons): icon placement and value position | `ui` |
