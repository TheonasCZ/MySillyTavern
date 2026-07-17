/** Message importance scoring (A10): ranks messages so the summarizer can
 * distinguish plot-critical turns from mundane chatter.
 *
 * All functions are pure and unit‑testable — no DB/Tauri imports. */

import type { Message } from "../db/repositories/messagesRepo";

// ---- Public types -------------------------------------------------------

/** Message augmented with an optional speaker name (same shape used by the
 * summarizer). */
export type TranscriptMessage = Message & { speakerName?: string | null };

// ---- Constants ----------------------------------------------------------

/** Messages scoring above this threshold are marked `[důležité]`. */
export const IMPORTANCE_THRESHOLD = 0.5;

const PROPER_NOUN_RE = /\b[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+\b/g;
const MAX_LENGTH_FOR_SCORE = 500;

// Small Czech sentiment lexicons — keep in sync with the game's language.
const POSITIVE_WORDS = new Set([
  "dobrý", "dobře", "skvěle", "výborně", "úžasný", "krásný", "krásně",
  "radost", "šťastný", "šťastně", "láska", "miluji", "milovat", "dík",
  "díky", "super", "fajn", "báječný", "báječně", "skvělý", "perfektní",
  "pozitivní", "nadšený", "nadšení", "úsměv", "vděčný", "vděčnost",
]);

const NEGATIVE_WORDS = new Set([
  "špatný", "špatně", "hrozný", "hrozně", "strašný", "strašně", "zlý",
  "zle", "smutný", "smutně", "bolest", "nenávist", "nenávidět", "zloba",
  "hněv", "rozzlobený", "naštvaný", "zklamaný", "zklamání", "depresivní",
  "temný", "temnota", "zoufalý", "zoufale", "krutý", "krutě", "odporný",
]);

// ---- Public helpers -----------------------------------------------------

/** Simple sentiment score for a single message: (#positive − #negative)
 * normalised by total sentiment-bearing words. Returns 0–1 where 1 is
 * strongly positive and 0 is strongly negative; 0.5 is neutral. */
function sentimentScore(content: string): number {
  const words = content.toLowerCase().split(/\s+/);
  let pos = 0;
  let neg = 0;

  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) pos++;
    if (NEGATIVE_WORDS.has(w)) neg++;
  }

  const total = pos + neg;
  if (total === 0) return 0.5; // neutral
  // Map from [-1, 1] → [0, 1]
  return (pos - neg) / total / 2 + 0.5;
}

/** Count named entities in a message: capitalised words that are *not* the
 * first token (to exclude sentence‑start false positives). Returns 0–1
 * normalised by word count. */
function namedEntityScore(content: string): number {
  const trimmed = content.trim();
  if (trimmed.length === 0) return 0;

  const words = trimmed.split(/\s+/);
  if (words.length <= 1) return 0;

  let neCount = 0;
  for (let i = 1; i < words.length; i++) {
    if (PROPER_NOUN_RE.test(words[i])) {
      neCount++;
    }
  }

  // Normalise: cap at 0.3 NE/word → score 1.0
  return Math.min(neCount / (words.length - 1) / 0.3, 1);
}

/** 0–1 based on message length, capped at MAX_LENGTH_FOR_SCORE chars. */
function lengthScore(content: string): number {
  return Math.min(content.length / MAX_LENGTH_FOR_SCORE, 1);
}

// ---- Main scoring function ----------------------------------------------

export interface ScoreImportanceOptions {
  /** Optional ledger fact subjects to correlate against message content. */
  factSubjects?: string[];
}

/**
 * Score each message by estimated importance (0–1).
 *
 * The composite score is a weighted sum of four heuristics:
 *   - named-entity count (0.35)
 *   - message length      (0.25)
 *   - sentiment shift     (0.25)  — how much the tone changes vs the
 *                                   previous message
 *   - fact correlation    (0.15)  — overlap with known ledger subjects
 *
 * All errors are swallowed; the function always returns a (possibly empty)
 * Map and never throws.
 */
export function scoreImportance(
  messages: TranscriptMessage[],
  options?: ScoreImportanceOptions,
): Map<string, number> {
  const scores = new Map<string, number>();
  if (!messages || messages.length === 0) return scores;

  const factWords = options?.factSubjects?.length
    ? new Set(options.factSubjects.flatMap((s) => s.toLowerCase().split(/\s+/)))
    : null;

  // Pre-compute per‑message sentiment so we can compute shifts
  const sentiments: number[] = [];
  for (const m of messages) {
    sentiments.push(sentimentScore(m.content));
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    try {
      const neScore = namedEntityScore(m.content);
      const lenScore = lengthScore(m.content);

      // Sentiment shift: absolute difference from previous message
      let shiftScore = 0.5; // neutral for the first message
      if (i > 0) {
        shiftScore = Math.abs(sentiments[i] - sentiments[i - 1]);
      }

      // Fact correlation: fraction of fact‑subject words found in content
      let factScore = 0;
      if (factWords && factWords.size > 0) {
        const msgWords = new Set(m.content.toLowerCase().split(/\s+/));
        let matches = 0;
        for (const fw of factWords) {
          if (msgWords.has(fw)) matches++;
        }
        factScore = Math.min(matches / factWords.size, 1);
      }

      const score =
        0.35 * neScore +
        0.25 * lenScore +
        0.25 * shiftScore +
        0.15 * factScore;

      scores.set(m.id, Math.max(0, Math.min(score, 1)));
    } catch {
      scores.set(m.id, 0);
    }
  }

  return scores;
}

// ---- Formatting ---------------------------------------------------------

/**
 * Format messages with importance markers for the summarizer prompt.
 *
 * Important messages (score > IMPORTANCE_THRESHOLD) are prefixed with
 * `[důležité]`; routine messages get `[rutinní]`. Adjacent routine
 * messages from the *same speaker* are compressed into a single summary
 * line listing speaker names and message count.
 */
export function formatScoredMessages(
  messages: TranscriptMessage[],
  scores: Map<string, number>,
): string {
  if (!messages || messages.length === 0) return "";

  const lines: string[] = [];

  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    const score = scores.get(m.id) ?? 0;

    if (score > IMPORTANCE_THRESHOLD) {
      const speaker = m.speakerName ?? (m.role === "assistant" ? "AI" : "Player");
      lines.push(`[important] ${speaker}: ${m.content}`);
      i++;
    } else {
      // Collect adjacent routine messages
      const start = i;
      const speakers = new Set<string>();
      while (
        i < messages.length &&
        (scores.get(messages[i].id) ?? 0) <= IMPORTANCE_THRESHOLD
      ) {
        const sp = messages[i].speakerName ?? (messages[i].role === "assistant" ? "AI" : "Hráč");
        speakers.add(sp);
        i++;
      }
      const count = i - start;
      const speakerList = [...speakers].join(", ");
      lines.push(
        `[routine] Brief exchange between ${speakerList} (${count} ${count === 1 ? "message" : "messages"})`,
      );
    }
  }

  return lines.join("\n");
}
