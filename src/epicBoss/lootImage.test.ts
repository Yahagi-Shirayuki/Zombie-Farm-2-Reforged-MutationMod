import { describe, expect, it } from "vitest";
import placeables from "../../public/assets/placeables.json";
import petCatalog from "../../public/assets/pets/catalog.json";
import { BASE } from "../base";
import { EPIC_BOSSES } from "./catalog";
import { epicAsset, epicLootImage, epicLootImageByName } from "./lootImage";

const art = {
  placeables: placeables as { key: string; sprite: string }[],
  pets: petCatalog as { pets: { key: string; portrait: string }[] },
};

const LARVA = EPIC_BOSSES.find((boss) => boss.id === "general-larvaelus")!;

describe("Epic Boss prize art", () => {
  it("shows each prize's own picture, not the boss's badge", () => {
    // The reported defect: every larva prize was announced by loot-icon.png, so the
    // Banner, both Portals and the Tame Larva looked identical on the victory panel.
    const badge = epicAsset(LARVA, LARVA.lootIcon);
    const icons = LARVA.loot.map((loot) => epicLootImage(art, LARVA, loot));
    expect(icons).not.toContain(badge);
    expect(new Set(icons).size).toBe(LARVA.loot.length); // and no two look alike
  });

  it("draws a decoration with the same sprite the farm and the shed use", () => {
    const banner = LARVA.loot.find((loot) => loot.tile === "generalLarvaelusBanner")!;
    expect(epicLootImage(art, LARVA, banner)).toContain("assets/objects/generalLarvaelusBanner.png");
  });

  it("draws a tame pet with its Market portrait", () => {
    const larva = LARVA.loot.find((loot) => loot.stageActor)!;
    const pet = art.pets.pets.find((candidate) => candidate.key === larva.stageActor)!;
    // The same URL the Pets tab builds, so a tamed pet looks the same in both places.
    expect(epicLootImage(art, LARVA, larva)).toBe(`${BASE}assets/pets/${pet.portrait}`);
  });

  it("resolves the authoritative finish's by-NAME prize to the same image", () => {
    // Online, the Worker reports the won prize by name only; the two paths must not
    // put different pictures on the same panel.
    for (const loot of LARVA.loot) {
      expect(epicLootImageByName(art, LARVA, loot.name)).toBe(epicLootImage(art, LARVA, loot));
    }
  });

  it("falls back to the boss badge for a prize it cannot resolve", () => {
    expect(epicLootImage(art, LARVA, { tile: "no_such_object" }))
      .toBe(epicAsset(LARVA, LARVA.lootIcon));
    expect(epicLootImageByName(art, LARVA, "Nothing Anyone Ever Won"))
      .toBe(epicAsset(LARVA, LARVA.lootIcon));
  });

  it("gives every shipped prize of every boss real art", () => {
    // The badge is a floor, not a destination: no shipped ladder should reach it.
    for (const boss of EPIC_BOSSES) {
      const badge = epicAsset(boss, boss.lootIcon);
      for (const loot of boss.loot) {
        expect(epicLootImage(art, boss, loot), `${boss.id} / ${loot.name}`).not.toBe(badge);
      }
    }
  });
});
