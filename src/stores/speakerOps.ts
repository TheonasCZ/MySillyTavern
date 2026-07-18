import { getCharacter, type Character } from "../db/repositories/charactersRepo";
import {
  listChatMembers,
  type ChatMember,
} from "../db/repositories/chatMembersRepo";
import {
  type Chat,
} from "../db/repositories/chatsRepo";
import {
  type Message,
} from "../db/repositories/messagesRepo";
import {
  pickNextSpeaker,
  type SpeakerCandidate,
} from "../chat/groupSpeaker";

/** Loads a chat's roster (`chat_members`) and the corresponding character
 *  cards, in roster order — characters that failed to load (deleted card)
 *  are skipped rather than breaking the whole load (plan §5). */
export async function loadMembers(chatId: string): Promise<{ members: ChatMember[]; memberCharacters: Character[] }> {
  const members = await listChatMembers(chatId);
  const loaded = await Promise.all(members.map((m) => getCharacter(m.characterId)));
  const memberCharacters = loaded.filter((c): c is Character => !!c);
  return { members, memberCharacters };
}

/** Resolves a speaker id (may be null/stale/not-yet-a-member) to a full
 *  `Character`, falling back to the chat's primary member, and — as a last
 *  resort, e.g. a cold `memberCharacters` cache — to a direct DB lookup
 *  (mirrors the pre-M10 "character couldn't load" degrade path). */
export async function resolveSpeaker(
  chat: Chat,
  memberCharacters: Character[],
  speakerId: string | null,
): Promise<Character | null> {
  const wantedId = speakerId ?? chat.characterId;
  const found = memberCharacters.find((c) => c.id === wantedId)
    ?? memberCharacters.find((c) => c.id === chat.characterId);
  if (found) return found;
  return getCharacter(wantedId);
}

/** Builds `{id, name, position}` candidates for `pickNextSpeaker` from the
 *  roster + loaded character cards (a member whose card failed to load gets
 *  an empty name — it simply can't be mention-matched by name). */
export function speakerCandidates(members: ChatMember[], memberCharacters: Character[]): SpeakerCandidate[] {
  const nameById = new Map(memberCharacters.map((c) => [c.id, c.name]));
  return members.map((m) => ({ id: m.characterId, name: nameById.get(m.characterId) ?? "", position: m.position }));
}

/** Chronological (oldest -> newest) authorship of assistant messages, with
 *  legacy/solo rows (`characterId === null`) attributed to the chat's
 *  primary member — the "recently spoken" signal for auto mode. */
export function recentSpeakerIds(chat: Chat, history: Message[]): string[] {
  return history.filter((m) => m.role === "assistant").map((m) => m.characterId ?? chat.characterId);
}

/** Picks who replies next: explicit selection in manual mode, or
 *  `pickNextSpeaker` (name mention / least-recently-spoken) in auto mode
 *  (plan §5). Always falls back to the chat's primary member. */
export function pickSpeakerId(
  chat: Chat,
  members: ChatMember[],
  memberCharacters: Character[],
  autoReply: boolean,
  selectedSpeakerId: string | null,
  lastUserText: string,
  history: Message[],
): string {
  if (!autoReply) return selectedSpeakerId ?? chat.characterId;
  const picked = pickNextSpeaker(
    speakerCandidates(members, memberCharacters),
    lastUserText,
    recentSpeakerIds(chat, history),
  );
  return picked ?? selectedSpeakerId ?? chat.characterId;
}
