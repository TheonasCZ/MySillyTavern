import { execute, newId, nowIso, query } from "../database";
import { journalEntityWrite } from "../syncJournal";

export type QuestStatus = "active" | "completed" | "failed";

export interface Quest {
  id: string;
  chatId: string;
  name: string;
  description: string;
  status: QuestStatus;
  createdAt: string;
  updatedAt: string;
}

interface QuestRow {
  id: string;
  chat_id: string;
  name: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function toQuest(row: QuestRow): Quest {
  return {
    id: row.id,
    chatId: row.chat_id,
    name: row.name,
    description: row.description,
    status: row.status as QuestStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** List all quests for a chat, active first, then completed, then failed. */
export async function listQuests(chatId: string): Promise<Quest[]> {
  const rows = await query<QuestRow>(
    `SELECT * FROM quests WHERE chat_id = $1
     ORDER BY CASE status
       WHEN 'active' THEN 0
       WHEN 'completed' THEN 1
       WHEN 'failed' THEN 2
     END, created_at ASC`,
    [chatId],
  );
  return rows.map(toQuest);
}

/** Get a single quest by name within a chat (for upsert logic). */
export async function getQuestByName(
  chatId: string,
  name: string,
): Promise<Quest | null> {
  const rows = await query<QuestRow>(
    "SELECT * FROM quests WHERE chat_id = $1 AND name = $2",
    [chatId, name],
  );
  return rows[0] ? toQuest(rows[0]) : null;
}

export interface CreateQuestInput {
  chatId: string;
  name: string;
  description?: string;
}

/** Create a new quest (active by default). */
export async function createQuest(input: CreateQuestInput): Promise<Quest> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO quests (id, chat_id, name, description, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', $5, $5)`,
    [id, input.chatId, input.name, input.description ?? "", now],
  );
  const quest: Quest = {
    id,
    chatId: input.chatId,
    name: input.name,
    description: input.description ?? "",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  journalEntityWrite("quest", quest as unknown as Record<string, unknown>);
  return quest;
}

/** Update a quest's status (active / completed / failed). */
export async function updateQuestStatus(
  id: string,
  status: QuestStatus,
): Promise<void> {
  const now = nowIso();
  await execute(
    "UPDATE quests SET status = $2, updated_at = $3 WHERE id = $1",
    [id, status, now],
  );
  journalEntityWrite("quest", { id, status, updated_at: now });
}

/** Append a progress note to the quest description. */
export async function addQuestNote(id: string, note: string): Promise<void> {
  const now = nowIso();
  await execute(
    `UPDATE quests SET
       description = CASE
         WHEN description = '' THEN $2
         ELSE description || '\n' || $2
       END,
       updated_at = $3
     WHERE id = $1`,
    [id, note, now],
  );
  journalEntityWrite("quest", { id, _note: note, updated_at: now });
}
