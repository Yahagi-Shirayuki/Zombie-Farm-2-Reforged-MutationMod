# Modded Feature Ledger

This file tracks the local mod features added on top of Zombie Farm 2 Reforged.
It is meant as a memory aid for tuning, debugging, and future mod work.

## Modded Mutation System

- Zombie mutations support string ids through `mutationIds`, so modded mutations do not have to compete for vanilla bitmask space.
- Modded mutations can be rendered from loose files in `public/assets/zombie/mutations/` and described in `public/assets/zombie/mutations.json`.
- Modded mutation icons live in `public/assets/ui/mutation/`.
- Modded mutation rendering is wired through farm zombies, zombie cards, market cards, side market cards, Zombie Pot selection, Zombie Pot busy/result views, raid actors, Mausoleum/team views, and portrait generation.
- Arm mutations support both a front arm and secondary back arm. Back-arm variants can be generated from the front-arm entry by using the `_b` file convention, offset tweak, and `armB` replacement.
- When a zombie flips direction, front/back arm mutation art swaps so the mutation appears to stay on the same physical side.
- Secondary same-crop arm rolls are intentionally reduced. Different arm mutations can still participate so mixed-arm zombies remain possible.
- Headless/mutation-profile restricted zombies block head and hair-eye mutations while still allowing compatible body/arm style mutations.

Main files:

- `src/zombie/mutations.ts`
- `src/zombie/mutationVisual.ts`
- `src/zombie/mutationPortrait.ts`
- `src/zombie/ZombieUnit.ts`
- `src/raid/RaidActor.ts`
- `public/assets/zombie/mutations.json`

## Zombie Pot Mod Support

- Zombie Pot combine jobs now preserve and render modded mutation ids.
- Busy/result views show mutation-aware portraits instead of falling back to plain vanilla portraits.
- Combined zombies can keep custom mutation ids, inherited colors, powder stats, random ability rolls, visual group rolls, and Luckybox visual scale rolls.

Main files:

- `src/zombie/ZombiePot.ts`
- `src/zombie/ZombieField.ts`
- `src/hud.ts`

## Powder Machine

- Added `Powder Machine` as a functional placeable object.
- Purchase limit: 4 per farm.
- Price ladder:
  - 1st: 25000 gold
  - 2nd: 5 brains
  - 3rd: 10 brains
  - 4th: 20 brains
- Unlock/cost metadata currently lives in `public/assets/placeables.json`.
- A Powder Machine opens its own panel instead of using the normal storage button.
- Panel tabs:
  - `Grinds`: choose crystals to grind.
  - `Storage`: view crystals and powders.
- Grinder capacity is 40 crystals per batch.
- Grinding time is 3 minutes per crystal, so 40 crystals is a 2 hour max batch.
- Powder output is 7-9 powder per crystal, rolled per crystal.
- Running machines show an overworld progress bar.
- Local test hotkey `N` grants +100 of each powder on Local Farm.

Main files:

- `src/powderMachine.ts`
- `src/ui/panels/powderMachine.ts`
- `src/GameState.ts`
- `src/main.ts`

## Crystal Crops

The old pomegranate experiment was replaced by five crystal crops:

| Crop | Crystal color | Harvest range | Notes |
| --- | --- | --- | --- |
| Spinalch | Red | 5-7 | Uses `spinach_icon.png` in powder UI. |
| Malakale | Green | 6-8 | Uses `kale_icon.png` in powder UI. |
| Blueberyl | Blue | 8-10 | Uses `blueberry_icon.png` in powder UI. |
| Diamint | White | 10-13 | Also has invasive behavior. |
| Oatnyx | Black | 12-15 | Uses `oat_icon.png` in powder UI. |

- Fertilized crystal crop harvests double the crystal amount.
- Current crop catalog values are in `public/assets/plants.json`.
- Crystal-to-powder mappings and harvest ranges are in `src/powderMachine.ts`.

## Invasive Diamint

- Diamint has special behavior after it becomes ready.
- The player gets a 20 minute grace period after ripening.
- After the grace period, Diamint starts spreading invasive mint in diamond-shaped rings.
- Each spread cycle is 20 minutes.
- Offline catch-up computes the correct spread radius from elapsed time rather than spreading only once per login.
- The outer ring is stage 1 invading mint; inner invaded tiles become stage 2.
- Spread only targets existing dirt plot tiles, not empty farm ground.
- Diamint itself is not transformed by the invasion logic, but other plants can be converted into invading mint.
- Invading mint can be cleared with a plowing-style action instead of normal harvesting.
- Cleared invaded tiles are protected from immediate re-invasion while an active source Diamint still wants that tile.
- Clearing fees:
  - Stage 1: 300 gold
  - Stage 2: 600 gold
  - Plowing Monolith halves these fees.
- Clearing gives 1 XP.
- Cleared invading mint returns to unplowed dirt.
- Insta-Plow affects invading mint clearing; Insta-Harvest does not.

Main files:

- `src/Field.ts`
- `public/assets/plants.json`
- `public/assets/crop/invading_stage1.png`
- `public/assets/crop/invading_stage2.png`

## Zombie Dyer / Paint Bucket

- Added `Paint Bucket` / `zombieColorMixerBucket` as a functional placeable object.
- Purchase limit: 3 per farm.
- Price ladder:
  - 1st: 5000 gold
  - 2nd: 3 brains
  - 3rd: 5 brains
- It uses a dedicated Zombie Dyer UI, not the Zombie Pot UI.
- Slot 1 accepts one owned zombie.
- Slot 2 accepts one powder color and an amount from 1 to 255.
- The selected zombie is reserved/removed from the field while dyeing, like Zombie Pot parents.
- Dyeing takes 30 minutes.
- Running buckets show an overworld progress bar.
- `paint.png` is rendered over the bucket while a job is active and tinted to the input/output zombie color.
- Color rules:
  - Red powder adds red until 255, then reduces green/blue excess.
  - Green powder adds green until 255, then reduces red/blue excess.
  - Blue powder adds blue until 255, then reduces red/green excess.
  - White powder adds all RGB channels until 255.
  - Black powder subtracts all RGB channels until 0.
- If the player requests more powder than owned, the UI shows the powder shortage message.
- If the zombie cannot use more of a color aesthetically, the UI shows the "too color" message.

Powder stat bonuses:

- Red powder grants permanent strength bonus progress.
- Green powder grants permanent dexterity bonus progress.
- Blue powder grants permanent constitution bonus progress.
- White powder grants permanent wisdom/focus bonus progress.
- Black powder has no stat bonus.
- Every 21.25 powder of the same stat color grants +1 permanent stat bonus.
- The implementation stores this as 4 progress per powder and 85 progress per +1.
- Total powder stat bonus is capped at 12 per zombie.
- Powder spent after the cap is purely visual.
- Zombie stat tooltips show the powder bonus line.

Main files:

- `src/zombieColorMixerBucket.ts`
- `src/ui/panels/zombieColorMixerBucket.ts`
- `src/zombie/statDisplay.ts`
- `src/zombie/types.ts`
- `src/zombie/ZombieField.ts`

## Luckybox Zombies

Added three Luckybox zombies:

| Zombie | Cost | Grow time | Ability tier roll |
| --- | --- | --- | --- |
| Silver Box Zombie | 5000 gold | 1 hour | Tiers 1-2 plus tier 0 mod skills |
| Gold Box Zombie | 10000 gold | 12 hours | Tiers 1-3 plus tier 0 mod skills |
| Platinum Box Zombie | 5 brains | 1 day | Tiers 1-4 plus tier 0 mod skills |

Luckybox creation rolls:

- Random RGB body color.
- Four random real ability keys.
- Random visual body family from Regular, Female, Small, Large.
- Random visual scale from 0.2 to 2.0.
- Random displayed stats within the authored range.
- These rolls are persisted on the owned zombie and do not reroll on reload.

Market/preview behavior:

- Market stats display as `???` because real stats are rolled when obtained.
- Market body color preview loops through a fixed bright palette.
- Unearthed Luckybox zombies keep their actual rolled RGB color instead of the preview loop.
- Luckybox has authored standalone modular models in `public/assets/zombie/`.
- Luckybox head has a facing-specific flip asset so the question mark does not mirror backwards.

Main files:

- `public/assets/zombies.json`
- `public/assets/zombie/Luckybox_zombie.json`
- `public/assets/zombie/Luckybox_gold_zombie.json`
- `public/assets/zombie/Luckybox_silver_zombie.json`
- `src/zombie/types.ts`
- `src/zombie/appearance.ts`
- `src/zombie/facingPartTexture.ts`

## Random Ability / Improvise / Modded Raid Skills

- `randomAbility` rolls when a Luckybox zombie is harvested/created.
- `improvise` stays as `improvise` on the farm, then rolls into a random ability only when entering a raid.
- Heal and Great Heal are excluded from random rolls, but remain in the game.
- Tier 0 is an always-unlocked modded skill pool used by random ability sources.
- Current tier 0 modded skills:
  - `freeze`
  - `lifeSteal`
  - `castle`
  - `gymRat`
  - `triple`
  - `quad`
  - `deathPunch`
  - `spike`
  - `lucky`
  - `extraLucky`
  - `superLucky`
- Tier 5 currently contains `naturalLeader` and `improvise`.
- `MAX_ABILITY_TIER` is currently 6.
- `attachMini` can be used by Luckybox carriers with any mini-type zombie passenger.
- Freeze uses the stun mechanics plus a cyan enemy tint overlay.
- Custom/modded abilities are shown on the raid UI bar so Luckybox rolls are visible.

Main files:

- `src/zombie/traits.ts`
- `src/zombie/abilities.ts`
- `src/raid/CombatEngine.ts`
- `src/raid/BattleSim.ts`
- `src/raid/RaidScene.ts`
- `src/raid/EnemyActor.ts`

## Harvest Lock Fence Tool

- Added a Fence tool to the tool nav.
- Shortcut: `6`.
- Right-click tool bar includes the Fence tool.
- The Fence tool toggles a plot harvest lock.
- Dragging can lock/unlock multiple plots in one stroke.
- Locked plots cannot be harvested by direct harvest or Harvest All.
- Locked plowed dirt can still be planted.
- Lock state is saved and restored across plot states:
  - unplowed dirt
  - plowed dirt
  - hole
  - zombie crop
  - seed
  - stage 1 crop
  - stage 2/ready crop
- Fence visuals are drawn as:
  - `fence_back`
  - current plot state/crop
  - `fence_front`
- Fence art shares the crop/entity depth-sorted layer so neighboring fenced plots interleave correctly.
- Fence install/remove is a farmer work job, similar to plowing/planting.
- Speed Monolith makes install/remove instant, but the farmer still walks to the plot.
- The cursor highlight for fence install/remove uses `#f563ff`.

Tweak points:

- Fence image offsets: `FENCE_BACK_OFFSET_X`, `FENCE_BACK_OFFSET_Y`, `FENCE_FRONT_OFFSET_X`, `FENCE_FRONT_OFFSET_Y` in `src/Field.ts`.
- Fence sorting bias: `FENCE_BACK_SORT_BIAS`, `FENCE_FRONT_SORT_BIAS` in `src/Field.ts`.

Main files:

- `src/Field.ts`
- `src/main.ts`
- `src/hud.ts`
- `src/depthSort.ts`
- `public/assets/ui/button_fence.png`
- `public/assets/ui/fence_back.png`
- `public/assets/ui/fence_front.png`

## Market And Portrait Rendering Support

- Main Market and side plot Market both support modded mutation previews.
- Market zombie preview size can be tuned separately through CSS/render constants used by the market card layouts.
- Modded zombie model JSON can be loaded from `public/assets/zombie/` via `modelJson` in `public/assets/zombies.json`.
- Folder-based/facing-specific zombie part variants are supported for cases like Luckybox head flipping.
- Zombie detail, roster, teams, Zombie Pot, Zombie Dyer, Black Market, side Market, and raid rendering all use the mutation-aware portrait path where needed.

Main files:

- `src/assets.ts`
- `src/hud.ts`
- `src/ui/panels/zombies.ts`
- `src/ui/panels/teams.ts`
- `src/zombie/mutationPortrait.ts`

## Local Testing Helpers

Local Farm hotkeys:

- `G`: +10000 gold.
- `H`: +25 brains.
- `J`: skip 60 minutes.
- `K`: skip 24 hours.
- `N`: +100 of each powder.
- `L`: +200 XP.

Dev-only `window.ZF` helpers include:

- `ZF.runRaid(id)`
- `ZF.giveBoost(key, n)`
- `ZF.winRaid(tier)`
- `ZF.place(key, oc, or)`
- `ZF.spawnMutant(key, mask)`
- `ZF.combine(idA, idB)`
- `ZF.collectCombine()`

Main file:

- `src/main.ts`
