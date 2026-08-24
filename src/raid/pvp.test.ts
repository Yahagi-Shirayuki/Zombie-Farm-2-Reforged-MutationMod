// Friend invasions (PvP) — shared-rule tests.
//
// The pinned config is server-built and client-adopted, so what needs locking here is
// the SHARED maths both read: the defense conversion (a defender zombie must be exactly
// as strong on the enemy side as on its own), the difficulty score and its reward
// tiers, and the property the whole design leans on — that a defense-vs-attack fight
// runs deterministically through the REAL BattleSim to a conclusion inside the replay
// cap, with no sim changes and no ruleset bump.
import { describe, expect, it } from "vitest";
import zombiesJson from "../../public/assets/zombies.json";
import boostsJson from "../../public/assets/boosts.json";
import { BattleSim } from "./BattleSim";
import { buildPlayerUnits } from "./CombatEngine";
import { makeOwned } from "../zombie/types";
import { RAID_MAX_TICKS, RAID_TICK_MS, replayRaid } from "./replay";
import {
  PVP_ARMY_SIZE,
  PVP_DEFENSE_CAP,
  PVP_TIER_REWARDS,
  PVP_WAVE_CADENCE,
  armyScore,
  buildPvpRaidDef,
  orderedDefenseUnits,
  pvpRewardsForTier,
  pvpTierForScore,
  toDefenseUnits,
  unitScore,
} from "./pvp";
import type { CombatUnit } from "./types";

const zombieDefs = zombiesJson as Array<Record<string, unknown>>;
const boostDefs = boostsJson as Array<{ key: string }>;

/** A synthetic army off the catalog, every stat × `power` (see the balance test's
 *  measuring stick — same idea, both sides built through the real buildPlayerUnits). */
function army(size: number, power: number, idPrefix = "z"): CombatUnit[] {
  const pool = zombieDefs
    .filter((z) => z.category !== "special")
    .sort((a, b) => ((b.str as number) + (b.con as number)) - ((a.str as number) + (a.con as number)))
    .slice(0, 6)
    .map((z) => ({ ...z, str: (z.str as number) * power, con: (z.con as number) * power }));
  const party = Array.from({ length: size }, (_, i) =>
    makeOwned(`${idPrefix}${i}`, pool[i % pool.length] as Parameters<typeof makeOwned>[1], 0, 0, 3, 0)
  );
  return buildPlayerUnits(party, { concentration: true, abilityUnlocked: () => true, playerLevel: 30 });
}

describe("toDefenseUnits", () => {
  it("flips team, strips abilities/auras, and keeps combat stats identical", () => {
    const built = army(6, 1);
    const defense = toDefenseUnits(built);
    expect(defense).toHaveLength(6);
    for (const unit of defense) {
      expect(unit.team).toBe("enemy");
      expect(unit.abilities).toEqual([]);
      expect(unit.teamAuraStats).toBeUndefined();
      // The same zombie, by key, fights with the same numbers on either side — in
      // particular the ATTACK CLOCK stays player-side (2 s/dex), not enemy (1 s/dex).
      const source = built.find((candidate) => candidate.sourceKey === unit.sourceKey)!;
      expect(unit.attackCooldownMs).toBe(source.attackCooldownMs);
      expect(unit.maxHp).toBe(source.maxHp);
      expect(unit.str).toBe(source.str);
    }
  });

  it("caps at the strongest PVP_DEFENSE_CAP, ordered weakest-first", () => {
    const big = army(24, 1);
    // Make one unit clearly the strongest and one clearly the weakest.
    big[0].str *= 50;
    big[0].con *= 50;
    big[0].maxHp *= 50;
    const defense = toDefenseUnits(big);
    expect(defense).toHaveLength(PVP_DEFENSE_CAP);
    const scores = defense.map(unitScore);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    // The boosted unit survives the cut and emerges LAST (strongest at the back).
    expect(defense[defense.length - 1].sourceKey).toBe(big[0].sourceKey);
    // Ids are re-minted so nothing downstream mistakes them for roster ids.
    expect(defense.map((u) => u.id)).toEqual(defense.map((_, i) => `d${i}`));
  });

  it("is deterministic", () => {
    const built = army(12, 2);
    expect(toDefenseUnits(built)).toEqual(toDefenseUnits(built));
  });
});

describe("orderedDefenseUnits (authored defenses)", () => {
  it("keeps the authored order as the emergence order, with the same per-unit flip", () => {
    const built = army(6, 1);
    const defense = orderedDefenseUnits(built);
    expect(defense).toHaveLength(6);
    // Authored slot 1 emerges first — no strongest ranking, no weakest-first reverse.
    expect(defense.map((u) => u.sourceKey)).toEqual(built.map((u) => u.sourceKey));
    expect(defense.map((u) => u.id)).toEqual(defense.map((_, i) => `d${i}`));
    for (let i = 0; i < defense.length; i++) {
      expect(defense[i].team).toBe("enemy");
      expect(defense[i].abilities).toEqual([]);
      expect(defense[i].teamAuraStats).toBeUndefined();
      expect(defense[i].attackCooldownMs).toBe(built[i].attackCooldownMs);
      expect(defense[i].maxHp).toBe(built[i].maxHp);
      expect(defense[i].str).toBe(built[i].str);
    }
  });

  it("caps at PVP_DEFENSE_CAP without re-ranking", () => {
    const built = army(20, 1);
    const defense = orderedDefenseUnits(built);
    expect(defense).toHaveLength(PVP_DEFENSE_CAP);
    expect(defense.map((u) => u.sourceKey))
      .toEqual(built.slice(0, PVP_DEFENSE_CAP).map((u) => u.sourceKey));
  });
});

describe("difficulty score and reward tiers", () => {
  it("scores a stronger army strictly higher", () => {
    expect(armyScore(army(8, 3))).toBeGreaterThan(armyScore(army(8, 1)));
    expect(armyScore(army(16, 1))).toBeGreaterThan(armyScore(army(8, 1)));
  });

  it("maps scores to monotonically non-decreasing tiers 1..5", () => {
    let last = 0;
    for (const score of [0, 10_000, 50_000, 300_000, 900_000, 5_000_000]) {
      const tier = pvpTierForScore(score);
      expect(tier).toBeGreaterThanOrEqual(1);
      expect(tier).toBeLessThanOrEqual(5);
      expect(tier).toBeGreaterThanOrEqual(last);
      last = tier;
    }
    expect(pvpTierForScore(0)).toBe(1);
    expect(pvpTierForScore(Number.MAX_SAFE_INTEGER)).toBe(5);
  });

  it("rewards exist for every tier, use only real boost keys, and only tier 5 pays a Brain Ticket", () => {
    const keys = new Set(boostDefs.map((b) => b.key));
    expect(PVP_TIER_REWARDS).toHaveLength(5);
    PVP_TIER_REWARDS.forEach((rewards, index) => {
      expect(rewards.length).toBeGreaterThan(0);
      for (const reward of rewards) {
        expect(keys.has(reward.key), `tier ${index + 1}: ${reward.key}`).toBe(true);
        expect(reward.qty).toBeGreaterThan(0);
      }
      const hasTicket = rewards.some((reward) => reward.key === "brain_ticket");
      expect(hasTicket).toBe(index === 4);
    });
    // Out-of-range tiers clamp instead of throwing.
    expect(pvpRewardsForTier(0)).toEqual(pvpRewardsForTier(1));
    expect(pvpRewardsForTier(99)).toEqual(pvpRewardsForTier(5));
  });
});

describe("a Garden zombie only stations when it can actually support (ruleset v40a)", () => {
  // Found by the first friend-invasion playtest: an attacker's Flower Zombie with no
  // healing ability unlocked stood at the rear station doing nothing, soft-locking the
  // fight into the four-minute cap when it was the last survivor. `isGarden` is the
  // SUPPORT flag now, not the body type.
  it("keeps isGarden only for units carrying a healing-type ability", () => {
    const def = zombieDefs.find((z) => z.group === "Garden")!;
    const party = [makeOwned("g", def as unknown as Parameters<typeof makeOwned>[1], 0, 0, 0, 0)];
    const locked = buildPlayerUnits(party, { abilityUnlocked: () => false });
    const unlocked = buildPlayerUnits(party, { abilityUnlocked: () => true });
    expect(locked[0].isGarden).toBe(false); // no heal yet — it fights in the line
    expect(unlocked[0].isGarden).toBe(true); // a real healer keeps the station
    expect(locked[0].group).toBe("Garden"); // the body type itself is untouched
  });
});

describe("the fight itself (real BattleSim, defenders as the enemy team)", () => {
  const fight = (attackPower: number, defensePower: number, defenders = 8) => {
    const sim = new BattleSim(
      army(PVP_ARMY_SIZE, attackPower, "a"),
      toDefenseUnits(army(defenders, defensePower, "b")),
      null, // no boss throw
      true, // concentration pinned for PvP: auto-release, no bubble inputs
      [],
      undefined,
      null, null, false, false, false, undefined, null, null,
      PVP_WAVE_CADENCE,
      null
    );
    return replayRaid(sim, 0, []);
  };

  it("runs to a deterministic conclusion with an empty transcript", () => {
    const first = fight(3, 1);
    const second = fight(3, 1);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    if (first.ok) {
      expect(first.outcome.win).toBe(true); // a 3x attacker beats a 1x defense
      // Comfortably inside the 4-minute replay cap the server enforces.
      expect(first.outcome.rounds * RAID_TICK_MS)
        .toBeLessThan(RAID_MAX_TICKS * RAID_TICK_MS * 0.75);
    }
  });

  it("a strong defense repels a weak attack", () => {
    const result = fight(1, 4, 16);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome.win).toBe(false);
  });
});

describe("buildPvpRaidDef", () => {
  it("borrows the given stage assets and stays hazard-free", () => {
    const def = buildPvpRaidDef(
      { raidName: "Pat's Farm", defenderName: "Pat" },
      {
        music: "farmStageBGM.mp3",
        levelAssets: [{ sprite: "fightBGFarm_bg.png", position: "{0,0}", anchor: "{0,0}", z: 0 }],
      } as never
    );
    expect(def.id).toBeLessThan(0);
    expect(def.levelAssets).toHaveLength(1);
    expect(def.music).toBe("farmStageBGM.mp3");
    expect(def.obstacleLimit).toBe(0);
    expect(def.hasGrab).toBe(false);
    expect(def.stages[0].bossKey).toBeUndefined();
  });
});
