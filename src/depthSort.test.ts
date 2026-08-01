import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { setFootprint, sortLayer } from "./depthSort";

const make = (layer: Container, c0: number, r0: number, c1 = c0, r1 = r0, bias = 0) => {
  const n = new Container();
  setFootprint(n, c0, r0, c1, r1, bias);
  layer.addChild(n);
  return n;
};

describe("sortLayer ordering", () => {
  it("orders far entities behind near ones, actors in front on shared tiles", () => {
    const layer = new Container();
    const far = make(layer, 0, 0);
    const obj = make(layer, 2, 2, 3, 3);
    const actor = make(layer, 2, 2, 2, 2, 0.5); // standing on the object's tiles
    sortLayer(layer);
    expect(far.zIndex).toBeLessThan(obj.zIndex);
    expect(obj.zIndex).toBeLessThan(actor.zIndex);
  });

  it("re-sorts when a footprint moves to a new tile", () => {
    const layer = new Container();
    const a = make(layer, 0, 0);
    const b = make(layer, 2, 2, 3, 3);
    sortLayer(layer);
    expect(a.zIndex).toBeLessThan(b.zIndex);
    setFootprint(a, 5, 5, 5, 5); // walk past b — now in front of it
    sortLayer(layer);
    expect(a.zIndex).toBeGreaterThan(b.zIndex);
  });
});

describe("sortLayer no-op frames", () => {
  it("skips the pass entirely while no footprint changed", () => {
    const layer = new Container();
    const a = make(layer, 0, 0);
    const b = make(layer, 2, 2);
    sortLayer(layer);
    // Scramble zIndexes behind the sort's back: an idle frame must not touch them.
    a.zIndex = 99;
    b.zIndex = 98;
    sortLayer(layer);
    expect(a.zIndex).toBe(99);
    expect(b.zIndex).toBe(98);
  });

  it("treats setFootprint with unchanged values as no change", () => {
    const layer = new Container();
    const a = make(layer, 0, 0);
    const b = make(layer, 2, 2);
    sortLayer(layer);
    a.zIndex = 99;
    b.zIndex = 98;
    setFootprint(a, 0, 0, 0, 0); // same tile, same bias — a per-frame actor sync
    sortLayer(layer);
    expect(a.zIndex).toBe(99);
    expect(b.zIndex).toBe(98);
  });

  it("does not write zIndex when a moved footprint keeps the same paint order", () => {
    const layer = new Container();
    const a = make(layer, 0, 0);
    const b = make(layer, 5, 5);
    sortLayer(layer);
    let writes = 0;
    for (const n of [a, b]) {
      let z = n.zIndex;
      Object.defineProperty(n, "zIndex", {
        get: () => z,
        set: (v: number) => { writes++; z = v; },
      });
    }
    setFootprint(a, 1, 1, 1, 1); // moved, but still behind b
    sortLayer(layer);
    expect(writes).toBe(0);
    expect(a.zIndex).toBeLessThan(b.zIndex);
  });

  it("re-sorts when the layer's population changes without a footprint change", () => {
    const layer = new Container();
    const a = make(layer, 0, 0);
    const b = make(layer, 2, 2);
    sortLayer(layer);
    layer.removeChild(b);
    sortLayer(layer); // count changed — pass must run again (order still valid)
    layer.addChild(b); // re-added with its old, still-valid footprint
    b.zIndex = 0; // stale value colliding with a's
    sortLayer(layer);
    expect(b.zIndex).toBeGreaterThan(a.zIndex);
  });
});
