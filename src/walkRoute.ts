// Turning a tile route into something that looks like a walk.
//
// A* hands back a run of tiles, and following their centres one after another is a
// visibly bad way to move: even a perfectly straight route is a raster line, so its
// tile centres zigzag up to half a tile either side of the line the walker is really
// travelling. At iso scale that is a ~12px wobble every step, the sprite flips
// horizontally each time the wobble changes sign, and the walker reads as drunk.
// It never showed much while routing was rare — a straight line was the normal case
// and the search only ran when something was actually in the way — but a farm with a
// path or a wormhole on it searches for every walk, and then it is all you can see.
//
// So the waypoints are pulled straight in WORLD space before anything walks them: a
// run collapses to a single segment whenever the straight line across it is no dearer
// than the cheapest ground the run was on. Over open grass that leaves exactly one
// segment — the old direct walk, restored — while a road-hugging route keeps its road
// (grass is dearer, so the shortcut is refused) and nothing is ever straightened
// across a pond or a hedge the search went around.
import type { Field } from "./Field";
import { screenToGrid, tileCenter } from "./iso";
import { isWarpStep, type Cell } from "./pathfind";

/** A point on the route. `warp` marks the far side of a wormhole hop: the walker is
 *  moved there outright rather than travelling to it. */
export interface Waypoint {
  x: number;
  y: number;
  warp?: boolean;
}

// Half a tile height — fine enough that a segment cannot skip over a one-tile barrier.
const SAMPLE_PX = 10;

/** How much of a leg has to be sideways before a walker turns to face it. A leg
 *  straight down the screen is (col+1,row+1) — no horizontal component at all — and
 *  flipping the sprite on the noise either side of that reads as a twitch. */
const FACING_DEADZONE_PX = 4;

/** A runaway guard, not a real limit: an arrival hook that immediately sets off again
 *  would otherwise spin inside one frame forever. */
const MAX_LEGS_PER_FRAME = 16;

/** The dearest tile the straight segment (x0,y0)->(x1,y1) passes over. */
export function segmentCost(
  field: Field, x0: number, y0: number, x1: number, y1: number
): number {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / SAMPLE_PX));
  let worst = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const g = screenToGrid(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    worst = Math.max(worst, field.tileCost(Math.round(g.col), Math.round(g.row)));
    if (worst === Infinity) return Infinity;
  }
  return worst;
}

/** Tile route -> world waypoints a walker can follow smoothly.
 *
 *  `from` is the tile the walker is leaving and `at` its exact position, which is not
 *  usually a tile centre — starting the straightening from where it actually stands is
 *  what stops the first step doubling back. `end`, when given, replaces the last tile
 *  centre with the exact point that was tapped. */
export function walkRoute(
  field: Field,
  from: Cell,
  at: { x: number; y: number },
  cells: Cell[],
  end?: { x: number; y: number },
): Waypoint[] {
  const pts: Waypoint[] = [];
  const cheapest: number[] = []; // cost of the tile each waypoint sits on
  let prev = from;
  cells.forEach((c, i) => {
    const p = i === cells.length - 1 && end ? end : tileCenter(c.col, c.row);
    pts.push({ x: p.x, y: p.y, warp: isWarpStep(prev, c) });
    cheapest.push(field.tileCost(c.col, c.row));
    prev = c;
  });

  const out: Waypoint[] = [];
  let anchor = at;
  let i = 0;
  while (i < pts.length) {
    if (pts[i].warp) {
      out.push(pts[i]);
      anchor = pts[i];
      i++;
      continue;
    }
    // Reach as far ahead as the straight line stays no dearer than the cheapest
    // ground it would replace — never through a warp, which is not a walk at all.
    let end2 = i;
    let floor = cheapest[i];
    while (end2 + 1 < pts.length && !pts[end2 + 1].warp) {
      const limit = Math.min(floor, cheapest[end2 + 1]);
      if (segmentCost(field, anchor.x, anchor.y, pts[end2 + 1].x, pts[end2 + 1].y) > limit) break;
      end2++;
      floor = limit;
    }
    out.push(pts[end2]);
    anchor = pts[end2];
    i = end2 + 1;
  }
  return out;
}

/** What a walker wants told about its own progress. */
export interface RouteWalkerHooks {
  /** A leg has been taken; `dx` is its horizontal reach, already past the facing
   *  deadzone. Facing is decided per LEG rather than per frame: a frame-by-frame test
   *  flips the sprite on every wobble in the route, and a leg has one direction that
   *  the walker should commit to. */
  onLeg?(dx: number): void;
  /** The last waypoint was reached and nothing is left. May hand this same walker a
   *  new route (`setRoute` from inside the hook is picked up for the rest of the
   *  frame), which is the case MAX_LEGS_PER_FRAME exists to bound. */
  onFinish?(): void;
}

/** A position, and the waypoints it still has to walk.
 *
 *  Both walkers on the farm — the farmer and every zombie — spend one frame's travel
 *  across as many legs as it reaches. Stopping dead on each waypoint and starting
 *  again next frame threw away up to a frame's step every time, which on a
 *  straightened route with several short legs is a visible stutter rather than a walk.
 *  What they do with a turn and with an arrival differs, and that is what the hooks
 *  are for; the walking itself is one piece of code. */
export class RouteWalker {
  private pts: Waypoint[] = [];

  constructor(
    public x: number,
    public y: number,
    private hooks: RouteWalkerHooks = {},
  ) {}

  /** Is there anywhere still to go? */
  get walking(): boolean {
    return this.pts.length > 0;
  }

  /** Take a route, facing its first leg. Replaces whatever was left of the old one. */
  setRoute(pts: Waypoint[]) {
    this.pts = pts;
    if (pts.length) this.face(pts[0]);
  }

  /** Drop the route and stand still, where it stands. */
  clear() {
    this.pts = [];
  }

  /** Stand somewhere else outright, abandoning the route. */
  moveTo(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.pts = [];
  }

  /** Spend `budget` world px of travel along the route. */
  advance(budget: number) {
    for (let legs = 0; this.pts.length && budget > 0 && legs < MAX_LEGS_PER_FRAME; legs++) {
      const next = this.pts[0];
      const dx = next.x - this.x;
      const dy = next.y - this.y;
      // A wormhole hop is instant: travelling it would drag the walker over every
      // hedge and pond the pads were placed to skip.
      const dist = next.warp ? 0 : Math.hypot(dx, dy);
      if (dist > budget) {
        this.x += (dx / dist) * budget;
        this.y += (dy / dist) * budget;
        return;
      }
      budget -= dist;
      this.x = next.x;
      this.y = next.y;
      this.pts.shift();
      // The finish hook may replace `pts` wholesale; the loop re-reads it either way.
      if (this.pts.length) this.face(this.pts[0]);
      else this.hooks.onFinish?.();
    }
  }

  private face(to: Waypoint) {
    const dx = to.x - this.x;
    if (Math.abs(dx) >= FACING_DEADZONE_PX) this.hooks.onLeg?.(dx);
  }
}
