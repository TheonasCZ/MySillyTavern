import { execute, newId, nowIso, query } from "../database";
import type { CardBookV2 } from "../../cards/cardTypes";
import type { LoreEntryLike } from "../../lorebooks/activation";
import {
  parseWorldInfoJson,
  stringifyWorldInfo,
  type LoreEntryFields,
} from "../../lorebooks/worldInfoImport";

export interface Lorebook {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoreEntry extends LoreEntryFields {
  id: string;
  lorebookId: string;
  createdAt: string;
}

export type LorebookLinkTargetType = "character" | "chat" | "global";

export interface LorebookLink {
  id: string;
  lorebookId: string;
  targetType: LorebookLinkTargetType;
  targetId: string | null;
}

interface LorebookRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface LoreEntryRow {
  id: string;
  lorebook_id: string;
  keys: string;
  secondary_keys: string;
  content: string;
  comment: string;
  priority: number;
  always_on: number;
  case_sensitive: number;
  enabled: number;
  created_at: string;
}

interface LorebookLinkRow {
  id: string;
  lorebook_id: string;
  target_type: LorebookLinkTargetType;
  target_id: string | null;
}

function parseJsonArray(text: string): string[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toLorebook(row: LorebookRow): Lorebook {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEntry(row: LoreEntryRow): LoreEntry {
  return {
    id: row.id,
    lorebookId: row.lorebook_id,
    keys: parseJsonArray(row.keys),
    secondaryKeys: parseJsonArray(row.secondary_keys),
    content: row.content,
    comment: row.comment,
    priority: row.priority,
    alwaysOn: row.always_on === 1,
    caseSensitive: row.case_sensitive === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

function toLink(row: LorebookLinkRow): LorebookLink {
  return {
    id: row.id,
    lorebookId: row.lorebook_id,
    targetType: row.target_type,
    targetId: row.target_id,
  };
}

function toLoreEntryLike(row: LoreEntryRow): LoreEntryLike {
  return {
    id: row.id,
    keys: parseJsonArray(row.keys),
    secondaryKeys: parseJsonArray(row.secondary_keys),
    content: row.content,
    priority: row.priority,
    alwaysOn: row.always_on === 1,
    caseSensitive: row.case_sensitive === 1,
    enabled: row.enabled === 1,
  };
}

// ---- Lorebooks ------------------------------------------------------

export async function listLorebooks(): Promise<Lorebook[]> {
  const rows = await query<LorebookRow>("SELECT * FROM lorebooks ORDER BY name ASC", []);
  return rows.map(toLorebook);
}

export async function getLorebook(id: string): Promise<Lorebook | null> {
  const rows = await query<LorebookRow>("SELECT * FROM lorebooks WHERE id = $1", [id]);
  return rows[0] ? toLorebook(rows[0]) : null;
}

export interface LorebookDraft {
  name: string;
  description: string;
}

export async function createLorebook(draft: LorebookDraft): Promise<Lorebook> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO lorebooks (id, name, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [id, draft.name, draft.description, now],
  );
  return { id, name: draft.name, description: draft.description, createdAt: now, updatedAt: now };
}

export async function updateLorebook(id: string, patch: LorebookDraft): Promise<void> {
  await execute(
    `UPDATE lorebooks SET name = $2, description = $3, updated_at = $4 WHERE id = $1`,
    [id, patch.name, patch.description, nowIso()],
  );
}

export async function deleteLorebook(id: string): Promise<void> {
  await execute("DELETE FROM lorebooks WHERE id = $1", [id]);
}

// ---- Lore entries -----------------------------------------------------

export async function listEntries(lorebookId: string): Promise<LoreEntry[]> {
  const rows = await query<LoreEntryRow>(
    "SELECT * FROM lore_entries WHERE lorebook_id = $1 ORDER BY priority DESC, created_at ASC",
    [lorebookId],
  );
  return rows.map(toEntry);
}

async function insertEntry(lorebookId: string, fields: LoreEntryFields): Promise<LoreEntry> {
  const id = newId();
  const now = nowIso();
  await execute(
    `INSERT INTO lore_entries
      (id, lorebook_id, keys, secondary_keys, content, comment, priority,
       always_on, case_sensitive, enabled, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      lorebookId,
      JSON.stringify(fields.keys),
      JSON.stringify(fields.secondaryKeys),
      fields.content,
      fields.comment,
      fields.priority,
      fields.alwaysOn ? 1 : 0,
      fields.caseSensitive ? 1 : 0,
      fields.enabled ? 1 : 0,
      now,
    ],
  );
  return { id, lorebookId, createdAt: now, ...fields };
}

export async function createEntry(lorebookId: string, fields: LoreEntryFields): Promise<LoreEntry> {
  return insertEntry(lorebookId, fields);
}

export async function updateEntry(id: string, fields: LoreEntryFields): Promise<void> {
  await execute(
    `UPDATE lore_entries SET
      keys = $2, secondary_keys = $3, content = $4, comment = $5, priority = $6,
      always_on = $7, case_sensitive = $8, enabled = $9
     WHERE id = $1`,
    [
      id,
      JSON.stringify(fields.keys),
      JSON.stringify(fields.secondaryKeys),
      fields.content,
      fields.comment,
      fields.priority,
      fields.alwaysOn ? 1 : 0,
      fields.caseSensitive ? 1 : 0,
      fields.enabled ? 1 : 0,
    ],
  );
}

export async function deleteEntry(id: string): Promise<void> {
  await execute("DELETE FROM lore_entries WHERE id = $1", [id]);
}

// ---- Links (character / chat / global) --------------------------------

export async function listLinksForLorebook(lorebookId: string): Promise<LorebookLink[]> {
  const rows = await query<LorebookLinkRow>(
    "SELECT * FROM lorebook_links WHERE lorebook_id = $1",
    [lorebookId],
  );
  return rows.map(toLink);
}

export async function addLink(
  lorebookId: string,
  targetType: LorebookLinkTargetType,
  targetId: string | null,
): Promise<LorebookLink> {
  const id = newId();
  await execute(
    `INSERT INTO lorebook_links (id, lorebook_id, target_type, target_id) VALUES ($1, $2, $3, $4)`,
    [id, lorebookId, targetType, targetType === "global" ? null : targetId],
  );
  return { id, lorebookId, targetType, targetId: targetType === "global" ? null : targetId };
}

export async function removeLink(linkId: string): Promise<void> {
  await execute("DELETE FROM lorebook_links WHERE id = $1", [linkId]);
}

// ---- Activation glue ----------------------------------------------------

/** All lore entries reachable by a chat: linked to its character, linked
 * to the chat itself, or globally linked — the set `activation.ts`'s
 * `selectActiveEntries` scans over. Disabled entries are included too
 * (activation filters them) so the caller can also list them in a "why
 * wasn't this active" UI later if needed. */
export async function listActivatableEntries(
  characterId: string,
  chatId: string,
): Promise<LoreEntryLike[]> {
  return listActivatableEntriesForMembers([characterId], chatId);
}

/** Same as `listActivatableEntries` but unions lore reachable by any member
 * of a group chat's roster (plan §M10) — a lorebook linked to a non-primary
 * member still activates. Dedupes by entry id (an entry could be linked to
 * more than one member, or to both a member and the chat/global). */
export async function listActivatableEntriesForMembers(
  characterIds: string[],
  chatId: string,
): Promise<LoreEntryLike[]> {
  if (characterIds.length === 0) return [];
  const characterPlaceholders = characterIds.map((_, i) => `$${i + 1}`).join(", ");
  const chatParamIndex = characterIds.length + 1;
  const rows = await query<LoreEntryRow>(
    `SELECT e.* FROM lore_entries e
     JOIN lorebook_links l ON l.lorebook_id = e.lorebook_id
     WHERE (l.target_type = 'character' AND l.target_id IN (${characterPlaceholders}))
        OR (l.target_type = 'chat' AND l.target_id = $${chatParamIndex})
        OR (l.target_type = 'global')
     GROUP BY e.id`,
    [...characterIds, chatId],
  );
  return rows.map(toLoreEntryLike);
}

// ---- World Info import/export -----------------------------------------

/** Imports a SillyTavern World Info JSON file's entries as a brand new
 * lorebook (optionally linked to a target right away). */
export async function importWorldInfoLorebook(
  name: string,
  jsonText: string,
  link?: { targetType: LorebookLinkTargetType; targetId: string | null },
): Promise<Lorebook> {
  const fields = parseWorldInfoJson(jsonText);
  const lorebook = await createLorebook({ name, description: "" });
  for (const entry of fields) {
    await insertEntry(lorebook.id, entry);
  }
  if (link) {
    await addLink(lorebook.id, link.targetType, link.targetId);
  }
  return lorebook;
}

/** Serializes a lorebook's entries back into SillyTavern World Info JSON
 * text, for exporting. */
export async function exportWorldInfoLorebook(lorebookId: string): Promise<string> {
  const entries = await listEntries(lorebookId);
  return stringifyWorldInfo(entries);
}

/** Imports World Info JSON entries into an *existing* lorebook (as opposed
 * to `importWorldInfoLorebook`, which creates a new one) — used by the
 * lorebook editor's "import" button to add entries to the book currently
 * open. */
export async function importWorldInfoEntriesInto(lorebookId: string, jsonText: string): Promise<number> {
  const fields = parseWorldInfoJson(jsonText);
  for (const entry of fields) {
    await insertEntry(lorebookId, entry);
  }
  return fields.length;
}

// ---- Character card import (M3) ----------------------------------------

/** Minimal lorebook write-path needed to land `character_book` from an
 * imported card as a real lorebook + entries + link. */
export async function createLorebookFromCharacterBook(
  book: CardBookV2,
  characterId: string,
): Promise<string> {
  const lorebook = await createLorebook({
    name: book.name?.trim() || "Importovaný lorebook",
    description: book.description ?? "",
  });

  for (const entry of book.entries ?? []) {
    await insertEntry(lorebook.id, {
      keys: entry.keys ?? [],
      secondaryKeys: entry.secondary_keys ?? [],
      content: entry.content ?? "",
      comment: entry.comment ?? entry.name ?? "",
      priority: entry.priority ?? entry.insertion_order ?? 100,
      alwaysOn: !!entry.constant,
      caseSensitive: !!entry.case_sensitive,
      enabled: entry.enabled !== false,
    });
  }

  await addLink(lorebook.id, "character", characterId);

  return lorebook.id;
}
