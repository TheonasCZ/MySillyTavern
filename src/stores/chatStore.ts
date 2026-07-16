import { create } from "zustand";

import { getCharacter } from "../db/repositories/charactersRepo";
import { getChat, touchChat, type Chat } from "../db/repositories/chatsRepo";
import { listActiveFacts } from "../db/repositories/ledgerRepo";
import { listActivatableEntries } from "../db/repositories/lorebooksRepo";
import {
  appendSwipe,
  countMessages,
  createMessage,
  listOlderMessages,
  listRecentMessages,
  MESSAGE_PAGE_SIZE,
  shiftActiveSwipe,
  updateMessageContent,
  type Message,
} from "../db/repositories/messagesRepo";
import { getDefaultPersona, getPersona, type Persona } from "../db/repositories/personasRepo";
import { getSetting } from "../db/repositories/settingsRepo";
import { getSummary } from "../db/repositories/summariesRepo";
import { selectActiveEntries, type LoreEntryLike } from "../lorebooks/activation";
import { canEmbed, retrieveSemanticContext } from "../memory/embeddingsEngine";
import { scheduleMemoryWork } from "../memory/memoryEngine";
import { buildPrompt, DEFAULT_VERBATIM_WINDOW, type PromptReport } from "../prompt/promptBuilder";
import { chatComplete } from "../providers/chatComplete";
import { chatStream, type ChatStreamHandle } from "../providers/chatStream";
import type { ChatMessage, ConnectionConfig } from "../providers/types";
import { useConnectionsStore } from "./connectionsStore";

function toApiMessages(messages: Message[]): ChatMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/** The chat's own persona if it has one selected, otherwise the app-wide
 * default persona (if any) — same fallback as the plan describes for
 * "persona per chat" (§7 M4). */
async function resolveChatPersona(chat: Chat): Promise<Persona | null> {
  if (chat.personaId) {
    const persona = await getPersona(chat.personaId);
    if (persona) return persona;
  }
  return getDefaultPersona();
}

/** Builds the full API message array via PromptBuilder: character +
 * persona + ledger facts + summary + activated lore + a trimmed verbatim
 * window of `history`, cut to the connection's `context_budget` (plan
 * §6.2). Returns the report alongside so the memory panel's "Prompt" tab
 * can show exactly what the last request contained. Silently falls back to
 * plain history (no system message, no report) when the character can't be
 * loaded, so a degraded chat still limps along instead of failing to send. */
async function buildApiMessages(
  chat: Chat,
  history: Message[],
): Promise<{ messages: ChatMessage[]; report: PromptReport | null }> {
  const character = await getCharacter(chat.characterId);
  if (!character) return { messages: toApiMessages(history), report: null };

  const persona = await resolveChatPersona(chat);

  let loreEntries: LoreEntryLike[] = [];
  let activatableLore: LoreEntryLike[] = [];
  try {
    const [activatable, scanDepthSetting, tokenBudgetSetting] = await Promise.all([
      listActivatableEntries(chat.characterId, chat.id),
      getSetting("lore_scan_depth"),
      getSetting("lore_token_budget"),
    ]);
    activatableLore = activatable;
    loreEntries = selectActiveEntries(
      activatable,
      history.map((m) => m.content),
      {
        scanDepth: scanDepthSetting ? Number(scanDepthSetting) : undefined,
        tokenBudget: tokenBudgetSetting ? Number(tokenBudgetSetting) : undefined,
      },
    );
  } catch (err) {
    console.warn("lorebook activation failed", err);
  }

  let ledgerFacts: Awaited<ReturnType<typeof listActiveFacts>> = [];
  let summaryText: string | null = null;
  try {
    const [facts, summary] = await Promise.all([listActiveFacts(chat.id), getSummary(chat.id)]);
    ledgerFacts = facts;
    summaryText = summary?.text ?? null;
  } catch (err) {
    console.warn("loading ledger/summary failed", err);
  }

  const connection = resolveConnection(chat.connectionId);
  const verbatimWindowSetting = await getSetting("verbatim_window").catch(() => null);
  const verbatimWindow = verbatimWindowSetting ? Number(verbatimWindowSetting) : DEFAULT_VERBATIM_WINDOW;

  // Semantic retrieval (M7/M8): one embedding call over the conversation
  // tail scores everything stored — facts get a relevance-aware trim order,
  // the top-K older scenes come back as `[RELEVANTNÍ VZPOMÍNKY]`, and lore
  // entries can activate semantically on top of keyword hits. Any failure
  // (offline, Claude connection, nothing embedded yet) silently degrades to
  // the non-semantic behavior.
  let factRelevance: Record<string, number> | undefined;
  let retrievedMemories: string[] = [];
  const embeddingConnection = resolveConnection(chat.extractionConnectionId) ?? connection;
  if (canEmbed(embeddingConnection)) {
    try {
      const selectedIds = new Set(loreEntries.map((e) => e.id));
      const context = await retrieveSemanticContext({
        chatId: chat.id,
        connection: embeddingConnection,
        queryTexts: history.slice(-3).map((m) => m.content),
        candidateLoreIds: activatableLore.filter((e) => !selectedIds.has(e.id)).map((e) => e.id),
      });
      factRelevance = context.factRelevance;
      retrievedMemories = context.memories;
      if (context.loreEntryIds.length > 0) {
        const byId = new Map(activatableLore.map((e) => [e.id, e]));
        loreEntries = [
          ...loreEntries,
          ...context.loreEntryIds
            .map((id) => byId.get(id))
            .filter((e): e is LoreEntryLike => !!e),
        ];
      }
    } catch (err) {
      console.warn("semantic retrieval failed", err);
    }
  }

  const { messages, report } = buildPrompt({
    character,
    persona,
    ledgerFacts,
    summary: summaryText,
    loreEntries,
    history: toApiMessages(history),
    contextBudget: connection?.contextBudget ?? 8000,
    verbatimWindow,
    factRelevance,
    retrievedMemories,
  });

  return { messages, report };
}

type Setter = (
  partial:
    | Partial<ChatState>
    | ((state: ChatState) => Partial<ChatState>),
) => void;
type Getter = () => ChatState;

function startStream(
  connection: ConnectionConfig,
  apiMessages: ChatMessage[],
  set: Setter,
  get: Getter,
  finalize: (content: string, interrupted: boolean) => Promise<void>,
  retry: () => void,
) {
  set({
    streaming: true,
    streamingText: "",
    error: null,
    errorRetryable: false,
    retry: null,
    // Only invoked by `stop()` (manual abort) — always a partial response,
    // so it's always flagged as interrupted.
    pendingFinalize: (text) => finalize(text, true),
  });

  // `streaming` stays true until `finalize` has actually persisted the
  // message and updated `messages` — clearing it earlier would make the
  // streaming bubble disappear for a frame before the real message row
  // takes its place.
  const handle: ChatStreamHandle = chatStream(connection, apiMessages, {
    onToken: (text) => {
      set((s) => ({ streamingText: s.streamingText + text }));
    },
    onDone: () => {
      const text = get().streamingText;
      set({ handle: null, pendingFinalize: null });
      void finalize(text, false);
    },
    onError: (err) => {
      const text = get().streamingText;
      const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
      set({
        handle: null,
        pendingFinalize: null,
        error: isOffline ? "offline" : err.message,
        errorRetryable: isOffline || err.retryable,
        retry: isOffline || err.retryable ? retry : null,
      });
      // A stream that errored out mid-response still leaves useful partial
      // text — persist it (flagged as interrupted) instead of discarding it,
      // so the user can pick it up with "continue"/"regenerate" (plan §9).
      void finalize(text, true);
    },
  });

  set({ handle });
}

interface ChatState {
  chatId: string | null;
  messages: Message[];
  loading: boolean;
  streaming: boolean;
  /** Set while regenerating an existing assistant message; null while
   * streaming a brand new message. */
  streamingMessageId: string | null;
  streamingText: string;
  error: string | null;
  /** Whether `error` came from a retryable failure (429/5xx from the
   * provider, or the app being offline) — drives the "Try again" button in
   * the chat error banner (plan §9). */
  errorRetryable: boolean;
  /** Re-runs whatever request just failed, when `errorRetryable` is true. */
  retry: (() => void) | null;
  handle: ChatStreamHandle | null;
  pendingFinalize: ((content: string) => Promise<void>) | null;
  /** Ids of assistant messages whose stored content is a partial response
   * (stream was aborted or errored mid-way) — surfaces a "continue" action
   * in the UI instead of silently presenting a truncated reply as final
   * (plan §9). Cleared once the message is edited, regenerated, or
   * continued. Session-only (not persisted), since it only matters for the
   * chat currently open. */
  interruptedMessageIds: Set<string>;
  /** Report from the last PromptBuilder call for this chat — what exactly
   * went to the model, token counts, what got trimmed. Shown in the memory
   * panel's "Prompt" tab (plan §7 M5). Null until a message has been sent
   * (or if the character couldn't be loaded). */
  lastPromptReport: PromptReport | null;
  /** Whether there are older messages in the DB beyond what's currently
   * loaded — drives MessageList's "load older" affordance for long chats
   * (plan §9: paginate, load last 100, scroll-up fetches more). */
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  /** On-demand reply suggestions ("what could {{user}} do next") — filled by
   * `suggestReplies`, cleared when a message is sent or the chat changes.
   * Opt-in per press so it never burns tokens unasked (plan follow-up). */
  suggestions: string[] | null;
  suggesting: boolean;

  openChat: (chatId: string) => Promise<void>;
  closeChat: () => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  continueMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  switchSwipe: (messageId: string, offset: number) => Promise<void>;
  stop: () => Promise<void>;
  dismissError: () => void;
  suggestReplies: () => Promise<void>;
  clearSuggestions: () => void;
}

function resolveConnection(connectionId: string | null): ConnectionConfig | null {
  if (!connectionId) return null;
  return useConnectionsStore.getState().connections.find((c) => c.id === connectionId) ?? null;
}

function clearInterrupted(set: Setter, messageId: string) {
  set((s) => {
    if (!s.interruptedMessageIds.has(messageId)) return {};
    const next = new Set(s.interruptedMessageIds);
    next.delete(messageId);
    return { interruptedMessageIds: next };
  });
}

function markInterrupted(set: Setter, messageId: string) {
  set((s) => {
    const next = new Set(s.interruptedMessageIds);
    next.add(messageId);
    return { interruptedMessageIds: next };
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  chatId: null,
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

  openChat: async (chatId) => {
    if (get().streaming) {
      await get().stop();
    }
    set({
      chatId,
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
    });
    const [messages, total] = await Promise.all([
      listRecentMessages(chatId, MESSAGE_PAGE_SIZE),
      countMessages(chatId),
    ]);
    // Ignore the result if the user has already navigated to a different
    // chat while this query was in flight.
    if (get().chatId !== chatId) return;
    set({ messages, loading: false, hasOlderMessages: total > messages.length });
  },

  closeChat: async () => {
    if (get().streaming) {
      await get().stop();
    }
    set({
      chatId: null,
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
      const older = await listOlderMessages(chatId, oldest.createdAt, MESSAGE_PAGE_SIZE);
      if (get().chatId !== chatId) return;
      set((s) => ({
        messages: [...older, ...s.messages],
        hasOlderMessages: older.length === MESSAGE_PAGE_SIZE,
      }));
    } finally {
      set({ loadingOlderMessages: false });
    }
  },

  sendMessage: async (content) => {
    const trimmed = content.trim();
    const { chatId, messages, streaming } = get();
    if (!chatId || !trimmed || streaming) return;
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

    const userMessage = await createMessage(chatId, "user", trimmed);
    set((s) => ({ messages: [...s.messages, userMessage], suggestions: null }));
    void touchChat(chatId);

    const { messages: apiMessages, report } = await buildApiMessages(chat, [...messages, userMessage]);
    set({ lastPromptReport: report });

    const finalize = async (text: string, interrupted: boolean) => {
      const finalText = text.trim();
      if (finalText) {
        const assistantMessage = await createMessage(chatId, "assistant", finalText);
        set((s) => ({ messages: [...s.messages, assistantMessage] }));
        if (interrupted) markInterrupted(set, assistantMessage.id);
        void touchChat(chatId);
        // Fire-and-forget: decides on its own whether extraction/summary is
        // actually due, never throws, never blocks the chat (plan §6.3).
        if (!interrupted) scheduleMemoryWork(chatId);
      }
      set({ streaming: false, streamingText: "", streamingMessageId: null });
    };

    // Retrying re-sends the exact same already-persisted user message
    // rather than calling `sendMessage` again (which would duplicate it) —
    // it re-resolves the connection/prompt in case anything changed and
    // restarts the stream from scratch.
    const retry = () => {
      void (async () => {
        const freshChat = await getChat(chatId);
        const freshConnection = freshChat ? resolveConnection(freshChat.connectionId) : null;
        if (!freshChat || !freshConnection) {
          set({ error: "no-connection", errorRetryable: false, retry: null });
          return;
        }
        const { messages: retryApiMessages, report: retryReport } = await buildApiMessages(freshChat, [
          ...get().messages,
        ]);
        set({ lastPromptReport: retryReport });
        startStream(freshConnection, retryApiMessages, set, get, finalize, retry);
      })();
    };

    startStream(connection, apiMessages, set, get, finalize, retry);
  },

  regenerate: async (messageId) => {
    const { chatId, messages, streaming } = get();
    if (!chatId || streaming) return;
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
    const { messages: apiMessages, report } = await buildApiMessages(chat, messages.slice(0, idx));
    set({ lastPromptReport: report });

    set({ streamingMessageId: messageId });
    clearInterrupted(set, messageId);

    const finalize = async (text: string, interrupted: boolean) => {
      const finalText = text.trim();
      if (finalText) {
        const updated = await appendSwipe(target, finalText);
        set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
        if (interrupted) markInterrupted(set, messageId);
        void touchChat(chatId);
        if (!interrupted) scheduleMemoryWork(chatId);
      }
      set({ streaming: false, streamingText: "", streamingMessageId: null });
    };

    const retry = () => {
      set({ streamingMessageId: messageId });
      startStream(connection, apiMessages, set, get, finalize, retry);
    };

    startStream(connection, apiMessages, set, get, finalize, retry);
  },

  /** Resumes an interrupted assistant message: sends the history up to and
   * including its current (partial) content, asks the model to continue
   * exactly where it left off, and appends the result to the existing
   * swipe content (rather than creating a new variant) — the "continue"
   * half of the "continue/regenerate" pair required by plan §9. */
  continueMessage: async (messageId) => {
    const { chatId, messages, streaming } = get();
    if (!chatId || streaming) return;
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
    const priorHistory = messages.slice(0, idx);
    const { messages: baseApiMessages } = await buildApiMessages(chat, priorHistory);
    const apiMessages: ChatMessage[] = [
      ...baseApiMessages,
      { role: "assistant", content: target.content },
      {
        role: "user",
        content:
          "[Pokračuj přesně tam, kde jsi přestal/a. Neopakuj už napsaný text, jen naváž další slova.]",
      },
    ];

    set({ streamingMessageId: messageId, streamingText: "" });

    const finalize = async (text: string, interrupted: boolean) => {
      const addition = text.trim();
      const combined = addition ? `${target.content}${/\s$/.test(target.content) ? "" : " "}${addition}` : target.content;
      if (addition) {
        const updated = await updateMessageContent(target, combined);
        set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
      }
      if (interrupted) {
        markInterrupted(set, messageId);
      } else {
        clearInterrupted(set, messageId);
        scheduleMemoryWork(chatId);
      }
      void touchChat(chatId);
      set({ streaming: false, streamingText: "", streamingMessageId: null });
    };

    const retry = () => {
      set({ streamingMessageId: messageId, streamingText: "" });
      startStream(connection, apiMessages, set, get, finalize, retry);
    };

    startStream(connection, apiMessages, set, get, finalize, retry);
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
    await handle.abort();
    set({ handle: null, pendingFinalize: null });
    // No further channel events arrive after an abort, so finalize here —
    // it persists whatever partial text streamed in and clears `streaming`
    // once that's done (keeping the bubble visible until then). An abort
    // always counts as "interrupted" so the UI offers continue/regenerate.
    if (pendingFinalize) {
      await pendingFinalize(streamingText);
    } else {
      set({ streaming: false, streamingText: "", streamingMessageId: null });
    }
  },

  dismissError: () => set({ error: null, errorRetryable: false, retry: null }),

  /** Asks the model for 3 short ways the user could react next. Built on
   * the exact same PromptBuilder context as a normal send (ledger facts,
   * summary, lore), so suggestions know everything the character does —
   * but only runs on explicit request, so it costs tokens only when used. */
  suggestReplies: async () => {
    const { chatId, messages, streaming, suggesting } = get();
    if (!chatId || streaming || suggesting || messages.length === 0) return;

    const chat = await getChat(chatId);
    if (!chat) return;
    const connection = resolveConnection(chat.connectionId);
    if (!connection) {
      set({ error: "no-connection", errorRetryable: false, retry: null });
      return;
    }

    set({ suggesting: true, suggestions: null });
    try {
      const { messages: baseApiMessages } = await buildApiMessages(chat, messages);
      const apiMessages: ChatMessage[] = [
        ...baseApiMessages,
        {
          role: "user",
          content:
            "[Instrukce mimo příběh: Navrhni přesně 3 stručné možnosti, jak může hráčova postava v této situaci reagovat nebo co udělat dál. Každá možnost max 1–2 věty, psaná v první osobě za hráčovu postavu. Využij známá fakta a předměty z příběhu. Odpověz POUZE JSON polem tří řetězců, bez dalšího textu.]",
        },
      ];
      const reply = await chatComplete(connection, apiMessages);
      const suggestions = parseSuggestions(reply);
      set({ suggestions });
    } catch (err) {
      set({ error: String(err), errorRetryable: false, retry: null });
    } finally {
      set({ suggesting: false });
    }
  },

  clearSuggestions: () => set({ suggestions: null }),
}));

/** Extracts up to 3 suggestion strings from the model's reply. Prefers the
 * requested JSON array (tolerating markdown fences / surrounding prose);
 * falls back to numbered or bulleted lines when the model ignores the
 * format, so the button still works with weaker models. */
export function parseSuggestions(reply: string): string[] {
  const jsonMatch = reply.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        const items = parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        if (items.length > 0) return items.slice(0, 3).map((s) => s.trim());
      }
    } catch {
      // fall through to line-based parsing
    }
  }
  return reply
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, "").trim())
    .filter((line) => line.length > 0 && !/^```/.test(line))
    .slice(0, 3);
}
