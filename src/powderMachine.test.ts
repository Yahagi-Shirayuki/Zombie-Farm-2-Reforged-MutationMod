import { describe, expect, it } from "vitest";
import {
  CRYSTAL_CROP_HARVESTS,
  emptyPowderStorage,
  rollCropCrystalHarvest,
  rollPowderGrindJob,
  sanitizePowderStorage,
} from "./powderMachine";

describe("powder machine resources", () => {
  it("maps crystal crops to their color and harvest ranges", () => {
    expect(CRYSTAL_CROP_HARVESTS).toMatchObject({
      spinalch: { color: "red", min: 5, max: 7 },
      malakale: { color: "green", min: 6, max: 8 },
      blueberyl: { color: "blue", min: 8, max: 10 },
      diamint: { color: "white", min: 10, max: 13 },
      oatnyx: { color: "black", min: 12, max: 15 },
    });
  });

  it("rolls crop crystals from each crop range and doubles fertilized harvests", () => {
    expect(rollCropCrystalHarvest("spinalch", false, () => 0))
      .toEqual({ color: "red", count: 5 });
    expect(rollCropCrystalHarvest("malakale", false, () => 0.999999))
      .toEqual({ color: "green", count: 8 });
    expect(rollCropCrystalHarvest("blueberyl", false, () => 0))
      .toEqual({ color: "blue", count: 8 });
    expect(rollCropCrystalHarvest("diamint", true, () => 0.999999))
      .toEqual({ color: "white", count: 26 });
    expect(rollCropCrystalHarvest("oatnyx", true, () => 0.999999))
      .toEqual({ color: "black", count: 30 });
    expect(rollCropCrystalHarvest("carrot", true, () => 0)).toBeNull();
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
    expect(rollPowderGrindJob({ red: 40 }, 1_000, () => 0)).toMatchObject({
      crystals: { black: 0, green: 0, blue: 0, red: 40, white: 0 },
      powders: { black: 0, green: 0, blue: 0, red: 280, white: 0 },
      finishAt: 1_000 + 2 * 60 * 60 * 1000,
    });
    expect(rollPowderGrindJob({ red: 41 }, 1_000, () => 0)).toBeNull();
  });
});
