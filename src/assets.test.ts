import { describe, expect, it } from "vitest";
import type { BoostDef, DropDef, GameAssets, PlaceableDef } from "./assets";
import { raidRewardImage } from "./assets";

const assets = {
  drops: {
    Windmill: {
      icon: "wrong-loot-atlas-cell.png",
      brains: false,
      gold: false,
      tile: "windmill",
      unique: true,
      limit: 0,
    } satisfies DropDef,
    "Rusty Fragment": {
      icon: "rusty-fragment.png",
      brains: false,
      gold: false,
      tile: "",
      unique: false,
      limit: 3,
    } satisfies DropDef,
  },
  placeables: [{ key: "windmill", sprite: "windmill.png" } as PlaceableDef],
  boosts: [{ name: "Golden Dice", icon: "golden-dice.png" } as BoostDef],
} satisfies Pick<GameAssets, "drops" | "placeables" | "boosts">;

describe("raidRewardImage", () => {
  it("uses canonical object art for placeable raid rewards", () => {
    expect(raidRewardImage(assets, "Windmill")).toMatch(/assets\/objects\/windmill\.png$/);
  });

  it("keeps loot art for trophies and boost art for consumables", () => {
    expect(raidRewardImage(assets, "Rusty Fragment")).toMatch(/assets\/raids\/loot\/rusty-fragment\.png$/);
    expect(raidRewardImage(assets, "Golden Dice")).toMatch(/assets\/boosts\/golden-dice\.png$/);
  });
});
