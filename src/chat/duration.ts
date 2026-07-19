/** Parses a resolved condition duration string (Czech, already past
 *  `resolveDiceNotation` — e.g. "6 hodin", "2 dny", "1d") into minutes, so
 *  [COND:+name:duration] can be turned into a real expiry against the game
 *  calendar instead of just decorative text. Returns null when the text
 *  doesn't start with a recognizable "<number> <unit>" — legacy/malformed
 *  durations (e.g. a bare "1" left over from before this existed) simply
 *  don't get an expiry, same as before. */
export function parseDurationMinutes(text: string): number | null {
  const match = text.trim().match(/^(\d+)\s*([a-záčďéěíňóřšťúůýž]*)/i);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase();
  const perUnit = minutesPerUnit(unit);
  if (perUnit == null) return null;
  return amount * perUnit;
}

function minutesPerUnit(unit: string): number | null {
  if (unit.startsWith("minut")) return 1;
  if (unit.startsWith("hodin")) return 60;
  if (unit.startsWith("týd")) return 60 * 24 * 7;
  // Czech day forms: den/dny/dní/dne/dnech, and the bare "d" shorthand
  // (e.g. "1d" meaning "1 day") — anything else starting with "d" that
  // isn't "dní"-like would be unusual for a duration, so this is safe.
  if (unit.startsWith("d")) return 60 * 24;
  return null;
}
