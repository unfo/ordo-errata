// Small perk-tree "you are here" maps, shown when hovering a perk mentioned in the patch notes.

import type { ClassData, Perk, Snapshot, Weapon } from "./data";
import { Icon } from "./components";
import { groupColumns } from "./views";

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
