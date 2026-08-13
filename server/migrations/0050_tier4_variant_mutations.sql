-- Eyebiscus and Heartichoke stop riding a lower tier's mutation.
--
-- Both shipped carrying a bit that belonged to a Tier-1/Tier-2 mutation — an Eyebiscus
-- Zombie held Carrot-eyed's 4, a Heartichoke Zombie held Cauli-hair's 512 — so the two
-- priciest, slowest mutation crops in the game granted the cheapest bonus, and the
-- Heartichoke filed itself under the hair slot while visibly wearing a body. Each is a
-- catalogued mutation of its own now (src/zombie/mutations.ts CATALOG):
--
--   eyebiscus    16384  hair_eye  +1 attack, +1 speed   (Carrot-eyed: +1 speed)
--   heartichoke  32768  body      +5 life               (Lima Bean:   +3 life)
--
-- Stats are NOT stored on a roster row — they derive from the key and the mask on both
-- the client and the server's raid verifier (rosterCatalog: "stats derive from the key")
-- — so rewriting the bit is the whole repair; the new stat line follows from it.
--
-- Applying this is OPTIONAL for correctness: src/zombie/variantMutations upgrades the
-- same masks inside `makeOwned`, which both sides build units through, so an un-migrated
-- row already reads and replays identically on the client and the server. This makes the
-- stored value agree with what everybody already computes from it.
--
-- Idempotent: a row rewritten once no longer carries the shared bit, so re-running is a
-- no-op. Under-repairs rather than over-repairs — a unit of some OTHER species holding
-- carrot or cauli is untouched, because those mutations are unchanged for everybody else.

-- Eyebiscus keeps its slot (hair_eye -> hair_eye), so the swap is bit for bit.
UPDATE roster_v3
SET mutation = (mutation & ~4) | 16384
WHERE zombie_key = 'ZombieActorRegularTier4Eyebiscus'
  AND (mutation & 4) != 0;

-- Heartichoke MOVES slot (hair_eye -> body), so it evicts whatever held the body slot.
-- In practice that is only a Lima Bean (1024), which could coexist with it while it was
-- misfiled under hair. The eviction matches how the Zombie Pot resolves a same-slot
-- conflict (the higher bit wins) and is not a downgrade: +5 life against Lima Bean's +3.
UPDATE roster_v3
SET mutation = (mutation & ~512 & ~1024) | 32768
WHERE zombie_key = 'ZombieActorRegularTier4Heartichoke'
  AND (mutation & 512) != 0;

-- A zombie sitting in Black Market escrow is off the roster, so it carries its mask on
-- the ORDER instead. Same rewrite, same reasoning — and the same optionality, since it
-- reaches a roster (or a listing card) through makeOwned either way.
UPDATE black_market_orders
SET escrow_mutation = (escrow_mutation & ~4) | 16384
WHERE zombie_key = 'ZombieActorRegularTier4Eyebiscus'
  AND escrow_mutation IS NOT NULL AND (escrow_mutation & 4) != 0;

UPDATE black_market_orders
SET escrow_mutation = (escrow_mutation & ~512 & ~1024) | 32768
WHERE zombie_key = 'ZombieActorRegularTier4Heartichoke'
  AND escrow_mutation IS NOT NULL AND (escrow_mutation & 512) != 0;

UPDATE black_market_orders
SET delivered_mutation = (delivered_mutation & ~4) | 16384
WHERE zombie_key = 'ZombieActorRegularTier4Eyebiscus'
  AND delivered_mutation IS NOT NULL AND (delivered_mutation & 4) != 0;

UPDATE black_market_orders
SET delivered_mutation = (delivered_mutation & ~512 & ~1024) | 32768
WHERE zombie_key = 'ZombieActorRegularTier4Heartichoke'
  AND delivered_mutation IS NOT NULL AND (delivered_mutation & 512) != 0;

-- A standing BUY order asks for a mutation BY BIT. One asking a Heartichoke Zombie for
-- Cauli-hair can never be filled again — no Heartichoke carries that bit — so the ask
-- moves with the species rather than stranding the order.
UPDATE black_market_orders
SET mutation_required = (mutation_required & ~4) | 16384
WHERE zombie_key = 'ZombieActorRegularTier4Eyebiscus'
  AND mutation_required IS NOT NULL AND (mutation_required & 4) != 0;

UPDATE black_market_orders
SET mutation_required = (mutation_required & ~512 & ~1024) | 32768
WHERE zombie_key = 'ZombieActorRegularTier4Heartichoke'
  AND mutation_required IS NOT NULL AND (mutation_required & 512) != 0;

-- Do not update the retired protocol-v2 `roster` table here. Migration 0020 drops it on
-- upgraded databases, while fresh databases retain an empty compatibility table from
-- schema.sql and baseline this migration without executing it. Referencing that optional
-- table makes the entire migration fail on the live upgrade path (see 0035).
