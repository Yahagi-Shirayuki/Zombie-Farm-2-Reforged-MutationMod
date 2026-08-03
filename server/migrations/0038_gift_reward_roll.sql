-- Gift contents are rolled ONCE, when the gift is sent, and stored here — never
-- re-rolled at open time. See GIFT_REWARD_TABLE in src/logic.ts for the weights
-- (10% a brain, otherwise 150/300/500/1000 gold).
--
-- The one open-time decision left is the daily floor: the FIRST gift an account opens
-- each UTC day pays a brain whatever these columns say. That is derived from
-- gifts.claimed_at (idx_gifts_inbox already covers the to_id + claimed_at lookup), so
-- it needs no column of its own and no per-account counter to drift.
--
-- Existing rows default to the old behaviour — a single brain — so gifts already
-- sitting in an inbox when this deploys pay exactly what their sender was promised.
ALTER TABLE gifts ADD COLUMN reward_kind TEXT NOT NULL DEFAULT 'brain';
ALTER TABLE gifts ADD COLUMN reward_amount INTEGER NOT NULL DEFAULT 1;
