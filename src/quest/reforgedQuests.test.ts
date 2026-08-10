// The Reforged-original achievements: the authored catalog itself, and the invariants
// that keep it from quietly breaking the imported one.
import { describe, it, expect } from "vitest";
import imported from "../../public/assets/quests.json";
import reforged from "../../public/assets/quests_reforged.json";
import raids from "../../public/assets/raids/raids.json";
import { QuestEvent } from "./events";
import { questBonusRewardInfo, questRewardInfo } from "./types";
import { ABILITY_SUBJECT, EXPLODED_MINI_SUBJECT } from "../raid/featQuestEvents";
import { RARE_INVASION_ZOMBIE_SUBJECT } from "../raid/zombieDrops";
import { XP_THRESHOLDS } from "../GameState";
import { xpToNextLevel as xpToNext } from "./periodic/generate";

const xpToNextLevel = (level: number) => xpToNext(Math.max(1, level), XP_THRESHOLDS);

type Quest = (typeof reforged)[keyof typeof reforged];
const QUESTS = Object.entries(reforged) as [string, Quest][];
const LIVE = new Set<string>(Object.values(QuestEvent));

describe("reforged achievement catalog", () => {
  it("collides with no imported quest id", () => {
    const importedIds = new Set(Object.keys(imported));
    for (const [id] of QUESTS) expect(importedIds.has(id), id).toBe(false);
  });

  // The four-slot rail sorts by numeric id, so this is what guarantees an achievement
  // the player is ignoring can never push the next authored progression quest off it.
  it("sorts after every imported quest, so the rail keeps showing progression", () => {
    const highestImported = Math.max(...Object.keys(imported).map(Number));
    for (const [id] of QUESTS) expect(Number(id), id).toBeGreaterThan(highestImported);
  });

  it("keys each record by its own id", () => {
    for (const [id, quest] of QUESTS) expect(quest.id).toBe(id);
  });

  it("listens only to events that have a live emitter", () => {
    for (const [id, quest] of QUESTS) {
      for (const requirement of quest.requirements) {
        expect(LIVE.has(requirement.notificationID), `${id}: ${requirement.notificationID}`).toBe(true);
      }
    }
  });

  it("names only subjects something actually posts", () => {
    const raidNames = new Set((raids as { name: string }[]).map((raid) => raid.name));
    const abilitySubjects = new Set(Object.values(ABILITY_SUBJECT));
    for (const [id, quest] of QUESTS) {
      for (const requirement of quest.requirements) {
        const subject = requirement.notificationObject;
        if (!subject) continue; // wildcard
        const known =
          raidNames.has(subject) ||
          abilitySubjects.has(subject) ||
          subject === RARE_INVASION_ZOMBIE_SUBJECT ||
          subject === EXPLODED_MINI_SUBJECT;
        expect(known, `${id} names an unpostable subject: "${subject}"`).toBe(true);
      }
    }
  });

  it("gates every quest behind a level and a reachable prerequisite", () => {
    const ids = new Set(QUESTS.map(([id]) => id));
    for (const [id, quest] of QUESTS) {
      expect(quest.levelRequired, id).toBeGreaterThan(0);
      expect(quest.levelRequired, id).toBeLessThanOrEqual(45);
      if (quest.prerequisiteQuest < 0) continue;
      const prerequisite = String(quest.prerequisiteQuest);
      expect(ids.has(prerequisite), `${id} needs ${prerequisite}`).toBe(true);
      // A prerequisite gated ABOVE its dependant would make the chain unreachable in
      // the order it reads — the successor would unlock before the quest it follows.
      const parent = reforged[prerequisite as keyof typeof reforged];
      expect(parent.levelRequired, `${id} unlocks before its prerequisite`)
        .toBeLessThanOrEqual(quest.levelRequired);
    }
  });

  it("pays XP, with a brain only on the hardest rungs", () => {
    const withBrains = QUESTS.filter(([, quest]) => (quest as { rewardBrains?: number }).rewardBrains);
    expect(withBrains.length).toBe(6);
    for (const [id, quest] of QUESTS) {
      expect(quest.rewardType, id).toBe(0); // XP
      expect(quest.rewardValue, id).toBeGreaterThan(0);
      const brains = (quest as { rewardBrains?: number }).rewardBrains ?? 0;
      expect(brains, id).toBeLessThanOrEqual(1);
      // A brain rung must also be one of the late, expensive ones — otherwise the
      // scarcest currency in the game leaks out of an early quest.
      if (brains) expect(quest.levelRequired, id).toBeGreaterThanOrEqual(15);
    }
  });

  // ONE policy governs both catalogs: a quest is worth a share of the XP needed to
  // clear the level it unlocks at. Standard work sits at 10-20%; only the truly hard
  // rungs reach 40%. The imported side is enforced by tools/quest_xp_rebalance.py at
  // generation time; this is the authored side's equivalent, so a hand-edit that walks
  // out of the band fails here rather than shipping.
  it("prices every achievement inside the agreed bands", () => {
    for (const [id, quest] of QUESTS) {
      const share = quest.rewardValue / xpToNextLevel(quest.levelRequired);
      const brains = (quest as { rewardBrains?: number }).rewardBrains ?? 0;
      if (brains) {
        expect(share, `${id} is a brain rung and should sit near 40%`).toBeGreaterThan(0.3);
        expect(share, id).toBeLessThanOrEqual(0.42);
      } else {
        expect(share, `${id} should sit in the 10-20% band`).toBeGreaterThanOrEqual(0.1);
        expect(share, id).toBeLessThanOrEqual(0.22);
      }
    }
  });

  it("keeps the imported catalog inside the same bands", () => {
    for (const [id, quest] of Object.entries(imported) as [string, {
      rewardType: number; rewardValue: number; levelRequired: number; epicEvent: boolean;
    }][]) {
      if (quest.rewardType !== 0 || quest.epicEvent || !quest.rewardValue) continue;
      const level = Math.max(1, quest.levelRequired);
      const share = quest.rewardValue / xpToNextLevel(level);
      // Levels 1-7 need 25-250 XP in total, so the 20 XP floor deliberately overshoots
      // the band there rather than paying single digits.
      if (quest.rewardValue <= 20) continue;
      expect(share, `${id} (level ${level}) is outside the bands`).toBeLessThanOrEqual(0.42);
      expect(share, `${id} (level ${level}) is outside the bands`).toBeGreaterThanOrEqual(0.1);
    }
  });

  it("scales the payout with the gate", () => {
    const sorted = [...QUESTS].sort((a, b) => a[1].levelRequired - b[1].levelRequired);
    const first = sorted[0][1];
    const last = sorted[sorted.length - 1][1];
    expect(last.rewardValue).toBeGreaterThan(first.rewardValue);
  });

  it("surfaces both reward lines to the HUD", () => {
    const legend = reforged["20005"];
    expect(questRewardInfo(legend)?.label).toBe("+400 XP");
    expect(questBonusRewardInfo(legend)?.label).toBe("+1 Brain");
    // An imported quest has no bonus line at all.
    expect(questBonusRewardInfo({ rewardBrains: undefined })).toBeNull();
  });

  it("asks the Flawless Tour for every stage of the main ladder", () => {
    const tour = reforged["20014"];
    const ladder = (raids as { id: number; name: string; playable: boolean }[])
      .filter((raid) => raid.id >= 1 && raid.id <= 6)
      .map((raid) => raid.name);
    expect(tour.requirements.map((r) => r.notificationObject).sort()).toEqual([...ladder].sort());
  });
});
