import { describe, expect, it } from "vitest";
import { accumulateWheel, stepWheelIndex, WHEEL_STEP_THRESHOLD } from "./toolWheel";

describe("tool menu highlight", () => {
  it("wraps around both ends", () => {
    expect(stepWheelIndex(0, 1, 6)).toBe(1);
    expect(stepWheelIndex(5, 1, 6)).toBe(0);
    expect(stepWheelIndex(0, -1, 6)).toBe(5);
  });

  it("survives an empty menu", () => {
    expect(stepWheelIndex(0, 1, 0)).toBe(0);
  });
});

describe("wheel gesture accumulation", () => {
  it("moves one row per notch, in the scroll direction", () => {
    expect(accumulateWheel(0, 120)).toEqual({ total: 0, step: 1 });
    expect(accumulateWheel(0, -120)).toEqual({ total: 0, step: -1 });
  });

  it("banks small trackpad deltas until they add up to a row", () => {
    // A trackpad emits many sub-notch events; one row per flick, not per event.
    let total = 0;
    let steps = 0;
    for (let i = 0; i < 4; i++) {
      const r = accumulateWheel(total, WHEEL_STEP_THRESHOLD / 2);
      total = r.total;
      steps += r.step;
    }
    expect(steps).toBe(2);
  });

  it("drops the remainder so a reversal starts from zero", () => {
    const { total } = accumulateWheel(0, WHEEL_STEP_THRESHOLD * 3);
    expect(total).toBe(0);
  });
});
