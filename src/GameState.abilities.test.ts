import { describe, it, expect } from "vitest";
import { GameState } from "./GameState";
import { ABILITY_TIER, TIER_BOSS } from "./zombie/traits";

// Ability unlocking is per-ABILITY, not per-tier: beating a tier's invasion boss
// (winning raid id 1..4) unlocks ONE still-locked ability of that tier per win, in
// canonical ABILITY_TIER order. These tests pin that progression.

describe("GameState ability unlocking", () => {
  it("unlocks one ability of the tier per boss win, in order", () => {
    const s = new GameState();
    const pool = ABILITY_TIER[1];

    // Nothing unlocked before the boss is ever beaten.
    expect(s.tierAbilitiesUnlocked(1)).toBe(0);
    expect(s.abilityUnlocked(pool[0])).toBe(false);

    // First win unlocks the FIRST ability only — the rest stay locked.
    s.completeRaid("1");
    expect(s.tierAbilitiesUnlocked(1)).toBe(1);
    expect(s.abilityUnlocked(pool[0])).toBe(true);
    expect(s.abilityUnlocked(pool[1])).toBe(false);

    // Second win unlocks the next one, and so on.
    s.completeRaid("1");
    expect(s.tierAbilitiesUnlocked(1)).toBe(2);
    expect(s.abilityUnlocked(pool[1])).toBe(true);
    expect(s.abilityUnlocked(pool[2])).toBe(false);
  });

  it("caps at the tier's pool size — extra wins unlock nothing new", () => {
    const s = new GameState();
    const pool = ABILITY_TIER[1];
    for (let i = 0; i < pool.length + 3; i++) s.completeRaid("1");
    expect(s.tierAbilitiesUnlocked(1)).toBe(pool.length);
    expect(pool.every((k) => s.abilityUnlocked(k))).toBe(true);
  });

  it("keeps tiers independent — beating one boss doesn't unlock another tier", () => {
    const s = new GameState();
    s.completeRaid("1");
    expect(s.tierAbilitiesUnlocked(2)).toBe(0);
    expect(s.abilityUnlocked(ABILITY_TIER[2][0])).toBe(false);
  });

  it("treats tier 0 as always unlocked without unlocking unknown keys", () => {
    const s = new GameState();
    expect(s.tierAbilitiesUnlocked(0)).toBe(ABILITY_TIER[0].length);
    expect(s.abilityUnlocked(ABILITY_TIER[0][0])).toBe(true);
    expect(s.abilityUnlocked("notARealAbility")).toBe(false);
  });

  it("uses Robots as tier 5 and keeps Aliens wired as tier 6", () => {
    const s = new GameState();
    expect(TIER_BOSS[5]).toBe("the Robots");
    expect(TIER_BOSS[6]).toBe("the Aliens");

    s.completeRaid("6");
    expect(s.tierAbilitiesUnlocked(5)).toBe(0);
    expect(s.tierAbilitiesUnlocked(6)).toBe(0);

    s.completeRaid("5");
    expect(s.tierAbilitiesUnlocked(5)).toBe(1);
    expect(s.abilityUnlocked(ABILITY_TIER[5][0])).toBe(true);
    expect(s.abilityUnlocked(ABILITY_TIER[5][1])).toBe(false);
  });
});
