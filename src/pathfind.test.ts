import { describe, expect, it } from "vitest";
import { findEscape, findPath, type Cell } from "./pathfind";

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
