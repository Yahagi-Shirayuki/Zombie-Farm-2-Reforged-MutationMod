import { describe, expect, it } from "vitest";
import {
  applyZombieColorPowder,
  maxUsefulZombieColorPowder,
  sanitizeDyePowderAmount,
} from "./zombieColorMixerBucket";

describe("Zombie Color Mixer Bucket", () => {
  it("adds primary powder to its channel before subtracting overflow from the others", () => {
    expect(applyZombieColorPowder([159, 159, 159], "red", 96)).toMatchObject({
      color: [255, 159, 159],
      amountUsed: 96,
    });
    expect(applyZombieColorPowder([159, 159, 159], "red", 255)).toMatchObject({
      color: [255, 0, 0],
      amountUsed: 255,
    });
  });

  it("stops primary powder once the zombie is fully that colour", () => {
    const result = applyZombieColorPowder([255, 0, 0], "red", 1);
    expect(result.color).toEqual([255, 0, 0]);
    expect(result.amountUsed).toBe(0);
    expect(result.stopReason).toContain("too red");
    expect(maxUsefulZombieColorPowder([255, 0, 0], "red")).toBe(0);
  });

  it("white and black move all channels toward their caps", () => {
    expect(applyZombieColorPowder([250, 253, 255], "white", 10)).toMatchObject({
      color: [255, 255, 255],
      amountUsed: 5,
    });
    expect(applyZombieColorPowder([2, 5, 0], "black", 10)).toMatchObject({
      color: [0, 0, 0],
      amountUsed: 5,
    });
  });

  it("normalizes typed powder amounts", () => {
    expect(sanitizeDyePowderAmount("")).toBe(1);
    expect(sanitizeDyePowderAmount("3.9")).toBe(3);
    expect(sanitizeDyePowderAmount("-3")).toBe(1);
    expect(sanitizeDyePowderAmount("900")).toBe(255);
  });
});
