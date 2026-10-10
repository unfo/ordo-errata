import { useEffect, useState } from "preact/hooks";
import { loadSnapshot, type Snapshot } from "./data";
import { emptyHighlights, forMode, type Mode } from "./changes";
import { effectOf, Icon } from "./components";
import { ClassView, WeaponList } from "./views";
import { WeaponView } from "./weapon-view";
import { ChangelogView, changelogs, useHighlights } from "./changelog-view";

type Route = { page: "class"; id?: string } | { page: "weapon"; id?: string } | { page: "changelog"; id?: string };

function parseRoute(hash: string): Route {
  const [, page, id] = hash.replace(/^#/, "").split("/");
  if (page === "weapon" || page === "changelog") return { page, id: id && decodeURIComponent(id) };
  return { page: "class", id: id && decodeURIComponent(id) };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

function useStored<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T) || initial;
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(key, nv);
    } catch {
      /* storage unavailable */
    }
  };
  return [v, set];
}

export function App() {
  const [snap, setSnap] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const route = useRoute();
  const [mode, setMode] = useStored<Mode>("sm2ph.mode", "pve");
  const [logId, setLogId] = useStored<string>("sm2ph.changelog", changelogs[0]?.id ?? "");

  useEffect(() => {
    loadSnapshot().then(setSnap, (e) => setError(String(e)));
  }, []);

  const { highlights, parsed } = useHighlights(snap, logId);
  const hl = highlights ?? emptyHighlights;

  const go = (r: string) => (location.hash = r);

  if (error) return <main class="error">Failed to load data: {error}</main>;
  if (!snap) return <main class="loading">Loading game data…</main>;

  const classes = snap.classes.classes;
  const cls = route.page === "class" ? classes.find((c) => c.id === route.id) ?? classes[0] : undefined;
  const weapons = snap.weapons.weapons;
  const weapon = route.page === "weapon" ? weapons.find((w) => w.id === route.id) : undefined;

  const classEffect = (id: string) => {
    const c = classes.find((x) => x.id === id)!;
    const perks = [...c.pve.base, ...c.pvp.base, ...c.pve.columns.flatMap((col) => col.slots.flatMap((s) => s.perks)), ...c.pve.team.flatMap((s) => s.perks), ...c.pve.prestige.flatMap((s) => s.perks)];
    return effectOf([
      ...(forMode(hl.get(`class:${id}`), mode) ?? []),
      ...perks.flatMap((p) => forMode(hl.get(`perk:${p.id}`), mode) ?? []),
    ]);
  };

  return (
    <div class="app">
      <header class="top">
        <div class="brand">
          <h1>SM2 Patch Helper</h1>
          <span class="muted">game build {snap.buildId}</span>
        </div>
        <div class="controls">
          <label>
            Patch notes{" "}
            <select value={logId} onChange={(e) => setLogId((e.target as HTMLSelectElement).value)}>
              <option value="">(none)</option>
              {changelogs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <div class="mode-toggle" role="radiogroup" aria-label="Game mode">
            {(["pve", "pvp"] as Mode[]).map((m) => (
              <button type="button" key={m} role="radio" aria-checked={mode === m} class={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <nav class="tabs" aria-label="Sections">
          <a href="#/changelog" class={route.page === "changelog" ? "on" : ""}>
            Patch notes
          </a>
          {classes.map((c) => {
            const eff = classEffect(c.id);
            return (
              <a key={c.id} href={`#/class/${c.id}`} class={`${cls?.id === c.id ? "on" : ""} ${eff ? `hl effect-${eff}` : ""}`}>
                <Icon class="tab-icon" name={c.icon} alt="" />
                {c.name}
              </a>
            );
          })}
          <a href="#/weapon" class={route.page === "weapon" ? "on" : ""}>
            Weapons
          </a>
        </nav>
      </header>

      <main>
        {route.page === "changelog" && <ChangelogView snap={snap} parsed={parsed} mode={mode} go={go} />}
        {cls && <ClassView data={snap.classes} cls={cls} mode={mode} highlights={hl} />}
        {route.page === "weapon" && (
          <div class="weapons-page">
            <WeaponList weapons={weapons} current={weapon?.id} mode={mode} highlights={hl} onPick={(id) => go(`#/weapon/${id}`)} />
            {weapon ? <WeaponView key={weapon.id} file={snap.weapons} weapon={weapon} mode={mode} highlights={hl} /> : <p class="muted note">Pick a weapon.</p>}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

// Verbatim from the game's own legal notice (strings_english.str: boot_legal_text).
const GAME_LEGAL =
  "Warhammer 40,000: Space Marine 2 © Games Workshop Limited 2024. Space Marine, the Space Marine logo, GW, Games Workshop, 40K, Warhammer, Warhammer 40,000, 40,000, the 'Aquila' Double-headed Eagle logo, and all associated logos, illustrations, images, names, creatures, races, vehicles, locations, weapons, characters, and the distinctive likeness thereof, are either ® or TM, and/or © Games Workshop Limited, variably registered around the world, and used under licence. Focus Entertainment and its logos are trademarks, registered or not, of Focus Entertainment. Saber Interactive and its logos are trademarks, registered or not, of Saber Interactive.";

function Footer() {
  return (
    <footer class="foot">
      <p>
        Unofficial fan-made tool. Not affiliated with, endorsed or sponsored by Games Workshop, Saber Interactive or Focus
        Entertainment.
      </p>
      <p>
        {GAME_LEGAL} Game icons and text shown here are the property of their respective owners and are not covered by this
        project's license.
      </p>
      <p>
        Provided “as is”, without warranty of any kind. Data is extracted automatically from the game files and may be incomplete or
        out of date. Rights holders: contact{" "}
        <a href="mailto:emperor-protects@localhost.exposed">emperor-protects@localhost.exposed</a> about any content and it will be
        reviewed and removed promptly on request.
      </p>
    </footer>
  );
}
