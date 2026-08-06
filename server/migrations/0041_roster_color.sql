-- A zombie's body tint used to live ONLY in the presentation blob, keyed by unit
-- id. Every Black Market settlement mints a fresh unit id — a cancelled sale hands
-- the zombie back as a new row, and a fulfilled one delivers a new row to the buyer
-- — so the tint's key stopped resolving and the unit silently reverted to its
-- species' catalog colour. Mutation and veterancy already survived a trade through
-- the escrow columns; colour did not, and the next presentation write (built from
-- the roster, which no longer carried it) made the loss permanent.
--
-- Give the tint a durable home on the authoritative row, and escrow it alongside
-- the mutation/invasions it travels with. NULL keeps today's meaning everywhere:
-- "no inherited tint, use the catalog colour" — which is the truth for every zombie
-- except a Zombie Pot child. Stored as a JSON "[r,g,b]" triple.
--
-- Not backfillable: the colours already lost to a trade were never recorded
-- anywhere the server can read.
ALTER TABLE roster_v3 ADD COLUMN color TEXT;

-- escrow_color: the listed zombie's tint, captured when the sale is created, so a
-- cancel can hand back the same-looking zombie.
-- delivered_color: the tint of the unit actually handed over. Mirrors escrow_color
-- for a sale; for a BUY_ZOMBIE request it is the fulfiller's own unit, whose tint
-- the escrow columns are forbidden to hold (CHECK: escrow there is brains).
ALTER TABLE black_market_orders ADD COLUMN escrow_color TEXT;
ALTER TABLE black_market_orders ADD COLUMN delivered_color TEXT;
