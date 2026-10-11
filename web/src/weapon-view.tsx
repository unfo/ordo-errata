import { useRef, useState } from "preact/hooks";
import type { Perk, Weapon, WeaponsFile } from "./data";
import { forMode, type Highlights, type Mode } from "./changes";
import { ChangeList, EntityChanges, effectOf, Icon, PerkTile } from "./components";
import { LeaderLines, PerkPanel, usePerkPanel } from "./perk-panel";
import { displayName } from "./views";
import { specialtyLabel } from "./variant-info";

const TIER_ORDER = ["COMMON", "MASTERCRAFTED", "ARTIFICER", "RELIC", "HEROIC"] as const;

/** Stats in the order the game lists them. Venting weapons show Venting Speed instead of reloading. */
const RANGED_STATS = ["firePower", "accuracy", "fireRate", "reloadingSpeed", "cooling", "chargingSpeed", "piercing", "range", "magazine", "ammoReserve", "headshotMult"];
/** Plain numbers listed under the stat bars in game (not half-point "+" values). */
const PLAIN_STATS = new Set(["magazine", "ammoReserve", "headshotMult"]);
const MELEE_STATS = ["strikePower", "strikeSpeed", "control", "defense"];

/** A stat value as the game shows it: "9+" for half points, "x2.8" headshot, plain ammo counts, defence labels. */
export function formatStat(file: WeaponsFile, k: string, v: unknown): string {
  if (typeof v !== "number") return file.defenseLabels[String(v)] ?? String(v);
  if (k === "headshotMult") return `x${v}`;
  return PLAIN_STATS.has(k) ? String(Math.round(v * 100) / 100) : statText(v);
}

/** The game shows half points as "+" (9.5 -> "9+"). */
export function statText(v: number): string {
  return Number.isInteger(v) ? String(v) : `${Math.floor(v)}+`;
}

function perkChanges(h: Highlights, p: Perk, mode: Mode) {
  return forMode(h.get(`perk:${p.id}`), mode);
}

export function WeaponView({
  file,
  weapon,
  mode,
  highlights,
  compareSiblings = true,
}: {
  file: WeaponsFile;
  weapon: Weapon;
  mode: Mode;
  highlights: Highlights;
  /** Show ▲/▼ against same-tier variants. Off while a data diff is shown, where arrows would read as buffs/nerfs. */
  compareSiblings?: boolean;
}) {
  const [tab, setTab] = useState<"tree" | "versions">("tree");
  const panel = usePerkPanel();
  const root = useRef<HTMLDivElement>(null);
  const variants = weapon.variants.filter((v) => v.tier);
  const [variantId, setVariantId] = useState<string | undefined>();
  const variant = variants.find((v) => v.id === variantId) ?? variants[0];
  const weaponChanges = forMode(highlights.get(`weapon:${weapon.id}`), mode);
  const variantChanges = (id: string) => forMode(highlights.get(`variant:${weapon.id}/${id}`), mode);
  const treeEffect = effectOf([...weapon.tiers.flatMap((t) => t.layers.flat()), ...weapon.heroic].flatMap((p) => perkChanges(highlights, p, mode) ?? []));
  const versionsEffect = effectOf(variants.flatMap((v) => variantChanges(v.id) ?? []));

  const tile = (p: Perk, shape: "hex" | "square", ctx: string, cls = "") => (
    <span class={`wt-cell ${cls}`} key={p.id}>
      <PerkTile
        perk={p}
        shape={shape}
        selected={panel.hover?.perk.id === p.id}
        pinned={panel.isPinned(p.id)}
        changes={perkChanges(highlights, p, mode)}
        onHover={(perk) => panel.setHover({ perk, ctx })}
        onPin={(perk) => panel.togglePin({ perk, ctx })}
      />
    </span>
  );

  const tiers = TIER_ORDER.filter((t) => t === "HEROIC" || weapon.tiers.some((x) => x.id === t));

  return (
    <div class="class-view" ref={root}>
      <div class="tree-area">
        <header class="weapon-head">
          <Icon class="weapon-hero" name={weapon.icon} alt="" />
          <div>
            <h2 class="class-title">{displayName(weapon, [])}</h2>
            {variant && (
              <div class="class-ability">
                {variant.name} · <span class={`tier-text tier-${variant.tier?.toLowerCase()}`}>{file.tierNames[variant.tier!]}</span>
              </div>
            )}
          </div>
        </header>
        <div class="wt-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "versions"} class={`${tab === "versions" ? "on" : ""} ${versionsEffect ? `hl effect-${versionsEffect}` : ""}`} onClick={() => setTab("versions")}>
            Versions
          </button>
          <button type="button" role="tab" aria-selected={tab === "tree"} class={`${tab === "tree" ? "on" : ""} ${treeEffect ? `hl effect-${treeEffect}` : ""}`} onClick={() => setTab("tree")}>
            Perk Tree
          </button>
        </div>

        <div class="wt-scroll">
          <div class="wt-grid">
            {tiers.map((tid) => {
              const tier = weapon.tiers.find((t) => t.id === tid);
              return (
                <section key={tid} class={`wt-tier tier-${tid.toLowerCase()}`}>
                  <header class="wt-tier-head">
                    {tid !== "HEROIC" && <span class="xp">{tier?.requiredExperience ?? 0}</span>}
                    <span class="tier-text">{file.tierNames[tid]}</span>
                  </header>
                  <div class="wt-body">
                    {tab === "tree" ? (
                      tid === "HEROIC" ? (
                        <div class="wt-heroic">
                          {weapon.heroic.map((h) =>
                            tile(h, "square", `Heroic perk · ${weapon.variants.find((v) => v.id === h.variant)?.name ?? h.variant}`, "heroic"),
                          )}
                        </div>
                      ) : (
                        <div class="wt-cols">
                          {tier!.layers.map((layer, ci) => {
                            const main = layer.filter((p) => !p.sub && !p.noUi);
                            const subs = layer.filter((p) => p.sub && !p.noUi);
                            const shape = ci === 0 ? "square" : "hex";
                            const ctx = `${file.tierNames[tid]} perk · column ${ci + 1}`;
                            return (
                              <div class="wt-col" key={ci}>
                                {[1, 2].map((row) => {
                                  const p = main.find((x) => (x.row ?? 1) === row);
                                  const sub = subs.find((x) => x.row === row);
                                  return (
                                    <div class={`wt-row row-${row}`} key={row}>
                                      {p ? tile(p, shape, ctx) : <span class="wt-cell empty" />}
                                      {sub && tile(sub, "hex", `${ctx} · branch unlocked by ${p?.name ?? "the perk beside it"}`, `sub sub-${row}`)}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      <div class="wt-versions">
                        {variants
                          .filter((v) => v.tier === tid)
                          .map((v) => {
                            const ch = variantChanges(v.id);
                            return (
                              <button
                                type="button"
                                key={v.id}
                                class={`version ${variant?.id === v.id ? "selected" : ""} ${ch ? `hl effect-${effectOf(ch)}` : ""}`}
                                onClick={() => setVariantId(v.id)}
                                title={v.name}
                              >
                                <Icon class="version-icon" name={weapon.icon} alt="" />
                                <span class="version-name">{v.name}</span>
                                {specialtyLabel(file, weapon, v) && <span class="version-spec">{specialtyLabel(file, weapon, v)}</span>}
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <EntityChanges changes={weaponChanges} mode={mode} />
      </div>

      {tab === "tree" || !variant ? (
        <PerkPanel panel={panel} changesFor={(p) => perkChanges(highlights, p, mode)} mode={mode} />
      ) : (
        <aside class="card">
          <header class="card-head">
            <div>
              <h3>{variant.name}</h3>
              <div class="card-context">
                {weapon.name} / <span class={`tier-text tier-${variant.tier?.toLowerCase()}`}>{file.tierNames[variant.tier!]}</span>
              </div>
            </div>
          </header>
          <TierStats file={file} weapon={weapon} variant={variant} deltas={compareSiblings} />
          <ChangeList changes={variantChanges(variant.id)} mode={mode} />
        </aside>
      )}
      {tab === "tree" && <LeaderLines container={root} ids={panel.pins.map((p) => p.perk.id)} />}
    </div>
  );
}

type Variant = Weapon["variants"][number];

export function statKeys(weapon: Weapon, stats: Variant["stats"]): string[] {
  return (weapon.kind === "melee" ? MELEE_STATS : RANGED_STATS).filter((k) => {
    if (!(k in stats)) return false;
    // Venting weapons show Venting Speed in place of Reloading Speed.
    if (k === "reloadingSpeed" && stats._venting) return false;
    if (k === "cooling" && !stats._venting) return false;
    // The game omits Piercing at its minimum value of 1 (e.g. Plasma Pistol) but lists it otherwise,
    // also for venting weapons (Heavy Bolter: Piercing 4).
    if (k === "piercing" && stats[k] === 1) return false;
    return true;
  });
}

/**
 * Stats of every variant in the selected variant's tier. The game's stat numbers are only
 * comparable within one weapon's tier (tiers carry hidden damage modifiers, and other weapons
 * have different hidden base values), so differences are shown only against same-tier siblings.
 */
function TierStats({ file, weapon, variant, deltas }: { file: WeaponsFile; weapon: Weapon; variant: Variant; deltas: boolean }) {
  const siblings = weapon.variants.filter((v) => v.tier === variant.tier);
  const keys = statKeys(weapon, variant.stats);
  const fmt = (v: unknown, k: string) => formatStat(file, k, v);
  return (
    <>
      <table class="tier-stats">
        <thead>
          <tr>
            <th />
            {siblings.map((v) => (
              <th key={v.id} class={v.id === variant.id ? "sel" : ""}>
                {v.name.replace(/^.* - /, "") || v.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th>{file.statLabels[k] ?? k}</th>
              {siblings.map((v) => {
                const val = v.stats[k];
                const base = variant.stats[k];
                const d = typeof val === "number" && typeof base === "number" ? val - base : 0;
                return (
                  <td key={v.id} class={v.id === variant.id ? "sel" : ""}>
                    {fmt(val, k)}
                    {deltas && v.id !== variant.id && d !== 0 && (
                      <span class={d > 0 ? "up" : "down"}>
                        {d > 0 ? " ▲" : " ▼"}
                        {PLAIN_STATS.has(k) ? Math.round(Math.abs(d) * 100) / 100 : statText(Math.abs(d))}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted small">
        Stat numbers are only comparable between variants of the same tier of this weapon. Each tier has hidden damage
        modifiers, and other weapons have different hidden base values.
      </p>
    </>
  );
}
