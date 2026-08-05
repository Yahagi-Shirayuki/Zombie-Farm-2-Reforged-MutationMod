import { describe, it, expect } from "vitest";
// The app has no @types/node (it only ever runs in a browser); the node test
// environment provides this at runtime. Same treatment as ui/tutorialLayering.test.ts.
// @ts-ignore
import { readdirSync } from "node:fs";
import models from "../../public/assets/zombie/models.json";
import {
  mutationEntries, mutationNames, mutationTipText, MUTATION_ICON, MUTATION_VARIANTS,
} from "./mutationDisplay";
import { ALL_BITS, MUTATIONS, mutationBonus } from "./mutations";
import { statBreakdown } from "./statDisplay";

// A plain Regular tier-1 (str/dex/con 2) unless a test says otherwise. Raw stats
// INCLUDE the mask's bonuses, exactly as makeOwned stores them.
const zombie = (mask: number, over: Partial<{ key: string; str: number; dex: number; con: number }> = {}) => {
  const bonus = mutationBonus(mask);
  return {
    key: "ZombieActorRegularTier1",
    str: 2 + bonus.str, dex: 2 + bonus.dex, con: 2 + bonus.con,
    mutation: mask,
    ...over,
  };
};

describe("mutationEntries", () => {
  it("reports nothing for an unmutated zombie", () => {
    expect(mutationEntries(zombie(0))).toEqual([]);
  });

  it("names each mutation the zombie carries, in tier order", () => {
    const rows = mutationEntries(zombie(1 | 64)); // Tomatohead + Celery-arms
    expect(rows.map((r) => r.name)).toEqual(["Tomatohead", "Celery-arms"]);
    expect(rows.map((r) => r.slotLabel)).toEqual(["Head", "Arm"]);
    expect(rows.map((r) => r.statLabel)).toEqual(["Damage", "Damage"]);
  });

  it("reports the bonus in DISPLAYED units, not the raw 1-4 points", () => {
    // Carrot is +1 raw dex, but Speed's display reference is small, so it reads far
    // larger than Tomato's +1 raw str does on Damage. This is the whole reason the
    // row quotes a normalized number.
    const [carrot] = mutationEntries(zombie(4));
    const [tomato] = mutationEntries(zombie(1));
    expect(carrot.delta).toBeGreaterThan(tomato.delta);
    expect(tomato.delta).toBe(4);
    expect(carrot.delta).toBe(23);
  });

  it("splits a stat's total across the mutations that share it, without drift", () => {
    // Tomato (+1 str) and Celery (+3 str) both raise Damage: the two rows must add up
    // to exactly the "Mutation" line the stat breakdown shows, not a point either way.
    const z = { ...zombie(1 | 64), focus: 50, invasions: 9, group: "Regular", className: "Green" };
    const rows = mutationEntries(z);
    const line = statBreakdown(z, "str", () => false).lines.find((l) => l.label === "Mutation");
    expect(rows.reduce((sum, r) => sum + r.delta, 0)).toBe(Number(line!.amount));
  });

  it("names a Tier-4 variant after ITS OWN mutation, not the bit it shares", () => {
    // Heartichoke rides Cauliflower's bit 512; calling it "Cauli-hair" was the bug.
    const [heartichoke] = mutationEntries(zombie(512, { key: "ZombieActorRegularTier4Heartichoke" }));
    expect(heartichoke.name).toBe("Heartichoke");
    expect(heartichoke.icon).toContain("heartichoke");
    const [eyebiscus] = mutationEntries(zombie(4, { key: "ZombieActorRegularTier4Eyebiscus" }));
    expect(eyebiscus.name).toBe("Eyebiscus");
    expect(eyebiscus.icon).toContain("eyebiscus");
    // The shared bit still means Cauli-hair on anybody else.
    expect(mutationEntries(zombie(512))[0].name).toBe("Cauli-hair");
  });

  it("gives every mutation an icon", () => {
    for (const bit of ALL_BITS) {
      const [row] = mutationEntries(zombie(bit));
      expect(row.icon, `${MUTATIONS[bit].name} has no icon`).toBeTruthy();
    }
  });
});

describe("mutation art", () => {
  it("points every icon at a file the prep tool actually shipped", () => {
    // Guards the three names that differ from our mutation keys — the game calls
    // them cauliflower and dragonfruit, and pumpking is the composed one — plus a
    // stale MUTATION_ICON entry after any re-run of tools/prep_mutation_icons.py.
    const shipped = new Set(
      readdirSync(new URL("../../public/assets/ui/mutation", import.meta.url))
    );
    const icons = [
      ...Object.values(MUTATION_ICON),
      ...Object.values(MUTATION_VARIANTS).flatMap((v) => Object.values(v).map((m) => m.icon)),
    ];
    expect(icons.length).toBe(ALL_BITS.length + 2); // every bit + the two variants
    for (const icon of icons) {
      expect(shipped, `missing art for ${icon}`).toContain(icon.split("/").pop());
    }
  });

  it("keeps the variant table in step with the rig's mutationOverrides", () => {
    // models.json is the rig's source of truth for which part a species swaps in;
    // the card must show art for the SAME override, or the icon and the zombie on
    // the farm would disagree.
    const rig = Object.entries(models as Record<string, { mutationOverrides?: Record<string, string> }>)
      .filter(([, model]) => model.mutationOverrides)
      .map(([key, model]) => [key, model.mutationOverrides!] as const);
    expect(rig.length).toBe(Object.keys(MUTATION_VARIANTS).length);
    for (const [key, overrides] of rig) {
      const variants = MUTATION_VARIANTS[key];
      expect(variants, `${key} has no card variant`).toBeTruthy();
      for (const [bit, part] of Object.entries(overrides)) {
        expect(variants[Number(bit)].part).toBe(part);
      }
    }
  });
});

describe("mutationNames", () => {
  it("lists the names a mask stands for on that species", () => {
    expect(mutationNames("ZombieActorRegularTier1", 2 | 1024)).toEqual(["Onionhead", "Lima Bean"]);
    expect(mutationNames("ZombieActorRegularTier4Eyebiscus", 4)).toEqual(["Eyebiscus"]);
    expect(mutationNames("ZombieActorRegularTier1", 0)).toEqual([]);
  });
});

describe("mutationTipText", () => {
  it("is just the gain and the slot it occupies", () => {
    // The tile carries no label, so the bonus must be here — and nothing else, the
    // name is the tooltip's own title.
    const [flytrap] = mutationEntries(zombie(2048));
    expect(mutationTipText(flytrap)).toBe(
      `<span class="zeff">+${flytrap.delta} Life</span><br>Neck slot`
    );
  });
});
