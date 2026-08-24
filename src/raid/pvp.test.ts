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
  groupTierPoints,
  orderedDefenseUnits,
  pvpRewardsForTier,
  pvpTierForPoints,
  toDefenseUnits,
  unitScore,
  unitTierPoints,
} from "./pvp";
import { bitOf } from "../zombie/mutations";
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

  it("maps points to monotonically non-decreasing tiers 1..5", () => {
    let last = 0;
    for (const points of [0, 20_000, 100_000, 400_000, 1_000_000, 5_000_000]) {
      const tier = pvpTierForPoints(points);
      expect(tier).toBeGreaterThanOrEqual(1);
      expect(tier).toBeLessThanOrEqual(5);
      expect(tier).toBeGreaterThanOrEqual(last);
      last = tier;
    }
    expect(pvpTierForPoints(0)).toBe(1);
    expect(pvpTierForPoints(Number.MAX_SAFE_INTEGER)).toBe(5);
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

describe("group tiers read the ACTUAL fight stats — owner's calibration rules", () => {
  const defOf = (key: string) =>
    zombieDefs.find((z) => z.key === key) as unknown as Parameters<typeof makeOwned>[1];
  // The strongest legal 5-slot mutation set: Pumpking (head, wearable by anyone via
  // Pot inheritance), Eyebiscus (hair/eye), Dragon-arm, Heartichoke (body), Flytrap
  // (neck). Distinct bits, so plain addition composes the mask without bitwise ops.
  const MAX_MUTATIONS = ["pumpking", "eyebiscus", "dragon", "heartichoke", "flytrap"]
    .reduce((mask, key) => mask + bitOf(key), 0);
  const buildGroup = (keys: string[], level: number, mask = 0) =>
    buildPlayerUnits(
      keys.map((k, i) => makeOwned(`u${i}`, defOf(k), 0, 0, 0, mask)),
      { concentration: true, abilityUnlocked: () => true, playerLevel: level }
    );
  const tierOf = (units: CombatUnit[], base = PVP_DEFENSE_CAP) =>
    pvpTierForPoints(groupTierPoints(units, base));
  const greens = (n: number, level: number, mask = 0) =>
    buildGroup(Array.from({ length: n }, () => "ZombieActorRegularTier1"), level, mask);
  const EPIC_SHELF = ["ZombieActorVagabond", "ZombieActorScrooge", "ZombieActorOmegaZombieBot",
    "ZombieActorMadame", "ZombieActorBandido", "ZombieActorAdmiral"];

  it("a lawn of plain greens is tier 1 at ANY level — the ramp bands species, not accounts", () => {
    expect(tierOf(greens(6, 7))).toBe(1);
    expect(tierOf(greens(6, 30))).toBe(1);
    expect(tierOf(greens(10, 45))).toBe(1);
  });

  it("more zombies raise the score a bit (√count) — but count never buys weaklings a tier", () => {
    const six = groupTierPoints(greens(6, 45), PVP_DEFENSE_CAP);
    const ten = groupTierPoints(greens(10, 45), PVP_DEFENSE_CAP);
    expect(ten).toBeGreaterThan(six);
    expect(pvpTierForPoints(ten)).toBe(1);
  });

  it("greens NEVER reach tier 3 — even the theoretical max mutation set stops at 2", () => {
    const maxed = greens(6, 30, MAX_MUTATIONS);
    expect(tierOf(maxed)).toBe(2); // mutations count: out of tier 1...
    expect(tierOf(maxed)).toBeLessThan(3); // ...but the ceiling is HARD
  });

  it("one powerful zombie out-scores a weakling crowd, yet a lone zombie is no tier-5 GROUP", () => {
    const lone = buildGroup(["ZombieActorVagabond"], 45);
    expect(groupTierPoints(lone, PVP_DEFENSE_CAP))
      .toBeGreaterThan(groupTierPoints(greens(10, 45), PVP_DEFENSE_CAP));
    const loneTier = tierOf(lone);
    expect(loneTier).toBeGreaterThanOrEqual(3); // a monster alone still reads strong
    expect(loneTier).toBeLessThan(5); // but five stars take a full shelf
  });

  it("the top epic shelf is tier 5 with ZERO mutations (epics can't carry any)", () => {
    const shelf = buildGroup(EPIC_SHELF, 45);
    for (const epic of shelf) expect(epic.mutation ?? 0).toBe(0);
    expect(tierOf(shelf)).toBe(5);
  });

  it("Protect counts as staying power: damage reduction raises a unit's points", () => {
    const [unit] = buildGroup(["ZombieActorRegularTier4"], 30);
    const shielded = { ...unit, damageReduction: 0.5 };
    expect(unitTierPoints(shielded)).toBeCloseTo(unitTierPoints(unit) * 2, 5);
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
