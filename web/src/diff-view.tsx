import { useEffect, useMemo, useState } from "preact/hooks";
import type { DescPart, Perk, Snapshot } from "./data";
import type { Change, ChangeMode, Effect, Highlights, Mode } from "./changes";
import { hrefFor, labeler } from "./changelog";
import { Desc, GroupedChanges, Icon, TooltipDiff } from "./components";
import { useChipPreview } from "./mini-tree";
import { APPLY_TYPES, humanize } from "./glossary";

export interface DiffChange {
  kind: "added" | "removed" | "field" | "moved" | "stat" | "value" | "tooltip";
  field?: string;
  old?: unknown;
  new?: unknown;
  pct?: number;
  name?: string;
  where?: string;
}

export interface GameDiff {
  from: string;
  to: string;
  entities: Record<string, DiffChange[]>;
}

const files = import.meta.glob<{ default: GameDiff }>("@data/diffs/*..*.json");

/** Available diffs, newest first. Ids look like "<old build>..<new build>". */
export const diffs = Object.keys(files)
  .map((path) => ({ id: path.split("/").pop()!.replace(/\.json$/, ""), path }))
  .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));

export function useDiff(diffId: string) {
  const [diff, setDiff] = useState<GameDiff>();
  useEffect(() => {
    const entry = diffs.find((d) => d.id === diffId);
    if (!entry) {
      setDiff(undefined);
      return;
    }
    let live = true;
    files[entry.path]().then((m) => live && setDiff(m.default));
    return () => {
      live = false;
    };
  }, [diffId]);
  return diff;
}

function perksByType(snap: Snapshot): Map<string, Perk[]> {
  const m = new Map<string, Perk[]>();
  const add = (p: Perk) => m.set(p.type, [...(m.get(p.type) ?? []), p]);
  for (const c of snap.classes.classes) {
    [...c.pve.base, ...c.pvp.base, ...c.pve.columns.flatMap((x) => x.slots.flatMap((s) => s.perks)), ...c.pve.team.flatMap((s) => s.perks), ...c.pve.prestige.flatMap((s) => s.perks)].forEach(add);
  }
  for (const w of snap.weapons.weapons) [...w.tiers.flatMap((t) => t.layers.flat()), ...w.heroic].forEach(add);
  return m;
}

/** Highlight keys an entity maps to in the trees (perkType fans out to every perk of that type). */
export function entityKeys(snap: Snapshot, key: string, byType = perksByType(snap)): string[] {
  if (key.startsWith("perkType:")) return (byType.get(key.slice(9)) ?? []).map((p) => `perk:${p.id}`);
  return [key];
}

function changeMode(c: DiffChange): ChangeMode {
  if (c.kind === "value" && c.field?.startsWith("pvp.")) return "pvp";
  if (c.kind === "value" && c.field?.startsWith("pve.")) return "pve";
  return "both";
}

function effectOf(c: DiffChange): Effect {
  if (c.kind === "added") return "added";
  if (c.kind === "removed") return "removed";
  return "changed";
}

export interface Line {
  /** Flat one-line form, used where there is no table (e.g. tooltips). */
  text: string;
  mode: ChangeMode;
  effect: Effect;
  /** Part of the entity, e.g. a melee attack. */
  group?: string;
  /** What changed, for the table's Item column. */
  item: string;
  old: string;
  new: string;
  pct?: number;
  /** Extra explanation, e.g. how a modifier stacks. */
  note?: string;
  /** A displayed weapon stat (as opposed to a game-logic value). */
  isStat?: boolean;
}

/** Which part of a weapon a value belongs to: a melee attack, a cartridge, ammo... */
export function groupOf(path: string): string | undefined {
  const strike = path.match(/strikeSettings\.([^.[]+)/);
  if (strike) return capitalize(humanize(strike[1]).replace(/([a-z])(\d)/g, "$1 $2"));
  const cart = path.match(/cartridgeDescriptions\.([^.[]+)/);
  if (cart) return `Shot: ${humanize(cart[1])}`;
  if (/clipsSettings|ammoSettings/.test(path)) return "Ammo";
  if (/barrelDescriptions/.test(path)) return "Firing";
  return undefined;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const MODIFIER = /^(.*)\[([A-Z][A-Z0-9_]+)\]\.(type|applyType|bonus)$/;

/** "permanentModifiers" -> "permanent bonus" */
function containerLabel(prefix: string): string {
  const last = prefix.split(".").pop()!.replace(/\[.*$/, "");
  if (last === "permanentModifiers") return "permanent bonus";
  if (last === "modifiers") return "temporary bonus";
  return humanize(last);
}

/** One row per change; the type/applyType/bonus fields of a modifier become one row. */
export function describeAll(changes: DiffChange[], entityKey = ""): Line[] {
  return sourceGroups(describeLines(changes), entityKey);
}

/**
 * Perks and variants have two independent sources that Saber updates by hand: what the UI
 * shows (tooltip text and its numbers, stat bars) and the game logic. Label rows by source so
 * a tooltip-only or logic-only change stands out.
 */
function sourceGroups(lines: Line[], key: string): Line[] {
  const kind = key.slice(0, key.indexOf(":"));
  const structural = (l: Line) => l.item === "Added" || l.item === "Removed" || l.item === "Position";
  if (kind === "perk") return lines.map((l) => ({ ...l, group: l.group ?? (structural(l) ? undefined : "Tooltip") }));
  if (kind === "perkType") return lines.map((l) => ({ ...l, group: l.group ?? "Game logic" }));
  if (kind === "variant") return lines.map((l) => ({ ...l, group: l.group ?? (l.item === "Added" || l.item === "Removed" ? undefined : l.isStat ? "Shown stats" : "Game logic") }));
  return lines;
}

function describeLines(changes: DiffChange[]): Line[] {
  const lines: Line[] = [];
  const mods = new Map<string, { type: string; prefix: string; mode: ChangeMode; fields: Record<string, DiffChange> }>();
  // A description that differs only in its numbers repeats the "Values" row; skip it.
  const numbersOnly = (c: DiffChange) => {
    const strip = (x: unknown) => String(x ?? "").replace(/\d+(\.\d+)?/g, "#");
    return c.kind === "field" && c.field === "description" && strip(c.old) === strip(c.new) && changes.some((o) => o.field === "values");
  };
  for (const c of changes) {
    if (numbersOnly(c) || c.kind === "tooltip") continue; // tooltips are rendered separately
    const m = c.kind === "value" ? c.field!.match(MODIFIER) : null;
    if (m) {
      const key = `${m[1]}[${m[2]}]`;
      const g = mods.get(key) ?? { type: m[2], prefix: m[1], mode: changeMode(c), fields: {} };
      g.fields[m[3]] = c;
      mods.set(key, g);
      continue;
    }
    const group = c.kind === "value" ? groupOf(c.field!) : undefined;
    lines.push({ text: describe(c), mode: changeMode(c), effect: effectOf(c), group, isStat: c.kind === "stat", ...rowOf(c, group) });
  }
  for (const g of mods.values()) {
    const val = (side: "old" | "new") => {
      const bonus = g.fields.bonus?.[side];
      if (bonus === undefined || bonus === null) return undefined;
      const a = APPLY_TYPES[String(g.fields.applyType?.[side] ?? "")];
      const n = Number(bonus);
      return `${n > 0 && a?.unit ? "+" : ""}${n}${a?.unit ?? ""}`;
    };
    const old = val("old");
    const nu = val("new");
    const apply = String(g.fields.applyType?.new ?? g.fields.applyType?.old ?? "");
    const note = APPLY_TYPES[apply]?.note;
    const item = `${humanize(g.type)} (${containerLabel(g.prefix)})`;
    const effect: Effect = old === undefined ? "added" : nu === undefined ? "removed" : "changed";
    const text = `${item}: ${old ?? "—"} → ${nu ?? "—"}${note ? ` (${note})` : ""}`;
    lines.push({ text, mode: g.mode, effect, item, old: old ?? "—", new: nu ?? "—", note });
  }
  return lines;
}

function fmtValue(x: unknown): string {
  if (Array.isArray(x)) return x.join(", ");
  if (x === undefined || x === null) return "—";
  if (typeof x === "string" && /^[A-Z][A-Z0-9_]+$/.test(x)) return humanize(x);
  return String(x);
}

/** Item / old / new for a single (non-modifier) change. */
function rowOf(c: DiffChange, group?: string): Pick<Line, "item" | "old" | "new" | "pct"> {
  switch (c.kind) {
    case "added":
      return { item: "Added", old: "—", new: c.where ?? c.name ?? "yes" };
    case "removed":
      return { item: "Removed", old: c.where ?? c.name ?? "yes", new: "—" };
    case "moved":
      return { item: "Position", old: fmtValue(c.old), new: fmtValue(c.new) };
    case "tooltip":
      return { item: "Tooltip", old: "", new: "" };
    case "field":
      return { item: c.field === "values" ? "Numbers in the text" : capitalize(c.field!), old: fmtValue(c.old), new: fmtValue(c.new) };
    case "stat":
      return { item: humanize(c.field!), old: fmtValue(c.old), new: fmtValue(c.new) };
    case "value": {
      // The group already names the attack; describe the rest of the path without it.
      const path = group ? c.field!.replace(/(strikeSettings)\.[^.[]+\./, "$1.") : c.field!;
      // "application" / "type" wrap every perk value; they add nothing for the reader.
      const item = prettyPath(path)
        .replace(/^(PvE|PvP) · /, "")
        .replace(/^(application|type) · /, "");
      // Identifier lists ("Light1, Light2, ..."): show what was removed / added instead of both full lists.
      if (typeof c.old === "string" && typeof c.new === "string" && (c.old.includes(", ") || c.new.includes(", "))) {
        const a = new Set(c.old.split(", "));
        const b = new Set(c.new.split(", "));
        const removed = [...a].filter((x) => !b.has(x));
        const added = [...b].filter((x) => !a.has(x));
        return { item, old: removed.length ? `− ${removed.join(", ")}` : "—", new: added.length ? `+ ${added.join(", ")}` : "—" };
      }
      return { item, old: fmtValue(c.old), new: fmtValue(c.new), pct: c.pct };
    }
  }
}

export function describe(c: DiffChange): string {
  const v = fmtValue;
  switch (c.kind) {
    case "added":
      return `Added${c.where ? ` (${c.where})` : ""}`;
    case "removed":
      return `Removed${c.where ? ` (was ${c.where})` : ""}`;
    case "moved":
      return `Moved: ${v(c.old)} → ${v(c.new)}`;
    case "tooltip":
      return "Tooltip text changed";
    case "field":
      return `${c.field![0].toUpperCase()}${c.field!.slice(1)}: ${v(c.old)} → ${v(c.new)}`;
    case "stat":
      return `${c.field}: ${v(c.old)} → ${v(c.new)}`;
    case "value":
      return `${prettyPath(c.field!)}: ${v(c.old)} → ${v(c.new)}${c.pct !== undefined ? ` (${c.pct > 0 ? "+" : ""}${c.pct}%)` : ""}`;
  }
}

/** Readable names for well-known value fields (last path segment, or segment + spline index). */
const FIELD_LABELS: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/coeffDamage\.spline\[(\d+)\]$/, (m) => splinePoint("damage falloff", Number(m[1]))],
  [/\.spline\[(\d+)\]$/, (m) => splinePoint("curve", Number(m[1]))],
  [/clipsSettings\.[^.]+\.maxAmmo$/, "magazine size"],
  [/ammoSettings\.typeData\.[^.]+\.maxAmount$/, "max ammo pool"],
  [/shotsPerMin$/, "rate of fire (shots/min)"],
  [/headshotMult$/, "headshot multiplier"],
  [/heavyHitDamage$/, "heavy hit (stagger) damage"],
  [/shotCreatorSettings\.damage$/, "damage"],
  [/healthDamage$/, "health damage"],
  [/cooldownTime$/, "cooldown (s)"],
  [/delayedResetSec$/, "duration (s)"],
  [/\.bonus$/, "bonus"],
];

/** Damage curves are [distance, multiplier, distance, multiplier, ...]. */
function splinePoint(what: string, i: number): string {
  const point = Math.floor(i / 2) + 1;
  return i % 2 === 0 ? `${what} point ${point} distance (m)` : `${what} point ${point} multiplier`;
}

/** "pve.cartridgeDescriptions.bolts.shotCreatorSettings.damage" -> "PvE · bolts · damage" */
export function prettyPath(path: string): string {
  const parts = path.split(".");
  const mode = parts[0] === "pve" ? "PvE" : parts[0] === "pvp" ? "PvP" : undefined;
  const rest = mode ? parts.slice(1) : parts;
  // Keep lowercase ids (cartridge/barrel/ammo names) as context, e.g. "bolts" or "plasma_bomb_of_doom".
  const context = rest.slice(0, -1).filter((p) => /^[a-z][a-z_0-9]*$/.test(p) && !/^(auto|default_clip)$/.test(p));
  for (const [re, label] of FIELD_LABELS) {
    const m = path.match(re);
    if (m) return joinLabel(mode, [...context.slice(-1), typeof label === "string" ? label : label(m)]);
  }
  const keep = rest.filter((p, i) => i >= rest.length - 2 || /^[a-z_0-9]+$/.test(p));
  return joinLabel(mode, keep.map(humanizeSegment));
}

/** "cooldown · cooldown (s)" -> "cooldown (s)": drop a segment the next one already starts with. */
function joinLabel(mode: string | undefined, words: string[]): string {
  const deduped = words.filter((w, i) => !(i < words.length - 1 && words[i + 1].startsWith(w)));
  return [mode, ...deduped].filter(Boolean).join(" · ");
}

/** "permanentModifiers[FIREARM_FIRE_RATE]" -> "permanent modifiers (rate of fire)" */
function humanizeSegment(seg: string): string {
  const m = seg.match(/^(.*?)\[(.+)\]$/);
  if (m) return `${humanize(m[1])} (${/^\d+$/.test(m[2]) ? `#${Number(m[2]) + 1}` : humanize(m[2])})`;
  return humanize(seg);
}

/** Changes from a game data diff, shaped like patch-note changes so the trees can highlight them. */
export function diffHighlights(snap: Snapshot, diff: GameDiff): Highlights {
  const byType = perksByType(snap);
  const out: Highlights = new Map();
  const source = `Game data ${diff.from} → ${diff.to}`;
  for (const [key, changes] of Object.entries(diff.entities)) {
    const tip = changes.find((c) => c.kind === "tooltip");
    if (tip) {
      const t = tip as unknown as { old?: { text: string; parts: DescPart[] }; new?: { text: string; parts: DescPart[] } };
      const change: Change = {
        id: `${source}:${key}:tooltip`,
        source,
        section: [],
        text: `Tooltip: ${t.old?.text ?? "—"} → ${t.new?.text ?? "—"}`,
        mode: "both",
        effect: "changed",
        fromData: true,
        tooltip: { old: t.old, new: t.new },
      };
      for (const k of entityKeys(snap, key, byType)) out.set(k, [...(out.get(k) ?? []), change]);
    }
    for (const [i, line] of describeAll(changes, key).entries()) {
      const change: Change = {
        id: `${source}:${key}:${i}`,
        source,
        section: [],
        text: line.group ? `${line.group} · ${line.text.replace(/^(PvE|PvP) · /, "")}` : line.text,
        mode: line.mode,
        effect: line.effect,
        fromData: true,
        row: { group: line.group, item: line.item, old: line.old, new: line.new, pct: line.pct, note: line.note },
      };
      for (const k of entityKeys(snap, key, byType)) out.set(k, [...(out.get(k) ?? []), change]);
    }
  }
  return out;
}

export function mergeHighlights(...maps: (Highlights | undefined)[]): Highlights {
  const out: Highlights = new Map();
  for (const m of maps) for (const [k, v] of m ?? []) out.set(k, [...(out.get(k) ?? []), ...v]);
  return out;
}

export function DiffView({
  snap,
  diff,
  notes,
  mode,
  go,
}: {
  snap: Snapshot;
  diff?: GameDiff;
  notes?: Highlights;
  mode: Mode;
  go: (hash: string) => void;
}) {
  const [onlyUndocumented, setOnlyUndocumented] = useState(false);
  const label = useMemo(() => labeler(snap), [snap]);
  const byType = useMemo(() => perksByType(snap), [snap]);

  if (!diffs.length)
    return (
      <div class="notes">
        <h2>Game data diff</h2>
        <p>No comparisons yet. This page lists every change between two extracted game builds, including changes the patch notes don't mention.</p>
        <p class="muted">
          It needs at least two snapshots in <code>data/</code>: run <code>uv run extractor/build.py</code> before and after a game update, then{" "}
          <code>uv run extractor/diff.py</code>.
        </p>
      </div>
    );
  if (!diff) return <p class="muted note">Pick a comparison in the header.</p>;

  const documented = (key: string) => {
    if (!notes) return false;
    const keys = entityKeys(snap, key, byType);
    if (key.startsWith("variant:")) keys.push(`weapon:${key.slice(8).split("/")[0]}`);
    if (key.startsWith("weapon:")) {
      const wid = key.slice(7);
      for (const k of notes.keys()) if (k.startsWith(`variant:${wid}/`)) keys.push(k);
    }
    return keys.some((k) => notes.has(k));
  };

  const rows = Object.entries(diff.entities)
    .map(([key, changes]) => ({
      key,
      lines: describeAll(changes, key).filter((l) => l.mode === "both" || l.mode === mode),
      tooltip: changes.find((c) => c.kind === "tooltip") as { old?: { parts: DescPart[] }; new?: { parts: DescPart[] } } | undefined,
      doc: documented(key),
    }))
    .filter((r) => r.lines.length || r.tooltip)
    // A perk's tooltip changes (perk:<id>) and game-logic changes (perkType:<type>) arrive as two
    // entities; merge them into one card when the type belongs to exactly one perk.
    .reduce<{ key: string; lines: Line[]; tooltip?: { old?: { parts: DescPart[] }; new?: { parts: DescPart[] } }; doc: boolean }[]>((acc, r) => {
      const perks = r.key.startsWith("perkType:") ? byType.get(r.key.slice(9)) ?? [] : [];
      const key = perks.length === 1 ? `perk:${perks[0].id}` : r.key;
      const prev = acc.find((x) => x.key === key);
      if (prev) {
        prev.lines.push(...r.lines);
        prev.tooltip ??= r.tooltip;
        prev.doc ||= r.doc;
      } else acc.push({ ...r, key, lines: [...r.lines] });
      return acc;
    }, [])
    .filter((r) => !onlyUndocumented || !r.doc);

  // The perk's own in-game description is often the best explanation of its raw values.
  const perkFor = (key: string): Perk | undefined => {
    if (key.startsWith("perkType:")) return byType.get(key.slice(9))?.[0];
    if (key.startsWith("perk:")) for (const ps of byType.values()) for (const p of ps) if (p.id === key.slice(5)) return p;
    return undefined;
  };

  const labelFor = (key: string) => {
    if (key.startsWith("perkType:")) {
      const perks = byType.get(key.slice(9)) ?? [];
      const first = perks[0] ? label(`perk:${perks[0].id}`) : { label: key.slice(9) };
      return { ...first, label: perks.length > 1 ? `${perks[0].name} (perk used by ${perks.length} perk slots)` : first.label };
    }
    return label(key);
  };
  const hrefKey = (key: string) => entityKeys(snap, key, byType)[0] ?? key;
  const ownerOf = (key: string): Owner => owners(snap, byType, key);
  const preview = useChipPreview(snap);

  return (
    <article class="notes">
      <header class="notes-head">
        <h2>
          Game data {diff.from} → {diff.to}
        </h2>
        <label class="muted">
          <input type="checkbox" checked={onlyUndocumented} onChange={(e) => setOnlyUndocumented((e.target as HTMLInputElement).checked)} /> only changes
          missing from the selected patch notes
        </label>
      </header>
      <p class="muted">
        {rows.length} changed items ({mode.toUpperCase()} view). Items marked <span class="badge doc">in notes</span> are mentioned in the selected patch
        notes; the rest are <span class="badge undoc">not in notes</span>.
      </p>
      {groupByOwner(rows, ownerOf).map((g) => (
        <details class="owner-group" key={g.owner.id} open={g.rows.length <= 6 || rows.length <= 12}>
          <summary>
            <Icon class="owner-icon" name={g.owner.icon} alt="" />
            <span class="owner-name">{g.owner.name}</span>
            <span class="muted">
              {g.rows.length} changed {g.rows.length === 1 ? "item" : "items"}
              {g.undocumented > 0 && ` · ${g.undocumented} not in notes`}
            </span>
          </summary>
          {g.rows.map(({ key, lines, tooltip, doc }) => {
            const l = labelFor(key);
            const href = hrefFor(snap, hrefKey(key));
            return (
              <div class="diff-entity" key={key}>
                <button type="button" class="chip" disabled={!href} onClick={() => href && go(href)} {...preview.bind(hrefKey(key))}>
                  <Icon class="chip-icon" name={l.icon} alt="" />
                  {l.label}
                </button>
                <span class={`badge ${doc ? "doc" : "undoc"}`}>{doc ? "in notes" : "not in notes"}</span>
                {tooltip ? (
                  <TooltipDiff old={tooltip.old} new={tooltip.new} />
                ) : (
                  (() => {
                    const p = perkFor(key);
                    return p?.desc ? (
                      <p class="diff-desc">
                        <Desc parts={p.desc.parts} />
                      </p>
                    ) : null;
                  })()
                )}
                {lines.length > 0 && <GroupedChanges rows={lines} />}
              </div>
            );
          })}
        </details>
      ))}
      {preview.popover}
    </article>
  );
}

export interface Owner {
  id: string;
  name: string;
  icon?: string | null;
  /** Sort position: classes in armory order, then weapons A-Z, then shared. */
  order: number;
}

/** The class or weapon an entity belongs to (shared perk types get their own group). */
export function owners(snap: Snapshot, byType: Map<string, Perk[]>, key: string): Owner {
  const classOf = new Map<string, number>();
  snap.classes.classes.forEach((c, i) => {
    for (const p of [...c.pve.base, ...c.pvp.base, ...c.pve.columns.flatMap((x) => x.slots.flatMap((s) => s.perks)), ...c.pve.team.flatMap((s) => s.perks), ...c.pve.prestige.flatMap((s) => s.perks)])
      classOf.set(p.id, i);
  });
  const weapons = [...snap.weapons.weapons].sort((a, b) => a.name.localeCompare(b.name));
  const weaponOf = new Map<string, number>();
  weapons.forEach((w, i) => {
    for (const p of [...w.tiers.flatMap((t) => t.layers.flat()), ...w.heroic]) weaponOf.set(p.id, i);
  });
  const cls = (i: number): Owner => {
    const c = snap.classes.classes[i];
    return { id: `class:${c.id}`, name: c.name, icon: c.icon, order: i };
  };
  const wpn = (i: number): Owner => ({ id: `weapon:${weapons[i].id}`, name: weapons[i].name, icon: weapons[i].icon, order: 100 + i });
  const shared: Owner = { id: "shared", name: "Shared perks (used by several classes or weapons)", order: 1000 };

  const [kind, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "weapon" || kind === "variant") {
    const i = weapons.findIndex((w) => w.id === rest.split("/")[0]);
    return i >= 0 ? wpn(i) : shared;
  }
  const perkIds = kind === "perkType" ? (byType.get(rest) ?? []).map((p) => p.id) : [rest];
  const found = new Set(perkIds.map((id) => (classOf.has(id) ? `c${classOf.get(id)}` : weaponOf.has(id) ? `w${weaponOf.get(id)}` : "?")));
  if (found.size !== 1) return shared;
  const only = [...found][0];
  if (only.startsWith("c")) return cls(Number(only.slice(1)));
  if (only.startsWith("w")) return wpn(Number(only.slice(1)));
  return shared;
}

export function groupByOwner<R extends { key: string; doc: boolean }>(rows: R[], ownerOf: (key: string) => Owner) {
  const groups = new Map<string, { owner: Owner; rows: R[]; undocumented: number }>();
  for (const r of rows) {
    const o = ownerOf(r.key);
    const g = groups.get(o.id) ?? { owner: o, rows: [], undocumented: 0 };
    g.rows.push(r);
    if (!r.doc) g.undocumented++;
    groups.set(o.id, g);
  }
  return [...groups.values()].sort((a, b) => a.owner.order - b.owner.order);
}
