// The Reforged achievements as the AUTHORITATIVE server sees them: present in the
// catalog it grants from, gated by level, and paying the brain bonus the imported
// single-rewardType format cannot express.
import { describe, it, expect } from "vitest";
import { QUEST_DEFINITIONS, questDefinition } from "../src/questCatalog";
import { applyQuestEvents } from "../src/v3/engine";
import { XP_THRESHOLDS } from "../src/levels";
import type { QuestProjection } from "../../src/net/protocol";

const quests = (): QuestProjection => ({ version: 0, completed: [], progress: [] });
const balanceAtLevel = (level: number) => ({ gold: 0, brains: 0, xp: XP_THRESHOLDS[level - 1] });

describe("reforged achievements — server catalog", () => {
  it("carries the authored quests alongside the imported ones", () => {
    expect(questDefinition("20005")).toBeTruthy();
    expect(questDefinition("0")).toBeTruthy(); // imported still there
    expect(questDefinition("29999")).toBeUndefined();
  });

  it("leaves every imported quest's brain bonus at zero", () => {
    for (const [id, def] of Object.entries(QUEST_DEFINITIONS)) {
      if (Number(id) >= 20000) continue;
      expect(def.rewardBrains ?? 0, id).toBe(0);
    }
  });
});

describe("reforged achievements — granting", () => {
  it("pays the XP and the brain together when the quest completes", () => {
    const balance = balanceAtLevel(20); // "Bring Home a Legend" gates at 15
    const state = quests();
    const before = balance.xp;
    const changes = applyQuestEvents(balance, state, [
      // The rare invasion zombie arrives as loot under its own name, carrying the
      // generic alias the quest actually names.
      { type: "kLootItemWonNotification", subject: "Old McZombie", aliases: ["Rare Invasion Zombie"] },
    ]);
    expect(changes.some((c) => c.questId === "20005" && c.completed)).toBe(true);
    expect(state.completed).toContain("20005");
    expect(balance.xp).toBe(before + 400);
    expect(balance.brains).toBe(1);
  });

  it("does not count an ordinary loot drop toward it", () => {
    const balance = balanceAtLevel(20);
    const state = quests();
    applyQuestEvents(balance, state, [{ type: "kLootItemWonNotification", subject: "Bonus Gold" }]);
    expect(state.completed).not.toContain("20005");
    expect(balance.brains).toBe(0);
  });

  it("holds an achievement back until its level gate is met", () => {
    const balance = balanceAtLevel(5); // below the level-15 gate
    const state = quests();
    applyQuestEvents(balance, state, [
      { type: "kLootItemWonNotification", subject: "Old McZombie", aliases: ["Rare Invasion Zombie"] },
    ]);
    expect(state.completed).not.toContain("20005");
    expect(balance.brains).toBe(0);
  });

  it("completes the prerequisite first and then advances its successor", () => {
    const balance = balanceAtLevel(35); // past Nine Lives' level-30 gate
    const state = quests();
    const revive = { type: "kZombieResurrectedNotification", subject: "" };

    // The real shape of it: one revive per fight, each arriving in its own settlement.
    applyQuestEvents(balance, state, [revive]);
    expect(state.completed).toContain("20006"); // Second Wind
    expect(state.completed).not.toContain("20011"); // Nine Lives, now active at 1/25

    for (let i = 0; i < 23; i++) applyQuestEvents(balance, state, [revive]);
    expect(state.completed).not.toContain("20011"); // 24/25
    applyQuestEvents(balance, state, [revive]);
    expect(state.completed).toContain("20011");
  });

  // ENGINE PROPERTY, documented rather than guarded: applyQuestEvents sweeps the
  // catalog once, so a prerequisite satisfied during that sweep is already `completed`
  // by the time its successor is judged — a batch big enough to finish both finishes
  // both. It predates these quests (every imported chain behaves the same) and cannot
  // be reached by this pair in play: one Garden zombie revives once per invasion, and
  // each invasion settles in its own request, so 25 revives can never share a batch.
  // Asserted so a future change to that iteration order is a deliberate decision.
  it("finishes a whole chain in one sweep when a single batch satisfies all of it", () => {
    const balance = balanceAtLevel(35);
    const state = quests();
    const revives = Array.from({ length: 25 }, () => ({
      type: "kZombieResurrectedNotification", subject: "",
    }));
    applyQuestEvents(balance, state, revives);
    expect(state.completed).toEqual(expect.arrayContaining(["20006", "20011"]));
  });

  it("counts an elite win toward the elite ladder but not an ordinary one", () => {
    const balance = balanceAtLevel(30);
    const state = quests();
    applyQuestEvents(balance, state, [{ type: "kInvasionSuccessfulNotification", subject: "Zombies vs Robots" }]);
    expect(state.completed).not.toContain("20010");
    applyQuestEvents(balance, state, [{ type: "kEliteInvasionSuccessfulNotification", subject: "Zombies vs Robots" }]);
    expect(state.completed).toContain("20010");
  });
});
