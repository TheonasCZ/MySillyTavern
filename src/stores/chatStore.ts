import { create } from "zustand";

import { buildFullSystemMessage } from "../chat/systemPrompt";
import { getCharacter } from "../db/repositories/charactersRepo";
import { getChat, touchChat, type Chat } from "../db/repositories/chatsRepo";
import { listActivatableEntries } from "../db/repositories/lorebooksRepo";
import {
  appendSwipe,
  createMessage,
  listMessages,
  shiftActiveSwipe,
  updateMessageContent,
  type Message,
} from "../db/repositories/messagesRepo";
import { getDefaultPersona, getPersona, type Persona } from "../db/repositories/personasRepo";
import { getSetting } from "../db/repositories/settingsRepo";
import { selectActiveEntries, type LoreEntryLike } from "../lorebooks/activation";
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

/** Prepends a system message built from the chat's character card, its
 * resolved persona, and activated lorebook entries (M4: full
 * PromptBuilder with ledger facts/summaries/budget trimming lands in M5).
 * Silently omits parts that fail to load (deleted character, lorebook
 * lookup error) so a degraded chat still limps along instead of failing to
 * send. */
async function withCharacterSystemMessage(chat: Chat, history: ChatMessage[]): Promise<ChatMessage[]> {
  const character = await getCharacter(chat.characterId);
  if (!character) return history;

  const persona = await resolveChatPersona(chat);

  let loreEntries: LoreEntryLike[] = [];
  try {
    const [activatable, scanDepthSetting, tokenBudgetSetting] = await Promise.all([
      listActivatableEntries(chat.characterId, chat.id),
      getSetting("lore_scan_depth"),
      getSetting("lore_token_budget"),
    ]);
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

  const systemText = buildFullSystemMessage(character, persona, loreEntries);
  if (!systemText) return history;
  return [{ role: "system", content: systemText }, ...history];
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
  finalize: (content: string) => Promise<void>,
) {
  set({ streaming: true, streamingText: "", error: null, pendingFinalize: finalize });

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
      void finalize(text);
    },
    onError: (err) => {
      const text = get().streamingText;
      set({ handle: null, pendingFinalize: null, error: err.message });
      void finalize(text);
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
  handle: ChatStreamHandle | null;
  pendingFinalize: ((content: string) => Promise<void>) | null;

  openChat: (chatId: string) => Promise<void>;
  closeChat: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  switchSwipe: (messageId: string, offset: number) => Promise<void>;
  stop: () => Promise<void>;
  dismissError: () => void;
}

function resolveConnection(connectionId: string | null): ConnectionConfig | null {
  if (!connectionId) return null;
  return useConnectionsStore.getState().connections.find((c) => c.id === connectionId) ?? null;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chatId: null,
  messages: [],
  loading: false,
  streaming: false,
  streamingMessageId: null,
  streamingText: "",
  error: null,
  handle: null,
  pendingFinalize: null,

  openChat: async (chatId) => {
    if (get().streaming) {
      await get().stop();
    }
    set({ chatId, loading: true, messages: [], error: null });
    const messages = await listMessages(chatId);
    // Ignore the result if the user has already navigated to a different
    // chat while this query was in flight.
    if (get().chatId !== chatId) return;
    set({ messages, loading: false });
  },

  closeChat: async () => {
    if (get().streaming) {
      await get().stop();
    }
    set({ chatId: null, messages: [], loading: false, error: null });
  },

  sendMessage: async (content) => {
    const trimmed = content.trim();
    const { chatId, messages, streaming } = get();
    if (!chatId || !trimmed || streaming) return;

    const chat = await getChat(chatId);
    if (!chat) return;
    const connection = resolveConnection(chat.connectionId);
    if (!connection) {
      set({ error: "no-connection" });
      return;
    }

    const userMessage = await createMessage(chatId, "user", trimmed);
    set((s) => ({ messages: [...s.messages, userMessage] }));
    void touchChat(chatId);

    const apiMessages = await withCharacterSystemMessage(
      chat,
      toApiMessages([...messages, userMessage]),
    );

    const finalize = async (text: string) => {
      const finalText = text.trim();
      if (finalText) {
        const assistantMessage = await createMessage(chatId, "assistant", finalText);
        set((s) => ({ messages: [...s.messages, assistantMessage] }));
        void touchChat(chatId);
      }
      set({ streaming: false, streamingText: "", streamingMessageId: null });
    };

    startStream(connection, apiMessages, set, get, finalize);
  },

  regenerate: async (messageId) => {
    const { chatId, messages, streaming } = get();
    if (!chatId || streaming) return;
    const chat = await getChat(chatId);
    if (!chat) return;
    const connection = resolveConnection(chat.connectionId);
    if (!connection) {
      set({ error: "no-connection" });
      return;
    }

    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const target = messages[idx];
    const apiMessages = await withCharacterSystemMessage(
      chat,
      toApiMessages(messages.slice(0, idx)),
    );

    set({ streamingMessageId: messageId });

    const finalize = async (text: string) => {
      const finalText = text.trim();
      if (finalText) {
        const updated = await appendSwipe(target, finalText);
        set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
        void touchChat(chatId);
      }
      set({ streaming: false, streamingText: "", streamingMessageId: null });
    };

    startStream(connection, apiMessages, set, get, finalize);
  },

  editMessage: async (messageId, content) => {
    const { messages } = get();
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    const updated = await updateMessageContent(msg, content);
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
  },

  switchSwipe: async (messageId, offset) => {
    const { messages } = get();
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    const updated = await shiftActiveSwipe(msg, offset);
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? updated : m)) }));
  },

  stop: async () => {
    const { handle, pendingFinalize, streamingText } = get();
    if (!handle) return;
    await handle.abort();
    set({ handle: null, pendingFinalize: null });
    // No further channel events arrive after an abort, so finalize here —
    // it persists whatever partial text streamed in and clears `streaming`
    // once that's done (keeping the bubble visible until then).
    if (pendingFinalize) {
      await pendingFinalize(streamingText);
    } else {
      set({ streaming: false, streamingText: "", streamingMessageId: null });
    }
  },

  dismissError: () => set({ error: null }),
}));
