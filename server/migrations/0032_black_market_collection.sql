-- Creator-side collection acknowledgment for fulfilled Black Market orders.
-- Settlement stays automatic (brains/zombies land the instant the counterparty
-- trades); acknowledged_at only records that the creator has seen and
-- "collected" the outcome, so the client can toast fulfilled posts at sign-in
-- and show them until dismissed. Existing FULFILLED rows are deliberately NOT
-- backfilled: their creators never got any feedback, so they surface once as
-- collectible history instead of vanishing silently.
ALTER TABLE black_market_orders ADD COLUMN acknowledged_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_black_market_uncollected
  ON black_market_orders(creator_account_id, status, acknowledged_at);
