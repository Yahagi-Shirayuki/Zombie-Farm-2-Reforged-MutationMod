-- Silent invasion brain pity: how many brain-eligible invasions (wins against a boss)
-- have settled for this account since its last brain drop. /raid/start floors a zero roll
-- to one brain once the streak reaches the threshold in src/raid/brainDrops.ts.
--
-- Server-only state: it is never returned to the client, so nothing in the UI can reveal
-- that a drop was floored rather than rolled.
--
-- Existing accounts start at 0, i.e. they begin a fresh streak rather than being credited
-- for dry invasions the server never counted.
ALTER TABLE raid_state_v3 ADD COLUMN brain_dry_streak INTEGER NOT NULL DEFAULT 0;
