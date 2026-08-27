import { describe, expect, it } from "vitest";
import { finishRaid } from "../src/v3/raid";
import { RAID_RULESET_VERSION } from "../src/raidVerifier";

// The invasion session TTL used to VOID a fight, not just release its roster: a finish
// arriving after `expires_at` was answered 200 with `{expired:true}` and nothing else —
// no replay, no rewards, whatever the battle had actually done.
//
// The battle does not run on wall clock (it is driven by the Pixi ticker), so a
// backgrounded tab or a locked phone freezes it while the deadline keeps counting.
// That is how an honest win reached the branch: 11 sessions across 11 accounts in 8
// days of prod, 18 to 785 minutes late, one apiece — people walking away mid-fight.
//
// Nothing about a late transcript is easier to forge than a prompt one: the replay runs
// byte-for-byte off the config pinned at /raid/start, `pacedTick` still refuses a
// finalTick ahead of wall clock, and RAID_MAX_TICKS caps any replay at four simulated
// minutes however long the session has been open. So the clock now governs only the
// roster lock, and `finishRaid` keys on that lock instead.

const HOUR = 3_600_000;
const NOW = 10 * HOUR;

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: "sess-late",
  account_id: "acct",
  raid_id: 1,
  roster_json: JSON.stringify(["zombie-1"]),
  boosts_json: "{}",
  config_json: "{}",
  ruleset_version: RAID_RULESET_VERSION,
  started_at: NOW - 2 * HOUR,
  earliest_finish_at: NOW - 2 * HOUR + 16_000,
  // Ninety minutes past its fifteen-minute deadline, and never swept: `expireLiveRaid`
  // only runs on a bootstrap or another launch, neither of which a player mid-fight
  // performs. This is exactly the reported state.
  expires_at: NOW - 105 * 60_000,
  finished_at: null,
  result_json: null,
  ...over,
});

class Statement {
  args: unknown[] = [];
  constructor(readonly sql: string, private readonly row: unknown) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() { return (this.sql.startsWith("SELECT") ? this.row : null) as T; }
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

const body = (over: Record<string, unknown> = {}) => ({
  sessionId: "sess-late",
  finalTick: 0,
  inputs: [{ seq: 1, tick: 0, type: "retreat" }],
  ...over,
});

describe("an invasion settled after its session deadline", () => {
  it("is judged on its merits rather than voided on the clock", async () => {
    // A stale ruleset is the cheapest gate BELOW the old expiry short-circuit, so
    // reaching it proves the clock no longer preempts the settlement. Before the change
    // this answered 200 {expired:true} and the fight was gone.
    const { db } = fakeDb(sessionRow({ ruleset_version: RAID_RULESET_VERSION - 1 }));

    const result = await finishRaid(db, "acct", body(), NOW);

    expect(result.body.expired).toBeUndefined();
    expect(result).toMatchObject({ status: 409, body: { error: "stale_ruleset" } });
  });

  it("runs the replay it used to skip", async () => {
    // Current ruleset, unparseable pinned config: the failure now comes from the replay
    // setup, which the expiry branch used to return above.
    const { db } = fakeDb(sessionRow({ config_json: "{not json" }));

    const result = await finishRaid(db, "acct", body(), NOW);

    expect(result.body.expired).toBeUndefined();
    expect(result).toMatchObject({ status: 409, body: { error: "bad_session_config" } });
  });

  it("does not quietly bank a zeroed result or free the roster", async () => {
    const { db, batched } = fakeDb(sessionRow({ ruleset_version: RAID_RULESET_VERSION - 1 }));

    await finishRaid(db, "acct", body(), NOW);

    // The old branch wrote {expired:true} into result_json and unlocked the roster in
    // one batch. Whatever this session's fate is now, it is not decided by the clock.
    const written = batched.flat().map((s) => JSON.stringify(s.args));
    expect(written.some((args) => args.includes('\\"expired\\":true'))).toBe(false);
  });

  // The lock IS the correctness boundary the clock was standing in for. Once
  // `expireLiveRaid` has released it those units are free and may have fought
  // elsewhere, so retroactive casualties and veterancy would be unsound — not merely
  // generous. That case keeps answering 409, deadline or no deadline.
  it("still refuses a session whose roster lock has already been released", async () => {
    const { db } = fakeDb(sessionRow({ finished_at: NOW - 60_000 }));

    const result = await finishRaid(db, "acct", body(), NOW);

    expect(result).toMatchObject({ status: 409, body: { error: "already_finished" } });
  });

  it("still replays a settled result rather than re-running it", async () => {
    const stored = { outcome: { win: true }, gold: 500 };
    const { db } = fakeDb(sessionRow({
      finished_at: NOW - 60_000, result_json: JSON.stringify(stored),
    }));

    const result = await finishRaid(db, "acct", body(), NOW);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject(stored);
  });
});
