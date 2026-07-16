/** Group-chat speaker selection & message shaping (plan §3). Pure, so it's
 * unit-testable without the DB/store layer. */

import type { PromptMessage } from "../prompt/promptBuilder";
import { foldForSearch } from "./searchSnippet";

export interface SpeakerCandidate {
  id: string;
  name: string;
  position: number;
}

/** Picks the next auto-mode speaker (plan §1/§3):
 * 1. If exactly one or more members are mentioned by name (fold-insensitive
 *    substring) in `lastUserText`, the one mentioned *last* in the text wins.
 * 2. Otherwise least-recently-spoken: members absent from `recentSpeakerIds`
 *    entirely go first (by `position`); among the rest, the one whose last
 *    occurrence in `recentSpeakerIds` has the smallest index (spoke longest
 *    ago) wins.
 * Returns null for an empty member list. */
export function pickNextSpeaker(
  members: SpeakerCandidate[],
  lastUserText: string,
  recentSpeakerIds: string[],
): string | null {
  if (members.length === 0) return null;
  if (members.length === 1) return members[0].id;

  const folded = foldForSearch(lastUserText);
  let mentionedId: string | null = null;
  let mentionedLastIdx = -1;
  for (const member of members) {
    const name = foldForSearch(member.name).trim();
    if (!name) continue;
    const idx = folded.lastIndexOf(name);
    if (idx > mentionedLastIdx) {
      mentionedLastIdx = idx;
      mentionedId = member.id;
    }
  }
  if (mentionedId) return mentionedId;

  const neverSpoken = members.filter((m) => !recentSpeakerIds.includes(m.id));
  if (neverSpoken.length > 0) {
    return [...neverSpoken].sort((a, b) => a.position - b.position)[0].id;
  }

  // Least-recently-spoken: smallest index of the *last* occurrence in
  // recentSpeakerIds (oldest -> newest) means "spoke longest ago".
  let best: SpeakerCandidate | null = null;
  let bestLastIdx = Number.POSITIVE_INFINITY;
  for (const member of members) {
    const lastIdx = recentSpeakerIds.lastIndexOf(member.id);
    if (lastIdx < bestLastIdx) {
      bestLastIdx = lastIdx;
      best = member;
    }
  }
  return best ? best.id : members[0].id;
}

/** Strips a leading `Name:` or `**Name:**` prefix (case/diacritics
 * insensitive, matched via `foldForSearch`), including the optional space
 * after the colon. Leaves occurrences elsewhere in the text untouched. */
export function stripSpeakerPrefix(text: string, name: string): string {
  const foldedName = foldForSearch(name).trim();
  if (!foldedName) return text;

  const tryStrip = (prefixPattern: RegExp): string | null => {
    const match = prefixPattern.exec(text);
    if (!match) return null;
    const candidateName = match[1];
    if (foldForSearch(candidateName).trim() !== foldedName) return null;
    return text.slice(match[0].length);
  };

  // Bold form: **Name:** (with optional trailing space)
  const bold = tryStrip(/^\*\*([^*:\n]+):\*\*[ \t]?/);
  if (bold !== null) return bold;

  // Plain form: Name: (with optional trailing space)
  const plain = tryStrip(/^([^:\n*]+):[ \t]?/);
  if (plain !== null) return plain;

  return text;
}

/** Merges adjacent messages of the same role by joining their content with
 * "\n\n" — required before sending to providers with strict role
 * alternation (e.g. Claude), since group chats can produce back-to-back
 * assistant turns (plan: mergeConsecutiveRoles). */
export function mergeConsecutiveRoles(messages: PromptMessage[]): PromptMessage[] {
  const out: PromptMessage[] = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (last && last.role === msg.role) {
      last.content = `${last.content}\n\n${msg.content}`;
    } else {
      out.push({ ...msg });
    }
  }
  return out;
}
