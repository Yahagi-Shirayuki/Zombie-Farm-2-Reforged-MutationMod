import { describe, expect, it } from "vitest";
import {
  almanacEntries, backfillDiscovered, epicSource, isObtainable, obtainHint, sanitizeDiscovered,
} from "./almanac";
import { EPIC_QUEST_ZOMBIE_REWARDS } from "../epicBoss/rewards";
import type { ZombieDef } from "../assets";
import { OLD_MC_ZOMBIE_KEY, OLD_MC_ZOMBIE_RAID_ID } from "../raid/zombieDrops";

const def = (over: Partial<ZombieDef>): ZombieDef => ({
  key: "ZombieActorRegularTier1", name: "Zombie", cost: 20, growMs: 1000, level: 1, xp: 1,
  category: "normal", group: "Regular", className: "Green", classColor: "#7ac74f",
  str: 5, dex: 5, con: 5, focus: 50,
  ...over,
});

const SOURCES = {
  raidNameById: (id: number) => (id === OLD_MC_ZOMBIE_RAID_ID ? "McDonnell Farm" : undefined),
  epicBossNameByQuestId: (questId: string) => (questId === "1000" ? "Dr. Skunkarella" : undefined),
};

describe("isObtainable", () => {
  it("includes market seeds, pot promotions, epic rewards, and raid drops", () => {
    expect(isObtainable(def({}))).toBe(true); // market
    expect(isObtainable(def({ key: "ZombieActorRegularTier5", marketHidden: true }))).toBe(true); // pot
    expect(isObtainable(def({ key: "ZombieActorDrZombie", rewardOnly: true }))).toBe(true); // epic
    expect(isObtainable(def({ key: OLD_MC_ZOMBIE_KEY, marketHidden: true }))).toBe(true); // raid
  });

  it("excludes orphaned seasonal specials with no current source", () => {
    expect(isObtainable(def({ key: "ZombieActorZomBetty", marketHidden: true }))).toBe(false);
  });
});

describe("almanacEntries", () => {
  const zombies = [
    def({ key: "special", name: "S", category: "special", level: 5, rewardOnly: true }),
    def({ key: "ZombieActorDrZombie", name: "Dr", category: "special", level: 2, rewardOnly: true }),
    def({ key: "norm2", name: "B", level: 4 }),
    def({ key: "norm1", name: "A", level: 1 }),
    def({ key: "mut", name: "M", category: "mutant", level: 2 }),
  ];

  it("keeps obtainable species sorted by category, then level, then name", () => {
    expect(almanacEntries(zombies, {}).map((z) => z.key)).toEqual([
      "norm1", "norm2", "ZombieActorDrZombie",
    ]);
  });

  it("keeps an unobtainable species the player has already discovered", () => {
    expect(almanacEntries(zombies, { special: 1 }).map((z) => z.key)).toContain("special");
  });

  it("excludes mutant base species entirely (even discovered) while the section is off", () => {
    expect(almanacEntries(zombies, { mut: 3 }).map((z) => z.key)).not.toContain("mut");
  });
});

describe("obtainHint", () => {
  it("names the exact raid for a raid-drop zombie", () => {
    expect(obtainHint(def({ key: OLD_MC_ZOMBIE_KEY, marketHidden: true }), SOURCES))
      .toContain("McDonnell Farm");
  });

  it("names the epic boss for an epic-reward zombie", () => {
    expect(obtainHint(def({ key: "ZombieActorDrZombie", rewardOnly: true }), SOURCES))
      .toContain("Dr. Skunkarella");
  });

  it("points a pot-promotion special at the Zombie Pot", () => {
    const hint = obtainHint(
      def({ key: "ZombieActorLargeTier5", group: "Large", marketHidden: true }), SOURCES);
    expect(hint).toContain("Zombie Pot");
    expect(hint).toContain("Large");
  });

  it("points a market species at its gravestone with the right currency", () => {
    expect(obtainHint(def({ cost: 20, level: 3 }), SOURCES)).toContain("level 3, 20 gold");
    expect(obtainHint(def({ cost: 4, brainsNeeded: true }), SOURCES)).toContain("4 brains");
  });

  it("falls back to a generic hint for a discovered-but-sourceless species", () => {
    expect(obtainHint(def({ key: "legacy", marketHidden: true }), SOURCES))
      .toBe("Obtained from special events.");
  });
});

describe("epicSource", () => {
  it("tags an epic-reward zombie with its boss and ladder position", () => {
    expect(epicSource(def({ key: "ZombieActorDrZombie", rewardOnly: true }), SOURCES))
      .toEqual({ name: "Dr. Skunkarella", order: 1000 });
  });

  it("keeps an epic zombie in the tab even when its boss cannot be named", () => {
    // Order still sorts it beside its own boss's other prize; only the heading is generic.
    expect(epicSource(def({ key: "ZombieActorZomtar", rewardOnly: true }), SOURCES))
      .toEqual({ name: "Epic Boss", order: 10011 });
  });

  it("leaves every non-epic species out of the epic tab", () => {
    expect(epicSource(def({}), SOURCES)).toBeUndefined();
    expect(epicSource(def({ key: OLD_MC_ZOMBIE_KEY, marketHidden: true }), SOURCES)).toBeUndefined();
    expect(epicSource(def({ key: "ZombieActorLargeTier5", marketHidden: true }), SOURCES))
      .toBeUndefined();
  });

  it("orders every reward so a boss's own prizes stay together, bosses in ladder order", () => {
    const ordered = Object.entries(EPIC_QUEST_ZOMBIE_REWARDS)
      .map(([questId, key]) => ({ questId, order: epicSource(def({ key }), SOURCES)?.order }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    // Grouped by the boss's thousands digit(s): 1000/1011, 2000/2011, … 10000/10011.
    expect(ordered.map((entry) => entry.questId)).toEqual([
      "1000", "1011", "2000", "2011", "3000", "3011", "4000", "4011", "5000", "5011",
      "8000", "9000", "9011", "10000", "10011",
    ]);
  });
});

describe("backfillDiscovered", () => {
  it("counts each owned copy per species", () => {
    expect(backfillDiscovered([{ key: "a" }, { key: "a" }, { key: "b" }]))
      .toEqual({ a: 2, b: 1 });
  });
});

describe("sanitizeDiscovered", () => {
  it("keeps only finite counts >= 1, flooring fractions", () => {
    expect(sanitizeDiscovered({ a: 2, b: 0, c: -3, d: Infinity, e: NaN, f: 1.9, g: "2" }))
      .toEqual({ a: 2, f: 1 });
  });

  it("returns empty for non-object input", () => {
    expect(sanitizeDiscovered(undefined)).toEqual({});
    expect(sanitizeDiscovered([1])).toEqual({});
    expect(sanitizeDiscovered("x")).toEqual({});
  });
});
