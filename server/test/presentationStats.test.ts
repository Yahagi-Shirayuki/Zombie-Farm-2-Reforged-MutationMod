import { describe, expect, it } from "vitest";
import { statsToCarryForward, validStatsBlob } from "../src/index";

/** The client's lifetime tally as it actually rides the presentation blob
 *  (client src/stats.ts → SaveManager.presentation → PUT /presentation `ui.stats`). */
function stats(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startedAt: 1_700_000_000_000,
    harvested: { carrot: 412, "zombie-crop_regular": 30 },
    planted: 500, plowed: 480, treesHarvested: 12,
    goldEarned: 190_000, goldSpent: 175_400,
    brainsEarned: 42, brainsSpent: 30,
    zombiesGrown: 30, zombiesCombined: 9, zombiesSold: 4, zombiesLost: 6,
    raidsWon: 22, raidsLost: 5,
    ...over,
  };
}

describe("presentation ui.stats validation", () => {
  it("accepts the blob the client writes, and its absence", () => {
    expect(validStatsBlob(stats())).toBe(true);
    expect(validStatsBlob(undefined)).toBe(true);
    // A first-time tally: no crop has been harvested yet.
    expect(validStatsBlob(stats({ harvested: {} }))).toBe(true);
  });

  // A client one version ahead adds a counter this Worker has never heard of. It must
  // stay accepted: an unknown key rejecting the blob would silently stop that client's
  // object positions and zombie names from saving at all (same reasoning as `fallen`).
  it("accepts a counter a newer client added", () => {
    expect(validStatsBlob(stats({ giftsSent: 3 }))).toBe(true);
  });

  it("refuses anything that is not a tally", () => {
    for (const bad of [null, [], "stats", 7, [stats()]]) {
      expect(validStatsBlob(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses counters that are not whole, non-negative numbers", () => {
    for (const bad of [
      stats({ plowed: -1 }),
      stats({ plowed: 1.5 }),
      stats({ plowed: "480" }),
      stats({ plowed: Number.MAX_VALUE }),
      stats({ goldEarned: null }),
    ]) {
      expect(validStatsBlob(bad), JSON.stringify(bad.plowed ?? bad.goldEarned)).toBe(false);
    }
  });

  it("bounds the per-crop map so the blob cannot be a dumping ground", () => {
    const many = Object.fromEntries(
      Array.from({ length: 513 }, (_, i) => [`crop${i}`, 1])
    );
    expect(validStatsBlob(stats({ harvested: many }))).toBe(false);
    expect(validStatsBlob(stats({ harvested: { "bad key!": 2 } }))).toBe(false);
    expect(validStatsBlob(stats({ harvested: { carrot: -3 } }))).toBe(false);
    expect(validStatsBlob(stats({ harvested: [1] }))).toBe(false);
  });
});

// A client built before the tally existed writes a `ui` blob with no `stats` in it.
// The blob is stored WHOLESALE, so taking that write verbatim erases the account's
// counters — the exact "played on my other device and lost my numbers" report.
describe("carrying a tally past an older client", () => {
  const kept = { plowed: 480, harvested: { carrot: 412 } };

  it("keeps the stored tally when the write says nothing about it", () => {
    const incoming = { ui: { attackOrder: [], teams: [] } };
    const stored = { ui: { attackOrder: ["z1"], teams: [], stats: kept } };

    expect(statsToCarryForward(incoming, stored)).toEqual(kept);
  });

  it("lets a client that sends one own it", () => {
    const incoming = { ui: { teams: [], stats: { plowed: 500 } } };
    const stored = { ui: { stats: kept } };

    // Undefined = store the write as it stands. The counters are client-authored.
    expect(statsToCarryForward(incoming, stored)).toBeUndefined();
  });

  it("has nothing to carry on an account that has never had one", () => {
    expect(statsToCarryForward({ ui: { teams: [] } }, { ui: { teams: [] } })).toBeUndefined();
    expect(statsToCarryForward({ ui: { teams: [] } }, null)).toBeUndefined();
    expect(statsToCarryForward({ camera: { x: 1 } }, {})).toBeUndefined();
  });

  it("carries one forward even when the write drops the ui blob entirely", () => {
    expect(statsToCarryForward({ camera: { x: 1 } }, { ui: { stats: kept } })).toEqual(kept);
  });
});
