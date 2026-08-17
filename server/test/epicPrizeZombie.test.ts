import { describe, expect, it } from "vitest";
import { finish } from "../src/v3/epicBoss";
import { RAID_RULESET_VERSION } from "../../src/raid/replay";
import { ROCKY_RHINO, epicBossHp } from "../../src/epicBoss/catalog";

const unit = (over: Record<string, unknown>) => ({
  id: "u", sourceKey: "ZombieActorRegularTier1", team: "player", name: "Z",
  str: 200, dex: 3, con: 50, focus: 0, hp: 5000, maxHp: 5000,
  attackCooldownMs: 300, attacks: [{ name: "A", frequency: 100, mult: 1 }],
  isBoss: false, alive: true, isGarden: false, isHeadless: false, abilities: [],
  ...over,
});

const STARTING_HP = 1;
const config = {
  rulesetVersion: RAID_RULESET_VERSION,
  playerUnits: [unit({ id: "z1" })],
  enemyUnits: [unit({
    id: "boss", sourceKey: "EpicBoss:rocky-rhino", team: "enemy", name: "Rocky Rhino",
    str: 1, dex: 2, con: 20, hp: STARTING_HP, maxHp: STARTING_HP, isBoss: true,
  })],
};

const rows = (questCompleted: string[], deployed: number) => ({
  epic_boss_sessions_v3: {
    id: "sess", run_id: "run", level: 5, starting_hp: STARTING_HP,
    roster_json: JSON.stringify(["z1"]), config_json: JSON.stringify(config),
    started_at: 1_000, expires_at: 10_000_000, finished_at: null, result_json: null,
  },
  epic_boss_runs_v3: {
    account_id: "acct", run_id: "run", boss_id: "rocky-rhino", activated_at: 0,
    expires_at: 10_000_000, level: 5, max_hp: epicBossHp(ROCKY_RHINO, 5), current_hp: STARTING_HP,
    encounter_started_at: 1_000, retry_ready_at: 0, token_count: 0, completed_at: 0,
    attack_order_json: "[]",
  },
  balances: { gold: 0, brains: 0, xp: 218_000, claimed_level: 45 },
  gameplay_documents_v3: { current_json: JSON.stringify({ inventory: {}, storage: { received: {}, stored: {} }, ownedPets: [], zombieMax: 16 }) },
  quest_documents_v3: { version: 3, current_json: JSON.stringify({ completed: questCompleted, progress: [] }) },
  object_documents_v3: { current_json: "[]" },
  raid_state_v3: { last_started_at: 0 },
  __rosterCounts: [{ stored: 0, count: deployed }],
});

class Statement {
  args: unknown[] = [];
  constructor(readonly sql: string, private readonly rows: Record<string, unknown>) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() {
    const table = Object.keys(this.rows).find((n) => !n.startsWith("__") && this.sql.includes(n));
    return (table ? this.rows[table] : null) as T;
  }
  async all<T>() {
    if (this.sql.includes("GROUP BY stored")) return { results: (this.rows as never as { __rosterCounts: T[] }).__rosterCounts };
    return { results: [] as T[] };
  }
}
const fakeDb = (rows: Record<string, unknown>) => {
  const batched: Statement[][] = [];
  return {
    batched,
    db: {
      prepare: (sql: string) => new Statement(sql, rows),
      batch: async (st: Statement[]) => { batched.push(st); return st.map(() => ({ meta: { changes: 1 } })); },
    } as unknown as D1Database,
  };
};

describe("Rocky Rhino rung 5 pays Brock Coley", () => {
  it("grants the prize zombie on a fresh quest slate", async () => {
    const { db } = fakeDb(rows([], 3));
    const res = await finish(db, "acct", { sessionId: "sess", finalTick: 200, inputs: [] }, 30_000, () => 0.99);
    console.log("STATUS", res.status, JSON.stringify(res.body).slice(0, 400));
    expect(res.status).toBe(200);
    expect(res.body.defeatedLevel).toBe(5);
    expect(res.body.newZombies).toEqual([
      expect.objectContaining({ key: "ZombieActorBrockColey", stored: false }),
    ]);
  });

  it("files the prize in Received when the army is full", async () => {
    const { db } = fakeDb(rows([], 16));
    const res = await finish(db, "acct", { sessionId: "sess", finalTick: 200, inputs: [] }, 30_000, () => 0.99);
    console.log("FULL", res.status, JSON.stringify((res.body as never as {newZombies:unknown}).newZombies));
    expect(res.body.newZombies).toEqual([
      expect.objectContaining({ key: "ZombieActorBrockColey", stored: true, received: true }),
    ]);
  });
});
