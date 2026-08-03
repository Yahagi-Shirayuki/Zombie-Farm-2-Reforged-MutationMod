import { describe, expect, it } from "vitest";
import placeables from "../../public/assets/placeables.json";
import type { GameAssets, PlaceableDef, ZombieDef } from "../assets";
import type { Field } from "../Field";
import { GameState } from "../GameState";
import { ZombieField } from "./ZombieField";

const tombs = (placeables as PlaceableDef[])
  .filter((entry) => /^mausoleum/.test(entry.key))
  .sort((a, b) => (a.zombieSlots ?? 0) - (b.zombieSlots ?? 0));

const def = { key: "ordinary", name: "Regular Zombie", group: "Regular" } as ZombieDef;

/** A ZombieField whose farm holds the given Mausoleum tier (undefined = none). */
const withMausoleum = (tier?: PlaceableDef, stored = 0) => {
  const field = {
    zombiePotId: () => "pot",
    mausoleumId: () => (tier ? "tomb" : null),
    objectDefOf: () => tier,
  } as unknown as Field;
  const zombies = new ZombieField(
    {} as GameAssets, field, new GameState(), (key) => (key === def.key ? def : undefined)
  );
  zombies.restore(Array.from({ length: stored }, (_, i) => ({ id: `z${i}`, key: def.key, stored: true })));
  return zombies;
};

describe("Mausoleum upgrade ladder", () => {
  it("ships five tiers, each adding five slots for brains", () => {
    expect(tombs.map((tier) => [tier.key, tier.cost, tier.zombieSlots])).toEqual([
      ["mausoleum3", 8, 15],
      ["mausoleum4", 4, 20],
      ["mausoleum5", 6, 25],
      ["mausoleum6", 8, 30],
      ["mausoleum7", 10, 35],
    ]);
    // Every tier is a brain-priced functional building sharing the base art, so an
    // upgrade swaps capacity in place without changing how the farm looks.
    for (const tier of tombs) {
      expect(tier, tier.key).toMatchObject({
        category: "functional", brainsNeeded: true,
        sprite: tombs[0].sprite, tileW: tombs[0].tileW, tileH: tombs[0].tileH,
      });
    }
  });

  it("takes its capacity from the placed building's tier", () => {
    expect(withMausoleum(undefined).mausoleumCap).toBe(0);
    expect(withMausoleum(tombs[0]).mausoleumCap).toBe(15);
    expect(withMausoleum(tombs[1]).mausoleumCap).toBe(20);
    expect(withMausoleum(tombs[4]).mausoleumCap).toBe(35);
  });

  it("frees five more slots as soon as the building is upgraded", () => {
    expect(withMausoleum(tombs[0], 15).mausoleumFull).toBe(true);
    expect(withMausoleum(tombs[1], 15).mausoleumFull).toBe(false);
    // With no Mausoleum placed there is nowhere to store a zombie at all.
    expect(withMausoleum(undefined).mausoleumFull).toBe(true);
    expect(withMausoleum(undefined).store("z0")).toBe(false);
  });
});
