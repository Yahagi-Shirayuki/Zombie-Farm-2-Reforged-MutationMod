# Quest item rewards (`rewardType: 3`)

## What was broken

`public/assets/quests.json` carried `rewardItem` (the display name) for eight base
quests but left `rewardItemKey` empty. Every grant path guards on the **key**, not the
name — `QuestSystem.dispatchReward` (`if (def.rewardItemKey)`) and the server's
`questCatalog` mirror — so those rewards were silent no-ops.

Underneath that, the v3 authoritative engine's `applyQuestEvents` granted only
Xp/Gold/Brains. Item rewards were left "dormant", so even a correct key would have been
granted locally and then wiped: `adoptGameplay` calls `state.syncStorage(...)`, which
replaces the Received bucket wholesale with server truth.

Both are fixed: `applyQuestEvents` now grants items into the authoritative
inventory/Received, and all eight keys are populated.

## Where an item lands

`grantQuestItem` (server/src/v3/engine.ts) resolves the item name the same way raid loot
does:

| Name resolves to | Lands in | Player sees |
|---|---|---|
| a boost (`boostKeyForName`) | `inventory[boostKey]`, capped at `MAX_STACK` | boost inventory |
| a drop with a `tile` (`dropEcon`) | `storage.received[name]` | Received → `storage.claim` makes it a placeable object |
| a drop with no `tile` | `storage.received[name]` | Received, as an unclaimable trophy (same as Rusty Fragment) |
| a currency drop (`brains`/`gold`) | nothing | — currency is paid by its own reward type |
| nothing in either catalog | nothing | — |

Zombie rewards (`rewardType: 5`) stay out of `applyQuestEvents` on purpose: every type-5
quest is an epic-boss quest, and those resolve through `epicQuestZombieReward` so the
unit can compete for army capacity and fall back to Received.

## Content status of the eight quests

Seven are `seasonal: true`, and both the client (`QuestSystem.ts`) and the server engine
skip seasonal quests, so only **quest 45** was ever live. That is the one that was
reported missing.

| id | quest | item | seasonal | delivers today |
|---|---|---|---|---|
| 45 | Big Top Bash | Circus Popcorn | no | **yes** — placeable `circusPopcorn` |
| 38 | Badger Badger Badger | Golden Dice | yes | yes — boost `golden_dice` |
| 39 | Egg Hunting | Golden Dice | yes | yes — boost `golden_dice` |
| 42 | Lactose Intolerance | Golden Dice | yes | yes — boost `golden_dice` |
| 48 | Down for the Count | Spooky Tree | yes | yes — placeable `treeSpooky` |
| 36 | Statuesque | Valentine Gift | yes | trophy only |
| 40 | 99 Red Balloons | White Bunny | yes | no |
| 52 | Poppy Power | Poppy | yes | no |

The last three name original-game content this reimplementation has no entry for. From
the extracted `Market.plist` (`ZF2R_extracted/data/json/gameplay/Market.json`):

* **Valentine Gift** (entry 300) is a `category: "boost"` gift voucher — 100 brains,
  `treatAsGift`, grants a Cupid Zombie, limit 1 per farm. `public/assets/boosts.json`
  currently ships no `effect: "gift"` entries, so there is nothing to grant. It lands in
  Received as a trophy until a gift-voucher boost exists.
* **White Bunny** (entry 560, Mystery Box) and **Poppy** (entry 523, Mega Pets Pack) are
  **pets**. Both now exist — the pet catalog carries all 40 variants — but they still do
  not deliver, for a different reason than when this was written: `grantQuestItem` resolves
  a name through `boostKeyForName` and `dropEcon` only, and a pet is in neither catalog.
  Wiring them needs a pet branch in `grantQuestItem`, not new content.

Their keys are populated anyway. `grantQuestItem` ignores a name it cannot resolve, so
these stay no-ops — but they start working the day the content lands, with no code
change. Adding that content is a content task, not a bug fix; it is deliberately not
done here.
