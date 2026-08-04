import { describe, expect, it } from "vitest";
import {
  DIVER_ZOMBIE_KEY,
  dropsOldMcZombie,
  EVENT_ZOMBIE_DROP_RATE,
  FOREST_ZOMBIE_KEY,
  OLD_MC_ZOMBIE_DROP_RATE,
  OLD_MC_ZOMBIE_KEY,
  hasRaidZombieDrop,
  nextRaidZombieDryWins,
  RAID_ZOMBIE_PITY_WINS,
  raidZombieDropRate,
  rollRaidZombieDrop,
  rollRaidZombieDropWithPity,
  TEDDY_ZOMBIE_KEY,
  ZOMBIE_LUCK_DICE_CAP,
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

describe("Golden Dice raise the rare-zombie rate", () => {
  it("adds one base rate per die", () => {
    expect(raidZombieDropRate(1, 0)).toBeCloseTo(0.01, 10); // no dice: unchanged
    expect(raidZombieDropRate(1, 1)).toBeCloseTo(0.02, 10);
    expect(raidZombieDropRate(1, 2)).toBeCloseTo(0.03, 10);
    expect(raidZombieDropRate(1, 5)).toBeCloseTo(0.06, 10); // the five a full loot table allows
    expect(raidZombieDropRate(7, 5)).toBeCloseTo(0.048, 10); // event zombies: 0.8% base
  });

  it("widens the winning roll window accordingly", () => {
    // 0.015 misses at one die's 2%... but not at zero dice's 1%.
    expect(rollRaidZombieDrop(1, true, 0.015, 0)).toBeNull();
    expect(rollRaidZombieDrop(1, true, 0.015, 1)?.key).toBe(OLD_MC_ZOMBIE_KEY);
    expect(rollRaidZombieDrop(1, true, 0.055, 5)?.key).toBe(OLD_MC_ZOMBIE_KEY);
    expect(rollRaidZombieDrop(1, true, 0.061, 5)).toBeNull();
  });

  it("still pays nothing on a loss or for a raid with no rare zombie", () => {
    expect(rollRaidZombieDrop(1, false, 0.0, 10)).toBeNull();
    expect(rollRaidZombieDrop(2, true, 0.0, 10)).toBeNull();
    expect(raidZombieDropRate(2, 10)).toBe(0);
  });

  it("clamps a garbage or oversized dice count instead of guaranteeing the drop", () => {
    const capped = raidZombieDropRate(1, ZOMBIE_LUCK_DICE_CAP);
    expect(capped).toBeCloseTo(0.11, 10);
    expect(raidZombieDropRate(1, 10_000)).toBe(capped);
    expect(raidZombieDropRate(1, -5)).toBeCloseTo(0.01, 10);
    expect(raidZombieDropRate(1, Number.NaN)).toBeCloseTo(0.01, 10);
    expect(capped).toBeLessThan(1);
  });
});

describe("rare zombie pity floor", () => {
  const MISS = 1; // a roll above every drop rate

  it("only the four raids with a rare zombie have a streak that means anything", () => {
    expect([1, 7, 10, 11].every(hasRaidZombieDrop)).toBe(true);
    expect([2, 3, 4, 5, 6, 8, 9].some(hasRaidZombieDrop)).toBe(false);
  });

  it("withholds the zombie until the raid's dry wins reach the threshold", () => {
    for (let wins = 0; wins < RAID_ZOMBIE_PITY_WINS; wins++) {
      expect(rollRaidZombieDropWithPity(1, true, MISS, wins)).toBeNull();
    }
    expect(rollRaidZombieDropWithPity(1, true, MISS, RAID_ZOMBIE_PITY_WINS)?.key).toBe(OLD_MC_ZOMBIE_KEY);
  });

  it("guarantees each raid's own zombie", () => {
    expect(rollRaidZombieDropWithPity(7, true, MISS, RAID_ZOMBIE_PITY_WINS)?.key).toBe(DIVER_ZOMBIE_KEY);
    expect(rollRaidZombieDropWithPity(10, true, MISS, RAID_ZOMBIE_PITY_WINS)?.key).toBe(FOREST_ZOMBIE_KEY);
    expect(rollRaidZombieDropWithPity(11, true, MISS, RAID_ZOMBIE_PITY_WINS)?.key).toBe(TEDDY_ZOMBIE_KEY);
  });

  it("never conjures a zombie for a raid that has none, or for a loss", () => {
    expect(rollRaidZombieDropWithPity(2, true, MISS, 10_000)).toBeNull();
    expect(rollRaidZombieDropWithPity(1, false, MISS, RAID_ZOMBIE_PITY_WINS)).toBeNull();
  });

  it("does not override a natural drop", () => {
    expect(rollRaidZombieDropWithPity(1, true, 0, 0)?.key).toBe(OLD_MC_ZOMBIE_KEY);
  });

  it("passes dice through to the natural roll before falling back to the floor", () => {
    // Inside the diced window: a real roll, well short of the guarantee.
    expect(rollRaidZombieDropWithPity(1, true, 0.015, 0, 1)?.key).toBe(OLD_MC_ZOMBIE_KEY);
    expect(rollRaidZombieDropWithPity(1, true, 0.015, 0, 0)).toBeNull();
    // Dice don't disturb the guarantee either way.
    expect(rollRaidZombieDropWithPity(1, true, MISS, RAID_ZOMBIE_PITY_WINS, 5)?.key).toBe(OLD_MC_ZOMBIE_KEY);
  });

  it("counts dry wins up and resets whenever the zombie lands", () => {
    let dry = 0;
    for (let i = 0; i < RAID_ZOMBIE_PITY_WINS; i++) dry = nextRaidZombieDryWins(dry, false);
    expect(dry).toBe(RAID_ZOMBIE_PITY_WINS);
    const guaranteed = rollRaidZombieDropWithPity(1, true, MISS, dry);
    dry = nextRaidZombieDryWins(dry, !!guaranteed);
    expect(dry).toBe(0);
    // Collecting one starts the next streak over rather than handing out a second.
    expect(rollRaidZombieDropWithPity(1, true, MISS, dry)).toBeNull();
  });

  it("clamps the stored count and shrugs off garbage", () => {
    expect(nextRaidZombieDryWins(RAID_ZOMBIE_PITY_WINS, false)).toBe(RAID_ZOMBIE_PITY_WINS);
    expect(nextRaidZombieDryWins(9_999, false)).toBe(RAID_ZOMBIE_PITY_WINS);
    expect(nextRaidZombieDryWins(-7, false)).toBe(1);
    expect(nextRaidZombieDryWins(42, true)).toBe(0);
  });

  it("takes at most threshold+1 wins of one raid to see its zombie, however unlucky", () => {
    let dry = 0;
    let received = 0;
    for (let win = 1; win <= RAID_ZOMBIE_PITY_WINS + 1; win++) {
      const drop = rollRaidZombieDropWithPity(1, true, MISS, dry);
      if (drop) received = win;
      dry = nextRaidZombieDryWins(dry, !!drop);
    }
    expect(received).toBe(RAID_ZOMBIE_PITY_WINS + 1);
  });
});
