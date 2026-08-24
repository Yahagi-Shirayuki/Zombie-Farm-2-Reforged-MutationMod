-- Let a Black Market post be priced in GOLD, and lift the price ceiling to 10,000,000.
--
-- Two changes, one rebuild. `currency` could have been added in place, but
-- `price_brains BETWEEN 1 AND 1000000` cannot be widened by ALTER TABLE — SQLite has no
-- way to replace a CHECK — so the table is rebuilt and both land together.
--
-- ON THE COLUMN NAMES: `price_brains` and `escrow_brains` keep their names and are now
-- simply THE AMOUNT, denominated in `currency`. A gold post stores its gold in
-- `price_brains`. Renaming them would be more honest, but migration 0044's SQL (and its
-- rehearsal test, which builds its pre-migration database out of schema.sql) names both
-- columns, so a rename here would retroactively break a shipped migration's test. The
-- names are historical; `currency` is what says what the number means.
--
-- Existing rows are all brains, which is exactly what the DEFAULT backfills, so no
-- separate UPDATE is needed and nothing about a pre-existing post changes.
--
-- WHY THE ORDERING BELOW (verbatim from migration 0044, and load-bearing):
-- black_market_receipts.order_id references this table ON DELETE CASCADE, and SQLite's
-- DROP TABLE runs an implicit DELETE FROM that fires foreign-key actions — a naive
-- rebuild would silently take every idempotency receipt with it, letting a replayed
-- CREATE/CANCEL/FULFILL operation execute twice. So BOTH tables are rebuilt, and the old
-- receipts table is dropped BEFORE the old orders table, leaving that cascade with
-- nothing to reach. Renaming `black_market_orders_0045` back also rewrites the reference
-- inside `black_market_receipts_0045`, which is how the receipts land pointing at the
-- surviving table.

CREATE TABLE black_market_orders_0045 (
  id TEXT PRIMARY KEY,
  creator_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('BUY_ZOMBIE', 'SELL_ZOMBIE')),
  zombie_key TEXT NOT NULL,
  mutated_required INTEGER NOT NULL CHECK (mutated_required IN (0, 1)),
  mutation_required INTEGER CHECK (mutation_required IS NULL OR (
    mutation_required > 0
    AND kind='BUY_ZOMBIE'
  )),
  price_brains INTEGER NOT NULL CHECK (price_brains BETWEEN 1 AND 10000000),
  currency TEXT NOT NULL DEFAULT 'BRAINS' CHECK (currency IN ('BRAINS', 'GOLD')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FULFILLED', 'CANCELLED')),
  created_day INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  fulfilled_by_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  closed_operation_id TEXT,
  source_unit_id TEXT,
  escrow_mutation INTEGER,
  escrow_invasions INTEGER,
  escrow_brains INTEGER NOT NULL DEFAULT 0,
  escrow_color TEXT,
  acknowledged_at INTEGER,
  delivered_mutation INTEGER,
  delivered_invasions INTEGER,
  delivered_color TEXT,
  claimed_at INTEGER,
  delivered_unit_id TEXT,
  payout_at INTEGER,
  CHECK ((kind='SELL_ZOMBIE' AND source_unit_id IS NOT NULL AND escrow_mutation IS NOT NULL AND
    escrow_invasions IS NOT NULL AND escrow_brains=0) OR (kind='BUY_ZOMBIE' AND
    source_unit_id IS NULL AND escrow_mutation IS NULL AND escrow_invasions IS NULL AND
    escrow_brains=price_brains))
);

INSERT INTO black_market_orders_0045 (
  id, creator_account_id, kind, zombie_key, mutated_required, mutation_required,
  price_brains, currency, status, created_day, created_at, closed_at, fulfilled_by_account_id,
  closed_operation_id, source_unit_id, escrow_mutation, escrow_invasions, escrow_brains,
  escrow_color, acknowledged_at, delivered_mutation, delivered_invasions, delivered_color,
  claimed_at, delivered_unit_id, payout_at
)
SELECT
  id, creator_account_id, kind, zombie_key, mutated_required, mutation_required,
  price_brains, 'BRAINS', status, created_day, created_at, closed_at, fulfilled_by_account_id,
  closed_operation_id, source_unit_id, escrow_mutation, escrow_invasions, escrow_brains,
  escrow_color, acknowledged_at, delivered_mutation, delivered_invasions, delivered_color,
  claimed_at, delivered_unit_id, payout_at
FROM black_market_orders;

CREATE TABLE black_market_receipts_0045 (
  operation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('CREATE','CANCEL','FULFILL')),
  request_fingerprint TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES black_market_orders_0045(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

INSERT INTO black_market_receipts_0045 (
  operation_id, account_id, action, request_fingerprint, order_id, created_at
)
SELECT operation_id, account_id, action, request_fingerprint, order_id, created_at
FROM black_market_receipts;

-- Receipts first: this is what keeps the next DROP's cascade from reaching them.
DROP TABLE black_market_receipts;
DROP TABLE black_market_orders;

ALTER TABLE black_market_orders_0045 RENAME TO black_market_orders;
ALTER TABLE black_market_receipts_0045 RENAME TO black_market_receipts;

-- Indexes lived on the dropped tables and are recreated verbatim.
CREATE INDEX IF NOT EXISTS idx_black_market_browse ON black_market_orders(status,kind,created_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_black_market_filter ON black_market_orders(status,kind,zombie_key,mutated_required,created_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_black_market_owner ON black_market_orders(creator_account_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_black_market_daily ON black_market_orders(creator_account_id,created_day);
CREATE INDEX IF NOT EXISTS idx_black_market_uncollected ON black_market_orders(creator_account_id,status,acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_black_market_fulfiller ON black_market_orders(fulfilled_by_account_id,status,closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_black_market_unclaimed_sale ON black_market_orders(fulfilled_by_account_id,status,claimed_at);
CREATE INDEX IF NOT EXISTS idx_black_market_unclaimed_request ON black_market_orders(creator_account_id,status,claimed_at);
CREATE INDEX IF NOT EXISTS idx_black_market_unpaid ON black_market_orders(creator_account_id,status,payout_at);
CREATE INDEX IF NOT EXISTS idx_black_market_receipts_account ON black_market_receipts(account_id,created_at DESC);
