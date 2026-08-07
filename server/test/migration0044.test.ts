// Migration 0044 rebuilds black_market_orders (to widen mutation_required's CHECK)
// AND black_market_receipts. A table rebuild is the one migration shape that can lose
// data silently: SQLite's DROP TABLE runs an implicit DELETE FROM, which fires the
// receipts table's ON DELETE CASCADE. So this rehearses the whole thing against a real
// SQLite database — build the PRE-migration schema, fill it, apply the migration, and
// assert both the change it is for and everything it must not have disturbed.
//
// Run against node:sqlite rather than D1: the SQL is plain SQLite and the failure mode
// under test (foreign-key cascade during DROP) is core SQLite behaviour, not a D1 one.
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = readFileSync(`${root}schema.sql`, "utf8");
const migration = readFileSync(
  `${root}migrations/0044_black_market_mutation_width.sql`, "utf8"
);

const NOW = 1_700_000_000_000;

/** A database in the shape it had BEFORE this migration, with orders and receipts in
 *  it. The only difference from today's schema.sql is the CHECK 0044 widens, so it is
 *  reconstructed by putting that one clause back. */
function seededPreMigrationDb(): DatabaseSync {
  const before = schema.replace("mutation_required > 0", "mutation_required BETWEEN 1 AND 8191");
  expect(before, "schema.sql no longer contains the widened CHECK").not.toBe(schema);

  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(before);
  db.exec(`INSERT INTO accounts (id, google_sub, friend_code, created_at, last_online_at)
    VALUES ('acct1','g1','FC1',${NOW},${NOW}),('acct2','g2','FC2',${NOW},${NOW});`);
  db.exec(`INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,
      mutated_required,mutation_required,price_brains,created_day,created_at,escrow_brains)
    VALUES ('o1','acct1','BUY_ZOMBIE','ZombieActorRegularTier1',1,4096,10,1,${NOW},10),
           ('o2','acct1','BUY_ZOMBIE','ZombieActorRegularTier1',1,NULL,10,1,${NOW},10);`);
  db.exec(`INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,
      mutated_required,price_brains,created_day,created_at,source_unit_id,escrow_mutation,
      escrow_invasions,escrow_brains,escrow_color,delivered_mutation)
    VALUES ('o3','acct1','SELL_ZOMBIE','ZombieActorRegularTier1',1,10,1,${NOW},'u1',8192,3,0,
            '[1,2,3]',8192);`);
  db.exec(`INSERT INTO black_market_receipts VALUES
    ('op1','acct1','CREATE','fp1','o1',${NOW}),
    ('op2','acct2','FULFILL','fp2','o3',${NOW});`);
  return db;
}

const scalar = (db: DatabaseSync, sql: string): unknown =>
  Object.values(db.prepare(sql).get() as Record<string, unknown>)[0];
const count = (db: DatabaseSync, sql: string): number => scalar(db, sql) as number;
const refuses = (db: DatabaseSync, sql: string): boolean => {
  try { db.exec(sql); return false; } catch { return true; }
};

/** A wanted post naming `mask`, as the Worker would insert one. */
const buyOrder = (id: string, mask: number | null) =>
  `INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,mutated_required,
     mutation_required,price_brains,created_day,created_at,escrow_brains)
   VALUES ('${id}','acct1','BUY_ZOMBIE','ZombieActorRegularTier1',1,${mask ?? "NULL"},10,1,${NOW},10);`;

describe("migration 0044 — black market mutation width", () => {
  it("removes the 13-bit ceiling that made new mutations unrequestable", () => {
    const db = seededPreMigrationDb();
    // The bug: Pumpking has existed for ages and could never be asked for.
    expect(refuses(db, buyOrder("bad", 8192))).toBe(true);

    db.exec(migration);

    expect(refuses(db, buyOrder("o4", 8192))).toBe(false);
    // And a bit that does not exist yet, which is the point — the catalog can grow
    // without another table rebuild.
    expect(refuses(db, buyOrder("o5", 2 ** 20))).toBe(false);
    expect(scalar(db, "SELECT sql FROM sqlite_master WHERE name='black_market_orders'"))
      .not.toContain("8191");
  });

  it("keeps every row, column value and index across the rebuild", () => {
    const db = seededPreMigrationDb();
    const indexes = "SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name LIKE 'idx_black_market%'";
    const before = {
      orders: count(db, "SELECT COUNT(*) c FROM black_market_orders"),
      indexes: count(db, indexes),
    };

    db.exec(migration);

    expect(count(db, "SELECT COUNT(*) c FROM black_market_orders")).toBe(before.orders);
    expect(count(db, indexes)).toBe(before.indexes);
    expect(scalar(db, "SELECT mutation_required FROM black_market_orders WHERE id='o1'")).toBe(4096);
    expect(scalar(db, "SELECT escrow_color FROM black_market_orders WHERE id='o3'")).toBe("[1,2,3]");
    expect(scalar(db, "SELECT delivered_mutation FROM black_market_orders WHERE id='o3'")).toBe(8192);
    expect(count(db, "SELECT COUNT(*) c FROM sqlite_master WHERE name LIKE '%\\_0044' ESCAPE '\\'")).toBe(0);
  });

  it("does NOT take the idempotency receipts with it", () => {
    // The hazard this migration is shaped around. If the old orders table were dropped
    // while receipts still referenced it, every receipt would cascade away — and a
    // replayed CREATE/CANCEL/FULFILL operation would then execute a second time.
    const db = seededPreMigrationDb();
    const before = count(db, "SELECT COUNT(*) c FROM black_market_receipts");
    expect(before).toBe(2);

    db.exec(migration);

    expect(count(db, "SELECT COUNT(*) c FROM black_market_receipts")).toBe(before);
    expect(scalar(db, "SELECT order_id FROM black_market_receipts WHERE operation_id='op1'"))
      .toBe("o1");
  });

  it("carries the foreign keys and the rest of the CHECKs across", () => {
    const db = seededPreMigrationDb();
    db.exec(migration);

    // receipts -> orders, still enforced and still cascading after the rename.
    expect(refuses(db, `INSERT INTO black_market_receipts VALUES ('op9','acct1','CREATE','fp9','nope',${NOW});`))
      .toBe(true);
    db.exec("DELETE FROM black_market_orders WHERE id='o1';");
    expect(count(db, "SELECT COUNT(*) c FROM black_market_receipts WHERE order_id='o1'")).toBe(0);

    // orders -> accounts.
    db.exec("DELETE FROM accounts WHERE id='acct1';");
    expect(count(db, "SELECT COUNT(*) c FROM black_market_orders WHERE creator_account_id='acct1'")).toBe(0);
  });

  it("still refuses the requirements it always refused", () => {
    const db = seededPreMigrationDb();
    db.exec(migration);

    expect(refuses(db, buyOrder("o6", 0))).toBe(true); // "no mutation" is NULL, not 0
    // mutation_required belongs to a wanted post; a sale has an escrowed unit instead.
    expect(refuses(db, `INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,
        mutated_required,mutation_required,price_brains,created_day,created_at,source_unit_id,
        escrow_mutation,escrow_invasions,escrow_brains)
      VALUES ('o7','acct1','SELL_ZOMBIE','ZombieActorRegularTier1',1,4,10,1,${NOW},'u2',4,0,0);`))
      .toBe(true);
    // The kind/escrow CHECK: a BUY must escrow its brains.
    expect(refuses(db, `INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,
        mutated_required,price_brains,created_day,created_at,escrow_brains)
      VALUES ('o8','acct1','BUY_ZOMBIE','ZombieActorRegularTier1',1,10,1,${NOW},0);`))
      .toBe(true);
  });
});
