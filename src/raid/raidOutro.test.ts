import { describe, expect, it } from "vitest";
import type { SimUnit } from "./BattleSim";
import {
  advanceRaidArmy,
  RAID_EXIT_LEFT_X,
  RAID_EXIT_RIGHT_X,
  raidArmyHasExited,
} from "./raidOutro";

const player = (x: number, over: Partial<SimUnit> = {}) => ({
  team: "player", alive: true, taken: false, buddyCarrierId: null, x, ...over,
}) as SimUnit;

describe("raid army outro", () => {
  it("keeps a victorious army moving right until every visible zombie is off-stage", () => {
    const units = [player(900), player(200)];
    advanceRaidArmy(units, 1, 230, 1000);
    expect(units.map((unit) => unit.x)).toEqual([1130, 430]);
    expect(raidArmyHasExited(units, 1)).toBe(false);

    units[0].x = RAID_EXIT_RIGHT_X;
    units[1].x = RAID_EXIT_RIGHT_X;
    expect(raidArmyHasExited(units, 1)).toBe(true);
  });

  it("keeps a retreating army moving left and ignores zombies already carried away", () => {
    const walking = player(100);
    const taken = player(500, { taken: true });
    advanceRaidArmy([walking, taken], -1, 230, 1000);
    expect(walking.x).toBe(-130);
    expect(taken.x).toBe(500);
    expect(raidArmyHasExited([walking, taken], -1)).toBe(false);

    walking.x = RAID_EXIT_LEFT_X;
    expect(raidArmyHasExited([walking, taken], -1)).toBe(true);
  });
});
