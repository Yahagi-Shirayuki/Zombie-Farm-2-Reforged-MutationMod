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

  it("orders fenced plots as rear fence, plot content, near fence", () => {
    const PLOT = 4;
    const layer = new Container();
    const currentBack = make(layer, PLOT, PLOT, PLOT * 2 - 1, PLOT * 2 - 1, -0.12);
    const currentCrop = make(layer, PLOT, PLOT, PLOT * 2 - 1, PLOT * 2 - 1);
    const currentFront = make(layer, PLOT, PLOT, PLOT * 2 - 1, PLOT * 2 - 1, 0.12);
    const nwFront = make(layer, 0, PLOT, PLOT - 1, PLOT * 2 - 1, 0.12);
    const neFront = make(layer, PLOT, 0, PLOT * 2 - 1, PLOT - 1, 0.12);
    const swBack = make(layer, PLOT, PLOT * 2, PLOT * 2 - 1, PLOT * 3 - 1, -0.12);
    const seBack = make(layer, PLOT * 2, PLOT, PLOT * 3 - 1, PLOT * 2 - 1, -0.12);

    sortLayer(layer);

    expect(currentBack.zIndex).toBeLessThan(currentCrop.zIndex);
    expect(currentCrop.zIndex).toBeLessThan(currentFront.zIndex);
    expect(nwFront.zIndex).toBeLessThan(currentBack.zIndex);
    expect(neFront.zIndex).toBeLessThan(currentBack.zIndex);
    expect(currentFront.zIndex).toBeLessThan(swBack.zIndex);
    expect(currentFront.zIndex).toBeLessThan(seBack.zIndex);
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

// The live sort is a bitset/typed-array rewrite of a plain adjacency-list topo-sort
// (it stopped rebuilding an O(n²) edge list every frame). It is a pure optimisation:
// the paint order it produces must stay bit-identical, including the arbitrary-looking
// cases — perpendicular pairs, whose edge direction falls out of CHILD ORDER, and
// cycle leftovers. This reference is the original implementation, kept as the oracle.
type Ref = { c0: number; r0: number; c1: number; r1: number; bias: number };

function referenceOrder(fps: Ref[]): number[] {
  const behind = (a: Ref, b: Ref) => a.c1 < b.c0 || a.r1 < b.r0;
  const key = (f: Ref) => f.c0 + f.r0 + f.bias;
  const before = (a: Ref, b: Ref) => {
    const ka = key(a), kb = key(b);
    if (ka !== kb) return ka < kb;
    if (a.r0 !== b.r0) return a.r0 < b.r0;
    return a.c0 < b.c0;
  };
  const n = fps.length;
  const after: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (behind(fps[a], fps[b])) { after[a].push(b); indeg[b]++; }
      else if (behind(fps[b], fps[a])) { after[b].push(a); indeg[a]++; }
    }
  }
  const done = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  while (order.length < n) {
    let pick = -1;
    let cycleFallback = -1;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      if (cycleFallback === -1 || before(fps[i], fps[cycleFallback])) cycleFallback = i;
      if (indeg[i] !== 0) continue;
      if (pick === -1 || before(fps[i], fps[pick])) pick = i;
    }
    if (pick === -1) pick = cycleFallback;
    done[pick] = true;
    order.push(pick);
    for (const b of after[pick]) indeg[b]--;
  }
  return order;
}

/** Deterministic PRNG so a failing seed is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe("sortLayer matches the reference topological sort", () => {
  const cases = [
    { name: "point actors on a crowded grid", size: 12, span: 1, biased: true, n: 40 },
    { name: "mixed multi-tile objects and actors", size: 16, span: 4, biased: true, n: 60 },
    { name: "wide overlapping footprints (cycle-prone)", size: 6, span: 5, biased: false, n: 30 },
    { name: "sparse farm", size: 30, span: 3, biased: true, n: 80 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const rand = rng(seed * 7919 + c.n);
        const layer = new Container();
        const fps: Ref[] = [];
        for (let i = 0; i < c.n; i++) {
          const c0 = Math.floor(rand() * c.size);
          const r0 = Math.floor(rand() * c.size);
          const w = 1 + Math.floor(rand() * c.span);
          const h = 1 + Math.floor(rand() * c.span);
          const bias = c.biased ? [0, 0.4, 0.5, 0.6][Math.floor(rand() * 4)] : 0;
          fps.push({ c0, r0, c1: c0 + w - 1, r1: r0 + h - 1, bias });
          make(layer, c0, r0, c0 + w - 1, r0 + h - 1, bias);
        }
        sortLayer(layer);
        const expected = referenceOrder(fps);
        const actual = layer.children
          .map((node, index) => ({ index, z: node.zIndex }))
          .sort((a, b) => a.z - b.z)
          .map((entry) => entry.index);
        expect(actual, `seed ${seed}`).toEqual(expected);
      }
    });
  }
});
