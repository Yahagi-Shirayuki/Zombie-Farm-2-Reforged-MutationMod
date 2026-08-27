-- Epic Boss ladders cut from 40 rungs to 20.
--
-- ZF2 only ever authored 20 HP multipliers (EpicBossHP.json). The seven bosses that
-- advertised 40 levels were padding 21-40 with a copy of level 20's multiplier, so the
-- back half of those ladders was 20 more fights at an unchanging 107x. Truncating to 20
-- removes the padding and nothing else: levels 1-20 keep their exact HP.
--
-- This repairs the runs that are mid-flight across the deploy. A run parked above the
-- new top would:
--   * display as "Level 25/20",
--   * never satisfy its boss's top-prize quest, which now fires on level 20, and
--   * be marked complete on its next win, with the omega zombie unclaimable.
-- Clamped, that same next win IS the level-20 win: it grants the prize and pays the
-- top-tier bonus brain. Nothing gets harder — level 20 and level 40 are the same 107x
-- fight — so `max_hp` and `current_hp` are already correct at the clamped level and are
-- deliberately left untouched (rewriting current_hp would heal or hurt a boss the player
-- is part-way through). Runs already completed keep their level: their ladder is over and
-- their prizes are paid.
--
-- Live sessions are clamped alongside their run so the finish handler's
-- `run.level != session.level` staleness check still agrees and an in-progress fight is
-- not thrown away. src/v3/epicBoss.ts carries the same clamp at read time for rows
-- written between the deploy and this migration.
UPDATE epic_boss_runs_v3
   SET level = 20
 WHERE completed_at = 0
   AND level > 20;

UPDATE epic_boss_sessions_v3
   SET level = 20
 WHERE finished_at IS NULL
   AND level > 20;
