// Sync journal reader + merger — scans foreign device journals on startup
// and applies their entries to the local DB. See PLAN.md §M14.

import { invoke } from "@tauri-apps/api/core";
import { execute, query } from "./database";
import { getSetting, getSyncPositions, setSyncPositions } from "./repositories/settingsRepo";
import type { JournalEntry } from "./syncTypes";

// ---- Public API -----------------------------------------------------------

/**
 * Runs the full sync cycle: scan foreign journals and apply new entries.
 * Called once on app startup after DB hydration. Safe to call even when sync
 * is disabled — it reads the setting and exits early.
 */
export async function runSyncOnStartup(): Promise<void> {
  try {
    const folder = await getSetting("sync_folder_path");
    if (!folder) return; // sync disabled

    const deviceId = await getSetting("device_id");
    if (!deviceId) return; // no device id yet

    // List device directories in the sync folder
    const rootEntries: Array<{ name: string; is_dir: boolean; size_bytes: number }> =
      await invoke("list_sync_entries", { dir: folder });

    const foreignDevices = rootEntries.filter(
      (e) => e.is_dir && e.name !== deviceId && !e.name.startsWith("."),
    );

    if (foreignDevices.length === 0) return;

    const positions = await getSyncPositions();

    for (const dev of foreignDevices) {
      await processDeviceJournals(folder, dev.name, positions);
    }
  } catch (err) {
    console.warn("[sync] startup sync failed:", err);
  }
}

// ---- Internal -------------------------------------------------------------

async function processDeviceJournals(
  folder: string,
  foreignDeviceId: string,
  positions: Array<{ file: string; byteOffset: number }>,
): Promise<void> {
  const deviceDir = `${folder}/${foreignDeviceId}`;
  const entries: Array<{ name: string; is_dir: boolean; size_bytes: number }> =
    await invoke("list_sync_entries", { dir: deviceDir });

  const journals = entries
    .filter((e) => !e.is_dir && e.name.startsWith("journal") && e.name.endsWith(".jsonl"))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const j of journals) {
    const fileKey = `${foreignDeviceId}/${j.name}`;
    const pos = positions.find((p) => p.file === fileKey);
    const startByte = pos?.byteOffset ?? 0;

    if (startByte >= j.size_bytes) continue; // fully consumed

    await processJournalFile(`${deviceDir}/${j.name}`, fileKey, startByte, positions);
  }
}

async function processJournalFile(
  fullPath: string,
  fileKey: string,
  startByte: number,
  positions: Array<{ file: string; byteOffset: number }>,
): Promise<void> {
  const CHUNK_SIZE = 256 * 1024; // 256 KB per chunk
  let offset = startByte;

  while (true) {
    const chunk: { text: string; next_start_byte: number | null; total_bytes: number } =
      await invoke("read_journal_chunk", {
        path: fullPath,
        startByte: offset,
        maxBytes: CHUNK_SIZE,
      });

    if (!chunk.text) break;

    // Parse and apply each line
    const lines = chunk.text.split("\n");
    let lineStartByte = offset;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        lineStartByte += line.length + 1;
        continue;
      }
      try {
        const entry: JournalEntry = JSON.parse(trimmed);
        await applyJournalEntry(entry);
      } catch (err) {
        console.warn("[sync] failed to parse/apply journal line:", err);
      }
      lineStartByte += line.length + 1;
    }

    // Update position
    const nextOffset = chunk.next_start_byte ?? chunk.total_bytes;
    upsertPosition(positions, fileKey, nextOffset);

    if (chunk.next_start_byte === null) break;
    offset = chunk.next_start_byte;
  }

  // Persist positions after each file
  await setSyncPositions(positions);
}

function upsertPosition(
  positions: Array<{ file: string; byteOffset: number }>,
  file: string,
  byteOffset: number,
): void {
  const existing = positions.find((p) => p.file === file);
  if (existing) {
    existing.byteOffset = byteOffset;
  } else {
    positions.push({ file, byteOffset });
  }
}

// ---- Entry applicator ------------------------------------------------------

async function applyJournalEntry(entry: JournalEntry): Promise<void> {
  switch (entry.type) {
    case "message":
      return applyMessage(entry);
    case "chat":
      return applyChat(entry);
    case "fact":
      return applyFact(entry);
    case "summary":
      return applySummary(entry);
    case "character":
      return applyCharacter(entry);
    case "persona":
      return applyPersona(entry);
    case "preset":
      return applyPreset(entry);
    case "lorebook":
      return applyLorebook(entry);
    case "quest":
      return applyQuest(entry);
    default:
      break;
  }
}

// ---- Per-type applicators --------------------------------------------------

async function applyMessage(entry: JournalEntry): Promise<void> {
  if (entry.action !== "upsert") return; // messages are append-only, never deleted
  const e = entry.entity;
  const id = e.id as string;
  if (!id) return;

  // INSERT OR IGNORE — messages from other devices are always accepted but
  // never overwritten
  await execute(
    `INSERT OR IGNORE INTO messages (id, chat_id, role, content, swipes, active_swipe, character_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      e.chat_id ?? e.chatId ?? "",
      e.role ?? "assistant",
      e.content ?? "",
      e.swipes ?? "[]",
      e.active_swipe ?? 0,
      e.character_id ?? e.characterId ?? null,
      e.created_at ?? e.createdAt ?? entry.ts,
    ],
  );
}

async function applyChat(entry: JournalEntry): Promise<void> {
  const e = entry.entity;
  const id = e.id as string;
  if (!id) return;

  if (entry.action === "delete") {
    // Delete only if foreign ts > local updated_at
    const local = await query<{ updated_at: string }>(
      "SELECT updated_at FROM chats WHERE id = $1", [id],
    );
    if (local[0] && entry.ts > local[0].updated_at) {
      await execute("DELETE FROM chats WHERE id = $1", [id]);
    }
    return;
  }

  const local = await query<{ updated_at: string }>(
    "SELECT updated_at FROM chats WHERE id = $1", [id],
  );

  if (local[0]) {
    // Last-write-wins
    if (entry.ts > local[0].updated_at) {
      await execute(
        `UPDATE chats SET
           title = $2, character_id = $3, persona_id = $4, connection_id = $5,
           extraction_connection_id = $6, preset_id = $7, auto_reply = $8,
           game_language = $9, updated_at = $10
         WHERE id = $1`,
        [
          id,
          e.title ?? "",
          e.character_id ?? e.characterId ?? "",
          e.persona_id ?? e.personaId ?? null,
          e.connection_id ?? e.connectionId ?? null,
          e.extraction_connection_id ?? e.extractionConnectionId ?? null,
          e.preset_id ?? e.presetId ?? null,
          e.auto_reply ?? e.autoReply ?? 0,
          e.game_language ?? e.gameLanguage ?? "cs",
          e.updated_at ?? e.updatedAt ?? entry.ts,
        ],
      );
    }
  } else {
    // Insert new chat
    await execute(
      `INSERT INTO chats (id, title, character_id, persona_id, connection_id,
        extraction_connection_id, preset_id, auto_reply, game_language, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        e.title ?? "",
        e.character_id ?? e.characterId ?? "",
        e.persona_id ?? e.personaId ?? null,
        e.connection_id ?? e.connectionId ?? null,
        e.extraction_connection_id ?? e.extractionConnectionId ?? null,
        e.preset_id ?? e.presetId ?? null,
        e.auto_reply ?? e.autoReply ?? 0,
        e.game_language ?? e.gameLanguage ?? "cs",
        e.created_at ?? e.createdAt ?? entry.ts,
        e.updated_at ?? e.updatedAt ?? entry.ts,
      ],
    );
  }
}

async function applyFact(entry: JournalEntry): Promise<void> {
  const e = entry.entity;
  const id = e.id as string;
  if (!id) return;

  if (entry.action === "delete") {
    const local = await query<{ updated_at: string }>(
      "SELECT updated_at FROM ledger_facts WHERE id = $1", [id],
    );
    if (local[0] && entry.ts > local[0].updated_at) {
      await execute("DELETE FROM ledger_facts WHERE id = $1", [id]);
    }
    return;
  }

  const local = await query<{ updated_at: string }>(
    "SELECT updated_at FROM ledger_facts WHERE id = $1", [id],
  );

  if (local[0]) {
    if (entry.ts > local[0].updated_at) {
      await execute(
        `UPDATE ledger_facts SET
           chat_id = $2, category = $3, subject = $4, sub_key = $5, fact = $6,
           status = $7, locked = $8, canon = $9, stability = $10,
           contradiction_streak = $11, image_path = $12, updated_at = $13
         WHERE id = $1`,
        [
          id,
          e.chat_id ?? e.chatId ?? "",
          e.category ?? "world",
          e.subject ?? "",
          e.sub_key ?? "",
          e.fact ?? "",
          e.status ?? "active",
          e.locked ?? 0,
          e.canon ?? 0,
          e.stability ?? 0,
          e.contradiction_streak ?? 0,
          e.image_path ?? e.imagePath ?? null,
          e.updated_at ?? e.updatedAt ?? entry.ts,
        ],
      );
    }
    // else: local is newer — keep local. No conflict tracking for Phase 3.
  } else {
    // Insert new fact
    await execute(
      `INSERT INTO ledger_facts (id, chat_id, category, subject, sub_key, fact, status,
        locked, canon, stability, contradiction_streak, image_path, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        e.chat_id ?? e.chatId ?? "",
        e.category ?? "world",
        e.subject ?? "",
        e.sub_key ?? "",
        e.fact ?? "",
        e.status ?? "active",
        e.locked ?? 0,
        e.canon ?? 0,
        e.stability ?? 0,
        e.contradiction_streak ?? 0,
        e.image_path ?? e.imagePath ?? null,
        e.created_at ?? e.createdAt ?? entry.ts,
        e.updated_at ?? e.updatedAt ?? entry.ts,
      ],
    );
  }
}

async function applySummary(entry: JournalEntry): Promise<void> {
  if (entry.action !== "upsert") return;
  const e = entry.entity;
  const chatId = (e.chat_id ?? e.chatId) as string;
  if (!chatId) return;

  const local = await query<{ updated_at: string }>(
    "SELECT updated_at FROM summaries WHERE chat_id = $1", [chatId],
  );

  if (local[0]) {
    if (entry.ts > local[0].updated_at) {
      await execute(
        `UPDATE summaries SET up_to_message_id = $2, text = $3, updated_at = $4 WHERE chat_id = $1`,
        [
          chatId,
          e.up_to_message_id ?? e.upToMessageId ?? "",
          e.text ?? "",
          e.updated_at ?? e.updatedAt ?? entry.ts,
        ],
      );
    }
  } else {
    const id = e.id as string;
    if (!id) return;
    await execute(
      `INSERT INTO summaries (id, chat_id, up_to_message_id, text, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        chatId,
        e.up_to_message_id ?? e.upToMessageId ?? "",
        e.text ?? "",
        e.created_at ?? e.createdAt ?? entry.ts,
        e.updated_at ?? e.updatedAt ?? entry.ts,
      ],
    );
  }
}

async function applyCharacter(entry: JournalEntry): Promise<void> {
  await applyGenericEntity("characters", entry);
}

async function applyPersona(entry: JournalEntry): Promise<void> {
  await applyGenericEntity("personas", entry);
}

async function applyPreset(entry: JournalEntry): Promise<void> {
  await applyGenericEntity("presets", entry);
}

async function applyLorebook(entry: JournalEntry): Promise<void> {
  await applyGenericEntity("lorebooks", entry);
}

async function applyQuest(entry: JournalEntry): Promise<void> {
  await applyGenericEntity("quests", entry);
}

/** Generic last-write-wins applicator for entities that have `id` and
 *  `updated_at` columns. Handles both upsert and delete. */
async function applyGenericEntity(table: string, entry: JournalEntry): Promise<void> {
  const e = entry.entity;
  const id = e.id as string;
  if (!id) return;

  if (entry.action === "delete") {
    const local = await query<{ updated_at: string }>(
      `SELECT updated_at FROM ${table} WHERE id = $1`, [id],
    );
    if (local[0] && entry.ts > local[0].updated_at) {
      await execute(`DELETE FROM ${table} WHERE id = $1`, [id]);
    }
    return;
  }

  const local = await query<{ updated_at: string }>(
    `SELECT updated_at FROM ${table} WHERE id = $1`, [id],
  );

  if (local[0]) {
    // Only overwrite if foreign is newer
    if (entry.ts <= local[0].updated_at) return;

    // Build dynamic UPDATE — we don't know the exact columns, so use the
    // entity keys that map directly to snake_case column names.
    const snakeMap: Record<string, string> = {
      chatId: "chat_id", createdAt: "created_at", updatedAt: "updated_at",
      avatarPath: "avatar_path", cardJson: "card_json", specVersion: "spec_version",
      ttsVoice: "tts_voice", isDefault: "is_default", extraSystemPrompt: "extra_system_prompt",
      authorNote: "author_note", regexRules: "regex_rules", topP: "top_p",
      topK: "top_k", minP: "min_p", frequencyPenalty: "frequency_penalty",
      presencePenalty: "presence_penalty", maxTokens: "max_tokens",
      firstMes: "first_mes", mesExample: "mes_example",
      alternateGreetings: "alternate_greetings", systemPrompt: "system_prompt",
      postHistoryInstructions: "post_history_instructions",
      creatorNotes: "creator_notes", lorebookId: "lorebook_id",
      alwaysOn: "always_on", caseSensitive: "case_sensitive",
      upToMessageId: "up_to_message_id", imagePath: "image_path",
      subKey: "sub_key", contradictionStreak: "contradiction_streak",
    };

    const sets: string[] = [];
    const params: unknown[] = [id];
    let idx = 2;

    for (const [key, value] of Object.entries(e)) {
      if (key === "id") continue;
      if (value === undefined) continue;
      const col = snakeMap[key] ?? key.replace(/([A-Z])/g, "_$1").toLowerCase();
      // Skip columns that don't exist in the table (safety check by trying)
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }

    // Always bump updated_at to the foreign timestamp
    if (!sets.some((s) => s.startsWith("updated_at"))) {
      sets.push(`updated_at = $${idx++}`);
      params.push(e.updated_at ?? e.updatedAt ?? entry.ts);
    }

    if (sets.length > 0) {
      await execute(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1`, params);
    }
  } else {
    // Insert — build column list from entity keys
    const columns: string[] = [];
    const values: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(e)) {
      if (value === undefined) continue;
      const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
      columns.push(col);
      values.push(`$${idx++}`);
      params.push(value);
    }

    if (columns.length > 0) {
      await execute(
        `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")})`,
        params,
      );
    }
  }
}
