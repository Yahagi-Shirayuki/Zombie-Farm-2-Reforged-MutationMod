import { describe, expect, it } from "vitest";
import { befriend, call, grantBalance, grantRoster, signIn, uniqueSub, xpForLevel } from "./helpers";
import { RAID_RULESET_VERSION } from "../../../src/raid/replay";
import {
  PVP_ARMY_SIZE,
  PVP_DAILY_ATTACKS_PER_PAIR,
  PVP_DAILY_REWARDED_DEFENSES,
  PVP_DAILY_REWARDED_WINS,
  PVP_DEFENSE_CAP,
  PVP_MIN_LEVEL,
} from "../../../src/raid/pvp";

// Friend invasions (PvP) end-to-end: /raid/pvp/start pins the whole fight (attacker
// eight + a snapshot of the defender's defense), /raid/pvp/finish settles it by the
// server's OWN replay (finalTick 0 + no inputs = "simulate the whole fight" via the
// overrun path), a held defense parks a claim-on-login reward for the defender, and
// the daily income caps decide which fights PAY without limiting which fights happen.

const ATTACK_IDS = Array.from({ length: PVP_ARMY_SIZE }, (_, i) => `a${i}`);
const REGULAR = "ZombieActorRegularTier1";
const HEADLESS = "ZombieActorHeadlessTier1";

async function pvpPlayer(
  label: string,
  units: { id: string; key?: string; stored?: boolean }[],
  level = PVP_MIN_LEVEL
) {
  const s = await signIn(uniqueSub(label));
  await grantBalance(s, { gold: 0, brains: 0, xp: xpForLevel(level) });
  if (units.length) {
    await grantRoster(s, units.map((u) => ({ id: u.id, key: u.key ?? REGULAR, stored: !!u.stored })));
  }
  return s;
}

const attackUnits = ATTACK_IDS.map((id) => ({ id }));

const startBody = (defenderId: string, orderedUnitIds: string[] = ATTACK_IDS) => ({
  defenderId, orderedUnitIds, rulesetVersion: RAID_RULESET_VERSION,
});

const retreatFinish = (sessionId: string) => ({
  sessionId, finalTick: 0, inputs: [{ seq: 1, tick: 0, type: "retreat" }],
});

describe("friend invasion start gates", () => {
  it("requires friendship, the current ruleset, exactly eight owned units, and a defense", async () => {
    const attacker = await pvpPlayer("pvp-gate-a", attackUnits);
    const stranger = await pvpPlayer("pvp-gate-s", [{ id: "d0" }]);

    const unfriended = await call<{ error: string }>("POST", "/raid/pvp/start", attacker.token,
      startBody(stranger.accountId));
    expect(unfriended).toMatchObject({ status: 403, body: { error: "not_friends" } });

    await befriend(attacker, stranger);
    const stale = await call<{ error: string }>("POST", "/raid/pvp/start", attacker.token,
      { ...startBody(stranger.accountId), rulesetVersion: 1 });
    expect(stale).toMatchObject({ status: 426, body: { error: "stale_ruleset" } });

    const short = await call<{ error: string }>("POST", "/raid/pvp/start", attacker.token,
      startBody(stranger.accountId, ATTACK_IDS.slice(0, 3)));
    expect(short.body.error).toBe("bad_roster");

    const foreign = await call<{ error: string }>("POST", "/raid/pvp/start", attacker.token,
      startBody(stranger.accountId, ATTACK_IDS.map((id) => `not-${id}`)));
    expect(foreign.body.error).toBe("unit_not_owned");

    // A defender with an empty farm cannot be farmed for free wins.
    const empty = await signIn(uniqueSub("pvp-gate-e"));
    await grantBalance(empty, { xp: xpForLevel(PVP_MIN_LEVEL) });
    await befriend(attacker, empty);
    const noDefense = await call<{ error: string }>("POST", "/raid/pvp/start", attacker.token,
      startBody(empty.accountId));
    expect(noDefense.body.error).toBe("no_defense");
  });

  it("gates both sides at the invasion level", async () => {
    const newbie = await pvpPlayer("pvp-lvl-n", attackUnits, 1);
    const veteran = await pvpPlayer("pvp-lvl-v", attackUnits.concat([{ id: "d0" }]));
    await befriend(newbie, veteran);

    const tooLow = await call<{ error: string }>("POST", "/raid/pvp/start", newbie.token,
      startBody(veteran.accountId));
    expect(tooLow).toMatchObject({ status: 403, body: { error: "attacker_level" } });

    const lowDefender = await pvpPlayer("pvp-lvl-d", [{ id: "d0" }], 1);
    await befriend(veteran, lowDefender);
    const protectedFarm = await call<{ error: string }>("POST", "/raid/pvp/start", veteran.token,
      startBody(lowDefender.accountId));
    expect(protectedFarm).toMatchObject({ status: 403, body: { error: "defender_level" } });
  });
});

describe("defense authoring", () => {
  interface DefenseGet {
    ok: boolean;
    unitIds: string[];
    defense: {
      score: number;
      tier: number;
      defenders: { key: string; name: string }[];
      authored: boolean;
    } | null;
    error?: string;
  }

  it("saves an ordered loadout (resting zombies included), snapshots it, and falls back to auto", async () => {
    const attacker = await pvpPlayer("pvp-def-a", attackUnits);
    // d0 deployed Regular, d1 deployed Headless, d2 RESTING Regular.
    const defender = await pvpPlayer("pvp-def-d", [
      { id: "d0" }, { id: "d1", key: HEADLESS }, { id: "d2", stored: true },
    ]);
    await befriend(attacker, defender);

    // Validation: unowned ids and oversized loadouts are refused.
    const foreign = await call<{ error: string }>("POST", "/raid/pvp/defense", defender.token,
      { unitIds: ["not-mine"] });
    expect(foreign).toMatchObject({ status: 400, body: { error: "unit_not_owned" } });
    const oversized = await call<{ error: string }>("POST", "/raid/pvp/defense", defender.token,
      { unitIds: Array.from({ length: PVP_DEFENSE_CAP + 1 }, (_, i) => `x${i}`) });
    expect(oversized).toMatchObject({ status: 400, body: { error: "bad_loadout" } });

    // Authored order: the RESTING d2 first, then the Headless — a defense is a plan,
    // not who happens to stand on the lawn, so the crypt zombie counts.
    const saved = await call<{ ok: boolean }>("POST", "/raid/pvp/defense", defender.token,
      { unitIds: ["d2", "d1"] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const mine = await call<DefenseGet>("GET", "/raid/pvp/defense", defender.token);
    expect(mine.status).toBe(200);
    expect(mine.body.unitIds).toEqual(["d2", "d1"]);
    expect(mine.body.defense?.authored).toBe(true);
    expect(mine.body.defense?.defenders.map((d) => d.key)).toEqual([REGULAR, HEADLESS]);
    expect(mine.body.defense?.tier).toBeGreaterThanOrEqual(1);

    // The pinned fight fields the authored defense in the authored EMERGENCE order.
    const started = await call<{ ok: boolean; sessionId: string; config: {
      enemyUnits: { id: string; sourceKey: string; team: string }[];
    } }>("POST", "/raid/pvp/start", attacker.token, startBody(defender.accountId));
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.config.enemyUnits.map((u) => u.sourceKey)).toEqual([REGULAR, HEADLESS]);
    expect(started.body.config.enemyUnits.map((u) => u.id)).toEqual(["d0", "d1"]);
    await call("POST", "/raid/pvp/finish", attacker.token, retreatFinish(started.body.sessionId));

    // Scouting shows the same defense to a would-be attacker, display fields only.
    const scout = await call<{ ok: boolean; defenders: { key: string }[]; authored: boolean;
      attackerTier: number; defenseScore: number }>(
      "POST", "/raid/pvp/preview", attacker.token, { defenderId: defender.accountId });
    expect(scout.status).toBe(200);
    expect(scout.body.authored).toBe(true);
    expect(scout.body.defenders.map((d) => d.key)).toEqual([REGULAR, HEADLESS]);
    expect(scout.body.attackerTier).toBeGreaterThanOrEqual(1);
    // Scouting works both ways between friends…
    const reverseScout = await call<{ ok: boolean }>("POST", "/raid/pvp/preview",
      defender.token, { defenderId: attacker.accountId });
    expect(reverseScout.status).toBe(200);
    // …but never on a stranger.
    const outsider = await pvpPlayer("pvp-def-s", [{ id: "d0" }]);
    const refused = await call<{ error: string }>("POST", "/raid/pvp/preview", outsider.token,
      { defenderId: defender.accountId });
    expect(refused).toMatchObject({ status: 403, body: { error: "not_friends" } });

    // Clearing the loadout returns to the automatic strongest pick — deployed only.
    const cleared = await call<{ ok: boolean }>("POST", "/raid/pvp/defense", defender.token,
      { unitIds: [] });
    expect(cleared.status).toBe(200);
    const auto = await call<DefenseGet>("GET", "/raid/pvp/defense", defender.token);
    expect(auto.body.unitIds).toEqual([]);
    expect(auto.body.defense?.authored).toBe(false);
    // d2 rests in the crypt, so the auto snapshot fields the two deployed zombies.
    expect(auto.body.defense?.defenders).toHaveLength(2);
  });
});

describe("friend invasion — attacks, claims, daily caps", () => {
  interface StartResponse {
    ok: boolean;
    sessionId: string;
    config: {
      raidId: number;
      concentration: boolean;
      playerUnits: { team: string }[];
      enemyUnits: { team: string; group?: string; abilities: string[] }[];
      pvp: { defenderId: string; attackerTier: number; defenderTier: number; defenseScore: number };
    };
  }
  interface FinishResponse {
    settlementId?: string;
    win: boolean;
    rewarded?: boolean;
    rewards: { key: string; qty: number }[];
    inventory?: Record<string, number>;
    error?: string;
  }
  interface Overview {
    ok: boolean;
    attacks: { sessionId: string; attackerWon: boolean; rewarded: boolean; replayAvailable?: boolean }[];
    defenses: { sessionId: string; attackerWon: boolean; rewarded: boolean; claimableTier?: number }[];
    stats: {
      lifetime: { attackWins: number; attackLosses: number; defenseWins: number; defenseLosses: number };
      week: { attackWins: number; attackLosses: number; defenseWins: number; defenseLosses: number };
    };
    claim: { count: number; rewards: { key: string; qty: number }[] };
    rewardedWinsToday: number;
    rewardedDefensesToday: number;
  }

  const winFight = async (attacker: { token: string }, defenderId: string) => {
    const started = await call<StartResponse>("POST", "/raid/pvp/start", attacker.token,
      startBody(defenderId));
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const finished = await call<FinishResponse>("POST", "/raid/pvp/finish", attacker.token,
      { sessionId: started.body.sessionId, finalTick: 0, inputs: [] });
    expect(finished.status, JSON.stringify(finished.body)).toBe(200);
    expect(finished.body.win).toBe(true);
    return { sessionId: started.body.sessionId, result: finished.body };
  };

  it("settles fights, holds defense claims, caps daily income, and claims the backlog at once", async () => {
    // 8 attackers vs a single defender of the same species: the attacker wins the
    // server's own simulation of the fight.
    const attacker = await pvpPlayer("pvp-flow-a", attackUnits);
    const defender = await pvpPlayer("pvp-flow-d", [{ id: "d0" }]);
    await befriend(attacker, defender);

    // ---- attack 1: a win, settled entirely by the server's replay (no inputs).
    const started = await call<StartResponse>("POST", "/raid/pvp/start", attacker.token,
      startBody(defender.accountId));
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const config = started.body.config;
    expect(config.raidId).toBeLessThan(0);
    expect(config.concentration).toBe(true);
    expect(config.playerUnits).toHaveLength(PVP_ARMY_SIZE);
    expect(config.enemyUnits.length).toBeGreaterThan(0);
    for (const unit of config.enemyUnits) {
      expect(unit.team).toBe("enemy");
      expect(unit.group, "defender snapshot keeps the zombie taxonomy for rendering").toBeTruthy();
      expect(unit.abilities).toEqual([]);
    }
    expect(config.pvp.defenderId).toBe(defender.accountId);
    expect(config.pvp.attackerTier).toBeGreaterThanOrEqual(1);

    // One live session per attacker.
    const second = await call<{ error: string }>("POST", "/raid/pvp/start", attacker.token,
      startBody(defender.accountId));
    expect(second).toMatchObject({ status: 409, body: { error: "raid_in_progress" } });

    const finished = await call<FinishResponse>("POST", "/raid/pvp/finish", attacker.token,
      { sessionId: started.body.sessionId, finalTick: 0, inputs: [] });
    expect(finished.status, JSON.stringify(finished.body)).toBe(200);
    expect(finished.body.win).toBe(true);
    expect(finished.body.rewarded).toBe(true);
    expect(finished.body.rewards.length).toBeGreaterThan(0);
    for (const reward of finished.body.rewards) {
      expect(finished.body.inventory?.[reward.key] ?? 0).toBeGreaterThanOrEqual(reward.qty);
    }
    // Idempotent replay of the same settlement.
    const replayed = await call<FinishResponse>("POST", "/raid/pvp/finish", attacker.token,
      { sessionId: started.body.sessionId, finalTick: 0, inputs: [] });
    expect(replayed.status).toBe(200);
    expect(replayed.body.settlementId).toBe(finished.body.settlementId);

    // ---- attack 2: a retreat — the defense holds and the defender earns a claim.
    const retreatStart = await call<StartResponse>("POST", "/raid/pvp/start", attacker.token,
      startBody(defender.accountId));
    expect(retreatStart.status).toBe(200);
    const retreated = await call<FinishResponse>("POST", "/raid/pvp/finish", attacker.token,
      retreatFinish(retreatStart.body.sessionId));
    expect(retreated.status, JSON.stringify(retreated.body)).toBe(200);
    expect(retreated.body.win).toBe(false);
    expect(retreated.body.rewards).toEqual([]);

    // The defender's overview: both rows under `defenses`, stats counted, only the
    // held defense claimable.
    const overview = await call<Overview>("GET", "/raid/pvp/history", defender.token);
    expect(overview.status).toBe(200);
    expect(overview.body.attacks).toHaveLength(0);
    const held = overview.body.defenses.find((e) => e.sessionId === retreatStart.body.sessionId);
    const lost = overview.body.defenses.find((e) => e.sessionId === started.body.sessionId);
    expect(held).toMatchObject({ attackerWon: false, rewarded: true });
    expect(held?.claimableTier).toBeGreaterThanOrEqual(1);
    expect(lost).toMatchObject({ attackerWon: true });
    expect(lost?.claimableTier).toBeUndefined();
    expect(overview.body.stats.lifetime).toMatchObject({ defenseWins: 1, defenseLosses: 1 });
    expect(overview.body.stats.week).toMatchObject({ defenseWins: 1, defenseLosses: 1 });
    expect(overview.body.rewardedDefensesToday).toBe(1);
    expect(overview.body.claim.count).toBe(1);

    // Single-claim path: once, defender only, held+rewarded rows only.
    const collected = await call<{ ok: boolean; rewards: { key: string; qty: number }[] }>(
      "POST", "/raid/pvp/collect", defender.token, { sessionId: retreatStart.body.sessionId });
    expect(collected.status, JSON.stringify(collected.body)).toBe(200);
    expect(collected.body.rewards.length).toBeGreaterThan(0);
    const again = await call<{ error: string }>("POST", "/raid/pvp/collect", defender.token,
      { sessionId: retreatStart.body.sessionId });
    expect(again).toMatchObject({ status: 409, body: { error: "already_claimed" } });
    const notHeld = await call<{ error: string }>("POST", "/raid/pvp/collect", defender.token,
      { sessionId: started.body.sessionId });
    expect(notHeld).toMatchObject({ status: 409, body: { error: "not_defended" } });
    const wrongParty = await call<{ error: string }>("POST", "/raid/pvp/collect", attacker.token,
      { sessionId: retreatStart.body.sessionId });
    expect(wrongParty.status).toBe(404);

    // ---- daily rewarded-wins cap: wins keep landing, the pay stops at the cap.
    const winIds: string[] = [started.body.sessionId];
    for (let n = 2; n <= PVP_DAILY_REWARDED_WINS; n++) {
      const win = await winFight(attacker, defender.accountId);
      expect(win.result.rewarded, `win ${n} inside the cap pays`).toBe(true);
      expect(win.result.rewards.length).toBeGreaterThan(0);
      winIds.push(win.sessionId);
    }
    const capped = await winFight(attacker, defender.accountId);
    expect(capped.result.rewarded, "a win past the daily cap still counts, but does not pay").toBe(false);
    expect(capped.result.rewards).toEqual([]);
    winIds.push(capped.sessionId);

    const mine = await call<Overview>("GET", "/raid/pvp/history", attacker.token);
    expect(mine.status).toBe(200);
    expect(mine.body.rewardedWinsToday).toBe(PVP_DAILY_REWARDED_WINS);
    expect(mine.body.stats.lifetime).toMatchObject({
      attackWins: PVP_DAILY_REWARDED_WINS + 1, attackLosses: 1,
    });
    const cappedRow = mine.body.attacks.find((e) => e.sessionId === capped.sessionId);
    expect(cappedRow).toMatchObject({ attackerWon: true, rewarded: false });
    expect(cappedRow?.replayAvailable).toBe(true);

    // ---- the stored recording is fetchable by both parties, and only them.
    const replay = await call<{ ok: boolean; config: { pvp: { defenderId: string } };
      inputs: unknown[]; attackerWon: boolean }>(
      "GET", `/raid/pvp/replay/${started.body.sessionId}`, defender.token);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.attackerWon).toBe(true);
    expect(replay.body.config.pvp.defenderId).toBe(defender.accountId);
    const outsider = await pvpPlayer("pvp-flow-s", [{ id: "d0" }]);
    const refused = await call<{ error: string }>(
      "GET", `/raid/pvp/replay/${started.body.sessionId}`, outsider.token);
    expect(refused.status).toBe(404);

    // ---- fill the day with retreats: the defense-reward cap and the pair cap.
    // Opened so far: 1 win + 1 retreat + 3 wins = 5 (or 2+cap-1 in general).
    const openedSoFar = 2 + PVP_DAILY_REWARDED_WINS;
    const extraRetreats: string[] = [];
    for (let opened = openedSoFar; opened < PVP_DAILY_ATTACKS_PER_PAIR; opened++) {
      const extra = await call<StartResponse>("POST", "/raid/pvp/start", attacker.token,
        startBody(defender.accountId));
      expect(extra.status, JSON.stringify(extra.body)).toBe(200);
      await call("POST", "/raid/pvp/finish", attacker.token, retreatFinish(extra.body.sessionId));
      extraRetreats.push(extra.body.sessionId);
    }
    const overCap = await call<{ error: string }>("POST", "/raid/pvp/start", attacker.token,
      startBody(defender.accountId));
    expect(overCap).toMatchObject({ status: 429, body: { error: "pair_limit" } });

    // Held defenses today: 1 (claimed) + extraRetreats. Only the first
    // PVP_DAILY_REWARDED_DEFENSES parked a reward; the rest were for the record.
    const backlog = await call<Overview>("GET", "/raid/pvp/history", defender.token);
    const rewardedLeft = PVP_DAILY_REWARDED_DEFENSES - 1; // one already claimed
    expect(backlog.body.claim.count).toBe(rewardedLeft);
    expect(backlog.body.rewardedDefensesToday).toBe(PVP_DAILY_REWARDED_DEFENSES);
    // An unrewarded held defense cannot be claimed even by hand.
    const unrewarded = extraRetreats[extraRetreats.length - 1];
    const refusedClaim = await call<{ error: string }>("POST", "/raid/pvp/collect",
      defender.token, { sessionId: unrewarded });
    expect(refusedClaim).toMatchObject({ status: 409, body: { error: "not_rewarded" } });

    // ---- claim-all drains the whole rewarded backlog in one go.
    const claimAll = await call<{ ok: boolean; claimed: number; rewards: { key: string; qty: number }[];
      remaining: boolean }>("POST", "/raid/pvp/collect-all", defender.token, {});
    expect(claimAll.status, JSON.stringify(claimAll.body)).toBe(200);
    expect(claimAll.body.claimed).toBe(rewardedLeft);
    expect(claimAll.body.rewards.length).toBeGreaterThan(0);
    expect(claimAll.body.remaining).toBe(false);
    const drained = await call<{ ok: boolean; claimed: number }>(
      "POST", "/raid/pvp/collect-all", defender.token, {});
    expect(drained.body.claimed).toBe(0);
    const after = await call<Overview>("GET", "/raid/pvp/history", defender.token);
    expect(after.body.claim.count).toBe(0);
  });
});
