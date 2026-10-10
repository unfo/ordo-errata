import { useState } from "preact/hooks";
import type { ClassData, ClassesFile, Perk, Slot, Weapon } from "./data";
import { forMode, type Highlights, type Mode } from "./changes";
import { effectOf, ChangeList, Icon, PerkCard, PerkTile } from "./components";

type Shape = "hex" | "square";

interface Column {
  key: string;
  slots: Slot[];
}

interface Group {
  id: keyof ClassesFile["groups"];
  shape: Shape;
  columns: Column[];
}

/**
 * The in-game perk screen has four groups, left to right: CORE (hex), TEAM (square),
 * GEAR (hex), SIGNATURE (square). Columns unlock at levels 2,3,4 | 5 | 6,7,8 | 9
 * (then +8 and +16 for the rows below), which maps onto those groups in order.
 */
function groupColumns(c: ClassData): Group[] {
  const firstLevel = (col: { slots: Slot[] }) => Math.min(...col.slots.map((s) => s.level));
  const cols = c.pve.columns.map((col) => ({ key: `col${col.tierIndex}`, slots: col.slots, first: firstLevel(col) }));
  return [
    { id: "CORE", shape: "hex", columns: cols.filter((x) => x.first <= 4) },
    { id: "TEAM", shape: "square", columns: [{ key: "team", slots: c.pve.team }] },
    { id: "GEAR", shape: "hex", columns: cols.filter((x) => x.first >= 6 && x.first <= 8) },
    { id: "SIGNATURE", shape: "square", columns: cols.filter((x) => x.first >= 9) },
  ];
}

function perkChanges(h: Highlights, p: Perk, mode: Mode) {
  return forMode(h.get(`perk:${p.id}`), mode);
}

export function ClassView({
  data,
  cls,
  mode,
  highlights,
}: {
  data: ClassesFile;
  cls: ClassData;
  mode: Mode;
  highlights: Highlights;
}) {
  const [selected, setSelected] = useState<{ perk: Perk; ctx: string } | undefined>();
  const select = (ctx: string) => (perk: Perk) => setSelected({ perk, ctx });
  const visible = (perks: Perk[]) => perks.filter((p) => !p.noUi);
  // Base kits list some UI perks twice (e.g. the ability and its upgrade share a name).
  const uniqueByName = (perks: Perk[]) => perks.filter((p, i) => perks.findIndex((q) => q.name === p.name) === i);
  const classChanges = forMode(highlights.get(`class:${cls.id}`), mode);

  const tile = (p: Perk, shape: Shape, ctx: string, level?: number) => (
    <PerkTile
      key={p.id}
      perk={p}
      shape={shape}
      level={level}
      selected={selected?.perk.id === p.id}
      changes={perkChanges(highlights, p, mode)}
      onSelect={select(ctx)}
    />
  );

  return (
    <div class="class-view">
      <div class="tree-area">
        <section class="base-kit">
          <h2>{mode === "pve" ? "Class ability & base perks" : "PvP class kit"}</h2>
          <div class="tile-row">
            {uniqueByName(visible(mode === "pve" ? cls.pve.base : cls.pvp.base)).map((p) => tile(p, "square", "Base kit"))}
          </div>
        </section>

        {mode === "pve" ? (
          <>
            <section class="perk-tree" aria-label="Perk tree">
              {groupColumns(cls).map((g) => (
                <div class={`perk-group group-${g.id.toLowerCase()}`} key={g.id}>
                  <h2 class="group-head">{data.groups[g.id]}</h2>
                  <div class="group-cols">
                    {g.columns.map((col) => (
                      <div class="perk-col" key={col.key}>
                        {col.slots.map((s) => (
                          <div class="perk-slot" key={s.level}>
                            {visible(s.perks).map((p) => tile(p, g.shape, `${data.groups[g.id]} · unlocks at level ${s.level}`, s.level))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <section class="prestige">
              <h2>Prestige perks</h2>
              <div class="tile-row">
                {cls.pve.prestige.flatMap((ps) =>
                  visible(ps.perks).map((p) => tile(p, "hex", `Prestige · requires ${ps.requires.replace("PRESTIGE_LEVEL_", "Prestige ")}`)),
                )}
              </div>
            </section>
          </>
        ) : (
          <p class="muted note">PvP classes have no perk tree. Only the base kit above applies. PvP changes usually target abilities, weapons and class stats, so check the highlighted items and the class notes.</p>
        )}
        {classChanges && (
          <section>
            <h2>Class-wide changes</h2>
            <ChangeList changes={classChanges} mode={mode} />
          </section>
        )}
      </div>
      <PerkCard
        perk={selected?.perk}
        context={selected?.ctx}
        changes={selected ? perkChanges(highlights, selected.perk, mode) : undefined}
        mode={mode}
      />
    </div>
  );
}

const ID_SUFFIX: Record<string, string> = { tac_reserve: "Tactical Reserve" };

/** Weapon name, disambiguated when two entries share it (e.g. the Tactical Reserve bolt rifle). */
export function displayName(w: Weapon, all: Weapon[]): string {
  const suffixOf = (x: Weapon) => Object.entries(ID_SUFFIX).find(([k]) => x.id.endsWith(`_${k}`))?.[1];
  const suffix = suffixOf(w);
  if (suffix) return `${w.name} (${suffix})`;
  return all.some((o) => o !== w && o.name === w.name && !suffixOf(o)) ? `${w.name} (${w.id})` : w.name;
}

export function WeaponList({
  weapons,
  current,
  mode,
  highlights,
  onPick,
}: {
  weapons: Weapon[];
  current?: string;
  mode: Mode;
  highlights: Highlights;
  onPick: (id: string) => void;
}) {
  const changed = (w: Weapon) =>
    effectOf(
      [
        ...(forMode(highlights.get(`weapon:${w.id}`), mode) ?? []),
        ...w.tiers.flatMap((t) => t.layers.flat()).flatMap((p) => perkChanges(highlights, p, mode) ?? []),
        ...w.variants.flatMap((v) => forMode(highlights.get(`variant:${w.id}/${v.id}`), mode) ?? []),
        ...w.heroic.flatMap((p) => perkChanges(highlights, p, mode) ?? []),
      ].filter(Boolean),
    );
  // Weapons without an in-game name are unreleased or internal; skip them.
  const released = weapons.filter((w) => w.name !== w.id);
  const groups: [string, Weapon[]][] = [
    ["Ranged", released.filter((w) => w.kind === "ranged")],
    ["Melee", released.filter((w) => w.kind === "melee")],
  ];
  return (
    <nav class="weapon-list" aria-label="Weapons">
      {groups.map(([label, ws]) => (
        <div key={label}>
          <h2>{label}</h2>
          {ws
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((w) => {
              const eff = changed(w);
              return (
                <button
                  type="button"
                  key={w.id}
                  class={`weapon-item ${current === w.id ? "selected" : ""} ${eff ? `hl effect-${eff}` : ""}`}
                  onClick={() => onPick(w.id)}
                >
                  <Icon class="weapon-icon" name={w.icon} alt="" />
                  <span>{displayName(w, released)}</span>
                </button>
              );
            })}
        </div>
      ))}
    </nav>
  );
}

export function WeaponView({ weapon, mode, highlights }: { weapon: Weapon; mode: Mode; highlights: Highlights }) {
  const [selected, setSelected] = useState<{ perk: Perk; ctx: string } | undefined>();
  const weaponChanges = forMode(highlights.get(`weapon:${weapon.id}`), mode);
  return (
    <div class="class-view">
      <div class="tree-area">
        <header class="weapon-head">
          <Icon class="weapon-hero" name={weapon.icon} alt="" />
          <h2>{displayName(weapon, [])}</h2>
        </header>
        <ChangeList changes={weaponChanges} mode={mode} />

        <section class="weapon-tree" aria-label="Weapon perk tree">
          {weapon.tiers.map((t) => (
            <div class="weapon-tier" key={t.id}>
              <h3 class="group-head">{t.name}</h3>
              {t.layers.map((layer, i) => (
                <div class="tile-row" key={i}>
                  {layer
                    .filter((p) => !p.noUi)
                    .map((p) => (
                      <PerkTile
                        key={p.id}
                        perk={p}
                        shape="square"
                        selected={selected?.perk.id === p.id}
                        changes={perkChanges(highlights, p, mode)}
                        onSelect={(perk) => setSelected({ perk, ctx: `${t.name} perk` })}
                      />
                    ))}
                </div>
              ))}
            </div>
          ))}
        </section>

        {weapon.heroic.length > 0 && (
          <section>
            <h2>Heroic perks</h2>
            <div class="tile-row">
              {weapon.heroic.map((p) => (
                <PerkTile
                  key={p.id + p.variant}
                  perk={p}
                  shape="hex"
                  selected={selected?.perk.id === p.id}
                  changes={perkChanges(highlights, p, mode)}
                  onSelect={(perk) =>
                    setSelected({ perk, ctx: `Heroic · ${weapon.variants.find((v) => v.id === p.variant)?.name ?? p.variant}` })
                  }
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2>Variants</h2>
          <ul class="variants">
            {weapon.variants.map((v) => {
              const ch = forMode(highlights.get(`variant:${weapon.id}/${v.id}`), mode);
              return (
                <li key={v.id} class={ch ? `hl effect-${effectOf(ch)}` : ""}>
                  {v.name}
                  <ChangeList changes={ch} mode={mode} />
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <PerkCard
        perk={selected?.perk}
        context={selected?.ctx}
        changes={selected ? perkChanges(highlights, selected.perk, mode) : undefined}
        mode={mode}
      />
    </div>
  );
}
