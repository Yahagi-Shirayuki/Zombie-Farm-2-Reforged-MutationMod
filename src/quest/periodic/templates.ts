// The template catalog daily / weekly quests are rolled from, plus the count bands
// that size each one to the player's level.
//
// Every template resolves to the same requirement triple the catalog quests use
// (notificationID + notificationObject + countTotal), so progress is driven by the
// existing game events with no new emitters.

import plantRows from "../../../public/assets/plants.json";
import { QuestEvent } from "../events";

interface CropRow {
  key: string;
  name: string;
  level: number;
  growMs: number;
}

const HOUR_MS = 3_600_000;

/** Crops a periodic quest may name. Level -4 rows in plants.json are hidden/seasonal
 *  entries that are never plantable through the normal shop, so they are excluded. */
const CROPS: CropRow[] = (plantRows as CropRow[])
  .filter((crop) => crop.level >= 1)
  .map((crop) => ({ key: crop.key, name: crop.name, level: crop.level, growMs: crop.growMs }));

/** Level bands the counts step through: 5-9, 10-19, 20-29, 30-39, 40+. */
export function levelBand(level: number): number {
  if (level < 10) return 0;
  if (level < 20) return 1;
  if (level < 30) return 2;
  if (level < 40) return 3;
  return 4;
}

const byBand = (band: number, counts: readonly number[]): number =>
  counts[Math.max(0, Math.min(counts.length - 1, band))];

/** How many level-appropriate crops a roll chooses between. Small on purpose: it keeps
 *  the named crop recent enough to feel current without pinning it to exactly one. */
const CROP_POOL_SIZE = 5;

/** The newest unlocked crops matching a grow-time window, newest first.
 *
 *  DAILIES cap the grow time (see DAILY_MAX_GROW_MS) because a daily naming a 24h crop
 *  is not completable inside its own period unless the player happened to already have
 *  a field of it planted. Weeklies have a whole week, so they take the long crops too. */
export function cropPool(
  level: number,
  window: { maxGrowMs?: number; minGrowMs?: number } = {}
): CropRow[] {
  return CROPS
    .filter((crop) => crop.level <= level)
    .filter((crop) => window.maxGrowMs === undefined || crop.growMs <= window.maxGrowMs)
    .filter((crop) => window.minGrowMs === undefined || crop.growMs >= window.minGrowMs)
    // Newest first, then shortest, then by key so the ordering is total — the roll is
    // seeded, so any ambiguity here would desync two callers on the same seed.
    .sort((a, b) => b.level - a.level || a.growMs - b.growMs || (a.key < b.key ? -1 : 1))
    .slice(0, CROP_POOL_SIZE);
}

/** A daily may only name a crop that can realistically cycle within a day. */
export const DAILY_MAX_GROW_MS = 4 * HOUR_MS;
/** A weekly "long crop" objective draws from the slow, high-value end. */
export const WEEKLY_LONG_MIN_GROW_MS = 8 * HOUR_MS;

const ICON = {
  crops: "Icon_Quest_HarvestVegetables.png",
  zombies: "Icon_Quest_HarvestZombies.png",
  plow: "Icon_Quest_Plowing.png",
  invasion: "Icon_Quest_Invasion.png",
} as const;

export interface TemplateContext {
  level: number;
  band: number;
  /** A per-account, per-period counter used to ROTATE through a pool rather than roll
   *  it. A fair roll over five crops repeats the previous day's crop one day in five,
   *  and over four templates repeats the previous day's chore one day in four — which
   *  reads as the generator being broken rather than as luck. Walking the pool one step
   *  per period guarantees something different every period, while the account term
   *  keeps two players on the same day off the same quests. */
  rotation: number;
}

/** Step `n` places through `items`, wrapping (and tolerating negatives). */
function rotate<T>(items: readonly T[], n: number): T | undefined {
  if (!items.length) return undefined;
  return items[((n % items.length) + items.length) % items.length];
}

/** What a template produces, before the reward is attached. */
export interface BuiltQuest {
  text: string;
  icon: string;
  notificationID: string;
  notificationObject: string;
  countTotal: number;
}

export interface QuestTemplate {
  key: string;
  /** Returns null when the template cannot produce a quest at this level (e.g. no
   *  crop in the window yet); the caller then rolls a different template. */
  build(ctx: TemplateContext): BuiltQuest | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ---------------------------------------------------------------- daily templates

const dailyHarvestNamedCrop: QuestTemplate = {
  key: "daily_harvest_crop",
  build({ level, band, rotation }) {
    const crop = rotate(cropPool(level, { maxGrowMs: DAILY_MAX_GROW_MS }), rotation);
    if (!crop) return null;
    const countTotal = byBand(band, [10, 15, 20, 25, 30]);
    return {
      text: `Harvest ${countTotal} ${crop.name}`,
      icon: ICON.crops,
      notificationID: QuestEvent.CropHarvested,
      notificationObject: crop.name,
      countTotal,
    };
  },
};

const dailyPlantNamedCrop: QuestTemplate = {
  key: "daily_plant_crop",
  build({ level, band, rotation }) {
    // Planting has no grow time to wait out, so this window is wider than the harvest
    // one — it can ask for the slow, expensive crops a harvest daily cannot.
    const crop = rotate(cropPool(level, { maxGrowMs: 8 * HOUR_MS }), rotation + 2);
    if (!crop) return null;
    const countTotal = byBand(band, [8, 12, 16, 20, 24]);
    return {
      text: `Plant ${countTotal} ${crop.name}`,
      icon: ICON.plow,
      notificationID: QuestEvent.CropPlanted,
      notificationObject: crop.name,
      countTotal,
    };
  },
};

const dailyHarvestAnyCrop: QuestTemplate = {
  key: "daily_harvest_any",
  build({ band }) {
    const countTotal = byBand(band, [15, 25, 35, 45, 55]);
    return {
      text: `Harvest ${countTotal} crops`,
      icon: ICON.crops,
      notificationID: QuestEvent.CropHarvested,
      notificationObject: "",
      countTotal,
    };
  },
};

const dailyPlow: QuestTemplate = {
  key: "daily_plow",
  build({ band }) {
    const countTotal = byBand(band, [5, 8, 10, 12, 15]);
    return {
      text: `Plow ${countTotal} ${plural(countTotal, "plot", "plots")}`,
      icon: ICON.plow,
      notificationID: QuestEvent.SoilPlowed,
      notificationObject: "",
      countTotal,
    };
  },
};

const dailyHarvestZombies: QuestTemplate = {
  key: "daily_harvest_zombies",
  build({ band }) {
    // Kept small at every band: a harvested zombie needs a free army or crypt slot, so
    // a large ask can stall against the capacity fence through no fault of the player.
    const countTotal = byBand(band, [1, 1, 2, 2, 2]);
    return {
      text: `Harvest ${countTotal} ${plural(countTotal, "zombie", "zombies")}`,
      icon: ICON.zombies,
      notificationID: QuestEvent.ZombieHarvested,
      notificationObject: "",
      countTotal,
    };
  },
};

const dailyInvade: QuestTemplate = {
  key: "daily_invade",
  build({ band }) {
    // The invasion cooldown is two hours, so even the top band is a fraction of what a
    // day allows. Any raid counts — naming one could point at a stage the player's
    // army cannot yet clear.
    const countTotal = byBand(band, [1, 1, 2, 2, 2]);
    return {
      text: `Win ${countTotal} ${plural(countTotal, "invasion", "invasions")}`,
      icon: ICON.invasion,
      notificationID: QuestEvent.InvasionSuccessful,
      notificationObject: "",
      countTotal,
    };
  },
};

const dailyInvadeClean: QuestTemplate = {
  key: "daily_invade_clean",
  build({ band }) {
    // Withheld below band 2 (level 20): a flawless invasion needs an army that can
    // actually absorb the stage, and asking a level-10 farm for one is asking it to
    // lose zombies trying. Returning null here lets the slot fall through to the
    // ordinary win, which is why the invasion slot is never empty.
    if (band < 2) return null;
    const countTotal = 1;
    return {
      text: `Win ${countTotal} invasion without losing a zombie`,
      icon: ICON.invasion,
      notificationID: QuestEvent.InvasionPerfectGame,
      notificationObject: "",
      countTotal,
    };
  },
};

// --------------------------------------------------------------- weekly templates

const weeklyHarvestAnyCrop: QuestTemplate = {
  key: "weekly_harvest_any",
  build({ band }) {
    const countTotal = byBand(band, [60, 100, 140, 175, 210]);
    return {
      text: `Harvest ${countTotal} crops`,
      icon: ICON.crops,
      notificationID: QuestEvent.CropHarvested,
      notificationObject: "",
      countTotal,
    };
  },
};

const weeklyHarvestNamedCrop: QuestTemplate = {
  key: "weekly_harvest_crop",
  build({ level, band, rotation }) {
    const crop = rotate(cropPool(level, { maxGrowMs: DAILY_MAX_GROW_MS }), rotation + 1);
    if (!crop) return null;
    const countTotal = byBand(band, [40, 65, 90, 115, 140]);
    return {
      text: `Harvest ${countTotal} ${crop.name}`,
      icon: ICON.crops,
      notificationID: QuestEvent.CropHarvested,
      notificationObject: crop.name,
      countTotal,
    };
  },
};

const weeklyHarvestLongCrop: QuestTemplate = {
  key: "weekly_harvest_long_crop",
  build({ level, band, rotation }) {
    const crop = rotate(cropPool(level, { minGrowMs: WEEKLY_LONG_MIN_GROW_MS }), rotation + 3);
    if (!crop) return null;
    // Sized against one or two cycles a day rather than the many a short crop allows.
    const countTotal = byBand(band, [15, 25, 35, 45, 55]);
    return {
      text: `Harvest ${countTotal} ${crop.name}`,
      icon: ICON.crops,
      notificationID: QuestEvent.CropHarvested,
      notificationObject: crop.name,
      countTotal,
    };
  },
};

const weeklyHarvestZombies: QuestTemplate = {
  key: "weekly_harvest_zombies",
  build({ band }) {
    const countTotal = byBand(band, [3, 4, 5, 6, 8]);
    return {
      text: `Harvest ${countTotal} zombies`,
      icon: ICON.zombies,
      notificationID: QuestEvent.ZombieHarvested,
      notificationObject: "",
      countTotal,
    };
  },
};

const weeklyInvade: QuestTemplate = {
  key: "weekly_invade",
  build({ band }) {
    const countTotal = byBand(band, [3, 5, 6, 8, 10]);
    return {
      text: `Win ${countTotal} invasions`,
      icon: ICON.invasion,
      notificationID: QuestEvent.InvasionSuccessful,
      notificationObject: "",
      countTotal,
    };
  },
};

const weeklyPerfectInvade: QuestTemplate = {
  key: "weekly_perfect_invade",
  build({ band }) {
    const countTotal = byBand(band, [1, 1, 2, 2, 3]);
    return {
      text: `Win ${countTotal} ${plural(countTotal, "invasion", "invasions")} without losing a zombie`,
      icon: ICON.invasion,
      notificationID: QuestEvent.InvasionPerfectGame,
      notificationObject: "",
      countTotal,
    };
  },
};

/** Daily slots, in order. Each slot rolls one template from its own pool, so a day is
 *  never all-farm or all-raid: a named crop, a farm chore, then an invasion. */
export const DAILY_SLOTS: readonly (readonly QuestTemplate[])[] = [
  [dailyHarvestNamedCrop],
  [dailyPlantNamedCrop, dailyHarvestAnyCrop, dailyPlow, dailyHarvestZombies],
  // Below level 20 this slot has only one buildable template, so the invasion quest is
  // deliberately the same every day — the dependable half of the board. From 20 it
  // alternates with the flawless-win variant.
  [dailyInvade, dailyInvadeClean],
];

/** Weekly slots: a cumulative growing goal, then a cumulative invasion goal. */
export const WEEKLY_SLOTS: readonly (readonly QuestTemplate[])[] = [
  [weeklyHarvestAnyCrop, weeklyHarvestNamedCrop, weeklyHarvestLongCrop, weeklyHarvestZombies],
  [weeklyInvade, weeklyPerfectInvade],
];
