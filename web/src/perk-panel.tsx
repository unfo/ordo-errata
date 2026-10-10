import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import type { Perk } from "./data";
import type { Change, Mode } from "./changes";
import { PerkCard } from "./components";

export interface PanelEntry {
  perk: Perk;
  ctx: string;
}

/** Hover preview plus any number of pinned perk cards (click a perk to pin/unpin it). */
export function usePerkPanel() {
  const [hover, setHover] = useState<PanelEntry>();
  const [pins, setPins] = useState<PanelEntry[]>([]);
  const isPinned = (id: string) => pins.some((p) => p.perk.id === id);
  const togglePin = (e: PanelEntry) => setPins((ps) => (ps.some((p) => p.perk.id === e.perk.id) ? ps.filter((p) => p.perk.id !== e.perk.id) : [e, ...ps]));
  const unpin = (id: string) => setPins((ps) => ps.filter((p) => p.perk.id !== id));
  return { hover, setHover, pins, togglePin, unpin, isPinned, clear: () => setPins([]) };
}

export type PerkPanelState = ReturnType<typeof usePerkPanel>;

export function PerkPanel({
  panel,
  changesFor,
  mode,
}: {
  panel: PerkPanelState;
  changesFor: (p: Perk) => Change[] | undefined;
  mode: Mode;
}) {
  const { hover, pins, unpin, isPinned, clear } = panel;
  const preview = hover && !isPinned(hover.perk.id) ? hover : undefined;
  return (
    <aside class="perk-panel">
      {preview ? (
        <PerkCard perk={preview.perk} context={preview.ctx} changes={changesFor(preview.perk)} mode={mode} />
      ) : (
        !pins.length && <div class="card empty">Hover a perk to preview it. Click a perk to pin its card here; pinned cards stay until you click the perk or × again.</div>
      )}
      {pins.length > 0 && (
        <div class="pins-head">
          <span>
            {pins.length} pinned {pins.length === 1 ? "perk" : "perks"}
          </span>
          {pins.length > 1 && (
            <button type="button" class="link" onClick={clear}>
              unpin all
            </button>
          )}
        </div>
      )}
      {pins.map((p) => (
        <div class="pinned" data-pin-id={p.perk.id} key={p.perk.id}>
          <button type="button" class="unpin" aria-label={`Unpin ${p.perk.name ?? p.perk.id}`} title="Unpin" onClick={() => unpin(p.perk.id)}>
            ×
          </button>
          <PerkCard perk={p.perk} context={p.ctx} changes={changesFor(p.perk)} mode={mode} />
        </div>
      ))}
    </aside>
  );
}

interface Line {
  id: string;
  d: string;
}

/**
 * Curves from each pinned card to its perk tile. Drawn in an SVG layer over the container and
 * recomputed on scroll/resize. Hidden when the panel isn't beside the tree (narrow screens).
 */
export function LeaderLines({ container, ids }: { container: RefObject<HTMLElement>; ids: string[] }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = root.getBoundingClientRect();
        const out: Line[] = [];
        for (const id of ids) {
          const sel = (attr: string) => root.querySelector<HTMLElement>(`[${attr}="${CSS.escape(id)}"]`);
          const tile = sel("data-perk-id");
          const card = sel("data-pin-id");
          if (!tile || !card) continue;
          const t = tile.getBoundingClientRect();
          const c = card.getBoundingClientRect();
          if (c.left < t.right + 20) continue; // panel is not to the right (narrow layout)
          const panel = card.closest(".perk-panel")?.getBoundingClientRect();
          if (panel && (c.bottom < panel.top + 20 || c.top > panel.bottom - 20)) continue; // scrolled out of the panel
          const x1 = t.right - box.left;
          const y1 = t.top + t.height / 2 - box.top;
          const x2 = c.left - box.left;
          const y2 = Math.min(Math.max(c.top + 28, t.top), c.bottom - 12) - box.top; // aim at the card's header area
          const mid = (x1 + x2) / 2;
          out.push({ id, d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` });
        }
        setLines(out);
        setSize({ w: root.scrollWidth, h: root.scrollHeight });
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    addEventListener("scroll", measure, true); // capture: also catches the panel's own scrolling
    addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      removeEventListener("scroll", measure, true);
      removeEventListener("resize", measure);
    };
  }, [container, ids.join("|")]);

  // Re-measure once more after cards render their content.
  useEffect(() => {
    const t = setTimeout(() => dispatchEvent(new Event("resize")), 50);
    return () => clearTimeout(t);
  }, [ids.join("|")]);

  if (!lines.length) return null;
  return (
    <svg class="leader-lines" width={size.w} height={size.h} aria-hidden="true">
      {lines.map((l) => (
        <g key={l.id}>
          <path d={l.d} class="leader" />
          <circle cx={Number(l.d.split(" ")[1])} cy={Number(l.d.split(" ")[2])} r="3" class="leader-dot" />
        </g>
      ))}
    </svg>
  );
}
