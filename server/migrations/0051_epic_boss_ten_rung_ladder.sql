-- Epic Boss ladders re-cut from 20 rungs to 10.
--
-- Each rung is now two of ZF2's authored HP multipliers added together (see
-- tools/prep_all_epic_bosses.py multipliers), so the ladder carries exactly the HP it did
-- before — 645x baseHp — in half as many fights. The point is the floor: a rung costs at
-- least one attempt however far you overkill it, and the bottom half of the 20-rung curve
-- was one-attempt formalities for any real army. Merging pairs deletes those without
-- touching the rungs where HP genuinely gates progress.
--
-- This repairs runs mid-flight across the deploy, the same job 0046 did for the 40 -> 20
-- cut. A run parked above the new top would display as "Level 15/10", never satisfy its
-- boss's top-prize quest (now pinned to rung 10), and be marked complete on its next win
-- with the omega zombie unclaimable.
--
-- ONE IMPORTANT DIFFERENCE FROM 0046. That cut was pure truncation — levels 1-20 kept
-- their exact HP, so max_hp/current_hp were already correct at the clamped level and were
-- deliberately left alone. This cut RESHAPES the curve: every rung's HP changed, and the
-- new top rung is 390,000 where the old one was 214,000. So the HP columns must be
-- rewritten here, or a clamped run would sit at the top rung carrying the old rung's
-- numbers and read as almost dead.
--
-- 390,000 is baseHp 2000 x the top merged multiplier (88 + 107 = 195), and every shipped
-- boss uses the same baseHp and the same authored curve, so one literal covers all eight.
-- current_hp is capped rather than reset: a player part-way through the old top rung keeps
-- the damage they have already dealt, and anyone at or above the new maximum simply starts
-- the rung whole. Floored at 1 so a row can never be written to a defeated-but-unfinished
-- state. This matches clampRun in src/v3/epicBoss.ts exactly, which carries the same
-- correction at read time for rows written between the deploy and this migration.
--
-- Runs already completed keep their level: their ladder is over and their prizes are paid.
UPDATE epic_boss_runs_v3
   SET level = 10,
       max_hp = 390000,
       current_hp = MAX(1, MIN(current_hp, 390000))
 WHERE completed_at = 0
   AND level > 10;

-- Live sessions are clamped alongside their run so the finish handler's
-- `run.level != session.level` staleness check still agrees and an in-progress fight is
-- not thrown away.
UPDATE epic_boss_sessions_v3
   SET level = 10
 WHERE finished_at IS NULL
   AND level > 10;
