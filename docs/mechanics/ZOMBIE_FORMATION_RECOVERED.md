# Zombie ordering, attack positions and knockback — recovered from the binary

Source of truth: the ARMv7 `ZF2R` executable. Disassembly via `ZF2R_extracted/tools/re/`
(`objc_disasm.py`, plus `disas2.py` for the PC-relative literals the base tool misses).

The headline: **the army's ORDER is the formation.** There is no layout pass. A zombie's
index in `[fightMan zombies]` decides its depth band, its damage band, its cadence band, its
deploy priority and its draw order, all from the same number.

---

## 1. The array

`[ZFFightMan zombies]` is built by `-[ZFFightMan setZombieYOrder:]` (0x58240) at
`initialSpawn`, which buckets the roster by concrete `ZombieActor` subclass. Three things
mutate it afterwards, all inside `-[ZFFightMan reorderZombies]` (0x5b554) and
`-[Actor setZombieToLastIndex]` (0x37ce8):

* **Headless promotion.** `reorderZombies` first checks whether any of the **front five**
  (`indexOfObject: <= 4`) is a `ZombieActorHeadless` that `isInMeleeRange`. Only if none is
  does it scan the whole array for the **last** engaged Headless and
  `insertObject:atIndex:0`. It is a repair, not a standing sort — a Headless already up front
  stays where it is, and a second one is never pulled forward.
* **Garden push-back.** Every deployed `ZombieActorGarden` gets `setZombieToLastIndex`.
* **`setZombieToLastIndex` is not "append".** It removes the zombie, then walks the array and
  re-inserts it at the index of the **first zombie in state 6, 7 or 8** — the back group. So
  it lands at the tail of the *deployed* block and stays ahead of everyone yet to deploy.

`-[ZFFightMan deploy:]` (0x5e4b4) takes the **first** zombie in state 6, sets state 7 and
walks it to `x = 100`. Deployment is array order, front first.

### States pinned in this pass

| State | Meaning |
| ---: | --- |
| 6 / 7 / 8 | the back group — milling (`fightWanderIn:`), stepped out, focusing |
| 9 | dying (the alien boss drops its saucer here) |
| 10 | knocked back / recovering — what `knockBackBy:force:` sets |
| 11 / 12 / 13 | fighting — `-[Actor actorIsFighting]` (0x3e2b8) is exactly `state ∈ {11,12,13}` |
| 17 | walking in at the start (`zombiesEnterScene`) |
| 31 / 32 | mid special attack (also the two states exempt from the depth penalty) |
| 34 | set on everything `isInMeleeRange` at the end of `reorderZombies` |
| 35 | walking to its destination |
| 100 | suicided (`ZombieActorSmall suicide:`) |

`-[ZombieActor isInMeleeRange]` (0x4f538) is
`actorIsFighting || (position == destinationPoint && knockBackPoint == CGPointZero && state ∈ S)`,
where S was decoded out of the method's `tbb` jump table: **10–27, 29, 30, 34, 44–46, 48**
(and NOT 6–9, 28, 31–33, 35–43, 47, 49).

## 2. Where a zombie stands to attack

`-[ZombieActor calculateDestinationPoint]` (0x4c9d4), in the source's 480×320 points:

```
band  = indexOfObject(self) / 5
row   = the band's members that are isInMeleeRange or in state 34/9/10/15/35/33,
        ordered by body-type bucket
slot  = my rank in row,  n = row.count

x = zombieAttackPosition.x - 55 - 35*band - standoff(body) + 5*(n - 1 - slot)
y = 4*slot - 2*n + 10
zOrder = (total/5) * (5 - slot) + (4 - band)
```

* `zombieAttackPosition` defaults to **(435, 20)** and no shipped raid overrides it, so the
  front row plants at x=380 with the enemy at 435 — a 55-point melee gap.
* **Body-type row order** (front-most first), from the nested prefix counters the bucketed
  insertion uses: `Small` (and Cupid Gardens) → `Headless` → `Girl` → `Regular` → `Large` →
  `Garden`.
* **Standoff**, subtracted from x — a heavy body plants further off, a light one steps in
  past the line: `Large 15, Garden 15, Regular 8, Girl 4, Headless −5, Small −15`, others 0.
* Gardens get a further **−120** on x, applied by `reorderZombies` after the destination is
  computed. That is the support line, and it is measured off the front row rather than being
  half-way back to the staging slot.
* The band divisor is **5** — the same one `damageIn:` and `getFightAttackSpeed` use for the
  damage and cadence falloff. The layout and the punishment are the same grouping.
* cocos2d y grows UP, so slot 0 (the lightest body) takes the smallest y: nearest the camera,
  and the explicit zOrder draws it in front.

**Reimpl status:** implemented in `BattleSim.armyOrder` / `assignFormation`. Two deviations,
both flagged in the code:

* `ROW_SPREAD` (currently **2**) widens the recovered 4-point row step. Five zombies inside a
  16-point ribbon is correct — it is why the source ships an explicit zOrder instead of
  sorting on y — but our sprites are drawn much larger relative to the field. Set it to 1 for
  the source's exact spacing; the balance below was fitted at 2.
* The in-row x depth is scaled by `rowXFit`. The source's row spans ~90 of its own points and
  its enemies reach that far; `ENGAGE` here is 60 field units where the source's melee gap is
  55 source points, i.e. combat distances live at ~1:1 while the lane lives at ~1:2. The
  ORDER is untouched; only the absolute gaps compress, so the whole row stays in contact.

## 3. Knockback

`-[Actor damageIn:]` (0x3777a), gated on `[fightData canInterrupt] && !invincible`:

```objc
[victim knockBackBy: -(50 + arc4random() % 100) force: 5.0]
```

`-[Actor knockBackBy:force:]` (0x37e68), for a `ZombieActor` only:

1. `setZombieToLastIndex` — tail of the deployed block, so a deeper band.
2. `startAnim: 1 interrupt: 1`.
3. `unschedule damageIn: / fightAttack: / attackSFXIn:` — **the swing in flight is cancelled**,
   it does not resume on landing.
4. If it was in melee: nudge x by −1 (breaking the `position == destination` equality) and set
   state 10 (or, from state 15, play anim 13 instead).
5. `reorderZombies`, and the `ZombieActor` override (0x4c96c) recomputes `destinationPoint`
   from the NEW index.

Then, for every actor: `fightData.knockBackPoint = (x + distance, y)` — purely horizontal —
and `fightData.knockBackSpeed = force`.

`-[Actor movementUpdate:]` (0x3e9e0) does the travel: while `knockBackPoint != CGPointZero` it
moves `normalize(point - position) * (dt * 60 * speed)` toward it, snapping and clearing the
point on arrival, and **returns before the normal walk**. So the shove is a slide of
0.17–0.5 s (50–149 points at 300 points/second), during which the zombie does not walk, does
not attack, and — because `isInMeleeRange` tests `knockBackPoint == CGPointZero` — is not in
anybody's melee set.

### The `canInterrupt` gate — super armour

`damageIn:` refuses **both** the stun and the shove while `[fightData canInterrupt]` is NO,
and that flag is per-ATTACK, not per-actor:

* `-[Actor fightAttack:]` (0x36d28) reads `cantInterrupt` off the attack variation rolled for
  this swing and writes `fightData.canInterrupt = !cantInterrupt`.
* `-[Actor doneAttacking:]` (0x37cd8) puts it back to YES when the swing ends.
* `-[Actor setInterrupt:]` and `-[CivilianActorFight civilianUpdate]` are the only other
  writers. (Found with `tools/re/callers.py`, which walks selref materialisation — a plain
  address xref misses ObjC property setters entirely.)

`Attacks.json` carries `cantInterrupt` on **exactly four** attacks: `ZombieBash`,
`ZombieBashV2`, `ZombieExplode`, `ZombieExplodeV2` — precisely this sim's wind-up moves. So
it is super armour on the activated big hits and nothing else: commit to a Smash or light a
fuse and no enemy shoves you out of it. It is almost certainly also why the depth-damage
penalty exempts states 31/32 (`COMBAT_STATS_RECOVERED.md`) — the same two moves.

**Reimpl status:** implemented (`knockBackZombie` / `stepKnockBack` / `uninterruptible`, and
`cantInterrupt` on the four `ACTIVATED_ABILITY` entries). The shove distance is converted in
MELEE GAPS rather than raw points, for the scale reason in §2.

## 4. Not changed, and why

* **`ENGAGE` (60 field units).** The source has no reach parameter; an enemy attacks whatever
  is `isInMeleeRange`. Raising it to the recovered 55-source-point melee gap would let the row
  spread at full scale, at the cost of re-balancing every raid.
* **`COMBAT_ZONE_DEPTH`.** Held at exactly the `4*52 + 12` it has always been. The source has
  no such band either, so there is nothing to move it to, and the elite-balance guardrails sit
  close enough to their thresholds that even a 5% change here tips one.
* **`ELITE_PROFILES[9]`.** Untouched on purpose. Faithful knockback makes the Video Games
  invasion materially harder — measuring-stick difficulty **1.99 → 2.38 ordinary** — because
  it is the raid built out of knockback enemies. Flattening raid 9's own profile was tried
  across its whole range and never bought back winnability: the problem was that the balance
  suite's stick, at 20×2.2, was already consumed by the ORDINARY fight, so it was measuring
  its own ceiling rather than the tuning.
## 5. Balance re-fit that came with it

The ladder's top rung moved, so the three profiles pinned to it moved with it — `x1.3` on
each multiplier's distance from 1.0, shape untouched:

| Raid | Why it is pinned to Video Games | elite before → after |
| --- | --- | ---: |
| 3 Pirates | "Pirates on a ticket ≈ an ordinary Video Games" | 1.35 → 1.62 |
| 5 Robots | shares the top band with Video Games-elite | 1.78 → 2.18 |
| 6 Aliens | shares the top band with Video Games-elite | 1.87 → 2.23 |

`eliteInvasion.balance.test.ts`'s `MAXED_STICK` also moves 2.2 → 3.0, for the reason above.
Nothing else in the table changed, and every guardrail in that suite is green.

## 6. Still not changed, and why

* **`getThrowTarget`'s state-10 priority** (see `ALIEN_RAID_RECOVERED.md` §1). Still unfixed.
* **`frontPriority`** is now vestigial for layout — still written and snapshotted, no longer
  read by the formation.
