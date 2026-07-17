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
  /** Prompt preset selected for this chat (M12.4). */
  presetId: string | null;
  /** Automatic speaker selection for group chats (plan §M10). */
  autoReply: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatDraft {
  title: string;
  /** All initial members; `[0]` becomes the primary member
   * (`chats.character_id`) and a `chat_members` row is inserted per id. */
  characterIds: string[];
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
  preset_id: string | null;
  auto_reply: number;
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
    presetId: row.preset_id,
    autoReply: !!row.auto_reply,
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
  const primaryCharacterId = draft.characterIds[0];
  await execute(
    `INSERT INTO chats (id, title, character_id, persona_id, connection_id, extraction_connection_id, preset_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $6)`,
    [id, draft.title, primaryCharacterId, draft.personaId, draft.connectionId, now],
  );
  for (let i = 0; i < draft.characterIds.length; i++) {
    await execute(
      `INSERT INTO chat_members (id, chat_id, character_id, position, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId(), id, draft.characterIds[i], i, now],
    );
  }
  return {
    id,
    title: draft.title,
    characterId: primaryCharacterId,
    personaId: draft.personaId,
    connectionId: draft.connectionId,
    extractionConnectionId: null,
    lastExtractedMessageId: null,
    lastSummarizedMessageId: null,
    presetId: null,
    autoReply: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Toggles automatic speaker selection for a chat (plan §M10). */
export async function setAutoReply(id: string, on: boolean): Promise<void> {
  await execute("UPDATE chats SET auto_reply = $2, updated_at = $3 WHERE id = $1", [
    id,
    on ? 1 : 0,
    nowIso(),
  ]);
}

/** Changes which member is the primary (`chats.character_id`) — used e.g.
 * when the current primary is removed from the roster. Does not touch
 * `chat_members`; the caller must ensure `characterId` is already a member. */
export async function setPrimaryCharacter(id: string, characterId: string): Promise<void> {
  await execute("UPDATE chats SET character_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    characterId,
    nowIso(),
  ]);
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

export async function setChatPreset(id: string, presetId: string | null): Promise<void> {
  await execute("UPDATE chats SET preset_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    presetId,
    nowIso(),
  ]);
}

export async function touchChat(id: string): Promise<void> {
  await execute("UPDATE chats SET updated_at = $2 WHERE id = $1", [id, nowIso()]);
}

export async function setExtractionConnection(
  id: string,
  extractionConnectionId: string | null,
): Promise<void> {
  await execute("UPDATE chats SET extraction_connection_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    extractionConnectionId,
    nowIso(),
  ]);
}

/** Advances the "already extracted up to" marker — used by the memory
 * engine after a successful extraction pass (plan §6.3). Does not bump
 * `updated_at`: this is background bookkeeping, not a user-visible chat
 * change (would otherwise reorder the chat list on its own). */
export async function setLastExtractedMessageId(id: string, messageId: string): Promise<void> {
  await execute("UPDATE chats SET last_extracted_message_id = $2 WHERE id = $1", [id, messageId]);
}

/** Advances the "already folded into the summary up to" marker — used by
 * the memory engine after a successful summarization pass. */
export async function setLastSummarizedMessageId(id: string, messageId: string): Promise<void> {
  await execute("UPDATE chats SET last_summarized_message_id = $2 WHERE id = $1", [id, messageId]);
}

export async function deleteChat(id: string): Promise<void> {
  await execute("DELETE FROM chats WHERE id = $1", [id]);
}

/** Forks a chat at a message: creates a new chat with the same
 * character/persona/connections and copies the messages up to and
 * including `upToMessageId` (new ids, original timestamps so ordering is
 * preserved). Ledger facts are copied as-is; the summary only when it
 * doesn't cover messages past the branch point (it would describe events
 * the branch never saw). Embeddings are not copied — the memory engine
 * re-syncs facts and the backfill button can rebuild scenes. Returns the
 * new chat, or null when the source chat/message doesn't exist. */
export async function branchChat(
  sourceChatId: string,
  upToMessageId: string,
  titleSuffix: string,
): Promise<Chat | null> {
  const source = await getChat(sourceChatId);
  if (!source) return null;

  interface SourceMessageRow {
    id: string;
    role: string;
    content: string;
    swipes: string;
    active_swipe: number;
    character_id: string | null;
    created_at: string;
  }
  const messages = await query<SourceMessageRow>(
    "SELECT id, role, content, swipes, active_swipe, character_id, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
    [sourceChatId],
  );
  const cutIdx = messages.findIndex((m) => m.id === upToMessageId);
  if (cutIdx === -1) return null;
  const copied = messages.slice(0, cutIdx + 1);

  const id = newId();
  const now = nowIso();
  const title = `${source.title} ${titleSuffix}`.trim();
  await execute(
    `INSERT INTO chats (id, title, character_id, persona_id, connection_id, extraction_connection_id, preset_id, auto_reply, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [
      id,
      title,
      source.characterId,
      source.personaId,
      source.connectionId,
      source.extractionConnectionId,
      source.presetId,
      source.autoReply ? 1 : 0,
      now,
    ],
  );

  interface SourceMemberRow {
    character_id: string;
    position: number;
    created_at: string;
  }
  const members = await query<SourceMemberRow>(
    "SELECT character_id, position, created_at FROM chat_members WHERE chat_id = $1",
    [sourceChatId],
  );
  for (const m of members) {
    await execute(
      `INSERT INTO chat_members (id, chat_id, character_id, position, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId(), id, m.character_id, m.position, m.created_at],
    );
  }

  const idMap = new Map<string, string>();
  for (const m of copied) {
    const newMessageId = newId();
    idMap.set(m.id, newMessageId);
    await execute(
      `INSERT INTO messages (id, chat_id, role, content, swipes, active_swipe, character_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newMessageId, id, m.role, m.content, m.swipes, m.active_swipe, m.character_id, m.created_at],
    );
  }

  interface FactRow {
    category: string;
    subject: string;
    fact: string;
    status: string;
    locked: number;
    created_at: string;
    updated_at: string;
  }
  const facts = await query<FactRow>(
    "SELECT category, subject, fact, status, locked, created_at, updated_at FROM ledger_facts WHERE chat_id = $1",
    [sourceChatId],
  );
  for (const f of facts) {
    await execute(
      `INSERT INTO ledger_facts (id, chat_id, category, subject, fact, status, locked, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newId(), id, f.category, f.subject, f.fact, f.status, f.locked, f.created_at, f.updated_at],
    );
  }

  // Memory markers carry over only when the marker message made it into the
  // branch — otherwise the engine simply re-extracts/re-summarizes.
  const mappedExtracted = source.lastExtractedMessageId
    ? (idMap.get(source.lastExtractedMessageId) ?? null)
    : null;
  const mappedSummarized = source.lastSummarizedMessageId
    ? (idMap.get(source.lastSummarizedMessageId) ?? null)
    : null;
  if (mappedExtracted || mappedSummarized) {
    await execute(
      "UPDATE chats SET last_extracted_message_id = $2, last_summarized_message_id = $3 WHERE id = $1",
      [id, mappedExtracted, mappedSummarized],
    );
  }

  if (mappedSummarized) {
    const summaries = await query<{ text: string; up_to_message_id: string }>(
      "SELECT text, up_to_message_id FROM summaries WHERE chat_id = $1",
      [sourceChatId],
    );
    const summary = summaries[0];
    const mappedUpTo = summary ? idMap.get(summary.up_to_message_id) : undefined;
    if (summary && mappedUpTo) {
      await execute(
        `INSERT INTO summaries (id, chat_id, up_to_message_id, text, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [newId(), id, mappedUpTo, summary.text, now],
      );
    }
  }

  const created = await getChat(id);
  return created;
}
