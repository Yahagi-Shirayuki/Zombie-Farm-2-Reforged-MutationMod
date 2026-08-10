// Migration 0049 adds periodic_quest_documents_v3 — and, unlike every v3 document
// table before it, it lands on a database that already has accounts in it.
//
// That matters because creating the table is only half the job. `ensureV3` fills the row
// in lazily on bootstrap / a command batch / a presentation write, which would be
// perfectly sufficient if every reader went through it — but `/raid/finish` reads this
// row DIRECTLY (it loads no v3 projection) and answers `state_conflict` when it comes
// back null. An account whose last bootstrap predates the deploy, settling an invasion
// after it, would lose a won fight. So the migration BACKFILLS, and this rehearses it
// against real SQLite the way the 0044/0045 tests do: build the pre-migration database,
// fill it, apply the migration, and assert both what it is for and what it must not
// disturb.
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = readFileSync(`${root}schema.sql`, "utf8");
const migration = readFileSync(`${root}migrations/0049_periodic_quests.sql`, "utf8");

const NOW = 1_700_000_000_000;

/** A database in the shape it had BEFORE this migration: today's schema.sql with the
 *  periodic document table taken back out. The removal is asserted, so a later rename of
 *  the table that silently un-rehearses the migration fails here rather than in
 *  production. */
function seededPreMigrationDb(): DatabaseSync {
  const before = schema.replace(
    /CREATE TABLE IF NOT EXISTS periodic_quest_documents_v3 \([^;]*\);/,
    ""
  );
  expect(before, "schema.sql no longer creates periodic_quest_documents_v3").not.toBe(schema);

  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(before);
  // Three accounts that predate the feature entirely — none of them has ever had a
  // periodic document, because the table they would hold one in does not exist yet.
  db.exec(`INSERT INTO accounts (id, google_sub, friend_code, created_at, last_online_at)
    VALUES ('acct1','g1','FC1',${NOW},${NOW}),
           ('acct2','g2','FC2',${NOW},${NOW}),
           ('acct3','g3','FC3',${NOW},${NOW});`);
  return db;
}

const scalar = (db: DatabaseSync, sql: string): unknown =>
  Object.values(db.prepare(sql).get() as Record<string, unknown>)[0];
const count = (db: DatabaseSync, sql: string): number => Number(scalar(db, sql));

describe("migration 0049 — periodic quest documents", () => {
  it("gives every pre-existing account a row rather than waiting for a bootstrap", () => {
    const db = seededPreMigrationDb();
    expect(count(db, `SELECT COUNT(*) FROM sqlite_master
      WHERE type='table' AND name='periodic_quest_documents_v3'`)).toBe(0);

    db.exec(migration);

    // The whole point: /raid/finish can read a row for any account the moment the
    // migration lands, without that account having bootstrapped since.
    expect(count(db, "SELECT COUNT(*) FROM periodic_quest_documents_v3")).toBe(3);
    expect(count(db, `SELECT COUNT(*) FROM accounts a WHERE NOT EXISTS (
      SELECT 1 FROM periodic_quest_documents_v3 p WHERE p.account_id = a.id)`)).toBe(0);
    db.close();
  });

  it("backfills an EMPTY board, indistinguishable from one ensureV3 would have made", () => {
    const db = seededPreMigrationDb();
    db.exec(migration);

    // Same defaults ensureV3 inserts: version 0 and both scopes null. A backfilled
    // account must not read as one that already had quests generated, or its first
    // refresh would think the period had not rolled over.
    const row = db.prepare(`SELECT version, current_json FROM periodic_quest_documents_v3
      WHERE account_id = 'acct1'`).get() as { version: number; current_json: string };
    expect(row.version).toBe(0);
    expect(JSON.parse(row.current_json)).toEqual({ daily: null, weekly: null });
    db.close();
  });

  it("does not clobber a board that already exists when it is applied again", () => {
    const db = seededPreMigrationDb();
    db.exec(migration);

    // A day's play lands on acct2. Wrangler runs a migration once and records it, so a
    // second pass should never happen — which is exactly why it is worth pinning: the
    // backfill must be OR IGNORE rather than OR REPLACE, so that if one ever is replayed
    // (a restored snapshot, a hand-run file, a botched d1_migrations row) it skips the
    // accounts that have a board instead of wiping their progress.
    const board = JSON.stringify({
      daily: { period: 20000, level: 12, quests: [], counts: [], claimed: ["daily_plow"] },
      weekly: null,
    });
    db.prepare(`UPDATE periodic_quest_documents_v3
      SET version = 7, current_json = ?, updated_at = ? WHERE account_id = 'acct2'`)
      .run(board, NOW);

    db.exec(migration);

    const row = db.prepare(`SELECT version, current_json FROM periodic_quest_documents_v3
      WHERE account_id = 'acct2'`).get() as { version: number; current_json: string };
    expect(row.version).toBe(7);
    expect(row.current_json).toBe(board);
    expect(count(db, "SELECT COUNT(*) FROM periodic_quest_documents_v3")).toBe(3);
    db.close();
  });

  it("takes an account's board with it when the account is deleted", () => {
    const db = seededPreMigrationDb();
    db.exec(migration);

    // The ON DELETE CASCADE is declared on the table, but the backfilled rows are the
    // first ones to exercise it — they were inserted by SQL rather than by ensureV3.
    db.exec("DELETE FROM accounts WHERE id = 'acct3'");
    expect(count(db, `SELECT COUNT(*) FROM periodic_quest_documents_v3
      WHERE account_id = 'acct3'`)).toBe(0);
    db.close();
  });
});
