-- A headless zombie has no head to mutate: it may only carry body / arm / neck
-- mutations, never head or hair/eye ones (see src/zombie/mutations.ts
-- HEADLESS_FORBIDDEN_MASK). The client has always enforced this in makeOwned, but the
-- v3 combine wrote the raw inherited mask, so a carrot-eyed slot-2 parent could leave a
-- Party Zombie holding an eye mutation it can never show. The engine now scrubs the
-- child (rosterCatalog.legalMutation); this repairs the rows written before that.
--
-- Forbidden mask = 951:
--   head     tomato 1 | onion 2 | potato 16 | coffee 32 | garlic 256   = 307
--   hair_eye carrot 4 | broccoli 128 | cauliflower 512                 = 644
-- Clearing those bits is exactly what the client already does when it loads the unit,
-- so no player sees a change — it only stops the two sides disagreeing.
--
-- Idempotent: re-running clears nothing further. Under-repairs rather than over-repairs
-- (body/arm/neck mutations are untouched).
UPDATE roster_v3
SET mutation = mutation & ~951
WHERE (mutation & 951) != 0
  AND zombie_key IN (
    'ZombieActorHeadlessTier1',
    'ZombieActorHeadlessTier2',
    'ZombieActorHeadlessTier3',
    'ZombieActorHeadlessTier4',
    'ZombieActorHeadlessTier5',
    'ZombieActorHeadless2Tier5',
    'ZombieActorBombie'
  );

-- Do not update the retired protocol-v2 `roster` table here. Migration 0020 drops it
-- on upgraded databases, while fresh databases retain an empty compatibility table
-- from schema.sql and baseline this migration without executing it. Referencing that
-- optional table makes the entire migration fail on the live upgrade path.
