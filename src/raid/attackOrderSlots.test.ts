import { describe, expect, it } from "vitest";
import {
  compactOrder,
  fillSlots,
  selectedCount,
  toggleSlot,
  type OrderSlots,
} from "./attackOrderSlots";

/** Tap a run of cards in sequence, as the picker does. */
function taps(start: OrderSlots, ids: string[], cap: number): OrderSlots {
  return ids.reduce((slots, id) => toggleSlot(slots, id, cap), start);
}

describe("attack order slots", () => {
  it("fills slots front to back as cards are tapped", () => {
    expect(taps([], ["a", "b", "c"], 16)).toEqual(["a", "b", "c"]);
  });

  it("leaves the freed slot empty instead of shifting the line forward", () => {
    const picked = taps([], ["a", "b", "c", "d"], 16);
    expect(toggleSlot(picked, "b", 16)).toEqual(["a", null, "c", "d"]);
  });

  it("drops the next tap into the lowest empty slot", () => {
    const gapped = toggleSlot(taps([], ["a", "b", "c", "d"], 16), "b", 16);
    // The whole point: swapping who attacks second costs one tap out, one tap in.
    expect(toggleSlot(gapped, "e", 16)).toEqual(["a", "e", "c", "d"]);
  });

  it("fills the lowest gap first when several slots are open", () => {
    let slots = taps([], ["a", "b", "c", "d"], 16);
    slots = toggleSlot(slots, "c", 16);
    slots = toggleSlot(slots, "a", 16);
    expect(slots).toEqual([null, "b", null, "d"]);
    expect(toggleSlot(slots, "e", 16)).toEqual(["e", "b", null, "d"]);
  });

  it("appends after the last slot once the gaps are used up", () => {
    const slots = toggleSlot(["a", null, "c"], "x", 16);
    expect(toggleSlot(slots, "y", 16)).toEqual(["a", "x", "c", "y"]);
  });

  it("does not keep an empty slot on the end", () => {
    expect(toggleSlot(["a", "b", "c"], "c", 16)).toEqual(["a", "b"]);
    // ...so the freed capacity is reusable rather than stranded behind a trailing gap.
    expect(toggleSlot(["a", null], "a", 16)).toEqual([]);
  });

  it("counts gaps as free capacity against the cap", () => {
    const full = taps([], ["a", "b", "c"], 3);
    expect(toggleSlot(full, "d", 3)).toEqual(["a", "b", "c"]); // cap reached
    const gapped = toggleSlot(full, "a", 3);
    expect(selectedCount(gapped)).toBe(2);
    expect(toggleSlot(gapped, "d", 3)).toEqual(["d", "b", "c"]);
  });

  it("closes the gaps when the invasion starts", () => {
    expect(compactOrder(["a", null, "c", null, "e"])).toEqual(["a", "c", "e"]);
    expect(compactOrder([])).toEqual([]);
  });
});

describe("fillSlots", () => {
  it("keeps hand-picked zombies in place and fills the gaps around them", () => {
    expect(fillSlots([null, "mine", null], ["old-a", "old-b", "old-c"], ["mine", "old-a", "old-b", "old-c"], 4))
      .toEqual(["old-a", "mine", "old-b", "old-c"]);
  });

  it("does not let a sold zombie hold a slot", () => {
    expect(fillSlots(["gone", "kept"], [], ["kept", "fresh"], 2))
      .toEqual(["fresh", "kept"]);
  });

  it("never picks the same zombie into two slots", () => {
    const filled = fillSlots(["b"], ["b", "a", "b"], ["a", "b", "c"], 3);
    expect(filled).toEqual(["b", "a", "c"]);
    expect(new Set(compactOrder(filled)).size).toBe(3);
  });

  it("clamps to the cap", () => {
    expect(fillSlots([], [], ["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
    expect(fillSlots(["a", "b", "c"], [], ["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});
