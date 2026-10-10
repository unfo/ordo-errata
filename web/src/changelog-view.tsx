import { useEffect, useState } from "preact/hooks";
import type { Snapshot } from "./data";
import type { Mode } from "./changes";
import { hrefFor, resolveChangelog, type Aliases, type ParsedChangelog } from "./changelog";
import { Icon } from "./components";
import aliases from "../../changelogs/aliases.json";

const sources = import.meta.glob<string>("../../changelogs/*.md", { query: "?raw", import: "default" });

/** Changelog files, newest version first (by file name, e.g. "15.1-hotfix"). */
export const changelogs = Object.keys(sources)
  .map((path) => {
    const id = path.split("/").pop()!.replace(/\.md$/, "");
    const [version, kind = ""] = id.split("-");
    return { id, path, title: `${kind ? kind[0].toUpperCase() + kind.slice(1) : "Notes"} ${version}` };
  })
  .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));

export function useHighlights(snap: Snapshot | undefined, logId: string) {
  const [parsed, setParsed] = useState<ParsedChangelog>();
  useEffect(() => {
    const entry = changelogs.find((c) => c.id === logId);
    if (!snap || !entry) {
      setParsed(undefined);
      return;
    }
    let live = true;
    sources[entry.path]().then((md) => {
      if (live) setParsed(resolveChangelog(entry.id, md, snap, aliases as unknown as Aliases));
    });
    return () => {
      live = false;
    };
  }, [snap, logId]);
  return { parsed, highlights: parsed?.highlights };
}

export function ChangelogView({
  snap,
  parsed,
  mode,
  go,
}: {
  snap: Snapshot;
  parsed?: ParsedChangelog;
  mode: Mode;
  go: (hash: string) => void;
}) {
  if (!parsed) return <p class="muted note">Pick patch notes in the header to see what changed.</p>;

  let lastSection = "";
  return (
    <article class="notes">
      <header class="notes-head">
        <h2>{parsed.title}</h2>
        {parsed.source ? (
          <a href={parsed.source} target="_blank" rel="noopener noreferrer">
            Official post ↗
          </a>
        ) : (
          <span class="muted">No official source link recorded.</span>
        )}
      </header>
      <p class="muted">
        Linked items show the game's icon. Click one to jump to it in the perk tree or weapon view. Lines for the other game mode ({mode === "pve" ? "PvP" : "PvE"}) are dimmed.
      </p>
      {parsed.items.map((r) => {
        const sec = r.item.section.join(" › ");
        const head = sec !== lastSection ? <h3 class="notes-section">{sec}</h3> : null;
        lastSection = sec;
        const other = r.mode !== "both" && r.mode !== mode;
        return (
          <div key={r.item.id}>
            {head}
            <div class={`note-line kind-${r.item.kind} depth-${r.item.depth} ${other ? "other-mode" : ""} ${r.keys.length && r.item.kind !== "note" ? `effect-${r.effect}` : ""}`}>
              <div class="note-text">
                {r.item.kind === "note" ? <em>{r.item.ownText}</em> : r.item.ownText}
                {r.mode !== "both" && <span class="badge mode">{r.mode.toUpperCase()}</span>}
              </div>
              {r.labels.length > 0 && (
                <div class="chips">
                  {r.labels.map((l) => {
                    const href = hrefFor(snap, l.key);
                    return (
                      <button type="button" key={l.key} class="chip" disabled={!href} onClick={() => href && go(href)}>
                        <Icon class="chip-icon" name={l.icon} alt="" />
                        {l.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {parsed.unmatched.length > 0 && (
        <details class="unmatched">
          <summary>{parsed.unmatched.length} highlighted names not found in the current game data</summary>
          <p class="muted">
            Usually perks removed by this patch, cosmetics, penances or stratagems, which this tool doesn't track yet. If a perk or weapon is missing here, add an alias to <code>changelogs/aliases.json</code>.
          </p>
          <ul>
            {parsed.unmatched.map((u, i) => (
              <li key={i}>
                {u.name} <span class="muted">({u.section.join(" › ")})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
