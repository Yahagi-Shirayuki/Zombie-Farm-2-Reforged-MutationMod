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

GOLD PRICES are NOT retuned — they pass through from source untouched, EXCEPT for
the regular crops, which take the crop rebalance below.

CROP ECONOMY — the unlock/profit/XP rebalance
---------------------------------------------
ZF2 unlocks all 25 regular crops by level 25 and pays 1 XP for nearly every harvest,
so the back half of the level curve has nothing left to give and crops barely feed
progression. Reforged respreads them over levels 1-45 (the real level cap) on an
explicit profit and XP curve. See zombie-farm-crop-rebalancing-model.pdf for the
derivation; CROP_REBALANCE below is that model's output, and it is authoritative
over Market.json.

Same hazard as the brain retune: prep_market.py joins plants.json against
Market.json and writes cost/sell/level/xp back, so without this table a single
re-run would silently revert the whole rebalance. Grow times are NOT rebalanced and
still pass through from source.
"""

BRAIN_COST_DIVISOR = 10

# key -> (level, cost, sell, xp). `sell` is the model's target harvest value
# (cost + 10 plow + target profit) and `xp` is its total cycle XP minus the one plow
# XP that farmRewards.ts already awards. Seasonal crops are deliberately absent —
# they are outliers and keep their source values until they get their own pass.
CROP_REBALANCE = {
    "carrot":        (1,    5,  16, 1),
    "onion":         (1,   20,  60, 4),
    "tomato":        (3,   10,  31, 2),
    "turnip":        (5,   30,  62, 3),
    "breadfruit":    (9,   20,  35, 2),
    "potato":        (10,  50,  99, 5),
    "sampaguita":    (14,  25,  38, 2),
    "coffee":        (15,  20,  53, 4),
    "candycorn":     (16,  60,  79, 2),
    "venus_flytrap": (19,  80, 111, 3),
    "celery":        (20,  40,  56, 2),
    "Spineapple":    (21,  17,  29, 1),
    "broccoli":      (23,  70,  97, 3),
    "garlic":        (25,  50,  88, 4),
    "Bloodberry":    (27,  55,  72, 2),
    "cauliflower":   (29,  90, 138, 5),
    "skellyberry":   (31,  40,  54, 2),
    "lima_beans":    (33, 120, 191, 6),
    "sun_glower":    (35, 150, 181, 4),
    "dragon_fruit":  (37, 120, 195, 7),
    # Pumpking's seed cost is deliberately far above its source price (142). The
    # profit is unchanged; the larger stake exists to make it a fertilize target,
    # since fertilizing pays out the harvest value a second time.
    "pumpking":      (39, 380, 425, 5),
    "corpse_flower": (41, 200, 240, 5),
    "meat_flower":   (43,  26,  38, 2),
    "eyebiscus":     (44, 100, 158, 6),
    # The capstone is the one entry that sits above the model's own curve: at level
    # 45 the equations give 73 profit / 8 total XP, and it keeps 78 / 9 by decision.
    # Re-derive it by hand if the profit slope is ever retuned.
    "heartichoke":   (45, 125, 213, 8),
}

# Nothing may unlock past the top XP tier. src/GameState.ts XP_THRESHOLDS and
# server/src/levels.ts both stop at 45, so a crop above it would be unplantable.
LEVEL_CAP = 45


def rebalance_crop(key, entry):
    """Overwrite one plants.json entry's economy from CROP_REBALANCE, in place.

    Returns True if the crop is rebalanced, False if it is not in the table (a
    seasonal crop, which keeps its source values). Raises if the table names a
    level the player can never reach.
    """
    row = CROP_REBALANCE.get(key)
    if row is None:
        return False
    level, cost, sell, xp = row
    if level > LEVEL_CAP:
        raise ValueError(f"{key}: unlock level {level} is above the level cap {LEVEL_CAP}")
    entry["level"], entry["cost"], entry["sell"], entry["xp"] = level, cost, sell, xp
    return True


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
