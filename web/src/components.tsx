import type { ComponentChildren } from "preact";
import { iconUrl, type DescPart, type Perk } from "./data";
import type { Change, Mode } from "./changes";

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

/** Changes laid out as a compact table, one row per group (e.g. per melee attack). */
export function GroupedChanges({ items }: { items: { text: string; effect: string; group?: string; detail?: string }[] }) {
  const groups = new Map<string, typeof items>();
  for (const it of items) groups.set(it.group ?? "", [...(groups.get(it.group ?? "") ?? []), it]);
  if (groups.size === 1 && groups.has(""))
    return (
      <ul class="plain-changes">
        {items.map((it, i) => (
          <li key={i} class={`effect-${it.effect}`}>
            {it.text}
          </li>
        ))}
      </ul>
    );
  return (
    <table class="grouped-changes">
      <tbody>
        {[...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0)).map(([g, list]) => (
          <tr key={g}>
            <th>{g || "General"}</th>
            <td>
              <ul>
                {list.map((it, i) => (
                  <li key={i} class={`effect-${it.effect}`}>
                    {it.group ? it.detail : it.text}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Patch-note changes as cards, game-data changes as a grouped table (collapsed when long). */
export function EntityChanges({ changes, mode }: { changes?: Change[]; mode: Mode }) {
  if (!changes?.length) return null;
  const notes = changes.filter((c) => !c.fromData);
  const data = changes.filter((c) => c.fromData);
  const groups = new Set(data.map((c) => c.group ?? "")).size;
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
          <GroupedChanges items={data.map((c) => ({ text: c.text, effect: c.effect, group: c.group, detail: c.detail }))} />
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
