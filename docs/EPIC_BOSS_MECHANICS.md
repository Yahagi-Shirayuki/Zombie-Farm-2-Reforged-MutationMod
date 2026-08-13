# Epic Boss Mechanics

## Implemented coverage

Market → Epic Boss offers all eight recovered bosses. Starting one creates a 14-day
wall-clock run; only one boss event can be active at a time. A run can be purchased again
after its final level is completed or the event expires, and purchasing never extends an
active run.

Costs and unlocks (post-"brainflation revert"; server-enforced in `v3/epicBoss.ts`):
Dr. Groundhog costs **5 brains**, the other seven cost **10 brains**. Each event has its
own unlock level, ordered by how strong its prize zombies are, because the eight are not
interchangeable — Loco Locust pays the strongest zombie in the game and Dr. Groundhog one
that deals a quarter of its damage:

| Level | Boss | Best prize | DPS | HP |
|---|---|---|---:|---:|
| 24 | Dr. Groundhog | Omega Dr. Zombie | 307 | 4,043 |
| 28 | Bully Frog | Admiral Zombie | 336 | 4,253 |
| 30 | Rocky Rhino | Brock Coley | 662 | 735 |
| 32 | General Larvaelus | Zombug | 579 | 1,575 |
| 34 | Mystical Mamba | Zomtar | 662 | 1,575 |
| 38 | Foul Owl | Scrooge Zombie | 573 | 4,410 |
| 40 | Skunkarella | Madame Zombie | 991 | 2,200 |
| 42 | Loco Locust | Vagabond Zombie | 1,102 | 2,835 |

(HP as the fight sees it: `con x 100` with the unit's own ability buffs, unmutated.)

Rocky Rhino and Foul Owl are swapped against a strict DPS sort deliberately: Brock Coley
is a 40-str/735-HP glass cannon, while Scrooge is the highest-HP zombie in the game and is
worth holding back. A locked activation returns `403 locked` with the required level, and
the Market card renders "Available at player level N".

**Every boss runs 20 levels.** That is exactly as many HP multipliers as ZF2 authored
(`EpicBossHP.json` LevelMultiplier). Seven bosses used to advertise 40, but levels 21-40
were the level-20 multiplier repeated — 20 more fights at an unchanging 107x, grind rather
than difficulty. Truncating to 20 leaves levels 1-20 untouched, so the top of every ladder
is the same 214,000-HP fight it always was. Loot and quest thresholds were halved (rounded
up: 5->3, 10->5, 15->8, 20->10, 25->13, 30->15, 35->18, 40->20) so each prize sits at the
same fraction of its ladder. Maximum HP is `round(2000 * LevelMultiplier[level - 1])`.
Runs that were mid-flight above level 20 across the change are clamped down to it —
migration `0046`, plus read-time clamps in `v3/epicBoss.ts` and `EpicBossManager.normalize`
— so their next win registers as the level-20 win that grants the top prize. Each fight has a hard
30-second escape deadline. Zombies use manual brain-bubble release without butterfly
distractions or consuming Concentration. The normal army cap and permanent invasion
casualty rules apply, and Epic Boss attack order is stored separately.

### Boss damage ramps by event

Every boss originally dealt exactly **40 DPS** — `str 2 / dex 2`, or Skunkarella's
`str 1 / dex 4` (the same rate in faster, smaller hits) — at every level of every ladder.
Only HP scaled. That made all eight events identical in threat and different only in how
many attempts they took.

HP is the wrong difficulty knob here. A fight is capped at 30 s and damage carries over
between attempts, so **more HP buys only more attempts**, and every attempt costs a Boss
Token or a brain. That is grind. Incoming damage is the one lever that raises the bar
without adding an attempt, so attack power now ramps with the event's unlock level:

| Boss | Unlock | Dmg × | `str` | `dex` | Boss DPS | Dmg per full 30 s fight | Front-liners that survive |
|---|---:|---:|---:|---:|---:|---:|---:|
| Dr. Groundhog | 24 | 1.00 | 2.00 | 2 | 40 | 1,200 | 28 / 30 |
| Bully Frog | 28 | 1.20 | 2.40 | 2 | 48 | 1,440 | 26 / 30 |
| Rocky Rhino | 30 | 1.40 | 2.80 | 2 | 56 | 1,680 | 26 / 30 |
| General Larvaelus | 32 | 1.60 | 3.20 | 2 | 64 | 1,920 | 23 / 30 |
| Mystical Mamba | 34 | 1.80 | 3.60 | 2 | 72 | 2,160 | 21 / 30 |
| Foul Owl | 38 | 2.00 | 4.00 | 2 | 80 | 2,400 | 21 / 30 |
| Skunkarella | 40 | 2.25 | 2.25 | 4 | 90 | 2,700 | 18 / 30 |
| Loco Locust | 42 | 2.50 | 5.00 | 2 | 100 | 3,000 | 15 / 30 |

`dex` is never touched — it is each boss's hit rhythm, and Skunkarella's fast small hits
are its signature. Note its ramp scales from a `str 1` base, not 2; scaling it like the
others would silently double its damage.

**The ramp was measured in BattleSim with the fight played correctly** (brain bubbles
released), not modelled — `epicBoss/combat.test.ts` pins the calibration. Two properties of
the epic fight break any closed-form estimate:

- **Only a fraction of the army is engaged at once** (about 6 of 20), however deep the
  line. A 20-strong army does not bring 20 zombies' worth of damage, and incoming damage
  concentrates on the front slot instead of spreading across the line.
- **A level takes many full-length attempts.** With damage carrying over, most attempts
  run the whole 30 s, so a boss that can kill the front unit kills one **per attempt** —
  and casualties are permanent. A full clear is 40+ attempts, so there is no such thing as
  a small per-fight casualty rate.

The ramp is therefore read as *which zombies can hold the front slot*, and the cap is
**×2.5** on purpose: at ×3 the top boss's own top prize (Vagabond Zombie, 2835 HP) can no
longer tank its own event, which is perverse. At ×2.5 every event's signature prize stays a
legal front-liner, the Market-bought Headless wall (Bombie, 3267 HP) answers the whole
ladder, and the thin damage-dealers (Zomtar and Zombug 1575, Zomdini 1260) stop being able
to hold the line from General Larvaelus onward. A test asserts ×3 *would* kill Vagabond, so
raising the ramp fails loudly rather than silently.

Two consequences worth knowing. The ramp gives the Headless family a job for the first
time: Bombie/Skull Head/Diver are near-worthless on damage (55 DPS) but hold the front slot
against every boss on the ladder, and Protect (−20% per carrier) stacks on top. And lineup
ORDER becomes a real decision rather than cosmetic — leading with your best damage dealer
now costs you that zombie.

Deploying a ramp change mid-event is safe: each fight pins its boss stats into the
session's `config_json` at start and the finish handler replays from that pinned config, so
an in-flight fight keeps the numbers it began with.

Every attempt costs either one Boss Token or 1 brain (`EPIC_BOSS_FIGHT_BRAIN_COST`, reduced
from 10 by the brainflation revert); there is no retry timer. While
an event is active, harvesting a vegetable crop can yield a Boss Token. The chance uses
the recovered 35% starter-loot rate as a per-harvest ceiling, so no crop is ever a
guaranteed token.

Per-harvest chance is a hump in grow time (peaking around 2-4 hours before the ceiling
takes over) times a weak harvest-value term, **plus a flat 3-point bonus** so no crop
is ever a dead roll — the bare curve left a 15-minute crop near 0.4%, which reads as
"never" to a player pulling carrots. Everything from 8 hours up sits at or near the
ceiling, and the 24-hour band is pinned to it, so harvest value stops separating those
crops.

Read supply in tokens per **plot-day**, not per harvest, because a plot is recycled: a
15-minute crop harvests 96 times a day and a 24-hour crop once. That makes the flat
bonus very unevenly levered — three points is worth +2.88 tokens per plot-day on a
15-minute crop and +0.18 on a 4-hour one. **Short crops are therefore the most
efficient token farm**, roughly: 15m 3.3, 30m 2.1, 1h 1.5, 2h 1.2, 4h 1.15, 6h 1.07,
12h 0.70, 24h 0.35 per plot-day. This is a deliberate trade — the flat bonus buys
per-harvest feel at the cost of the grow-time ladder, and shrinking `FLAT_BONUS` in
`src/epicBoss/tokens.ts` restores a 2-4 hour peak.

(The original rule was `0.35 * sqrt(time * value)`, which was *documented* as favouring
long crops but per plot-hour did the opposite, at a much lower overall supply.)

The roll is the **client's**, in both online and offline play, and it happens the moment
the crop is harvested — the token portrait rises out of that plot in the same frame. The
Worker used to roll it authoritatively during command replay, which meant the token
surfaced a batch window later over a plot the player had usually already replanted. It
now only records what the client reports (`epicBoss.token`, pinned to the running
`runId`), and does not re-check the roll. An edited client can therefore mint Boss
Tokens. That is an accepted trade: a token buys one attempt, the drop is common, and the
alternative price is a single brain.

Tokens can be
hoarded during the run, but expire when that boss event ends. Damage survives an escape.
If two hours elapse from the first attempt at the current level, that level returns to
full HP. Winning advances immediately to the next full-health level. A fight begun
before an event or encounter boundary may finish normally.

The farm Boss shortcut appears only for an active run. The Market card shows the event
and encounter timers, token stockpile, level/HP, rewards, activation, and Fight state.

## Rewards

Gold follows `max(1, round(level / 4)) * 100` per cleared level, scaling from 100 gold at the
early levels to 500 gold at level 20. This curve is deliberately **unchanged** by the
brainflation revert, and unchanged by the 20-rung cut — the per-fight rate is the same, there
are simply no padding rungs above 20 left to farm.

Brains are on a separate, sparse schedule (a single brain is now ~10x more valuable, so runs
hand them out at milestones instead of every level):

- +1 brain on every 5th level cleared (5, 10, 15, 20).
- +1 **bonus** brain on the boss's final level, so a full clear pays 5 brains — the same for
  every event now that every ladder is 20 rungs. (`maxLevel` still parameterises the bonus,
  so a future longer event would pay it at its own top.)
- Non-milestone levels award **no** brains at all.

So a cleared level yields 0, 1, or at most 2 brains — not the old `round(level / 4)` ramp to 10.
Both are in addition to the existing loot roll and quest rewards.

Each boss uses its own recovered quest milestones, decor pool, and tame pet. Groundhog's
chain grants Dr. Zombie (5), an Invasion Voucher (10), one brain (15), and Golden Dice
plus Omega Dr. Zombie (20); the other events run their recovered chains on the halved
thresholds. Loco Locust grants Bandido Zombie (3) and Vagabond Zombie (20), Bully Frog
grants Captain Zombie (3) and Admiral Zombie (20), Foul Owl grants Christmas Ghost Zombie
(3) and Scrooge Zombie (20), and Skunkarella's four-card quest grants Diva Zombie.

Admiral Zombie is a **rebalance, not recovered data** (`tools/reforge_economy.py`
SPECIAL_STAT_REBALANCE): it shipped as a strictly worse Captain Zombie — same 21 str and
38.5 con, but dex 2 against the Captain's 2.65 — so Bully Frog was the one ladder whose top
prize was a downgrade on the prize you got at the bottom of it. It is now dex 2.9 / con 40.5,
edging the Captain on both axes. These
nine named zombies are reward-only catalog units: they never appear as purchasable
zombie crops and cannot be consumed or cloned through the Zombie Pot. A reward joins
the farm when an army slot is open; otherwise it is filed in **Received**, where it
waits until the player claims it into a free Mausoleum slot. A full farm can never
destroy an earned unit — but it no longer overflows the Mausoleum either, so claiming
one may mean selling or deploying something first.
Until exact binary loot selection is recovered, each victory makes one 35% roll,
preferring unlocked uncollected drops. Within that pool the pick is **weighted by the
rung that unlocks each prize** (`epicLootWeight` = `1/level`, fed to the binary's
cumulative frequency pick), so the ladder is a rarity ladder: the first prize lands far more
often than the top-rung signature item. It was a uniform
pick, which made the last prize exactly as likely as the first — climbing bought
no better odds on what climbing unlocks. Monotone-in-level is all this claims; the curve
itself is a reimplementation choice, not recovered data.

"Collected" spans every place a prize can sit — unclaimed, in the shed, or already placed
on the farm. Reading only the unclaimed bucket made a claimed prize look never-won, so
owned decor kept crowding out prizes the player had never seen. Decor duplicates become
possible only after eligible decor is genuinely collected, and a pet leaves its boss's
pool once owned. Ambiguous source `reward: 5000` and `xp: 5500` fields are not granted.

Epic quest progress is lifetime progress: only the active boss's recovered quest family
is surfaced, and it is hidden between events without being discarded. Earned rewards
and completed quests are permanent. Bosses whose shipped quest data is missing still
retain combat, loot, pet, and completion progression.

## Authority and persistence

Offline state is optional in the versioned save, so older saves default to no event.
Online play stores the current run and one-use fight sessions in D1. Activation spends
brains atomically. Start pins level, HP, roster, combat configuration, and server time;
finish deterministically replays the input transcript and applies casualties, damage,
loot, quests, roster rewards, inventory, pet ownership, and balance once. An unfinished
session can be reopened with its pinned attack order until its short expiry; expiration
resolves it as an escape and unlocks the roster. Raid and Epic Boss sessions exclude
each other.

## Asset provenance and future work

`tools/prep_all_epic_bosses.py` generates eight namespaced catalogs from the source
gameplay files and extracted app bundle. The first five bosses use their authored
enter/idle/attack/defeat/escape/fly strips. EPB 8-10 use static revealed art because
their frame metadata was not present; their full source sheets are retained for future
reconstruction. `tools/prep_placeables.py` exposes 50 boss decorations as reward-only
farm objects, and `tools/prep_quests.py` recovers Bully Frog's three unambiguous embedded
quest records.

The remaining fidelity gaps are the missing EPB 8-10 animation/gameplay metadata and
corrupt or absent late quest data. See
`docs/EPIC_BOSS_ASSET_AUDIT.md` for the exact actor, UI, reward, pet, effect, and audio
mappings and the metadata that is genuinely still missing.
