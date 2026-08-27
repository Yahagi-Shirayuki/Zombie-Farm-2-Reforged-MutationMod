import { describe, expect, it } from "vitest";
import {
  DAMAGE_NUMBER_GAP_SEC,
  formatHealthNumbers,
  newDamageTally,
  tallyDamage,
} from "./combatNumbers";

describe("damage numbers", () => {
  it("shows an ordinary hit the moment it lands", () => {
    expect(tallyDamage(newDamageTally(), 12, 0.05)).toBe(12);
  });

  it("holds a second hit inside the gap and shows the pair together", () => {
    const tally = newDamageTally();
    expect(tallyDamage(tally, 12, 0.05)).toBe(12);
    expect(tallyDamage(tally, 5, 0.05)).toBeNull(); // still inside the gap
    expect(tallyDamage(tally, 4, DAMAGE_NUMBER_GAP_SEC)).toBe(9); // 5 + 4, not 4
  });

  it("accumulates a burn's sub-point ticks instead of printing zeroes", () => {
    // 5 % of a 50 HP zombie per second, at the sim's 50 ms tick: 0.125 a tick. It
    // takes eight of those to be worth saying anything about.
    const tally = newDamageTally();
    const shown: (number | null)[] = [];
    for (let tick = 0; tick < 20; tick++) shown.push(tallyDamage(tally, 0.125, 0.05));
    expect(shown.filter((n) => n !== null)).toEqual([1, 1]);
    expect(shown.filter((n) => n === 0)).toHaveLength(0);
  });

  it("flushes the killing blow even inside the gap", () => {
    const tally = newDamageTally();
    expect(tallyDamage(tally, 30, 0.05)).toBe(30);
    // A dead unit gets no later flush, so the last hit has to come out now.
    expect(tallyDamage(tally, 0.4, 0.05, true)).toBe(1);
  });

  it("stays silent on a tick that did no damage", () => {
    const tally = newDamageTally();
    expect(tallyDamage(tally, 0, 0.05)).toBeNull();
    expect(tallyDamage(tally, 0, 0.05, true)).toBeNull();
  });

  it("holds a hit too small to print until it adds up, then rounds it up", () => {
    const tally = newDamageTally();
    expect(tallyDamage(tally, 0.4, 1)).toBeNull();
    expect(tallyDamage(tally, 0.4, 1)).toBeNull();
    // 1.2 pending is worth saying, and reads as the whole number nearest it.
    expect(tallyDamage(tally, 0.4, 1)).toBe(1);
  });
});

describe("health bar numbers", () => {
  it("reads HP left over the bar's maximum", () => {
    expect(formatHealthNumbers(27, 40)).toBe("27/40");
  });

  it("rounds a survivor up rather than announcing 0", () => {
    expect(formatHealthNumbers(0.2, 40)).toBe("1/40");
  });

  it("shows 0 only once the unit is actually down", () => {
    expect(formatHealthNumbers(0, 40)).toBe("0/40");
    expect(formatHealthNumbers(-5, 40)).toBe("0/40");
  });

  it("never reads above the maximum after a heal overshoot", () => {
    expect(formatHealthNumbers(44, 40)).toBe("40/40");
  });
});
