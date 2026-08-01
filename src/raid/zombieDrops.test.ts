import { describe, expect, it } from "vitest";
import {
  DIVER_ZOMBIE_KEY,
  dropsOldMcZombie,
  EVENT_ZOMBIE_DROP_RATE,
  FOREST_ZOMBIE_KEY,
  OLD_MC_ZOMBIE_DROP_RATE,
  OLD_MC_ZOMBIE_KEY,
  rollRaidZombieDrop,
  TEDDY_ZOMBIE_KEY,
} from "./zombieDrops";

describe("rare raid zombie drops", () => {
  it("keeps Old McZombie on its existing exact 1% threshold", () => {
    expect(OLD_MC_ZOMBIE_KEY).toBe("ZombieActorOldMcZombie");
    expect(OLD_MC_ZOMBIE_DROP_RATE).toBe(0.01);
    expect(dropsOldMcZombie(1, true, 0)).toBe(true);
    expect(dropsOldMcZombie(1, true, 0.009999999)).toBe(true);
    expect(dropsOldMcZombie(1, true, 0.01)).toBe(false);
  });

  it.each([
    [7, DIVER_ZOMBIE_KEY],
    [10, FOREST_ZOMBIE_KEY],
    [11, TEDDY_ZOMBIE_KEY],
  ])("drops the configured event zombie from raid %i at exactly 0.8%%", (raidId, key) => {
    expect(EVENT_ZOMBIE_DROP_RATE).toBe(0.008);
    expect(rollRaidZombieDrop(raidId, true, 0)?.key).toBe(key);
    expect(rollRaidZombieDrop(raidId, true, 0.007999999)?.key).toBe(key);
    expect(rollRaidZombieDrop(raidId, true, 0.008)).toBeNull();
  });

  it("never drops from a loss, an unrelated invasion, or an invalid roll", () => {
    expect(rollRaidZombieDrop(7, false, 0)).toBeNull();
    expect(rollRaidZombieDrop(2, true, 0)).toBeNull();
    expect(rollRaidZombieDrop(10, true, -0.1)).toBeNull();
    expect(rollRaidZombieDrop(11, true, Number.NaN)).toBeNull();
  });
});
