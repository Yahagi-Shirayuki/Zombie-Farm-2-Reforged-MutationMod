-- A traded zombie used to be minted straight into the recipient's roster by the
-- fulfil batch, which chose farm-or-crypt from the ARMY cap alone. A buyer whose
-- farm was full got the unit flagged `stored` even with no Mausoleum placed — it
-- vanished into a crypt that does not exist, reachable only through the Zombies
-- list safety net and undeployable until they happened to free a slot.
--
-- Delivery is now a two-step: the trade still settles instantly (brains move, the
-- escrowed unit leaves the seller), but the zombie waits ON THE ORDER until the
-- recipient claims it, and the claim is refused while both farm and Mausoleum are
-- full. `claimed_at` marks the roster row as minted; `delivered_unit_id` records
-- which unit it became, so the claim is idempotent and forensics can follow it.
--
-- Existing FULFILLED rows are backfilled as already-claimed: their zombies were
-- minted at settlement under the old rule and must not reappear as claimable.
ALTER TABLE black_market_orders ADD COLUMN claimed_at INTEGER;
ALTER TABLE black_market_orders ADD COLUMN delivered_unit_id TEXT;

UPDATE black_market_orders SET claimed_at = closed_at WHERE status = 'FULFILLED';

-- The recipient of a zombie is the fulfiller on a sale and the creator on a
-- request, so unclaimed deliveries are looked up from both sides.
CREATE INDEX IF NOT EXISTS idx_black_market_unclaimed_sale
  ON black_market_orders(fulfilled_by_account_id, status, claimed_at);
CREATE INDEX IF NOT EXISTS idx_black_market_unclaimed_request
  ON black_market_orders(creator_account_id, status, claimed_at);
