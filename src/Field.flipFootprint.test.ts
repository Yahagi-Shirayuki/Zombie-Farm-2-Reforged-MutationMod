import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { PlaceableDef } from "./assets";
import { Field, objectFootprint } from "./Field";
import { gridToScreen, HW } from "./iso";

// Turning a long decor used to leave an invisible barrier lying across the diagonal
// it USED to run down: the art mirrored but the footprint did not, so a 1x5 hedge
// turned to run east-west still blocked five tiles running north-south. Nothing
// square ever showed it (371 of the 460 placeables are square), which is why it sat
// in the game for so long. See objectFootprint for why the mirror is a transpose.
//
// Same trick as Field.objectWork.test.ts: skip the Pixi constructor and hand the
// Field only the bookkeeping these paths touch.
const HEDGE = {
  key: "hedge_01", name: "Hedge", category: "decor",
  sprite: "hedge_01.png", tileW: 1, tileH: 5,
  nativeW: 153, nativeH: 114,
} as unknown as PlaceableDef;

const TILE = { key: "daisy", name: "Daisy", category: "decor", sprite: "daisy.png", tileW: 1, tileH: 1 } as unknown as PlaceableDef;

const makeField = (w = 12, h = 12): Field => {
  const field: Field = Object.create(Field.prototype);
  Object.assign(field, {
    w, h,
    plots: new Map(),
    tilePlot: new Map(),
    reserved: new Set(),
    tileObject: new Map(),
    fenceBlock: new Map(),
    objects: new Map(),
    nextObjId: 1,
    entityLayer: new Container(),
    groundObjectLayer: new Container(),
    objectLights: new Container(),
    assets: { field: { tileW: 48 }, objects: { "hedge_01.png": Texture.EMPTY, "daisy.png": Texture.EMPTY } },
  });
  return field;
};

/** Every tile the field currently hands out to an object, as "col,row". */
const blocked = (field: Field): string[] =>
  [...(field as unknown as { tileObject: Map<string, string> }).tileObject.keys()].sort();

const footprintOf = (oc: number, or: number, w: number, h: number): string[] => {
  const out: string[] = [];
  for (let r = or; r < or + h; r++) for (let c = oc; c < oc + w; c++) out.push(`${c},${r}`);
  return out.sort();
};

describe("objectFootprint", () => {
  it("transposes a turned object and leaves a square one alone", () => {
    expect(objectFootprint({ tileW: 1, tileH: 5 }, false)).toEqual({ w: 1, h: 5 });
    expect(objectFootprint({ tileW: 1, tileH: 5 }, true)).toEqual({ w: 5, h: 1 });
    expect(objectFootprint({ tileW: 3, tileH: 3 }, true)).toEqual({ w: 3, h: 3 });
  });
});

describe("Field: a turned object blocks the tiles it is drawn over", () => {
  it("claims the transposed footprint, not the one it was authored with", () => {
    const field = makeField();
    expect(field.placeObject(HEDGE, 3, 3, "hedge", undefined, true)).toBe("hedge");
    expect(blocked(field)).toEqual(footprintOf(3, 3, 5, 1));
  });

  it("frees the tiles the old footprint used to steal", () => {
    const field = makeField();
    field.placeObject(HEDGE, 3, 3, "hedge", undefined, true);
    // (3,7) is the far end of the run the UNTURNED hedge would have covered — the
    // invisible barrier from the report. A glow flower goes there now.
    expect(field.canPlaceObject(3, 7, TILE)).toBe(true);
    expect(field.placeObject(TILE, 3, 7, "flower")).toBe("flower");
    // ...and the tiles it really does cover stay blocked.
    expect(field.canPlaceObject(7, 3, TILE)).toBe(false);
  });

  it("mirrors the art about the origin tile, so art and footprint agree", () => {
    const field = makeField();
    field.placeObject(HEDGE, 3, 3, "straight");
    const straight = (field as unknown as { objects: Map<string, { sprite: Sprite }> })
      .objects.get("straight")!.sprite.x;
    field.removeObject("straight");
    field.placeObject(HEDGE, 3, 3, "turned", undefined, true);
    const turned = (field as unknown as { objects: Map<string, { sprite: Sprite }> })
      .objects.get("turned")!.sprite.x;
    // The mirror line is the origin tile's own centre — the same reflection the
    // footprint transpose is, so the sprite lands over its blocked tiles.
    const originX = gridToScreen(3, 3).x;
    expect(turned - originX).toBeCloseTo(originX - straight, 5);
    expect(turned).toBeCloseTo(originX + 2 * HW, 5); // 1x5 turned: centre 2 tiles east
  });

  it("rejects a placement whose turned footprint runs off the farm", () => {
    const field = makeField(6, 6);
    // 5 tiles of run fit going south from (2,0) but not going east.
    expect(field.canPlaceObject(2, 0, HEDGE)).toBe(true);
    expect(field.canPlaceObject(2, 0, HEDGE, undefined, true)).toBe(false);
  });
});

describe("Field.moveObject / flipObject", () => {
  it("re-claims the transposed tiles when a carried object is turned on drop", () => {
    const field = makeField();
    field.placeObject(HEDGE, 3, 3, "hedge");
    expect(blocked(field)).toEqual(footprintOf(3, 3, 1, 5));
    expect(field.moveObject("hedge", 3, 3, true)).toBe(true);
    expect(blocked(field)).toEqual(footprintOf(3, 3, 5, 1));
  });

  it("refuses a turn with no room and leaves the occupancy untouched", () => {
    const field = makeField();
    field.placeObject(HEDGE, 3, 3, "hedge");
    field.placeObject(TILE, 6, 3, "wall"); // sits across the turned hedge's path
    const before = blocked(field);
    expect(field.flipObject("hedge")).toBe(false);
    expect(field.objectFlipOf("hedge")).toBe(false);
    expect(blocked(field)).toEqual(before);
  });

  it("turns in place when there is room", () => {
    const field = makeField();
    field.placeObject(HEDGE, 3, 3, "hedge");
    expect(field.flipObject("hedge")).toBe(true);
    expect(field.objectFlipOf("hedge")).toBe(true);
    expect(blocked(field)).toEqual(footprintOf(3, 3, 5, 1));
  });
});

describe("Field.restoreObjects with a pre-transpose save", () => {
  const resolve = (key: string) => (key === HEDGE.key ? HEDGE : undefined);

  it("nudges a turned object back inside the farm rather than dropping it", () => {
    const field = makeField(6, 6);
    // Legal when it was saved (1 wide, 5 deep from column 5); its real turned
    // footprint now needs columns 5..9, which a 6-wide farm does not have.
    field.restoreObjects([{ id: "hedge", key: "hedge_01", oc: 5, or: 0, rotation: 1 }], resolve);
    expect(field.objectOriginOf("hedge")).toEqual({ oc: 1, or: 0 });
    expect(field.objectFlipOf("hedge")).toBe(true);
  });

  it("gives up the turn before it gives up the object", () => {
    const field = makeField(3, 8); // no row anywhere can hold a 5-wide run
    field.restoreObjects([{ id: "hedge", key: "hedge_01", oc: 1, or: 1, rotation: 1 }], resolve);
    expect(field.objectOriginOf("hedge")).toEqual({ oc: 1, or: 1 });
    expect(field.objectFlipOf("hedge")).toBe(false);
  });
});
