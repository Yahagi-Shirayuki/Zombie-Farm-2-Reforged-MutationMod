import { describe, expect, it } from "vitest";
import type { Actor } from "./Actor";
import type { Field } from "./Field";
import { tileCenter } from "./iso";
import { COST_GROUND, COST_PATH } from "./pathCosts";
import { SPEED_PX, WalkController } from "./WalkController";

// A farmer rig reduced to the three things the controller touches, plus a record of
// every facing change so a flicker shows up as a number.
function actorStub() {
  const container = { position: { set() {} }, scale: { x: 1 } };
  let facing = 1;
  let flips = 0;
  return {
    get flips() { return flips; },
    actor: {
      container,
      setMoving() {},
      update() {},
      setFacingFromDelta(dx: number) {
        const next = dx > 0.01 ? -1 : dx < -0.01 ? 1 : facing;
        if (next !== facing) { facing = next; flips++; }
      },
    } as unknown as Actor,
  };
}

function fieldOf(costs: Map<string, number> = new Map()): Field {
  const inBounds = (c: number, r: number) => c >= 0 && r >= 0 && c < 30 && r < 30;
  const tileCost = (c: number, r: number) =>
    inBounds(c, r) ? costs.get(`${c},${r}`) ?? COST_GROUND : Infinity;
  return {
    inBounds,
    tileCost,
    isPassable: (c: number, r: number) => Number.isFinite(tileCost(c, r)),
    isOpenGround: (c: number, r: number) => tileCost(c, r) < 100,
    hasPortals: () => false,
    hasPaths: () => [...costs.values()].some((v) => v < COST_GROUND),
    pathOptions: () => ({ inBounds, cost: tileCost, minTileCost: COST_PATH }),
  } as unknown as Field;
}

// Walk to a point and report the per-frame displacement of every whole frame.
function walkTo(field: Field, from: [number, number], to: [number, number]) {
  const rig = actorStub();
  const walk = new WalkController(rig.actor, field, from[0], from[1]);
  const goal = tileCenter(to[0], to[1]);
  walk.goToPoint(goal.x, goal.y);
  const steps: number[] = [];
  let prev = walk.worldPos;
  for (let i = 0; i < 2000 && walk.moving; i++) {
    walk.update(1 / 60);
    const now = walk.worldPos;
    steps.push(Math.hypot(now.x - prev.x, now.y - prev.y));
    prev = now;
  }
  return { steps, flips: rig.flips, tile: walk.tile };
}

describe("the farmer's walk holds a steady pace", () => {
  const PER_FRAME = SPEED_PX / 60;

  it("crosses open ground at exactly one frame's travel per frame", () => {
    const { steps, flips, tile } = walkTo(fieldOf(), [2, 2], [20, 8]);
    expect(tile).toEqual({ col: 20, row: 8 });
    // Every frame but the last (which only covers the remainder) is a full step.
    for (const step of steps.slice(0, -1)) expect(step).toBeCloseTo(PER_FRAME, 6);
    expect(flips).toBe(1); // turns once, at the start, and stays turned
  });

  it("does not stall on a waypoint when it has to route", () => {
    // A road it will follow, so the walk is several legs rather than one — the case
    // where stopping dead on each waypoint used to cost a frame of travel apiece.
    const costs = new Map<string, number>();
    for (let c = 4; c < 20; c++) costs.set(`${c},16`, COST_PATH);
    const { steps, flips } = walkTo(fieldOf(costs), [3, 15], [21, 15]);

    // A frame that spans a corner covers slightly less ground in a straight line than
    // it travels, but never a fraction of it: no frame may lose most of its step.
    for (const step of steps.slice(0, -1)) expect(step).toBeGreaterThan(PER_FRAME * 0.8);
    expect(flips).toBeLessThanOrEqual(2);
  });

  it("keeps facing steady across a route that jinks", () => {
    // Round an obstacle and back: the sprite should turn where the route turns, not
    // once per frame of raster wobble.
    const costs = new Map<string, number>();
    for (let r = 4; r < 12; r++) costs.set(`10,${r}`, Infinity);
    const { flips, tile } = walkTo(fieldOf(costs), [6, 6], [16, 6]);
    expect(tile).toEqual({ col: 16, row: 6 });
    expect(flips).toBeLessThanOrEqual(3);
  });
});
