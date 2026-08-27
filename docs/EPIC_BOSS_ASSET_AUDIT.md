# Epic Boss Asset Audit

This is a cross-reference of the Epic Boss resources recovered from the extracted
`ZF2R 1.0` application bundle. The source is not organized by feature: boss definitions,
actors, pets, rewards, market icons, quest icons, scenery, particles, and audio live in
separate files and often use different naming schemes.

## Result

Eight bosses have confidently attributable assets. Five are defined by
`data/json/gameplay/EpicEventEnemy.json`; three later sets survive only as bundle assets
plus `Market.json`, `TileProperties.json`, and `Pets.json` records.

| Boss | Source identity | Coverage | Important caveat |
| --- | --- | --- | --- |
| Dr. Groundhog | `epicBossID: 1` | Complete authored set | (All eight bosses are now prepared for the web runtime — see the status note below) |
| Loco Locust | `epicBossID: 2` / `EPIC_BOSS2` | Complete authored set | Banjo has its own sound |
| Bully Frog | `epicBossID: 3` | Complete authored set | Earlier audit saw only two animated rewards; all eight decor rewards are present |
| Foul Owl | `epicBossID: 4` | Complete authored set | Four snowmen are also milestone loot |
| Skunkarella | `epicBossID: 5`, assets say `EP_Boss7` | Complete actor/UI set; expanded reward set | The ID 5/7 mismatch is in the shipped source |
| Rocky Rhino | asset family `EPB8` | Boss/UI/decor/pet/audio present | Boss texture has no matching plist and no `EpicEventEnemy` row |
| General Larvaelus | asset family `EpicBoss9` / `EPB_9` | Boss/UI/decor/pet/particles present | Boss texture has no matching plist and no `EpicEventEnemy` row |
| Mystical Mamba | asset family `EPB_10` | Boss/UI/decor/pet/particles present | Boss texture has no matching plist and no `EpicEventEnemy` row |

No separate Epic Boss definition or coherent asset family for Rambo Raccoon was found.
The bundle's `raccoon_*` strings belong to `TreeWorldStageRaccoonActor`, so they should
not be classified as Epic Boss assets without new evidence.

All filenames below are relative to
`ZF2R_extracted/raw/ios-1.0/1.0/Payload/ZF2R.app/`.

> **Read that scope line literally.** This document inventories the *extracted bundle*, not the
> repo. The prep scripts normalize what ships into `public/assets/epic-bosses/<boss>/` under
> generic names (`boss.png`, `portrait.png`, `source-sheet.png`, `background-NN.png`,
> `loot-icon.png`, `quest-icon.png`), and they deliberately do not ship everything listed here —
> several market icons, banners, and `.plist` companions named below have no shipped counterpart.
> Do not treat a filename in this document as evidence that the asset is in the runtime; check
> the boss's directory.
>
> **Runtime status (2026-08-14):** all eight bosses ship a `catalog.json` and are exported from
> `src/epicBoss/catalog.ts`; each directory carries `boss.png`, `portrait.png`, `loot-icon.png`,
> `quest-icon.png`, `intro-1..3.png`, `music.wav`, `punch.wav`, `intro.caf`, and its backgrounds
> (15 for the five early bosses, 12 for the three late ones). All eight also ship playable
> combat animations — see "What is actually missing" for which of those were recovered and
> which were reconstructed.
>
> This file is an **asset** cross-reference. For how the fights actually work — the ten-rung
> ladder, damage ramp, costs and rewards — read `EPIC_BOSS_MECHANICS.md`, which owns that and
> is the one to trust if the two ever disagree.

## Shared event assets

- Battle layers: `bg_01.png` through `bg_12.png`. Boss definitions repeat some layers
  at different positions, which is why the prepared Groundhog catalog has 15 layer
  entries but only 12 distinct source images.
- Music and combat audio: `epicEventBGM.wav`, `epicEventIntroSFX.caf`, `epicPunch.wav`.
- Gameplay data: `EpicEventEnemy.plist`, `EpicBossHP.plist`.
- Generic reward UI: `Icon_Quest_EpicReward.png`.

## Dr. Groundhog (ID 1)

- Boss actor: `drgroundhog.png` + `drgroundhog.plist` (40 frames).
- UI/cutscene: `portrait_drgroundhog.png`, `lootdrop_drgroundhog.png`,
  `questicon_drgroundhog.png`, `drgroundhog_01.png`, `drgroundhog_02.png`,
  `drgroundhog_03.png`.
- Eight decor rewards: `drgroundhog_decors01.png/.plist` and
  `drgroundhog_decors02.png/.plist`. Their frames are `small_evildevice.png`,
  `evil_tricycle.png`, `nut_stash.png`, `lab_cabinets.png`,
  `tabletop_labratory.png` (source misspelling), `rustic_laboratory.png`,
  `burrow.png`, and `distillery.png`.
- Tame pet: `drgroundhogpet.png` + `drgroundhogpet.plist`.

## Loco Locust (ID 2)

- Boss actor: `locolocust.png` + `locolocust.plist` (38 frames).
- UI/cutscene: `portrait_locolocust.png`, `lootdrop_locolocust.png`,
  `questicon_locolocust.png`, `locolocust_01.png`, `locolocust_02.png`,
  `locolocust_03.png`.
- Eight decor rewards: `EpicB2_Shooting_Target.png`, `EpicB2_Saddle.png`,
  `EpicB2_RockingHorse.png`, `EpicB2_Boots.png`, `EpicB2_Bango.png`,
  `EPIC_BOSS2_GunCollection.png`, `EPIC_BOSS2_Bandit_Hideout.png`, and
  `EPIC_BOSS2_Saloon.png`.
- Their market icons are the eight `EpicBoss2_*_Marketicon.png` files. Note that
  `Bango` is the misspelling used by the bundle and the cactus-target icon is named
  `EpicBoss2_Cactus_Marketicon.png`.
- Tame pet: `locolocustpet.png` + `locolocustpet.plist`.
- Unique audio: `locolocustbanjo.mp3` (the banjo's tap sound).

## Bully Frog (ID 3)

- Boss actor: `bullyfrog.png` + `bullyfrog.plist` (41 frames).
- UI/cutscene: `portrait_bullyfrog.png`, `lootdrop_bullyfrog.png`,
  `questicon_bullyfrog.png`, `BullyFrog_01.png`, `BullyFrog_02.png`,
  `BullyFrog_03.png`.
- Eight decor rewards: `squirmyWorms.png/.plist`, `fireflies.png/.plist`,
  `CarnivorousPlants.png`, `LilyJukebox.png`, `MossyCouch.png`, `MuddyPool.png`,
  `ToadStool.png`, and `Swamp_Cabin.png`.
- Corresponding market icons: `Icon_Crate_of_Worms.png`, `Icon_FIreFlies.png`,
  `Icon_CarnivorousPlant.png`, `Icon_LilyJukebox.png`, `Icon_CouchMossy.png`,
  `Icon_MuddyPool.png`, `Icon_ToadStool.png`, and `Icon_SwampyCabin.png`.
- Extra victory banner: `Epb_BullyFrog_Banner.png` and
  `Icon_EBP_Bullyfrog_Banner.png`.
- Tame pet: `bullyfrogpet.png` + `bullyfrogpet.plist`.

## Foul Owl (ID 4)

- Boss actor: `foulowl.png` + `foulowl.plist` (39 frames).
- UI/cutscene: `Portrait_FoulOwl.png`, `Lootdrop_FoulOwl.png`,
  `Icon_Quest_FoulOwl.png`, `Intro1_FoulOwl.png`, `Intro2_FoulOwl.png`,
  `Intro3_FoulOwl.png`.
- Eight decor/milestone rewards: `Snowman_Farmhand.png`,
  `Snowman_LumberJack.png`, `Snowman_McDonnell.png`, `Snowman_Zombie.png`,
  `Snowman_FoulOwl.png`, `Anti_Holiday_Incinerator.png`, `Evil_Carriage.png`, and
  `Anti_Holiday_Vault.png`.
- Their icons are `Icon_Market_Snowman_FarmHand.png`,
  `Icon_Market_Snowman_Lumberjack.png`, `Icon_Market_Snowman_McDonnell.png`,
  `Icon_Market_Snowman_Zombie.png`, `Icon_Market_Snowman_FoulOwl.png`,
  `Icon_Market_Anti_HolidayIncinerator.png`, `Icon_Market_Evil_carriage.png`, and
  `Icon_Market_Anti_HolidayVault.png`.
- Tame pet: `foulowlpet.png` + `foulowlpet.plist`.

## Skunkarella (source ID 5, filenames call it Boss 7)

- Boss actor: `skunkarella_default.png` + `skunkarella_default.plist` (21 frames).
- UI/cutscene: `portrait_EP_Boss7.png`, `lootdrop_EP_Boss7.png`,
  `questIcon_EP_Boss7.png`, `INTRO1_EP_Boss7.png`, `INTRO2_EP_Boss7.png`, and
  `INTRO3_EP_Boss7.png`.
- The `EpicEventEnemy` row names four rewards, but market/tile data identifies eight:
  `blingn_Gravestone.png`, `fancyChocoFountain_default.png/.plist`,
  `Crystal_Gazebo.png`, `Diamond_Car.png`, `Fancy_Evil_Mirror.png`,
  `Fashionable_Scarecrow.png`, `Jewel_Home.png`, and `Perfume_Vat.png`.
- Their icons are `Fancy_Grave_Icon_MarketItems.png`,
  `Crystal_fountain_Icon_MarketItems.png`, `Fancy_Gazebo_Icon_MarketItems.png`,
  `Diamond_Car_Icon_MarketItems.png`, `Fancy_Mirror_Icon_MarketItems.png`,
  `Fashionable_Scarecrow_Icon_MarketItems.png`, `Jewel_Home_Icon_MarketItems.png`,
  and `Perfume_Vat_Icon_MarketItems.png`.
- Tame pet: `skunkPet_default.png` + `skunkPet_default.plist`.

## Rocky Rhino (EPB 8)

- Boss actor texture: `rockyRhino_default.png` (2048x2048). No matching plist is in
  the bundle.
- UI/cutscene: `epb8_portrait_intro.png`, `epb8_loot_icon.png`,
  `epb8_quest_icon.png`, `epb8_INTRO1.png`, `epb8_INTRO2.png`, `epb8_INTRO3.png`.
- Decor: `EPB8_BANNER1.png`, `EPB8_CAVE.png`, `ROCKY_RHINO_GONG.png`, and
  `Rocky_Beetle.png`.
- Decor icons: `EPB_8_Banner_MarketItems.png`, `Rocky_Cave_Icon_MarketItems.png`,
  `GONG_ROCKY_RHINO_Icon_MarketItems.png`, and `Rocky_Beetle_MarketIcons.png`.
- Tame pet: `rockyRhinoPet_default.png` + `rockyRhinoPet_default.plist`.
- Unique audio: `rockyrhinogong.mp3`.

## General Larvaelus (EPB 9)

- Boss actor texture: `generalLarvaelus_default.png` (2048x2048). No matching plist
  is in the bundle.
- UI/cutscene: `EpicBoss9_PORTRAIT_INTRO.png`, `EpicBoss9_LOOT_ICON.png`,
  `EpicBoss9_QUEST_ICON.png`, `EpicBoss9_INTRO1.png`, `EpicBoss9_INTRO2.png`, and
  `EpicBoss9_INTRO3.png`.
- Decor: `EPB_9_Banner.png`, `EPB_9Teleporter_A.png`, `EPB_9Teleporter_B.png`, and
  `teleporter_default.png/.plist`.
- Decor icons: `Icon_MarketItems_EPB_9_BANNER.png`,
  `Icon_MarketItems_EPB9_A_TELEPORTER.png`,
  `Icon_MarketItems_EPB9_B_TELEPORTER.png`, and
  `Icon_MarketItems_EPB9_MAIN_TELEPORTER.png`.
- Teleporter particles: `EPB_9_Teleporter_PRTCLE.plist`.
- Tame pet: `generalLarvaelusPet_default.png` +
  `generalLarvaelusPet_default.plist`.

## Mystical Mamba (EPB 10)

- Boss actor texture: `mysticalMamba_default.png` (2048x2048). No matching plist is
  in the bundle.
- UI/cutscene: `EPB_10_portrait_intro.png`, `EPB_10_loot_Icon.png`,
  `EPB_10_Quest_Icon.png`, `EPB_10_INTRO_1.png`, `EPB_10_INTRO_2.png`, and
  `EPB_10_INTRO_3.png`. `EPB_10_IPHONE_ns_icon.png` is an additional event icon.
- Decor: `EPB_10_BANNER.png` and the two-sided wish machine in
  `zomtarMachine_default.png/.plist`.
- Decor icons: `EPB_10_BANNER_Icon_MarketItems.png` and
  `ZOMTAR_machine_Icon_MarketItems.png`.
- Wish-machine extras: `ZOMTAR_EPB10_default.png/.plist` and
  `ZOMTAR_PARTICLE.plist`.
- Tame pet: `tameMamba_default.png` + `tameMamba_default.plist`.

## What is actually missing

The shipped bundle contains enough art to identify and display all eight sets above.
The material gap is not images; it is *recovered configuration* for the three late bosses —
Rocky Rhino, General Larvaelus and Mystical Mamba:

- no `EpicEventEnemy` definitions for any of the three;
- no plist/frame-coordinate metadata paired with their 2048x2048 boss textures (they ship
  `source-sheet.png` with no `source-sheet.plist`);
- no recovered level animation lists or quest chains. Each ships two quest ids against the
  nine that Foul Owl and Loco Locust carry;
- no boss-specific battle background beyond the 12 shared `bg_*` layers; and
- no trustworthy Rambo Raccoon Epic Boss set.

**What has since been reconstructed, and what that word means here.** All three now ship
`baseHp` / `multipliers` / `maxLevel` / `unitStats` *and playable combat animations* — their
strips were cut from the sheets by geometry with hand-authored frame ordering, so
`animations` is no longer empty and all eight bosses animate in a fight. Every one of those
values carries `"reconstructed": true` in its catalog, where the five early bosses carry
`false`; that flag is the honest marker, and `src/epicBoss/market.ts` sorts on it. Nothing
above was *recovered* — if the real configuration ever surfaces in another app version or a
server payload, it should replace this wholesale rather than being reconciled with it.

Loot thresholds are not stable enough to quote here: they moved with the ladder when it went
from 40 rungs to 20 to 10, and will move again if it changes. Read the `loot` array in each
`public/assets/epic-bosses/<boss>/catalog.json`; `docs/EPIC_BOSS_MECHANICS.md` explains how
the rungs are priced.
