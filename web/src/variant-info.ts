// What makes a weapon variant different from its siblings: players call them "the ammo version",
// "the accuracy version", "the fencing version" rather than by their in-game names.

import type { Weapon, WeaponsFile } from "./data";

type Variant = Weapon["variants"][number];

/** Short player-style words for stats (used as "<word> version"). */
const SPECIALTY_WORD: Record<string, string> = {
  firePower: "Damage",
  accuracy: "Accuracy",
  fireRate: "Fire rate",
  reloadingSpeed: "Reload",
  cooling: "Venting",
  chargingSpeed: "Charge speed",
  piercing: "Piercing",
  range: "Range",
  magazine: "Ammo",
  ammoReserve: "Ammo",
  headshotMult: "Headshot",
  strikePower: "Strength",
  strikeSpeed: "Speed",
  control: "Cleave",
};

/** Variants of the same tier, which is the only set the game's stat numbers are comparable within. */
export function tierSiblings(weapon: Weapon, variant: Variant): Variant[] {
  return weapon.variants.filter((v) => v.tier && v.tier === variant.tier);
}

/**
 * Specialties of a variant compared with the other variants of its tier: the stats where it is
 * strictly the best, plus its defence style for melee weapons when the tier mixes styles.
 * Returns e.g. ["Ammo"], ["Range"], ["Fencing", "Speed"]; empty when the tier has one variant.
 */
export function specialties(file: WeaponsFile, weapon: Weapon, variant: Variant): string[] {
  const sibs = tierSiblings(weapon, variant);
  if (sibs.length < 2) return [];
  const out: string[] = [];
  const defenses = new Set(sibs.map((v) => v.stats.defense));
  if (defenses.size > 1 && typeof variant.stats.defense === "string") out.push(file.defenseLabels[variant.stats.defense] ?? variant.stats.defense);
  for (const [key, word] of Object.entries(SPECIALTY_WORD)) {
    const mine = variant.stats[key];
    if (typeof mine !== "number") continue;
    const others = sibs.filter((v) => v !== variant).map((v) => v.stats[key]);
    if (others.every((o) => typeof o === "number" && mine > o) && !out.includes(word)) out.push(word);
  }
  return out;
}

/** "Ammo version", "Fencing · Speed version", or undefined. */
export function specialtyLabel(file: WeaponsFile, weapon: Weapon, variant: Variant): string | undefined {
  const s = specialties(file, weapon, variant);
  return s.length ? `${s.slice(0, 2).join(" · ")} version` : undefined;
}
