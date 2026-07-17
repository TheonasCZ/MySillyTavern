/** Group-chat speaker selection & message shaping (plan §3). Pure, so it's
 * unit-testable without the DB/store layer. */

import type { PromptMessage } from "../prompt/promptBuilder";
import { foldForSearch } from "./searchSnippet";

export interface SpeakerCandidate {
  id: string;
  name: string;
  position: number;
}

/** Scans `lastAssistantText` for member names (fold-insensitive). When a
 * Czech addressing pronoun ("ty"/"tobě"/"ti"/"tebe"/"tě"/"tebou"/"jí"/"mu")
 * is present, it disambiguates which of several mentioned members is being
 * addressed: the name closest to (and before) the pronoun wins.  Without a
 * pronoun, the last-mentioned member name wins.  Returns null when no
 * member is found or input is empty. */
export function findAddressedMember(
  lastAssistantText: string,
  members: SpeakerCandidate[],
): string | null {
  if (!lastAssistantText || members.length === 0) return null;

  const folded = foldForSearch(lastAssistantText);

  // Collect every occurrence of every member name with its position.
  const hits: { id: string; idx: number }[] = [];
  for (const member of members) {
    const name = foldForSearch(member.name).trim();
    if (!name) continue;
    let pos = 0;
    while (true) {
      const idx = folded.indexOf(name, pos);
      if (idx === -1) break;
      hits.push({ id: member.id, idx });
      pos = idx + name.length;
    }
  }

  if (hits.length === 0) return null;

  // Czech addressing pronouns can disambiguate *which* name is addressed.
  const pronouns = ["ty", "tobě", "ti", "tebe", "tě", "tebou", "jí", "mu"];
  let pronounIdx = -1;
  for (const pronoun of pronouns) {
    const idx = folded.lastIndexOf(foldForSearch(pronoun));
    if (idx > pronounIdx) pronounIdx = idx;
  }

  if (pronounIdx >= 0) {
    // Name closest to (and before) the pronoun is the addressed member.
    let closestId: string | null = null;
    let closestDist = Number.POSITIVE_INFINITY;
    for (const h of hits) {
      if (h.idx < pronounIdx) {
        const dist = pronounIdx - h.idx;
        if (dist < closestDist) {
          closestDist = dist;
          closestId = h.id;
        }
      }
    }
    if (closestId) return closestId;
  }

  // No pronoun (or no name before it): last-mentioned name wins.
  let lastId: string | null = null;
  let lastIdx = -1;
  for (const h of hits) {
    if (h.idx > lastIdx) {
      lastIdx = h.idx;
      lastId = h.id;
    }
  }
  return lastId;
}

/** Picks the next auto-mode speaker (plan §1/§3):
 * 1. If one or more members are mentioned by name (fold-insensitive
 *    substring) in `lastUserText`, the one mentioned *last* wins.
 * 2. Otherwise, if `lastAssistantText` is provided, check whether the
 *    assistant addressed a specific member (same name-matching logic).
 * 3. Otherwise least-recently-spoken: members absent from
 *    `recentSpeakerIds` entirely go first (by `position`); among the
 *    rest, the one whose last occurrence in `recentSpeakerIds` has the
 *    smallest index (spoke longest ago) wins.
 * Returns null for an empty member list. */
export function pickNextSpeaker(
  members: SpeakerCandidate[],
  lastUserText: string,
  recentSpeakerIds: string[],
  lastAssistantText?: string,
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

  // New: assistant-addressed member before falling back to LRS.
  if (lastAssistantText) {
    const addressed = findAddressedMember(lastAssistantText, members);
    if (addressed) return addressed;
  }

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
