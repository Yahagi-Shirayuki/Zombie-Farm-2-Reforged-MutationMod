// Settling an invasion used to write every surviving zombie's row TWICE — once to tick
// `invasions`, once to drop the raid lock. Across the beta that was 420k of 5.9M rows
// written, ~7% of the entire D1 write bill, and D1 charges $1.00 per million rows written.
// The two writes are now one.
//
// The whole risk of that change lives in one SQL CASE, so this runs the PRODUCTION string
// (releaseRosterSql, not a copy of it) against real SQLite. The failure it exists to catch
// is silent: a blanket `invasions + 1` would look correct, pass any "survivors gain
// veterancy" test, and quietly hand a free rank to every zombie that merely walked away
// from a retreat — +5% a rank, compounding, across the whole player base.

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { releaseRosterSql } from "../src/v3/raid";

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = readFileSync(`${root}schema.sql`, "utf8");
const NOW = 1_700_000_000_000;
const SESSION = "sess-1";
const OTHER = "sess-other";

/** The guard every settlement statement carries: the session row must already hold the
 *  result this batch is writing. Seeded to pass, so the test measures the CASE rather than
 *  the fence — the fence has its own coverage in the settlement path. */
const GUARD = "EXISTS (SELECT 1 FROM raid_sessions_v3 s WHERE s.id = ? AND s.result_json = ?)";
const RESULT = '{"settled":true}';

interface Unit { id: string; invasions: number; lockedBy: string | null }

function seeded(units: Unit[]): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  db.exec(`INSERT INTO accounts (id, google_sub, friend_code, created_at, last_online_at)
    VALUES ('acct','g1','FC1',${NOW},${NOW});`);
  for (const id of [SESSION, OTHER]) {
    db.exec(`INSERT INTO raid_sessions_v3
      (id, account_id, raid_id, roster_json, boosts_json, config_json, ruleset_version,
       started_at, earliest_finish_at, expires_at, finished_at, result_json)
      VALUES ('${id}','acct','1','[]','{}','{}',1,${NOW},${NOW},${NOW},${NOW},'${RESULT}');`);
  }
  for (const u of units) {
    db.exec(`INSERT INTO roster_v3
      (account_id, unit_id, zombie_key, mutation, invasions, stored, locked_by_raid, created_at)
      VALUES ('acct','${u.id}','ZombieActorRegularTier1',0,${u.invasions},0,
        ${u.lockedBy === null ? "NULL" : `'${u.lockedBy}'`},${NOW});`);
  }
  return db;
}

/** Run the real production statement with the real bind order. */
function release(db: DatabaseSync, survivors: string[]): void {
  db.prepare(releaseRosterSql(survivors, GUARD))
    .run(...survivors, "acct", SESSION, SESSION, RESULT);
}

const readBack = (db: DatabaseSync) =>
  Object.fromEntries(
    (["z1", "z2", "z3", "z4"] as const).map((id) => {
      const row = db.prepare(
        `SELECT invasions, locked_by_raid FROM roster_v3 WHERE unit_id = '${id}'`
      ).get() as { invasions: number; locked_by_raid: string | null } | undefined;
      return [id, row ? { invasions: row.invasions, locked: row.locked_by_raid } : null];
    })
  );

describe("releasing a settled invasion's roster", () => {
  it("ticks veterancy for survivors and releases everyone the fight locked", () => {
    const db = seeded([
      { id: "z1", invasions: 3, lockedBy: SESSION },
      { id: "z2", invasions: 0, lockedBy: SESSION },
    ]);

    release(db, ["z1", "z2"]);

    expect(readBack(db)).toMatchObject({
      z1: { invasions: 4, locked: null },
      z2: { invasions: 1, locked: null },
    });
  });

  // The reason the CASE exists. On a retreat the replay brings zombies home that it does
  // not count as survivors: they are unlocked, but they did not survive an invasion and
  // must not gain a rank for walking away.
  it("brings a retreat's escapees home WITHOUT giving them a rank", () => {
    const db = seeded([
      { id: "z1", invasions: 3, lockedBy: SESSION },  // survivor
      { id: "z2", invasions: 7, lockedBy: SESSION },  // escaped, not a survivor
    ]);

    release(db, ["z1"]);

    expect(readBack(db)).toMatchObject({
      z1: { invasions: 4, locked: null },
      z2: { invasions: 7, locked: null },
    });
  });

  // A concession fallback empties `survivors` outright while still releasing the roster.
  // With no survivor ids there is no IN (...) to build, so the statement must degrade to a
  // plain unlock rather than emitting `IN ()` — which SQLite rejects outright.
  it("releases the roster with no veterancy at all when there are no survivors", () => {
    const db = seeded([
      { id: "z1", invasions: 3, lockedBy: SESSION },
      { id: "z2", invasions: 7, lockedBy: SESSION },
    ]);

    release(db, []);

    expect(readBack(db)).toMatchObject({
      z1: { invasions: 3, locked: null },
      z2: { invasions: 7, locked: null },
    });
  });

  it("touches nothing outside the fight that locked it", () => {
    const db = seeded([
      { id: "z1", invasions: 3, lockedBy: SESSION },
      { id: "z3", invasions: 5, lockedBy: OTHER },  // fighting an Epic Boss elsewhere
      { id: "z4", invasions: 9, lockedBy: null },   // standing on the farm
    ]);

    // z3 and z4 named as survivors anyway: the lock, not the id list, is what decides.
    release(db, ["z1", "z3", "z4"]);

    expect(readBack(db)).toMatchObject({
      z1: { invasions: 4, locked: null },
      z3: { invasions: 5, locked: OTHER },
      z4: { invasions: 9, locked: null },
    });
  });

  it("writes each surviving row exactly once — the point of the change", () => {
    const db = seeded([
      { id: "z1", invasions: 0, lockedBy: SESSION },
      { id: "z2", invasions: 0, lockedBy: SESSION },
    ]);

    const changes = db.prepare(releaseRosterSql(["z1", "z2"], GUARD))
      .run("z1", "z2", "acct", SESSION, SESSION, RESULT).changes;

    // Two zombies, two rows written. The old shape wrote four: a bump each, then the unlock.
    expect(changes).toBe(2);
  });
});
