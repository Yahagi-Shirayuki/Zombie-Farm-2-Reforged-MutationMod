#!/usr/bin/env python3
"""The Reforged economy's price rules, shared by every prep_*.py generator.

BRAIN PRICES — the "brainflation" retune
----------------------------------------
ZF2 inflated ZF1's brain prices tenfold: a ZF1 item costing 5 brains was priced at
50 in ZF2. Reforged undoes that, so a brain stays a rare, high-value currency and
typical prices sit in the 1-5 range (the premium Pet Brain, 500 in source, is 50).

The retune was originally applied to the checked-in assets BY HAND and never taught
to the generators, so re-running prep_market / prep_boots / prep_upgrades /
prep_placeables silently reverted it — 55 zombies, 5 boosts, 3 farm-size tiers and
121 placeables all snapped back to their ZF2 prices. Every generator now routes
brain prices through brain_price() so a regeneration is a no-op.

prep_pets.py had this rule right from the start; this module is that rule, lifted
out so there is exactly one copy of it.

GOLD PRICES are NOT retuned — they pass through from source untouched.
"""

BRAIN_COST_DIVISOR = 10


def brain_price(source_cost, what="item", strict=True):
    """A ZF2 source brain price converted to Reforged terms.

    Rounds half-up and never returns 0 — the cheapest thing costs 1 brain, not
    nothing. `what` names the entry in any error raised.

    strict=True (the default) additionally rejects a source price that is not a
    clean multiple of the divisor, so unexpected source data fails loudly rather
    than silently rounding into a price nobody chose. Catalogs whose source
    legitimately carries odd values (placeables has 15-brain items) pass
    strict=False and accept the rounding.
    """
    cost = int(source_cost or 0)
    if cost <= 0:
        raise ValueError(f"{what}: brain cost must be positive, got {source_cost!r}")
    if strict and cost % BRAIN_COST_DIVISOR != 0:
        raise ValueError(
            f"{what}: brain cost must be a multiple of "
            f"{BRAIN_COST_DIVISOR}, got {source_cost!r}"
        )
    return max(1, int(cost / BRAIN_COST_DIVISOR + 0.5))


def price(source_cost, brains_needed, what="item"):
    """Convenience: retune only when the entry is priced in brains."""
    return brain_price(source_cost, what) if brains_needed else int(source_cost or 0)
