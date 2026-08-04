-- Cancelling a Black Market sale hands the escrowed zombie back as a BRAND NEW
-- roster row (a fresh unit id — the original row was deleted when the listing was
-- created). The client cannot tell that row apart from a purchase, so it credited
-- the Zombie Almanac for it: listing a zombie and taking it back kept inflating
-- that species' lifetime-obtained count, once per cycle.
--
-- Mark the restored row so the authoritative roster projection can say "this one
-- came home, it is not a new acquisition". Existing rows take 0: units restored
-- before this migration were already credited, and Almanac counts never decrease.
ALTER TABLE roster_v3 ADD COLUMN from_escrow INTEGER NOT NULL DEFAULT 0;
