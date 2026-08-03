-- Quest 45 "Big Top Bash" pays a Circus Popcorn. It never did: quests.json carried the
-- display name but left `rewardItemKey` empty, and every grant path guards on the KEY —
-- and the v3 engine granted no Item rewards at all. Both are fixed in code, but
-- `applyQuestEvents` only pays a quest at the moment it COMPLETES and skips ids already
-- in `completed`, so the fix cannot reach anyone who finished it before the deploy.
-- This grants the one owed item to exactly those accounts.
--
-- Delivery matches how the fixed engine (and raid loot) does it: a Received entry keyed
-- by item NAME, which `storage.claim` turns into the placeable `circusPopcorn`.
--
-- Guarded to be re-runnable and to under-grant rather than over-grant:
--   * only accounts with "45" in the quest document's `completed` array;
--   * only where no "Circus Popcorn" key exists yet (a 0 counts as present — it means
--     the player already earned and claimed one from raid loot, so they are not owed a
--     quest copy retroactively and a second grant would be a gift, not a repair).
-- Re-running is therefore a no-op once applied.
--
-- CONCURRENCY: gameplay_documents_v3 is otherwise written only by the command pipeline
-- under its batch guard. This statement is not part of that pipeline, so a player whose
-- command batch reads the document before this UPDATE and writes after it would lose the
-- grant. Apply during low traffic and re-run the verification query in the RUNBOOK
-- afterwards; re-applying picks up anyone who was clipped.
UPDATE gameplay_documents_v3
SET current_json = json_set(
      current_json,
      '$.storage.received."Circus Popcorn"',
      1
    )
WHERE json_extract(current_json, '$.storage.received."Circus Popcorn"') IS NULL
  AND EXISTS (
    SELECT 1
    FROM quest_documents_v3 q, json_each(json_extract(q.current_json, '$.completed')) e
    WHERE q.account_id = gameplay_documents_v3.account_id
      AND e.value = '45'
  );
