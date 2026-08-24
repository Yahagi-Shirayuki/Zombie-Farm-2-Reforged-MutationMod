"""
Quest XP rebalance — the single source of truth for what a quest's XP reward is worth.

WHY THIS EXISTS
The imported catalog's XP rewards were authored for the front of the original game and
never rescaled for the rest of it. Measured against the level they unlock at, they run
from ~800% of a level (the tutorial) down to ~1% (levels 41-45): the last twelve levels
need 79% of the game's lifetime XP and the quests covering them pay 200 XP each. The
result is a progression chain that stops mattering around level 25.

THE RULE
A quest is worth a share of the XP needed to clear the level it unlocks at:

    standard   15%   ordinary farm/collection objectives
    difficult  40%   anything gated on winning an invasion

with a floor so the earliest levels — which need 25-125 XP in total — still hand over a
number worth reading rather than 4.

This module is imported by prep_quests.py so a regeneration re-applies it, and can be
run directly to rewrite public/assets/quests.json in place:

    python tools/quest_xp_rebalance.py

KEEP IN SYNC with public/assets/quests_reforged.json, which is authored by hand against
the same bands (see server/test/reforgedQuests.test.ts).
"""
import json
import os

# Mirror of src/GameState.ts XP_THRESHOLDS (45 tiers -> levels 1..45).
XP_THRESHOLDS = [
    0, 25, 75, 150, 250, 375, 550, 800, 1300, 1800, 2300, 2800, 3300, 3900, 4500,
    5500, 6500, 7500, 8500, 9500, 11500, 13500, 15500, 17500, 20500, 25000, 30000,
    35000, 40000, 46000, 53000, 61000, 69000, 78000, 87000, 97000, 107000, 117000,
    127000, 137000, 151000, 165000, 179000, 193000, 218000,
]

STANDARD_SHARE = 0.15
DIFFICULT_SHARE = 0.40

# ---- Hand-priced quests, authoritative over the formula ----------------------
# The share-of-a-level rule keys off `levelRequired` ALONE: it never looks at how
# much work the objective asks for. That is fine while every quest asks for a
# handful of actions, and wrong the moment one asks for hundreds — it priced a
# 500-plow quest at 75 XP because it unlocked at level 8, while a 250-plow quest
# gated at 27 paid 750. Where the formula and a deliberate design call disagree,
# the design call wins and lands here, in the generator, so a regeneration cannot
# silently revert it (same contract as QUEST_LEVEL_OVERRIDES in prep_quests.py).
#
# src/quest/reforgedQuests.test.ts is what fails if one of these drifts back out
# of line with the rest of its category.
AUTHORED_XP = {
    # quest id: (xp, why)
    "22": (750, "3 combines at an effective gate of 25 (its prerequisite, quest 21, "
                "is gated there); the -1 level in Quests.plist made the formula "
                "price it as a level-1 quest and pay 20"),
}

# Below this the percentage produces single digits, which reads as a bug rather than a
# reward. Levels 1-7 need 25-250 XP each, so 20 is still a real fraction of them.
MIN_REWARD = 20

REWARD_TYPE_XP = 0

# A quest is "difficult" when clearing it means winning invasions. These are the only
# objectives in the imported catalog that depend on a fight the player can lose.
DIFFICULT_EVENTS = {
    "kInvasionSuccessfulNotification",
    "kInvasionPerfectGameNotification",
    "kLootItemWonNotification",
    "kEliteInvasionSuccessfulNotification",
    "kElitePerfectGameNotification",
    "kBossDefeatedByAbilityNotification",
}


def xp_to_next(level):
    """XP to advance FROM `level` to the next one. At the cap the final step repeats."""
    index = max(1, min(len(XP_THRESHOLDS), int(level)))
    if index >= len(XP_THRESHOLDS):
        return XP_THRESHOLDS[-1] - XP_THRESHOLDS[-2]
    return XP_THRESHOLDS[index] - XP_THRESHOLDS[index - 1]


def _round_nicely(value):
    """Round to something that looks authored rather than computed."""
    if value < 100:
        return int(round(value / 5.0) * 5)
    if value < 1000:
        return int(round(value / 25.0) * 25)
    return int(round(value / 50.0) * 50)


def is_difficult(quest):
    return any(r.get("notificationID") in DIFFICULT_EVENTS
               for r in quest.get("requirements", []))


def rebalanced_value(quest):
    """The new rewardValue for one quest, or None if it should be left alone."""
    if int(quest.get("rewardType", 0)) != REWARD_TYPE_XP:
        return None  # gold / item / zombie rewards are not on this curve
    if quest.get("epicEvent"):
        return None  # the Epic Boss ladder has its own scaling pass
    authored = AUTHORED_XP.get(str(quest.get("id", "")))
    if authored:
        return authored[0]  # a design call the formula is not allowed to overrule
    # levelRequired -1 means "no gate" — those are the opening tutorial quests, which
    # belong to level 1 for this purpose.
    level = max(1, int(quest.get("levelRequired", 1)))
    share = DIFFICULT_SHARE if is_difficult(quest) else STANDARD_SHARE
    return max(MIN_REWARD, _round_nicely(xp_to_next(level) * share))


def apply(quests):
    """Rewrite every XP reward in a quest dict-of-dicts. Returns the change list."""
    changes = []
    for qid, quest in quests.items():
        value = rebalanced_value(quest)
        if value is None:
            continue
        before = int(quest.get("rewardValue", 0))
        if before == value:
            continue
        quest["rewardValue"] = value
        changes.append((qid, quest.get("title", ""), before, value))
    return changes


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(os.path.dirname(here), "public", "assets", "quests.json")
    with open(path) as f:
        quests = json.load(f)
    changes = apply(quests)
    with open(path, "w") as f:
        json.dump(quests, f, indent=1)
    print(f"quest xp rebalance: {len(changes)} of {len(quests)} quests repriced")
    for qid, title, before, after in sorted(changes, key=lambda c: int(c[0])):
        print(f"  {qid:>5}  {title[:38]:<38} {before:>6} -> {after:>6}")


if __name__ == "__main__":
    main()
