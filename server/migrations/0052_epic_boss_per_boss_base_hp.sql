-- Epic Boss baseHp now ramps with the unlock ladder instead of being flat.
--
-- Every event used to share ZF2's BaseHP of 2000, so all eight cost the same total damage
-- to walk. Measured, that made the ENTRY event the grindiest: a moderate army needs 91
-- attempts on Dr. Groundhog against 63-64 on every boss above him. Nothing about the boss
-- causes that — the ladder was flat while the player was not, and a level-24 roster deals
-- about a third less damage than a level-30 one.
--
-- baseHp now runs +/-25% end to end, symmetric about General Larvaelus and Mystical Mamba,
-- which keep the source's 2000 and are the fixed point the rest is stated against. See
-- tools/prep_all_epic_bosses.py EPIC_BOSS_BASE_HP — that table is the source of truth and
-- the values below are its output; they must be regenerated together.
--
-- WHAT NEEDS REPAIRING. Rung HP is baseHp x multiplier, so six of the eight events changed
-- every rung's HP. A run in flight across the deploy carries max_hp/current_hp written
-- against the OLD baseHp, and unlike the level column nothing clamps those at read time --
-- clampRun only recomputes HP when it also has to pull a level down (src/v3/epicBoss.ts).
-- Left alone, a Dr. Groundhog run would sit on a rung claiming 390,000 max HP that the
-- client and the finish handler both now believe is 292,500.
--
-- current_hp is CAPPED, never raised. For the six events that got easier that keeps every
-- point of damage already dealt. For the two that got harder (Skunkarella, Loco Locust) it
-- leaves the player's remaining HP untouched rather than scaling it up — the alternative,
-- preserving the fraction, would hand back damage a player had already paid attempts for,
-- mid-event, which is not a thing a balance change should do to someone already playing.
-- The buff applies from their next rung on. This follows 0051's rule exactly.
--
-- Floored at 1 so a row can never be written to a defeated-but-unfinished state.
-- Completed runs are left alone: their ladder is over and their prizes are paid.
UPDATE epic_boss_runs_v3
   SET max_hp = CAST(ROUND(
         (CASE boss_id
            WHEN 'dr-groundhog'      THEN 1500
            WHEN 'bully-frog'        THEN 1650
            WHEN 'rocky-rhino'       THEN 1850
            WHEN 'general-larvaelus' THEN 2000
            WHEN 'mystical-mamba'    THEN 2000
            WHEN 'foul-owl'          THEN 2150
            WHEN 'skunkarella'       THEN 2350
            WHEN 'loco-locust'       THEN 2500
          END) *
         (CASE level
            WHEN 1 THEN 2.4  WHEN 2 THEN 5.8   WHEN 3 THEN 14.2 WHEN 4 THEN 17.5
            WHEN 5 THEN 37.0 WHEN 6 THEN 52.4  WHEN 7 THEN 71.7 WHEN 8 THEN 111.0
            WHEN 9 THEN 138.0 WHEN 10 THEN 195.0
          END)) AS INTEGER)
 WHERE completed_at = 0
   AND level BETWEEN 1 AND 10
   AND boss_id IN ('dr-groundhog', 'bully-frog', 'rocky-rhino', 'general-larvaelus',
                   'mystical-mamba', 'foul-owl', 'skunkarella', 'loco-locust');

-- Second pass rather than one statement: SQLite evaluates a row's SET expressions against
-- the values it had BEFORE the update, so a combined statement would cap current_hp
-- against the stale max_hp and leave exactly the rows this migration exists to fix.
UPDATE epic_boss_runs_v3
   SET current_hp = MAX(1, MIN(current_hp, max_hp))
 WHERE completed_at = 0
   AND level BETWEEN 1 AND 10;
