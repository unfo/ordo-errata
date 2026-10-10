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
  layers: Perk[][];
}

export interface Weapon {
  id: string;
  kind: "ranged" | "melee";
  name: string;
  nameKey?: string;
  icon: string | null;
  variants: { id: string; name: string; nameKey?: string }[];
  tiers: WeaponTier[];
  heroic: (Perk & { variant: string })[];
}

export interface WeaponsFile {
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
  const [classes, weapons, names] = await Promise.all([
    load<ClassesFile>(build, "classes"),
    load<WeaponsFile>(build, "weapons"),
    load<Record<string, NameRef[]>>(build, "names_index"),
  ]);
  return { buildId: build, classes, weapons, names };
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
