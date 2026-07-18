import { execute, newId, nowIso, query } from "../database";
import { journalEntityDelete, journalEntityWrite } from "../syncJournal";
import { getPersona, type ConditionEntry, type InventoryEntry, type ModificationEntry, type SkillEntry } from "./personasRepo";

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
  /** Language the AI writes in (e.g. 'cs', 'en') — per-chat (M28). */
  gameLanguage: string;
  /** Live gameplay inventory, scoped to this chat/campaign (not the persona).
   *  Seeded from the persona's template inventory at chat creation time,
   *  then evolves independently for the life of the chat. */
  inventory: InventoryEntry[];
  /** Live gameplay skills/conditions/xp/level, scoped to this chat/campaign
   *  (not the persona). Seeded from the persona's template at chat creation
   *  time, then evolve independently for the life of the chat — mirrors
   *  `inventory` above. */
  skills: SkillEntry[];
  conditions: ConditionEntry[];
  xp: number;
  level: number;
  /** Live gameplay body modifications, scoped to this chat/campaign. Always
   *  campaign-specific — unlike inventory/skills/conditions, there is no
   *  persona template to seed from; new chats always start with `[]`. */
  modifications: ModificationEntry[];
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
  /** Language the AI writes in (e.g. 'cs', 'en'). Defaults to 'cs'. (M28) */
  gameLanguage?: string;
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
  game_language: string;
  inventory: string; // JSON
  skills: string; // JSON
  conditions: string; // JSON
  xp: number;
  level: number;
  modifications: string; // JSON
  created_at: string;
  updated_at: string;
}

function parseInventory(raw: string | null | undefined): InventoryEntry[] {
  try {
    return raw ? (JSON.parse(raw) as InventoryEntry[]) : [];
  } catch {
    return [];
  }
}

function parseSkills(raw: string | null | undefined): SkillEntry[] {
  try {
    return raw ? (JSON.parse(raw) as SkillEntry[]) : [];
  } catch {
    return [];
  }
}

function parseConditions(raw: string | null | undefined): ConditionEntry[] {
  try {
    return raw ? (JSON.parse(raw) as ConditionEntry[]) : [];
  } catch {
    return [];
  }
}

function parseModifications(raw: string | null | undefined): ModificationEntry[] {
  try {
    return raw ? (JSON.parse(raw) as ModificationEntry[]) : [];
  } catch {
    return [];
  }
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
    gameLanguage: row.game_language ?? "cs",
    inventory: parseInventory(row.inventory),
    skills: parseSkills(row.skills),
    conditions: parseConditions(row.conditions),
    xp: row.xp ?? 0,
    level: row.level ?? 1,
    modifications: parseModifications(row.modifications),
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

  // Seed the chat's live inventory/skills/conditions/xp/level as a copy of
  // the persona's template at chat-creation time ("new campaign = clean
  // start using your character's starting gear/skills"). Purely a snapshot —
  // the chat's state evolves independently from here on and never reads the
  // persona again.
  let inventory: InventoryEntry[] = [];
  let skills: SkillEntry[] = [];
  let conditions: ConditionEntry[] = [];
  let xp = 0;
  let level = 1;
  if (draft.personaId) {
    const persona = await getPersona(draft.personaId);
    inventory = persona ? persona.inventory.map((i) => ({ ...i })) : [];
    skills = persona ? persona.skills.map((s) => ({ ...s })) : [];
    conditions = persona ? persona.conditions.map((c) => ({ ...c })) : [];
    xp = persona?.xp ?? 0;
    level = persona?.level ?? 1;
  }

  await execute(
    `INSERT INTO chats (id, title, character_id, persona_id, connection_id, extraction_connection_id, preset_id, game_language, inventory, skills, conditions, xp, level, modifications, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [
      id,
      draft.title,
      primaryCharacterId,
      draft.personaId,
      draft.connectionId,
      draft.gameLanguage ?? "cs",
      JSON.stringify(inventory),
      JSON.stringify(skills),
      JSON.stringify(conditions),
      xp,
      level,
      JSON.stringify([]),
      now,
    ],
  );
  for (let i = 0; i < draft.characterIds.length; i++) {
    await execute(
      `INSERT INTO chat_members (id, chat_id, character_id, position, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId(), id, draft.characterIds[i], i, now],
    );
  }
  const chat: Chat = {
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
    gameLanguage: draft.gameLanguage ?? "cs",
    inventory,
    skills,
    conditions,
    xp,
    level,
    modifications: [],
    createdAt: now,
    updatedAt: now,
  };
  journalEntityWrite("chat", chat as unknown as Record<string, unknown>);
  return chat;
}

/** Toggles automatic speaker selection for a chat (plan §M10). */
export async function setAutoReply(id: string, on: boolean): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET auto_reply = $2, updated_at = $3 WHERE id = $1", [
    id,
    on ? 1 : 0,
    now,
  ]);
  journalEntityWrite("chat", { id, auto_reply: on ? 1 : 0, updated_at: now });
}

/** Changes which member is the primary (`chats.character_id`) — used e.g.
 * when the current primary is removed from the roster. Does not touch
 * `chat_members`; the caller must ensure `characterId` is already a member. */
export async function setPrimaryCharacter(id: string, characterId: string): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET character_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    characterId,
    now,
  ]);
  journalEntityWrite("chat", { id, character_id: characterId, updated_at: now });
}

export async function renameChat(id: string, title: string): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET title = $2, updated_at = $3 WHERE id = $1", [
    id,
    title,
    now,
  ]);
  journalEntityWrite("chat", { id, title, updated_at: now });
}

export async function setChatConnection(id: string, connectionId: string | null): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET connection_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    connectionId,
    now,
  ]);
  journalEntityWrite("chat", { id, connection_id: connectionId, updated_at: now });
}

export async function setChatPersona(id: string, personaId: string | null): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET persona_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    personaId,
    now,
  ]);
  journalEntityWrite("chat", { id, persona_id: personaId, updated_at: now });
}

export async function setChatPreset(id: string, presetId: string | null): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET preset_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    presetId,
    now,
  ]);
  journalEntityWrite("chat", { id, preset_id: presetId, updated_at: now });
}

/** Reads the chat's live gameplay inventory. */
export async function getChatInventory(chatId: string): Promise<InventoryEntry[]> {
  const rows = await query<{ inventory: string }>(
    "SELECT inventory FROM chats WHERE id = $1",
    [chatId],
  );
  return rows[0] ? parseInventory(rows[0].inventory) : [];
}

/** Overwrites the chat's live gameplay inventory (used by inventory/craft
 *  tag processing — mirrors the quest/faction chat-scoped pattern). */
export async function setChatInventory(
  chatId: string,
  inventory: InventoryEntry[],
): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET inventory = $2, updated_at = $3 WHERE id = $1", [
    chatId,
    JSON.stringify(inventory),
    now,
  ]);
  journalEntityWrite("chat", { id: chatId, inventory: JSON.stringify(inventory), updated_at: now });
}

/** Sets image_path on a specific inventory item by name within a chat's
 *  live inventory JSON — chat-scoped equivalent of personasRepo's
 *  setInventoryItemImage (used for the persona template only). */
export async function setChatInventoryItemImage(
  chatId: string,
  itemName: string,
  imagePath: string,
): Promise<void> {
  const rows = await query<{ inventory: string }>(
    "SELECT inventory FROM chats WHERE id = $1",
    [chatId],
  );
  if (!rows[0]) return;
  const inventory = parseInventory(rows[0].inventory);
  const item = inventory.find((i) => i.item.toLowerCase() === itemName.toLowerCase());
  if (!item) return;
  item.image_path = imagePath;
  await execute("UPDATE chats SET inventory = $2, updated_at = $3 WHERE id = $1", [
    chatId,
    JSON.stringify(inventory),
    nowIso(),
  ]);
}

/** Reads the chat's live gameplay skills. */
export async function getChatSkills(chatId: string): Promise<SkillEntry[]> {
  const rows = await query<{ skills: string }>("SELECT skills FROM chats WHERE id = $1", [chatId]);
  return rows[0] ? parseSkills(rows[0].skills) : [];
}

/** Overwrites the chat's live gameplay skills — mirrors setChatInventory. */
export async function setChatSkills(chatId: string, skills: SkillEntry[]): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET skills = $2, updated_at = $3 WHERE id = $1", [
    chatId,
    JSON.stringify(skills),
    now,
  ]);
  journalEntityWrite("chat", { id: chatId, skills: JSON.stringify(skills), updated_at: now });
}

/** Reads the chat's live gameplay conditions/status effects. */
export async function getChatConditions(chatId: string): Promise<ConditionEntry[]> {
  const rows = await query<{ conditions: string }>("SELECT conditions FROM chats WHERE id = $1", [chatId]);
  return rows[0] ? parseConditions(rows[0].conditions) : [];
}

/** Overwrites the chat's live gameplay conditions — mirrors setChatInventory. */
export async function setChatConditions(chatId: string, conditions: ConditionEntry[]): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET conditions = $2, updated_at = $3 WHERE id = $1", [
    chatId,
    JSON.stringify(conditions),
    now,
  ]);
  journalEntityWrite("chat", { id: chatId, conditions: JSON.stringify(conditions), updated_at: now });
}

/** Reads the chat's live body modifications. Always campaign-specific — no
 *  persona template equivalent (mirrors setChatConditions otherwise). */
export async function getChatModifications(chatId: string): Promise<ModificationEntry[]> {
  const rows = await query<{ modifications: string }>(
    "SELECT modifications FROM chats WHERE id = $1",
    [chatId],
  );
  return rows[0] ? parseModifications(rows[0].modifications) : [];
}

/** Overwrites the chat's live body modifications — mirrors setChatConditions. */
export async function setChatModifications(
  chatId: string,
  modifications: ModificationEntry[],
): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET modifications = $2, updated_at = $3 WHERE id = $1", [
    chatId,
    JSON.stringify(modifications),
    now,
  ]);
  journalEntityWrite("chat", {
    id: chatId,
    modifications: JSON.stringify(modifications),
    updated_at: now,
  });
}

/** Reads the chat's live xp/level. */
export async function getChatXpLevel(chatId: string): Promise<{ xp: number; level: number }> {
  const rows = await query<{ xp: number; level: number }>(
    "SELECT xp, level FROM chats WHERE id = $1",
    [chatId],
  );
  return rows[0] ? { xp: rows[0].xp ?? 0, level: rows[0].level ?? 1 } : { xp: 0, level: 1 };
}

/** Overwrites the chat's live xp/level — chat-scoped equivalent of
 *  personasRepo's updatePersonaXpLevel (used for the persona template only). */
export async function setChatXpLevel(chatId: string, xp: number, level: number): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET xp = $2, level = $3, updated_at = $4 WHERE id = $1", [
    chatId,
    xp,
    level,
    now,
  ]);
  journalEntityWrite("chat", { id: chatId, xp, level, updated_at: now });
}

export async function touchChat(id: string): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET updated_at = $2 WHERE id = $1", [id, now]);
  journalEntityWrite("chat", { id, updated_at: now });
}

export async function setExtractionConnection(
  id: string,
  extractionConnectionId: string | null,
): Promise<void> {
  const now = nowIso();
  await execute("UPDATE chats SET extraction_connection_id = $2, updated_at = $3 WHERE id = $1", [
    id,
    extractionConnectionId,
    now,
  ]);
  journalEntityWrite("chat", { id, extraction_connection_id: extractionConnectionId, updated_at: now });
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
  const chat = await getChat(id);
  await execute("DELETE FROM chats WHERE id = $1", [id]);
  if (chat) {
    journalEntityDelete("chat", chat as unknown as Record<string, unknown>);
  }
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
    `INSERT INTO chats (id, title, character_id, persona_id, connection_id, extraction_connection_id, preset_id, auto_reply, game_language, inventory, skills, conditions, xp, level, modifications, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
    [
      id,
      title,
      source.characterId,
      source.personaId,
      source.connectionId,
      source.extractionConnectionId,
      source.presetId,
      source.autoReply ? 1 : 0,
      source.gameLanguage ?? "cs",
      JSON.stringify(source.inventory.map((i) => ({ ...i }))),
      JSON.stringify(source.skills.map((s) => ({ ...s }))),
      JSON.stringify(source.conditions.map((c) => ({ ...c }))),
      source.xp,
      source.level,
      JSON.stringify(source.modifications.map((m) => ({ ...m }))),
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
