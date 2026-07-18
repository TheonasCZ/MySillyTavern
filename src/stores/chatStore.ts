import { create } from "zustand";

import type { Character } from "../db/repositories/charactersRepo";
import {
  addChatMember, removeChatMember,
} from "../db/repositories/chatMembersRepo";
import {
  getChat,
  setAutoReply,
  setHardcoreMode as setChatHardcoreMode,
  setPrimaryCharacter,
  touchChat,
  type Chat,
} from "../db/repositories/chatsRepo";
import {
  appendSwipe,
  countMessages,
  createMessage,
  hasMoreMessages,
  listRecentMessages,
  loadOlderMessages as loadOlderMessagesFromRepo,
  MESSAGE_PAGE_SIZE,
  shiftActiveSwipe,
  updateMessageContent,
  type Message,
} from "../db/repositories/messagesRepo";
import {
  stripSpeakerPrefix,
} from "../chat/groupSpeaker";
import { runCanonSeed } from "../memory/canonSeed";
import { scheduleMemoryWork } from "../memory/memoryEngine";
import { setOnInventoryImageWritten } from "../memory/imageGenQueue";
import { getGameOverState } from "../chat/gameOver";
import { getPendingCheckSkill, clearPendingCheckSkill } from "../chat/pendingCheck";
import { parseChangeSummary, serializeChangeSummary } from "../chat/changeSummary";
import { applyRegexRules } from "../chat/regexTransform";
import { CONTINUE_AS, CONTINUE_EXACT, CONTINUE_EXACT_SOLO, SUGGEST_PROMPT } from "../prompt/promptTexts";
import { estimateTokens } from "../prompt/tokenEstimate";
import { chatComplete } from "../providers/chatComplete";
import type { ChatMessage } from "../providers/types";
import { logUsage } from "../db/repositories/usageRepo";

import type { ChatState } from "./chatStoreTypes";
import {
  buildApiMessages,
  resolveConnection,
  applyPreset,
  clearInterrupted,
  markInterrupted,
} from "./configOps";
import {
  loadMembers,
  resolveSpeaker,
  pickSpeakerId,
} from "./speakerOps";
import {
  scheduleVoiceEmbedding,
} from "./extractionOps";
import {
  startStream,
  parseSuggestions,
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

  openChat: async (chatId) => {
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
  },

  closeChat: async () => {
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
  },

  loadOlderMessages: async () => {
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
  },

  sendMessage: async (content) => {
    const trimmed = content.trim();
    const { chatId, messages, streaming, members, memberCharacters, autoReply, selectedSpeakerId, gameOver } = get();
    if (!chatId || !trimmed || streaming || gameOver) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      set({ error: "offline", errorRetryable: true, retry: () => void get().sendMessage(content) });
      return;
    }

    const chat = await getChat(chatId);
    if (!chat) return;
    const connection = resolveConnection(chat.connectionId);
    if (!connection) {
      set({ error: "no-connection", errorRetryable: false, retry: null });
      return;
    }

    // A [CHECK:...] hint only applies to the very next message, used or not
    // — clear it now so a stale skill name from several turns ago can't
    // attach itself to some unrelated later roll.
    if (get().pendingCheckSkill) {
      set({ pendingCheckSkill: null });
      void clearPendingCheckSkill(chatId);
    }

    const speakerId = pickSpeakerId(chat, members, memberCharacters, autoReply, selectedSpeakerId, trimmed, messages);
    const speaker = await resolveSpeaker(chat, memberCharacters, speakerId);
    if (!speaker) return;

    const userMessage = await createMessage(chatId, "user", trimmed);
    set((s) => ({ messages: [...s.messages, userMessage], suggestions: null }));
    void touchChat(chatId);

    const { messages: apiMessages, report, regexRules, presetParams } = await buildApiMessages(
      chat,
      [...messages, userMessage],
      speaker,
      memberCharacters,
    );
    set({ lastPromptReport: report, streamingSpeakerId: speaker.id });

    const effectiveConnection = applyPreset(connection, presetParams);

    const finalize = async (text: string, interrupted: boolean, changeSummary: string | null = null) => {
      let finalText = stripSpeakerPrefix(text.trim(), speaker.name).trim();
      finalText = applyRegexRules(finalText, regexRules ?? "");
      if (finalText) {
        const assistantMessage = await createMessage(chatId, "assistant", finalText, speaker.id, changeSummary);
        // Guard (M11 bug sweep): the user may have switched/closed the chat
        // while this stream was finalizing (abort + persist is async) — only
        // splice the new message into `messages`/`selectedSpeakerId` if this
        // is still the chat that's open, so a stale reply can't land in
        // whatever chat is now showing. The DB write above is unconditional
        // (it's addressed by `chatId`, always correct regardless of what's
        // on screen).
        if (get().chatId === chatId) {
          set((s) => ({ messages: [...s.messages, assistantMessage], selectedSpeakerId: speaker.id }));
          if (interrupted) markInterrupted(set, assistantMessage.id);
        }
        void touchChat(chatId);
        // Fire-and-forget: decides on its own whether extraction/summary is
        // actually due, never throws, never blocks the chat (plan §6.3).
        if (!interrupted) scheduleMemoryWork(chatId);
        // Store voice embedding for style-consistency lookups (every 3rd
        // assistant message). Fire-and-forget, never blocks.
        const embConn = resolveConnection(chat.extractionConnectionId) ?? connection;
        void scheduleVoiceEmbedding(chatId, assistantMessage.id, finalText, embConn);
      }
      set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
    };

    // Retrying re-sends the exact same already-persisted user message
    // rather than calling `sendMessage` again (which would duplicate it) —
    // it re-resolves the connection/prompt in case anything changed and
    // restarts the stream from scratch. The chosen speaker stays the same.
    const retry = () => {
      void (async () => {
        const freshChat = await getChat(chatId);
        const freshConnection = freshChat ? resolveConnection(freshChat.connectionId) : null;
        if (!freshChat || !freshConnection) {
          set({ error: "no-connection", errorRetryable: false, retry: null });
          return;
        }
        const { messages: retryApiMessages, report: retryReport, regexRules: _retryRegexRules, presetParams: retryPresetParams } = await buildApiMessages(
          freshChat,
          get().messages,
          speaker,
          get().memberCharacters,
        );
        const retryConn = applyPreset(freshConnection, retryPresetParams);
        set({ lastPromptReport: retryReport, streamingSpeakerId: speaker.id });
        startStream(retryConn, retryApiMessages, set, get, finalize, retry, refreshChatState);
      })();
    };

    startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
  },

  /** "Reply now" for a group chat — the picked member reacts without a new
   * player message. Reuses `buildApiMessages` for the current history, then
   * appends a nudge asking that member specifically to continue the scene
   * (plan §5). */
  triggerSpeaker: async (speakerId) => {
    const { chatId, messages, streaming, memberCharacters, gameOver } = get();
    if (!chatId || streaming || gameOver) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      set({ error: "offline", errorRetryable: true, retry: () => void get().triggerSpeaker(speakerId) });
      return;
    }

    const chat = await getChat(chatId);
    if (!chat) return;
    const connection = resolveConnection(chat.connectionId);
    if (!connection) {
      set({ error: "no-connection", errorRetryable: false, retry: null });
      return;
    }

    const speaker = await resolveSpeaker(chat, memberCharacters, speakerId);
    if (!speaker) return;

    const buildTriggerMessages = async (freshChat: Chat, history: Message[], members: Character[]) => {
      const { messages: baseApiMessages, report, regexRules: rr, presetParams: pp } = await buildApiMessages(freshChat, history, speaker, members);
      const apiMessages: ChatMessage[] = [
        ...baseApiMessages,
        { role: "user", content: CONTINUE_AS(speaker.name) },
      ];
      return { apiMessages, report, regexRules: rr, presetParams: pp };
    };

    const { apiMessages, report, regexRules, presetParams } = await buildTriggerMessages(chat, messages, memberCharacters);
    const effectiveConnection = applyPreset(connection, presetParams);
    set({ lastPromptReport: report, streamingSpeakerId: speaker.id });

    const finalize = async (text: string, interrupted: boolean, changeSummary: string | null = null) => {
      let finalText = stripSpeakerPrefix(text.trim(), speaker.name).trim();
      finalText = applyRegexRules(finalText, regexRules ?? "");
      if (finalText) {
        const assistantMessage = await createMessage(chatId, "assistant", finalText, speaker.id, changeSummary);
        // Guard (M11 bug sweep) — see sendMessage's `finalize` for rationale.
        if (get().chatId === chatId) {
          set((s) => ({ messages: [...s.messages, assistantMessage], selectedSpeakerId: speaker.id }));
          if (interrupted) markInterrupted(set, assistantMessage.id);
        }
        void touchChat(chatId);
        if (!interrupted) scheduleMemoryWork(chatId);
        const embConn2 = resolveConnection(chat.extractionConnectionId) ?? connection;
        void scheduleVoiceEmbedding(chatId, assistantMessage.id, finalText, embConn2);
      }
      set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
    };

    const retry = () => {
      void (async () => {
        const freshChat = await getChat(chatId);
        const freshConnection = freshChat ? resolveConnection(freshChat.connectionId) : null;
        if (!freshChat || !freshConnection) {
          set({ error: "no-connection", errorRetryable: false, retry: null });
          return;
        }
        const { apiMessages: retryApiMessages, report: retryReport, regexRules: _retryRegexRules, presetParams: retryPresetParams } = await buildTriggerMessages(
          freshChat,
          get().messages,
          get().memberCharacters,
        );
        const retryConn = applyPreset(freshConnection, retryPresetParams);
        set({ lastPromptReport: retryReport, streamingSpeakerId: speaker.id });
        startStream(retryConn, retryApiMessages, set, get, finalize, retry, refreshChatState);
      })();
    };

    startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
  },

  regenerate: async (messageId) => {
    const { chatId, messages, streaming, memberCharacters, gameOver } = get();
    if (!chatId || streaming || gameOver) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      set({ error: "offline", errorRetryable: true, retry: () => void get().regenerate(messageId) });
      return;
    }

    const chat = await getChat(chatId);
    if (!chat) return;
    const connection = resolveConnection(chat.connectionId);
    if (!connection) {
      set({ error: "no-connection", errorRetryable: false, retry: null });
      return;
    }

    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const target = messages[idx];
    // The message's own author (falling back to the primary member) speaks
    // again — regenerating never reassigns authorship (plan §5).
    const speaker = await resolveSpeaker(chat, memberCharacters, target.characterId);
    if (!speaker) return;

    const { messages: apiMessages, report, regexRules, presetParams } = await buildApiMessages(
      chat,
      messages.slice(0, idx),
      speaker,
      memberCharacters,
    );
    const effectiveConnection = applyPreset(connection, presetParams);
    set({ lastPromptReport: report, streamingMessageId: messageId, streamingSpeakerId: speaker.id });
    clearInterrupted(set, messageId);

    const finalize = async (text: string, interrupted: boolean, changeSummary: string | null = null) => {
      let finalText = stripSpeakerPrefix(text.trim(), speaker.name).trim();
      finalText = applyRegexRules(finalText, regexRules ?? "");
      if (finalText) {
        const updated = await appendSwipe(target, finalText, changeSummary);
        // Guard (M11 bug sweep) — see sendMessage's `finalize` for rationale;
        // `messages` here belongs to whatever chat is currently open, so
        // mapping over it after a chat switch would touch the wrong list.
        if (get().chatId === chatId) {
          set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
          if (interrupted) markInterrupted(set, messageId);
        }
        void touchChat(chatId);
        if (!interrupted) scheduleMemoryWork(chatId);
        const embConn3 = resolveConnection(chat.extractionConnectionId) ?? connection;
        void scheduleVoiceEmbedding(chatId, messageId, finalText, embConn3);
      }
      set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
    };

    const retry = () => {
      set({ streamingMessageId: messageId, streamingSpeakerId: speaker.id });
      startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
    };

    startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
  },

  /** Resumes an interrupted assistant message: sends the history up to and
   * including its current (partial) content, asks the model to continue
   * exactly where it left off, and appends the result to the existing
   * swipe content (rather than creating a new variant) — the "continue"
   * half of the "continue/regenerate" pair required by plan §9. Authorship
   * never changes (plan §5). */
  continueMessage: async (messageId) => {
    const { chatId, messages, streaming, memberCharacters, gameOver } = get();
    if (!chatId || streaming || gameOver) return;
    const chat = await getChat(chatId);
    if (!chat) return;
    const connection = resolveConnection(chat.connectionId);
    if (!connection) {
      set({ error: "no-connection", errorRetryable: false, retry: null });
      return;
    }

    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const target = messages[idx];
    const speaker = await resolveSpeaker(chat, memberCharacters, target.characterId);
    if (!speaker) return;
    const isGroup = memberCharacters.length > 1;

    const priorHistory = messages.slice(0, idx);
    const { messages: baseApiMessages, regexRules, presetParams } = await buildApiMessages(chat, priorHistory, speaker, memberCharacters);
    const effectiveConnection = applyPreset(connection, presetParams);
    const continueInstruction = isGroup
      ? CONTINUE_EXACT(speaker.name)
      : CONTINUE_EXACT_SOLO;
    const apiMessages: ChatMessage[] = [
      ...baseApiMessages,
      { role: "assistant", content: target.content },
      { role: "user", content: continueInstruction },
    ];

    set({ streamingMessageId: messageId, streamingText: "", streamingSpeakerId: speaker.id });

    const finalize = async (text: string, interrupted: boolean, changeSummary: string | null = null) => {
      let addition = stripSpeakerPrefix(text.trim(), speaker.name).trim();
      addition = applyRegexRules(addition, regexRules ?? "");
      const combined = addition ? `${target.content}${/\s$/.test(target.content) ? "" : " "}${addition}` : target.content;
      // Guard (M11 bug sweep) — see sendMessage's `finalize` for rationale.
      const stillCurrentChat = get().chatId === chatId;
      if (addition) {
        // Continuing picks up wherever the original reply's tags left off —
        // merge rather than replace, so the footer still reflects the part
        // that was already there.
        const mergedSummary = serializeChangeSummary([
          ...parseChangeSummary(target.changeSummary),
          ...parseChangeSummary(changeSummary),
        ]);
        const updated = await updateMessageContent(target, combined, mergedSummary);
        if (stillCurrentChat) {
          set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
        }
      }
      if (stillCurrentChat) {
        if (interrupted) {
          markInterrupted(set, messageId);
        } else {
          clearInterrupted(set, messageId);
        }
      }
      if (!interrupted) scheduleMemoryWork(chatId);
      void touchChat(chatId);
      const embConn4 = resolveConnection(chat.extractionConnectionId) ?? connection;
      void scheduleVoiceEmbedding(chatId, messageId, combined, embConn4);
      set({ streaming: false, streamingText: "", streamingMessageId: null, streamingSpeakerId: null });
    };

    const retry = () => {
      set({ streamingMessageId: messageId, streamingText: "", streamingSpeakerId: speaker.id });
      startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
    };

    startStream(effectiveConnection, apiMessages, set, get, finalize, retry, refreshChatState);
  },

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
      void logUsage("suggest", connection.id, inputTokens, estimateTokens(reply)).catch(() => {});
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
