import { invoke } from "@tauri-apps/api/core";

import { openDialog, saveDialog, relaunchApp } from "../platform";
import { getDb } from "./database";
import { getSetting, setSetting } from "./repositories/settingsRepo";

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
  const outPath = await saveDialog({
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
  const path = await openDialog({
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
  await relaunchApp();
}

// ── M14.1 auto-backup ───────────────────────────────────────────────────

export interface BackupEntry {
  path: string;
  size: number;
  created_at: string;
}

const AUTO_BACKUP_ENABLED_KEY = "auto_backup_enabled";
const AUTO_BACKUP_MAX_COUNT_KEY = "auto_backup_max_count";

/** Reads the auto-backup enabled flag (defaults to true). */
export async function getAutoBackupEnabled(): Promise<boolean> {
  const raw = await getSetting(AUTO_BACKUP_ENABLED_KEY);
  if (raw === null) return true; // default: on
  return raw === "true";
}

export async function setAutoBackupEnabled(enabled: boolean): Promise<void> {
  await setSetting(AUTO_BACKUP_ENABLED_KEY, enabled ? "true" : "false");
}

/** Reads the max backup count (defaults to 5). Clamped to 1–20. */
export async function getAutoBackupMaxCount(): Promise<number> {
  const raw = await getSetting(AUTO_BACKUP_MAX_COUNT_KEY);
  if (raw === null) return 5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(Math.round(n), 20);
}

export async function setAutoBackupMaxCount(count: number): Promise<void> {
  const clamped = Math.max(1, Math.min(20, Math.round(count)));
  await setSetting(AUTO_BACKUP_MAX_COUNT_KEY, String(clamped));
}

/** Creates a backup in `$APPDATA/backups/` and rotates old ones.
 * Returns the path of the newly created backup. */
export async function runAutoBackup(maxCount?: number): Promise<string> {
  await checkpoint();
  return invoke<string>("run_auto_backup", { maxCount: maxCount ?? null });
}

/** Lists existing auto-backups, newest first. */
export async function listBackups(): Promise<BackupEntry[]> {
  return invoke<BackupEntry[]>("list_backups");
}
