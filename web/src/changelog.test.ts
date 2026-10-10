import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferEffect, inferMode, parseMarkdown, resolveChangelog, type Aliases } from "./changelog";
import type { Snapshot } from "./data";

const root = new URL("../../", import.meta.url);
const builds = JSON.parse(readFileSync(new URL("data/builds.json", root), "utf8"));
const read = (p: string) => JSON.parse(readFileSync(new URL(`data/${builds.latest}/${p}.json`, root), "utf8"));
const snap: Snapshot = { buildId: builds.latest, classes: read("classes"), weapons: read("weapons"), names: read("names_index") };
const aliases: Aliases = JSON.parse(readFileSync(new URL("changelogs/aliases.json", root), "utf8"));
const log = (name: string) => readFileSync(new URL(`changelogs/${name}`, root), "utf8");

describe("markdown parsing", () => {
  it("tracks headings, bold sub-headings and nested bullets", () => {
    const { title, items } = parseMarkdown(
      "# Patch 1\n## **A**\n### **B**\n**Melta Rifle**\n- Top:\n    - Nested *x*.\n> *dev note*\n",
    );
    expect(title).toBe("Patch 1");
    expect(items.map((i) => [i.section, i.text, i.kind])).toEqual([
      [["A", "B", "Melta Rifle"], "Top:", "bullet"],
      [["A", "B", "Melta Rifle"], "Top › Nested x.", "bullet"],
      [["A", "B", "Melta Rifle"], "dev note", "note"],
    ]);
    expect(items[1].emphasized).toEqual(["x"]);
  });
});

describe("classification", () => {
  it.each([
    ["Base damage is increased by 10%.", "buff"],
    ["Cooldown is decreased to 15 seconds.", "buff"],
    ["Secure Stockpile: cooldown is increased from 60 to 90 seconds.", "nerf"],
    ["Iron Halo health is reduced by 25%.", "nerf"],
    ["Fixed a bug where players could take damage.", "fixed"],
    ["Steady Aim has been removed and replaced with Focused Strike", "replaced"],
    ["Damage fall off distance start point is changed from 2 to 3 meters.", "changed"],
  ])("%s -> %s", (text, effect) => expect(inferEffect(text)).toBe(effect));

  it("reads mode from headings and prefixes", () => {
    expect(inferMode(["GAMEPLAY", "Firearms in PvP"], "x")).toBe("pvp");
    expect(inferMode(["GAMEPLAY", "Melee in PvE"], "x")).toBe("pve");
    expect(inferMode(["GENERAL FIXES"], "PvP: Fixed a bug")).toBe("pvp");
    expect(inferMode(["GENERAL FIXES"], "Fixed a bug")).toBe("both");
  });
});

const perkByName = (name: string) => {
  for (const w of snap.weapons.weapons) for (const p of w.tiers.flatMap((t) => t.layers.flat())) if (p.name === name) return p;
  for (const c of snap.classes.classes)
    for (const p of [...c.pve.columns.flatMap((x) => x.slots.flatMap((s) => s.perks)), ...c.pve.prestige.flatMap((s) => s.perks)])
      if (p.name === name) return p;
  throw new Error(name);
};

describe("hotfix 15.1", () => {
  const parsed = resolveChangelog("15.1-hotfix", log("15.1-hotfix.md"), snap, aliases);

  it("links one-handed hammer perks within the hammer's scope", () => {
    const co = parsed.highlights.get(`perk:${perkByName("Charge Overflow").id}`);
    expect(co?.[0].text).toMatch(/20 seconds/);
    expect(co?.[0].mode).toBe("pve");
    expect(parsed.highlights.get(`perk:${perkByName("Brutal Reforge").id}`)).toBeDefined();
    expect(parsed.highlights.get(`perk:${perkByName("Preparedness").id}`)).toBeDefined();
  });

  it("links weapon-wide lines and variants", () => {
    expect(parsed.highlights.get("weapon:melee_thunder_hammer_one_handed")?.length).toBeGreaterThan(3);
    // Weapon-wide lines go on the weapon; variant-specific lines on the variants.
    expect(parsed.highlights.get("weapon:shotgun_meltagun")?.map((c) => c.text)).toEqual([
      "Default max ammo pool is increased by 2 (now 12).",
      "Default magazine size is increased by 1 (now 6).",
    ]);
    const variants = [...parsed.highlights.keys()].filter((k) => k.startsWith("variant:shotgun_meltagun/"));
    expect(variants.length).toBeGreaterThan(2);
  });
});

describe("patch 15", () => {
  const parsed = resolveChangelog("15.0-patch", log("15.0-patch.md"), snap, aliases);

  it("links the Tactical rework to Tactical perks", () => {
    for (const name of ["Passive Chambering", "Focused Strike", "Marksman's Mandate", "Pulse Auspex", "Tactical Reserve"]) {
      const ch = parsed.highlights.get(`perk:${perkByName(name).id}`);
      expect(ch, name).toBeDefined();
    }
  });

  it("separates PvP changes", () => {
    const pvpMelta = parsed.highlights.get("weapon:shotgun_meltagun")?.filter((c) => c.mode === "pvp");
    expect(pvpMelta?.[0].text).toMatch(/Rate of fire/);
  });
});

describe("coverage report", () => {
  it("lists names that matched nothing", () => {
    for (const f of readdirSync(new URL("changelogs/", root)).filter((f) => f.endsWith(".md"))) {
      const p = resolveChangelog(f, log(f), snap, aliases);
      const linked = p.items.filter((i) => i.keys.length).length;
      console.log(`${f}: ${linked}/${p.items.length} lines linked; unmatched names: ${JSON.stringify(p.unmatched.map((u) => u.name))}`);
    }
  });
});

describe("diff path labels", async () => {
  const { prettyPath } = await import("./diff-view");
  it.each([
    ["pve.cartridgeDescriptions.bolts.shotCreatorSettings.coeffDamage.spline[0]", "PvE · bolts · damage falloff point 1 distance (m)"],
    ["pve.clipsSettings.default_clip.maxAmmo", "PvE · magazine size"],
    ["pve.ammoSettings.typeData.ammo_shotgun.maxAmount", "PvE · ammo_shotgun · max ammo pool"],
    ["activationController.delayedResetSec", "duration (s)"],
  ])("%s", (path, label) => expect(prettyPath(path)).toBe(label));
});
