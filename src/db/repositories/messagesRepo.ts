import { execute, newId, nowIso, query } from "../database";

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  swipes: string[];
  activeSwipe: number;
  createdAt: string;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  swipes: string;
  active_swipe: number;
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

/** Creates a message with a single swipe variant equal to its content. */
export async function createMessage(
  chatId: string,
  role: MessageRole,
  content: string,
): Promise<Message> {
  const id = newId();
  const now = nowIso();
  const swipes = JSON.stringify([content]);
  await execute(
    `INSERT INTO messages (id, chat_id, role, content, swipes, active_swipe, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [id, chatId, role, content, swipes, now],
  );
  return { id, chatId, role, content, swipes: [content], activeSwipe: 0, createdAt: now };
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
