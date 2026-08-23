import { describe, expect, it } from "vitest";
import { befriend, call, grantBalance, grantRoster, signIn, uniqueSub } from "./helpers";
import { RAID_RULESET_VERSION } from "../../../src/raid/replay";
import { PVP_ARMY_SIZE, PVP_DAILY_ATTACKS_PER_PAIR } from "../../../src/raid/pvp";

// Friend invasions (PvP) end-to-end: /raid/pvp/start pins the whole fight (attacker
// eight + a snapshot of the defender's deployed zombies), /raid/pvp/finish settles it
// by the server's OWN replay (finalTick 0 + no inputs = "simulate the whole fight" via
// the overrun path — the same machinery that stops backgrounded raids being voided),
// and a held defense parks a claim-on-login reward for the defender.

const ATTACK_IDS = Array.from({ length: PVP_ARMY_SIZE }, (_, i) => `a${i}`);

async function pvpPlayer(label: string, unitIds: string[]) {
  const s = await signIn(uniqueSub(label));
  await grantBalance(s, { gold: 0, brains: 0, xp: 0 });
  await grantRoster(s, unitIds.map((id) => ({ id, key: "ZombieActorRegularTier1", stored: false })));
  return s;
}

const startBody = (defenderId: string, orderedUnitIds: string[] = ATTACK_IDS) => ({
  defenderId, orderedUnitIds, rulesetVersion: RAID_RULESET_VERSION,
});

describe("friend invasion start gates", () => {
  it("requires friendship, the current ruleset, exactly eight owned units, and a defense", async () => {
    const attacker = await pvpPlayer("pvp-gate-a", ATTACK_IDS);
    const stranger = await pvpPlayer("pvp-gate-s", ["d0"]);

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
    await befriend(attacker, empty);
    const noDefense = await call<{ error: string }>("POST", "/raid/pvp/start", attacker.token,
      startBody(empty.accountId));
    expect(noDefense.body.error).toBe("no_defense");
  });
});

describe("friend invasion — attack, defense claim, pair cap", () => {
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
    rewards: { key: string; qty: number }[];
    inventory?: Record<string, number>;
    error?: string;
  }

  it("settles a verified win with boost rewards, holds a defense claim, and caps the pair per day", async () => {
    // 8 attackers vs a single defender of the same species: the attacker wins the
    // server's own simulation of the fight.
    const attacker = await pvpPlayer("pvp-flow-a", ATTACK_IDS);
    const defender = await pvpPlayer("pvp-flow-d", ["d0"]);
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
    const retreated = await call<FinishResponse>("POST", "/raid/pvp/finish", attacker.token, {
      sessionId: retreatStart.body.sessionId, finalTick: 0,
      inputs: [{ seq: 1, tick: 0, type: "retreat" }],
    });
    expect(retreated.status, JSON.stringify(retreated.body)).toBe(200);
    expect(retreated.body.win).toBe(false);
    expect(retreated.body.rewards).toEqual([]);

    // The defender sees both rows; only the held defense is claimable.
    const history = await call<{ entries: { sessionId: string; role: string; attackerWon: boolean; claimableTier?: number }[] }>(
      "GET", "/raid/pvp/history", defender.token);
    expect(history.status).toBe(200);
    const held = history.body.entries.find((e) => e.sessionId === retreatStart.body.sessionId);
    const lost = history.body.entries.find((e) => e.sessionId === started.body.sessionId);
    expect(held).toMatchObject({ role: "defender", attackerWon: false });
    expect(held?.claimableTier).toBeGreaterThanOrEqual(1);
    expect(lost).toMatchObject({ role: "defender", attackerWon: true });
    expect(lost?.claimableTier).toBeUndefined();

    const collected = await call<{ ok: boolean; rewards: { key: string; qty: number }[]; inventory?: Record<string, number> }>(
      "POST", "/raid/pvp/collect", defender.token, { sessionId: retreatStart.body.sessionId });
    expect(collected.status, JSON.stringify(collected.body)).toBe(200);
    expect(collected.body.rewards.length).toBeGreaterThan(0);
    const again = await call<{ error: string }>("POST", "/raid/pvp/collect", defender.token,
      { sessionId: retreatStart.body.sessionId });
    expect(again).toMatchObject({ status: 409, body: { error: "already_claimed" } });
    // A raid the attacker WON offers the defender nothing.
    const notHeld = await call<{ error: string }>("POST", "/raid/pvp/collect", defender.token,
      { sessionId: started.body.sessionId });
    expect(notHeld).toMatchObject({ status: 409, body: { error: "not_defended" } });
    // Only the defender may claim.
    const wrongParty = await call<{ error: string }>("POST", "/raid/pvp/collect", attacker.token,
      { sessionId: retreatStart.body.sessionId });
    expect(wrongParty.status).toBe(404);

    // ---- pair cap: opened attacks (not wins) count. Two are on the books; open the
    // rest of today's allowance, then the next is refused.
    for (let i = 2; i < PVP_DAILY_ATTACKS_PER_PAIR; i++) {
      const extra = await call<StartResponse>("POST", "/raid/pvp/start", attacker.token,
        startBody(defender.accountId));
      expect(extra.status, JSON.stringify(extra.body)).toBe(200);
      await call("POST", "/raid/pvp/finish", attacker.token, {
        sessionId: extra.body.sessionId, finalTick: 0,
        inputs: [{ seq: 1, tick: 0, type: "retreat" }],
      });
    }
    const overCap = await call<{ error: string }>("POST", "/raid/pvp/start", attacker.token,
      startBody(defender.accountId));
    expect(overCap).toMatchObject({ status: 429, body: { error: "pair_limit" } });
  });
});
