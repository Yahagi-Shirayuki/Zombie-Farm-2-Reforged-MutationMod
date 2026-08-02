import { describe, expect, it } from "vitest";
import placeables from "../public/assets/placeables.json";
import { placeablePurchaseLimit, type PlaceableDef } from "./assets";

const def = (key: string, category: PlaceableDef["category"]) => ({ key, category });

describe("placeablePurchaseLimit", () => {
  it("limits ordinary functional items to one owned copy", () => {
    expect(placeablePurchaseLimit(def("gravestoneBlue", "functional"))).toBe(1);
    expect(placeablePurchaseLimit(def("mausoleum3", "functional"))).toBe(1);
  });

  it("treats the Pet Pen as a one-per-farm functional building", () => {
    // The pen's slots are shared, so a second pen does nothing. Being `functional`
    // is what caps it at one AND puts it in the Market's Functional Items tab —
    // the server derives the same limit from this category, so it must not drift
    // back to `decor` (see FUNCTIONAL_OVERRIDE_TILES in tools/prep_placeables.py).
    const pen = (placeables as PlaceableDef[]).find((entry) => entry.key === "pettingZoo");
    expect(pen?.category).toBe("functional");
    expect(placeablePurchaseLimit(pen!)).toBe(1);
  });

  it("allows three Zombie Pots and leaves non-functional items unlimited", () => {
    expect(placeablePurchaseLimit(def("zombieCombiner", "functional"))).toBe(3);
    expect(placeablePurchaseLimit(def("daisy", "decor"))).toBeUndefined();
  });
});
