-- Trade-history support. delivered_* record the ACTUAL traded unit on a
-- FULFILLED order: for BUY_ZOMBIE requests the escrow columns must stay NULL by
-- CHECK (escrow there is brains, not a unit), so the delivered unit's details
-- need their own columns; for sales they simply mirror the escrowed unit.
-- Historical sales backfill from escrow; historical filled requests stay NULL
-- because the delivered unit was never recorded (history shows the species only).
ALTER TABLE black_market_orders ADD COLUMN delivered_mutation INTEGER;
ALTER TABLE black_market_orders ADD COLUMN delivered_invasions INTEGER;
UPDATE black_market_orders SET delivered_mutation=escrow_mutation, delivered_invasions=escrow_invasions
  WHERE status='FULFILLED' AND kind='SELL_ZOMBIE';
-- History reads scan the fulfiller side too; the creator side is covered by
-- idx_black_market_owner.
CREATE INDEX IF NOT EXISTS idx_black_market_fulfiller
  ON black_market_orders(fulfilled_by_account_id, status, closed_at DESC);
