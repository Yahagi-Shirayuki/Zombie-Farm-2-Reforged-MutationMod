import { describe, expect, it } from "vitest";
import {
  applyZombieColorPowder,
  applyZombiePowderStatBonus,
  createZombieColorDyeJob,
  maxUsefulZombieColorPowder,
  sanitizeDyePowderAmount,
  sanitizeZombieColorDyeJobs,
  ZOMBIE_COLOR_MIXER_DURATION_MS,
  POWDER_STAT_BONUS_CAP,
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

  it("creates and restores timed dye jobs", () => {
    const job = createZombieColorDyeJob({
      unitId: "z1",
      zombieKey: "ZombieActorRegularTier1",
      baseColor: [159, 255, 95],
      powderColor: "red",
      amount: 96,
      now: 100,
    });
    expect(job).toMatchObject({
      unitId: "z1",
      powderColor: "red",
      inputColor: [159, 255, 95],
      outputColor: [255, 255, 95],
      startedAt: 100,
      finishAt: 100 + ZOMBIE_COLOR_MIXER_DURATION_MS,
    });
    expect(sanitizeZombieColorDyeJobs({ bucket: job })).toEqual({ bucket: job });
  });

  it("awards one permanent stat per 21.25 matching powder, capped at twelve", () => {
    const red = applyZombiePowderStatBonus(undefined, undefined, "red", 85);
    expect(red.stats).toEqual({ red: 4 });
    expect(red.progress.red).toBeUndefined();

    const partial = applyZombiePowderStatBonus(undefined, undefined, "green", 20);
    expect(partial.stats).toEqual({});
    expect(partial.progress.green).toBe(80);
    const completed = applyZombiePowderStatBonus(partial.stats, partial.progress, "green", 2);
    expect(completed.stats).toEqual({ green: 1 });
    expect(completed.progress.green).toBe(3);

    const black = applyZombiePowderStatBonus(undefined, undefined, "black", 255);
    expect(black.stats).toEqual({});

    const capped = applyZombiePowderStatBonus({ red: POWDER_STAT_BONUS_CAP }, undefined, "blue", 255);
    expect(capped.stats).toEqual({ red: POWDER_STAT_BONUS_CAP });
    expect(capped.progress).toEqual({});
  });
});
