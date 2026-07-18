import { foldForSearch } from "../../chat/searchSnippet";
import { execute, newId, nowIso, query } from "../database";
import { journalEntityWrite } from "../syncJournal";

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
  /** Stylized local-only summary of what this reply's game tags actually
   *  did ("+item, skill +1, injury..."), for the active swipe — never sent
   *  to the model, just rendered as a small footer (see MessageBubble.tsx).
   *  Null for user/system messages and any assistant reply with no tags. */
  changeSummary: string | null;
  /** Per-swipe parallel to `swipes` — `changeSummary` is always
   *  `changeSummaries[activeSwipe] ?? null`, kept in sync by
   *  appendSwipe/shiftActiveSwipe so switching swipes shows the right one. */
  changeSummaries: (string | null)[];
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
  change_summary: string | null;
  change_summaries: string;
}

function parseChangeSummaries(raw: string | null | undefined, fallback: string | null): (string | null)[] {
  try {
    if (raw) return JSON.parse(raw) as (string | null)[];
  } catch {
    // fall through
  }
  return [fallback];
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
    changeSummary: row.change_summary ?? null,
    changeSummaries: parseChangeSummaries(row.change_summaries, row.change_summary ?? null),
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

/** Returns true when at least one message exists in `chatId` older than
 * `beforeMessageId` — used by the UI to decide whether to show the
 * "scroll for older" hint and keep the sentinel active. */
export async function hasMoreMessages(chatId: string, beforeMessageId: string): Promise<boolean> {
  const rows = await query<{ exists: number }>(
    `SELECT 1 as exists FROM messages
     WHERE chat_id = $1
       AND created_at < (SELECT created_at FROM messages WHERE id = $2)
     LIMIT 1`,
    [chatId, beforeMessageId],
  );
  return rows.length > 0;
}

/** Loads up to `limit` messages older than `beforeMessageId`, oldest →
 * newest. Resolves the cursor message's `created_at` and delegates to
 * `listOlderMessages` so the underlying pagination stays timestamp-based
 * (safe across message insertions / reorders). */
export async function loadOlderMessages(
  chatId: string,
  beforeMessageId: string,
  limit: number = MESSAGE_PAGE_SIZE,
): Promise<Message[]> {
  const cursor = await query<{ created_at: string }>(
    "SELECT created_at FROM messages WHERE id = $1",
    [beforeMessageId],
  );
  if (cursor.length === 0) return [];
  return listOlderMessages(chatId, cursor[0].created_at, limit);
}

/** Creates a message with a single swipe variant equal to its content.
 * `characterId` records the authoring member for group chats (M10) — omit
 * for user/system messages or legacy solo chats. `changeSummary` is the
 * local-only game-tag diff for this reply (see Message.changeSummary). */
export async function createMessage(
  chatId: string,
  role: MessageRole,
  content: string,
  characterId: string | null = null,
  changeSummary: string | null = null,
): Promise<Message> {
  const id = newId();
  const now = nowIso();
  const swipes = JSON.stringify([content]);
  const changeSummaries = JSON.stringify([changeSummary]);
  await execute(
    `INSERT INTO messages (id, chat_id, role, content, swipes, active_swipe, character_id, created_at, change_summary, change_summaries)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)`,
    [id, chatId, role, content, swipes, characterId, now, changeSummary, changeSummaries],
  );
  const msg: Message = {
    id,
    chatId,
    role,
    content,
    swipes: [content],
    activeSwipe: 0,
    characterId,
    createdAt: now,
    changeSummary,
    changeSummaries: [changeSummary],
  };
  journalEntityWrite("message", msg as unknown as Record<string, unknown>);
  return msg;
}

/** Edits the content of the currently active swipe (used for manual message
 * edits and "continue" — does not create a new variant). `changeSummary`
 * is left as-is (undefined) by default, e.g. for a plain manual wording
 * tweak; pass an explicit value (or null) to replace it, e.g. "continue"
 * merging in whatever new tags the continuation picked up. */
export async function updateMessageContent(
  message: Message,
  content: string,
  changeSummary?: string | null,
): Promise<Message> {
  const swipes = [...message.swipes];
  swipes[message.activeSwipe] = content;
  const changeSummaries = [...message.changeSummaries];
  if (changeSummary !== undefined) changeSummaries[message.activeSwipe] = changeSummary;
  await execute(
    changeSummary !== undefined
      ? "UPDATE messages SET content = $2, swipes = $3, change_summary = $4, change_summaries = $5 WHERE id = $1"
      : "UPDATE messages SET content = $2, swipes = $3 WHERE id = $1",
    changeSummary !== undefined
      ? [message.id, content, JSON.stringify(swipes), changeSummary, JSON.stringify(changeSummaries)]
      : [message.id, content, JSON.stringify(swipes)],
  );
  return changeSummary !== undefined
    ? { ...message, content, swipes, changeSummary, changeSummaries }
    : { ...message, content, swipes };
}

/** Appends a new swipe variant (regeneration) and makes it active. */
export async function appendSwipe(
  message: Message,
  content: string,
  changeSummary: string | null = null,
): Promise<Message> {
  const swipes = [...message.swipes, content];
  const activeSwipe = swipes.length - 1;
  const changeSummaries = [...message.changeSummaries, changeSummary];
  await execute(
    "UPDATE messages SET content = $2, swipes = $3, active_swipe = $4, change_summary = $5, change_summaries = $6 WHERE id = $1",
    [message.id, content, JSON.stringify(swipes), activeSwipe, changeSummary, JSON.stringify(changeSummaries)],
  );
  return { ...message, content, swipes, activeSwipe, changeSummary, changeSummaries };
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
  const changeSummary = message.changeSummaries[nextIndex] ?? null;
  await execute("UPDATE messages SET content = $2, active_swipe = $3, change_summary = $4 WHERE id = $1", [
    message.id,
    content,
    nextIndex,
    changeSummary,
  ]);
  return { ...message, content, activeSwipe: nextIndex, changeSummary };
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
