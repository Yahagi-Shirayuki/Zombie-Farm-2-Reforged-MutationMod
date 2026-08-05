# Epic Boss Mechanics

## Implemented coverage

Market → Epic Boss offers all eight recovered bosses. Starting one creates a 14-day
wall-clock run; only one boss event can be active at a time. A run can be purchased again
after its final level is completed or the event expires, and purchasing never extends an
active run.

Costs and unlocks (post-"brainflation revert"; server-enforced in `v3/epicBoss.ts`):
Dr. Groundhog costs **5 brains** and unlocks at **player level 24**; the other seven cost
**10 brains** and unlock at **level 32**. A locked activation returns `403 locked` with the
required level, and the Market card renders "Available at player level N".

Groundhog uses 20 levels. The other seven bosses use their recovered level-40 reward
tracks. Maximum HP is `round(2000 * LevelMultiplier[level - 1])`, using
`EpicBossHP.json`. Because the shipped HP table ends at level 21, its final multiplier
is held constant for reconstructed levels 22-40. Each fight has a hard
30-second escape deadline. Zombies use manual brain-bubble release without butterfly
distractions or consuming Concentration. The normal army cap and permanent invasion
casualty rules apply, and Epic Boss attack order is stored separately.

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

Tokens can be
hoarded during the run, but expire when that boss event ends. Damage survives an escape.
If two hours elapse from the first attempt at the current level, that level returns to
full HP. Winning advances immediately to the next full-health level. A fight begun
before an event or encounter boundary may finish normally.

The farm Boss shortcut appears only for an active run. The Market card shows the event
and encounter timers, token stockpile, level/HP, rewards, activation, and Fight state.

## Rewards

Gold follows `max(1, round(level / 4)) * 100` per cleared level, scaling from 100 gold at the
early levels to 1,000 gold at level 40. This curve is deliberately **unchanged** by the
brainflation revert.

Brains are on a separate, sparse schedule (a single brain is now ~10x more valuable, so runs
hand them out at milestones instead of every level):

- +1 brain on every 5th level cleared (5, 10, 15, 20, 25, 30, 35, 40).
- +1 **bonus** brain at the boss's top tiers — levels 30/35/40 on a full 40-level ladder, or
  level 20 for the short-ladder Dr. Groundhog.
- Non-milestone levels award **no** brains at all.

So a cleared level yields 0, 1, or at most 2 brains — not the old `round(level / 4)` ramp to 10.
Both are in addition to the existing loot roll and quest rewards.

Each boss uses its own recovered quest milestones, decor pool, and tame pet. Groundhog's
chain grants Dr. Zombie (5), an Invasion Voucher (10), one brain (15), and Golden Dice
plus Omega Dr. Zombie (20); the level-40 events continue through their recovered chains.
Loco Locust grants Bandido Zombie (5) and Vagabond Zombie (40), Bully Frog grants
Captain Zombie (5) and Admiral Zombie (40), Foul Owl grants Christmas Ghost Zombie (5)
and Scrooge Zombie (40), and Skunkarella's four-card quest grants Diva Zombie. These
nine named zombies are reward-only catalog units: they never appear as purchasable
zombie crops and cannot be consumed or cloned through the Zombie Pot. A reward joins
the farm when an army slot is open; otherwise it is filed in **Received**, where it
waits until the player claims it into a free Mausoleum slot. A full farm can never
destroy an earned unit — but it no longer overflows the Mausoleum either, so claiming
one may mean selling or deploying something first.
Until exact binary loot selection is recovered, each victory makes one 35% roll,
preferring unlocked uncollected drops. Within that pool the pick is **weighted by the
rung that unlocks each prize** (`epicLootWeight` = `1/level`, fed to the binary's
cumulative frequency pick), so the ladder is a rarity ladder: on a full 40-level boss the
first prize lands ~35% of drops and the top-rung signature item ~5%. It was a uniform
pick, which made the level-37 prize exactly as likely as the level-5 one — climbing bought
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
