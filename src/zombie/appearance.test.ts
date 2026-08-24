import { describe, expect, it } from "vitest";
import {
  BRUTE_EYEBALL_SCALE,
  BRUTE_ZOMBIE_EYE_TINT,
  DEFAULT_ZOMBIE_EYE_TINT,
  DEFAULT_ZOMBIE_TEETH_TINT,
  LUCKYBOX_PALETTE_STEP_MS,
  displayedAppearance,
  hasLuckyboxPalette,
  isBruteEyeball,
  luckyboxPaletteTint,
  zombiePartTint,
} from "./appearance";

describe("zombie appearance", () => {
  it("keeps default eyes light yellow while other tintable parts use the body color", () => {
    expect(zombiePartTint("defaultEyeL", 0x123456)).toBe(DEFAULT_ZOMBIE_EYE_TINT);
    expect(zombiePartTint("defaultEyeR.png", 0x123456)).toBe(DEFAULT_ZOMBIE_EYE_TINT);
    expect(zombiePartTint("defaultHead", 0x123456)).toBe(0x123456);
  });

  it("keeps teeth white and gives brute-family zombies black eyes", () => {
    expect(zombiePartTint("defaultUpperTeeth", 0x7bff4a)).toBe(DEFAULT_ZOMBIE_TEETH_TINT);
    expect(zombiePartTint("defaultLowerTeeth.png", 0xffff5f)).toBe(DEFAULT_ZOMBIE_TEETH_TINT);
    expect(zombiePartTint("defaultEyeL", 0x123456, "Large")).toBe(BRUTE_ZOMBIE_EYE_TINT);
  });

  it("draws the unit as it is by default", () => {
    const inherited: [number, number, number] = [10, 20, 30];
    expect(displayedAppearance(64, inherited, { bodyColor: "inherited", showMutations: true }))
      .toEqual({ mutation: 64, color: inherited });
  });

  it("drops the inherited tint in species colour mode, so the model catalog wins", () => {
    expect(displayedAppearance(64, [10, 20, 30], { bodyColor: "species", showMutations: true }))
      .toEqual({ mutation: 64, color: undefined });
  });

  it("hides mutations without touching the body tint", () => {
    const inherited: [number, number, number] = [10, 20, 30];
    expect(displayedAppearance(64 | 8192, inherited, { bodyColor: "inherited", showMutations: false }))
      .toEqual({ mutation: 0, color: inherited });
  });

  it("adds one-fifth-size eyeballs inside every Large zombie's eyes", () => {
    expect(BRUTE_EYEBALL_SCALE).toBe(0.2);
    expect(isBruteEyeball("Large", "defaultEyeL")).toBe(true);
    expect(isBruteEyeball("Large", "defaultEyeR.png")).toBe(true);
    expect(isBruteEyeball("Regular", "defaultEyeL")).toBe(false);
    expect(isBruteEyeball("Large", "defaultHead")).toBe(false);
  });

  it("loops Luckybox through the body-color palette one step at a time", () => {
    expect(hasLuckyboxPalette("ZombieActorLuckyboxSilver")).toBe(true);
    expect(hasLuckyboxPalette("ZombieActorLuckyboxGold")).toBe(true);
    expect(hasLuckyboxPalette("ZombieActorLuckybox")).toBe(true);
    expect(hasLuckyboxPalette("ZombieActorRegularTier1")).toBe(false);
    // Written against the shipped step rather than a fixed number of milliseconds:
    // how fast the palette cycles is a look, and retuning it should not fail a test
    // about the cycle itself. What must hold is that each colour is held for exactly
    // one step and that the 13-entry palette wraps.
    const step = LUCKYBOX_PALETTE_STEP_MS;
    expect(step).toBeGreaterThan(0);
    expect(luckyboxPaletteTint(0)).toBe(0xfc0a0a);
    expect(luckyboxPaletteTint(step - 1)).toBe(0xfc0a0a);
    expect(luckyboxPaletteTint(step)).toBe(0xfc830a);
    expect(luckyboxPaletteTint(step * 12)).toBe(0xff4f8a); // last entry
    expect(luckyboxPaletteTint(step * 13)).toBe(0xfc0a0a); // wraps to the first
  });
});
