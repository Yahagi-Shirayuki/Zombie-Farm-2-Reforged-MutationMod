-- PvP rework, phase 1 (interface + progression redesign — docs/FRIEND_INVASIONS.md):
--
--  * pvp_defense_v3 — the defender-AUTHORED defense line-up. One row per account:
--    an ordered list of owned unit ids that /raid/pvp/start snapshots instead of the
--    strongest-16 auto pick. Client-authored data; ownership is re-validated at
--    snapshot time, so a sold/perished zombie simply drops out of the line.
--  * pvp_stats_v3 — lifetime win/loss counters per role, SERVER-authored: they are
--    incremented inside the guarded finish settlement only, unlike the client-owned
--    Statistics tally. Trailing-week numbers are computed from session rows instead.
--  * attacker_rewarded / defense_rewarded on pvp_sessions_v3 — the daily income
--    caps (PVP_DAILY_REWARDED_WINS / _DEFENSES in src/raid/pvp.ts). Fights beyond
--    the caps still happen and are recorded; these flags mark which ones PAY, and
--    they are stamped at settlement so a claim can never re-litigate them.
--
-- The replay-payload sweep (keep config_json + inputs_json only for the newest
-- PVP_REPLAYS_KEPT finished fights per role) needs no schema: it clears columns.
CREATE TABLE pvp_defense_v3 (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  -- {"unitIds": [...]} — authored order; slot 1 emerges first.
  loadout_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE pvp_stats_v3 (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  attack_wins INTEGER NOT NULL DEFAULT 0,
  attack_losses INTEGER NOT NULL DEFAULT 0,
  defense_wins INTEGER NOT NULL DEFAULT 0,
  defense_losses INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE pvp_sessions_v3 ADD COLUMN attacker_rewarded INTEGER;
ALTER TABLE pvp_sessions_v3 ADD COLUMN defense_rewarded INTEGER;

-- Rows settled before the daily caps existed predate the accounting: mark them all
-- rewarded so no already-earned (staging) claim silently stops being claimable.
UPDATE pvp_sessions_v3 SET attacker_rewarded = 1 WHERE win = 1;
UPDATE pvp_sessions_v3 SET defense_rewarded = 1 WHERE win = 0;
