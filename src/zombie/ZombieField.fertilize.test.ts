// A Garden zombie that fertilizes while the army is napping has to go BACK to the
// Zombie Patch. The fertilize cast necessarily wakes it — it teleports to the plot and
// raises its arms — and until this it simply resumed wandering afterwards, so tapping
// the patch left one zombie strolling around a farm of sleepers.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameAssets, ZombieDef } from "../assets";
import type { Field } from "../Field";
import { GameState } from "../GameState";
import { screenToGrid, tileCenter } from "../iso";
import { ZombieField } from "./ZombieField";

const GARDENER = {
  key: "gardener", name: "Garden Zombie", group: "Garden", tier: 5, mutation: 0,
  className: "Green", classColor: "#00ff00", str: 1, dex: 1, con: 1, focus: 1,
} as ZombieDef;

const PATCH = { col: 9, row: 9 };
const PLOT = { col: 2, row: 2 };

/** Enough of GameAssets for ZombieUnit to build a part-less model. */
const assets = (): GameAssets => ({
  zombieModels: { [GARDENER.key]: { color: [0, 0, 0], neck: { x: 0, y: 0 }, parts: [] } },
  zombiePartTex: {},
  mutationParts: {},
  invasionBubble: undefined,
} as unknown as GameAssets);

/** Open 20x20 farm with one Zombie Patch tile and a plot to fertilize. */
const field = (): Field => ({
  entityLayer: { addChild: () => {}, removeChild: () => {} },
  patchRestTiles: () => [PATCH],
  plotFrontSpot: () => tileCenter(PLOT.col, PLOT.row),
  markFertilized: () => true,
  inBounds: (c: number, r: number) => c >= 0 && r >= 0 && c < 20 && r < 20,
  isPassable: (c: number, r: number) => c >= 0 && r >= 0 && c < 20 && r < 20,
  isOpenGround: (c: number, r: number) => c >= 0 && r >= 0 && c < 20 && r < 20,
  tileCost: () => 1,
  pathOptions: () => ({ inBounds: (c: number, r: number) => c >= 0 && r >= 0 && c < 20 && r < 20 }),
  zombiePotId: () => null,
  mausoleumId: () => null,
  objectDefOf: () => undefined,
} as unknown as Field);

/** One deployed Garden zombie, napping on the patch. */
const nappingFarm = () => {
  const state = new GameState();
  state.zombieMax = 16;
  const zombies = new ZombieField(
    assets(), field(), state, (key) => (key === GARDENER.key ? GARDENER : undefined)
  );
  zombies.restore([{ id: "z1", key: GARDENER.key, pos: { col: 4, row: 4 } }] as never);
  zombies.gatherTo([PATCH]);
  return zombies;
};

/** Run the farm forward `ms` in 16ms frames. */
const tick = (zombies: ZombieField, ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) zombies.update(0.016);
};

const unitTile = (zombies: ZombieField) => {
  const at = zombies.characterContainers()[0].position;
  const g = screenToGrid(at.x, at.y);
  return { col: Math.round(g.col), row: Math.round(g.row) };
};

afterEach(() => vi.restoreAllMocks());

describe("a Garden zombie fertilizing during a Zombie Patch nap", () => {
  it("walks back to its patch tile and lies down again", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // the tier-5 fertilize roll always wins
    const zombies = nappingFarm();
    tick(zombies, 8_000); // settle onto the patch first

    expect(zombies.tryFertilize(PLOT.col, PLOT.row)).toBe("Garden Zombie");
    expect(unitTile(zombies)).toEqual(PLOT); // teleported to the crop

    tick(zombies, 16_000); // cast, then the walk home

    expect(unitTile(zombies)).toEqual(PATCH);
    expect(zombies.isGathered).toBe(true);
    expect(zombies.randomBrainBark()).toBeNull(); // isSleeping again: no bark from a sleeper
  });

  it("resumes wandering when the farm is not gathered", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const zombies = nappingFarm();
    zombies.wakeAll();
    tick(zombies, 2_000);

    expect(zombies.tryFertilize(PLOT.col, PLOT.row)).toBe("Garden Zombie");
    tick(zombies, 16_000);

    expect(zombies.isGathered).toBe(false);
    expect(zombies.randomBrainBark()).not.toBeNull(); // awake, wandering as before
  });
});
