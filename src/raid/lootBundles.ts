/** How many of a boost an INVASION DROP hands over.
 *
 *  Raid loot names a boost the same way the shop does, but a raid win is a much rarer
 *  event than a purchase — one Insta-Grow per clear is barely worth the loot slot it
 *  occupies, so the drop pays a bundle instead. Everything else still drops singly.
 *
 *  Scope is deliberately narrow: this applies to the RAID loot roll only. Buying a boost
 *  still grants `BoostEcon.perPurchase`, and claiming one from Received storage still
 *  grants one — neither reads this table.
 *
 *  Shared by both settlement paths (server/src/v3/raid.ts online, RaidManager offline) so
 *  the two can't drift. */
export const RAID_BOOST_BUNDLE: Readonly<Record<string, number>> = {
  insta_grow: 10,
};

/** Bundle size for a boost won as raid loot — 1 for anything not bundled. */
export function raidBoostBundle(key: string): number {
  return Object.prototype.hasOwnProperty.call(RAID_BOOST_BUNDLE, key)
    ? RAID_BOOST_BUNDLE[key]
    : 1;
}
