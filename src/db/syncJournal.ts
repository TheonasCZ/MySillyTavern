// Sync journal writer — appends mutation events to the device's journal file.
// Rotation: when the current journal exceeds ~10 MB, start journal.2.jsonl,
// journal.3.jsonl, etc. Keep at most 5 rotated files.

import { invoke } from "@tauri-apps/api/core";
import { getSetting } from "./repositories/settingsRepo";
import type { JournalEntry } from "./syncTypes";

const MAX_JOURNAL_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATED = 5;

let currentJournalPath: string | null = null;
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

      const deviceDir = `${folder}/${deviceId}`;
      // List existing journal files, pick the smallest one (or create journal.jsonl)
      const entries: Array<{ name: string; is_dir: boolean; size_bytes: number }> =
        await invoke("list_sync_entries", { dir: deviceDir });

      const journals = entries
        .filter((e) => !e.is_dir && e.name.startsWith("journal") && e.name.endsWith(".jsonl"))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (journals.length > 0) {
        // Use the last (newest) journal file
        const last = journals[journals.length - 1];
        currentJournalPath = `${deviceDir}/${last.name}`;
        currentJournalSize = last.size_bytes;
      } else {
        currentJournalPath = `${deviceDir}/journal.jsonl`;
        currentJournalSize = 0;
      }
    } catch (err) {
      console.warn("[sync] journal init failed, sync disabled:", err);
      currentJournalPath = null;
      currentJournalSize = null;
    }
  })();
  return initPromise;
}

/** Resolves which journal file to write to, rotating if necessary. */
async function resolveJournalPath(): Promise<string | null> {
  await ensureInit();
  if (!currentJournalPath) return null;

  try {
    // If current journal is over the limit, rotate
    if (currentJournalSize !== null && currentJournalSize >= MAX_JOURNAL_SIZE) {
      const folder = await getSetting("sync_folder_path");
      const deviceId = await getSetting("device_id");
      if (!folder || !deviceId) return null;

      const deviceDir = `${folder}/${deviceId}`;
      const entries: Array<{ name: string; is_dir: boolean; size_bytes: number }> =
        await invoke("list_sync_entries", { dir: deviceDir });

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
                await invoke("delete_sync_file", { path: `${deviceDir}/${j.name}` });
              } catch { /* ignore */ }
              break;
            }
          }
        }
      }

      // Start a new journal file
      currentJournalPath = `${deviceDir}/journal.${nextNum}.jsonl`;
      currentJournalSize = 0;

      // Clean up excess old ones
      if (journals.length >= MAX_ROTATED) {
        for (const j of journals.slice(0, journals.length - MAX_ROTATED + 1)) {
          if (j.name === "journal.jsonl") continue; // keep the original
          try {
            await invoke("delete_sync_file", { path: `${deviceDir}/${j.name}` });
          } catch { /* ignore */ }
        }
      }
    }
  } catch (err) {
    console.warn("[sync] rotation check failed:", err);
  }

  return currentJournalPath;
}

/**
 * Appends a journal entry to the current device journal.
 * Gracefully handles missing folders and other errors — never throws.
 */
export async function appendJournalEntry(entry: JournalEntry): Promise<void> {
  try {
    const path = await resolveJournalPath();
    if (!path) return; // sync disabled

    const line = JSON.stringify(entry);
    const newSize: number = await invoke("append_journal_line", { path, line });
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
  currentJournalPath = null;
  currentJournalSize = null;
}
