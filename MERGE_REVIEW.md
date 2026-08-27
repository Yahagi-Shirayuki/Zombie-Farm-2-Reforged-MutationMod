# Spots where this merge kept the mod's version

Upstream changed these too. The merge deliberately kept **this fork's** code, because
they are the mod's own combat ruleset and mutation content and a merge must not
silently retune the game. Nothing here is a bug; each line is a place to decide, later,
whether upstream's newer version is worth taking.

See upstream's ruleset 40 (`src/raid/replay.ts`) for what changed on that side.

- `src/raid/BattleSim.abilities.test.ts` — upstream had: `import { BattleSim, CHARGE_X, ENEMY_HOLD_X, type SimUnit } from "./BattleSim";`
- `src/raid/BattleSim.ts` — upstream had: `import type { BossActionChoice, BossSpecial, BossThrowConfig, CombatUnit, CrabConfig, GrabberConfig,`
- `src/raid/BattleSim.ts` — upstream had: `/** Live knockback slide (`ActorFightData knockBackPoint` / `knockBackSpeed`). While`
- `src/raid/BattleSim.ts` — upstream had: `// Mini Buddy is the one move performed OFF the field, so it does not go through`
- `src/raid/BattleSim.ts` — upstream had: `if (key === "attachMini") return this.players.some((p) => this.canTakeMini(p));`
- `src/raid/BattleSim.ts` — upstream had: `p.damageReduction = protectReduction(protect, p.abilities.includes("protect"));`
- `src/raid/BattleSim.ts` — upstream had: `this.recordAbilityKill(key, e, () => this.dealDamage(e, dmg, true));`
- `src/raid/BattleSim.ts` — upstream had: `} else if (foe) {`
- `src/raid/BattleSim.ts` — upstream had: `/** Advance a live knockback slide. Returns true while the zombie is still being shoved,`
- `src/raid/BattleSim.ts` — upstream had: `// A fallen zombie joins the corpse backlog a Garden holder's Resurrect draws from.`
- `src/raid/BattleSim.ts` — upstream had: `*  defeated zombie at full Life and sends it back into formation. */`
- `src/raid/BattleSim.ts` — upstream had: `defeated.burnMs = 0; // whatever it died of, it does not come back still alight`
- `src/raid/BattleSim.ts` — upstream had: `// The latch spares the zombie but does not soften the blow: the number still`
- `src/raid/BattleSim.ts` — upstream had: `// Unreachable at the fixed 50 ms tick (the empty-lane park above catches the`
- `src/raid/CombatEngine.ts` — upstream had: `import { activeAbilities, combatEffect } from "../zombie/abilities";`
- `src/raid/CombatEngine.ts` — upstream had: `u.damageReduction = protectReduction(protect, keys.includes("protect"));`
- `src/raid/RaidActor.test.ts` — upstream had: `const root = (actor as unknown as { root: { children: unknown[] } }).root;`
- `src/raid/RaidActor.test.ts` — upstream had: `// Body + eyes + jaw + the mutation's front and back arms, plus placeholder feet.`
- `src/raid/RaidActor.ts` — upstream had: `backArmPlacement,`
- `src/raid/RaidActor.ts` — upstream had: `this.clipModel = m;`
- `src/raid/RaidActor.ts` — upstream had: `// Crop arms occupy the authored arm slot — BOTH arms, front and back. Only`
- `src/raid/RaidActor.ts` — upstream had: `// A head mutation pushes the face in FRONT of the new skull; anything that stays`
- `src/raid/RaidActor.ts` — upstream had: `(deletion)`
- `src/raid/RaidActor.ts` — upstream had: `} else if (mp.replaces === "armF" || (!mp.replaces && slotOf(bit) === "arm")) {`
- `src/raid/RaidActor.ts` — upstream had: `/**`
- `src/raid/RaidManager.ts` — upstream had: `import { displayTotals } from "../zombie/statDisplay";`
- `src/raid/RaidManager.ts` — upstream had: `/** What a win pays once the first clear is behind you (repeatXp.ts). Shown INSTEAD of`
- `src/raid/RaidManager.ts` — upstream had: `/** Spend a Brain Ticket: bypasses the cooldown like a voucher, quadruples the brain`
- `src/raid/RaidManager.ts` — upstream had: `/** ONLINE: whether the server actually charged a Brain Ticket and pinned this session`
- `src/raid/RaidManager.ts` — upstream had: `/** A Brain Ticket WAS charged: the enemy line above is already scaled to this raid's`
- `src/raid/RaidManager.ts` — upstream had: `repeatXp: repeatInvasionXp(r.id),`
- `src/raid/RaidManager.ts` — upstream had: `// Brain Ticket. Spent BEFORE the cooldown gate, because spending it IS a cooldown`
- `src/raid/RaidManager.ts` — upstream had: `// An elite launch already paid for the bypass with the ticket spent above.`
- `src/raid/RaidManager.ts` — upstream had: `// Elite scales the boss's whole repertoire, not just its body: heavier and (on`
- `src/raid/RaidManager.ts` — upstream had: `// Alien-stage divergences (raid 6 only) — see raid/alienStage.ts. The verifier`
- `src/raid/RaidManager.ts` — upstream had: `elite: EliteProfile | null = null`
- `src/raid/RaidManager.ts` — upstream had: `brainEligible = brainDrop > 0,`
- `src/raid/RaidManager.ts` — upstream had: `// same way it shifts the item roll's tier, and an elite (Brain Ticket) run`
- `src/raid/RaidScene.ts` — upstream had: `import { isEpicBossKey } from "../epicBoss/combat";`
- `src/raid/RaidScene.ts` — upstream had: `/** The alien boss's two saucer halves. GROUND TRUTH: `-[AlienStageActorBoss`
- `src/raid/RaidScene.ts` — upstream had: `/** Settings → Display, read once when the scene is built: a raid does not change`
- `src/raid/RaidScene.ts` — upstream had: `const ufoParts: Sprite[] = [];`
- `src/raid/RaidScene.ts` — upstream had: `// `u.id` is the owned zombie's roster id (CombatEngine builds player units`
- `src/raid/RaidScene.ts` — upstream had: `ufoParts: ufoParts.length ? ufoParts : undefined,`
- `src/raid/RaidScene.ts` — upstream had: `// `clip` names the authored animation for this state: a perched boss's`
- `src/raid/RaidScene.ts` — upstream had: `// The attack strip is driven off the sim's attack clock, not off playback: it`
- `src/raid/RaidScene.ts` — upstream had: `if (clockDriven) tok.epicActor.stop();`
- `src/raid/RaidScene.ts` — upstream had: `/** The Explode payoff: a big, loud, unmistakable fireball centred on the zombie that`
- `src/raid/RaidScene.ts` — upstream had: `// `AlienStageBullet collidedWith:` plays stun.wav on the hit, not the generic`
- `src/raid/RaidScene.ts` — upstream had: `// After layout: the beams pin to this frame's eye/target positions.`
- `src/raid/brainDrops.ts` — upstream had: `/** The recommended level at which a tier's chance reaches its `upper` rate. It is a`
- `src/raid/brainDrops.ts` — upstream had: `/** Hard ceiling on any single tier's chance. Nothing in the catalog comes close (the`
- `src/raid/brainDrops.ts` — upstream had: `/** Chance (0..1) that a brain-eligible win pays ANY brains. The tiers above are rolled`
- `src/raid/combatStats.ts` — upstream had: `/** Damage reduction the Protect aura grants ONE zombie, given how many carriers are`
- `src/raid/combatStats.ts` — upstream had: `/** The Dread Pirate Arrrnold. He is NOT in the recovered override — the binary reaches it`
- `src/raid/replay.ts` — upstream had: `// 19: Explode / Explode Ver.2 now KILL the zombie that uses them. The blast still lands`
- `src/zombie/ZombieUnit.ts` — upstream had: `backArmPlacement,`
- `src/zombie/ZombieUnit.ts` — upstream had: `// Position, and the remaining (straightened — see walkRoute) waypoints. `warp` marks`
- `src/zombie/ZombieUnit.ts` — upstream had: `*  "teleports" to a crop it fertilizes, then resumes wandering.`
- `src/zombie/ZombieUnit.ts` — upstream had: `// What this unit LOOKS like on the farm, after the mutations its own card hides`
- `src/zombie/ZombieUnit.ts` — upstream had: `if (replacement === "armF") {`
- `src/zombie/ZombieUnit.ts` — upstream had: `/** The back-shoulder copy of a crop arm, or undefined on a rig with no back arm`
- `src/zombie/ZombieUnit.ts` — upstream had: `/** Walk to a specific tile and stay there — the Zombie Patch "calls" units to nap`
- `src/zombie/ZombieUnit.ts` — upstream had: `// Somewhere it would happily stand: a hedge tile is walkable in a pinch but`
- `src/zombie/mutationAlmanac.ts` — upstream had: `// Mutation Almanac: the collection behind the Zombies menu's third tab.`
- `src/zombie/mutationDisplay.ts` — upstream had: `tomato: iconFile("tomato"), onion: iconFile("onion"), carrot: iconFile("carrot"),`
- `src/zombie/mutationDisplay.ts` — upstream had: `/** A mask written out for THIS species, e.g. "Onionhead, Celery-arms" — empty for an`
- `src/zombie/mutationPortrait.test.ts` — upstream had: `it("shows a crop arm on both arms, hiding the base pair behind it", () => {`
- `src/zombie/mutationPortrait.ts` — upstream had: `backArmPlacement,`
- `src/zombie/mutationPortrait.ts` — upstream had: `import {`
- `src/zombie/mutationPortrait.ts` — upstream had: `/**`
- `src/zombie/mutationPortrait.ts` — upstream had: `const shown = displayedAppearance(mutation, color);`
- `src/zombie/mutationPortrait.ts` — upstream had: `const watchers = wanted ? [wanted] : [];`
- `src/zombie/mutationVisibility.ts` — upstream had: `// ---------------------------------------------------------------------------`
- `src/zombie/mutationVisual.test.ts` — upstream had: `it("draws no head mutation on a masked face, but still draws its other slots", () => {`
- `src/zombie/mutationVisual.test.ts` — upstream had: `it("replaces the whole arm pair, front and back", () => {`
- `src/zombie/mutationVisual.ts` — upstream had: `import type { MutationPart, ZombieDef, ZombieModel } from "../assets";`
- `src/zombie/mutationVisual.ts` — upstream had: `/** The base silhouette a mutation takes over. `"armF"` is the authored NAME of the`
- `src/zombie/mutationVisual.ts` — upstream had: `/** The eye attachments: Carrot-eyed and the Eyebiscus that used to ride its bit. */`
- `src/zombie/mutationVisual.ts` — upstream had: `/** Carrot-eyed and Eyebiscus are eye attachments, so they must remain visible above`
- `src/zombie/mutationVisual.ts` — upstream had: `if (EYE_MUTATION_BITS.has(bit)) return EYE_MUTATION_FOREGROUND_Z;`
- `src/zombie/mutationVisual.ts` — upstream had: `/**`
- `src/zombie/mutationVisual.ts` — upstream had: `const maskedFace = hidesHeadMutationArt(key);`
- `src/zombie/mutationVisual.ts` — upstream had: `/** True when a base-model part should be hidden by a replacement mutation.`
- `src/zombie/mutationVisual.ts` — upstream had: `return replacement === "body"`
- `src/zombie/mutations.test.ts` — upstream had: `// server/migrations/0035_headless_mutation_repair.sql clears the literal 951 — the`
- `src/zombie/mutations.test.ts` — upstream had: `it("pays the head slot's best attack bonus, beating Garlichead outright", () => {`
- `src/zombie/mutations.ts` — upstream had: `/** A mutation's rank, 1-4, as ZF2 authored it: the market mutant that carries each`
- `src/zombie/mutations.ts` — upstream had: `stats: MutationStats; // e.g. { con: 8, dex: -2 }`
- `src/zombie/mutations.ts` — upstream had: `{ key: "tomato", name: "Tomatohead", slot: "head", stats: { str: 1 }, tier: 1 },`
- `src/zombie/traits.ts` — upstream had: `// ---- Tier 1 (mostly passive stat buffs; the buff IS the display name) ----`

## Upstream refinements this merge could not take

These are not conflicts of intent — they are upstream improvements whose API this
fork's own modules do not offer. Taking them would have meant rewriting the mod's
mutation stack, which is out of scope for a merge.

- **Portrait cancellation.** Upstream's `zombieMutationPortraitOf` takes a `wanted`
  callback so a panel that closes mid-extraction stops the work (each extraction blocks
  the main thread for ~30 ms, and a roster draws many). This fork's `MutationPortraits.get`
  takes `mutationIds` in that argument slot instead, so the merge kept the fork's
  signature and the cancellation is not wired. Worth porting: widen `get` to
  `(key, mutation, color, wanted, mutationIds, forceMutation)` and thread it through
  `src/hud.ts` and `src/ui/panels/zombies.ts`.
- **`mutationLabelFor(key, mask)`.** Upstream names a mutation by the species wearing it,
  so an Eyebiscus is not called a Carrot. The fork's `mutationLabel(mask, ids)` is used
  instead. This mattered only for the Tier-4 variants riding a shared bit, and they no
  longer do (see below), so it is now cosmetic rather than load-bearing.

## Upstream tests removed with the raid/mutation stacks

These arrived in the merge as clean new files. Every one of them exercises an API that
only upstream's raid or mutation stack provides, and this fork keeps its own — so they
could not compile, let alone pass. They are deleted rather than skipped so the suite
means something. **Restore all twelve if the raid or mutation stack is ever re-ported.**

- src/raid/BattleSim.knockback.test.ts
- src/raid/abilityStack.test.ts
- src/raid/alienStage.test.ts
- src/raid/damageNumbers.test.ts
- src/raid/hazardTaps.test.ts
- src/raid/pirateBossMirror.test.ts
- src/raid/projectileScale.test.ts
- src/raid/pvp.test.ts
- src/zombie/mutationAlmanac.test.ts
- src/zombie/mutationVisibility.test.ts
- src/zombie/specialPortrait.test.ts
- src/raid/BattleSim.feats.test.ts      (upstream's RaidFeats)
- src/raid/BattleSim.formation.test.ts  (upstream's formation model)
- src/quest/reforgedQuests.test.ts       (restorable NOW except for one finding: quest
    20005 names the subject "Rare Invasion Zombie", which nothing in this build posts.)
- src/zombie/ZombieField.fertilize.test.ts (upstream's patch rest-spot on teleportTo)
- src/raid/videoGameStage.ts + .test.ts  (upstream's stage module + test)
- src/raid/alienStage.ts                 (ditto — this fork's RaidScene stages these itself)

## Settled after the merge (commit "Make the test suite describe this build")

- **Tier-4 mutations are IN the catalog now.** Eyebiscus and Heartichoke were listed
  above as "not in this catalog", but the build already shipped their art, their crops
  (levels 44 and 45), their quests, `CROP_MUTATIONS` entries and server migration 0050 —
  only the two `CATALOG` rows were missing. The level-45 capstone crop therefore grew
  nothing at all, and the level-44 one granted Carrot-eyed's Tier-1 bonus. Appended at
  bits 16384/32768, matching upstream, so bits 0-13 and every existing save are
  untouched. `src/zombie/variantMutations.test.ts` is restored with them.
- **Portrait cancellation is wired.** The note above about `wanted` not being threaded
  is stale: `get` takes both `mutationIds` and `wanted`, and hud.ts and the zombies panel
  pass them.
- **`upgradeVariantMutations` now runs on BOTH sides.** It was imported only by
  `server/src/rosterCatalog.ts`; the client's `makeOwned` did not call it. With the
  Tier-4 bits live that would have desynced a raid replay on the first legacy unit.

## Restored later: mutationRedundancy.test.ts

Restored and passing. Two things had to change with it:

- Its `STATS` list is upstream's `str/dex/con`, and this build has `wis`. Leaving wis
  out did not just hide findings, it invented one — Broccohair and Cauli-hair differ
  only in con and wis, so a str/dex/con comparison reported Broccohair as dominating a
  mutation it actually trades with.
- The one real inversion it found is fixed: Onionhead paid a bare +1 life while the
  Tomatohead one rung BELOW it paid +1 life and +1 attack, so the Pot threw the better
  head away. Onionhead now also pays +1 focus.

**Still open, and deliberately outside that test's scope.** `refRank` in mutations.ts
scores every modded string-id mutation above every vanilla bit, so a modded mutation
wins its slot in the Pot no matter what it pays. Under that rule:

- Turnip-head (+2 life) and Corned head beat Pumpking, the level-39 capstone head
- Turnip-eyed (+2 focus) and Oatnyx wreath beat Cauli-hair
- carrot-armed beats Dragon-arm, in both arm slots
- Corned Arm and Celery-arms are stat-for-stat identical, and Corned Arm always wins

Whether that is a bug or the point of the mod is a design call. If it should be fixed,
the shape is an authored ladder position on each modded mutation — an `after: "<vanilla
key>"` anchor read by `refRank` — rather than a stat retune, because the stats are fine
and it is only the ORDER that is wrong. Nothing persists a rank, so changing one is
save-safe.

## Restored later: BattleSim.teamBar.test.ts

Restored, adapted, and passing -- and it found a live bug, not a merge artifact.

Both top-HUD team bars divided a live HP sum by a constant `RaidScene` captured at
construction from the roster `buildPlayerUnits` handed over. That roster's con carries
the FULL team aura, while `refreshTeamAuras` pays the aura only to zombies that have
DEPLOYED, so an army holding a Chivalry, Grace or Fortitude carrier opened every
invasion with a visibly dark bar and not a point of damage taken. The enemy bar had the
mirror problem: walls and summoned minions joined the numerator mid-fight while the
denominator was captured before they existed, pinning it at full for as long as one
stood.

`BattleSim.teamTotals()` now returns both halves of both bars from one pass over the
live units, and the scene reads nothing else. Two adaptations from upstream's version:
the fork models summons through `summonTemplate` rather than a `SummonConfig`, and it
had no `isSummon` flag -- `spawnEnemy` is the single path that conjures a unit
mid-fight, so `SimUnit.isSpawned` is set there and covers minions and walls alike.

Purely a reporting accessor: nothing in the fight reads `isSpawned`, so no transcript
changes and no ruleset bump. Verified against the server's 596 tests, which replay
fights through this same BattleSim.
