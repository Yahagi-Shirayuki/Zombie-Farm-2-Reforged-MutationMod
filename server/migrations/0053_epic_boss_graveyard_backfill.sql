-- Bury the Epic Boss dead that were never buried.
--
-- The invasion settlement (v3/raid.ts) wrote every casualty to `fallen_v3`; the Epic
-- Boss settlement (v3/epicBoss.ts) deleted the roster row and wrote nothing. Both kill
-- permanently, so a zombie lost to a boss simply stopped existing — and the Memorial
-- Statue, which reads the authoritative graveyard and nothing else, told a player who
-- had just lost one that they had never lost any. The settlement now writes the row;
-- this recovers the ones already lost.
--
-- The source is the finished session itself. `config_json.playerUnits` is the party the
-- server built for its own replay, and it carries exactly the identity a plaque needs —
-- unit id, catalog key, mutation mask and inherited tint — while `result_json.losses`
-- names which of them died. Nothing here is client-authored: both blobs were written by
-- the settlement that killed the zombie.
--
-- Two fields cannot be recovered and take their "unknown" value rather than a guess:
--   * `name` -> NULL, i.e. the deterministic default name the unit answered to while
--     alive. Names live only in the client's presentation blob keyed by the roster id,
--     and that entry went with the roster row. NULL is the same fallback an unnamed
--     living unit uses, so the plaque reads correctly either way.
--   * `invasions` -> 0. Veterancy is folded into the scaled stats stored in the config
--     and cannot be divided back out. It costs the card one line and nothing else.
-- `died_at` is the settlement's own timestamp, which is the moment of death.
--
-- Idempotent by primary key, so a re-run cannot double-bury anyone, and it cannot
-- resurrect: a row here is a memento and nothing reads `fallen_v3` back into the roster.
-- Deliberately NOT capped to MEMORIAL_GRAVEYARD_CAP — the bootstrap already limits what
-- it reads and the next settlement trims the excess, whereas trimming here would have to
-- pick winners across every account in one statement.
INSERT OR IGNORE INTO fallen_v3
  (account_id, unit_id, zombie_key, name, mutation, invasions, color, died_at)
SELECT
  session.account_id,
  json_extract(unit.value, '$.id'),
  json_extract(unit.value, '$.sourceKey'),
  NULL,
  COALESCE(json_extract(unit.value, '$.mutation'), 0),
  0,
  json_extract(unit.value, '$.color'),
  COALESCE(session.finished_at, session.started_at)
FROM epic_boss_sessions_v3 AS session
JOIN json_each(json_extract(session.config_json, '$.playerUnits')) AS unit
WHERE session.result_json IS NOT NULL
  AND json_extract(unit.value, '$.id') IN (
    SELECT loss.value FROM json_each(json_extract(session.result_json, '$.losses')) AS loss
  )
  -- Belt and braces: never bury a unit that is standing on the farm. A settled loss is
  -- always gone from the roster, so this excludes nothing on healthy data.
  AND NOT EXISTS (
    SELECT 1 FROM roster_v3
    WHERE roster_v3.account_id = session.account_id
      AND roster_v3.unit_id = json_extract(unit.value, '$.id')
  );
