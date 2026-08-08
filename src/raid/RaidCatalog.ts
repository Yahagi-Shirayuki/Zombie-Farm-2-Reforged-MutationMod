// Pure helpers over the raid catalog: unlock/lock state, stage/difficulty
// selection, army-selection rules, and reward derivation. Player-facing raids run
// the live combat sim (BattleSim); instant resolution (CombatEngine) is retained
// only as a test/dev utility. No side effects — RaidManager applies these.
import type { RaidDef, RaidStage } from "./types";
import { raidBoostBundle } from "./lootBundles";

/** Minimum army to launch an invasion (Help.json: "at least 8, best with 16"). */
export const MIN_ARMY = 8;
/** Hard ceiling on an invasion party, and the selection cap. The effective cap is
 *  `min(ARMY_CAP, zombieMax)`, and zombieMax tops out at 16 + the Zombie Monolith's
 *  +4 — so this must be 20 for the Monolith's four extra slots to be selectable. */
export const ARMY_CAP = 20;

/** The raid id of Old McDonnell's Farm — the tutorial invasion. */
export const MCDONNELL_ID = 1;

/** How many zombies an invasion needs to launch. Normally MIN_ARMY (8), but the
 *  first clears of Old McDonnell's Farm are eased so new players can start raiding
 *  without a full army — the very first clear needs just 1 (the tutorial grows a
 *  single zombie and sends it in), then 4, then the full army. `priorWins` is that
 *  raid's lifetime win count. */
export function minArmyFor(raid: RaidDef, priorWins: number): number {
  if (raid.id === MCDONNELL_ID) {
    if (priorWins <= 0) return 1;
    if (priorWins === 1) return 4;
  }
  return MIN_ARMY;
}

/** Ease Old McDonnell's projectile cadence over his first two clears, in step
 *  with the tutorial army ramp above. A larger interval means fewer throws:
 *  half speed before the first win, two-thirds speed after it, then the stage's
 *  authored full-strength cadence from the third fight onward. */
export function bossThrowIntervalSecs(
  raid: RaidDef,
  stage: RaidStage,
  priorWins: number
): number {
  const rawSecs = stage.throwSpeed ?? raid.throwSpeed;
  const authoredSecs = rawSecs > 0 ? rawSecs : 2;
  if (raid.id !== MCDONNELL_ID) return authoredSecs;
  if (priorWins <= 0) return authoredSecs * 2;
  if (priorWins === 1) return authoredSecs * 1.5;
  return authoredSecs;
}

/** Real between-invasions cooldown (Help.json: "wait two hours between invasions,
 *  unless you purchase an Invasion Voucher"). Playtest-scaled in main.ts. */
export const RAID_COOLDOWN_MS = 2 * 60 * 60 * 1000;
/** The consumable that bypasses the cooldown (Market Boosts → boosts.json). */
export const VOUCHER_KEY = "invasion_voucher";

/** Format a remaining cooldown as "1h 03m" or "2:05" (m:ss under an hour). */
export function fmtCooldown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** UI power estimate for default army sorting only — combat uses raw stats. */
export function power(z: { str: number; dex: number; con: number; focus: number }): number {
  return z.str * 2 + z.dex * 3 + z.con * 1.5 + z.focus * 0.05;
}

/** A raid is enterable when it has playable stages and the level gate is met. */
export function isUnlocked(raid: RaidDef, level: number): boolean {
  return raid.playable && level >= raid.unlockLevel;
}

/** Why the player can't enter a raid ("" when they can). */
export function lockReason(raid: RaidDef, level: number): string {
  if (!raid.playable) return "Coming soon";
  if (level < raid.unlockLevel) return `Requires level ${raid.unlockLevel}`;
  return "";
}

/** The wave fought, scaled by player level. The source `stages` array is a
 *  difficulty ladder (verified against the real game on McDonnell): earlier
 *  stages have fewer enemies and no boss; the first boss stage lines up with the
 *  raid's `recommendedLevel`, and each level past that steps one stage harder.
 *
 *  e.g. McDonnell (boss stage 3, recommended 5): lvl3→[1] (3 grunts, no boss),
 *  lvl4→[2] (+lumberjack), lvl5→[3] (boss, no throws), lvl6→[4] (boss throws). */
export function fightStage(raid: RaidDef, playerLevel: number): RaidStage | null {
  if (!raid.stages.length) return null;
  let bossIdx = raid.stages.findIndex((s) => s.bossKey || s.randomBoss);
  if (bossIdx < 0) bossIdx = raid.stages.length - 1;
  const idx = Math.max(
    0,
    Math.min(raid.stages.length - 1, bossIdx + (playerLevel - raid.recommendedLevel))
  );
  return raid.stages[idx];
}

/** Ability tier this raid unlocks on a win (McDonnell=1 … Ninjas=4; 0 = none). */
export function raidTier(raid: RaidDef): number {
  return raid.id >= 1 && raid.id <= 4 ? raid.id : 0;
}

/** The boosts this raid's loot table can hand over, in tier order, each with the
 *  quantity ONE drop pays (`raidBoostBundle` — Insta-Grow drops ten at a time). Loot
 *  names are matched against the boost catalog, so the farm objects filling the rest
 *  of the table stay out, and a boost listed in two tiers is only named once. */
export function boostDrops(
  raid: RaidDef,
  boosts: readonly { key: string; name: string }[]
): { key: string; name: string; qty: number }[] {
  const seen = new Set<string>();
  const out: { key: string; name: string; qty: number }[] = [];
  for (const tier of raid.loot) {
    for (const name of tier) {
      const boost = boosts.find((b) => b.name === name);
      if (!boost || seen.has(boost.key)) continue;
      seen.add(boost.key);
      out.push({ key: boost.key, name: boost.name, qty: raidBoostBundle(boost.key) });
    }
  }
  return out;
}

/** Win gold, report-faithful. The wiki base is "Gold, *no casualties*" and the
 *  bonus is a "*possible* bonus" — real payouts (e.g. Aliens 4320, not 4000+2000)
 *  land below the ceiling when zombies fall. So both are scaled by `survivalFrac`
 *  (fraction of the deployed army still standing): a flawless win earns the full
 *  base + bonus, and every casualty cuts the take. Falls back to a level-scaled
 *  estimate for any raid without a wiki figure. */
export function winGold(raid: RaidDef, survivalFrac = 1): number {
  const f = Math.max(0, Math.min(1, survivalFrac));
  const hasData = raid.goldReward > 0 || raid.bonusGold > 0;
  // Fallback for raids without a wiki figure uses the binary's own gold formula
  // (`-[ZFFightMan getStandardGoldLootForStageLevel:]` = level×100×2.3 = level×230;
  // `getBonusGoldLootForStageLevel:` = level×100). We key it off recommendedLevel as
  // the stage level; the exact "stageLevel" ivar is unconfirmed (see
  // COMBAT_STATS_RECOVERED.md), but this is far closer than the old level×50 guess.
  const base = hasData ? raid.goldReward : Math.round(raid.recommendedLevel * 230);
  const bonus = hasData ? raid.bonusGold : Math.round(raid.recommendedLevel * 100);
  return Math.round(base * f) + Math.round(bonus * f);
}

/** The consumable that improves loot luck (Market Boosts → boosts.json). Each die
 *  spent raises the win's loot-luck bracket by one, shifting the drop toward rarer
 *  tiers (source `rollForDrop:`, applied via rollLootTier in finishRaid). */
export const DICE_KEY = "golden_dice";
/** The consumable that keeps zombies focused in battle (fight at full focus). */
export const CONCENTRATION_KEY = "concentration";

/** The single item drop awarded on a win (first entry of the first non-gold loot
 *  tier), stored raw into Received. Boost/other tiers are deferred. */
export function itemDrop(raid: RaidDef): string | null {
  const tier = raid.loot.find((t) => t.length && !t.includes("Bonus Gold"));
  return tier?.[0] ?? null;
}

/** Ceiling on useful Golden Dice for a raid. Each die raises the loot-luck bracket
 *  one step rarer; once the bracket reaches the raid's rarest populated tier, more
 *  dice can't reach anything rarer. So the cap is (number of non-empty tiers − 1). */
export function maxLuckTiers(raid: RaidDef): number {
  const tiers = raid.loot.filter((t) => t.some((x) => x)).length;
  return Math.max(0, tiers - 1);
}

// ---- Random-boss waves (Robots) --------------------------------------------
//
// GROUND TRUTH `-[ZFFightMan initialSpawn]`: a raid whose data sets `randomBoss`
// (only Zombies vs Robots does) takes a branch guarded on that flag which copies the
// raid's `enemies` array — ONE entry per enemy type — into `enemyList`, picks index
// `floor((arc4random() % 100) / 100 * count) % count`, spawns THAT entry as the boss
// and `removeObjectAtIndex:`es it. `spawnEnemy` then draws the survivors the same
// way, one at a time, removing each as it goes. So the fight fields exactly one of
// each robot, in a random order, with a random one of them leading it — which is what
// the wiki describes ("There are three types of Robots here… any one of them has a
// random chance to be the Boss", population 3) and what the frequencies do NOT do.
//
// The reimplementation reproduces that as a one-shot resolution instead of a spawn
// loop, because everything downstream (boss specials, the wall template, the pinned
// server config, the replay) reads a stage with a concrete `bossKey`.

/** Deterministic 0..1 stream from a string seed (FNV-1a → mulberry32). Both the client
 *  and the server must draw the SAME wave or the verified replay diverges, so the draw
 *  is seeded by the raid session id rather than Math.random. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let state = h || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn a `randomBoss` stage into a concrete one: draw the boss from the roster, then
 *  order the rest as the spawn queue. Any other stage is returned untouched, so every
 *  caller can resolve unconditionally and then read `bossKey` / `enemyKeys` normally.
 *  `rand` must be seeded (see seededRandom) wherever the fight is server-verified. */
export function resolveStageWave(stage: RaidStage, rand: () => number): RaidStage {
  if (!stage.randomBoss) return stage;
  const roster = (stage.weighted ?? []).map((entry) => entry.enemy).filter(Boolean);
  if (!roster.length) return stage;
  // Source order: the boss is drawn (and removed) first, then each remaining spawn.
  const bossKey = roster.splice(Math.min(roster.length - 1, Math.floor(rand() * roster.length)), 1)[0];
  const enemyKeys: string[] = [];
  while (roster.length) {
    enemyKeys.push(roster.splice(Math.min(roster.length - 1, Math.floor(rand() * roster.length)), 1)[0]);
  }
  // `enemyKeys` now drives the wave, so drop `weighted`: buildEnemyUnits prefers the
  // explicit list, and leaving both would let a later reader re-derive the old
  // frequency allocation (which could never field all three bots).
  return { ...stage, bossKey, enemyKeys, weighted: undefined, population: enemyKeys.length };
}
