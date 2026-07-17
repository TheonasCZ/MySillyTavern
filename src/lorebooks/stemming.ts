/** Cheap Czech noun inflection expansion for lorebook keywords.
 *
 * Appends common case/number suffixes to each key so that the substring
 * scanner in `activation.ts` can match inflected forms (e.g. key "meč"
 * also matches "mečem", "meče", "meči").  The expansion is intentionally
 * aggressive — false positives are harmless and are preferred over
 * missed activations. */

/** Suffixes drawn from all Czech nominal paradigms (masculine animate /
 * inanimate, feminine, neuter).  Appending them to a consonant-final stem
 * produces many valid surface forms; vowel-final keys are also stemmed
 * heuristically before suffixing. */
const INFLECTION_SUFFIXES = [
  "e", "i", "ovi", "a", "y", "ů", "ům", "ech", "ích", "em", "ové",
  "u", "ou", "ách", "ám", "ami", "atech", "at", "atům", "aty",
];

const MIN_KEY_LENGTH = 3;
const MAX_EXPANDED = 100;

/** Vowel endings that are likely nominative-singular suffixes rather
 * than part of the stem.  Stripping them before suffixing often yields
 * a usable stem (e.g. "žena" → "žen" + "y" = "ženy"). */
const NOMINATIVE_VOWEL_RE = /[aeoíýáéůě]$/u;

/**
 * Expand a list of lorebook keys into the original keys plus common
 * Czech inflected forms.  Multi-word keys only inflect the last word
 * (the head noun).  Very short keys (< 3 chars) are left as-is.
 *
 * The returned array is deduplicated and limited to at most
 * `MAX_EXPANDED` entries for practical use in the scanner.
 */
export function expandKeys(keys: string[]): string[] {
  const results = new Set<string>();

  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (!key) continue;

    // Always preserve the original key.
    results.add(key);

    if (key.length < MIN_KEY_LENGTH) continue;

    // Multi-word phrase → only inflect the last word (the head noun).
    const words = key.split(/\s+/);
    const lastWord = words[words.length - 1];
    const prefix = words.length > 1 ? words.slice(0, -1).join(" ") + " " : "";

    if (lastWord.length < MIN_KEY_LENGTH) continue;

    const stems = new Set<string>();
    stems.add(lastWord); // consonant-final stem (e.g. "meč")

    // Try stripping a nominative vowel ending for vowel-final keys.
    const trimmed = lastWord.replace(NOMINATIVE_VOWEL_RE, "");
    if (trimmed && trimmed.length >= 2 && trimmed !== lastWord) {
      stems.add(trimmed);
    }

    for (const stem of stems) {
      for (const suffix of INFLECTION_SUFFIXES) {
        results.add(prefix + stem + suffix);
      }
    }
  }

  return [...results].slice(0, MAX_EXPANDED);
}
