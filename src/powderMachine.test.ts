import { describe, expect, it } from "vitest";
import {
  emptyPowderStorage,
  rollPowderGrindJob,
  pomegraniteCrystalColor,
  rollPomegraniteCrystalHarvest,
  sanitizePowderStorage,
} from "./powderMachine";

describe("powder machine resources", () => {
  it("maps pomegranite variants to crystal colors", () => {
    expect([0, 1, 2, 3, 4].map((variant) => pomegraniteCrystalColor(variant)))
      .toEqual(["black", "green", "blue", "red", "white"]);
  });

  it("rolls pomegranite crystals from 5 to 10 and doubles fertilized harvests", () => {
    expect(rollPomegraniteCrystalHarvest("pomegranite", 0, false, () => 0))
      .toEqual({ color: "black", count: 5 });
    expect(rollPomegraniteCrystalHarvest("pomegranite", 3, true, () => 0.999999))
      .toEqual({ color: "red", count: 20 });
    expect(rollPomegraniteCrystalHarvest("pomegranite", undefined, false, () => 0))
      .toEqual({ color: "white", count: 5 });
    expect(rollPomegraniteCrystalHarvest("carrot", 3, true, () => 0)).toBeNull();
  });

  it("normalizes missing powder storage counts", () => {
    expect(sanitizePowderStorage({ crystals: { red: 2.9 }, powders: { blue: -4 } })).toEqual({
      ...emptyPowderStorage(),
      crystals: { ...emptyPowderStorage().crystals, red: 2 },
    });
  });

  it("rolls a timed powder grind job", () => {
    expect(rollPowderGrindJob({ red: 2, blue: 1 }, 1_000, () => 0.999999)).toEqual({
      crystals: { black: 0, green: 0, blue: 1, red: 2, white: 0 },
      powders: { black: 0, green: 0, blue: 9, red: 18, white: 0 },
      startedAt: 1_000,
      finishAt: 1_000 + 3 * 3 * 60 * 1000,
    });
    expect(rollPowderGrindJob({ red: 21 }, 1_000, () => 0)).toBeNull();
  });
});
