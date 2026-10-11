# Screenshot test plan #1

Take each screenshot with Steam's screenshot key (F12) in the order below. Afterwards, the tool crops them with
`uv run tools/crop.py <preset> --last 5` (preset per shot below), so only the relevant part is analysed.

All weapon shots: **Armoury** → select the class → open the weapon slot → pick the weapon from the top weapon bar.

| # | Where | What to show | Checks | Crop preset |
|---|---|---|---|---|
| 1 | Heavy → Primary weapon → **Heavy Bolter** → *Versions* | Click the **Gathalamor Crusade - Alpha** (Relic) version so its stats show top-left | Which stat rows are listed for a venting weapon that also has Piercing (data: Firepower 9, Accuracy 4, Rate of Fire 8+, Venting 4, Piercing 4, Range 5) | `weapon_stats` |
| 2 | Tactical → Primary weapon → **Bolt Rifle** → *Versions* | Click **Gathalamor Crusade** (Relic) | Stat rows for a normal ranged weapon (data: Firepower 9, Accuracy 8+, Rate of Fire 4, Reloading 5, Piercing 3, Range 7); is Magazine Capacity shown? | `weapon_stats` |
| 3 | Heavy → **Heavy Bolter** → *Perk Tree* | Whole tree, no hover | Branch perks in Master-Crafted, Artificer and Relic column 2 (6 branch perks in total) | `weapon_tree` |
| 4 | Same as 3 | Hover **Heavy Immunity** (Master-Crafted, branch above column 2) | Tooltip text and values vs our card | `weapon_tree` |
| 5 | Vanguard → **Perks** | Hover **Adrenaline Rush** (Signature column, bottom) | Enemy-tier icon + "Majoris" styling in the description | `ui` |

## Results (2026-10-11)

1. Heavy Bolter lists Piercing although it vents heat. The game hides Piercing only at its minimum value 1 (Plasma Pistol). Fixed.
2. Ranged weapons also list Magazine Capacity, Ammo Reserve (absent when 0, e.g. venting weapons) and Headshot Multiplier (absent when the shot has none). These are computed from the hidden values: base description, or a heroic preset override, plus the variant's modifiers. Matches Bolt Rifle relic 25/125/x2.8, Heavy Bolter relic 450/x2 and heroic Plasma Pistol 100.
3. Heavy Bolter tree: branch perks above/below column 2 in Master-Crafted, Artificer and Relic, plus Relic column 3. Our layout matches.
4. Heavy Immunity tooltip text matches the game word for word.
5. Adrenaline Rush: the enemy-tier icon and name are tinted red-orange. Fixed (the icon is now tinted via a CSS mask).
