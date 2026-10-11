// Types and loaders for the JSON written by extractor/build.py.

export type DescPart =
  | { t: string }
  | { tag: string; t: string }
  | { v: string; kind?: string | null; missing?: boolean }
  | { enemy: string };

export interface Perk {
  id: string;
  type: string;
  noUi?: boolean;
  name?: string;
  nameKey?: string;
  descKey?: string;
  params?: { text: string; kind?: string }[];
  icon?: string | null;
  presence?: string[];
  desc?: { text: string; parts: DescPart[] };
  textIssue?: { kind: "brokenKey" | "missing"; note: string };
  blockedBy?: string[];
  unlocks?: string[];
  /** Weapon perks: 1 = top row, 2 = bottom row. */
  row?: number;
  /** Weapon perks: a branch perk unlocked by the row's main perk. */
  sub?: boolean;
}

export interface Slot {
  level: number;
  perks: Perk[];
}

export interface ClassData {
  id: string;
  name: string;
  icon: string | null;
  pve: {
    base: Perk[];
    columns: { tierIndex: number; slots: Slot[] }[];
    team: Slot[];
    prestige: { slot: string; requires: string; perks: Perk[] }[];
  };
  pvp: { base: Perk[] };
}

export interface ClassesFile {
  groups: Record<"CORE" | "TEAM" | "GEAR" | "SIGNATURE", string>;
  classes: ClassData[];
}

export interface WeaponTier {
  id: string;
  name: string;
  requiredExperience: number;
  layers: Perk[][];
}

export interface Weapon {
  id: string;
  kind: "ranged" | "melee";
  name: string;
  nameKey?: string;
  icon: string | null;
  variants: {
    id: string;
    name: string;
    nameKey?: string;
    /** COMMON | MASTERCRAFTED | ARTIFICER | RELIC | HEROIC; null for promo skins. */
    tier: string | null;
    stats: Record<string, number | string | boolean>;
  }[];
  tiers: WeaponTier[];
  heroic: (Perk & { variant: string })[];
}

export interface WeaponsFile {
  statLabels: Record<string, string>;
  defenseLabels: Record<string, string>;
  tierNames: Record<string, string>;
  weapons: Weapon[];
}

export type NameRef =
  | { kind: "class"; class: string }
  | { kind: "classPerk"; class: string; perk: string; where: string; mode: "pve" | "pvp" }
  | { kind: "weapon"; weapon: string }
  | { kind: "weaponVariant"; weapon: string; variant: string }
  | { kind: "weaponPerk"; weapon: string; perk: string; tier: string }
  | { kind: "heroicPerk"; weapon: string; perk: string; variant: string };

export interface Snapshot {
  buildId: string;
  classes: ClassesFile;
  weapons: WeaponsFile;
  names: Record<string, NameRef[]>;
  /**
   * Names used by other snapshots for entities that still exist under a new name, e.g.
   * "steady aim" -> the Tactical slot now called Focused Strike (the game keeps perk ids
   * when it replaces a perk in the same slot).
   */
  formerNames: Record<string, NameRef[]>;
}

// Every build snapshot is code-split; only the selected one is downloaded.
const files = import.meta.glob<{ default: unknown }>("@data/*/*.json");
import buildsIndex from "@data/builds.json";

export const builds: string[] = buildsIndex.builds;
export const latestBuild: string = buildsIndex.latest;

async function load<T>(build: string, name: string): Promise<T> {
  const key = Object.keys(files).find((k) => k.endsWith(`/${build}/${name}.json`));
  if (!key) throw new Error(`missing data/${build}/${name}.json`);
  return (await files[key]()).default as T;
}

export async function loadSnapshot(build: string = latestBuild): Promise<Snapshot> {
  const [classes, weapons, names, ...others] = await Promise.all([
    load<ClassesFile>(build, "classes"),
    load<WeaponsFile>(build, "weapons"),
    load<Record<string, NameRef[]>>(build, "names_index"),
    ...builds.filter((b) => b !== build).map((b) => load<Record<string, NameRef[]>>(b, "names_index")),
  ]);
  return { buildId: build, classes, weapons, names, formerNames: formerNames(names, others, classes, weapons) };
}

/** Names from other builds whose entities still exist here but no longer carry that name. */
export function formerNames(
  current: Record<string, NameRef[]>,
  others: Record<string, NameRef[]>[],
  classes: ClassesFile,
  weapons: WeaponsFile,
): Record<string, NameRef[]> {
  const perkIds = new Set<string>();
  for (const c of classes.classes)
    for (const p of [...c.pve.base, ...c.pvp.base, ...c.pve.columns.flatMap((x) => x.slots.flatMap((s) => s.perks)), ...c.pve.team.flatMap((s) => s.perks), ...c.pve.prestige.flatMap((s) => s.perks)])
      perkIds.add(p.id);
  for (const w of weapons.weapons) for (const p of [...w.tiers.flatMap((t) => t.layers.flat()), ...w.heroic]) perkIds.add(p.id);
  const weaponIds = new Set(weapons.weapons.map((w) => w.id));
  const exists = (r: NameRef) => ("perk" in r ? perkIds.has(r.perk) : "weapon" in r ? weaponIds.has(r.weapon) : true);
  const out: Record<string, NameRef[]> = {};
  for (const idx of others)
    for (const [name, refs] of Object.entries(idx)) {
      // Skip refs the current index already has under this name; keep the ones it doesn't.
      const alive = refs.filter(exists).filter((r) => !(current[name] ?? []).some((c) => JSON.stringify(c) === JSON.stringify(r)));
      if (alive.length) out[name] = [...(out[name] ?? []), ...alive.filter((r) => !(out[name] ?? []).some((o) => JSON.stringify(o) === JSON.stringify(r)))];
    }
  return out;
}

export function iconUrl(name: string | null | undefined): string | undefined {
  return name ? `${import.meta.env.BASE_URL}icons/${name}.png` : undefined;
}

/** Same normalization as extractor/build.py normalize_name. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[\s-]+/g, " ")
    .replace(/[^a-z0-9' ]/g, "")
    .trim();
}
