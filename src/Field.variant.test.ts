import { describe, expect, it } from "vitest";
import {
  DIAMINT_HARVEST_GRACE_MS,
  INVADING_MINT_GROW_MS,
  cropConfigForVariant,
  invasiveMintRadiusFor,
  randomCropVariant,
  type CropConfig,
} from "./Field";
import { SEED_FILE } from "./assets";

const base: CropConfig = {
  key: "variant_crop",
  name: "Variant Crop",
  stages: [SEED_FILE, "variant_base_stage1.png", "variant_base_stage2.png"],
  growMs: 86_400_000,
  cost: 220,
  sell: 310,
  xp: 1,
  unlockLevel: 33,
  harvestIcon: "variant_base_icon.png",
  variants: [
    { stages: ["variant_0_stage1.png", "variant_0_stage2.png"], harvestIcon: "variant_0_icon.png", weight: 0.9 },
    { stages: ["variant_1_stage1.png", "variant_1_stage2.png"], harvestIcon: "variant_1_icon.png", weight: 1 },
  ],
};

describe("crop variants", () => {
  it("swaps planted stages and harvest icon while keeping the seed catalog key", () => {
    expect(cropConfigForVariant(base, 1)).toMatchObject({
      key: "variant_crop",
      stages: [SEED_FILE, "variant_1_stage1.png", "variant_1_stage2.png"],
      harvestIcon: "variant_1_icon.png",
      variant: 1,
    });
  });

  it("rolls only crops that declare variants and respects their weights", () => {
    const original = Math.random;
    try {
      Math.random = () => 0.46;
      expect(randomCropVariant(base)).toBe(0);
      Math.random = () => 0.48;
      expect(randomCropVariant(base)).toBe(1);
      expect(randomCropVariant({ ...base, variants: undefined })).toBeUndefined();
    } finally {
      Math.random = original;
    }
  });
});

describe("Diamint invasion timing", () => {
  it("extends the invasion radius once per 20 minute cycle after the harvest grace", () => {
    const readyAt = 1_000_000;
    expect(invasiveMintRadiusFor(readyAt, readyAt + DIAMINT_HARVEST_GRACE_MS - 1)).toBe(0);
    expect(invasiveMintRadiusFor(readyAt, readyAt + DIAMINT_HARVEST_GRACE_MS)).toBe(1);
    expect(invasiveMintRadiusFor(readyAt, readyAt + DIAMINT_HARVEST_GRACE_MS + INVADING_MINT_GROW_MS)).toBe(2);
    expect(invasiveMintRadiusFor(readyAt, readyAt + DIAMINT_HARVEST_GRACE_MS + INVADING_MINT_GROW_MS * 2)).toBe(3);
  });
});
