import { describe, expect, it } from "vitest";
import placeables from "../public/assets/placeables.json";
import { multiplyObjectTint, objectTint, type PlaceableDef } from "./assets";

const catalog = placeables as PlaceableDef[];

describe("placeable object tint", () => {
  it("packs the original Market RGB channels for Pixi", () => {
    expect(objectTint([153, 153, 255])).toBe(0x9999ff);
    expect(objectTint([169, 100, 54])).toBe(0xa96436);
    expect(objectTint()).toBe(0xffffff);
  });

  it("combines an authored tint with the placement-state wash", () => {
    expect(multiplyObjectTint(0x9999ff, 0x9cffa0)).toBe(0x5e99a0);
    expect(multiplyObjectTint(0xffffff, 0xff8a8a)).toBe(0xff8a8a);
  });
});

describe("the catalog's authored tints", () => {
  // These tiles ship GREYSCALE art (measured mean saturation 0) and take ALL of
  // their colour from the Market tint. The generator used to emit `color` only for
  // monoliths, which rendered every one of them grey — a Hedge was a white brick.
  // If one of these loses its tint again, that regression is back.
  const GREYSCALE_ART: Record<string, [number, number, number]> = {
    hedge_01: [0, 105, 0],
    crate: [169, 115, 39],
    baloon: [255, 0, 0],
    cemeteryFence_01: [30, 30, 30],
    ironGate_01_closed: [30, 30, 30],
    ironGate_01_open: [30, 30, 30],
    outhouseNormal: [255, 151, 39],
    barrelNormal: [255, 126, 31],
    tentNormal: [212, 0, 0],
    flowerBed: [255, 153, 153],
  };

  it("colours every tile whose art carries no colour of its own", () => {
    const wrong: string[] = [];
    for (const [key, expected] of Object.entries(GREYSCALE_ART)) {
      const def = catalog.find((entry) => entry.key === key);
      if (!def) { wrong.push(`${key}: missing from the catalog`); continue; }
      if (JSON.stringify(def.color) !== JSON.stringify(expected)) {
        wrong.push(`${key}: ${JSON.stringify(def.color)} (want ${JSON.stringify(expected)})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("omits white, because a white multiply is the untinted sprite", () => {
    const identity = catalog
      .filter((entry) => entry.color && objectTint(entry.color) === 0xffffff)
      .map((entry) => entry.key);
    expect(identity).toEqual([]);
  });

  it("keeps recoloured tiles on their base tile's single sprite file", () => {
    // Colour is data. Two rows wanting the same art in different colours share the
    // file and differ in `color` — they never ship a second copy of the pixels.
    const flowerBeds = catalog.filter((entry) => /^flowerBed/.test(entry.key));
    expect(flowerBeds.length).toBeGreaterThan(1);
    expect(new Set(flowerBeds.map((entry) => entry.sprite)).size).toBe(1);
    expect(new Set(flowerBeds.map((entry) => objectTint(entry.color))).size)
      .toBe(flowerBeds.length);
  });
});
