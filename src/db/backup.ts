import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import { getDb } from "./database";

/** Flushes SQLite's write-ahead log into the main DB file so a copy of that
 * file alone (no `-wal`/`-shm` sidecars needed) is a complete, consistent
 * snapshot. Safe to call at any time — it's a normal checkpoint, not an
 * exclusive lock. */
async function checkpoint(): Promise<void> {
  const db = await getDb();
  await db.execute("PRAGMA wal_checkpoint(TRUNCATE)");
}

/** Opens a save dialog and writes a full backup (DB + avatars) to the
 * chosen `.zip` path. Returns the path written to, or null if the user
 * cancelled the dialog. */
export async function pickAndExportBackup(): Promise<string | null> {
  const outPath = await save({
    defaultPath: `mysillytavern-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: "MySillyTavern backup", extensions: ["zip"] }],
  });
  if (!outPath) return null;
  await checkpoint();
  await invoke("export_backup", { outPath });
  return outPath;
}

/** Opens an open-file dialog restricted to `.zip`, and if the user picks
 * one, stages it as a pending import (validated to at least contain a DB
 * file). The import only takes effect after the app restarts — callers
 * must prompt for that separately. Returns the picked path, or null if the
 * user cancelled or the file didn't look like a valid backup (the thrown
 * error's message is provider/user-facing Czech/English text from Rust). */
export async function pickAndStageImport(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "MySillyTavern backup", extensions: ["zip"] }],
  });
  if (!path || Array.isArray(path)) return null;
  await invoke("request_import_backup", { zipPath: path });
  return path;
}

export async function hasPendingImport(): Promise<boolean> {
  return invoke<boolean>("has_pending_import");
}

export async function cancelPendingImport(): Promise<void> {
  await invoke("cancel_pending_import");
}

/** Restarts the app process so a staged import gets applied (the swap
 * happens in Rust's `setup()` hook, before the frontend can open the DB
 * again — see `apply_pending_import` in `backup.rs`). */
export async function restartApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
