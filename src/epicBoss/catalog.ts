import groundhogRaw from "../../public/assets/epic-bosses/dr-groundhog/catalog.json";
import locustRaw from "../../public/assets/epic-bosses/loco-locust/catalog.json";
import frogRaw from "../../public/assets/epic-bosses/bully-frog/catalog.json";
import owlRaw from "../../public/assets/epic-bosses/foul-owl/catalog.json";
import skunkRaw from "../../public/assets/epic-bosses/skunkarella/catalog.json";
import rhinoRaw from "../../public/assets/epic-bosses/rocky-rhino/catalog.json";
import larvaRaw from "../../public/assets/epic-bosses/general-larvaelus/catalog.json";
import mambaRaw from "../../public/assets/epic-bosses/mystical-mamba/catalog.json";
import type { EpicBossDef } from "./types";

export const DR_GROUNDHOG = groundhogRaw as EpicBossDef;
export const LOCO_LOCUST = locustRaw as EpicBossDef;
export const BULLY_FROG = frogRaw as EpicBossDef;
export const FOUL_OWL = owlRaw as EpicBossDef;
export const SKUNKARELLA = skunkRaw as EpicBossDef;
export const ROCKY_RHINO = rhinoRaw as EpicBossDef;
export const GENERAL_LARVAELUS = larvaRaw as EpicBossDef;
export const MYSTICAL_MAMBA = mambaRaw as EpicBossDef;
export const EPIC_BOSSES: readonly EpicBossDef[] = [
  DR_GROUNDHOG, LOCO_LOCUST, BULLY_FROG, FOUL_OWL, SKUNKARELLA,
  ROCKY_RHINO, GENERAL_LARVAELUS, MYSTICAL_MAMBA,
];
const BY_ID = new Map(EPIC_BOSSES.map((boss) => [boss.id, boss]));

// Per-boss unlock level, ordered by HOW STRONG THE PRIZE ZOMBIES ARE — the eight
// events are not interchangeable, so gating them all at one level put Loco Locust's
// Vagabond (the strongest zombie in the game) beside Dr. Groundhog's Omega, which
// deals a quarter of its damage, at the same price and the same player level.
//
// The ladder runs weakest prize first, by the sustained DPS of each boss's best
// reward zombie (str x 10 damage per 2/dex seconds, abilities folded in):
//   24  Dr. Groundhog     Omega Dr. Zombie   307 DPS / 4043 HP   (entry boss, 5 brains)
//   28  Bully Frog        Captain Zombie     307 DPS / 4742 HP
//   30  Rocky Rhino       Brock Coley        662 DPS /  735 HP
//   32  General Larvaelus Zombug             579 DPS / 2275 HP
//   34  Mystical Mamba    Zomtar             662 DPS / 2275 HP
//   38  Foul Owl          Scrooge Zombie     573 DPS / 5110 HP   (the best tank)
//   40  Skunkarella       Madame Zombie      991 DPS / 2200 HP
//   42  Loco Locust       Vagabond Zombie   1102 DPS / 2700 HP
//
// Rocky Rhino and Foul Owl are swapped against a strict DPS sort on purpose: Brock
// Coley is a 40-str/735-HP glass cannon that dies to anything, while Scrooge is the
// highest-HP zombie in the game and worth holding back as a late-ladder reward.
export const EPIC_BOSS_UNLOCK_LEVELS: Readonly<Record<string, number>> = {
  "dr-groundhog": 24,
  "bully-frog": 28,
  "rocky-rhino": 30,
  "general-larvaelus": 32,
  "mystical-mamba": 34,
  "foul-owl": 38,
  "skunkarella": 40,
  "loco-locust": 42,
};
/** Fallback for a boss with no entry above (a future event). */
export const DEFAULT_EPIC_BOSS_UNLOCK_LEVEL = 32;

export function epicBossById(id: string | null | undefined): EpicBossDef | null {
  return id ? BY_ID.get(id) ?? null : null;
}
export function epicBossUnlockLevel(boss: EpicBossDef | string): number {
  const id = typeof boss === "string" ? boss : boss.id;
  return EPIC_BOSS_UNLOCK_LEVELS[id] ?? DEFAULT_EPIC_BOSS_UNLOCK_LEVEL;
}
export function epicBossHp(def: EpicBossDef, level: number): number {
  const index = Math.max(0, Math.min(def.maxLevel - 1, Math.floor(level) - 1));
  return Math.round(def.baseHp * (def.multipliers[index] ?? 1));
}
