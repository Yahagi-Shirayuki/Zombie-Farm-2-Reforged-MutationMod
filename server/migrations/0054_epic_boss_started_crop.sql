-- An Epic Boss event can now start itself: harvesting a boss's favourite crop
-- (src/epicBoss/favoriteCrops.ts) has a rare chance to lure it onto the farm for free
-- when no event is running. This column records WHICH crop did it.
--
-- It is not decoration. The client announces a started event with a popup, and this is
-- how it tells the two kinds apart: a run with a crop is one the player never asked for
-- and has to be told about, while a run they just spent brains on announces itself at
-- the moment of purchase. Empty string means bought, which is also what every existing
-- row correctly becomes.
ALTER TABLE epic_boss_runs_v3 ADD COLUMN started_crop TEXT NOT NULL DEFAULT '';
