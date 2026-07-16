import { execute, newId, nowIso, query } from "../database";

export interface ChatMember {
  id: string;
  chatId: string;
  characterId: string;
  position: number;
  createdAt: string;
}

interface ChatMemberRow {
  id: string;
  chat_id: string;
  character_id: string;
  position: number;
  created_at: string;
}

function toChatMember(row: ChatMemberRow): ChatMember {
  return {
    id: row.id,
    chatId: row.chat_id,
    characterId: row.character_id,
    position: row.position,
    createdAt: row.created_at,
  };
}

/** Roster of one chat, ordered for display/turn-taking — `position` first,
 * then insertion order as a tiebreaker. */
export async function listChatMembers(chatId: string): Promise<ChatMember[]> {
  const rows = await query<ChatMemberRow>(
    "SELECT * FROM chat_members WHERE chat_id = $1 ORDER BY position ASC, created_at ASC",
    [chatId],
  );
  return rows.map(toChatMember);
}

/** All chat_members rows across every chat — used by the chat list to show
 * "who's in this chat" without an N+1 query per row. */
export async function listAllChatMembers(): Promise<ChatMember[]> {
  const rows = await query<ChatMemberRow>(
    "SELECT * FROM chat_members ORDER BY chat_id ASC, position ASC, created_at ASC",
    [],
  );
  return rows.map(toChatMember);
}

/** Adds a member at the end of the roster. Idempotent — re-adding an
 * existing (chat_id, character_id) pair is a no-op thanks to the unique
 * constraint. */
export async function addChatMember(chatId: string, characterId: string): Promise<ChatMember> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT OR IGNORE INTO chat_members (id, chat_id, character_id, position, created_at)
     VALUES ($1, $2, $3, COALESCE((SELECT MAX(position) + 1 FROM chat_members WHERE chat_id = $2), 0), $4)`,
    [id, chatId, characterId, now],
  );
  const rows = await query<ChatMemberRow>(
    "SELECT * FROM chat_members WHERE chat_id = $1 AND character_id = $2",
    [chatId, characterId],
  );
  return toChatMember(rows[0]);
}

export async function removeChatMember(chatId: string, characterId: string): Promise<void> {
  await execute("DELETE FROM chat_members WHERE chat_id = $1 AND character_id = $2", [
    chatId,
    characterId,
  ]);
}
