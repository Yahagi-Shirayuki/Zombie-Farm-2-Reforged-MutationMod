-- Daily / weekly quests ("periodic quests").
--
-- These live in their OWN document rather than as a new key inside
-- quest_documents_v3, even though the two systems are siblings and the blob would
-- have needed no migration at all. The reason is write safety: the catalog quest
-- document is written back wholesale by three separate paths (the command batch in
-- v3/db.ts, /raid/finish, and the epic-boss settlement), each of which serialises
-- `{completed, progress}` from its own local parse. Adding a third key to that blob
-- would mean any one of those writers silently dropping a player's daily progress the
-- moment it committed — and a future fourth writer would reintroduce the bug with no
-- warning. A separate row makes the periodic state something a writer has to opt INTO
-- corrupting rather than something it destroys by omission.
--
-- The document is small and bounded by construction: at most one daily set (3 quests)
-- and one weekly set (2), each holding its generated objectives, a count per
-- objective, and the ids already claimed. Rolling over a period REPLACES the set, so
-- it never accumulates.
CREATE TABLE IF NOT EXISTS periodic_quest_documents_v3 (
  account_id    TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL DEFAULT 0,
  current_json  TEXT NOT NULL DEFAULT '{"daily":null,"weekly":null}',
  updated_at    INTEGER NOT NULL
);

-- BACKFILL every account that already exists, rather than leaving the table empty for
-- ensureV3 to fill in lazily.
--
-- Lazy would be fine if every reader went through ensureV3, and every reader but one
-- does. `/raid/finish` reads this row DIRECTLY (it does not load the v3 projection) and
-- answers `state_conflict` when it is missing. So an account whose last bootstrap
-- predates this deploy, settling an invasion after it, would lose a won fight — and
-- the deploy moment is exactly when the most raids are in flight. One row per account,
-- all defaults; the timestamp is cosmetic (nothing reads updated_at).
INSERT OR IGNORE INTO periodic_quest_documents_v3 (account_id, updated_at)
SELECT id, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM accounts;
