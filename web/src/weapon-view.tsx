import { useState } from "preact/hooks";
import type { Perk, Weapon, WeaponsFile } from "./data";
import { forMode, type Highlights, type Mode } from "./changes";
import { ChangeList, effectOf, Icon, PerkCard, PerkTile } from "./components";
import { displayName } from "./views";

const TIER_ORDER = ["COMMON", "MASTERCRAFTED", "ARTIFICER", "RELIC", "HEROIC"] as const;

/** Stats in the order the game lists them. Venting weapons show Venting Speed instead of reloading. */
const RANGED_STATS = ["firePower", "accuracy", "fireRate", "reloadingSpeed", "cooling", "chargingSpeed", "piercing", "range"];
const MELEE_STATS = ["strikePower", "strikeSpeed", "control", "defense"];
// The game's bars fill at 10; higher values (heroics) just show a full bar.
const STAT_MAX = 10;

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
}: {
  file: WeaponsFile;
  weapon: Weapon;
  mode: Mode;
  highlights: Highlights;
}) {
  const [tab, setTab] = useState<"tree" | "versions">("tree");
  const [selected, setSelected] = useState<{ perk: Perk; ctx: string } | undefined>();
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
        selected={selected?.perk.id === p.id}
        changes={perkChanges(highlights, p, mode)}
        onSelect={(perk) => setSelected({ perk, ctx })}
      />
    </span>
  );

  const tiers = TIER_ORDER.filter((t) => t === "HEROIC" || weapon.tiers.some((x) => x.id === t));

  return (
    <div class="class-view">
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
        <ChangeList changes={weaponChanges} mode={mode} />

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
      </div>

      {tab === "tree" || !variant ? (
        <PerkCard perk={selected?.perk} context={selected?.ctx} changes={selected ? perkChanges(highlights, selected.perk, mode) : undefined} mode={mode} />
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
          <Stats file={file} weapon={weapon} stats={variant.stats} />
          <ChangeList changes={variantChanges(variant.id)} mode={mode} />
        </aside>
      )}
    </div>
  );
}

function Stats({ file, weapon, stats }: { file: WeaponsFile; weapon: Weapon; stats: Record<string, number | string | boolean> }) {
  const order = (weapon.kind === "melee" ? MELEE_STATS : RANGED_STATS).filter((k) => {
    if (!(k in stats)) return false;
    // Venting weapons show Venting Speed in place of Reloading Speed.
    if (k === "reloadingSpeed" && stats._venting) return false;
    if (k === "cooling" && !stats._venting) return false;
    // Not listed in game for venting (plasma) weapons either.
    if (k === "piercing" && stats._venting) return false;
    return true;
  });
  return (
    <dl class="stats">
      {order.map((k) => {
        const v = stats[k];
        return (
          <div class="stat" key={k}>
            <dt>{file.statLabels[k] ?? k}</dt>
            {typeof v === "number" ? (
              <dd>
                <span class="stat-num">{statText(v)}</span>
                <span class="stat-bar">
                  <span style={{ width: `${Math.min(100, (v / STAT_MAX) * 100)}%` }} />
                </span>
              </dd>
            ) : (
              <dd>{file.defenseLabels[String(v)] ?? String(v)}</dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
