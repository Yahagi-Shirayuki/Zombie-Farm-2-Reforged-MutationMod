import { describe, it, expect } from "vitest";
import { raidFeatQuestEvents, EXPLODED_MINI_SUBJECT } from "./featQuestEvents";
import { questSubjectMatches } from "../quest/matching";
import type { RaidFeats } from "./types";

const feats = (partial: Partial<RaidFeats> = {}): RaidFeats => ({
  abilityKills: [], resurrections: [], ...partial,
});
const base = { win: true, perfect: false, elite: false, raidName: "Zombies vs Ninjas" };
const types = (events: { type: string }[]) => events.map((e) => e.type);

describe("raidFeatQuestEvents", () => {
  // Resurrections and ability kills happen in a LOSING fight too. Counting them would
  // make deliberately throwing an invasion the cheapest way to farm "revive 25 zombies".
  it("produces nothing at all for a loss", () => {
    expect(raidFeatQuestEvents({
      ...base, win: false, elite: true, perfect: true,
      feats: feats({ resurrections: [{ exploded: true }], abilityKills: [{ ability: "explodeV2", boss: true }] }),
    })).toEqual([]);
  });

  it("stays silent about elite on an ordinary invasion", () => {
    const events = raidFeatQuestEvents({ ...base, perfect: true });
    expect(types(events)).not.toContain("kEliteInvasionSuccessfulNotification");
    expect(types(events)).not.toContain("kElitePerfectGameNotification");
  });

  it("reports an elite win, and its flawless variant only when nobody fell", () => {
    const scrappy = raidFeatQuestEvents({ ...base, elite: true });
    expect(types(scrappy)).toEqual(["kEliteInvasionSuccessfulNotification"]);
    expect(scrappy[0].subject).toBe("Zombies vs Ninjas");

    const flawless = raidFeatQuestEvents({ ...base, elite: true, perfect: true });
    expect(types(flawless)).toEqual([
      "kEliteInvasionSuccessfulNotification", "kElitePerfectGameNotification",
    ]);
  });

  // A boss is also an enemy: the hardest kill in the fight must still count toward the
  // easier "destroy 5 enemies with explosions" quest.
  it("counts a boss kill as both an enemy kill and a boss kill", () => {
    const events = raidFeatQuestEvents({
      ...base, feats: feats({ abilityKills: [{ ability: "explodeV2", boss: true }] }),
    });
    expect(types(events)).toEqual([
      "kEnemyDefeatedByAbilityNotification", "kBossDefeatedByAbilityNotification",
    ]);
    expect(events.every((e) => e.subject === "Explosion")).toBe(true);
  });

  it("files both tiers of a move under one subject", () => {
    const events = raidFeatQuestEvents({
      ...base,
      feats: feats({ abilityKills: [
        { ability: "explode", boss: false }, { ability: "bash", boss: true },
        { ability: "bashV2", boss: false },
      ] }),
    });
    const subjects = events.map((e) => e.subject);
    expect(subjects.filter((s) => s === "Explosion")).toHaveLength(1);
    expect(subjects.filter((s) => s === "Smash")).toHaveLength(3); // bash enemy+boss, bashV2 enemy
  });

  it("ignores an ability with no quest identity", () => {
    expect(raidFeatQuestEvents({
      ...base, feats: feats({ abilityKills: [{ ability: "attachMini", boss: false }] }),
    })).toEqual([]);
  });

  it("keeps every resurrection on the wildcard, and aliases only the exploded one", () => {
    const events = raidFeatQuestEvents({
      ...base,
      feats: feats({ resurrections: [{ exploded: false }, { exploded: true }] }),
    });
    expect(types(events)).toEqual([
      "kZombieResurrectedNotification", "kZombieResurrectedNotification",
    ]);
    // "Revive N zombies" (blank requirement) counts both...
    expect(events.every((e) => questSubjectMatches("", e.subject, e.aliases))).toBe(true);
    // ...while the Garden/Small combo quest counts only the second.
    const combo = events.filter((e) => questSubjectMatches(EXPLODED_MINI_SUBJECT, e.subject, e.aliases));
    expect(combo).toHaveLength(1);
  });
});
