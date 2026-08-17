import { describe, expect, it } from "vitest";
import {
  COST_AVOID, COST_BARRIER, COST_GATE_CLOSED, COST_GROUND, COST_PATH, COST_POND,
} from "./pathCosts";
import { findEscape, findPath, isWarpStep, type Cell, type PathOptions } from "./pathfind";

// A 20x20 field where the listed tiles are covered by objects.
function field(blocked: Cell[], w = 20, h = 20) {
  const keys = new Set(blocked.map((c) => `${c.col},${c.row}`));
  return {
    inBounds: (c: number, r: number) => c >= 0 && r >= 0 && c < w && r < h,
    passable: (c: number, r: number) =>
      c >= 0 && r >= 0 && c < w && r < h && !keys.has(`${c},${r}`),
  };
}

// Every tile of the square footprint an object of `size` anchored at (oc,or) covers.
function block(oc: number, or: number, size: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = or; r < or + size; r++)
    for (let c = oc; c < oc + size; c++) cells.push({ col: c, row: r });
  return cells;
}

describe("findPath", () => {
  it("routes around a placed object", () => {
    const f = field(block(3, 0, 3));
    const path = findPath({ col: 2, row: 1 }, { col: 7, row: 1 }, f.passable);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ col: 7, row: 1 });
    for (const cell of path) expect(f.passable(cell.col, cell.row)).toBe(true);
  });

  it("finds nothing when the goal itself is blocked", () => {
    const f = field(block(3, 3, 3));
    expect(findPath({ col: 0, row: 0 }, { col: 4, row: 4 }, f.passable)).toEqual([]);
  });

  it("walks out of an object it starts inside, then on to the goal", () => {
    // A 5x5 object; the zombie sits dead center, with no walkable neighbour.
    const f = field(block(2, 2, 5));
    const start = { col: 4, row: 4 };
    expect(f.passable(start.col, start.row)).toBe(false);

    const path = findPath(start, { col: 12, row: 12 }, f.passable, { inBounds: f.inBounds });
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ col: 12, row: 12 });
    // It leaves the obstruction and never re-enters it.
    const exit = path.findIndex((c) => f.passable(c.col, c.row));
    expect(exit).toBeGreaterThanOrEqual(0);
    for (const cell of path.slice(exit)) expect(f.passable(cell.col, cell.row)).toBe(true);
  });

  it("still escapes when the goal is unreachable from open ground", () => {
    // Trapped in a 3x3 object that a solid wall then seals off from the goal.
    const wall: Cell[] = [];
    for (let r = 0; r < 20; r++) wall.push({ col: 8, row: r });
    const f = field([...block(2, 2, 3), ...wall]);
    const start = { col: 3, row: 3 };

    const path = findPath(start, { col: 12, row: 3 }, f.passable, { inBounds: f.inBounds });
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    expect(f.passable(last.col, last.row)).toBe(true); // out of the object at least
    expect(last).not.toEqual({ col: 12, row: 3 });
  });

  it("escapes an object pinned into the field's top corner", () => {
    // The exact report: a bought zombie lands at (0,0) under an object there.
    const f = field(block(0, 0, 4));
    const path = findEscape({ col: 0, row: 0 }, f.passable, { inBounds: f.inBounds });
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    expect(f.passable(last.col, last.row)).toBe(true);
    // Only the final tile is open — the rest of the route is inside the object.
    for (const cell of path.slice(0, -1)) expect(f.passable(cell.col, cell.row)).toBe(false);
  });

  it("takes the shortest way out of an off-center position", () => {
    const f = field(block(5, 5, 5)); // covers cols/rows 5..9
    // Sitting on the object's left edge: one step west reaches open ground.
    const path = findEscape({ col: 5, row: 7 }, f.passable, { inBounds: f.inBounds });
    expect(path).toEqual([{ col: 4, row: 7 }]);
  });

  it("returns no escape from an already-walkable tile", () => {
    const f = field(block(5, 5, 2));
    expect(findEscape({ col: 1, row: 1 }, f.passable, { inBounds: f.inBounds })).toEqual([]);
  });

  it("stays inside the field instead of escaping off the edge", () => {
    // Object covers the whole left column band; the only way out is east.
    const blocked: Cell[] = [];
    for (let r = 0; r < 20; r++) for (let c = 0; c < 3; c++) blocked.push({ col: c, row: r });
    const f = field(blocked);
    const path = findEscape({ col: 0, row: 10 }, f.passable, { inBounds: f.inBounds });
    expect(path.length).toBeGreaterThan(0);
    for (const cell of path) expect(f.inBounds(cell.col, cell.row)).toBe(true);
    expect(path[path.length - 1].col).toBe(3);
  });

  it("gives up when the escape radius holds no open ground", () => {
    const f = field(block(0, 0, 20), 20, 20); // the entire field is covered
    expect(findEscape({ col: 5, row: 5 }, f.passable, { inBounds: f.inBounds })).toEqual([]);
  });
});

// ─── weighted terrain ───────────────────────────────────────────────────────────
//
// A 20x20 field of plain ground with priced tiles painted onto it. Nothing here is
// solid unless it costs Infinity, which is exactly how Field.tileCost behaves.
function priced(costs: Map<string, number>, w = 20, h = 20) {
  const inBounds = (c: number, r: number) => c >= 0 && r >= 0 && c < w && r < h;
  const cost = (c: number, r: number) =>
    inBounds(c, r) ? costs.get(`${c},${r}`) ?? COST_GROUND : Infinity;
  const opts: PathOptions = { inBounds, cost, minTileCost: COST_PATH };
  return {
    inBounds,
    cost,
    opts,
    passable: (c: number, r: number) => Number.isFinite(cost(c, r)),
    /** Total price of walking a route, the way the search charges for it. */
    price: (from: Cell, route: Cell[]) => {
      let prev = from;
      let total = 0;
      for (const c of route) {
        const diagonal = prev.col !== c.col && prev.row !== c.row;
        total += (diagonal ? 1.4142 : 1) * cost(c.col, c.row);
        prev = c;
      }
      return total;
    },
  };
}

// Paint `cost` over a rectangle of tiles.
function paint(costs: Map<string, number>, oc: number, or: number, w: number, h: number, cost: number) {
  for (let r = or; r < or + h; r++)
    for (let c = oc; c < oc + w; c++) costs.set(`${c},${r}`, cost);
  return costs;
}

describe("findPath over priced terrain", () => {
  it("drifts onto a path that runs its way", () => {
    // A road down row 5; the walk is from row 4 at one end to row 4 at the other,
    // so stepping down onto the road and back up is the cheap way to cross.
    const costs = paint(new Map(), 2, 5, 14, 1, COST_PATH);
    const f = priced(costs);
    const path = findPath({ col: 2, row: 4 }, { col: 15, row: 4 }, f.passable, f.opts);

    expect(path[path.length - 1]).toEqual({ col: 15, row: 4 });
    const onRoad = path.filter((c) => c.row === 5).length;
    expect(onRoad).toBeGreaterThan(path.length / 2);
  });

  it("walks around a small pond and through a big one", () => {
    const small = priced(paint(new Map(), 6, 6, 3, 3, COST_POND));
    const around = findPath({ col: 4, row: 7 }, { col: 11, row: 7 }, small.passable, small.opts);
    expect(around.some((c) => small.cost(c.col, c.row) === COST_POND)).toBe(false);

    // Wide enough that going round costs more than getting wet.
    const wide = priced(paint(new Map(), 6, 0, 3, 20, COST_POND));
    const through = findPath({ col: 4, row: 7 }, { col: 11, row: 7 }, wide.passable, wide.opts);
    expect(through.some((c) => wide.cost(c.col, c.row) === COST_POND)).toBe(true);
  });

  it("leaves a pen through the gate rather than the hedge", () => {
    // A hedge ring around (5..9, 5..9) with one closed gate panel in the west wall.
    const costs = new Map<string, number>();
    for (let i = 5; i <= 9; i++) {
      for (const t of [`${i},5`, `${i},9`, `5,${i}`, `9,${i}`]) costs.set(t, COST_BARRIER);
    }
    costs.set("5,7", COST_GATE_CLOSED);
    const f = priced(costs);

    const path = findPath({ col: 7, row: 7 }, { col: 1, row: 7 }, f.passable, f.opts);
    expect(path[path.length - 1]).toEqual({ col: 1, row: 7 });
    // Exactly one wall tile is crossed, and it is the gate.
    const wall = path.filter((c) => f.cost(c.col, c.row) >= COST_GATE_CLOSED);
    expect(wall).toEqual([{ col: 5, row: 7 }]);
  });

  it("costs nothing to walk out of an OPEN gate", () => {
    const costs = new Map<string, number>();
    for (let i = 5; i <= 9; i++) {
      for (const t of [`${i},5`, `${i},9`, `5,${i}`, `9,${i}`]) costs.set(t, COST_BARRIER);
    }
    costs.set("5,7", COST_GROUND); // the same gate, standing open
    const f = priced(costs);

    const path = findPath({ col: 7, row: 7 }, { col: 1, row: 7 }, f.passable, f.opts);
    expect(f.price({ col: 7, row: 7 }, path)).toBeLessThan(COST_GATE_CLOSED);
  });

  it("will not thread a diagonal hedge run", () => {
    // In iso a fence line is a diagonal of tiles. Charging a corner-cut only the
    // destination's price used to let walkers slip between two hedge tiles for free.
    const costs = new Map<string, number>();
    for (let i = 0; i < 20; i++) costs.set(`${i},${i}`, COST_BARRIER);
    const f = priced(costs);

    // Both ends sit on the same side of the line; crossing it means paying for it.
    const path = findPath({ col: 8, row: 6 }, { col: 6, row: 8 }, f.passable, f.opts);
    const crossings = path.filter((c) => c.col === c.row);
    expect(crossings.length).toBe(1); // it has to go THROUGH, not between
    expect(f.price({ col: 8, row: 6 }, path)).toBeGreaterThanOrEqual(COST_BARRIER);
  });

  it("crosses a hedge when it is walled in with no other way out", () => {
    const costs = new Map<string, number>();
    for (let i = 5; i <= 9; i++) {
      for (const t of [`${i},5`, `${i},9`, `5,${i}`, `9,${i}`]) costs.set(t, COST_BARRIER);
    }
    const f = priced(costs);

    // The old yes/no pathfinder returned nothing here and the zombie was stuck for
    // good. Ruinously expensive is not the same as impossible.
    const path = findPath({ col: 7, row: 7 }, { col: 1, row: 7 }, f.passable, f.opts);
    expect(path[path.length - 1]).toEqual({ col: 1, row: 7 });
  });
});

describe("a barrier is a wall, not just a price", () => {
  // A hedge ring around (5..9, 5..9), optionally with one panel swapped for something.
  const pen = (doorCost?: number) => {
    const costs = new Map<string, number>();
    for (let i = 5; i <= 9; i++) {
      for (const t of [`${i},5`, `${i},9`, `5,${i}`, `9,${i}`]) costs.set(t, COST_BARRIER);
    }
    if (doorCost !== undefined) costs.set("5,7", doorCost);
    const f = priced(costs);
    return { ...f, opts: { ...f.opts, avoidCost: COST_AVOID } };
  };

  it("keeps a wandering walker inside a pen instead of strolling out", () => {
    // Pricing the hedge dearly is not enough on its own: penned in, a walker has no
    // cheaper option, so the fence was no obstacle at all to anything inside it.
    const f = pen();
    expect(findPath({ col: 7, row: 7 }, { col: 1, row: 7 }, f.passable, f.opts)).toEqual([]);
  });

  it("lets it out through a gate standing open", () => {
    const f = pen(COST_GROUND);
    const path = findPath({ col: 7, row: 7 }, { col: 1, row: 7 }, f.passable, f.opts);
    expect(path[path.length - 1]).toEqual({ col: 1, row: 7 });
    expect(path).toContainEqual({ col: 5, row: 7 });
  });

  it("still obeys a walker under orders, by the cheapest way through", () => {
    // The farmer told to go somewhere only reachable through a fence has to go. A
    // SHUT gate is priced below the hedge precisely so this is where he crosses.
    const f = pen(COST_GATE_CLOSED);
    const path = findPath({ col: 7, row: 7 }, { col: 1, row: 7 }, f.passable,
      { ...f.opts, crossBarriers: true });
    expect(path[path.length - 1]).toEqual({ col: 1, row: 7 });
    expect(path.filter((c) => f.cost(c.col, c.row) >= COST_AVOID))
      .toEqual([{ col: 5, row: 7 }]);
  });

  it("goes round a barrier rather than through it whenever it can", () => {
    // A wall that stops short of the field edge: no crossing, ever, orders or not.
    const costs = new Map<string, number>();
    for (let r = 0; r < 18; r++) costs.set(`10,${r}`, COST_BARRIER);
    const f = priced(costs);
    const opts = { ...f.opts, avoidCost: COST_AVOID, crossBarriers: true };

    const path = findPath({ col: 6, row: 4 }, { col: 14, row: 4 }, f.passable, opts);
    expect(path[path.length - 1]).toEqual({ col: 14, row: 4 });
    expect(path.filter((c) => c.col === 10 && c.row < 18)).toEqual([]);
  });

  it("always lets a walker STANDING on a barrier step off it", () => {
    // An object dropped on top of one, or a hedge built around where it stood.
    // Leaving a barrier is not crossing one, so this needs no permission.
    const f = pen();
    const path = findPath({ col: 5, row: 7 }, { col: 1, row: 7 }, f.passable, f.opts);
    expect(path[path.length - 1]).toEqual({ col: 1, row: 7 });
  });
});

describe("findPath keeps its routes straight", () => {
  // How far, in tiles, the route's furthest waypoint strays sideways from the direct
  // start->goal line. A route the search picks arbitrarily among equal-priced ones
  // comes back as an L and strays by a third of the journey.
  const drift = (from: Cell, to: Cell, route: Cell[]) => {
    const dc = to.col - from.col;
    const dr = to.row - from.row;
    const span = Math.hypot(dc, dr);
    return Math.max(
      ...route.map((c) => Math.abs((c.col - from.col) * dr - (c.row - from.row) * dc) / span)
    );
  };

  it("hugs the direct line on open ground", () => {
    const f = priced(new Map());
    const from = { col: 1, row: 1 };
    const to = { col: 19, row: 7 };
    const path = findPath(from, to, f.passable, f.opts);

    expect(path[path.length - 1]).toEqual(to);
    expect(drift(from, to, path)).toBeLessThan(1);
  });

  it("still goes round the obstacle it was routed around", () => {
    const f = priced(paint(new Map(), 8, 0, 2, 10, Infinity));
    const from = { col: 4, row: 4 };
    const to = { col: 14, row: 4 };
    const path = findPath(from, to, f.passable, f.opts);

    expect(path[path.length - 1]).toEqual(to);
    for (const c of path) expect(f.passable(c.col, c.row)).toBe(true);
    // Consecutive waypoints stay adjacent — straightening must not leave a gap.
    let prev = from;
    for (const c of path) {
      expect(Math.max(Math.abs(c.col - prev.col), Math.abs(c.row - prev.row))).toBe(1);
      prev = c;
    }
  });

  it("does not pull a route off the path it was following", () => {
    // A long road with the goal one row off its far end. Following it and stepping
    // off at the end is clearly cheapest; pulling the result straight would slant it
    // across the grass beside the road, which is dearer, so it must be refused.
    const f = priced(paint(new Map(), 2, 10, 17, 1, COST_PATH));
    const path = findPath({ col: 2, row: 10 }, { col: 18, row: 9 }, f.passable, f.opts);

    expect(path[path.length - 1]).toEqual({ col: 18, row: 9 });
    const offRoad = path.filter((c) => f.cost(c.col, c.row) !== COST_PATH);
    expect(offRoad).toEqual([{ col: 18, row: 9 }]); // only the final step up
  });

  it("does not straighten a diagonal through a hedge the search went around", () => {
    const costs = new Map<string, number>();
    for (let i = 0; i < 20; i++) costs.set(`${i},${i}`, COST_BARRIER);
    costs.set("12,12", COST_GROUND); // the one gap in the line
    const f = priced(costs);

    const path = findPath({ col: 14, row: 10 }, { col: 10, row: 14 }, f.passable, f.opts);
    const crossings = path.filter((c) => c.col === c.row);
    expect(crossings).toEqual([{ col: 12, row: 12 }]);
  });
});

describe("findPath through a wormhole", () => {
  // Pads at (2,2) and (17,17), linked both ways.
  const linked = () => {
    const f = priced(new Map());
    const exits = new Map<string, Cell>([
      ["2,2", { col: 17, row: 17 }],
      ["17,17", { col: 2, row: 2 }],
    ]);
    return {
      ...f,
      opts: { ...f.opts, portal: (c: number, r: number) => exits.get(`${c},${r}`) ?? null },
    };
  };

  it("routes through the pads instead of walking the whole way", () => {
    const f = linked();
    const path = findPath({ col: 1, row: 2 }, { col: 18, row: 17 }, f.passable, f.opts);

    expect(path[path.length - 1]).toEqual({ col: 18, row: 17 });
    // On the pad, out the far pad, one step to the goal — not fifteen tiles of walk.
    expect(path).toEqual([
      { col: 2, row: 2 }, { col: 17, row: 17 }, { col: 18, row: 17 },
    ]);
  });

  it("marks the hop, and only the hop, as a warp", () => {
    const f = linked();
    const path = findPath({ col: 1, row: 2 }, { col: 18, row: 17 }, f.passable, f.opts);
    let prev: Cell = { col: 1, row: 2 };
    const warps: Cell[] = [];
    for (const c of path) {
      if (isWarpStep(prev, c)) warps.push(c);
      prev = c;
    }
    expect(warps).toEqual([{ col: 17, row: 17 }]);
  });

  it("ignores the pads when walking is shorter", () => {
    const f = linked();
    const path = findPath({ col: 10, row: 10 }, { col: 12, row: 10 }, f.passable, f.opts);
    expect(path).toEqual([{ col: 11, row: 10 }, { col: 12, row: 10 }]);
  });

  it("is a plain step when the pads are unpaired", () => {
    // One pad placed, nothing to link it to: Field withholds `portal` entirely and
    // the pad is just a tile you can stand on.
    const f = priced(new Map());
    const path = findPath({ col: 1, row: 2 }, { col: 4, row: 2 }, f.passable, f.opts);
    for (let i = 1; i < path.length; i++) expect(isWarpStep(path[i - 1], path[i])).toBe(false);
  });
});
