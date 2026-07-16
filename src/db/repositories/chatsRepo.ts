import { execute, newId, nowIso, query } from "../database";

export interface Chat {
  id: string;
  title: string;
  characterId: string;
  personaId: string | null;
  connectionId: string | null;
  extractionConnectionId: string | null;
  lastExtractedMessageId: string | null;
  lastSummarizedMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatDraft {
  title: string;
  characterId: string;
  connectionId: string | null;
  personaId: string | null;
}

interface ChatRow {
  id: string;
  title: string;
  character_id: string;
  persona_id: string | null;
  connection_id: string | null;
  extraction_connection_id: string | null;
  last_extracted_message_id: string | null;
  last_summarized_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    title: row.title,
    characterId: row.character_id,
    personaId: row.persona_id,
    connectionId: row.connection_id,
    extractionConnectionId: row.extraction_connection_id,
    lastExtractedMessageId: row.last_extracted_message_id,
    lastSummarizedMessageId: row.last_summarized_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listChats(): Promise<Chat[]> {
  const rows = await query<ChatRow>("SELECT * FROM chats ORDER BY updated_at DESC", []);
  return rows.map(toChat);
}

export async function getChat(id: string): Promise<Chat | null> {
  const rows = await query<ChatRow>("SELECT * FROM chats WHERE id = $1", [id]);
  return rows[0] ? toChat(rows[0]) : null;
}

export async function createChat(draft: ChatDraft): Promise<Chat> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO chats (id, title, character_id, persona_id, connection_id, extraction_connection_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $6)`,
    [id, draft.title, draft.characterId, draft.personaId, draft.connectionId, now],
  );
  return {
    id,
    title: draft.title,
    characterId: draft.characterId,
    personaId: draft.personaId,
    connectionId: draft.connectionId,
    extractionConnectionId: null,
    lastExtractedMessageId: null,
    lastSummarizedMessageId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function renameChat(id: string, title: string): Promise<void> {
  await execute("UPDATE chats SET title = $2, updated_at = $3 WHERE id = $1", [
    id,
    title,
    nowIso(),
  ]);
}

export async function setChatConnection(id: string, connectionId: string | null): Promise<void> {
  await execute("UPDATE chats SET connection_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    connectionId,
    nowIso(),
  ]);
}

export async function setChatPersona(id: string, personaId: string | null): Promise<void> {
  await execute("UPDATE chats SET persona_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    personaId,
    nowIso(),
  ]);
}

export async function touchChat(id: string): Promise<void> {
  await execute("UPDATE chats SET updated_at = $2 WHERE id = $1", [id, nowIso()]);
}

export async function deleteChat(id: string): Promise<void> {
  await execute("DELETE FROM chats WHERE id = $1", [id]);
}
