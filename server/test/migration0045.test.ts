// Migration 0045 rebuilds black_market_orders again — this time to widen the price
// CHECK to 10,000,000 and add the `currency` column that lets a post be priced in gold.
// It is the same rebuild shape as 0044, so it carries the same hazard: SQLite's
// DROP TABLE runs an implicit DELETE FROM, which fires black_market_receipts'
// ON DELETE CASCADE and would silently take the whole idempotency ledger with it.
// This rehearses the migration against real SQLite — build the PRE-migration database,
// fill it, apply the migration, and assert both what it is for and everything it must
// not have disturbed.
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = readFileSync(`${root}schema.sql`, "utf8");
const migration = readFileSync(`${root}migrations/0045_black_market_gold.sql`, "utf8");

const NOW = 1_700_000_000_000;

/** A database in the shape it had BEFORE this migration: today's schema.sql with the
 *  narrow price ceiling put back and the currency column taken out again. Both edits are
 *  asserted, so a later rename of either silently un-rehearsing the migration fails
 *  here rather than in production. */
function seededPreMigrationDb(): DatabaseSync {
  const narrowed = schema.replace("price_brains BETWEEN 1 AND 10000000",
    "price_brains BETWEEN 1 AND 1000000");
  expect(narrowed, "schema.sql no longer contains the widened price CHECK").not.toBe(schema);
  const before = narrowed.replace(/^.*currency TEXT NOT NULL DEFAULT 'BRAINS'.*$/m, "");
  expect(before, "schema.sql no longer declares the currency column").not.toBe(narrowed);

  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(before);
  db.exec(`INSERT INTO accounts (id, google_sub, friend_code, created_at, last_online_at)
    VALUES ('acct1','g1','FC1',${NOW},${NOW}),('acct2','g2','FC2',${NOW},${NOW});`);
  db.exec(`INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,
      mutated_required,mutation_required,price_brains,created_day,created_at,escrow_brains)
    VALUES ('o1','acct1','BUY_ZOMBIE','ZombieActorRegularTier1',1,4096,10,1,${NOW},10);`);
  db.exec(`INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,
      mutated_required,price_brains,created_day,created_at,source_unit_id,escrow_mutation,
      escrow_invasions,escrow_brains,escrow_color,delivered_mutation)
    VALUES ('o2','acct1','SELL_ZOMBIE','ZombieActorRegularTier1',1,10,1,${NOW},'u1',8192,3,0,
            '[1,2,3]',8192);`);
  db.exec(`INSERT INTO black_market_receipts VALUES
    ('op1','acct1','CREATE','fp1','o1',${NOW}),
    ('op2','acct2','FULFILL','fp2','o2',${NOW});`);
  return db;
}

const scalar = (db: DatabaseSync, sql: string): unknown =>
  Object.values(db.prepare(sql).get() as Record<string, unknown>)[0];
const count = (db: DatabaseSync, sql: string): number => scalar(db, sql) as number;
const refuses = (db: DatabaseSync, sql: string): boolean => {
  try { db.exec(sql); return false; } catch { return true; }
};

/** A sale post at `price`, in `currency` when the column exists. */
const saleOrder = (id: string, price: number, currency?: string) =>
  `INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,mutated_required,
     price_brains,${currency ? "currency," : ""}created_day,created_at,source_unit_id,
     escrow_mutation,escrow_invasions,escrow_brains)
   VALUES ('${id}','acct1','SELL_ZOMBIE','ZombieActorRegularTier1',0,${price},
     ${currency ? `'${currency}',` : ""}1,${NOW},'u9',0,0,0);`;

describe("migration 0045 — black market gold pricing", () => {
  it("lets a post be priced in gold, and calls every existing post brains", () => {
    const db = seededPreMigrationDb();
    expect(refuses(db, saleOrder("pre", 10, "GOLD"))).toBe(true); // no such column yet

    db.exec(migration);

    // Backfill: nothing was priced in anything but brains before this migration.
    expect(scalar(db, "SELECT currency FROM black_market_orders WHERE id='o1'")).toBe("BRAINS");
    expect(scalar(db, "SELECT currency FROM black_market_orders WHERE id='o2'")).toBe("BRAINS");
    expect(refuses(db, saleOrder("gold", 250_000, "GOLD"))).toBe(false);
    expect(scalar(db, "SELECT currency FROM black_market_orders WHERE id='gold'")).toBe("GOLD");
    // Omitting it still means brains, which is what an older client's post is.
    expect(refuses(db, saleOrder("legacy", 5))).toBe(false);
    expect(scalar(db, "SELECT currency FROM black_market_orders WHERE id='legacy'")).toBe("BRAINS");
    // And a third currency is not a thing.
    expect(refuses(db, saleOrder("bad", 5, "TOKENS"))).toBe(true);
  });

  it("raises the price ceiling to 10,000,000 without letting 0 or 10,000,001 through", () => {
    const db = seededPreMigrationDb();
    expect(refuses(db, saleOrder("pre", 2_000_000))).toBe(true);

    db.exec(migration);

    expect(refuses(db, saleOrder("mid", 2_000_000, "GOLD"))).toBe(false);
    expect(refuses(db, saleOrder("max", 10_000_000, "GOLD"))).toBe(false);
    expect(refuses(db, saleOrder("over", 10_000_001, "GOLD"))).toBe(true);
    expect(refuses(db, saleOrder("zero", 0, "GOLD"))).toBe(true);
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
    expect(scalar(db, "SELECT escrow_color FROM black_market_orders WHERE id='o2'")).toBe("[1,2,3]");
    expect(scalar(db, "SELECT delivered_mutation FROM black_market_orders WHERE id='o2'")).toBe(8192);
    expect(count(db, "SELECT COUNT(*) c FROM sqlite_master WHERE name LIKE '%\\_0045' ESCAPE '\\'")).toBe(0);
  });

  it("does NOT take the idempotency receipts with it", () => {
    // The hazard this migration is shaped around. If the old orders table were dropped
    // while receipts still referenced it, every receipt would cascade away — and a
    // replayed CREATE/CANCEL/FULFILL operation would then execute a second time.
    const db = seededPreMigrationDb();
    expect(count(db, "SELECT COUNT(*) c FROM black_market_receipts")).toBe(2);

    db.exec(migration);

    expect(count(db, "SELECT COUNT(*) c FROM black_market_receipts")).toBe(2);
    expect(scalar(db, "SELECT order_id FROM black_market_receipts WHERE operation_id='op1'"))
      .toBe("o1");
  });

  it("carries the foreign keys and the rest of the CHECKs across", () => {
    const db = seededPreMigrationDb();
    db.exec(migration);

    // A wanted post still has to escrow exactly its price — in whichever currency.
    expect(refuses(db, `INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,
      mutated_required,price_brains,currency,created_day,created_at,escrow_brains)
      VALUES ('short','acct1','BUY_ZOMBIE','ZombieActorRegularTier1',0,900,'GOLD',1,${NOW},100);`))
      .toBe(true);
    expect(refuses(db, `INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,
      mutated_required,price_brains,currency,created_day,created_at,escrow_brains)
      VALUES ('paid','acct1','BUY_ZOMBIE','ZombieActorRegularTier1',0,900,'GOLD',1,${NOW},900);`))
      .toBe(false);
    // Mutation requirements stayed uncapped (migration 0044) and sale-only.
    expect(refuses(db, `INSERT INTO black_market_orders (id,creator_account_id,kind,zombie_key,
      mutated_required,mutation_required,price_brains,currency,created_day,created_at,escrow_brains)
      VALUES ('wide','acct1','BUY_ZOMBIE','ZombieActorRegularTier1',1,${2 ** 20},9,'GOLD',1,${NOW},9);`))
      .toBe(false);

    // receipts -> orders, still enforced and still cascading after the rename.
    expect(refuses(db, `INSERT INTO black_market_receipts VALUES ('op9','acct1','CREATE','fp9','nope',${NOW});`))
      .toBe(true);
    db.exec("DELETE FROM black_market_orders WHERE id='o1';");
    expect(count(db, "SELECT COUNT(*) c FROM black_market_receipts WHERE order_id='o1'")).toBe(0);

    // orders -> accounts.
    db.exec("DELETE FROM accounts WHERE id='acct1';");
    expect(count(db, "SELECT COUNT(*) c FROM black_market_orders WHERE creator_account_id='acct1'")).toBe(0);
  });
});
