import { describe, expect, it } from "vitest";
import {
  favouriteCrop, mergeFarmStats, newFarmStats, sanitizeFarmStats, totalHarvested,
} from "./stats";
import { buildStatsView, daysBetween, formatCount, type StatsViewInput } from "./statsView";

const NOW = 1_800_000_000_000;

function input(over: Partial<StatsViewInput> = {}): StatsViewInput {
  return {
    stats: newFarmStats(NOW),
    now: NOW,
    name: "Zoe",
    level: 12,
    xp: 3400,
    gold: 4200,
    brains: 7,
    zombiesDeployed: 9,
    zombieMax: 16,
    zombiesStored: 0,
    speciesDiscovered: 14,
    speciesTotal: 69,
    mutationsDiscovered: 5,
    mutationsTotal: 16,
    cropName: (key) => ({ carrot: "Carrot", pumpkin: "Pumpkin" })[key],
    ...over,
  };
}

const rowsOf = (sections: ReturnType<typeof buildStatsView>, title: string) =>
  sections.find((section) => section.title === title)!.rows;
const valueOf = (sections: ReturnType<typeof buildStatsView>, title: string, label: string) =>
  rowsOf(sections, title).find((row) => row.label === label)!;

describe("formatting", () => {
  it("groups thousands the same way in every locale", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(1_234_567)).toBe("1,234,567");
  });

  it("counts whole days, and never a negative one", () => {
    expect(daysBetween(NOW, NOW)).toBe(0);
    expect(daysBetween(NOW - 86_400_000 * 3 - 5, NOW)).toBe(3);
    // A device clock that jumped backwards must not report a farm from the future.
    expect(daysBetween(NOW + 86_400_000, NOW)).toBe(0);
  });
});

describe("the Statistics panel's rows", () => {
  it("names the crop harvested most, with its count", () => {
    const stats = newFarmStats(NOW);
    stats.harvested = { carrot: 120, pumpkin: 340 };
    const view = buildStatsView(input({ stats }));

    expect(valueOf(view, "Farming", "Favourite crop")).toEqual({
      label: "Favourite crop", value: "Pumpkin", note: "340 harvested",
    });
    expect(valueOf(view, "Farming", "Crops harvested").value).toBe("460");
  });

  it("falls back to the crop key when the catalog no longer knows it", () => {
    const stats = newFarmStats(NOW);
    stats.harvested = { seasonal_gourd: 9 };
    const view = buildStatsView(input({ stats }));

    expect(valueOf(view, "Farming", "Favourite crop").value).toBe("seasonal_gourd");
  });

  it("says so plainly on a farm that has harvested nothing", () => {
    const view = buildStatsView(input());

    expect(valueOf(view, "Farming", "Favourite crop")).toEqual({
      label: "Favourite crop", value: "—", note: "Nothing harvested yet",
    });
    expect(valueOf(view, "Invasions", "Win rate")).toEqual({
      label: "Win rate", value: "—", note: "No invasions fought yet",
    });
  });

  it("does not divide by zero on the win rate, and rounds it once fights exist", () => {
    const stats = newFarmStats(NOW);
    stats.raidsWon = 7;
    stats.raidsLost = 3;
    const view = buildStatsView(input({ stats }));

    expect(valueOf(view, "Invasions", "Win rate")).toEqual({
      label: "Win rate", value: "70%", note: "10 fought",
    });
  });

  it("mentions the Mausoleum only when something is kept in it", () => {
    expect(valueOf(buildStatsView(input()), "Zombies", "Zombies on the farm").note)
      .toBeUndefined();
    expect(valueOf(buildStatsView(input({ zombiesStored: 3 })), "Zombies", "Zombies on the farm"))
      .toEqual({ label: "Zombies on the farm", value: "9 / 16", note: "3 more in the Mausoleum" });
  });

  it("keeps current balances and lifetime totals apart", () => {
    const stats = newFarmStats(NOW);
    stats.goldEarned = 190_000;
    stats.goldSpent = 185_800;
    const view = buildStatsView(input({ stats, gold: 4200 }));

    expect(valueOf(view, "Wealth", "Gold").value).toBe("4,200");
    expect(valueOf(view, "Wealth", "Gold earned").value).toBe("190,000");
    expect(valueOf(view, "Wealth", "Gold spent").value).toBe("185,800");
  });
});

describe("the tally itself", () => {
  it("breaks a favourite-crop tie on the key, so the answer does not wander", () => {
    const stats = newFarmStats(NOW);
    stats.harvested = { pumpkin: 40, carrot: 40 };
    expect(favouriteCrop(stats)).toEqual({ key: "carrot", count: 40 });
    // Same tally, opposite insertion order — same answer.
    const other = newFarmStats(NOW);
    other.harvested = { carrot: 40, pumpkin: 40 };
    expect(favouriteCrop(other)).toEqual({ key: "carrot", count: 40 });
  });

  it("reads a damaged blob back as zeroes rather than NaN", () => {
    const restored = sanitizeFarmStats(
      { plowed: "many", goldEarned: -50, harvested: { carrot: "lots", pumpkin: 12 } },
      NOW,
    );

    expect(restored.plowed).toBe(0);
    expect(restored.goldEarned).toBe(0);
    expect(restored.harvested).toEqual({ pumpkin: 12 });
    expect(totalHarvested(restored)).toBe(12);
    expect(restored.startedAt).toBe(NOW);
  });

  it("keeps a real tally, and never dates a farm in the future", () => {
    const kept = sanitizeFarmStats(
      { startedAt: NOW - 86_400_000, plowed: 12, harvested: { carrot: 3 } }, NOW,
    );
    expect(kept.startedAt).toBe(NOW - 86_400_000);
    expect(kept.plowed).toBe(12);

    const skewed = sanitizeFarmStats({ startedAt: NOW + 86_400_000 }, NOW);
    expect(skewed.startedAt).toBe(NOW);
  });
});

// Two copies of ONE farm's tally, from two devices. The presentation blob is written
// wholesale, so the loser of a version CAS has to fold the winner's counts in or the
// account silently rolls back to whatever the last writer happened to have counted.
describe("folding two devices' tallies together", () => {
  it("keeps the higher of every counter", () => {
    const mine = newFarmStats(NOW);
    mine.plowed = 40;
    mine.raidsWon = 2;
    const theirs = newFarmStats(NOW);
    theirs.plowed = 12;
    theirs.raidsWon = 7;

    const merged = mergeFarmStats(mine, theirs);

    expect(merged.plowed).toBe(40);
    expect(merged.raidsWon).toBe(7);
  });

  it("keeps the higher count per crop, and every crop either side has seen", () => {
    const mine = newFarmStats(NOW);
    mine.harvested = { carrot: 100, turnip: 5 };
    const theirs = newFarmStats(NOW);
    theirs.harvested = { carrot: 90, pumpkin: 60 };

    expect(mergeFarmStats(mine, theirs).harvested)
      .toEqual({ carrot: 100, turnip: 5, pumpkin: 60 });
  });

  it("dates the farm from the earlier claim", () => {
    const older = newFarmStats(NOW - 86_400_000 * 30);
    const newer = newFarmStats(NOW);

    expect(mergeFarmStats(newer, older).startedAt).toBe(older.startedAt);
    expect(mergeFarmStats(older, newer).startedAt).toBe(older.startedAt);
  });

  it("is symmetric, so it cannot matter which side asked", () => {
    const mine = newFarmStats(NOW - 1000);
    mine.plowed = 40;
    mine.harvested = { carrot: 100 };
    const theirs = newFarmStats(NOW);
    theirs.raidsWon = 7;
    theirs.harvested = { pumpkin: 60 };

    expect(mergeFarmStats(mine, theirs)).toEqual(mergeFarmStats(theirs, mine));
  });

  it("never lowers a counter, whichever way round it is folded", () => {
    const ahead = newFarmStats(NOW);
    ahead.goldEarned = 190_000;
    const behind = newFarmStats(NOW);
    behind.goldEarned = 12;

    expect(mergeFarmStats(behind, ahead).goldEarned).toBe(190_000);
    expect(mergeFarmStats(ahead, behind).goldEarned).toBe(190_000);
  });
});
