import {
  getChat,
} from "../db/repositories/chatsRepo";
import {
  countMessages,
  hasMoreMessages,
  listRecentMessages,
  loadOlderMessages as loadOlderMessagesFromRepo,
  MESSAGE_PAGE_SIZE,
} from "../db/repositories/messagesRepo";
import { runCanonSeed } from "../memory/canonSeed";
import { getGameOverState } from "../chat/gameOver";
import { getPendingCheckSkill } from "../chat/pendingCheck";

import type { Setter, Getter } from "./chatStoreTypes";
import { resolveConnection } from "./configOps";
import { loadMembers } from "./speakerOps";

/** Opens `chatId`: resets session state, loads the chat row/messages/roster/
 * game-over/pending-check in parallel, derives the initial speaker, and
 * kicks off canon seeding (fire-and-forget) on first open. */
export async function openChat(chatId: string, set: Setter, get: Getter): Promise<void> {
  if (get().streaming) {
    await get().stop();
  }
  set({
    chatId,
    chat: null,
    members: [],
    memberCharacters: [],
    selectedSpeakerId: null,
    autoReply: false,
    streamingSpeakerId: null,
    loading: true,
    messages: [],
    error: null,
    errorRetryable: false,
    retry: null,
    interruptedMessageIds: new Set(),
    lastPromptReport: null,
    hasOlderMessages: false,
    loadingOlderMessages: false,
    suggestions: null,
    suggesting: false,
    gameOver: null,
    pendingCheckSkill: null,
  });
  const [messages, total, chat, { members, memberCharacters }, gameOver, pendingCheckSkill] = await Promise.all([
    listRecentMessages(chatId, MESSAGE_PAGE_SIZE),
    countMessages(chatId),
    getChat(chatId),
    loadMembers(chatId),
    getGameOverState(chatId),
    getPendingCheckSkill(chatId),
  ]);
  // Ignore the result if the user has already navigated to a different
  // chat while this query was in flight.
  if (get().chatId !== chatId) return;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastAssistantIsMember =
    !!lastAssistant?.characterId && members.some((m) => m.characterId === lastAssistant.characterId);
  const selectedSpeakerId =
    lastAssistant && lastAssistantIsMember ? lastAssistant.characterId : (chat?.characterId ?? null);
  set({
    messages,
    loading: false,
    hasOlderMessages: total > messages.length,
    chat,
    members,
    memberCharacters,
    autoReply: chat?.autoReply ?? false,
    selectedSpeakerId,
    gameOver,
    pendingCheckSkill,
  });

  // Canon seeding (M25.5) — first open of a fresh chat distills 3–5 story
  // rules from the card into soft canon. Fire-and-forget; one-shot via a
  // settings marker inside runCanonSeed.
  if (chat) {
    const primary = memberCharacters.find((c) => c.id === chat.characterId) ?? memberCharacters[0];
    const seedConnection =
      resolveConnection(chat.extractionConnectionId) ?? resolveConnection(chat.connectionId);
    if (primary && seedConnection) {
      void runCanonSeed(chat.id, seedConnection, primary, chat.gameLanguage);
    }
  }
}

export async function closeChat(set: Setter, get: Getter): Promise<void> {
  const closingChatId = get().chatId;
  if (get().streaming) {
    await get().stop();
  }
  // Guard (M11 bug sweep): `stop()` awaits abort + finalize, during which
  // ChatScreen's mount effect for a *new* chat may already have called
  // `openChat` (its unmount cleanup and the next mount's effect run back
  // to back, not sequentially awaited). If that happened, `chatId` here
  // no longer belongs to us — clearing the store now would wipe out the
  // chat that's already open instead of the one we're actually closing.
  if (get().chatId !== closingChatId) return;
  set({
    chatId: null,
    chat: null,
    members: [],
    memberCharacters: [],
    selectedSpeakerId: null,
    autoReply: false,
    streamingSpeakerId: null,
    messages: [],
    loading: false,
    error: null,
    errorRetryable: false,
    retry: null,
    lastPromptReport: null,
    hasOlderMessages: false,
    loadingOlderMessages: false,
  });
}

export async function loadOlderMessages(set: Setter, get: Getter): Promise<void> {
  const { chatId, messages, hasOlderMessages, loadingOlderMessages } = get();
  if (!chatId || !hasOlderMessages || loadingOlderMessages || messages.length === 0) return;
  set({ loadingOlderMessages: true });
  try {
    const oldest = messages[0];
    const older = await loadOlderMessagesFromRepo(chatId, oldest.id, MESSAGE_PAGE_SIZE);
    if (get().chatId !== chatId) return;
    // Check whether even older messages remain after this page.
    const more = older.length > 0 ? await hasMoreMessages(chatId, older[0].id) : false;
    if (get().chatId !== chatId) return;
    set((s) => ({
      messages: [...older, ...s.messages],
      hasOlderMessages: more,
    }));
  } finally {
    set({ loadingOlderMessages: false });
  }
}
