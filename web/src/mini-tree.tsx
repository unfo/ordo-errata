// Small perk-tree "you are here" maps, shown when hovering a perk mentioned in the patch notes.

import { useState } from "preact/hooks";
import type { ClassData, Perk, Snapshot, Weapon } from "./data";
import { Icon } from "./components";
import { displayName, groupColumns } from "./views";
import { formatStat, statKeys } from "./weapon-view";
import { specialtyLabel, tierSiblings } from "./variant-info";

type Found = { kind: "class"; cls: ClassData; perk: Perk } | { kind: "weapon"; weapon: Weapon; perk: Perk; heroic: boolean };

export function findPerk(snap: Snapshot, perkId: string): Found | undefined {
  for (const cls of snap.classes.classes) {
    const all = [...cls.pve.base, ...cls.pve.columns.flatMap((c) => c.slots.flatMap((s) => s.perks)), ...cls.pve.team.flatMap((s) => s.perks), ...cls.pve.prestige.flatMap((s) => s.perks)];
    const perk = all.find((p) => p.id === perkId);
    if (perk) return { kind: "class", cls, perk };
  }
  for (const weapon of snap.weapons.weapons) {
    const perk = weapon.tiers.flatMap((t) => t.layers.flat()).find((p) => p.id === perkId);
    if (perk) return { kind: "weapon", weapon, perk, heroic: false };
    const h = weapon.heroic.find((p) => p.id === perkId);
    if (h) return { kind: "weapon", weapon, perk: h, heroic: true };
  }
  return undefined;
}

function Dot({ perk, target, shape }: { perk?: Perk; target: string; shape: "hex" | "square" }) {
  if (!perk) return <span class="mini-tile empty" />;
  const on = perk.id === target;
  return (
    <span class={`mini-tile ${shape} ${on ? "target" : ""}`}>
      <Icon name={perk.icon} alt="" />
    </span>
  );
}

function MiniClass({ data, cls, target }: { data: Snapshot; cls: ClassData; target: string }) {
  const groups = groupColumns(cls);
  const prestige = cls.pve.prestige.flatMap((p) => p.perks).filter((p) => !p.noUi);
  return (
    <div class="mini-class">
      <div class="mini-groups">
        {groups.map((g) => (
          <div class={`mini-group group-${g.id.toLowerCase()}`} key={g.id}>
            <div class="mini-head">{data.classes.groups[g.id]}</div>
            <div class="mini-cols">
              {g.columns.map((col) => (
                <div class="mini-col" key={col.key}>
                  {col.slots.map((s) => (
                    <Dot key={s.level} perk={s.perks.find((p) => !p.noUi)} target={target} shape={g.shape} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {prestige.some((p) => p.id === target) && (
        <div class="mini-prestige">
          <div class="mini-head">Prestige</div>
          <div class="mini-cols">
            {prestige.map((p) => (
              <Dot key={p.id} perk={p} target={target} shape="hex" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniWeapon({ data, weapon, target }: { data: Snapshot; weapon: Weapon; target: string }) {
  return (
    <div class="mini-weapon">
      {weapon.tiers.map((t) => (
        <div class={`mini-group tier-${t.id.toLowerCase()}`} key={t.id}>
          <div class="mini-head tier-text">{data.weapons.tierNames[t.id] ?? t.name}</div>
          <div class="mini-cols">
            {t.layers.map((layer, ci) => (
              <div class="mini-col" key={ci}>
                {[1, 2].map((row) => {
                  const main = layer.find((p) => !p.sub && (p.row ?? 1) === row);
                  const sub = layer.find((p) => p.sub && p.row === row);
                  return (
                    <span class={`mini-cell row-${row}`} key={row}>
                      <Dot perk={main} target={target} shape={ci === 0 ? "square" : "hex"} />
                      {sub && (
                        <span class={`mini-sub sub-${row}`}>
                          <Dot perk={sub} target={target} shape="hex" />
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div class="mini-group tier-heroic">
        <div class="mini-head tier-text">{data.weapons.tierNames.HEROIC}</div>
        <div class="mini-col">
          {weapon.heroic.map((h) => (
            <Dot key={h.id + h.variant} perk={h} target={target} shape="square" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Card with the owning tree in miniature and the perk highlighted. */
export function MiniTreeCard({ snap, perkId }: { snap: Snapshot; perkId: string }) {
  const f = findPerk(snap, perkId);
  if (!f) return null;
  return (
    <div class="mini-card">
      <div class="mini-title">
        <Icon class="mini-owner" name={f.kind === "class" ? f.cls.icon : f.weapon.icon} alt="" />
        <span>
          <strong>{f.perk.name}</strong> · {f.kind === "class" ? f.cls.name : f.weapon.name}
        </span>
      </div>
      {f.kind === "class" ? <MiniClass data={snap} cls={f.cls} target={perkId} /> : <MiniWeapon data={snap} weapon={f.weapon} target={perkId} />}
    </div>
  );
}

/** Short column name for a variant: drop a "<weapon> -" style prefix shared with siblings. */
function shortName(name: string): string {
  return name.replace(/^Master-Crafted - /, "MC ").replace(/^Salvation of Bakka/, "Bakka").replace(/ - (Alpha|Beta|Gamma)$/, " $1");
}

/** A variant with its tier siblings' stats side by side (the only comparison the game's numbers allow). */
export function VariantCard({ snap, weaponId, variantId }: { snap: Snapshot; weaponId: string; variantId: string }) {
  const file = snap.weapons;
  const weapon = file.weapons.find((w) => w.id === weaponId);
  const variant = weapon?.variants.find((v) => v.id === variantId);
  if (!weapon || !variant) return null;
  const sibs = variant.tier ? tierSiblings(weapon, variant) : [variant];
  const keys = statKeys(weapon, variant.stats);
  const spec = specialtyLabel(file, weapon, variant);
  return (
    <div class="mini-card variant-card">
      <div class="mini-title">
        <Icon class="mini-owner" name={weapon.icon} alt="" />
        <span>
          <strong>{variant.name}</strong> · {displayName(weapon, [])} ·{" "}
          <span class={`tier-text tier-${variant.tier?.toLowerCase()}`}>{variant.tier ? file.tierNames[variant.tier] : "skin"}</span>
        </span>
      </div>
      {spec && <div class="spec-badge">{spec}</div>}
      <table class="mini-stats">
        {sibs.length > 1 && (
          <thead>
            <tr>
              <th />
              {sibs.map((v) => (
                <th key={v.id} class={v.id === variant.id ? "sel" : ""}>
                  {shortName(v.name)}
                  <div class="muted">{specialtyLabel(file, weapon, v)?.replace(" version", "") ?? ""}</div>
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th>{file.statLabels[k] ?? k}</th>
              {sibs.map((v) => (
                <td key={v.id} class={v.id === variant.id ? "sel" : ""}>
                  {formatStat(file, k, v.stats[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TIERS = ["COMMON", "MASTERCRAFTED", "ARTIFICER", "RELIC", "HEROIC"];

/** All versions of a weapon, per tier, with what each is best at. */
export function WeaponCard({ snap, weaponId }: { snap: Snapshot; weaponId: string }) {
  const file = snap.weapons;
  const weapon = file.weapons.find((w) => w.id === weaponId);
  if (!weapon) return null;
  return (
    <div class="mini-card weapon-card">
      <div class="mini-title">
        <Icon class="mini-owner" name={weapon.icon} alt="" />
        <strong>{displayName(weapon, [])}</strong>
      </div>
      <div class="weapon-card-tiers">
        {TIERS.map((t) => {
          const vs = weapon.variants.filter((v) => v.tier === t);
          if (!vs.length) return null;
          return (
            <div key={t} class={`weapon-card-tier tier-${t.toLowerCase()}`}>
              <div class="mini-head tier-text">{file.tierNames[t]}</div>
              {vs.map((v) => (
                <div key={v.id} class="weapon-card-variant">
                  {v.name}
                  {specialtyLabel(file, weapon, v) && <span class="muted"> · {specialtyLabel(file, weapon, v)}</span>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Popover content for a linked entity key (perk, variant or weapon). */
export function ChipPreview({ snap, entityKey }: { snap: Snapshot; entityKey: string }) {
  const rest = entityKey.slice(entityKey.indexOf(":") + 1);
  if (entityKey.startsWith("perk:")) return <MiniTreeCard snap={snap} perkId={rest} />;
  if (entityKey.startsWith("variant:")) {
    const [w, v] = rest.split("/");
    return <VariantCard snap={snap} weaponId={w} variantId={v} />;
  }
  if (entityKey.startsWith("weapon:")) return <WeaponCard snap={snap} weaponId={rest} />;
  return null;
}

const PREVIEWABLE = /^(perk|variant|weapon):/;

/** Hover/focus handlers for chips plus the floating popover they control. */
export function useChipPreview(snap: Snapshot) {
  const [state, setState] = useState<{ key: string; x: number; y: number; above: boolean }>();
  const show = (key: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const above = r.bottom + 300 > innerHeight; // flip above the chip near the bottom of the window
    setState({ key, x: Math.min(r.left, innerWidth - 580), y: above ? r.top - 8 : r.bottom + 8, above });
  };
  const hide = () => setState(undefined);
  const bind = (key: string) =>
    PREVIEWABLE.test(key)
      ? {
          onMouseEnter: (e: MouseEvent) => show(key, e.currentTarget as HTMLElement),
          onMouseLeave: hide,
          onFocus: (e: FocusEvent) => show(key, e.currentTarget as HTMLElement),
          onBlur: hide,
        }
      : {};
  const popover = state ? (
    <div class={`mini-popover ${state.above ? "above" : ""}`} style={{ left: `${Math.max(8, state.x)}px`, top: `${state.y}px` }}>
      <ChipPreview snap={snap} entityKey={state.key} />
    </div>
  ) : null;
  return { bind, popover };
}
