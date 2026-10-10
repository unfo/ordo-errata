// Parses patch-notes markdown and links each line to game entities from the names index.

import { normalizeName, type NameRef, type Snapshot } from "./data";
import type { Change, ChangeMode, Effect, Highlights } from "./changes";

export interface Item {
  id: string;
  section: string[];
  /** Markdown-free text. Nested bullets are prefixed with their parent's text. */
  text: string;
  /** Text of the line itself (without the parent prefix). */
  ownText: string;
  depth: number;
  kind: "bullet" | "text" | "note";
  emphasized: string[];
}

export interface Resolved {
  item: Item;
  mode: ChangeMode;
  effect: Effect;
  keys: string[]; // highlight keys, e.g. "perk:<id>"
  labels: { key: string; label: string; icon?: string | null }[];
  unmatched: string[]; // emphasized spans that look like names but matched nothing
}

export interface ParsedChangelog {
  id: string;
  title: string;
  source?: string;
  items: Resolved[];
  highlights: Highlights;
  unmatched: { name: string; section: string[] }[];
}

export type Aliases = Record<string, NameRef[]>;

// ---------------------------------------------------------------- markdown

const EMPH = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g;

export function stripMd(s: string): string {
  return s
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function emphasized(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(EMPH)) {
    const t = stripMd(m[1] ?? m[2] ?? m[3] ?? "").replace(/[:’'.,]+$/, "").trim();
    if (t) out.push(t);
  }
  return out;
}

/** Splits front matter (`---\nkey: value\n---`) from the body. */
export function frontMatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: md.slice(m[0].length) };
}

export function parseMarkdown(md: string): { title: string; items: Item[] } {
  let title = "";
  const section: string[] = []; // index = heading level - 2 (## -> 0, ### -> 1, bold line -> 2)
  const items: Item[] = [];
  const parents: { indent: number; text: string }[] = [];
  let n = 0;

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;

    const h = line.match(/^(#{1,6})\s*(.*)$/);
    if (h) {
      const text = stripMd(h[2]);
      const level = h[1].length;
      if (level === 1) {
        title = text;
        continue;
      }
      if (!text) continue; // empty "###" lines
      section.length = Math.max(0, level - 2);
      section[level - 2] = text;
      parents.length = 0;
      continue;
    }

    // A line that is only bold text acts as a sub-heading (e.g. "**Melta Rifle**").
    const boldOnly = line.trim().match(/^\*\*([^*]+)\*\*$/);
    if (boldOnly) {
      section.length = Math.min(section.length, 2);
      while (section.length < 2) section.push("");
      section[2] = stripMd(boldOnly[1]);
      parents.length = 0;
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const text = stripMd(quote[1]);
      if (text) items.push(mkItem(text, text, 0, "note", quote[1]));
      continue;
    }

    const bullet = line.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/);
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, "    ").length;
      while (parents.length && parents[parents.length - 1].indent >= indent) parents.pop();
      const own = stripMd(bullet[2]);
      const prefix = parents.map((p) => p.text.replace(/:$/, "")).join(" › ");
      items.push(mkItem(prefix ? `${prefix} › ${own}` : own, own, parents.length, "bullet", bullet[2]));
      parents.push({ indent, text: own });
      continue;
    }

    const text = stripMd(line);
    // A paragraph that is entirely italic is a developer comment, like a blockquote.
    const italicOnly = /^\s*\*[^*].*[^*]\*\s*$/.test(line) && !line.includes("**");
    if (text) items.push(mkItem(text, text, 0, italicOnly ? "note" : "text", line));
  }
  return { title, items };

  function mkItem(text: string, ownText: string, depth: number, kind: Item["kind"], raw: string): Item {
    return { id: `i${n++}`, section: section.filter(Boolean), text, ownText, depth, kind, emphasized: emphasized(raw) };
  }
}

// ---------------------------------------------------------------- classification

export function inferMode(section: string[], text: string): ChangeMode {
  const s = section.join(" ");
  if (/^pvp\b/i.test(text) || /\bpvp\b/i.test(s)) return "pvp";
  if (/^pve\b/i.test(text) || /\bpve\b/i.test(s)) return "pve";
  return "both";
}

export function inferEffect(text: string): Effect {
  const t = text.toLowerCase();
  if (/\bfix(ed|es)?\b/.test(t)) return "fixed";
  if (/\breplaced with\b|\bslot is replaced\b/.test(t)) return "replaced";
  if (/\b(has been|is|are|was|temporar(il)?y) removed\b|\bremoved from\b/.test(t)) return "removed";
  if (/^added\b|\badded\b.*\bnew\b|^new\b/.test(t)) return "added";
  // For these stats a lower number is better.
  const inverted = /\b(cooldown|recharge time|spread|recoil|damage taken|incoming damage|heat)\b/.test(t);
  const up = /\b(increased?|increases|more|faster|greatly improved|improved|boost)\b/.test(t);
  const down = /\b(decreased?|reduced?|reduces|less|slower|lower)\b/.test(t);
  if (up && !down) return inverted ? "nerf" : "buff";
  if (down && !up) return inverted ? "buff" : "nerf";
  return "changed";
}

// ---------------------------------------------------------------- entity resolution

type Scope =
  | { kind: "class"; class: string }
  | { kind: "weapon"; weapon: string; variant?: string }
  | undefined;

interface Index {
  names: Record<string, NameRef[]>;
  snap: Snapshot;
}

function lookup(idx: Index, name: string): NameRef[] {
  const n = normalizeName(name);
  // Tolerate singular/plural slips ("Furious strike" vs "Furious Strikes").
  return idx.names[n] ?? idx.names[`${n}s`] ?? (n.endsWith("s") ? idx.names[n.slice(0, -1)] : undefined) ?? [];
}

/** Variants of a heading/span to try: drop "(...)", "Perks", "Heroic", "version(s)" etc. */
function candidates(name: string): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t) out.add(t);
  };
  add(name);
  const paren = name.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (paren) {
    add(paren[1]);
    add(paren[2]);
  }
  for (const s of [...out]) {
    add(s.replace(/\bperks?\b/gi, ""));
    add(s.replace(/^heroic\b/i, ""));
    add(s.replace(/\b(heroic )?(variant|version)s?\b/gi, ""));
    add(s.replace(/\bheroic\b/gi, "").replace(/\bversion\b/gi, ""));
    if (s.includes(" - ")) s.split(" - ").forEach(add);
  }
  return [...out];
}

function scopeFromSection(idx: Index, section: string[]): Scope {
  for (let i = section.length - 1; i >= 0; i--) {
    for (const cand of candidates(section[i])) {
      const refs = lookup(idx, cand);
      const variant = refs.find((r) => r.kind === "weaponVariant");
      const weapon = refs.find((r) => r.kind === "weapon");
      const cls = refs.find((r) => r.kind === "class");
      if (weapon && weapon.kind === "weapon") {
        // "Heroic X - Variant": prefer the more specific variant when the heading names one.
        for (const c2 of candidates(section[i])) {
          const v = lookup(idx, c2).find((r) => r.kind === "weaponVariant" && r.weapon === weapon.weapon);
          if (v && v.kind === "weaponVariant") return { kind: "weapon", weapon: weapon.weapon, variant: v.variant };
        }
        return { kind: "weapon", weapon: weapon.weapon };
      }
      if (variant && variant.kind === "weaponVariant") {
        const sameWeapon = refs.filter((r) => r.kind === "weaponVariant").every((r) => r.kind === "weaponVariant" && r.weapon === variant.weapon);
        if (sameWeapon) return { kind: "weapon", weapon: variant.weapon, variant: variant.variant };
      }
      if (cls && cls.kind === "class") return { kind: "class", class: cls.class };
    }
  }
  return undefined;
}

function inScope(ref: NameRef, scope: Scope): boolean {
  if (!scope) return false;
  if (scope.kind === "class") return (ref.kind === "classPerk" || ref.kind === "class") && ref.class === scope.class;
  return "weapon" in ref && ref.weapon === scope.weapon;
}

function refKey(ref: NameRef): string {
  switch (ref.kind) {
    case "class":
      return `class:${ref.class}`;
    case "classPerk":
    case "weaponPerk":
    case "heroicPerk":
      return `perk:${ref.perk}`;
    case "weapon":
      return `weapon:${ref.weapon}`;
    case "weaponVariant":
      return `variant:${ref.weapon}/${ref.variant}`;
  }
}

/** Pick refs for a name: scoped matches win; otherwise only unambiguous global matches. */
function pick(refs: NameRef[], scope: Scope, mode: ChangeMode): NameRef[] {
  if (!refs.length) return [];
  const scoped = refs.filter((r) => inScope(r, scope));
  let chosen = scoped.length ? scoped : refs;
  if (mode !== "both") {
    const m = chosen.filter((r) => r.kind !== "classPerk" || r.mode === mode);
    if (m.length) chosen = m;
  }
  if (scoped.length) return chosen;
  // Global: accept if everything points at one owner (one class or one weapon).
  const owners = new Set(chosen.map((r) => ("class" in r ? `c:${r.class}` : `w:${r.weapon}`)));
  return owners.size === 1 ? chosen : [];
}

function scopeKey(scope: Scope): string | undefined {
  if (!scope) return undefined;
  if (scope.kind === "class") return `class:${scope.class}`;
  return scope.variant ? `variant:${scope.weapon}/${scope.variant}` : `weapon:${scope.weapon}`;
}

/** Names of perks/variants that belong to the scope, longest first, for plain-text scanning. */
function scopeNames(idx: Index, scope: Scope): { name: string; refs: NameRef[] }[] {
  if (!scope) return [];
  const out: { name: string; refs: NameRef[] }[] = [];
  for (const [name, refs] of Object.entries(idx.names)) {
    const mine = refs.filter((r) => inScope(r, scope) && r.kind !== "class" && r.kind !== "weapon");
    if (mine.length && name.length >= 4) out.push({ name, refs: mine });
  }
  return out.sort((a, b) => b.name.length - a.name.length);
}

const NOT_NAMES = /^(standard-issue version and all non range-specialized versions|\d.*|.*%.*)$/i;

export function resolveChangelog(
  id: string,
  md: string,
  snap: Snapshot,
  aliases: Aliases = {},
): ParsedChangelog {
  const { meta, body } = frontMatter(md);
  const { title, items } = parseMarkdown(body);
  const names = { ...snap.names };
  for (const [k, v] of Object.entries(aliases)) {
    if (!k.startsWith("_")) names[normalizeName(k)] = [...(names[normalizeName(k)] ?? []), ...v];
  }
  const idx: Index = { names, snap };
  const label = labeler(snap);
  const source = meta.title || title || id;

  const highlights: Highlights = new Map();
  const resolved: Resolved[] = [];
  const unmatched: { name: string; section: string[] }[] = [];
  const scopeNameCache = new Map<string, { name: string; refs: NameRef[] }[]>();

  for (const item of items) {
    const mode = inferMode(item.section, item.ownText);
    const effect = inferEffect(item.ownText);
    const scope = scopeFromSection(idx, item.section);
    const refs: NameRef[] = [];
    const miss: string[] = [];

    for (const span of item.emphasized) {
      if (NOT_NAMES.test(span)) continue;
      let found: NameRef[] = [];
      for (const cand of candidates(span)) {
        found = pick(lookup(idx, cand), scope, mode);
        if (found.length) break;
      }
      // "*Preparedness* and *Brutal Reforge*" style lists, or "A and B" inside one span.
      if (!found.length && /\band\b|,/.test(span)) {
        for (const part of span.split(/\s*(?:,|\band\b)\s*/)) {
          for (const cand of candidates(part)) {
            const f = pick(lookup(idx, cand), scope, mode);
            if (f.length) {
              found.push(...f);
              break;
            }
          }
        }
      }
      // Variant notes like "Master-Crafted - Alpha version" match only inside a weapon scope.
      if (!found.length && scope?.kind === "weapon") {
        const n = normalizeName(span.replace(/\bversions?\b/gi, ""));
        const w = snap.weapons.weapons.find((x) => x.id === scope.weapon);
        const v = w?.variants.filter((x) => n.includes(normalizeName(x.name)));
        if (v?.length) found = v.map((x) => ({ kind: "weaponVariant", weapon: scope.weapon, variant: x.id }) as NameRef);
      }
      if (found.length) refs.push(...found);
      else if (span.split(" ").length <= 6) miss.push(span);
    }

    // Nothing linked yet: scan the text for names of perks/variants that belong to the heading's entity.
    if (!refs.length && scope) {
      const k = scopeKey(scope)!;
      if (!scopeNameCache.has(k)) scopeNameCache.set(k, scopeNames(idx, scope));
      const text = ` ${normalizeName(item.ownText)} `;
      for (const { name, refs: r } of scopeNameCache.get(k)!) {
        if (text.includes(` ${name} `)) {
          refs.push(...r);
          // The span was only part of this longer name (e.g. "Resupply" in "Combat Squad Resupply").
          for (let i = miss.length - 1; i >= 0; i--) if (name.includes(normalizeName(miss[i]))) miss.splice(i, 1);
          break;
        }
      }
    }

    const keys = new Set(refs.map(refKey));
    // Lines under an entity heading always count for that entity too.
    const sk = scopeKey(scope);
    if (sk && (!keys.size || sk.startsWith("variant:"))) keys.add(sk);
    if (scope?.kind === "weapon" && scope.variant && item.kind !== "note") {
      keys.add(`weapon:${scope.weapon}`);
      // Heroic variants carry their own perk; flag its tile too.
      const w = snap.weapons.weapons.find((x) => x.id === scope.weapon);
      for (const h of w?.heroic ?? []) if (h.variant === scope.variant) keys.add(`perk:${h.id}`);
    }

    const r: Resolved = {
      item,
      mode,
      effect: item.kind === "note" ? "changed" : effect,
      keys: [...keys],
      labels: [...keys].map((k) => ({ key: k, ...label(k) })),
      unmatched: miss,
    };
    resolved.push(r);
    unmatched.push(...miss.map((name) => ({ name, section: item.section })));

    if (item.kind === "note") continue; // developer comments are shown in the notes view but don't flag entities
    const change: Change = { id: `${id}:${item.id}`, source, section: item.section, text: item.text, mode, effect: r.effect };
    for (const k of keys) {
      const list = highlights.get(k) ?? [];
      list.push(change);
      highlights.set(k, list);
    }
  }

  return { id, title: source, source: meta.source, items: resolved, highlights, unmatched };
}

/** Human labels and icons for highlight keys. */
export function labeler(snap: Snapshot) {
  const perks = new Map<string, { name: string; icon?: string | null; owner: string }>();
  for (const c of snap.classes.classes) {
    const all = [
      ...c.pve.base,
      ...c.pvp.base,
      ...c.pve.columns.flatMap((x) => x.slots.flatMap((s) => s.perks)),
      ...c.pve.team.flatMap((s) => s.perks),
      ...c.pve.prestige.flatMap((s) => s.perks),
    ];
    for (const p of all) if (p.name) perks.set(p.id, { name: p.name, icon: p.icon, owner: c.name });
  }
  for (const w of snap.weapons.weapons) {
    for (const p of [...w.tiers.flatMap((t) => t.layers.flat()), ...w.heroic]) if (p.name) perks.set(p.id, { name: p.name, icon: p.icon, owner: w.name });
  }
  return (key: string): { label: string; icon?: string | null; href?: string } => {
    const [kind, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (kind === "class") {
      const c = snap.classes.classes.find((x) => x.id === rest);
      return { label: c?.name ?? rest, icon: c?.icon };
    }
    if (kind === "weapon") {
      const w = snap.weapons.weapons.find((x) => x.id === rest);
      return { label: w?.name ?? rest, icon: w?.icon };
    }
    if (kind === "variant") {
      const [wid, vid] = rest.split("/");
      const w = snap.weapons.weapons.find((x) => x.id === wid);
      return { label: `${w?.name ?? wid} · ${w?.variants.find((v) => v.id === vid)?.name ?? vid}`, icon: w?.icon };
    }
    const p = perks.get(rest);
    return { label: p ? `${p.name} (${p.owner})` : rest, icon: p?.icon };
  };
}

/** Where in the app a highlight key lives. */
export function hrefFor(snap: Snapshot, key: string): string | undefined {
  const rest = key.slice(key.indexOf(":") + 1);
  if (key.startsWith("class:")) return `#/class/${rest}`;
  if (key.startsWith("weapon:")) return `#/weapon/${rest}`;
  if (key.startsWith("variant:")) return `#/weapon/${rest.split("/")[0]}`;
  for (const c of snap.classes.classes) {
    const all = [...c.pve.base, ...c.pvp.base, ...c.pve.columns.flatMap((x) => x.slots.flatMap((s) => s.perks)), ...c.pve.team.flatMap((s) => s.perks), ...c.pve.prestige.flatMap((s) => s.perks)];
    if (all.some((p) => p.id === rest)) return `#/class/${c.id}`;
  }
  for (const w of snap.weapons.weapons) {
    if ([...w.tiers.flatMap((t) => t.layers.flat()), ...w.heroic].some((p) => p.id === rest)) return `#/weapon/${w.id}`;
  }
  return undefined;
}
