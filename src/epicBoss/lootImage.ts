// What an Epic Boss prize looks like on the victory panel.
//
// Every drop used to be drawn with the BOSS's `lootIcon` — one generic badge per
// event, so General Larvaelus' Banner, its two Portals and its Tame Larva were all
// announced by the same yellow grub, and a player who won a new prize could not tell
// from the panel what they had won. (Reported as "the images for the rewards from the
// larva raid are placeholders".) It is not larva-specific: all nine events did it.
//
// Every shipped prize resolves to real art, and it is art the player sees again
// elsewhere, which is the point — the panel now shows the same picture Received and
// the shed will:
//   * a decoration by its placeable's object sprite (raidRewardImage's rule, so a
//     raid drop and an epic drop of the same object never disagree);
//   * a tame pet by its Market portrait;
//   * and the boss badge only as a last resort, for a prize with neither.
import { BASE } from "../base";
import type { EpicBossDef, EpicBossLoot } from "./types";

/** A file inside one boss's asset folder. */
export const epicAsset = (def: Pick<EpicBossDef, "id">, file: string): string =>
  `${BASE}assets/epic-bosses/${def.id}/${file}`;

/** The narrow slice of the loaded catalogs this needs — deliberately structural, so
 *  the resolver is testable without a loaded GameAssets. */
export interface EpicLootArt {
  placeables: readonly { key: string; sprite: string }[];
  pets: { pets: readonly { key: string; portrait: string }[] };
}

/** The picture for one prize. Never empty: the boss badge is the floor. */
export function epicLootImage(
  art: EpicLootArt,
  def: Pick<EpicBossDef, "id" | "lootIcon">,
  loot: Pick<EpicBossLoot, "tile" | "stageActor">,
): string {
  if (loot.tile) {
    const placeable = art.placeables.find((candidate) => candidate.key === loot.tile);
    if (placeable) return `${BASE}assets/objects/${placeable.sprite}`;
  }
  if (loot.stageActor) {
    const pet = art.pets.pets.find((candidate) => candidate.key === loot.stageActor);
    if (pet) return `${BASE}assets/pets/${pet.portrait}`;
  }
  return epicAsset(def, def.lootIcon);
}

/** The picture for the prize this boss calls `name`. The authoritative finish reports
 *  a won prize by NAME only, so the online path has to come back through the catalog
 *  to reach the same image the offline path picked. */
export function epicLootImageByName(
  art: EpicLootArt,
  def: Pick<EpicBossDef, "id" | "lootIcon" | "loot">,
  name: string,
): string {
  const loot = def.loot.find((candidate) => candidate.name === name);
  return loot ? epicLootImage(art, def, loot) : epicAsset(def, def.lootIcon);
}
