// Mutation-derived quest subjects.
//
// The Market sells one pre-mutated zombie per mutation bit ("Carrot Zombie" = bit 4,
// "Tomato Zombie" = bit 1, ...). Two shipped quests name those species directly:
// #55 "Mutation Nation" (harvest a Tomato + a Carrot Zombie) and #56 "It's Alive!"
// (combine them). But a mutation acquired the OTHER way — growing a plain zombie
// beside tomato/carrot crops — lands as a mutation bit on a `ZombieActorRegularTier1`
// whose species name is just "Zombie", so those quests never advanced for a player
// who farmed their mutants instead of buying them.
//
// Rather than emit a second quest event (which would double-count against the quest
// format's wildcard "" requirements, e.g. "Harvest 8 Zombies"), a harvest/combine
// event carries ALIASES: the extra names that same single event answers to. See
// questSubjectMatches.
//
// Two Tier-4 mutants deliberately reuse a lower tier's bit (Eyebiscus = Carrot's 4,
// Heartichoke = Cauliflower's 512), so a bit can map to more than one species name
// and every one of them is a valid alias.
import { bitsOf } from "../zombie/mutations";

/** The shape this module needs from a zombie catalog row (public/assets/zombies.json). */
export interface MutantSpeciesRow {
  name: string;
  mutation?: number;
  category?: string;
}

/** Mutation bit -> the Market mutant species names carrying exactly that bit. */
export function mutantSubjectIndex(
  rows: readonly MutantSpeciesRow[]
): ReadonlyMap<number, string[]> {
  const index = new Map<number, string[]>();
  for (const row of rows) {
    // Only single-bit market mutants name a mutation. A multi-bit or unmutated row
    // describes a species, not a mutation, and must not become an alias.
    const mask = row.mutation ?? 0;
    if (!mask || !row.name || bitsOf(mask).length !== 1) continue;
    const names = index.get(mask) ?? [];
    if (!names.includes(row.name)) names.push(row.name);
    index.set(mask, names);
  }
  return index;
}

/**
 * Every quest identity for one unit: its own species name first, then the mutant
 * species each carried mutation makes it equivalent to. A bought "Carrot Zombie"
 * resolves to just itself (its species name and its alias are the same string).
 */
export function unitQuestSubjects(
  speciesName: string,
  mask: number,
  index: ReadonlyMap<number, string[]>
): string[] {
  const out = [speciesName];
  for (const bit of bitsOf(mask)) {
    for (const name of index.get(bit) ?? []) if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** The alias list for a unit — its identities minus the species name already sent
 *  as the event's primary subject. Empty for an unmutated unit. */
export function unitSubjectAliases(
  speciesName: string,
  mask: number,
  index: ReadonlyMap<number, string[]>
): string[] {
  return unitQuestSubjects(speciesName, mask, index).slice(1);
}

/** The combiner's subject is the two parents' names sorted and joined by a space.
 *  With mutations in play each parent has several identities, so the event answers
 *  to every pairing of them. The primary subject (both species names) is excluded. */
export function combineSubjectAliases(
  parentA: readonly string[],
  parentB: readonly string[]
): string[] {
  const primary = combineSubject(parentA[0] ?? "", parentB[0] ?? "");
  const out = new Set<string>();
  for (const a of parentA) {
    for (const b of parentB) {
      const subject = combineSubject(a, b);
      if (subject !== primary) out.add(subject);
    }
  }
  return [...out];
}

/** The canonical combiner subject for one pair of parent names. */
export function combineSubject(a: string, b: string): string {
  return [a, b].filter(Boolean).sort().join(" ");
}
