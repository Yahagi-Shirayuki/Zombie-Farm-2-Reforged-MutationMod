# Zombie ability binary audit

Source of truth: the ARMv7 `ZF2R` executable, its compiled English
`Localizable.strings`, and the shipped `Attacks.json`. The current TypeScript
combat simulator is not evidence for original-game behavior.

## Recovered behavior

| Tag | Ability | Compiled behavior |
| ---: | --- | --- |
| 18 | +5% All Stats | Self: +5% Damage, Life, and Focus. The attack-speed effect stores `+0.025`, the internal counterpart of the displayed +5% Speed. |
| 19 | +10% Speed | Self: the attack-speed effect stores `+0.05`, the internal counterpart of the displayed +10% Speed. |
| 20 | +10% Damage | Self: +10% Damage. |
| 21 | +10% Life | Self: +10% Life. |
| 22 | Chivalry | Aura for Girl zombies: +10% Damage, +10% Life, and the internal `+0.05` attack-speed effect (+10% displayed Speed). |
| 23 | Grace | The same aura for Regular zombies. |
| 24 | Protect | Aura: 20% damage reduction for Regular, Girl, Large, Small, and Garden zombies. Headless is deliberately absent from the type mask. |
| 25 | Fortitude | Aura: +10% Life for Headless zombies. |
| 29 | Resurrect | Automatic, one-use revival, polled from the holder's own `fightUpdate:` against a corpse BACKLOG. `canRez` walks `fightMan.defeatedZombies` and rejects any whose `state` is 100 — the state `-[ZombieActorSmall suicide:]` sets after zeroing hit points, i.e. **a zombie that blew itself up**, not the mini-zombie. Nothing else in the binary writes state 100. `ressurectZombie:` re-spawns the corpse as a fresh actor at full Life and **marks every `consumable` ability on it consumed**, so it returns spent. See the Resurrect section below. |
| 30 | Mini Buddy | One-use button used before deployment; attaches a mini zombie for the ram behavior. |
| 31 | Bash | Activated button with a 10-second recharge. `ZombieBash` is a 2.75x, 0.75-area attack. |
| 32 | Smash | Activated button with a 10-second recharge. `ZombieBashV2` is a 1.8x, 0.75-area attack with a 1-second stun. |
| 33 | Laser Beam | Automatic laser shots. `laser:` applies 10% of `finalPower`; the base scheduling interval is `finalAttackSpeed / 3`. |
| 34 | Laser Beam Ver.2 | Improved laser path; its scheduling interval is `finalAttackSpeed / 6`. |
| 35 | Explode | One-use activated 10x area attack with a 3-second stun. |
| 36 | Explode Ver.2 | The same 10x area attack and 3-second stun, with `hitBoss: true`. |
| 37 | Turbo Walking Speed | Doubles the zombie's walking-speed value. It does not increase attack speed. |
| 38 | Block | A successful roll completely skips incoming damage. The code uses `(arc4random() % 100) / 100 > 0.9`, so 9 of 100 integer results succeed. |
| 39 | Random Stun | Stuns the target for 1 second. The code uses `> 0.95`, so 4 of 100 integer results succeed. |
| 40 | Double Strike | Selects the `ZombieDoubleStrike` attack. The code uses `> 0.7`, so 29 of 100 integer results succeed; its authored bonus attack has a 0.25 damage multiplier. |
| 41 | Heal | Selects an injured ally and heals it for 50% of the healer's `finalPower`. Target selection includes a below-50%-Life check. |
| 42 | Heal All | Automatic every 20 seconds; heals every injured deployed zombie for 50% of the healer's `finalPower`. |

The proc percentages above are the literal results of the shipped integer-roll
implementation. They are likely intended as rounded 10%, 5%, and 30% chances,
but the tooltips report the executable's actual outcomes.

## Binary anchors

- `ZFActorAbility initBasicDataForTag:` — shipped names, descriptions, and icons.
- `ZFActorFightEffect initWithTag:` — stat deltas, target-type masks, and aura flags.
- `ZFActorFightEffect canApplyToActor:` — actor-type bit assignments.
- `ZFActorActivatedAbility initWithTag:` — selectors, one-use flags, buttons, and cooldowns.
- `ZombieActor modifyStatWithAbilities:` — effect aggregation.
- `ZombieActorRegular fightUpdate:` / `laser:` — laser scheduling and damage.
- `ZombieActorGirl damageIn:` — Random Stun and Double Strike rolls.
- `ZombieActorHeadless damage:` / `initFightDataAfterLoad` — Block and Turbo Walking Speed.
- `ZombieActorGarden heal`, `heal:data:`, `healAOE:`, `canRez`, and `ressurectZombie:` — support abilities.
- `ZombieActorLarge bash:` / `bashV2:` and `ZombieActorSmall explode:` / `explodeV2:` — activated attack selection.
- `ZombieActorSmall suicide:` — `[[self fightData] setHitPoints:0]` then `[self setState:100]`. Only the Small zombie has it, and only Smalls carry Explode: the move is a self-sacrifice.
- `Attacks.json` records `ZombieBash`, `ZombieBashV2`, `ZombieDoubleStrike`, `ZombieExplode`, and `ZombieExplodeV2`.

## Reimplementation status

The recovered effects are implemented in `src/raid/CombatEngine.ts` and
`src/raid/BattleSim.ts`. Chance abilities use a replay-safe permutation of the
same 0–99 integer outcomes, so verified replays remain deterministic while each
100-roll cycle preserves the executable's exact 9, 4, and 29 successful results.
Unit construction applies authentic self buffs, auras, walking-speed metadata,
and damage reduction; the live battle authority additionally performs
the stateful lasers, procs, healing, resurrection, Mini Buddy, and activated
attacks.

## Resurrect (tag 29) in detail

Recovered from `-[ZombieActorGarden fightUpdate:]` (0x7bf39), `canRez` (0x7c745),
`ressurectZombie:` (0x7ce01) and `-[ZombieActor fightUpdate:]` (0x4d406).

- **It is polled, not event-driven.** A dead zombie is appended to
  `ZFFightMan.defeatedZombies` and removed from `zombies`; nothing drains that list
  except a revival, so it accumulates for the whole fight. The Garden zombie checks
  `canRez` from its own update every frame. A holder deployed *after* a casualty
  therefore still brings that casualty back.
- **Resurrect out-ranks Heal.** Both run through one shared cast slot (`setState:33`
  → `35`); at the payoff the code checks `canRez` first (0x7c0a8) and only falls
  through to `canHeal`.
- **The target is the most recent corpse.** `ressurectZombie:` ignores its own
  argument (the call site passes `self`) and takes the LAST element of
  `defeatedZombies`. Note it does *not* re-apply `canRez`'s state-100 filter, so
  shipped ZF2 will in fact revive a suicided Small whenever some other eligible
  corpse exists elsewhere in the list — an original-game inconsistency.
- **The revived zombie returns SPENT.** 0x7d3c2–0x7d436 walks the new actor's
  `abilityList` and sends `setConsumed:YES` to every ability whose `consumable` flag
  is set; `-[ZFActorAbility isUseable]` (0x9cafc) then refuses it. The consumable set
  is exactly tags 29/30/35/36 — Resurrect, Mini Buddy, Explode, Explode Ver.2 (flag
  written in `ZFActorActivatedAbility initWithTag:`). It is unconditional: an ability
  the zombie never used is spent too. This is what stops an exploder from lighting a
  second fuse and two Garden holders from reviving each other forever.
- **Otherwise it comes back whole**: full Life (fresh actor, no `setHitPoints:` call),
  carrying over `fights`, mutation flags, colour and scale, re-entering off-screen at
  x = -100 to walk back in, and bumping `fightMan.zombieCount`.
- The caster's own tag 29 gets `setConsumed:YES` / `setActive:NO` — one revive per
  Garden zombie per fight.

DELIBERATE DIVERGENCE (ruleset 21, retained): `canRez`'s state-100 rejection is not
carried over. A zombie that blows itself up is a normal casualty here, so a Garden
holder's Resurrect can bring it back. Given the `ressurectZombie:` inconsistency
above, shipped ZF2 does this too whenever another corpse is queued — the divergence is
narrower than it first appears.

Everything else in this section is implemented faithfully as of ruleset 26
(`BattleSim.stepResurrect` / `resurrect`); the earlier ruleset-21 re-arm, which handed
a revived exploder its fuse back, has been removed along with `SimUnit.abilityRearms`.
