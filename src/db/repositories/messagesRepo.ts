import { foldForSearch } from "../../chat/searchSnippet";
import { execute, newId, nowIso, query } from "../database";

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  swipes: string[];
  activeSwipe: number;
  /** Group chats: which member authored this (assistant) message; null for
   * user/system messages and legacy solo-chat rows. Soft ref — not cleared
   * when a member is removed from the roster. */
  characterId: string | null;
  createdAt: string;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  swipes: string;
  active_swipe: number;
  character_id: string | null;
  created_at: string;
}

function toMessage(row: MessageRow): Message {
  let swipes: string[];
  try {
    swipes = JSON.parse(row.swipes);
  } catch {
    swipes = [row.content];
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    swipes,
    activeSwipe: row.active_swipe,
    characterId: row.character_id,
    createdAt: row.created_at,
  };
}

export async function listMessages(chatId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    "SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
    [chatId],
  );
  return rows.map(toMessage);
}

/** Page size for `listRecentMessages`/`listOlderMessages` — long chats load
 * only the most recent window up front, with older messages fetched on
 * demand as the user scrolls up (plan §9). */
export const MESSAGE_PAGE_SIZE = 100;

/** Returns the total number of messages in a chat — used to decide whether
 * there's older history left to page in. */
export async function countMessages(chatId: string): Promise<number> {
  const rows = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM messages WHERE chat_id = $1",
    [chatId],
  );
  return rows[0]?.count ?? 0;
}

/** Loads the most recent `limit` messages of a chat, oldest → newest
 * (matching `listMessages`'s ordering) so callers can render them directly
 * without re-sorting. */
export async function listRecentMessages(
  chatId: string,
  limit: number = MESSAGE_PAGE_SIZE,
): Promise<Message[]> {
  const rows = await query<MessageRow>(
    "SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2",
    [chatId, limit],
  );
  return rows.map(toMessage).reverse();
}

/** Loads up to `limit` messages older than `beforeCreatedAt`, oldest →
 * newest — used to page in earlier history when the user scrolls to the
 * top of the message list. */
export async function listOlderMessages(
  chatId: string,
  beforeCreatedAt: string,
  limit: number = MESSAGE_PAGE_SIZE,
): Promise<Message[]> {
  const rows = await query<MessageRow>(
    "SELECT * FROM messages WHERE chat_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3",
    [chatId, beforeCreatedAt, limit],
  );
  return rows.map(toMessage).reverse();
}

/** Creates a message with a single swipe variant equal to its content.
 * `characterId` records the authoring member for group chats (M10) — omit
 * for user/system messages or legacy solo chats. */
export async function createMessage(
  chatId: string,
  role: MessageRole,
  content: string,
  characterId: string | null = null,
): Promise<Message> {
  const id = newId();
  const now = nowIso();
  const swipes = JSON.stringify([content]);
  await execute(
    `INSERT INTO messages (id, chat_id, role, content, swipes, active_swipe, character_id, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
    [id, chatId, role, content, swipes, characterId, now],
  );
  return {
    id,
    chatId,
    role,
    content,
    swipes: [content],
    activeSwipe: 0,
    characterId,
    createdAt: now,
  };
}

/** Edits the content of the currently active swipe (used for manual message
 * edits — does not create a new variant). */
export async function updateMessageContent(message: Message, content: string): Promise<Message> {
  const swipes = [...message.swipes];
  swipes[message.activeSwipe] = content;
  await execute("UPDATE messages SET content = $2, swipes = $3 WHERE id = $1", [
    message.id,
    content,
    JSON.stringify(swipes),
  ]);
  return { ...message, content, swipes };
}

/** Appends a new swipe variant (regeneration) and makes it active. */
export async function appendSwipe(message: Message, content: string): Promise<Message> {
  const swipes = [...message.swipes, content];
  const activeSwipe = swipes.length - 1;
  await execute("UPDATE messages SET content = $2, swipes = $3, active_swipe = $4 WHERE id = $1", [
    message.id,
    content,
    JSON.stringify(swipes),
    activeSwipe,
  ]);
  return { ...message, content, swipes, activeSwipe };
}

/** Switches the active swipe by a relative offset (-1 / +1), clamped to
 * bounds. Returns the message unchanged if the offset would go out of
 * range. */
export async function shiftActiveSwipe(message: Message, offset: number): Promise<Message> {
  const nextIndex = message.activeSwipe + offset;
  if (nextIndex < 0 || nextIndex >= message.swipes.length) {
    return message;
  }
  const content = message.swipes[nextIndex];
  await execute("UPDATE messages SET content = $2, active_swipe = $3 WHERE id = $1", [
    message.id,
    content,
    nextIndex,
  ]);
  return { ...message, content, activeSwipe: nextIndex };
}

export async function deleteMessage(id: string): Promise<void> {
  await execute("DELETE FROM messages WHERE id = $1", [id]);
}

export interface MessageSearchHit {
  chatId: string;
  messageId: string;
  content: string;
  createdAt: string;
}

/** LIKE-based substring search scoped to a single chat, newest first.
 * SQLite's default LIKE is case-insensitive for ASCII; for broader
 * diacritics folding the all-chat search below uses TS-side folding instead. */
export async function searchMessagesInChat(
  chatId: string,
  searchQuery: string,
  limit = 20,
): Promise<MessageSearchHit[]> {
  const pattern = `%${searchQuery}%`;
  const rows = await query<{ id: string; content: string; created_at: string }>(
    "SELECT id, content, created_at FROM messages WHERE chat_id = $1 AND content LIKE $2 ORDER BY created_at DESC LIMIT $3",
    [chatId, pattern, limit],
  );
  return rows.map((r) => ({
    chatId,
    messageId: r.id,
    content: r.content,
    createdAt: r.created_at,
  }));
}

/** Case- and diacritics-insensitive substring search across all chats'
 * messages ("vez" finds "Věž"), newest first. SQLite's NOCASE only folds
 * ASCII, so the folding happens in TS — loading all message texts is plenty
 * fast at this scale (an FTS index with an unaccent tokenizer would pay off
 * only at hundreds of thousands of messages). */
export async function searchMessages(term: string, limit = 50): Promise<MessageSearchHit[]> {
  const target = foldForSearch(term);
  if (!target) return [];
  const rows = await query<{ chat_id: string; id: string; content: string; created_at: string }>(
    "SELECT chat_id, id, content, created_at FROM messages ORDER BY created_at DESC",
    [],
  );
  const hits: MessageSearchHit[] = [];
  for (const r of rows) {
    if (!foldForSearch(r.content).includes(target)) continue;
    hits.push({ chatId: r.chat_id, messageId: r.id, content: r.content, createdAt: r.created_at });
    if (hits.length >= limit) break;
  }
  return hits;
}
