import { describe, expect, it } from "vitest";
import { cropConfigForVariant, randomCropVariant, type CropConfig } from "./Field";
import { SEED_FILE } from "./assets";

const base: CropConfig = {
  key: "pomegranite",
  name: "Pomegranite",
  stages: [SEED_FILE, "Pomegranite_4_stage1.png", "Pomegranite_4_stage2.png"],
  growMs: 86_400_000,
  cost: 220,
  sell: 310,
  xp: 1,
  unlockLevel: 33,
  harvestIcon: "pome_4_icon.png",
  variants: [
    { stages: ["Pomegranite_0_stage1.png", "Pomegranite_0_stage2.png"], harvestIcon: "pome_0_icon.png", weight: 0.9 },
    { stages: ["Pomegranite_1_stage1.png", "Pomegranite_1_stage2.png"], harvestIcon: "pome_1_icon.png", weight: 1 },
  ],
};

describe("crop variants", () => {
  it("swaps planted stages and harvest icon while keeping the seed catalog key", () => {
    expect(cropConfigForVariant(base, 1)).toMatchObject({
      key: "pomegranite",
      stages: [SEED_FILE, "Pomegranite_1_stage1.png", "Pomegranite_1_stage2.png"],
      harvestIcon: "pome_1_icon.png",
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
