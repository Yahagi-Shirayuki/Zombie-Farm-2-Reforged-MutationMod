// A pinned fight config is the largest thing this server stores — ~14 KB a session, and
// 413 MB of a 733 MB production database at beta volume, growing ~20 MB a day. It is
// read exactly once, by the finish path, and only while `finished_at IS NULL`; after
// settlement the session answers from `result_json` and never looks at it again.
//
// So the rule is: whatever sets `finished_at`, clears `config_json` in the same statement.
// The structural test below is the one that matters, because the failure mode is not a
// wrong answer — it is a FOURTH close path added later that quietly forgets, leaving the
// 30-day purge as the only thing bounding the table again. Nothing about the behaviour of
// such a path would look wrong; it would just grow the database.

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expireLiveRaid, finishRaid } from "../src/v3/raid";
import { RAID_RULESET_VERSION } from "../src/raidVerifier";

const root = fileURLToPath(new URL("..", import.meta.url));
const NOW = 1_700_000_000_000;

/** Every `UPDATE <table> SET ... WHERE` in the v3 server, as (table, setClause) pairs.
 *  Deliberately source-level rather than behavioural: a close path that is never
 *  exercised by a test is exactly the one that would slip through. */
function updateStatements(): { file: string; table: string; set: string }[] {
  const dir = `${root}src/v3/`;
  const found: { file: string; table: string; set: string }[] = [];
  for (const file of readdirSync(dir).filter((f: string) => f.endsWith(".ts"))) {
    const source = readFileSync(dir + file, "utf8");
    const pattern = /UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)\s+WHERE/g;
    for (const match of source.matchAll(pattern)) {
      found.push({ file, table: match[1], set: match[2] });
    }
  }
  return found;
}

describe("a spent fight config is released with the fight", () => {
  const SESSION_TABLES = ["raid_sessions_v3", "epic_boss_sessions_v3"];

  it.each(SESSION_TABLES)("every write that finishes %s also empties its config", (table) => {
    const finishing = updateStatements().filter(
      (s) => s.table === table && /\bfinished_at\s*=/.test(s.set)
    );
    // If this drops to zero the regex has stopped matching the code rather than the code
    // having stopped finishing sessions, which would make the assertion below vacuous.
    expect(finishing.length, `no statement finishes ${table} — has the SQL been reshaped?`)
      .toBeGreaterThan(0);
    for (const statement of finishing) {
      expect(
        statement.set,
        `${statement.file}: this statement sets finished_at on ${table} without clearing ` +
        `config_json, so the config outlives the fight that needed it`
      ).toMatch(/config_json\s*=/);
    }
  });

  // A PvP config OUTLIVES its fight on purpose — the defender still has to watch it —
  // but only inside the rolling replay window (PVP_REPLAYS_KEPT per role, 0057). So
  // the rule here is different from the raid tables': the settlement path must NOT
  // clear the config, and the ONE statement allowed to (the sweep) must carry both
  // keep-window guards, or a "simplification" quietly deletes live recordings.
  it("only the windowed sweep may clear a PvP config, and it must keep both replay windows", () => {
    const pvp = updateStatements().filter((s) => s.table === "pvp_sessions_v3");
    expect(pvp.length).toBeGreaterThan(0);
    const clearing = pvp.filter((s) => /config_json\s*=/.test(s.set));
    // Exactly one clearing statement: the sweep. A second one is a settlement path
    // that has started eating recordings.
    expect(clearing.length).toBe(1);
    for (const statement of clearing) {
      // The sweep must strip the transcript with the config (they are one recording)…
      expect(statement.set).toMatch(/inputs_json\s*=\s*NULL/i);
      // …and the full statement must protect BOTH participants' newest recordings.
      const source = readFileSync(`${root}src/v3/${statement.file}`, "utf8");
      const sweep = source.match(/UPDATE pvp_sessions_v3 SET config_json[\s\S]*?LIMIT \?2\)`\)/);
      expect(sweep, "the sweep statement has been reshaped — re-verify its guards").toBeTruthy();
      const windows = sweep![0].match(/id NOT IN/g) ?? [];
      expect(windows.length, "the sweep must keep the attacker's AND the defender's windows").toBe(2);
    }
  });
});

// ---- the two paths that finish a raid without settling it -------------------

class Statement {
  args: unknown[] = [];
  constructor(readonly sql: string, private readonly row: unknown) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() { return (this.sql.trimStart().startsWith("SELECT") ? this.row : null) as T; }
  async all<T>() { return { results: [] as T[] }; }
  async run() { return { meta: { changes: 1 } }; }
}

const fakeDb = (row: unknown) => {
  const batched: Statement[][] = [];
  return {
    batched,
    db: {
      prepare: (sql: string) => new Statement(sql, row),
      batch: async (st: Statement[]) => { batched.push(st); return st.map(() => ({ meta: { changes: 1 } })); },
    } as unknown as D1Database,
  };
};

const emptiesConfig = (batched: Statement[][]) =>
  batched.flat().some((s) => /UPDATE raid_sessions_v3[\s\S]*config_json\s*=\s*'\{\}'/.test(s.sql));

describe("the non-settlement close paths", () => {
  it("releases the config when an abandoned session is swept", async () => {
    const { db, batched } = fakeDb({ id: "sess-abandoned" });

    await expireLiveRaid(db, "acct", NOW);

    expect(emptiesConfig(batched)).toBe(true);
  });

  // Reached through finishRaid rather than by exporting the private close helper: a stale
  // ruleset is the cheapest gate that routes into it, and going in the front door proves
  // the real path rather than a seam opened for the test.
  it("releases the config when a session is closed as invalid", async () => {
    const { db, batched } = fakeDb({
      id: "sess-invalid",
      account_id: "acct",
      raid_id: 1,
      roster_json: JSON.stringify(["z1"]),
      boosts_json: "{}",
      config_json: JSON.stringify({ playerUnits: [], enemyUnits: [], rosterIds: ["z1"] }),
      ruleset_version: RAID_RULESET_VERSION - 1,
      started_at: NOW - 60_000,
      earliest_finish_at: NOW - 44_000,
      expires_at: NOW + 840_000,
      finished_at: null,
      result_json: null,
    });

    const result = await finishRaid(
      db, "acct", { sessionId: "sess-invalid", finalTick: 0, inputs: [{ seq: 1, tick: 0, type: "retreat" }] }, NOW
    );

    expect(result).toMatchObject({ status: 409, body: { error: "stale_ruleset" } });
    expect(emptiesConfig(batched)).toBe(true);
  });
});

// ---- migration 0056, rehearsed against real SQLite --------------------------

describe("migration 0056 releases the configs already on disk", () => {
  const schema = readFileSync(`${root}schema.sql`, "utf8");
  const migration = readFileSync(`${root}migrations/0056_release_spent_fight_configs.sql`, "utf8");
  const bigConfig = JSON.stringify({ playerUnits: Array.from({ length: 40 }, (_, i) => ({ i })) });

  const seeded = (): DatabaseSync => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(schema);
    db.exec(`INSERT INTO accounts (id, google_sub, friend_code, created_at, last_online_at)
      VALUES ('acct','g1','FC1',${NOW},${NOW});`);
    const row = (id: string, finishedAt: string) => `INSERT INTO raid_sessions_v3
      (id, account_id, raid_id, roster_json, boosts_json, config_json, ruleset_version,
       started_at, earliest_finish_at, expires_at, finished_at)
      VALUES ('${id}','acct','1','[]','{}','${bigConfig}',${RAID_RULESET_VERSION},
        ${NOW}, ${NOW}, ${NOW + 900_000}, ${finishedAt});`;
    db.exec(row("done", String(NOW + 60_000)));
    db.exec(row("live", "NULL"));
    return db;
  };

  const configOf = (db: DatabaseSync, id: string): string =>
    (db.prepare(`SELECT config_json AS c FROM raid_sessions_v3 WHERE id = '${id}'`).get() as { c: string }).c;

  it("empties a finished session and leaves a fight in progress alone", () => {
    const db = seeded();

    db.exec(migration);

    expect(configOf(db, "done")).toBe("{}");
    // The guard that makes this safe to run against a live production database: a raid
    // still being fought across the deploy keeps its config and settles normally.
    expect(configOf(db, "live")).toBe(bigConfig);
  });

  it("is idempotent, so a replay or a retried deploy is harmless", () => {
    const db = seeded();

    db.exec(migration);
    db.exec(migration);

    expect(configOf(db, "done")).toBe("{}");
    expect(configOf(db, "live")).toBe(bigConfig);
  });
});
