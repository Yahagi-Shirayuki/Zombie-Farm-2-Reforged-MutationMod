/** Match a quest's named subject. Most requirements are exact, while these
 * decorating objectives intentionally target a whole object family.
 *
 * `aliases` are ADDITIONAL identities the same event answers to. A zombie that
 * grew a tomato mutation in the field is a "Zombie" by species but is also, for
 * quest purposes, a "Tomato Zombie" — the mutant the Market sells. Aliases let one
 * event satisfy either name without emitting a second event (which would double
 * count against the format's wildcard "" requirements). See quest/mutantSubjects.
 */
export function questSubjectMatches(
  requirement: string,
  subject: string,
  aliases: readonly string[] = []
): boolean {
  if (!requirement) return true;
  const wanted = requirement.trim().toLowerCase();
  return [subject, ...aliases].some((candidate) => matchesOne(wanted, candidate));
}

function matchesOne(wanted: string, subject: string): boolean {
  if (wanted === subject.trim().toLowerCase()) return true;
  return (wanted === "barrel" || wanted === "hedge") &&
    new RegExp(`\\b${wanted}\\b`, "i").test(subject);
}
