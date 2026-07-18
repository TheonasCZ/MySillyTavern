import { create } from "zustand";

import {
  createChat,
  deleteChat,
  listChats,
  renameChat,
  setChatConnection,
  setChatPersona,
  setChatPreset,
  setExtractionConnection,
  type Chat,
  type ChatDraft,
} from "../db/repositories/chatsRepo";
import { createCalendarEvent } from "../db/repositories/calendarEventsRepo";
import { setCalendarSetting } from "../db/repositories/settingsRepo";
import { generateCalendarEvents } from "../memory/calendarEvents";
import { calendarToJSON, defaultCalendarDate } from "../memory/calendar";

interface ChatListState {
  chats: Chat[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (draft: ChatDraft) => Promise<Chat>;
  rename: (id: string, title: string) => Promise<void>;
  setConnection: (id: string, connectionId: string | null) => Promise<void>;
  setPersona: (id: string, personaId: string | null) => Promise<void>;
  setPreset: (id: string, presetId: string | null) => Promise<void>;
  setExtractionConnection: (id: string, connectionId: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useChatListStore = create<ChatListState>((set, get) => ({
  chats: [],
  loaded: false,

  load: async () => {
    const chats = await listChats();
    set({ chats, loaded: true });
  },

  create: async (draft) => {
    const created = await createChat(draft);
    set({ chats: [created, ...get().chats] });
    // Initialize calendar date + seed events (fire-and-forget, no AI)
    void (async () => {
      try {
        const cal = defaultCalendarDate();
        await setCalendarSetting(created.id, calendarToJSON(cal));
        const events = generateCalendarEvents(created.id, cal.year);
        for (const ev of events) {
          await createCalendarEvent(ev);
        }
      } catch (err) {
        console.warn("chatListStore: failed to init calendar", err);
      }
    })();
    return created;
  },

  rename: async (id, title) => {
    await renameChat(id, title);
    set({ chats: get().chats.map((c) => (c.id === id ? { ...c, title } : c)) });
  },

  setConnection: async (id, connectionId) => {
    await setChatConnection(id, connectionId);
    set({ chats: get().chats.map((c) => (c.id === id ? { ...c, connectionId } : c)) });
  },

  setPersona: async (id, personaId) => {
    await setChatPersona(id, personaId);
    set({ chats: get().chats.map((c) => (c.id === id ? { ...c, personaId } : c)) });
  },

  setPreset: async (id, presetId) => {
    await setChatPreset(id, presetId);
    set({ chats: get().chats.map((c) => (c.id === id ? { ...c, presetId } : c)) });
  },

  setExtractionConnection: async (id, connectionId) => {
    await setExtractionConnection(id, connectionId);
    set({
      chats: get().chats.map((c) => (c.id === id ? { ...c, extractionConnectionId: connectionId } : c)),
    });
  },

  remove: async (id) => {
    await deleteChat(id);
    set({ chats: get().chats.filter((c) => c.id !== id) });
  },
}));
