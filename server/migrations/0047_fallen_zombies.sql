-- The graveyard: zombies lost in an invasion and not revived, so a Memorial Statue
-- can carve one in stone.
--
-- Until now a casualty was simply deleted from roster_v3 and the server kept no
-- record of it. Memorials need one, and it has to be SERVER-side rather than in the
-- client's presentation blob for two reasons that have nothing to do with storage:
--
--   * GET /friends/:id/save builds a visitor's copy of the farm from the
--     authoritative object list, so a client-held occupant would render every
--     memorial on every friend's farm as a bare plinth.
--   * a client-authored occupant lets a tampered client display an impossible
--     zombie — one it never owned, at stats it never had — to other players.
--
-- The row is deliberately the same minimal shape as roster_v3: key + mutation +
-- invasions + colour, with everything else on the card derived from the catalog.
-- The two additions are `died_at` (the date on the plaque) and `name`, which cannot
-- be derived: individual names live in the presentation blob keyed by unit id, and
-- that entry is gone by the time anything asks about a dead zombie. NULL name means
-- "use the deterministic default", which is exactly what a living unnamed unit does.
CREATE TABLE IF NOT EXISTS fallen_v3 (
  account_id         TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  unit_id            TEXT NOT NULL,
  zombie_key         TEXT NOT NULL,
  name               TEXT,
  mutation           INTEGER NOT NULL DEFAULT 0,
  invasions          INTEGER NOT NULL DEFAULT 0,
  -- Inherited body tint as JSON "[r,g,b]", same encoding as roster_v3.color.
  color              TEXT,
  died_at            INTEGER NOT NULL,
  -- The placed Memorial Statue this zombie stands on, or NULL while it waits in the
  -- graveyard. Kept here rather than on the object document so a statue can never
  -- disagree with the zombie on it, and so the unique index below can enforce
  -- one-occupant-per-statue in the database rather than in application code.
  memorial_object_id TEXT,
  PRIMARY KEY (account_id, unit_id)
);

-- The graveyard list is read newest-first and capped, so the sort is the index.
CREATE INDEX IF NOT EXISTS idx_fallen_v3_recent
  ON fallen_v3(account_id, died_at DESC);

-- One zombie per plinth. A partial index leaves the unenshrined majority (NULL)
-- unconstrained while making a double-enshrine a database error, not a race.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fallen_v3_statue
  ON fallen_v3(account_id, memorial_object_id)
  WHERE memorial_object_id IS NOT NULL;
