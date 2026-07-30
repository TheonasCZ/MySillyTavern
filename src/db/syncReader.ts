// Sync journal reader + merger — scans foreign device journals on startup
// and applies their entries to the local DB. See PLAN.md §M14.

import { invoke } from "@tauri-apps/api/core";
import { execute, query } from "./database";
import {
  getSetting,
  getSyncPositions,
  setSyncPositions,
  SYNC_EXCLUDED_SETTINGS,
} from "./repositories/settingsRepo";
import type { JournalEntry } from "./syncTypes";

// ---- Public API -----------------------------------------------------------

// Guards against overlapping runs — the app also calls this on a periodic
// background interval (see App.tsx), which could otherwise fire again while
// a previous scan is still applying entries to the DB.
let syncInProgress = false;

/**
 * Runs the full sync cycle: scan foreign journals and apply new entries.
 * Called on app startup after DB hydration, on a periodic background
 * interval, and from the manual "Sync now" button. Safe to call even when
 * sync is disabled — it reads the setting and exits early.
 */
export async function runSyncOnStartup(): Promise<void> {
  if (syncInProgress) return;
  syncInProgress = true;
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
  } finally {
    syncInProgress = false;
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
    case "chatMember":
      return applyChatMember(entry);
    case "calendarEvent":
      return applyCalendarEvent(entry);
    case "connection":
      return applyGenericEntity("connections", entry);
    case "connectionSecret":
      return applyConnectionSecret(entry);
    case "setting":
      return applySetting(entry);
    default:
      break;
  }
}

// ---- Per-type applicators --------------------------------------------------

async function applyMessage(entry: JournalEntry): Promise<void> {
  if (entry.action !== "upsert") return; // messages are never deleted via sync
  const e = entry.entity;
  const id = e.id as string;
  if (!id) return;

  const createdAt = (e.created_at ?? e.createdAt ?? entry.ts) as string;
  const updatedAt = (e.updated_at ?? e.updatedAt ?? entry.ts) as string;
  const changeSummary = e.change_summary ?? e.changeSummary ?? null;
  const changeSummaries = e.change_summaries ?? e.changeSummaries ?? JSON.stringify([changeSummary]);

  const local = await query<{ updated_at: string }>(
    "SELECT updated_at FROM messages WHERE id = $1", [id],
  );

  if (local[0]) {
    // Edits/regenerations/swipe switches from other devices — last-write-wins.
    if (updatedAt > local[0].updated_at) {
      await execute(
        `UPDATE messages SET content = $2, swipes = $3, active_swipe = $4,
           change_summary = $5, change_summaries = $6, updated_at = $7
         WHERE id = $1`,
        [
          id,
          e.content ?? "",
          e.swipes ?? "[]",
          e.active_swipe ?? 0,
          changeSummary,
          changeSummaries,
          updatedAt,
        ],
      );
    }
    return;
  }

  await execute(
    `INSERT INTO messages (id, chat_id, role, content, swipes, active_swipe, character_id, created_at, change_summary, change_summaries, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      e.chat_id ?? e.chatId ?? "",
      e.role ?? "assistant",
      e.content ?? "",
      e.swipes ?? "[]",
      e.active_swipe ?? 0,
      e.character_id ?? e.characterId ?? null,
      createdAt,
      changeSummary,
      changeSummaries,
      updatedAt,
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
  const updatedAt = (e.updated_at ?? e.updatedAt ?? entry.ts) as string;

  if (local[0]) {
    // Last-write-wins — built dynamically from whatever fields this journal
    // entry touched (full chat object on create/rename, or a narrow patch
    // like `{ id, inventory, updated_at }` from updateChatInventory etc.).
    // A fixed column list here previously silently dropped inventory/
    // skills/conditions/xp/level updates.
    if (updatedAt > local[0].updated_at) {
      const sets: string[] = [];
      const params: unknown[] = [id];
      let idx = 2;
      for (const [key, value] of Object.entries(e)) {
        if (key === "id" || value === undefined) continue;
        const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
        sets.push(`${col} = $${idx++}`);
        params.push(value);
      }
      if (!sets.some((s) => s.startsWith("updated_at"))) {
        sets.push(`updated_at = $${idx++}`);
        params.push(updatedAt);
      }
      if (sets.length > 0) {
        await execute(`UPDATE chats SET ${sets.join(", ")} WHERE id = $1`, params);
      }
    }
  } else {
    // Insert new chat — full row, with defaults for columns a narrow patch
    // might not include (defensive; creates normally arrive before patches).
    await execute(
      `INSERT INTO chats (
         id, title, character_id, persona_id, connection_id,
         extraction_connection_id, tag_extraction_connection_id,
         embedding_connection_id, image_connection_id, preset_id, auto_reply,
         game_language, hardcore_mode, inventory, skills, conditions, xp,
         level, modifications, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        id,
        e.title ?? "",
        e.character_id ?? e.characterId ?? "",
        e.persona_id ?? e.personaId ?? null,
        e.connection_id ?? e.connectionId ?? null,
        e.extraction_connection_id ?? e.extractionConnectionId ?? null,
        e.tag_extraction_connection_id ?? e.tagExtractionConnectionId ?? null,
        e.embedding_connection_id ?? e.embeddingConnectionId ?? null,
        e.image_connection_id ?? e.imageConnectionId ?? null,
        e.preset_id ?? e.presetId ?? null,
        e.auto_reply ?? e.autoReply ?? 0,
        e.game_language ?? e.gameLanguage ?? "cs",
        e.hardcore_mode ?? e.hardcoreMode ?? 0,
        e.inventory ?? "[]",
        e.skills ?? "[]",
        e.conditions ?? "[]",
        e.xp ?? 0,
        e.level ?? 1,
        e.modifications ?? "[]",
        e.created_at ?? e.createdAt ?? entry.ts,
        updatedAt,
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
  // Lore entries are journaled under the same "lorebook" type (tagged with
  // `_entry_type: "lore_entry"`) but live in a different table with a
  // different schema — routing them through `applyGenericEntity("lorebooks",
  // ...)` like a plain lorebook silently wrote the wrong columns into the
  // wrong table. Dispatch on the tag instead.
  if (entry.entity._entry_type === "lore_entry") {
    return applyLoreEntry(entry);
  }
  await applyGenericEntity("lorebooks", entry);
}

function toBit(value: unknown): number {
  return value ? 1 : 0;
}

/** Lore entries have no `updated_at` (the app never tracks one for them
 *  either — `updateEntry` doesn't bump anything) so there's no LWW to do:
 *  whichever version arrives last simply wins, same as `chat_members`/
 *  `calendar_events`. */
async function applyLoreEntry(entry: JournalEntry): Promise<void> {
  const e = entry.entity;
  const id = e.id as string;
  if (!id) return;

  if (entry.action === "delete") {
    await execute("DELETE FROM lore_entries WHERE id = $1", [id]);
    return;
  }

  const lorebookId = (e.lorebook_id ?? e.lorebookId) as string;
  if (!lorebookId) return;

  await execute(
    `INSERT INTO lore_entries
      (id, lorebook_id, keys, secondary_keys, content, comment, priority,
       always_on, case_sensitive, enabled, created_at,
       recursive_activation, activation_depth, selective_keys, timed_json,
       vector_threshold, vector_budget)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (id) DO UPDATE SET
       lorebook_id = excluded.lorebook_id, keys = excluded.keys,
       secondary_keys = excluded.secondary_keys, content = excluded.content,
       comment = excluded.comment, priority = excluded.priority,
       always_on = excluded.always_on, case_sensitive = excluded.case_sensitive,
       enabled = excluded.enabled, recursive_activation = excluded.recursive_activation,
       activation_depth = excluded.activation_depth, selective_keys = excluded.selective_keys,
       timed_json = excluded.timed_json, vector_threshold = excluded.vector_threshold,
       vector_budget = excluded.vector_budget`,
    [
      id,
      lorebookId,
      (e.keys as string) ?? "[]",
      (e.secondary_keys ?? e.secondaryKeys) ?? "[]",
      e.content ?? "",
      e.comment ?? "",
      e.priority ?? 100,
      toBit(e.always_on ?? e.alwaysOn),
      toBit(e.case_sensitive ?? e.caseSensitive),
      toBit(e.enabled ?? true),
      e.created_at ?? e.createdAt ?? entry.ts,
      toBit(e.recursive_activation ?? e.recursiveActivation),
      e.activation_depth ?? e.activationDepth ?? 1,
      (e.selective_keys ?? e.selectiveKeys) ?? "[]",
      e.timed_json ?? e.timed ?? null,
      e.vector_threshold ?? e.vectorThreshold ?? null,
      e.vector_budget ?? e.vectorBudget ?? 2,
    ],
  );
}

async function applyQuest(entry: JournalEntry): Promise<void> {
  await applyGenericEntity("quests", entry);
}

/** Group-chat roster membership — presence-only, no `updated_at` to compare
 *  (a member is either in the roster or not, there's nothing to merge). */
async function applyChatMember(entry: JournalEntry): Promise<void> {
  const e = entry.entity;
  const chatId = (e.chat_id ?? e.chatId) as string;
  const characterId = (e.character_id ?? e.characterId) as string;
  if (!chatId || !characterId) return;

  if (entry.action === "delete") {
    await execute("DELETE FROM chat_members WHERE chat_id = $1 AND character_id = $2", [
      chatId,
      characterId,
    ]);
    return;
  }

  await execute(
    `INSERT OR IGNORE INTO chat_members (id, chat_id, character_id, position, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      (e.id as string) ?? crypto.randomUUID(),
      chatId,
      characterId,
      e.position ?? 0,
      e.created_at ?? e.createdAt ?? entry.ts,
    ],
  );
}

/** Mirrors an encrypted API key into the local `connection_secrets` table
 *  (LWW by `updated_at`, same as other entities) and best-effort decrypts
 *  it into `secrets.json` via Rust. Decryption failure just means the sync
 *  passphrase isn't set on this device yet — the blob stays mirrored
 *  locally and `retryDecryptAllSyncedSecrets()` picks it up once it is. */
async function applyConnectionSecret(entry: JournalEntry): Promise<void> {
  const e = entry.entity;
  const connectionId = (e.connection_id ?? e.connectionId) as string;
  if (!connectionId) return;

  if (entry.action === "delete") {
    const local = await query<{ updated_at: string }>(
      "SELECT updated_at FROM connection_secrets WHERE connection_id = $1", [connectionId],
    );
    if (local[0] && entry.ts > local[0].updated_at) {
      await execute("DELETE FROM connection_secrets WHERE connection_id = $1", [connectionId]);
      try {
        await invoke("delete_api_key", { connectionId });
      } catch {
        // ignore — nothing to delete locally
      }
    }
    return;
  }

  const updatedAt = (e.updated_at ?? e.updatedAt ?? entry.ts) as string;
  const blob = e.blob as string;
  if (!blob) return;

  const local = await query<{ updated_at: string }>(
    "SELECT updated_at FROM connection_secrets WHERE connection_id = $1", [connectionId],
  );
  if (local[0] && updatedAt <= local[0].updated_at) return;

  await execute(
    `INSERT INTO connection_secrets (connection_id, blob, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (connection_id) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at`,
    [connectionId, blob, updatedAt],
  );

  try {
    await invoke("apply_synced_secret", { connectionId, blob });
  } catch (err) {
    console.warn("[sync] couldn't decrypt synced API key (passphrase not set yet?):", err);
  }
}

/** General app settings (theme, language, TTS, memory tuning...) — LWW by
 *  `updated_at`. Re-checks the deny-list as a second line of defense (in
 *  case an older app version or a future bug journaled an excluded key). */
async function applySetting(entry: JournalEntry): Promise<void> {
  if (entry.action !== "upsert") return; // settings are never deleted via sync
  const e = entry.entity;
  const key = e.key as string;
  if (!key || SYNC_EXCLUDED_SETTINGS.has(key)) return;

  const updatedAt = (e.updated_at ?? e.updatedAt ?? entry.ts) as string;
  const value = (e.value as string) ?? "";

  const local = await query<{ updated_at: string }>(
    "SELECT updated_at FROM settings WHERE key = $1", [key],
  );
  if (local[0] && updatedAt <= local[0].updated_at) return;

  await execute(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, updatedAt],
  );
}

/** Calendar events are create-once, delete-only — no update path, so no
 *  `updated_at` comparison needed. */
async function applyCalendarEvent(entry: JournalEntry): Promise<void> {
  const e = entry.entity;
  const id = e.id as string;
  if (!id) return;

  if (entry.action === "delete") {
    await execute("DELETE FROM calendar_events WHERE id = $1", [id]);
    return;
  }

  await execute(
    `INSERT OR IGNORE INTO calendar_events (id, chat_id, day, month_name, year, title, description, icon, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      e.chat_id ?? e.chatId ?? "",
      e.day ?? 1,
      e.month_name ?? e.monthName ?? "",
      e.year ?? 1,
      e.title ?? "",
      e.description ?? "",
      e.icon ?? "",
      e.created_at ?? e.createdAt ?? entry.ts,
    ],
  );
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
