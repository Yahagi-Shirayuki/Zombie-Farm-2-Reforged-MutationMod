import { Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { PlaceableDef } from "./assets";
import { Field } from "./Field";

// The Zombie Pot ships three tiles in the source — bare while idle, lid clamped on
// while a combine cooks, the new zombie's arm out once it is done — and the farm
// swaps between them as the job runs. All three share the pot's footprint and
// ground point, so only which texture is showing may change.
//
// Same trick as Field.objectHighlight.test.ts: skip the Pixi constructor, since
// only the sprite bookkeeping matters here.
const IDLE = Texture.EMPTY;
const COOKING = new Texture();
const DONE = new Texture();

const POT = {
  key: "zombieCombiner",
  name: "Zombie Pot",
  sprite: "zombieCombiner.png",
  busySprite: "zombieCombiner_cooking.png",
  readySprite: "zombieCombiner_done.png",
  tileW: 3,
  tileH: 3,
  zombiePot: true,
} as unknown as PlaceableDef;

const makeField = (def: PlaceableDef = POT) => {
  const field: Field = Object.create(Field.prototype);
  const sprite = new Sprite();
  const obj = { id: "pot1", def, oc: 4, or: 4, sprite, readyAt: 0, ready: false, flipped: false };
  Object.assign(field, {
    objects: new Map([["pot1", obj]]),
    assets: {
      field: { tileW: 48 },
      objects: {
        "zombieCombiner.png": IDLE,
        "zombieCombiner_cooking.png": COOKING,
        "zombieCombiner_done.png": DONE,
      },
    },
  });
  return { field, obj, sprite };
};

describe("Field.setObjectWork", () => {
  it("puts the lid on while a combine cooks and takes it off when idle", () => {
    const { field, sprite } = makeField();

    expect(field.setObjectWork("pot1", "busy")).toBe(true);
    expect(sprite.texture).toBe(COOKING);
    const cooking = { x: sprite.x, y: sprite.y };

    expect(field.setObjectWork("pot1", null)).toBe(true);
    expect(sprite.texture).toBe(IDLE);
    // Cooking art is taller than the idle pot, but bottom-center anchored, so the
    // pot stays exactly where it stood — the lid grows upward.
    expect(sprite.anchor.y).toBe(1);
    expect({ x: sprite.x, y: sprite.y }).toEqual(cooking);
  });

  it("shows the finished-combine art once the job is ready", () => {
    const { field, sprite } = makeField();
    field.setObjectWork("pot1", "busy");
    expect(field.setObjectWork("pot1", "ready")).toBe(true);
    expect(sprite.texture).toBe(DONE);
  });

  it("keeps the lid on for a ready job when there is no finished art", () => {
    const { field, sprite } = makeField({ ...POT, readySprite: undefined });
    field.setObjectWork("pot1", "ready");
    expect(sprite.texture).toBe(COOKING);
  });

  it("repaints only on a state change, since the pot loop calls it every frame", () => {
    const { field } = makeField();
    expect(field.setObjectWork("pot1", "busy")).toBe(true);
    expect(field.setObjectWork("pot1", "busy")).toBe(false);
  });

  it("ignores objects with no working-state art", () => {
    const { field, sprite } = makeField({ ...POT, busySprite: undefined });
    expect(field.setObjectWork("pot1", "busy")).toBe(false);
    expect(sprite.texture).toBe(Texture.EMPTY);
  });
});
