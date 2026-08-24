import { describe, expect, it } from "vitest";
import { choosePlowOrigin, plowRectangle, snapPlowOrigin, uniquePlowOrigins, type PlowOrigin } from "./plowSelection";
import { PLOT } from "./Field";

describe("plow rectangle selection", () => {
  it("snaps freehand targets to the stroke's 4x4 plot lattice", () => {
    const anchor = { oc: 2, or: 6 };
    expect(snapPlowOrigin(anchor, { oc: 3, or: 7 })).toEqual(anchor);
    expect(snapPlowOrigin(anchor, { oc: 5, or: 9 })).toEqual({ oc: 6, or: 10 });
    expect(snapPlowOrigin(anchor, { oc: -1, or: 2 })).toEqual({ oc: -2, or: 2 });
  });

  it("makes a cardinal line", () => {
    expect(plowRectangle({ oc: 2, or: 6 }, { oc: 10, or: 6 })).toEqual([
      { oc: 2, or: 6 }, { oc: 6, or: 6 }, { oc: 10, or: 6 },
    ]);
  });

  it("fills a rectangle in either direction", () => {
    expect(plowRectangle({ oc: 8, or: 8 }, { oc: 4, or: 12 })).toEqual([
      { oc: 4, or: 8 }, { oc: 8, or: 8 },
      { oc: 4, or: 12 }, { oc: 8, or: 12 },
    ]);
  });

  it("snaps pointer travel to the anchor's plot lattice", () => {
    expect(plowRectangle({ oc: 0, or: 0 }, { oc: 3, or: 2 })).toHaveLength(4);
    expect(plowRectangle({ oc: 0, or: 0 }, { oc: 1, or: 1 })).toEqual([{ oc: 0, or: 0 }]);
  });

  it("deduplicates origins before committing", () => {
    expect(uniquePlowOrigins([
      { oc: 0, or: 0 }, { oc: 4, or: 0 }, { oc: 0, or: 0 },
    ])).toEqual([{ oc: 0, or: 0 }, { oc: 4, or: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// choosePlowOrigin — the reported "drag-plowing skips plots".
//
// The stroke's lattice comes from wherever the finger went down, and it is not the
// lattice the farm's existing plots sit on. Treating it as the only allowed placement
// meant a swipe running alongside an existing row silently laid nothing for exactly the
// stretch beside it, and worked at both ends — "3-4 pieces unplowed around the centre of
// my selection". Measured on a real save, the same swipe laid 12 plots or 5 depending
// only on which tile it started from, one row apart.

/** A board where `blocked` tiles are taken, so a 4x4 origin fits only in clear ground. */
const board = (blocked: Iterable<string>) => {
  const taken = new Set(blocked);
  return ({ oc, or }: PlowOrigin) => {
    if (oc < 0 || or < 0) return false;
    for (let r = or; r < or + PLOT; r++)
      for (let c = oc; c < oc + PLOT; c++) if (taken.has(`${c},${r}`)) return false;
    return true;
  };
};

/** The 4x4 block of tiles a plot at this origin covers. */
const covers = ({ oc, or }: PlowOrigin) => {
  const tiles: string[] = [];
  for (let r = or; r < or + PLOT; r++)
    for (let c = oc; c < oc + PLOT; c++) tiles.push(`${c},${r}`);
  return tiles;
};

describe("choosePlowOrigin", () => {
  it("keeps the stroke's lattice on clear ground", () => {
    const anchor = { oc: 0, or: 0 };
    const fits = board([]);
    // Every tile of the second lattice column resolves to that same square.
    for (const col of [4, 5, 6, 7]) {
      expect(choosePlowOrigin(anchor, col, 2, { oc: col - 2, or: 0 }, fits))
        .toEqual({ oc: 4, or: 0 });
    }
  });

  it("nudges off the lattice rather than laying nothing", () => {
    // Rows 0-3 are occupied, so the lattice square at or=0 cannot be laid — but there is
    // clear ground at or=4 that still sits under the pointer.
    const blocked: string[] = [];
    for (let c = 0; c < 20; c++) for (let r = 0; r < 4; r++) blocked.push(`${c},${r}`);
    const chosen = choosePlowOrigin({ oc: 0, or: 0 }, 6, 5, { oc: 4, or: 3 }, board(blocked));
    expect(chosen).not.toBeNull();
    expect(covers(chosen!)).toContain("6,5"); // still under the finger
    expect(chosen!.or).toBeGreaterThanOrEqual(4); // clear of the obstruction
  });

  it("takes the nudge closest to the lattice", () => {
    // Only or=0 is blocked; or=1 is the smallest possible departure and must win over
    // the deeper rows that would also fit.
    const blocked: string[] = [];
    for (let c = 0; c < 20; c++) blocked.push(`${c},0`);
    expect(choosePlowOrigin({ oc: 0, or: 0 }, 2, 3, { oc: 0, or: 1 }, board(blocked)))
      .toEqual({ oc: 0, or: 1 });
  });

  it("never places a plot the pointer is not standing on", () => {
    const fits = board([]);
    for (let col = 0; col < 12; col++) {
      for (let row = 0; row < 12; row++) {
        // An anchor deliberately far away, so the lattice square is nowhere near.
        const chosen = choosePlowOrigin(
          { oc: 40, or: 40 }, col, row, { oc: col - 2, or: row - 2 }, fits
        );
        if (chosen) expect(covers(chosen)).toContain(`${col},${row}`);
      }
    }
  });

  it("returns null when the ground under the pointer is genuinely full", () => {
    const blocked: string[] = [];
    for (let c = 0; c < 20; c++) for (let r = 0; r < 20; r++) blocked.push(`${c},${r}`);
    expect(choosePlowOrigin({ oc: 0, or: 0 }, 6, 6, { oc: 4, or: 4 }, board(blocked)))
      .toBeNull();
  });

  it("lays the same run of soil wherever the swipe started", () => {
    // The bug in one assertion. An existing row of plots occupies rows 4-7 across the
    // middle of the board; the player swipes along the clear ground just below it. Two
    // starts one tile apart used to give completely different results.
    const blocked: string[] = [];
    for (let c = 12; c < 40; c++) for (let r = 4; r < 8; r++) blocked.push(`${c},${r}`);

    const swipe = (startRow: number) => {
      const claimed = new Set<string>();
      const ground = board(blocked);
      const fits = (origin: PlowOrigin) =>
        ground(origin) && !covers(origin).some((t) => claimed.has(t));
      const anchor = { oc: 2, or: startRow - 2 };
      const laid: PlowOrigin[] = [];
      for (let col = 4; col < 48; col++) {
        const chosen = choosePlowOrigin(anchor, col, startRow, { oc: col - 2, or: startRow - 2 }, fits);
        if (!chosen) continue;
        laid.push(chosen);
        covers(chosen).forEach((t) => claimed.add(t));
      }
      return laid.length;
    };

    const counts = [8, 9, 10, 11].map(swipe);
    expect(new Set(counts).size, `starts gave different counts: ${counts}`).toBe(1);
    expect(counts[0]).toBeGreaterThanOrEqual(10);
  });
});
