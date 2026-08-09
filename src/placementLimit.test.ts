import { describe, expect, it } from "vitest";
import placeables from "../public/assets/placeables.json";
import type { PlaceableDef } from "./assets";
import { MAX_ZOMBIE_POTS, noRoomForAnother, type PlacementFarm } from "./placementLimit";
import { ZOMBIE_COLOR_MIXER_BUCKET_LIMIT } from "./zombieColorMixerBucket";

const catalog = placeables as PlaceableDef[];

// loadAssets derives the functional flags from the item key, so a def here is the
// key the catalog ships plus the flag that key earns at load time.
const def = (key: string, flags: Partial<PlaceableDef>): PlaceableDef => {
  expect(catalog.some((entry) => entry.key === key), `catalog lost ${key}`).toBe(true);
  return { key, category: "functional", ...flags } as PlaceableDef;
};

const BLUE_GRAVE = def("gravestoneBlue", { graveColor: "Blue" });
const RED_GRAVE = def("gravestoneRed", { graveColor: "Red" });
const POT = def("zombieCombiner", { zombiePot: true });
const BUCKET = def("zombieColorMixerBucket", {});
const MAUSOLEUM = def("mausoleum3", { zombieStorage: true });
const PATCH = def("soil_zombiePatch", { zombiePatch: true });
const DAISY = { key: "daisy", category: "decor" } as PlaceableDef;

// An empty farm; override just the parts a case cares about.
const farm = (over: Partial<PlacementFarm> = {}): PlacementFarm => ({
  shedId: () => null,
  mausoleumId: () => null,
  patchId: () => null,
  hasGrave: () => false,
  hasPlowFree: () => false,
  hasFastWork: () => false,
  hasMutantMonolith: () => false,
  hasCombineMonolith: () => false,
  zombiePotCount: () => 0,
  zombieColorMixerBucketCount: () => 0,
  ...over,
});

describe("noRoomForAnother", () => {
  it("lets an empty farm take one of anything", () => {
    for (const entry of [BLUE_GRAVE, POT, MAUSOLEUM, PATCH, DAISY])
      expect(noRoomForAnother(entry, farm()), entry.key).toBe(false);
  });

  it("closes the door on a one-per-farm item once its copy is down", () => {
    expect(noRoomForAnother(BLUE_GRAVE, farm({ hasGrave: () => true }))).toBe(true);
    expect(noRoomForAnother(MAUSOLEUM, farm({ mausoleumId: () => "tomb" }))).toBe(true);
    expect(noRoomForAnother(PATCH, farm({ patchId: () => "patch" }))).toBe(true);
  });

  it("keeps the graves independent of each other", () => {
    const blueDown = farm({ hasGrave: (color) => color === "Blue" });
    expect(noRoomForAnother(BLUE_GRAVE, blueDown)).toBe(true);
    expect(noRoomForAnother(RED_GRAVE, blueDown)).toBe(false);
  });

  it("allows Zombie Pots up to the cap, then no more", () => {
    for (let placed = 0; placed < MAX_ZOMBIE_POTS; placed++)
      expect(noRoomForAnother(POT, farm({ zombiePotCount: () => placed })), `${placed} down`).toBe(false);
    expect(noRoomForAnother(POT, farm({ zombiePotCount: () => MAX_ZOMBIE_POTS }))).toBe(true);
  });

  it("allows Zombie Color Mixer Buckets up to their cap, then no more", () => {
    for (let placed = 0; placed < ZOMBIE_COLOR_MIXER_BUCKET_LIMIT; placed++)
      expect(noRoomForAnother(BUCKET, farm({ zombieColorMixerBucketCount: () => placed })), `${placed} down`).toBe(false);
    expect(noRoomForAnother(BUCKET, farm({
      zombieColorMixerBucketCount: () => ZOMBIE_COLOR_MIXER_BUCKET_LIMIT,
    }))).toBe(true);
  });

  it("never limits ordinary decor", () => {
    const crowded = farm({
      shedId: () => "shed", mausoleumId: () => "tomb", patchId: () => "patch",
      hasGrave: () => true, hasPlowFree: () => true, hasFastWork: () => true,
      hasMutantMonolith: () => true, hasCombineMonolith: () => true,
      zombiePotCount: () => MAX_ZOMBIE_POTS,
      zombieColorMixerBucketCount: () => ZOMBIE_COLOR_MIXER_BUCKET_LIMIT,
    });
    expect(noRoomForAnother(DAISY, crowded)).toBe(false);
  });

  it("covers all four monoliths", () => {
    const monoliths: [string, keyof PlaceableDef, keyof PlacementFarm][] = [
      ["monolithPlowing", "plowFree", "hasPlowFree"],
      ["monolithSpeed", "fastWork", "hasFastWork"],
      ["monolithMutation", "mutantMonolith", "hasMutantMonolith"],
      ["monolithCombine", "combineFast", "hasCombineMonolith"],
    ];
    for (const [key, flag, probe] of monoliths) {
      const entry = def(key, { [flag]: true });
      expect(noRoomForAnother(entry, farm({ [probe]: () => true })), key).toBe(true);
      expect(noRoomForAnother(entry, farm()), key).toBe(false);
    }
  });
});
