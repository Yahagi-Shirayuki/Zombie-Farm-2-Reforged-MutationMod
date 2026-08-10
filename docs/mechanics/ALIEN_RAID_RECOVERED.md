# Zombies vs Aliens (raid 6) — recovered from the binary

Source of truth: the ARMv7 `ZF2R` executable (`ZF2R_extracted/app-internals/executable/ZF2R`),
`AlienStage.plist` / `AlienStageElements.plist`, `alienLaser.plist`, and `UnitStats.json`.
Disassembly via `ZF2R_extracted/tools/re/objc_disasm.py`; the annotated variants used here
(`disas2.py` for PC-relative NSString/float literals, `findsel.py`, `xref.py`) were added
alongside it in the same pass.

Everything below is transcribed from compiled code. Where the reimplementation disagreed,
the delta is called out.

---

## 1. The laser targets the FRONT LINE, not the healers

**`-[ZFFightMan shootBullet:from:]` (0x5ea74)** builds a fresh candidate array by walking
`self.zombies` and keeping each one that is either

* `isInMeleeRange` — and `-[ZombieActor isInMeleeRange]` (0x4f538) is
  `actorIsFighting || (position == destination && knockBackPoint == 0 && state ∈ <tbb set>)`,
  where **`-[Actor actorIsFighting]` (0x3e2b8) is exactly `state ∈ {11, 12, 13}`**; or
* `state ∈ {10, 31, 32}` — 31/32 being the two states `damageIn:` also exempts from the
  lineup-depth penalty (see `COMBAT_STATS_RECOVERED.md`), i.e. mid special attack.

It then picks **one at random**:

```
idx = (arc4random() % 100) / 100.0f * [candidates count]
[bullet shootBulletAt:[candidates[idx] position] from:bulletPos]
```

An **empty candidate list means no bullet at all** — and `-[ZFFightMan
allowedToShootBullet]` (0x5e918) applies the same predicate as a gate before the action is
even chosen, on top of requiring both boss-action timers to be ≤ 0.

So the saucer is a front-line weapon: it burns whoever is toe-to-toe with the wave, and it
holds fire entirely while the army is still walking up.

**This is the opposite of the boss THROW.** `-[ZFFightPhysics getThrowTarget]` (0x6c970)
walks the same array but keeps the **last** zombie passing
`isZombieAllowedToThrowAt:` (states 10, 12, 13, 28, 33, 35) — the deepest one — which is why
`BattleSim.throwTarget()` picks the rear-most deployed unit. Using that selector for the
laser was the bug: every alien bolt landed on the Garden healers massed at the support line.

> **Open item, not fixed here.** `getThrowTarget` has a *higher* priority branch than the
> rear-most walk: the first zombie in `zombies` order whose `state == 10` short-circuits the
> loop and wins outright (state 35 is a weaker second preference). Since index 0 is the
> front-most slot (the `index / 5` depth band), that means throws should often land on the
> FRONT-most zombie in that state rather than the back line. Left alone deliberately — it
> changes every throwing raid's balance, and the alien boss has no `throw` at all.

**Fixed:** `BattleSim.laserTarget()`, and an `alienLaser` case in `canPerform`.

## 2. Bolt physics

| Quantity | Ground truth | Where |
| --- | --- | --- |
| Damage | flat **200.0f**, only if `target.fightData.hitPoints > 0` | `-[AlienStageBullet collidedWith:]` 0x6aee4 |
| Speed | `setSpeed: 3.0`, integrated as `pos += unit * (dt * 60 * speed)` = **180 pt/s** | `-[AlienStageBullet init]` 0x6ac5c, `-[ZFBulletWrapper bulletTime:]` 0x6aa50 |
| Aim | `[target position]` read ONCE at fire time, normalized — **no lead, no homing, no gravity** | `-[ZFBulletWrapper shootBulletAt:from:]` 0x6a9d4 |
| Muzzle | 50/50 roll between `(-55, +2)` and `(+5, -5)` off the boss | `-[AlienStageActor createBullet]` 0xc7370 |
| Fire cue | `alienLaser.wav` | `AlienStageBullet init` |
| Hit cue | `stun.wav` + `alienLaserHit.plist` burst | `collidedWith:` |

The raid stage is authored at **480×320 points**; `BattleSim`'s field is 1000×560, so
`SIM_PER_SOURCE_X = 1000/480` converts both the speed (180 → 375 sim px/s) and the muzzle
offsets. Cocos is y-up, so muzzle y is negated.

**Fixed:** `LASER_SPEED` was a guessed 900 (2.4× too fast); the bolt was led like a lob; it
launched from the bare boss origin; and it had no sprite key, so it rendered as the generic
orange "no art" hazard dot. Bolt art (`raids/images/alienLaser.png`) is the emitter baked
into one sprite: 5 additive `ring01FX` quads, 32 px, fading red `(1,0,0)` → yellow `(1,1,0)`
over a 0.2 s lifespan.

## 3. The boss rides a UFO — and he is SMALL inside it

`-[AlienStageActorBoss initSprite]` (0xc68b8):

* attaches the six paper-doll parts (`bossArmF/ArmB/FootF/FootB/Body/Face` in attachment
  slots 2/3/4/7/0/1), with `bossBody` as the root bone;
* loads `bossShip.png` and `bossShipBack.png` from **AlienStageElements.png** into
  `bossShipFront` / `bossShipBack`;
* ends with **`[rigRoot setScale: 0.58]`** (`0x3f147ae1`).

The **ship halves are not scaled by that 0.58** — only the rig root is. So the composed boss
is exactly the saucer's 140×128 art box, with a 96.8 px pilot sitting inside the canopy.

`-[AlienStageActorBoss movementUpdate:]` (0xc6e20) keeps both halves at
`actor.position + rigScale * body.position`, and `bossUpdate:` (0xc6bb8) attaches the front
half at `zOrder + 1` and the back half at `zOrder - 1` on state 19, then removes **both** on
state 9 (death) — the saucer does not outlive its pilot.

Authored anchors (cocos, y from the bottom): `bossShip` `(0.53, 0.25)`, `bossShipBack`
`(0.56, −0.75)`. `bossBody`'s rig offset is `(0, 3)`, so the ship anchor sits 1.7 px above
the boss's feet.

**Fixed:** `RaidScene`'s UFO block was explicitly eyeballed — it fitted the *pilot* to
`BOSS_H` (195) and drew the saucer at 156, i.e. the alien was ~32 % too big and the canopy
~20 % too small, so his head burst out beside the dome. It now fits the **saucer** to
`BOSS_H` and places the pilot at the authored 0.58 with the rig's own art-box offsets.

### Idle hover

`-[AlienStageActor startAnim:interrupt:]` (0xc76ac), anim state 0, for an
`AlienStageActorBoss` with a ship: a looping `CCSequence` of two 0.5 s `CCMoveTo`s on the
**body** attachment, to `(0, −10)` then `(0, +10)`. Because `movementUpdate:` drags the ship
halves along, pilot and saucer bob together. Reproduced as a triangle wave (linear
`CCMoveTo`, not an eased sine) on the whole boss token.

Anim state 2 (walk) runs `bodyWalkMove` / `footWalkFront|BackMove` / `footWalkFrontRotate`
for **both** boss and minion, so the alien does walk on legs with the saucer following.

## 4. Minions do NOT get ships

`AlienStageElements.png` also contains `minionShip.png`, `minionShipBack.png` and
`drone.png`, which is what makes the atlas look like a squadron. **None of the three is
referenced anywhere in the binary** — no `__cfstring`, no `__cstring`, no selector
(`AlienStageElements` cfstrings are only `bossShip.png` / `bossShipBack.png`). They are
unused art. `-[AlienStageActorMinion initSprite]` (0xc70e0) attaches only the eight
paper-doll parts and `setScale: 0.58`.

Don't "restore" them.

## 5. Boss actions

`UnitStats.json`:

```
AlienStageActorBoss   con 250  dex 5  str 7   standardBossLoot
  bossActions: summonBoss (frequency 50, castTime 2)
               alienLaser (frequency 30, cooldownTime 2)
  attacks:     CrazedWorkerAttack (100)
AlienStageActorMinion con  60  dex 1  str 6   standardGoldLoot
```

No `throw` entry — the alien boss never lobs debris, so its whole ranged game is the laser.
`Enemies.json` gives the wave `population: 20` of `AlienStageActorMinion` at 100 %.

Every stage boss (not just this one) gets exactly one `ZFActorFightEffect initWithTag: 11`
in `initActorSpecificAbilities`, so tag 11 is a generic boss effect, not an alien trait.

## 6. Not changed

* `SUMMON_CAP = 3` in `BattleSim` is still a reimpl invention. The source draws from a
  `bossSummonList` populated at load and pops one entry per `summonBoss:`; the cap was not
  pinned in this pass.
* `AlienStageActorMinion colorFromSubType:` (0xc70c4) is a 3-byte `memcpy` out of a table —
  minions carry a per-subtype tint that the reimpl does not apply. Not pinned.
