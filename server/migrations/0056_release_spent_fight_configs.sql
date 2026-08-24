-- Release the pinned fight config of every ALREADY-finished raid and Epic Boss session.
--
-- `config_json` is the pinned battle the finish path replays against. It is read exactly
-- once, while `finished_at IS NULL`; after settlement a session answers from `result_json`
-- and never looks at its config again. Nothing was clearing it, so at ~14 KB a session it
-- had become 413 MB of a 733 MB database — 56% of prod, and the fastest-growing thing in
-- it (roughly 20 MB a day at beta volume, scaling straight with the playerbase).
--
-- The server now drops it in the same UPDATE that sets `finished_at` (see CONFIG_SPENT in
-- src/v3/engine.ts), which bounds the tables going forward. This is the one-time catch-up
-- for rows written before that shipped.
--
-- Idempotent: re-running matches nothing, because the guard excludes rows already emptied.
-- The `finished_at IS NOT NULL` guard is what keeps it safe to run against a live database
-- — a fight in progress across the deploy keeps its config and settles normally.
--
-- NOTE ON SIZE: SQLite returns the freed pages to its freelist rather than shrinking the
-- file, and D1 exposes no VACUUM. So `database size` will not visibly drop; the reclaimed
-- space is reused by subsequent writes instead. The point is that the table stops growing,
-- not that the number on the dashboard falls.
--
-- NOTE ON pvp_sessions_v3: deliberately untouched. A PvP config outlives its fight on
-- purpose, so the defender can re-simulate the attack on their farm (migration 0055).

UPDATE raid_sessions_v3
   SET config_json = '{}'
 WHERE finished_at IS NOT NULL
   AND config_json <> '{}';

UPDATE epic_boss_sessions_v3
   SET config_json = '{}'
 WHERE finished_at IS NOT NULL
   AND config_json <> '{}';
