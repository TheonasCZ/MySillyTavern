import { execute, newId, nowIso, query } from "../database";

export interface Summary {
  id: string;
  chatId: string;
  upToMessageId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface SummaryRow {
  id: string;
  chat_id: string;
  up_to_message_id: string;
  text: string;
  created_at: string;
  updated_at: string;
}

function toSummary(row: SummaryRow): Summary {
  return {
    id: row.id,
    chatId: row.chat_id,
    upToMessageId: row.up_to_message_id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** One row per chat (`summaries.chat_id` is UNIQUE) — null when nothing has
 * been summarized yet. */
export async function getSummary(chatId: string): Promise<Summary | null> {
  const rows = await query<SummaryRow>("SELECT * FROM summaries WHERE chat_id = $1", [chatId]);
  return rows[0] ? toSummary(rows[0]) : null;
}

/** Inserts the chat's summary row if it doesn't exist yet, otherwise
 * overwrites its text and advances `up_to_message_id` — the single
 * write-path both the summarizer and manual panel edits use. */
export async function upsertSummary(
  chatId: string,
  upToMessageId: string,
  text: string,
): Promise<Summary> {
  const existing = await getSummary(chatId);
  const now = nowIso();
  if (existing) {
    await execute(
      `UPDATE summaries SET up_to_message_id = $2, text = $3, updated_at = $4 WHERE chat_id = $1`,
      [chatId, upToMessageId, text, now],
    );
    return { ...existing, upToMessageId, text, updatedAt: now };
  }
  const id = newId();
  await execute(
    `INSERT INTO summaries (id, chat_id, up_to_message_id, text, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, chatId, upToMessageId, text, now],
  );
  return { id, chatId, upToMessageId, text, createdAt: now, updatedAt: now };
}

/** Manual edit from the memory panel — rewrites the text only, keeps
 * `up_to_message_id` where it is. */
export async function updateSummaryText(chatId: string, text: string): Promise<void> {
  await execute("UPDATE summaries SET text = $2, updated_at = $3 WHERE chat_id = $1", [
    chatId,
    text,
    nowIso(),
  ]);
}
