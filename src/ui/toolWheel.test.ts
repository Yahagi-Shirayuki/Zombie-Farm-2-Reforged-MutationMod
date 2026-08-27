import { describe, expect, it } from "vitest";
import {
  accumulateWheel, heldObjectName, rotateRowFor, stepWheelIndex, WHEEL_STEP_THRESHOLD,
} from "./toolWheel";

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

// Reported as no longer being able to place an item and rotate it before putting it
// down. The toolbar button and the 3 key stayed context-sensitive; this menu's row was
// made a plain tool switch and took the right-click player's only rotate with it.
describe("the rotate row knows whether something is in hand", () => {
  it("turns the object on the placement ghost", () => {
    expect(heldObjectName("place", "Ice Cream Truck", undefined)).toBe("Ice Cream Truck");
    expect(rotateRowFor("Ice Cream Truck")).toEqual({ id: "turn", label: "Turn Ice Cream Truck" });
  });

  it("turns an object the Move tool is actually carrying", () => {
    expect(heldObjectName("move", undefined, "Windmill")).toBe("Windmill");
    // ...but the Move TOOL on its own is not something in hand: it is equipped long
    // before anything is picked up with it, and Rotate there means the rotate tool.
    expect(heldObjectName("move", undefined, undefined)).toBeNull();
  });

  it("equips the Rotate tool when the player's hands are empty", () => {
    for (const mode of ["walk", "till", "plant", "remove", "rotate"]) {
      expect(heldObjectName(mode, undefined, undefined), mode).toBeNull();
    }
    expect(rotateRowFor(null)).toEqual({ id: "rotate", label: "Rotate" });
  });
});
