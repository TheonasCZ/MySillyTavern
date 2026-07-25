import { create } from "zustand";

import {
  addChatMember, removeChatMember,
} from "../db/repositories/chatMembersRepo";
import {
  getChat,
  setAutoReply,
  setHardcoreMode as setChatHardcoreMode,
  setPrimaryCharacter,
} from "../db/repositories/chatsRepo";
import {
  shiftActiveSwipe,
  updateMessageContent,
} from "../db/repositories/messagesRepo";
import { setOnInventoryImageWritten } from "../memory/imageGenQueue";
import { getGameOverState } from "../chat/gameOver";
import { getPendingCheckSkill } from "../chat/pendingCheck";
import { SUGGEST_PROMPT } from "../prompt/promptTexts";
import { estimateTokens } from "../prompt/tokenEstimate";
import { chatComplete } from "../providers/chatComplete";
import type { ChatMessage } from "../providers/types";
import { logUsage } from "../db/repositories/usageRepo";

import type { ChatState } from "./chatStoreTypes";
import {
  openChat as openChatOp,
  closeChat as closeChatOp,
  loadOlderMessages as loadOlderMessagesOp,
} from "./chatLifecycleOps";
import {
  buildApiMessages,
  resolveConnection,
  applyPreset,
  clearInterrupted,
} from "./configOps";
import {
  loadMembers,
  resolveSpeaker,
} from "./speakerOps";
import {
  parseSuggestions,
  sendMessage as sendMessageOp,
  triggerSpeaker as triggerSpeakerOp,
  regenerate as regenerateOp,
  continueMessage as continueMessageOp,
} from "./messageOps";

// ── Re-exports ──────────────────────────────────────────────────────────────
export { parseSuggestions };
export type { ChatState };

export const useChatStore = create<ChatState>((set, get) => ({
  chatId: null,
  chat: null,
  members: [],
  memberCharacters: [],
  selectedSpeakerId: null,
  autoReply: false,
  streamingSpeakerId: null,
  messages: [],
  loading: false,
  streaming: false,
  streamingMessageId: null,
  streamingText: "",
  error: null,
  errorRetryable: false,
  retry: null,
  handle: null,
  pendingFinalize: null,
  interruptedMessageIds: new Set(),
  lastPromptReport: null,
  hasOlderMessages: false,
  loadingOlderMessages: false,
  suggestions: null,
  suggesting: false,
  gameOver: null,
  pendingCheckSkill: null,

  openChat: async (chatId) => openChatOp(chatId, set, get),

  closeChat: async () => closeChatOp(set, get),

  loadOlderMessages: async () => loadOlderMessagesOp(set, get),

  sendMessage: async (content) => sendMessageOp(content, set, get, refreshChatState),

  triggerSpeaker: async (speakerId) => triggerSpeakerOp(speakerId, set, get, refreshChatState),

  regenerate: async (messageId) => regenerateOp(messageId, set, get, refreshChatState),

  continueMessage: async (messageId) => continueMessageOp(messageId, set, get, refreshChatState),

  editMessage: async (messageId, content) => {
    const { messages } = get();
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    const updated = await updateMessageContent(msg, content);
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
    clearInterrupted(set, messageId);
  },

  switchSwipe: async (messageId, offset) => {
    const { messages } = get();
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    const updated = await shiftActiveSwipe(msg, offset);
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
    clearInterrupted(set, messageId);
  },

  stop: async () => {
    const { handle, pendingFinalize, streamingText } = get();
    if (!handle) return;
    // Clear immediately — not after `abort()` resolves — so a concurrent
    // `stop()` call (e.g. ChatScreen's unmount cleanup racing the next
    // chat's mount effect, both of which check `streaming` and call `stop`)
    // sees `handle: null` and no-ops instead of double-aborting the same
    // handle or running `pendingFinalize` twice (M11 bug sweep).
    set({ handle: null, pendingFinalize: null });
    await handle.abort();
    // No further channel events arrive after an abort, so finalize here —
    // it persists whatever partial text streamed in and clears `streaming`
    // once that's done (keeping the bubble visible until then). An abort
    // always counts as "interrupted" so the UI offers continue/regenerate.
    if (pendingFinalize) {
      await pendingFinalize(streamingText);
    } else {
      set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
    }
  },

  dismissError: () => set({ error: null, errorRetryable: false, retry: null }),

  /** Asks the model for 3 short ways the user could react next. Built on
   * the exact same PromptBuilder context as a normal send (ledger facts,
   * summary, lore), so suggestions know everything the character does —
   * but only runs on explicit request, so it costs tokens only when used.
   * Uses the currently selected speaker (or the primary member) purely to
   * pick whose "voice"/context frames the suggestions — the suggestions
   * themselves are always written for the player. */
  suggestReplies: async () => {
    const { chatId, messages, streaming, suggesting, memberCharacters, selectedSpeakerId } = get();
    if (!chatId || streaming || suggesting || messages.length === 0) return;

    const chat = await getChat(chatId);
    if (!chat) return;
    // Guard (M11 bug sweep): `getChat` above already yielded once — bail
    // out if the user has since switched chats, rather than flipping
    // `suggesting` on for whatever chat is now open.
    if (get().chatId !== chatId) return;
    const connection = resolveConnection(chat.connectionId);
    if (!connection) {
      set({ error: "no-connection", errorRetryable: false, retry: null });
      return;
    }

    set({ suggesting: true, suggestions: null });
    try {
      const speaker = await resolveSpeaker(chat, memberCharacters, selectedSpeakerId);
      if (!speaker) return;
      const { messages: baseApiMessages, presetParams } = await buildApiMessages(chat, messages, speaker, memberCharacters);
      const effectiveConnection = applyPreset(connection, presetParams);
      const apiMessages: ChatMessage[] = [
        ...baseApiMessages,
        {
          role: "user",
          content: SUGGEST_PROMPT(chat.gameLanguage ?? "cs"),
        },
      ];
      const reply = await chatComplete(effectiveConnection, apiMessages);
      const inputTokens = apiMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      void logUsage("suggest", connection.id, inputTokens, estimateTokens(reply), chatId).catch(() => {});
      const suggestions = parseSuggestions(reply);
      // Guard (M11 bug sweep): this is a long-running network call — if the
      // user switched to a different chat while it was in flight, don't
      // drop these suggestions (or the `suggesting`/error state below) onto
      // whatever chat is now open.
      if (get().chatId === chatId) set({ suggestions });
    } catch (err) {
      if (get().chatId === chatId) set({ error: String(err), errorRetryable: false, retry: null });
    } finally {
      if (get().chatId === chatId) set({ suggesting: false });
    }
  },

  clearSuggestions: () => set({ suggestions: null }),

  addMember: async (characterId) => {
    const { chatId } = get();
    if (!chatId) return;
    await addChatMember(chatId, characterId);
    const { members, memberCharacters } = await loadMembers(chatId);
    set({ members, memberCharacters });
  },

  removeMember: async (characterId) => {
    const { chatId, chat, members } = get();
    if (!chatId || !chat || members.length <= 1) return false;

    let primaryId = chat.characterId;
    if (primaryId === characterId) {
      const next = members.find((m) => m.characterId !== characterId);
      if (!next) return false;
      await setPrimaryCharacter(chatId, next.characterId);
      primaryId = next.characterId;
    }

    await removeChatMember(chatId, characterId);
    const { members: nextMembers, memberCharacters } = await loadMembers(chatId);
    set((s) => ({
      chat: { ...chat, characterId: primaryId },
      members: nextMembers,
      memberCharacters,
      selectedSpeakerId: s.selectedSpeakerId === characterId ? primaryId : s.selectedSpeakerId,
    }));
    return true;
  },

  setAutoReplyMode: async (on) => {
    const { chatId, chat } = get();
    if (!chatId) return;
    await setAutoReply(chatId, on);
    set({ autoReply: on, chat: chat ? { ...chat, autoReply: on } : chat });
  },

  setHardcoreMode: async (on) => {
    const { chatId, chat } = get();
    if (!chatId) return;
    await setChatHardcoreMode(chatId, on);
    set({ chat: chat ? { ...chat, hardcoreMode: on } : chat });
  },

  setSelectedSpeaker: (id) => set({ selectedSpeakerId: id }),
}));

/** Re-fetches the whole chat row and updates the in-memory store so
 *  components reading `chat.inventory`/`chat.skills`/`chat.conditions`/
 *  `chat.xp`/`chat.level` (e.g. InventoryPanel) re-render with fresh data
 *  after a DB write that bypassed the store (game-tag processing, or an
 *  async illustration write landing later). Since this re-fetches the full
 *  row via `getChat`, it covers every chat-scoped live-gameplay field at
 *  once — no need for a field-specific refresh. Guards against a stale
 *  refresh landing after the user has switched to a different chat. */
async function refreshChatState(chatId: string): Promise<void> {
  if (useChatStore.getState().chatId !== chatId) return;
  const [freshChat, gameOver, pendingCheckSkill] = await Promise.all([
    getChat(chatId),
    getGameOverState(chatId),
    getPendingCheckSkill(chatId),
  ]);
  if (freshChat && useChatStore.getState().chatId === chatId) {
    useChatStore.setState({ chat: freshChat, gameOver, pendingCheckSkill });
  }
}

// Wired here (a runtime registration) rather than a static import of
// useChatStore inside imageGenQueue.ts, to avoid a circular import:
// chatStore already depends on imageGenQueue transitively via memoryEngine.
setOnInventoryImageWritten(refreshChatState);
