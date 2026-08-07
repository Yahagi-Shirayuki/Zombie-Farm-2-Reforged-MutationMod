import { Container, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { PlaceableDef } from "./assets";
import { Field } from "./Field";

// A recoloured placeable (Black Fence Gate, Pink Iron Fence) is the shared base art
// plus a sprite tint. The Remove tool's hover wash used to reset to plain white on
// unhover, which stripped that tint and left the black gate showing the pale iron
// art until the farm was rebuilt — a beta tester reported exactly that.
//
// Same trick as Field.movePlot.test.ts: skip the Pixi constructor, since only the
// tint bookkeeping matters here.
const makeField = (objects: Map<string, unknown>) => {
  const field: Field = Object.create(Field.prototype);
  Object.assign(field, { objects, highlightedObj: null });
  return field;
};

const BLACK: [number, number, number] = [30, 30, 30];

const addObject = (
  objects: Map<string, unknown>, id: string, color?: [number, number, number]
) => {
  const def = { key: id, name: id, sprite: `${id}.png`, color } as unknown as PlaceableDef;
  const overlayChild = new Sprite();
  const frontOverlay = new Container();
  frontOverlay.addChild(overlayChild);
  const obj = { id, def, sprite: new Sprite(), backSprite: new Sprite(), frontOverlay };
  objects.set(id, obj);
  return { ...obj, overlayChild };
};

describe("Field.setObjectHighlight", () => {
  it("restores a recoloured object's own tint instead of white", () => {
    const objects = new Map<string, unknown>();
    const gate = addObject(objects, "fenceGate_01_closed_black", BLACK);
    const field = makeField(objects);
    const black = (30 << 16) | (30 << 8) | 30;

    field.setObjectHighlight("fenceGate_01_closed_black");
    expect(gate.sprite.tint).not.toBe(black); // washed while hovered

    field.setObjectHighlight(null);
    for (const sprite of [gate.sprite, gate.backSprite, gate.overlayChild]) {
      expect(sprite.tint).toBe(black);
    }
  });

  it("multiplies the wash into the object's colour rather than replacing it", () => {
    // 0xff7a6a x 0x1e1e1e — a black gate reads as dark red, not bare red.
    const objects = new Map<string, unknown>();
    const gate = addObject(objects, "gate", BLACK);
    const field = makeField(objects);

    field.setObjectHighlight("gate");

    const channel = (shift: number) =>
      Math.round((((0xff7a6a >> shift) & 0xff) * 30) / 255);
    expect(gate.sprite.tint).toBe((channel(16) << 16) | (channel(8) << 8) | channel(0));
    expect(gate.overlayChild.tint).toBe(gate.sprite.tint);
  });

  it("leaves an uncoloured object washed red and then plain white", () => {
    const objects = new Map<string, unknown>();
    const plain = addObject(objects, "gnome");
    const field = makeField(objects);

    field.setObjectHighlight("gnome");
    expect(plain.sprite.tint).toBe(0xff7a6a);

    field.setObjectHighlight(null);
    expect(plain.sprite.tint).toBe(0xffffff);
  });

  it("clears the previous object when the cursor moves straight to another", () => {
    const objects = new Map<string, unknown>();
    const first = addObject(objects, "a", BLACK);
    const second = addObject(objects, "b");
    const field = makeField(objects);

    field.setObjectHighlight("a");
    field.setObjectHighlight("b");

    expect(first.sprite.tint).toBe((30 << 16) | (30 << 8) | 30);
    expect(second.sprite.tint).toBe(0xff7a6a);
  });
});
