import { describe, expect, it } from "vitest";
import { armingSurvives } from "./placementArming";

describe("armingSurvives", () => {
  it("keeps an arming while the same def is still being placed", () => {
    expect(armingSurvives("place", "monolithZombie", "monolithZombie")).toBe(true);
  });

  it("drops an arming when placement mode is left", () => {
    expect(armingSurvives("walk", "monolithZombie", "monolithZombie")).toBe(false);
    expect(armingSurvives("move", undefined, "monolithZombie")).toBe(false);
  });

  // The bug this exists for: taking the Zombie Monolith out of the shed arms a free
  // placement, then choosing anything else in the Market swaps the def WITHOUT
  // leaving "place" mode. The surviving arming spent the shed's Monolith on the tap
  // that put the daisy down — the Monolith was destroyed, the daisy was free, and
  // the +4 army slots storing it had cost never came back.
  it("drops an arming when the Market switches to a different def", () => {
    expect(armingSurvives("place", "daisy", "monolithZombie")).toBe(false);
  });

  it("is false when nothing is armed", () => {
    expect(armingSurvives("place", "daisy", undefined)).toBe(false);
  });
});
