import { describe, expect, it } from "vitest";
import { catalogZombieNotes } from "./zombies";

// The lines under the pre-purchase zombie card (opened by a gravestone's magnifier
// in the Market and the plot's plant picker). Everything else about that card is DOM,
// which this suite has no environment for — this is the copy worth locking down.
const card = (over: Partial<Parameters<typeof catalogZombieNotes>[0]> = {}) => ({
  cost: 55, timeLabel: "6h", level: 12, cfg: {}, ...over,
});
const noGraves = () => false;

describe("pre-purchase zombie card notes", () => {
  it("always leads with the price and grow time", () => {
    expect(catalogZombieNotes(card(), 30, noGraves)).toEqual(["55 gold · grows in 6h"]);
    expect(catalogZombieNotes(card({ cost: 3, brains: true }), 30, noGraves))
      .toEqual(["3 brains · grows in 6h"]);
  });

  it("names the level gate for a species the player cannot grow yet", () => {
    expect(catalogZombieNotes(card(), 11, noGraves)[1]).toBe("Unlocks at level 12.");
  });

  it("names the grave gate once the level is met", () => {
    const zmurf = card({ cfg: { unlockGrave: "Blue" } });
    expect(catalogZombieNotes(zmurf, 30, noGraves)[1]).toBe("Needs the Blue Grave on your farm.");
    expect(catalogZombieNotes(zmurf, 30, () => true)).toHaveLength(1); // grave owned
  });

  it("reports only the level gate while both apply", () => {
    // Reaching the level comes first, so promising a grave the player cannot use yet
    // would be the wrong next step.
    expect(catalogZombieNotes(card({ cfg: { unlockGrave: "Silver" } }), 5, noGraves))
      .toEqual(["55 gold · grows in 6h", "Unlocks at level 12."]);
  });

  it("keeps the guaranteed-mutation blurb the description parchment used to show", () => {
    const carrot = card({ description: "Starts with a guaranteed mutation: +23 Speed." });
    expect(catalogZombieNotes(carrot, 30, noGraves)).toEqual([
      "55 gold · grows in 6h",
      "Starts with a guaranteed mutation: +23 Speed.",
    ]);
  });
});
