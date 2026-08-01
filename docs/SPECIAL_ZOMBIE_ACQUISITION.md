# Special zombie acquisition

The runtime catalog contains 56 zombies in the Special category. Every one has a
reachable acquisition route; Epic-event rewards and voucher gifts are deliberately
excluded from the plantable zombie Market.

The routes below account for all 56: 15 Epic Boss rewards, 5 plantable Market crops,
2 voucher-exclusive, 6 combine-only, and the remaining **28 obtainable only through the
Black Market** — every one of those is `marketHidden: true` and has no planting route at all.

## Epic Boss events (15)

| Event | Milestone | Zombie |
|---|---:|---|
| Dr. Groundhog | 5 | Dr. Zombie |
| Dr. Groundhog | 20 | Omega Dr. Zombie |
| Loco Locust | 5 | Bandido Zombie |
| Loco Locust | 40 | Vagabond Zombie |
| Bully Frog | 5 | Captain Zombie |
| Bully Frog | 40 | Admiral Zombie |
| Foul Owl | 5 | Christmas Ghost Zombie |
| Foul Owl | 40 | Scrooge Zombie |
| Skunkarella | 5/10/15/20 collection | Diva Zombie |
| Skunkarella | 40 | Madame Zombie |
| Rocky Rhino | 10 | Brock Coley |
| General Larvaelus | 5 | Proto Zombie |
| General Larvaelus | 40 | Zombug |
| Mystical Mamba | 5 | Zomdini |
| Mystical Mamba | 40 | Zomtar |

These are granted directly to the deployed farm roster when there is room, or to
zombie storage when the deployed army is full. Earned rewards may overflow the
storage limit; only manually storing a deployed zombie is blocked when storage is
full. They cannot be bought, planted, seeded by migration, or used to duplicate
themselves in the Zombie Pot.

## Market: Special zombie crops (5)

These five permanent specials cost **5 brains** to plant (the 50-brain figure predates the
brainflation revert). Their unlock levels are **not** uniform, and are not level 20 — that
figure is the Black Market *delivery* gate below, not the planting gate. Per `zombies.json`,
most `Tier5` crops unlock at level **1**; `ZombieActorRegularTier5` at **15** and
`ZombieActorLargeTier5` at **20**.

Selling one now pays **gold, not brains**: a brain-priced zombie sells for 1,000 gold per brain
of its cost, so a 5-brain special returns 5,000 gold.

- Bombie, Crazy Zombie, Cupid Zombie, Dapper Zombie, and Granny Zombie.

## Market vouchers (4)

These can also be obtained by buying and using a boost rather than planting the
zombie (Crazy and Cupid retain both routes):

| Market item | Zombie |
|---|---|
| Crazy Zombie Voucher | Crazy Zombie |
| Valentine Gift | Cupid Zombie |
| Valentine Gift 2012 | Pink Cupid Zombie |
| Flower Zombie Pot | Green Flower Zombie |

Each voucher is limited to one owned copy of its exact result. The 2012 gift uses
the distinct pink Cupid actor, not the ordinary Cupid actor.

## Black Market (28)

The only route for the 28 `marketHidden` specials — ZomBetty, ZomBloke, George Washington,
John Hancock, Mummy Zombie, ZomHelga, Zombeach Bum, Zula Girl, Skittles, Zwamp Thing,
Zcarecrow, Zanta Clause, Diver, JackoZombie, Reindeer, Teddy, Forest, Medusa, Old McZombie,
Zastronaut, Deputy, Master Ninjombie, MerZombie, Ninjombie, Omega Zombie Bot, Poseidon,
Sheriff, and Zombie Bot. Another player escrows the zombie as a `SELL_ZOMBIE` order, or fills
a `BUY_ZOMBIE` request.

Delivery is gated on the **recipient**, checked pre-flight and re-checked as a SQL guard inside
the fulfillment transaction (`server/src/rosterCatalog.ts`, `server/src/v3/blackMarket.ts`):

- **Player level 20** for any `special`-category zombie (`BLACK_MARKET_SPECIAL_LEVEL`); a failure
  returns `403 black_market_level_locked`.
- **Player level 1/15/25** for the Blue/Red/Silver colored classes (29 units across the catalog
  carry a `className`), matching the level that unlocks each class's gravestone. The gravestone
  does not need to be owned or placed. A failure returns `403 black_market_level_locked`.

Note the framing difference from the rest of this document: the Black Market **bypasses ordinary
crop unlock levels entirely**. Level 20 for specials and the class-level thresholds for colored
zombies are the *only* gates, so a zombie whose planting route would be locked can still arrive by trade.

## Combining

At player level 25 and above, combining two non-special zombies has a 10% chance
to create the hidden tier-5 special for one input body type: Garden produces
Zombutterfly, Large produces Zomviking, Small produces Zombricaun, Female produces
Zombelly Dancer, Regular produces Zombotron, and Headless produces Skull Head.
Same-type parents select that type; mixed-type parents choose either input type
with equal probability. On a failed roll, the ordinary mutant-donor and tier rules
apply.

A single combinable special forces its own species as the output. Two specials
cannot be combined, and Epic/event `rewardOnly` zombies cannot enter the pot at all.
