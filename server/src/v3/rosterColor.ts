/** A zombie's inherited body tint (Zombie Pot children mix their parents'). Stored
 *  on the authoritative roster row as a JSON "[r,g,b]" triple; NULL/absent means
 *  "no inherited tint — render the species' catalog colour", which is the truth for
 *  every zombie that never came out of a Pot.
 *
 *  Both directions are total: anything that is not a well-formed triple of byte
 *  channels degrades to "no tint" rather than reaching a renderer, so a malformed
 *  row or a hostile presentation payload can only ever cost the catalog colour. */
export type RosterColor = [number, number, number];

const isChannel = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;

export function asRosterColor(value: unknown): RosterColor | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  return value.every(isChannel) ? [value[0], value[1], value[2]] : undefined;
}

export function parseRosterColor(text: string | null | undefined): RosterColor | undefined {
  if (!text) return undefined;
  try {
    return asRosterColor(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export function serializeRosterColor(color: unknown): string | null {
  const parsed = asRosterColor(color);
  return parsed ? JSON.stringify(parsed) : null;
}
