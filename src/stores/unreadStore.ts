import { create } from "zustand";

interface UnreadState {
  /** Map of chatId → last seen message count */
  lastSeen: Record<string, number>;
  /** Mark a chat as "read" — set its current message count */
  markRead: (chatId: string, messageCount: number) => void;
  /** Get the unread count for a chat — null if none or not tracked */
  getUnread: (chatId: string, currentCount: number) => number | null;
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  lastSeen: {},
  markRead: (chatId, messageCount) => {
    set({ lastSeen: { ...get().lastSeen, [chatId]: messageCount } });
  },
  getUnread: (chatId, currentCount) => {
    const last = get().lastSeen[chatId];
    if (last === undefined) return null; // No read yet
    const diff = currentCount - last;
    return diff > 0 ? diff : null;
  },
}));
