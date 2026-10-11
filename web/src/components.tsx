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
        if ("enemy" in p) {
          // Tinted with the tier colour like the game does: the icon texture is used as a mask.
          const url = iconUrl(`icn_${p.enemy.toLowerCase()}`);
          return (
            <span
              key={i}
              role="img"
              aria-label={p.enemy}
              class={`inline-icon enemy-icon tag-${p.enemy.toLowerCase()}`}
              style={url ? { maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` } : undefined}
            />
          );
        }
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

type Token = { key: string; part: DescPart; text: string };

/** Split description parts into word-level tokens; values and enemy icons stay whole. */
function tokens(parts: DescPart[]): Token[] {
  const out: Token[] = [];
  for (const p of parts) {
    if ("enemy" in p) out.push({ key: `enemy:${p.enemy}`, part: p, text: "" });
    else if ("v" in p) out.push({ key: `v:${p.v}`, part: p, text: p.v });
    else
      for (const w of p.t.split(/(\s+)/))
        if (w) out.push({ key: `${"tag" in p ? `tag:${p.tag}:` : ""}${w}`, part: "tag" in p ? { tag: p.tag, t: w } : { t: w }, text: w });
  }
  return out;
}

/** Longest common subsequence: which tokens on each side are unchanged. */
function lcsKeep(a: Token[], b: Token[]): [boolean[], boolean[]] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ka = new Array(n).fill(false);
  const kb = new Array(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i].key === b[j].key) {
      ka[i++] = true;
      kb[j++] = true;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return [ka, kb];
}

/** Group tokens into runs of unchanged / changed text; spaces between two changed words join the run. */
function runs(toks: Token[], keep: boolean[]): { changed: boolean; toks: Token[] }[] {
  const changedAt = (i: number) => !keep[i] && (toks[i].text.trim() !== "" || "enemy" in toks[i].part);
  const out: { changed: boolean; toks: Token[] }[] = [];
  toks.forEach((t, i) => {
    let changed = changedAt(i);
    if (!changed && !t.text.trim() && !("enemy" in t.part)) {
      // whitespace: part of a changed run only if changed words sit on both sides
      const prev = out[out.length - 1];
      let j = i + 1;
      while (j < toks.length && !toks[j].text.trim() && !("enemy" in toks[j].part)) j++;
      changed = !!prev?.changed && j < toks.length && changedAt(j);
    }
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.toks.push(t);
    else out.push({ changed, toks: [t] });
  });
  return out;
}

/** Before/after tooltip with removed text struck on the old one and added text marked on the new one. */
export function TooltipDiff({ old, new: nu }: { old?: { parts: DescPart[] } | null; new?: { parts: DescPart[] } | null }) {
  const a = tokens(old?.parts ?? []);
  const b = tokens(nu?.parts ?? []);
  const [ka, kb] = lcsKeep(a, b);
  const words = (toks: Token[]) => toks.filter((t) => t.text.trim()).length || 1;
  const kept = (toks: Token[], keep: boolean[]) => toks.filter((t, i) => keep[i] && t.text.trim()).length;
  // Mostly rewritten text reads better without any marks.
  const rewritten = a.length > 0 && b.length > 0 && Math.min(kept(a, ka) / words(a), kept(b, kb) / words(b)) < 0.3;
  const side = (toks: Token[], keep: boolean[], cls: string) =>
    toks.length ? (
      runs(toks, keep).map((r, i) => {
        const inner = r.toks.map((t, j) => <Desc key={j} parts={[t.part]} />);
        return r.changed && !rewritten ? (
          <span key={i} class={cls}>
            {inner}
          </span>
        ) : (
          <span key={i}>{inner}</span>
        );
      })
    ) : (
      <span class="muted">(no text)</span>
    );
  return (
    <div class="tooltip-diff">
      <div class="tip old">
        <span class="tip-label">{rewritten ? "Before (rewritten)" : "Before"}</span>
        {side(a, ka, "del")}
      </div>
      <div class="tip new">
        <span class="tip-label">After</span>
        {side(b, kb, "ins")}
      </div>
    </div>
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
  const tips = changes.filter((c) => c.tooltip);
  const data = changes.filter((c) => c.fromData && !c.tooltip);
  const groups = new Set(data.map((c) => c.row?.group ?? "")).size;
  return (
    <section class="entity-changes">
      {notes.length > 0 && (
        <>
          <h2>Patch notes</h2>
          <ChangeList changes={notes} mode={mode} />
        </>
      )}
      {tips.map((c) => (
        <div key={c.id}>
          <h2>
            Tooltip <span class="change-src">{c.source}</span>
          </h2>
          <TooltipDiff old={c.tooltip!.old} new={c.tooltip!.new} />
        </div>
      ))}
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
  pinned,
  changes,
  onHover,
  onPin,
}: {
  perk: Perk;
  shape: "hex" | "square";
  level?: number;
  selected?: boolean;
  pinned?: boolean;
  changes?: Change[];
  onHover: (p: Perk) => void;
  onPin: (p: Perk) => void;
}) {
  const effect = effectOf(changes);
  return (
    <button
      type="button"
      data-perk-id={perk.id}
      aria-pressed={pinned}
      class={`tile ${shape} ${selected ? "selected" : ""} ${pinned ? "pinned" : ""} ${effect ? `hl effect-${effect}` : ""} ${perk.textIssue ? "issue" : ""}`}
      title={`${perk.name ?? perk.id}${pinned ? " (pinned, click to unpin)" : " (click to pin)"}`}
      onClick={() => onPin(perk)}
      onMouseEnter={() => onHover(perk)}
      onFocus={() => onHover(perk)}
    >
      <span class="tile-face">
        <Icon name={perk.icon} alt="" />
      </span>
      {level !== undefined && <span class="tile-level">{level}</span>}
      {effect && <span class="tile-flag" aria-label={EFFECT_LABEL[effect]} />}
      {pinned && <span class="tile-pin" aria-hidden="true" />}
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
