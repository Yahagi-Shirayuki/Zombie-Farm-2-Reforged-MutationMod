import { describe, expect, it } from "vitest";
import type { GameAssets, ZombieDef } from "../assets";
import type { Field } from "../Field";
import { GameState } from "../GameState";
import { createZombieColorDyeJob } from "../zombieColorMixerBucket";
import { ZombieField } from "./ZombieField";

const def: ZombieDef = {
  key: "regular",
  name: "Regular Zombie",
  cost: 10,
  growMs: 1000,
  level: 1,
  xp: 1,
  category: "normal",
  group: "Regular",
  className: "Green",
  classColor: "#60a83a",
  str: 1,
  dex: 1,
  con: 1,
  focus: 0,
};

const assets = (): GameAssets => ({
  zombieModels: { regular: { color: [170, 159, 159], neck: { x: 0, y: 0 }, parts: [] } },
  zombiePartTex: {},
  mutationParts: {},
  invasionBubble: undefined,
} as unknown as GameAssets);

const field = (): Field => ({
  entityLayer: { addChild: () => {}, removeChild: () => {} },
  patchRestTiles: () => [],
  mausoleumId: () => null,
  inBounds: () => true,
  isPassable: () => true,
} as unknown as Field);

describe("ZombieField dye reservations", () => {
  it("removes the selected zombie while dyeing and restores that snapshot on collect", () => {
    const zombies = new ZombieField(assets(), field(), new GameState(), (key) => key === def.key ? def : undefined);
    const unit = zombies.spawn(def.key, 4, 5);
    expect(unit).toBeTruthy();
    const id = unit!.id;

    const reserved = zombies.reserveForDye(id);
    expect(reserved).toMatchObject({ id, key: def.key, stored: false });
    expect(zombies.roster()).toHaveLength(0);
    expect(zombies.sell(id)).toBeNull();

    const job = createZombieColorDyeJob({
      unitId: id,
      zombieKey: def.key,
      zombieName: reserved!.name,
      reservedZombie: reserved!,
      baseColor: [170, 159, 159],
      powderColor: "red",
      amount: 85,
      now: 0,
    });
    expect(job).toBeTruthy();
    expect(zombies.collectDye(job!)).toBe(true);

    const restored = zombies.roster()[0];
    expect(restored).toMatchObject({
      id,
      key: def.key,
      color: [255, 159, 159],
      powderStats: { red: 4 },
    });
  });
});
