// Drives the farmer: walks to the exact world point clicked (not a tile center),
// updates facing/animation, keeps depth (zIndex) in sync, and fires an optional
// callback on arrival (used to till/plant/harvest the destination).
//
// Movement is a straight line by default. If that straight line would cross ground
// the farmer should not just barge over — a placed object, a pond, a hedge — he
// instead routes around it via A* over the occupancy grid, walks the straightened
// result (see walkRoute), and finishes on the exact point rather than its tile centre.
// Routing is skipped when the destination tile itself is blocked (e.g. the base of a
// tree he's harvesting) so those interactions still reach their target.
import { Actor } from "./Actor";
import { Field } from "./Field";
import { screenToGrid, tileCenter } from "./iso";
import { setFootprint } from "./depthSort";
import { COST_GROUND } from "./pathCosts";
import { findPath } from "./pathfind";
import { RouteWalker, segmentCost, walkRoute } from "./walkRoute";

/** Base walk speed in world px/sec (1.2x the previous 145, user tuning). A Farmer head
 *  can raise it — the ninja masks are worth +25% — so this is the UNBUFFED figure and
 *  `setSpeedPx` is what the head bonus writes. */
export const SPEED_PX = 174;

export class WalkController {
  private speedPx = SPEED_PX;
  private walker: RouteWalker;
  private onArrive: (() => void) | null = null;

  constructor(
    private actor: Actor,
    private field: Field,
    startCol: number,
    startRow: number
  ) {
    const c = tileCenter(startCol, startRow);
    this.walker = new RouteWalker(c.x, c.y, {
      onLeg: (dx) => this.actor.setFacingFromDelta(dx),
      onFinish: () => this.finish(),
    });
    this.syncActor();
  }

  // Does the straight segment from where he stands to (x,y) cross anything dearer than
  // plain ground? Solid objects, ponds and hedges all qualify, so the farmer searches
  // for a proper route instead of ploughing through. A path is CHEAPER than ground and
  // never triggers a search — walking straight down one is already what we want.
  //
  // Same sampler the straightener uses, so the two cannot come to disagree about what
  // a segment costs.
  private lineCostly(x: number, y: number): boolean {
    return segmentCost(this.field, this.walker.x, this.walker.y, x, y) > COST_GROUND;
  }

  // Walk to an exact world-space point. Optional onArrive runs on arrival. Ignored
  // if the point is off-field. Routes around objects when the direct path is blocked.
  goToPoint(x: number, y: number, onArrive?: () => void): boolean {
    const g = screenToGrid(x, y);
    const goalC = Math.round(g.col);
    const goalR = Math.round(g.row);
    if (!this.field.inBounds(goalC, goalR)) return false;
    this.onArrive = onArrive ?? null;

    // Route properly if the straight line is costly, or if the farm holds anything
    // that could beat a beeline over open grass — a path to be drawn onto, a
    // wormhole to hop through. Otherwise the direct line already IS the best route,
    // and taking it keeps the farmer's walk smooth instead of tile-to-tile. The goal
    // tile has to be walkable either way (else A* can't reach it: fall back direct).
    const search =
      this.lineCostly(x, y) ||
      this.field.hasPortals() ||
      this.field.hasPaths();
    if (search && this.field.isPassable(goalC, goalR)) {
      const sg = screenToGrid(this.walker.x, this.walker.y);
      const from = { col: Math.round(sg.col), row: Math.round(sg.row) };
      const cells = findPath(
        from,
        { col: goalC, row: goalR },
        (c, r) => this.field.isPassable(c, r),
        // The farmer is under orders: if the only way to the tapped spot is through a
        // fence, he goes through it (by the gate, if the run has one) rather than
        // ignoring the tap. Nothing that picks its own destination gets this.
        { ...this.field.pathOptions(), crossBarriers: true }
      );
      // findPath may stop short of the goal when it only managed to walk the
      // farmer out of an object he was standing in. His arrival callback does the
      // work at the destination, so a partial route is no use here — take the
      // direct line instead, as before.
      const last = cells.length ? cells[cells.length - 1] : null;
      if (last && last.col === goalC && last.row === goalR) {
        // Straightened world waypoints, ending on the exact point tapped. Over open
        // ground this comes back as the single direct segment, so routing costs the
        // walk nothing in smoothness.
        const at = { x: this.walker.x, y: this.walker.y };
        this.walker.setRoute(walkRoute(this.field, from, at, cells, { x, y }));
        this.actor.setMoving(true);
        return true;
      }
    }
    this.walker.setRoute([{ x, y }]);
    this.actor.setMoving(true);
    return true;
  }

  // The route ran out. Stand down, then fire the arrival callback — which may set the
  // farmer walking again, so it is cleared BEFORE it runs and a re-entrant walk starts
  // with a clean one.
  private finish() {
    this.actor.setMoving(false);
    const cb = this.onArrive;
    this.onArrive = null;
    if (cb) cb();
  }

  /** Exact world position (feet). */
  get worldPos(): { x: number; y: number } {
    return { x: this.walker.x, y: this.walker.y };
  }

  get tile(): { col: number; row: number } {
    const g = screenToGrid(this.walker.x, this.walker.y);
    return { col: Math.round(g.col), row: Math.round(g.row) };
  }

  /** True while the farmer has a destination (including queued path waypoints).
   *  JobSystem uses this to stop elapsed-time catch-up as soon as all useful
   *  movement and work has completed. */
  get moving(): boolean {
    return this.walker.walking;
  }

  teleport(col: number, row: number) {
    const c = tileCenter(col, row);
    this.walker.moveTo(c.x, c.y);
    this.onArrive = null;
    this.actor.setMoving(false);
    this.syncActor();
  }

  stop() {
    this.walker.clear();
    this.onArrive = null;
    this.actor.setMoving(false);
  }

  /** Set the walk speed in world px/sec. Applied from the next frame, so a head
   *  swapped mid-stride speeds the farmer up where he stands rather than snapping
   *  him anywhere. A non-finite or non-positive value is ignored. */
  setSpeedPx(px: number) {
    if (Number.isFinite(px) && px > 0) this.speedPx = px;
  }

  update(dt: number) {
    this.walker.advance(this.speedPx * dt);
    this.actor.update(dt);
    this.syncActor();
  }

  private syncActor() {
    this.actor.container.position.set(this.walker.x, this.walker.y);
    const g = screenToGrid(this.walker.x, this.walker.y);
    const c = Math.round(g.col);
    const r = Math.round(g.row);
    // Point footprint on the farmer's foot tile; bias 0.6 > zombie 0.5 so the
    // farmer draws in front of a zombie sharing his tile.
    setFootprint(this.actor.container, c, r, c, r, 0.6);
  }
}
