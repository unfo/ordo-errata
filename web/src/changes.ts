// Changes attached to game entities. Filled by the changelog parser (changelog.ts).

export type Mode = "pve" | "pvp";
export type ChangeMode = Mode | "both";
export type Effect = "buff" | "nerf" | "fixed" | "replaced" | "added" | "removed" | "changed";

export interface Change {
  id: string;
  /** Changelog this came from, e.g. "Hotfix 15.1". */
  source: string;
  /** Heading path inside the changelog. */
  section: string[];
  text: string;
  mode: ChangeMode;
  effect: Effect;
}

/** Changes keyed by entity: "class:SOLDIER", "perk:<perk id>", "weapon:<id>", "variant:<weapon>/<id>". */
export type Highlights = Map<string, Change[]>;

export const emptyHighlights: Highlights = new Map();

export function forMode(changes: Change[] | undefined, mode: Mode): Change[] | undefined {
  const out = changes?.filter((c) => c.mode === "both" || c.mode === mode);
  return out?.length ? out : undefined;
}
