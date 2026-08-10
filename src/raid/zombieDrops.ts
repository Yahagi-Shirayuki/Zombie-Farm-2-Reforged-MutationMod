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

/** The generic identity every rare invasion zombie ALSO answers to for quests.
 *
 *  It exists so one achievement can ask for "a rare zombie from an invasion" without
 *  naming which of the four. A blank subject cannot express that — blank is the quest
 *  format's wildcard, and the drop is announced as ordinary loot, so a wildcard would
 *  count Bonus Gold and every boost bundle too. */
export const RARE_INVASION_ZOMBIE_SUBJECT = "Rare Invasion Zombie";

const RARE_ZOMBIE_NAMES = new Set(
  Object.values(RAID_ZOMBIE_DROPS).map((drop) => drop.name.trim().toLowerCase())
);

/** Whether a loot name is one of the rare invasion zombies (and so should carry the
 *  generic alias above). */
export function isRareInvasionZombieName(name: string): boolean {
  return RARE_ZOMBIE_NAMES.has(name.trim().toLowerCase());
}

/** Extra rare-zombie chance per Golden Die spent on the fight, as a multiple of the raid's
 *  base rate: one die doubles it, two dice triple it, and so on. Golden Dice already shift
 *  the ITEM loot roll toward its rare tiers (`LootTable.rollLootTier`), and their own
 *  description promises "the drop rate of rare items in a single fight" — the rare zombie is
 *  the rarest thing an invasion can pay, so it rides along.
 *
 *  Old McZombie 1% → 2/3/…/6% at the five dice a raid can take; the event zombies 0.8% →
 *  1.6/2.4/…/4.8%. */
export const ZOMBIE_LUCK_PER_DIE = 1;

/** Defensive ceiling on the dice a single roll may count, mirroring the clamp `/raid/start`
 *  puts on the requested count. Play caps lower still: `maxLuckTiers` allows one die per
 *  loot tier beyond the first (five on a full six-tier table). */
export const ZOMBIE_LUCK_DICE_CAP = 10;

/** This raid's rare-zombie chance with `dice` Golden Dice spent — 0 for a raid that has no
 *  rare zombie. `luck` is the flat elite multiplier (ELITE_BRAIN_LUCK on a Brain Ticket
 *  run, 1 otherwise); it stacks on top of the dice the same way it does for brains.
 *  Never exceeds 1. */
export function raidZombieDropRate(raidId: number, dice = 0, luck = 1): number {
  const drop = RAID_ZOMBIE_DROPS[raidId];
  if (drop == null) return 0;
  const spent = Math.max(0, Math.min(ZOMBIE_LUCK_DICE_CAP, Math.trunc(Number(dice) || 0)));
  const elite = Math.max(0, Number(luck) || 0);
  return Math.min(1, drop.rate * (1 + ZOMBIE_LUCK_PER_DIE * spent) * elite);
}

/** A successful configured invasion independently rolls for its rare zombie reward. `dice`
 *  is the Golden Dice spent on the fight (server-pinned online, spent locally offline);
 *  `luck` is the elite multiplier (see raidZombieDropRate). */
export function rollRaidZombieDrop(
  raidId: number,
  won: boolean,
  roll: number,
  dice = 0,
  luck = 1
): RaidZombieDrop | null {
  const drop = RAID_ZOMBIE_DROPS[raidId];
  return won &&
    drop != null &&
    Number.isFinite(roll) &&
    roll >= 0 &&
    roll < raidZombieDropRate(raidId, dice, luck)
    ? drop
    : null;
}

/** Compatibility helper for callers/tests concerned only with Old McZombie. */
export function dropsOldMcZombie(raidId: number, won: boolean, roll: number, dice = 0): boolean {
  return rollRaidZombieDrop(raidId, won, roll, dice)?.key === OLD_MC_ZOMBIE_KEY;
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
 *  nextRaidZombieDryWins); `dice` is the Golden Dice spent and `luck` the elite multiplier,
 *  both of which widen the natural roll. A natural roll always wins — the floor only fills
 *  in a miss. */
export function rollRaidZombieDropWithPity(
  raidId: number,
  won: boolean,
  roll: number,
  dryWins: number,
  dice = 0,
  luck = 1
): RaidZombieDrop | null {
  const rolled = rollRaidZombieDrop(raidId, won, roll, dice, luck);
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
