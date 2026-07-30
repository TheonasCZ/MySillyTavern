// Sync journal writer — appends mutation events to the device's journal file.
// Rotation: when the current journal exceeds ~10 MB, start journal.2.jsonl,
// journal.3.jsonl, etc. Keep at most 5 rotated files.

import { invoke } from "@tauri-apps/api/core";
import { getSetting } from "./repositories/settingsRepo";
import type { JournalEntry } from "./syncTypes";

const MAX_JOURNAL_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATED = 5;

let currentJournalRoot: string | null = null;
let currentJournalRelative: string | null = null;
let currentJournalSize: number | null = null;
let initPromise: Promise<void> | null = null;

/** One-time init: resolves the sync folder + device id, picks (or creates)
 *  the current active journal file. Idempotent — subsequent calls return the
 *  cached promise. */
async function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const folder = await getSetting("sync_folder_path");
      const deviceId = await getSetting("device_id");
      if (!folder || !deviceId) return; // sync disabled

      // List existing journal files, pick the smallest one (or create journal.jsonl)
      const entries: Array<{ name: string; is_dir: boolean; size_bytes: number }> =
        await invoke("list_sync_entries", { root: folder, relative: deviceId });

      const journals = entries
        .filter((e) => !e.is_dir && e.name.startsWith("journal") && e.name.endsWith(".jsonl"))
        .sort((a, b) => a.name.localeCompare(b.name));

      currentJournalRoot = folder;
      if (journals.length > 0) {
        // Use the last (newest) journal file
        const last = journals[journals.length - 1];
        currentJournalRelative = `${deviceId}/${last.name}`;
        currentJournalSize = last.size_bytes;
      } else {
        currentJournalRelative = `${deviceId}/journal.jsonl`;
        currentJournalSize = 0;
      }
    } catch (err) {
      console.warn("[sync] journal init failed, sync disabled:", err);
      currentJournalRoot = null;
      currentJournalRelative = null;
      currentJournalSize = null;
    }
  })();
  return initPromise;
}

/** Resolves which journal file to write to, rotating if necessary. */
async function resolveJournalPath(): Promise<{ root: string; relative: string } | null> {
  await ensureInit();
  if (!currentJournalRoot || !currentJournalRelative) return null;

  try {
    // If current journal is over the limit, rotate
    if (currentJournalSize !== null && currentJournalSize >= MAX_JOURNAL_SIZE) {
      const folder = await getSetting("sync_folder_path");
      const deviceId = await getSetting("device_id");
      if (!folder || !deviceId) return null;

      const entries: Array<{ name: string; is_dir: boolean; size_bytes: number }> =
        await invoke("list_sync_entries", { root: folder, relative: deviceId });

      const journals = entries
        .filter((e) => !e.is_dir && e.name.startsWith("journal") && e.name.endsWith(".jsonl"))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Find the highest existing rotation number
      let maxNum = 1; // journal.jsonl is implicitly #1
      for (const j of journals) {
        const m = j.name.match(/^journal(?:\.(\d+))?\.jsonl$/);
        if (m) {
          const n = m[1] ? parseInt(m[1], 10) : 1;
          if (n > maxNum) maxNum = n;
        }
      }

      // We're rotating away from the current file
      const nextNum = maxNum + 1;

      // Clean up oldest rotated files if we exceed the max
      if (nextNum > MAX_ROTATED) {
        // Delete the oldest (journal.2.jsonl, then shift)
        for (const j of journals) {
          const m = j.name.match(/^journal(?:\.(\d+))?\.jsonl$/);
          if (m) {
            const n = m[1] ? parseInt(m[1], 10) : 1;
            if (n === 2) {
              try {
                await invoke("delete_sync_file", { root: folder, relative: `${deviceId}/${j.name}` });
              } catch { /* ignore */ }
              break;
            }
          }
        }
      }

      // Start a new journal file
      currentJournalRoot = folder;
      currentJournalRelative = `${deviceId}/journal.${nextNum}.jsonl`;
      currentJournalSize = 0;

      // Clean up excess old ones
      if (journals.length >= MAX_ROTATED) {
        for (const j of journals.slice(0, journals.length - MAX_ROTATED + 1)) {
          if (j.name === "journal.jsonl") continue; // keep the original
          try {
            await invoke("delete_sync_file", { root: folder, relative: `${deviceId}/${j.name}` });
          } catch { /* ignore */ }
        }
      }
    }
  } catch (err) {
    console.warn("[sync] rotation check failed:", err);
  }

  return { root: currentJournalRoot, relative: currentJournalRelative };
}

/**
 * Normalizes an entity's field values so they match how they're stored in
 * SQLite: array/object values (e.g. `skills`, `alternateGreetings`) are
 * stringified to JSON, matching the TEXT columns they'll be bound to on the
 * reading side. Callers commonly pass the in-memory (already-parsed) object
 * straight through, so without this, non-string values would hit the DB
 * bind call with the wrong type.
 */
function normalizeEntityForJournal(entity: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    normalized[key] = typeof value === "object" && value !== null ? JSON.stringify(value) : value;
  }
  return normalized;
}

// Top-level entity fields that hold a local absolute path to a file under
// `<app_data_dir>/avatars/` (character/persona avatars, generated item
// illustrations — see `commands/cards.rs`, `commands/image_gen.rs`). These
// paths are meaningless on another device, so the journal carries just the
// filename (see `pushImageFields` below), and the reader (`syncReader.ts`)
// resolves it back to *its own* local absolute path, pulling the file from
// the sync folder first if it doesn't have it yet. Nested images (e.g. a
// per-item icon inside the `inventory` JSON blob) aren't covered by this —
// only these top-level columns.
const IMAGE_FIELDS = ["avatarPath", "avatar_path", "imagePath", "image_path"];

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * Replaces local absolute image paths with bare filenames in `normalized`
 * (mutates in place) and best-effort copies each referenced file into the
 * sync folder so another device can pull it down. Never throws — a failed
 * image push shouldn't block the (much more important) journal write.
 */
async function pushImageFields(root: string, normalized: Record<string, unknown>): Promise<void> {
  for (const field of IMAGE_FIELDS) {
    const value = normalized[field];
    if (typeof value !== "string" || !value) continue;
    const filename = basename(value);
    normalized[field] = filename;
    try {
      await invoke("sync_asset_push", { root, filename });
    } catch (err) {
      console.warn(`[sync] failed to push image asset ${filename}:`, err);
    }
  }
}

/**
 * Appends a journal entry to the current device journal.
 * Gracefully handles missing folders and other errors — never throws.
 */
export async function appendJournalEntry(entry: JournalEntry): Promise<void> {
  try {
    const target = await resolveJournalPath();
    if (!target) return; // sync disabled

    const normalizedEntity = normalizeEntityForJournal(entry.entity);
    await pushImageFields(target.root, normalizedEntity);
    const line = JSON.stringify({ ...entry, entity: normalizedEntity });
    const newSize: number = await invoke("append_journal_line", {
      root: target.root,
      relative: target.relative,
      line,
    });
    currentJournalSize = newSize;
  } catch (err) {
    console.warn("[sync] failed to write journal entry:", err);
  }
}

/**
 * Convenience wrapper: builds and appends a journal entry in one call.
 * Used by repository write functions.
 */
export async function journalEntityWrite(
  type: JournalEntry["type"],
  entity: Record<string, unknown>,
): Promise<void> {
  await appendJournalEntry({
    type,
    action: "upsert",
    ts: new Date().toISOString(),
    entity,
  });
}

/**
 * Convenience wrapper for delete events.
 */
export async function journalEntityDelete(
  type: JournalEntry["type"],
  entity: Record<string, unknown>,
): Promise<void> {
  await appendJournalEntry({
    type,
    action: "delete",
    ts: new Date().toISOString(),
    entity,
  });
}

/** Resets the cached init promise — used when settings change (e.g. user
 *  sets a new sync folder path). */
export function resetSyncJournal(): void {
  initPromise = null;
  currentJournalRoot = null;
  currentJournalRelative = null;
  currentJournalSize = null;
}
