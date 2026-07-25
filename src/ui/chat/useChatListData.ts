import { useEffect, useState } from "react";

import { listAllChatMembers, type ChatMember } from "../../db/repositories/chatMembersRepo";
import { countMessages } from "../../db/repositories/messagesRepo";
import type { Chat } from "../../db/repositories/chatsRepo";

/** Roster membership (for the "who's in this chat" line) and per-chat
 * message counts (for unread badges), reloaded whenever the chat list
 * changes. */
export function useChatListData(loaded: boolean, chats: Chat[]) {
  const [allMembers, setAllMembers] = useState<ChatMember[]>([]);
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (loaded) void listAllChatMembers().then(setAllMembers);
  }, [loaded]);

  // Load message counts for unread badges
  useEffect(() => {
    if (!loaded || chats.length === 0) return;
    void (async () => {
      const counts: Record<string, number> = {};
      await Promise.all(
        chats.map(async (c) => {
          counts[c.id] = await countMessages(c.id);
        }),
      );
      setMessageCounts(counts);
    })();
  }, [loaded, chats]);

  return { allMembers, messageCounts };
}
