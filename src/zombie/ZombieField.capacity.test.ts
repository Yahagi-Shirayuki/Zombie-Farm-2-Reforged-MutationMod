import { describe, expect, it } from "vitest";
import type { GameAssets, ZombieDef } from "../assets";
import type { Field } from "../Field";
import { GameState } from "../GameState";
import { ZombieField } from "./ZombieField";

const DEF = {
  key: "ordinary", name: "Regular Zombie", group: "Regular", tier: 1, mutation: 0,
  className: "Green", classColor: "#00ff00", str: 1, dex: 1, con: 1, focus: 1,
} as ZombieDef;

/** Enough of GameAssets for ZombieUnit to build a part-less model. */
const assets = (): GameAssets => ({
  zombieModels: { [DEF.key]: { color: [0, 0, 0], neck: { x: 0, y: 0 }, parts: [] } },
  zombiePartTex: {},
  mutationParts: {},
  invasionBubble: undefined,
} as unknown as GameAssets);

/** A Field that can host spawned units, with an optional Mausoleum of `slots`. */
const fieldWith = (slots: number | null): Field => ({
  entityLayer: { addChild: () => {}, removeChild: () => {} },
  patchRestTiles: () => [],
  inBounds: () => true,
  isPassable: () => true,
  zombiePotId: () => null,
  mausoleumId: () => (slots === null ? null : "crypt"),
  objectDefOf: () => ({ zombieSlots: slots ?? 0 }),
} as unknown as Field);

/** A farm holding `n` deployed zombies against the given army cap. */
const farmOf = (n: number, cap: number, field: Field) => {
  const state = new GameState();
  state.zombieMax = cap;
  const zombies = new ZombieField(assets(), field, state, (key) => key === DEF.key ? DEF : undefined);
  zombies.restore(Array.from({ length: n }, (_unit, i) => ({ id: `z${i}`, key: DEF.key })));
  return { state, zombies };
};

describe("zombie harvest capacity", () => {
  it("reports no room at 16/16 with no Mausoleum, and refuses to grow another", () => {
    const { state, zombies } = farmOf(16, 16, fieldWith(null));

    expect(state.zombieCount).toBe(16);
    expect(zombies.zombieHarvestRoom()).toBe(0);
    expect(zombies.canHarvestZombie()).toBe(false);
    expect(zombies.spawn(DEF.key, 1, 1)).toBeNull();
    expect(zombies.spawnVerified(DEF.key, 1, 1)).toBeNull();
    expect(zombies.count).toBe(16);
  });

  it("counts free Mausoleum slots as room, and stores the harvest there", () => {
    const { zombies } = farmOf(16, 16, fieldWith(5));

    expect(zombies.zombieHarvestRoom()).toBe(5);
    const kept = zombies.spawnVerified(DEF.key, 1, 1);

    expect(kept).not.toBeNull();
    expect(zombies.count).toBe(16); // the army cap is never exceeded
    expect(zombies.storedCount).toBe(1);
    expect(zombies.zombieHarvestRoom()).toBe(4);
  });

  it("reports no room once both the army and the Mausoleum are full", () => {
    const { zombies } = farmOf(16, 16, fieldWith(2));
    zombies.spawnVerified(DEF.key, 1, 1);
    zombies.spawnVerified(DEF.key, 1, 1);

    expect(zombies.storedCount).toBe(2);
    expect(zombies.zombieHarvestRoom()).toBe(0);
    expect(zombies.canHarvestZombie()).toBe(false);
    expect(zombies.spawnVerified(DEF.key, 1, 1)).toBeNull();
  });

  it("frees exactly one slot per departing unit", () => {
    const { zombies } = farmOf(16, 16, fieldWith(null));
    expect(zombies.zombieHarvestRoom()).toBe(0);

    zombies.sell("z0");

    expect(zombies.zombieHarvestRoom()).toBe(1);
    expect(zombies.spawn(DEF.key, 1, 1)).not.toBeNull();
    expect(zombies.zombieHarvestRoom()).toBe(0);
  });
});
