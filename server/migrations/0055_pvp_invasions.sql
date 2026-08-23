-- Friend invasions (PvP): attacker fights a pinned SNAPSHOT of a friend's deployed
-- zombies on Old McDonnell's stage. One row is the whole story of one attack — the
-- pinned config (both armies, scores, reward tiers), the live-session bookkeeping,
-- the settled result, and the transcript kept for a future replay viewer.
--
-- Deliberately NOT raid_sessions_v3: a friend invasion locks no roster, pays no
-- gold/XP/loot, starts no cooldown, and needs a defender column plus a defender-side
-- claim — grafting all of that onto the raid table would burden every raid query.
CREATE TABLE pvp_sessions_v3 (
  id TEXT PRIMARY KEY,
  attacker_id TEXT NOT NULL REFERENCES accounts(id),
  defender_id TEXT NOT NULL REFERENCES accounts(id),
  -- PinnedRaidConfig-compatible JSON with a `pvp` block (see src/raid/pvp.ts).
  config_json TEXT NOT NULL,
  ruleset_version INTEGER NOT NULL,
  attack_score INTEGER NOT NULL,
  defense_score INTEGER NOT NULL,
  -- {attackerTier, defenderTier} pinned at start so a payout can never be re-priced.
  boosts_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  earliest_finish_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  finished_at INTEGER,
  result_json TEXT,
  -- 1 = attacker won, 0 = defense held (loss OR retreat). NULL = unfinished or
  -- expired-unfought; only non-NULL rows appear in history / defense claims.
  win INTEGER,
  final_tick INTEGER,
  -- The verified input transcript (<= 32 KB by the replay cap). Kept so a future
  -- "watch the attack on your farm" viewer can re-simulate it from config_json.
  inputs_json TEXT,
  -- Defender's one-time reward claim for a successful defense.
  defense_claimed_at INTEGER
);
CREATE UNIQUE INDEX idx_pvp_live ON pvp_sessions_v3(attacker_id) WHERE finished_at IS NULL;
CREATE INDEX idx_pvp_pair_day ON pvp_sessions_v3(attacker_id, defender_id, started_at);
CREATE INDEX idx_pvp_defender ON pvp_sessions_v3(defender_id, finished_at);
CREATE INDEX idx_pvp_attacker ON pvp_sessions_v3(attacker_id, finished_at);
