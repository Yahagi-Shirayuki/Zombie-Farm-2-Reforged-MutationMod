/** Rare zombies are separate roster rewards, not part of the ordinary item-loot roll. */
export interface RaidZombieDrop {
  key: string;
  name: string;
  rate: number;
}

export const OLD_MC_ZOMBIE_KEY = "ZombieActorOldMcZombie";
export const OLD_MC_ZOMBIE_NAME = "Old McZombie";
export const OLD_MC_ZOMBIE_RAID_ID = 1;
export const OLD_MC_ZOMBIE_DROP_RATE = 1 / 100;

export const DIVER_ZOMBIE_KEY = "ZombieActorHeadless2Tier5";
export const DIVER_ZOMBIE_NAME = "Diver Zombie";
export const SPRING_BREAK_RAID_ID = 7;

export const FOREST_ZOMBIE_KEY = "ZombieActorForest";
export const FOREST_ZOMBIE_NAME = "Forest Zombie";
export const TREE_WORLD_RAID_ID = 10;

export const TEDDY_ZOMBIE_KEY = "ZombieActorRegular4Tier5";
export const TEDDY_ZOMBIE_NAME = "Teddy Zombie";
export const VALENTINES_DAY_RAID_ID = 11;

export const EVENT_ZOMBIE_DROP_RATE = 0.8 / 100;

export const RAID_ZOMBIE_DROPS: Readonly<Record<number, RaidZombieDrop>> = {
  [OLD_MC_ZOMBIE_RAID_ID]: {
    key: OLD_MC_ZOMBIE_KEY,
    name: OLD_MC_ZOMBIE_NAME,
    rate: OLD_MC_ZOMBIE_DROP_RATE,
  },
  [SPRING_BREAK_RAID_ID]: {
    key: DIVER_ZOMBIE_KEY,
    name: DIVER_ZOMBIE_NAME,
    rate: EVENT_ZOMBIE_DROP_RATE,
  },
  [TREE_WORLD_RAID_ID]: {
    key: FOREST_ZOMBIE_KEY,
    name: FOREST_ZOMBIE_NAME,
    rate: EVENT_ZOMBIE_DROP_RATE,
  },
  [VALENTINES_DAY_RAID_ID]: {
    key: TEDDY_ZOMBIE_KEY,
    name: TEDDY_ZOMBIE_NAME,
    rate: EVENT_ZOMBIE_DROP_RATE,
  },
};

/** A successful configured invasion independently rolls for its rare zombie reward. */
export function rollRaidZombieDrop(raidId: number, won: boolean, roll: number): RaidZombieDrop | null {
  const drop = RAID_ZOMBIE_DROPS[raidId];
  return won &&
    drop != null &&
    Number.isFinite(roll) &&
    roll >= 0 &&
    roll < drop.rate
    ? drop
    : null;
}

/** Compatibility helper for callers/tests concerned only with Old McZombie. */
export function dropsOldMcZombie(raidId: number, won: boolean, roll: number): boolean {
  return rollRaidZombieDrop(raidId, won, roll)?.key === OLD_MC_ZOMBIE_KEY;
}

/** Wins of ONE raid, without that raid's rare zombie, before the next win is guaranteed to
 *  hand it over. At 1% (Old McZombie) / 0.8% (the event zombies) a grinder can clear a raid
 *  hundreds of times and still never see it; this puts a ceiling on that.
 *
 *  The streak is PER RAID — clearing Tree World does nothing for Old McDonnell's — and it
 *  counts the raid's own dry wins, so a player who has already collected one starts over
 *  rather than being handed a second immediately.
 *
 *  DELIBERATELY INVISIBLE, like the brain floor in brainDrops.ts: nothing in the UI counts
 *  wins towards it, and a guaranteed zombie arrives through the same result-panel reward row
 *  as a lucky one. Keep it that way. */
export const RAID_ZOMBIE_PITY_WINS = 100;

/** Roll a win's rare-zombie reward with the per-raid dry-win floor applied. `dryWins` is how
 *  many times this raid has been won since it last handed its zombie over (see
 *  nextRaidZombieDryWins). A natural roll always wins — the floor only fills in a miss. */
export function rollRaidZombieDropWithPity(
  raidId: number,
  won: boolean,
  roll: number,
  dryWins: number
): RaidZombieDrop | null {
  const rolled = rollRaidZombieDrop(raidId, won, roll);
  if (rolled) return rolled;
  const drop = RAID_ZOMBIE_DROPS[raidId];
  return won && drop != null && dryWins >= RAID_ZOMBIE_PITY_WINS ? drop : null;
}

/** Advance one raid's dry-win streak for a settled WIN of that raid. Receiving the zombie
 *  resets it; a dry win adds to it, clamped so the stored number stays bounded.
 *
 *  Only call this for a raid that actually has a rare zombie (RAID_ZOMBIE_DROPS) and only on
 *  a win: a loss is not a completion, and the other seven raids have nothing to guarantee. */
export function nextRaidZombieDryWins(dryWins: number, dropped: boolean): number {
  if (dropped) return 0;
  return Math.min(Math.max(0, Math.trunc(dryWins)) + 1, RAID_ZOMBIE_PITY_WINS);
}

/** Whether a raid has a rare zombie at all — i.e. whether its dry-win streak means anything. */
export function hasRaidZombieDrop(raidId: number): boolean {
  return RAID_ZOMBIE_DROPS[raidId] != null;
}
