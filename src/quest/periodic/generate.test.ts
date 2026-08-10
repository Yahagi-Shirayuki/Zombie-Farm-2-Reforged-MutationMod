import { describe, it, expect } from "vitest";
import plants from "../../../public/assets/plants.json";
import { XP_THRESHOLDS } from "../../GameState";
import {
  DAILY_UNLOCK_LEVEL, WEEKLY_MULTIPLIER, WEEKLY_UNLOCK_LEVEL, applyPeriodicEvents,
  claimPeriodicQuest, claimablePeriodicCount, dailyUnitXp, generatePeriodicSet,
  refreshPeriodicState, xpToNextLevel,
} from "./generate";
import { DAILY_MAX_GROW_MS } from "./templates";
import { dayIndex } from "./periods";
import { emptyPeriodicState, type PeriodicQuestState } from "./types";

const ACCOUNT = "account-under-test";
const toNext = (level: number) => xpToNextLevel(level, XP_THRESHOLDS);
const daily = (level: number, period: number, accountId = ACCOUNT) =>
  generatePeriodicSet({ accountId, scope: "daily", period, level, xpToNext: toNext(level) });
const weekly = (level: number, period: number, accountId = ACCOUNT) =>
  generatePeriodicSet({ accountId, scope: "weekly", period, level, xpToNext: toNext(level) });

const cropByName = new Map(plants.map((crop) => [crop.name, crop]));

describe("periodic quest generation", () => {
  it("is deterministic — the same account, day and level always roll the same board", () => {
    expect(daily(20, 20670)).toEqual(daily(20, 20670));
    expect(weekly(30, 2953)).toEqual(weekly(30, 2953));
  });

  it("gives two different accounts different boards on the same day", () => {
    const mine = daily(25, 20670, "account-a");
    const theirs = daily(25, 20670, "account-b-quite-different");
    expect(mine.quests.map((q) => q.text)).not.toEqual(theirs.quests.map((q) => q.text));
  });

  it("fills every daily slot: a named crop, a farm chore, and an invasion", () => {
    const set = daily(20, 20670);
    expect(set.quests).toHaveLength(3);
    expect(set.quests[0].notificationID).toBe("kCropHarvestedNotification");
    expect(set.quests[0].notificationObject).not.toBe("");
    expect(["kInvasionSuccessfulNotification", "kInvasionPerfectGameNotification"])
      .toContain(set.quests[2].notificationID);
  });

  // Rotation rather than a fair roll is the whole reason the generator has no PRNG.
  // A repeat on consecutive days is the exact failure it exists to prevent.
  it("never repeats a quest on consecutive periods", () => {
    for (let period = 20670; period < 20690; period++) {
      const today = daily(30, period).quests.map((q) => q.text);
      const tomorrow = daily(30, period + 1).quests.map((q) => q.text);
      today.forEach((text, slot) => expect(tomorrow[slot]).not.toBe(text));
    }
  });

  // Below level 20 the invasion slot has only one buildable template, so it is the
  // same every day ON PURPOSE — the two crop/chore slots carry the variety.
  it("still varies the crop and chore slots before the flawless-win variant unlocks", () => {
    for (let period = 20670; period < 20690; period++) {
      const today = daily(12, period).quests.map((q) => q.text);
      const tomorrow = daily(12, period + 1).quests.map((q) => q.text);
      expect(tomorrow[0]).not.toBe(today[0]);
      expect(tomorrow[1]).not.toBe(today[1]);
    }
  });

  it("cycles every farm chore and every weekly goal across a full rotation", () => {
    const chores = new Set<string>();
    const goals = new Set<string>();
    for (let period = 20670; period < 20678; period++) chores.add(daily(30, period).quests[1].template);
    for (let period = 2953; period < 2961; period++) goals.add(weekly(30, period).quests[0].template);
    expect(chores.size).toBeGreaterThanOrEqual(4);
    expect(goals.size).toBeGreaterThanOrEqual(4);
  });

  it("only ever names a crop the player has unlocked", () => {
    for (let level = DAILY_UNLOCK_LEVEL; level <= 45; level++) {
      for (const set of [daily(level, 20670), weekly(level, 2953)]) {
        for (const quest of set.quests) {
          const crop = cropByName.get(quest.notificationObject);
          if (!crop) continue; // wildcard or non-crop objective
          expect(crop.level).toBeLessThanOrEqual(level);
        }
      }
    }
  });

  // A daily asking you to HARVEST a 24h crop cannot be finished inside its own day
  // unless the player happened to already have a field of it planted. Planting has no
  // such constraint, which is why only the harvest objective is bounded here.
  it("keeps daily HARVEST objectives inside a grow time a day can actually cycle", () => {
    for (let level = DAILY_UNLOCK_LEVEL; level <= 45; level++) {
      for (let period = 20670; period < 20676; period++) {
        for (const quest of daily(level, period).quests) {
          if (quest.notificationID !== "kCropHarvestedNotification") continue;
          const crop = cropByName.get(quest.notificationObject);
          if (crop) expect(crop.growMs).toBeLessThanOrEqual(DAILY_MAX_GROW_MS);
        }
      }
    }
  });

  it("lets weeklies name the long crops a daily cannot", () => {
    const named: number[] = [];
    for (let period = 2953; period < 2969; period++) {
      const crop = cropByName.get(weekly(40, period).quests[0].notificationObject);
      if (crop) named.push(crop.growMs);
    }
    expect(named.some((growMs) => growMs > DAILY_MAX_GROW_MS)).toBe(true);
  });
});

describe("periodic quest rewards", () => {
  // The two anchors the curve was fitted to. They are what makes a daily feel worth
  // doing at both ends of a 28x XP curve; a flat share of the level cannot hit both.
  it("pays roughly 30 XP for a daily around level 10 and roughly 600 in the forties", () => {
    expect(dailyUnitXp(10, toNext(10))).toBeGreaterThanOrEqual(20);
    expect(dailyUnitXp(10, toNext(10))).toBeLessThanOrEqual(40);
    expect(dailyUnitXp(45, toNext(45))).toBeGreaterThanOrEqual(500);
    expect(dailyUnitXp(45, toNext(45))).toBeLessThanOrEqual(800);
  });

  it("makes one weekly worth about seven dailies", () => {
    const level = 30;
    const unit = dailyUnitXp(level, toNext(level));
    for (const quest of weekly(level, 2953).quests) {
      expect(quest.xp).toBeCloseTo(unit * WEEKLY_MULTIPLIER, -1);
    }
  });

  it("never pays zero, even at the lowest unlocked level", () => {
    for (const quest of daily(DAILY_UNLOCK_LEVEL, 20670).quests) {
      expect(quest.xp).toBeGreaterThan(0);
    }
  });

  it("keeps paying at the level cap, where there is no next level", () => {
    expect(toNext(45)).toBe(XP_THRESHOLDS[44] - XP_THRESHOLDS[43]);
    expect(daily(45, 20670).quests.every((q) => q.xp > 0)).toBe(true);
  });
});

describe("periodic quest lifecycle", () => {
  const ctx = (level: number, now: number) =>
    ({ accountId: ACCOUNT, level, xpToNext: toNext(level), now });

  it("withholds each scope until its unlock level", () => {
    const now = Date.UTC(2026, 7, 8, 12);
    const early = emptyPeriodicState();
    refreshPeriodicState(early, ctx(DAILY_UNLOCK_LEVEL - 1, now));
    expect(early.daily).toBeNull();
    expect(early.weekly).toBeNull();

    const mid = emptyPeriodicState();
    refreshPeriodicState(mid, ctx(WEEKLY_UNLOCK_LEVEL - 1, now));
    expect(mid.daily).not.toBeNull();
    expect(mid.weekly).toBeNull();

    const late = emptyPeriodicState();
    refreshPeriodicState(late, ctx(WEEKLY_UNLOCK_LEVEL, now));
    expect(late.weekly).not.toBeNull();
  });

  it("regenerates on a new day and discards unclaimed progress", () => {
    const now = Date.UTC(2026, 7, 8, 12);
    const state = emptyPeriodicState();
    refreshPeriodicState(state, ctx(30, now));
    state.daily!.counts[0] = state.daily!.quests[0].countTotal;
    const yesterday = state.daily!.period;

    expect(refreshPeriodicState(state, ctx(30, now + 60_000))).toBe(false); // same day
    expect(state.daily!.counts[0]).toBeGreaterThan(0);

    expect(refreshPeriodicState(state, ctx(30, now + 86_400_000))).toBe(true);
    expect(state.daily!.period).toBe(yesterday + 1);
    expect(state.daily!.counts).toEqual([0, 0, 0]);
    expect(state.daily!.claimed).toEqual([]);
  });

  it("freezes the reward at the level the board was generated for", () => {
    const now = Date.UTC(2026, 7, 8, 12);
    const state = emptyPeriodicState();
    refreshPeriodicState(state, ctx(20, now));
    const rewardAtGeneration = state.daily!.quests[0].xp;
    // Level up without the day changing: the board — and its rewards — must not move.
    refreshPeriodicState(state, ctx(40, now + 60_000));
    expect(state.daily!.quests[0].xp).toBe(rewardAtGeneration);
    expect(state.daily!.level).toBe(20);
  });
});

describe("periodic quest progress", () => {
  const boardAt = (level: number, now: number): PeriodicQuestState => {
    const state = emptyPeriodicState();
    refreshPeriodicState(state, { accountId: ACCOUNT, level, xpToNext: toNext(level), now });
    return state;
  };

  it("counts a matching event and ignores everything else", () => {
    const state = boardAt(30, Date.UTC(2026, 7, 8, 12));
    const invasionIndex = state.daily!.quests.findIndex(
      (q) => q.notificationID === "kInvasionSuccessfulNotification");
    applyPeriodicEvents(state, [{ type: "kInvasionSuccessfulNotification", subject: "Old McDonnell's Farm" }]);
    expect(state.daily!.counts[invasionIndex]).toBe(1);
    applyPeriodicEvents(state, [{ type: "kPhotoTakenNotification", subject: "" }]);
    expect(state.daily!.counts[invasionIndex]).toBe(1);
  });

  it("respects the named subject, so a different crop does not count", () => {
    const state = boardAt(30, Date.UTC(2026, 7, 8, 12));
    const quest = state.daily!.quests[0];
    applyPeriodicEvents(state, [{ type: quest.notificationID, subject: "Definitely Not That Crop" }]);
    expect(state.daily!.counts[0]).toBe(0);
    applyPeriodicEvents(state, [{ type: quest.notificationID, subject: quest.notificationObject }]);
    expect(state.daily!.counts[0]).toBe(1);
  });

  it("clamps at the target rather than overshooting", () => {
    const state = boardAt(30, Date.UTC(2026, 7, 8, 12));
    const quest = state.daily!.quests[0];
    const events = Array.from({ length: quest.countTotal + 25 },
      () => ({ type: quest.notificationID, subject: quest.notificationObject }));
    applyPeriodicEvents(state, events);
    expect(state.daily!.counts[0]).toBe(quest.countTotal);
  });
});

describe("periodic quest claiming", () => {
  const readyBoard = () => {
    const now = Date.UTC(2026, 7, 8, 12);
    const state = emptyPeriodicState();
    refreshPeriodicState(state, { accountId: ACCOUNT, level: 30, xpToNext: toNext(30), now });
    return state;
  };

  it("refuses a quest that is not finished", () => {
    const state = readyBoard();
    expect(claimPeriodicQuest(state, "daily", state.daily!.quests[0].id))
      .toEqual({ ok: false, error: "not_complete" });
  });

  it("pays once and refuses the second attempt", () => {
    const state = readyBoard();
    const quest = state.daily!.quests[0];
    state.daily!.counts[0] = quest.countTotal;
    expect(claimablePeriodicCount(state)).toBe(1);

    const first = claimPeriodicQuest(state, "daily", quest.id);
    expect(first).toMatchObject({ ok: true, xp: quest.xp });
    expect(claimablePeriodicCount(state)).toBe(0);
    expect(claimPeriodicQuest(state, "daily", quest.id))
      .toEqual({ ok: false, error: "already_claimed" });
  });

  // This is the expiry rule. Yesterday's ids are simply not in today's set, so a claim
  // that arrives late pays nothing rather than paying against the new board.
  it("refuses a quest id from an expired period", () => {
    const now = Date.UTC(2026, 7, 8, 12);
    const state = emptyPeriodicState();
    refreshPeriodicState(state, { accountId: ACCOUNT, level: 30, xpToNext: toNext(30), now });
    const stale = state.daily!.quests[0];
    state.daily!.counts[0] = stale.countTotal;

    refreshPeriodicState(state, { accountId: ACCOUNT, level: 30, xpToNext: toNext(30), now: now + 86_400_000 });
    const result = claimPeriodicQuest(state, "daily", stale.id);
    // A different template today → unknown id. The same template → freshly zeroed.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["no_such_quest", "not_complete"]).toContain(result.error);
  });

  it("refuses a scope the player has not unlocked", () => {
    const now = Date.UTC(2026, 7, 8, 12);
    const state = emptyPeriodicState();
    refreshPeriodicState(state, { accountId: ACCOUNT, level: 10, xpToNext: toNext(10), now });
    expect(claimPeriodicQuest(state, "weekly", "weekly_invade"))
      .toEqual({ ok: false, error: "no_such_scope" });
  });

  it("puts today's board on today's day index", () => {
    const now = Date.UTC(2026, 7, 8, 12);
    const state = emptyPeriodicState();
    refreshPeriodicState(state, { accountId: ACCOUNT, level: 30, xpToNext: toNext(30), now });
    expect(state.daily!.period).toBe(dayIndex(now));
  });
});
