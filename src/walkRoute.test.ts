import { describe, expect, it } from "vitest";
import type { Field } from "./Field";
import { tileCenter } from "./iso";
import { COST_BARRIER, COST_GROUND, COST_PATH, COST_POND } from "./pathCosts";
import type { Cell } from "./pathfind";
import { RouteWalker, walkRoute, type Waypoint } from "./walkRoute";

// walkRoute only ever asks the field what a tile costs.
function fieldOf(costs: Map<string, number> = new Map()): Field {
  return {
    tileCost: (c: number, r: number) =>
      c >= 0 && r >= 0 && c < 30 && r < 30 ? costs.get(`${c},${r}`) ?? COST_GROUND : Infinity,
  } as unknown as Field;
}

function paint(costs: Map<string, number>, oc: number, or: number, w: number, h: number, cost: number) {
  for (let r = or; r < or + h; r++)
    for (let c = oc; c < oc + w; c++) costs.set(`${c},${r}`, cost);
  return costs;
}

// The raster route A* returns for a straight run: tile centres that zigzag half a
// tile either side of the line actually being travelled.
function line(from: Cell, to: Cell): Cell[] {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  const steps = Math.max(Math.abs(dc), Math.abs(dr));
  const out: Cell[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push({
      col: from.col + Math.round((dc * i) / steps),
      row: from.row + Math.round((dr * i) / steps),
    });
  }
  return out;
}

describe("walkRoute", () => {
  it("collapses an open-ground route to one straight leg", () => {
    const from = { col: 2, row: 2 };
    const cells = line(from, { col: 20, row: 8 });
    expect(cells.length).toBe(18); // 18 tile centres to shuffle between…

    const route = walkRoute(fieldOf(), from, tileCenter(from.col, from.row), cells);
    expect(route.length).toBe(1); // …one straight walk
    expect(route[0]).toMatchObject(tileCenter(20, 8));
  });

  it("walks to the exact point tapped, not the goal tile's centre", () => {
    const from = { col: 2, row: 2 };
    const end = { x: 123.5, y: 45.25 };
    const route = walkRoute(fieldOf(), from, tileCenter(2, 2), line(from, { col: 9, row: 5 }), end);
    expect(route[route.length - 1]).toMatchObject(end);
  });

  it("starts from where the walker actually stands", () => {
    // Mid-tile, as a farmer stopped anywhere but a centre always is. Straightening
    // from the tile centre instead would make the first leg double back.
    const from = { col: 4, row: 4 };
    const at = { x: tileCenter(4, 4).x + 9, y: tileCenter(4, 4).y - 4 };
    const route = walkRoute(fieldOf(), from, at, line(from, { col: 16, row: 10 }));
    expect(route.length).toBe(1);
  });

  it("keeps a road-hugging route on its road", () => {
    // A road along row 16 with the goal a row off its far end. Straightening the
    // whole thing would slant it across the grass beside the road, which is dearer.
    const costs = paint(new Map(), 4, 16, 16, 1, COST_PATH);
    const from = { col: 4, row: 16 };
    const cells = [...line(from, { col: 19, row: 16 }), { col: 19, row: 15 }];

    const route = walkRoute(fieldOf(costs), from, tileCenter(4, 16), cells);
    // The straight run along the road is one leg; stepping off it is another.
    expect(route.length).toBe(2);
    expect(route[0]).toMatchObject(tileCenter(19, 16));
  });

  it("will not straighten across water the route went around", () => {
    const costs = paint(new Map(), 8, 8, 4, 4, COST_POND);
    const from = { col: 6, row: 12 };
    // Round the pond's south-west corner and up its far side.
    const cells = [...line(from, { col: 12, row: 12 }), ...line({ col: 12, row: 12 }, { col: 12, row: 6 })];

    const route = walkRoute(fieldOf(costs), from, tileCenter(6, 12), cells);
    expect(route.length).toBeGreaterThan(1);
    for (const p of route) {
      expect(fieldOf(costs).tileCost(
        Math.round((p.x / 23.5 + (p.y - 11.75) / 11.75) / 2),
        Math.round(((p.y - 11.75) / 11.75 - p.x / 23.5) / 2),
      )).not.toBe(COST_POND);
    }
  });

  it("will not straighten through a hedge", () => {
    // A wall down col 10 with one gap; the route goes through the gap and must keep
    // going through it rather than being pulled into a straight line across the wall.
    const costs = new Map<string, number>();
    for (let r = 0; r < 30; r++) if (r !== 14) costs.set(`10,${r}`, COST_BARRIER);
    const from = { col: 6, row: 6 };
    const cells = [
      ...line(from, { col: 9, row: 14 }), { col: 10, row: 14 },
      ...line({ col: 10, row: 14 }, { col: 16, row: 6 }),
    ];

    const route = walkRoute(fieldOf(costs), from, tileCenter(6, 6), cells);
    const gap = tileCenter(10, 14);
    expect(route.some((p) => Math.hypot(p.x - gap.x, p.y - gap.y) < 1)).toBe(true);
  });

  it("never merges a wormhole hop into a walk", () => {
    const from = { col: 2, row: 2 };
    const cells: Cell[] = [
      { col: 3, row: 3 }, { col: 24, row: 24 }, { col: 25, row: 24 },
    ];
    const route = walkRoute(fieldOf(), from, tileCenter(2, 2), cells);

    // Arrive at the pad, jump, then walk on — three legs, exactly one of them a warp.
    expect(route.map((p) => !!p.warp)).toEqual([false, true, false]);
    expect(route[0]).toMatchObject(tileCenter(3, 3));
    expect(route[1]).toMatchObject(tileCenter(24, 24));
  });
});

// The piece the farmer and every zombie share. What each of them does with a turn or an
// arrival differs — the farmer flips an Actor, a zombie flips its own rig, and only the
// farmer runs a callback — but the walking is one implementation, so these are the
// properties both of them get.
describe("RouteWalker", () => {
  const legs = () => {
    const dxs: number[] = [];
    return { dxs, onLeg: (dx: number) => dxs.push(dx) };
  };

  it("spends a whole frame's travel across as many legs as it reaches", () => {
    // Four 10px legs in a line. Stopping dead on each waypoint and resuming next frame
    // is what used to throw away a step apiece and read as a stutter.
    const w = new RouteWalker(0, 0);
    w.setRoute([{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 }]);
    w.advance(35);
    expect(w.x).toBeCloseTo(35, 6);
    expect(w.walking).toBe(true);
  });

  it("crosses a wormhole hop for free", () => {
    // The hop is not travel: it must not eat the budget the walk on the far side needs.
    const w = new RouteWalker(0, 0);
    w.setRoute([{ x: 900, y: 0, warp: true }, { x: 910, y: 0 }]);
    w.advance(10);
    expect(w.x).toBeCloseTo(910, 6);
    expect(w.walking).toBe(false);
  });

  it("turns once per leg, and not for a leg that is barely sideways", () => {
    // A leg straight down the screen has no horizontal component; turning on the noise
    // either side of that is the twitch the deadzone exists to stop.
    const { dxs, onLeg } = legs();
    const w = new RouteWalker(0, 0, { onLeg });
    w.setRoute([{ x: 40, y: 0 }, { x: 42, y: 30 }, { x: -20, y: 60 }]);
    w.advance(1000);
    expect(dxs).toEqual([40, -62]); // the 2px middle leg never turned him
  });

  it("picks up a route handed to it by the finish hook, in the same frame", () => {
    // The farmer's arrival callback may set him walking again; that second walk starts
    // inside the same frame on what is left of the budget, rather than losing it.
    let finishes = 0;
    const w: RouteWalker = new RouteWalker(0, 0, {
      onFinish: () => {
        finishes++;
        if (finishes === 1) w.setRoute([{ x: 20, y: 0 }]);
      },
    });
    w.setRoute([{ x: 10, y: 0 }]);
    w.advance(25);
    expect(w.x).toBeCloseTo(20, 6); // walked BOTH routes — stopping at 10 is the bug
    expect(finishes).toBe(2); // and finished each of them exactly once
    expect(w.walking).toBe(false);
  });

  it("cannot be spun forever by a finish hook that always sets off again", () => {
    // The runaway guard. Without it a hook like this hangs the frame.
    let finishes = 0;
    const w: RouteWalker = new RouteWalker(0, 0, {
      onFinish: () => { finishes++; w.setRoute([{ x: w.x + 1, y: 0 }]); },
    });
    w.setRoute([{ x: 1, y: 0 }]);
    w.advance(1e6);
    expect(finishes).toBe(16);
  });

  it("abandons the route when moved or cleared", () => {
    const pending: Waypoint[] = [{ x: 50, y: 0 }];
    const w = new RouteWalker(0, 0);

    w.setRoute([...pending]);
    w.clear();
    w.advance(100);
    expect([w.x, w.walking]).toEqual([0, false]); // stands where it stood

    w.setRoute([...pending]);
    w.moveTo(7, 8);
    w.advance(100);
    expect([w.x, w.y, w.walking]).toEqual([7, 8, false]);
  });
});
