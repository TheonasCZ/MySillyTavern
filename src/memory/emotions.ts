/** Emotion state tracking (plan B5). Pure functions — no DB/Tauri
 * imports — so they're unit-testable. Tracks NPC moods as ledger facts
 * under (category="npc", sub_key="mood") and enriches PromptBuilder
 * character descriptions with current mood. */

export const MOOD_CATEGORY = "npc";
export const MOOD_SUB_KEY = "mood";

/** How many messages without reconfirmation before a mood fact is
 *  considered stale and should be archived. */
const MOOD_DECAY_MESSAGES = 10;

// ---- Mood detection -----------------------------------------------------

/** Czech emotion words mapped to their canonical mood label.
 *  Each key is the canonical mood, values are the word forms that
 *  map to it (masculine, feminine, neuter, plural, common variants). */
const MOOD_PATTERNS: Array<{ mood: string; words: string[] }> = [
  { mood: "vyděšený", words: [
    "vyděšený", "vyděšená", "vyděšené", "vyděšení", "vyděšeně",
    "vystrašený", "vystrašená", "vystrašené", "vystrašení",
    "zděšený", "zděšená", "zděšené", "zděšení",
  ]},
  { mood: "rozzlobený", words: [
    "rozzlobený", "rozzlobená", "rozzlobené", "rozzlobení",
    "rozzlobeně", "rozhněvaný", "rozhněvaná", "rozhněvané",
    "rozhněvaní", "rozhněvaně",
    "vzteklý", "vzteklá", "vzteklé", "vzteklí",
    "zuřivý", "zuřivá", "zuřivé", "zuřiví",
    "naštvaný", "naštvaná", "naštvané", "naštvaní",
  ]},
  { mood: "smutný", words: [
    "smutný", "smutná", "smutné", "smutní", "smutně",
    "zarmoucený", "zarmoucená", "zarmoucené", "zarmoucení",
    "nešťastný", "nešťastná", "nešťastné", "nešťastní",
    "sklíčený", "sklíčená", "sklíčené", "sklíčení",
  ]},
  { mood: "radostný", words: [
    "radostný", "radostná", "radostné", "radostní", "radostně",
    "veselý", "veselá", "veselé", "veselí",
    "šťastný", "šťastná", "šťastné", "šťastní",
    "nadšený", "nadšená", "nadšené", "nadšení",
  ]},
  { mood: "zmatený", words: [
    "zmatený", "zmatená", "zmatené", "zmatení", "zmateně",
    "dezorientovaný", "dezorientovaná", "dezorientované",
    "zaražený", "zaražená", "zaražené", "zaražení",
  ]},
  { mood: "klidný", words: [
    "klidný", "klidná", "klidné", "klidní", "klidně",
    "vyrovnaný", "vyrovnaná", "vyrovnané", "vyrovnaní",
    "mírumilovný", "mírumilovná", "mírumilovné",
  ]},
  { mood: "napjatý", words: [
    "napjatý", "napjatá", "napjaté", "napjatí", "napjatě",
    "nervózní", "nervózně",
    "neklidný", "neklidná", "neklidné", "neklidní",
    "rozrušený", "rozrušená", "rozrušené", "rozrušení",
  ]},
  { mood: "zamilovaný", words: [
    "zamilovaný", "zamilovaná", "zamilované", "zamilovaní", "zamilovaně",
    "okouzlený", "okouzlená", "okouzlené", "okouzlení",
  ]},
  { mood: "zvědavý", words: [
    "zvědavý", "zvědavá", "zvědavé", "zvědaví", "zvědavě",
    "zvídavý", "zvídavá", "zvídavé", "zvídaví",
  ]},
  { mood: "unavený", words: [
    "unavený", "unavená", "unavené", "unavení", "unaveně",
    "vyčerpaný", "vyčerpaná", "vyčerpané", "vyčerpaní",
    "znavený", "znavená", "znavené", "znavení",
  ]},
];

/** Scans `content` for Czech emotion words and returns the first canonical
 *  mood found, or `null` when no emotion words are detected. The search is
 *  case-insensitive and matches whole-word boundaries (captured as
 *  word-start/end markers in regex). Returns only the first match — callers
 *  that need multi-emotion detection should iterate independently. */
export function detectMood(content: string): string | null {
  if (!content) return null;
  const lower = content.toLowerCase();
  for (const pattern of MOOD_PATTERNS) {
    for (const word of pattern.words) {
      // Match whole word: word boundary or space before/after.
      if (lower.includes(word.toLowerCase())) {
        return pattern.mood;
      }
    }
  }
  return null;
}

// ---- Decay --------------------------------------------------------------

/** Returns `true` when a mood fact should be considered stale and archived.
 *  `updated_at` is the ISO-8601 timestamp of the fact's last update;
 *  `currentTime` is the caller-provided "now" (for testability);
 *  `messageAge` is how many messages ago the fact was last confirmed.
 *
 *  A mood fact decays when it is older than `MOOD_DECAY_MESSAGES` messages
 *  without reconfirmation — meaning the extractor hasn't seen the same
 *  emotion expressed recently. */
export function decayMoodFact(
  fact: { updated_at: string },
  currentTime: Date,
  messageAge: number,
): boolean {
  if (messageAge > MOOD_DECAY_MESSAGES) return true;

  // Secondary check: if the fact is very old in wall-clock time
  // (> 7 days), also decay it even if message count is low.
  try {
    const updated = new Date(fact.updated_at);
    if (isNaN(updated.getTime())) return false; // unparseable — keep
    const ageMs = currentTime.getTime() - updated.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (ageMs > sevenDaysMs) return true;
  } catch {
    // If we can't parse the date, don't decay — safer to keep.
    return false;
  }

  return false;
}

// ---- Mood → description for PromptBuilder -------------------------------

/** Builds a character-name → mood-description map for use in
 *  `PromptBuilder`. Each mood fact is keyed by its `subject` (character
 *  name) and the `fact` value is the mood description (e.g. "vyděšená a
 *  nedůvěřivá").
 *
 *  If multiple mood facts exist for the same character, the first one wins.
 */
export function moodDescription(
  facts: Array<{ subject: string; fact: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of facts) {
    if (!map.has(f.subject)) {
      map.set(f.subject, f.fact);
    }
  }
  return map;
}
