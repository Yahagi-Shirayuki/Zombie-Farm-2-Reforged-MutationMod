-- Brains earned by a SALE used to be credited to the seller inside the buyer's
-- fulfil batch. The seller was usually offline for that, so the payout appeared in
-- their balance out of nowhere and the Collect button on the fulfillment card had
-- nothing left to do — tester report: "the brains just appear in your balance and
-- pressing claim for your sales does nothing".
--
-- The market now HOLDS a sale's brains until the seller collects. `payout_at` marks
-- the moment they were credited: NULL on a FULFILLED sale means the market is still
-- holding them, and `collect` is what pays out (in the same batch that acknowledges
-- the order, so it cannot pay twice).
--
-- A filled REQUEST still pays its fulfiller inside the fulfil batch: they are the
-- player standing at the market with the panel open, and they hold no card to
-- collect from. Those rows are stamped at settlement.
--
-- Every existing FULFILLED row is backfilled as already paid — those brains were
-- credited at settlement under the old rule and must not be handed out a second time.
ALTER TABLE black_market_orders ADD COLUMN payout_at INTEGER;

UPDATE black_market_orders SET payout_at = closed_at WHERE status = 'FULFILLED';

-- Unpaid sales are looked up by their creator (the earner) when the panel totals
-- what the market is holding for them.
CREATE INDEX IF NOT EXISTS idx_black_market_unpaid
  ON black_market_orders(creator_account_id, status, payout_at);
