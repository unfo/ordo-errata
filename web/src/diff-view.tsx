import { useEffect, useMemo, useState } from "preact/hooks";
import type { Perk, Snapshot } from "./data";
import type { Change, ChangeMode, Effect, Highlights, Mode } from "./changes";
import { hrefFor, labeler } from "./changelog";
import { Desc, GroupedChanges, Icon } from "./components";
import { APPLY_TYPES, humanize } from "./glossary";

export interface DiffChange {
  kind: "added" | "removed" | "field" | "moved" | "stat" | "value";
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
  text: string;
  mode: ChangeMode;
  effect: Effect;
  group?: string;
  detail?: string;
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

/** One readable line per change; the type/applyType/bonus fields of a modifier become one line. */
export function describeAll(changes: DiffChange[]): Line[] {
  const lines: Line[] = [];
  const mods = new Map<string, { type: string; mode: ChangeMode; fields: Record<string, DiffChange> }>();
  // A description that differs only in its numbers repeats the "Values" line; skip it.
  const numbersOnly = (c: DiffChange) => {
    const strip = (x: unknown) => String(x ?? "").replace(/\d+(\.\d+)?/g, "#");
    return c.kind === "field" && c.field === "description" && strip(c.old) === strip(c.new) && changes.some((o) => o.field === "values");
  };
  for (const c of changes) {
    if (numbersOnly(c)) continue;
    const m = c.kind === "value" ? c.field!.match(MODIFIER) : null;
    if (m) {
      const key = `${m[1]}[${m[2]}]`;
      const g = mods.get(key) ?? { type: m[2], mode: changeMode(c), fields: {} };
      g.fields[m[3]] = c;
      mods.set(key, g);
    } else {
      const group = c.kind === "value" ? groupOf(c.field!) : undefined;
      const text = describe(c);
      // The group already names the attack; describe the rest of the path without it.
      const detail = group ? describe({ ...c, field: c.field!.replace(/(strikeSettings)\.[^.[]+\./, "$1.") }).replace(/^(PvE|PvP) · /, "") : undefined;
      lines.push({ text, mode: changeMode(c), effect: effectOf(c), group, detail });
    }
  }
  for (const g of mods.values()) {
    const val = (side: "old" | "new") => {
      const bonus = g.fields.bonus?.[side] ?? (g.fields.bonus ? undefined : null);
      const apply = String(g.fields.applyType?.[side] ?? "");
      if (bonus === undefined || bonus === null) return undefined;
      const a = APPLY_TYPES[apply];
      const n = Number(bonus);
      return `${n > 0 && a?.unit ? "+" : ""}${n}${a?.unit ?? ""}`;
    };
    const old = val("old");
    const nu = val("new");
    const apply = String(g.fields.applyType?.new ?? g.fields.applyType?.old ?? "");
    const note = APPLY_TYPES[apply]?.note;
    const name = humanize(g.type);
    let text: string;
    if (old === undefined && nu !== undefined) text = `New modifier: ${name} ${nu}`;
    else if (nu === undefined && old !== undefined) text = `Modifier removed: ${name} ${old}`;
    else text = `${name}: ${old ?? "?"} → ${nu ?? "?"}`;
    lines.push({ text: note ? `${text} (${note})` : text, mode: g.mode, effect: old === undefined ? "added" : nu === undefined ? "removed" : "changed" });
  }
  return lines;
}

export function describe(c: DiffChange): string {
  const v = (x: unknown) =>
    Array.isArray(x) ? x.join(", ") : x === undefined || x === null ? "—" : typeof x === "string" && /^[A-Z][A-Z0-9_]+$/.test(x) ? humanize(x) : String(x);
  switch (c.kind) {
    case "added":
      return `Added${c.where ? ` (${c.where})` : ""}`;
    case "removed":
      return `Removed${c.where ? ` (was ${c.where})` : ""}`;
    case "moved":
      return `Moved: ${v(c.old)} → ${v(c.new)}`;
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
    if (m) return [mode, ...context.slice(-1), typeof label === "string" ? label : label(m)].filter(Boolean).join(" · ");
  }
  const keep = rest.filter((p, i) => i >= rest.length - 2 || /^[a-z_0-9]+$/.test(p));
  return [mode, ...keep.map(humanizeSegment)].filter(Boolean).join(" · ");
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
    for (const [i, line] of describeAll(changes).entries()) {
      const change: Change = {
        id: `${source}:${key}:${i}`,
        source,
        section: [],
        text: line.group ? `${line.group} · ${line.detail}` : line.text,
        mode: line.mode,
        effect: line.effect,
        fromData: true,
        group: line.group,
        detail: line.detail,
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
    .map(([key, changes]) => ({ key, lines: describeAll(changes).filter((l) => l.mode === "both" || l.mode === mode), doc: documented(key) }))
    .filter((r) => r.lines.length && (!onlyUndocumented || !r.doc));

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
      {rows.map(({ key, lines, doc }) => {
        const l = labelFor(key);
        const href = hrefFor(snap, hrefKey(key));
        return (
          <div class="diff-entity" key={key}>
            <button type="button" class="chip" disabled={!href} onClick={() => href && go(href)}>
              <Icon class="chip-icon" name={l.icon} alt="" />
              {l.label}
            </button>
            <span class={`badge ${doc ? "doc" : "undoc"}`}>{doc ? "in notes" : "not in notes"}</span>
            {(() => {
              const p = perkFor(key);
              return p?.desc ? (
                <p class="diff-desc">
                  <Desc parts={p.desc.parts} />
                </p>
              ) : null;
            })()}
            <GroupedChanges items={lines} />
          </div>
        );
      })}
    </article>
  );
}
