import type { ComponentChildren } from "preact";
import { iconUrl, type DescPart, type Perk } from "./data";
import type { Change, ChangeRow, Mode } from "./changes";
import { lowerIsBetter } from "./glossary";

export function Icon({ name, alt, class: cls }: { name?: string | null; alt: string; class?: string }) {
  const src = iconUrl(name);
  return src ? <img class={cls} src={src} alt={alt} loading="lazy" /> : <span class={`${cls ?? ""} icon-missing`} aria-hidden="true" />;
}

export function Desc({ parts }: { parts: DescPart[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if ("enemy" in p) return <Icon key={i} class="inline-icon" name={`icn_${p.enemy.toLowerCase()}`} alt={p.enemy} />;
        if ("v" in p)
          return (
            <span key={i} class={`val ${p.kind === "POSITIVE" ? "pos" : p.kind === "NEGATIVE" ? "neg" : ""} ${p.missing ? "missing" : ""}`}>
              {p.v}
            </span>
          );
        if ("tag" in p) return <span key={i} class={`tag tag-${p.tag}`}>{p.t}</span>;
        return <span key={i}>{p.t}</span>;
      })}
    </>
  );
}

const EFFECT_LABEL: Record<string, string> = {
  buff: "Buff",
  nerf: "Nerf",
  fixed: "Fix",
  replaced: "Replaced",
  added: "New",
  removed: "Removed",
  changed: "Changed",
};

export function effectOf(changes: Change[] | undefined): string | undefined {
  if (!changes?.length) return undefined;
  const effects = new Set(changes.map((c) => c.effect));
  return effects.size === 1 ? [...effects][0] : "changed";
}

export function ChangeList({ changes, mode }: { changes?: Change[]; mode: Mode }) {
  if (!changes?.length) return null;
  return (
    <ul class="change-list">
      {changes.map((c) => (
        <li key={c.id} class={`effect-${c.effect} ${c.mode !== "both" && c.mode !== mode ? "other-mode" : ""}`}>
          <span class="badge">{EFFECT_LABEL[c.effect]}</span>
          {c.mode !== "both" && <span class="badge mode">{c.mode.toUpperCase()}</span>}
          <span class="change-src">{c.source}</span>
          <div>{c.text}</div>
        </li>
      ))}
    </ul>
  );
}

/** Data changes as an Item | Old | New | Change table, with a Part column when rows belong to parts. */
export function GroupedChanges({ rows }: { rows: (ChangeRow & { effect: string })[] }) {
  const grouped = rows.some((r) => r.group);
  // General rows first, then by part, keeping order within a part.
  const sorted = grouped ? [...rows].sort((a, b) => (a.group ? 1 : 0) - (b.group ? 1 : 0) || (a.group ?? "").localeCompare(b.group ?? "")) : rows;
  const span = new Map<number, number>();
  sorted.forEach((r, i) => {
    if (i === 0 || sorted[i - 1].group !== r.group) span.set(i, sorted.filter((x) => x.group === r.group).length);
  });
  const hasPct = rows.some((r) => r.pct !== undefined);
  const pct = (p?: number) => (p === undefined ? "" : `${p > 0 ? "+" : ""}${Math.round(p * 10) / 10}%`);
  return (
    <div class="table-scroll">
      <table class="grouped-changes">
        <thead>
          <tr>
            {grouped && <th>Part</th>}
            <th class="item-h">Item</th>
            <th>Old</th>
            <th>New</th>
            {hasPct && <th>Change</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} class={`effect-${r.effect}`}>
              {grouped && span.has(i) && (
                <th rowSpan={span.get(i)} class="part">
                  {r.group ?? "General"}
                </th>
              )}
              <td class="item">
                {r.item}
                {r.note && <div class="muted small">{r.note}</div>}
              </td>
              <td class={`old ${r.old.length > 24 ? "long" : ""}`}>{r.old}</td>
              <td class={`new ${r.new.length > 24 ? "long" : ""}`}>{r.new}</td>
              {hasPct && (
                <td class={`pct ${r.pct === undefined ? "" : (r.pct > 0) !== lowerIsBetter(r.item) ? "up" : "down"}`}>{pct(r.pct)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Patch-note changes as cards, game-data changes as a grouped table (collapsed when long). */
export function EntityChanges({ changes, mode }: { changes?: Change[]; mode: Mode }) {
  if (!changes?.length) return null;
  const notes = changes.filter((c) => !c.fromData);
  const data = changes.filter((c) => c.fromData);
  const groups = new Set(data.map((c) => c.row?.group ?? "")).size;
  return (
    <section class="entity-changes">
      {notes.length > 0 && (
        <>
          <h2>Patch notes</h2>
          <ChangeList changes={notes} mode={mode} />
        </>
      )}
      {data.length > 0 && (
        <details class="data-changes" open={data.length <= 8}>
          <summary>
            <h2>
              Game data · {data.length} change{data.length === 1 ? "" : "s"}
              {groups > 1 ? ` in ${groups} parts` : ""}
            </h2>
            <span class="change-src">{data[0].source}</span>
          </summary>
          <GroupedChanges rows={data.map((c) => ({ ...(c.row ?? { item: c.text, old: "", new: "" }), effect: c.effect }))} />
        </details>
      )}
    </section>
  );
}

export function PerkTile({
  perk,
  shape,
  level,
  selected,
  changes,
  onSelect,
}: {
  perk: Perk;
  shape: "hex" | "square";
  level?: number;
  selected?: boolean;
  changes?: Change[];
  onSelect: (p: Perk) => void;
}) {
  const effect = effectOf(changes);
  return (
    <button
      type="button"
      class={`tile ${shape} ${selected ? "selected" : ""} ${effect ? `hl effect-${effect}` : ""} ${perk.textIssue ? "issue" : ""}`}
      title={perk.name ?? perk.id}
      onClick={() => onSelect(perk)}
      onMouseEnter={() => onSelect(perk)}
      onFocus={() => onSelect(perk)}
    >
      <span class="tile-face">
        <Icon name={perk.icon} alt="" />
      </span>
      {level !== undefined && <span class="tile-level">{level}</span>}
      {effect && <span class="tile-flag" aria-label={EFFECT_LABEL[effect]} />}
    </button>
  );
}

export function PerkCard({
  perk,
  context,
  changes,
  mode,
}: {
  perk?: Perk;
  context?: ComponentChildren;
  changes?: Change[];
  mode: Mode;
}) {
  if (!perk) return <aside class="card empty">Hover or tap a perk to see its details.</aside>;
  return (
    <aside class="card">
      <header class="card-head">
        <Icon class="card-icon" name={perk.icon} alt="" />
        <div>
          <h3>{perk.name ?? perk.id}</h3>
          {context && <div class="card-context">{context}</div>}
        </div>
      </header>
      {perk.desc ? (
        <p class="card-desc">
          <Desc parts={perk.desc.parts} />
        </p>
      ) : (
        <p class="card-desc muted">No description.</p>
      )}
      {perk.textIssue && (
        <p class="warn">
          ⚠ {perk.textIssue.kind === "brokenKey" ? "The game shows broken text for this perk." : "Text missing in game."}{" "}
          <span class="muted">{perk.textIssue.note}</span>
        </p>
      )}
      <EntityChanges changes={changes} mode={mode} />
      <details class="card-debug">
        <summary>Game data ids</summary>
        <code>{perk.type}</code>
        {perk.id !== perk.type && <code>{perk.id}</code>}
        {perk.nameKey && <code>{perk.nameKey}</code>}
      </details>
    </aside>
  );
}
