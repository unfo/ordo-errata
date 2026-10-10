// Human wording for the game's internal identifiers. The game ships no player-facing text for
// these (they are engine enum names), so this is our own translation: a few curated terms plus
// mechanical word splitting for everything else.

/** How a modifier's bonus combines with others. */
export const APPLY_TYPES: Record<string, { unit: string; note: string }> = {
  PERCENT_SUM: { unit: "%", note: "adds up with other % bonuses" },
  PERCENT_MULT: { unit: "%", note: "multiplies with other bonuses" },
  ABSOLUTE: { unit: "", note: "flat amount" },
};

/** Whole-identifier overrides where word splitting reads badly. */
const TERMS: Record<string, string> = {
  SCALE_DAMAGE_AMOUNT_FROM_MELEE: "melee damage dealt",
  SCALE_DAMAGE_AMOUNT_FROM_FIREARM: "ranged damage dealt",
  SCALE_DAMAGE_AMOUNT_FROM_MELEE_PER_SPENT_STACK: "melee damage per spent charge",
  FIREARM_CHARGE_DURATION: "time to charge a shot",
  FIREARM_RELOAD_RATE: "reload speed",
  FIREARM_FIRE_RATE: "rate of fire",
  FIREARM_SCALE_SPREAD: "spread",
  SCALE_RECOIL: "recoil",
  FIREARM_SWITCH_SPEED: "weapon switch speed",
  healthDmgPercent: "damage %",
  maxDamagedActors: "max enemies hit (cleave)",
  radiusScale: "radius multiplier",
  shouldForceHeavyHit: "always staggers (heavy hit)",
  cooldownTime: "cooldown (s)",
  delayedResetSec: "duration (s)",
  resetMultiplierDelay: "bonus window (s)",
  headshotMult: "headshot multiplier",
  heavyHitDamage: "stagger damage",
  shotsPerMin: "rate of fire (shots/min)",
};

/** Word replacements applied after splitting. */
const WORDS: Record<string, string> = {
  se: "status effect",
  dmg: "damage",
  hp: "health",
  sensitivity: "damage taken", // e.g. ..._SENSITIVITY modifiers change how much damage the target takes
  pve: "PvE",
  pvp: "PvP",
};

/** "FIREARM_CHARGE_DURATION" / "maxDamagedActors" -> readable words. */
export function humanize(id: string): string {
  if (TERMS[id]) return TERMS[id];
  const words = id.includes("_") && id === id.toUpperCase() ? id.toLowerCase().split("_") : id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_]+/);
  return words.map((w) => WORDS[w] ?? w).join(" ");
}
