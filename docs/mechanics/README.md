# Recovered mechanics

Behaviour recovered from the shipped Zombie Farm 2 iOS binary (ARMv7 Mach-O), with the
derivation kept alongside the conclusion. Per [CONTRIBUTING](../../CONTRIBUTING.md), the
numbers in here **beat intuition**: if you think one is wrong, bring evidence to an issue
rather than quietly changing it.

Disassembly used `ZF2R_extracted/tools/re/objc_disasm.py` — the external extraction tree,
not this repo's `tools/` (which generates assets). You do not need it to read these.

| Doc | Covers |
|---|---|
| [COMBAT_STATS_RECOVERED.md](COMBAT_STATS_RECOVERED.md) | How `str`/`dex`/`con` become HP, damage and attack cadence; veterancy; per-group level scaling; loot tiering. The root document — most others build on it. |
| [ENEMY_DAMAGE_RECOVERED.md](ENEMY_DAMAGE_RECOVERED.md) | The enemy attack cycle (exactly `1/dex`), speed bands, and the farm-raid ramp. |
| [ZOMBIE_FORMATION_RECOVERED.md](ZOMBIE_FORMATION_RECOVERED.md) | Why the army's *order* is the formation: depth/damage/cadence bands, attack positions, knockback. |
| [ZOMBIE_ABILITIES_BINARY_AUDIT.md](ZOMBIE_ABILITIES_BINARY_AUDIT.md) | The ability tag table, one-use semantics, Resurrect's corpse backlog, and the beam-down pillar. |
| [RAID_TIMING_AND_HAZARDS.md](RAID_TIMING_AND_HAZARDS.md) | Round length, walls, the Beach crab and Circus trapeze, and which hazards the server does *not* simulate. |
| [ALIEN_RAID_RECOVERED.md](ALIEN_RAID_RECOVERED.md) | Raid 6 end to end — the only swarm in the game. Laser targeting, the UFO, the actor state machine, abducted-human summons. |
| [QUEST_ITEM_REWARDS.md](QUEST_ITEM_REWARDS.md) | `rewardType: 3` — where a quest's item lands, and which of the eight actually deliver. |

Not recovered mechanics, but frequently wanted next to them: Epic Boss combat and rewards
are in [../EPIC_BOSS_MECHANICS.md](../EPIC_BOSS_MECHANICS.md), and the raid ruleset version
history — the authoritative record of every change to the deterministic transcript — is the
comment block above `RAID_RULESET_VERSION` in `src/raid/replay.ts`.

## Writing one of these

Two halves, and keeping them apart is what stops these documents rotting:

**The permanent half** — what the binary does, with addresses, selector names and the
constants. This does not go out of date, because the shipped 2011 binary does not change.
Write as much of it as you can.

**The perishable half** — what this reimplementation did about it. Anchor every one of these
to a **symbol or a test name**, never to a bare status word. `ALIEN_MAX_ACTIVE` in
`src/raid/alienStage.ts` breaks visibly when someone moves it; "REAL BUG" and "Fixed:" rot
silently, and a reader a month later cannot tell which is which.

That is not hypothetical. `ALIEN_RAID_RECOVERED.md` §7 shipped five "REAL BUG" headings,
all five were fixed in raid ruleset 27, and the document went on reading as an open bug
report — pointing at a `BattleSim.MAX_ACTIVE_ENEMIES` constant that no longer existed. It
took a full audit to notice. A symbol reference would have been caught by anyone who
grepped for it.

**Deliberate divergences** get recorded where a regeneration cannot silently undo them:
gameplay overrides in `tools/prep_raids.py` `UNIT_OVERRIDES`, and anything that changes the
deterministic transcript in the `RAID_RULESET_VERSION` history. Note them here too, but the
code is the source of truth for what actually ships.
