//! Data export/import (plan §7 M6): a full backup is just the SQLite
//! database file plus the `avatars/` directory, zipped together. Import is
//! staged rather than applied immediately — the running process already
//! holds the sqlite connection (via `tauri-plugin-sql`, opened lazily on
//! the JS side's first `Database.load()`), so swapping the file out from
//! under it while open would risk corruption. Instead `request_import_backup`
//! stages the zip as `pending_import.zip` under the app data dir, and
//! `apply_pending_import` (called from `run()`'s `.setup()` hook, before the
//! frontend ever calls `Database.load()`) applies it on the next app start.
//! The frontend asks the user to restart (or calls `relaunch()`) right
//! after staging.
//!
//! M14.1 — Automatic rotating backups: on startup (and on demand via the
//! settings panel) we write a timestamped zip into `$APPDATA/backups/` and
//! then trim the directory to keep only the N most recent backups.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

const DB_FILE_NAME: &str = "mysillytavern.db";
const PENDING_IMPORT_FILE_NAME: &str = "pending_import.zip";
const BACKUPS_DIR_NAME: &str = "backups";
const DEFAULT_MAX_BACKUPS: usize = 5;

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("nepodařilo se najít adresář aplikace: {e}"))
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(DB_FILE_NAME))
}

fn avatars_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("avatars"))
}

/// Adds a single file to the zip archive under `zip_path`, if it exists on
/// disk. Sqlite's WAL/SHM sidecar files (present while the app has the DB
/// open in WAL mode) aren't guaranteed to exist, so this is silent when the
/// source file is missing rather than erroring.
fn add_file_if_exists<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    disk_path: &Path,
    zip_path: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    if !disk_path.exists() {
        return Ok(());
    }
    let mut buf = Vec::new();
    fs::File::open(disk_path)
        .and_then(|mut f| f.read_to_end(&mut buf))
        .map_err(|e| format!("nepodařilo se přečíst {}: {e}", disk_path.display()))?;
    zip.start_file(zip_path, options)
        .map_err(|e| format!("nepodařilo se zapsat do zálohy: {e}"))?;
    zip.write_all(&buf)
        .map_err(|e| format!("nepodařilo se zapsat do zálohy: {e}"))?;
    Ok(())
}

fn add_dir_recursive<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    zip_prefix: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("nepodařilo se přečíst adresář: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("nepodařilo se přečíst adresář: {e}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            add_dir_recursive(zip, &path, &format!("{zip_prefix}{name}/"), options)?;
        } else {
            add_file_if_exists(zip, &path, &format!("{zip_prefix}{name}"), options)?;
        }
    }
    Ok(())
}

/// Zips the sqlite DB file (plus WAL/SHM sidecars if present) and the whole
/// `avatars/` directory into `out_path`. The frontend should run
/// `PRAGMA wal_checkpoint(TRUNCATE)` right before calling this so the main
/// DB file has everything committed (the sidecars are included too as a
/// belt-and-suspenders measure, but shouldn't normally be needed).
#[tauri::command]
pub fn export_backup(app: AppHandle, out_path: String) -> Result<(), String> {
    export_backup_inner(&app, &out_path)
}

/// Validates that `zip_path` looks like a backup (contains the DB file
/// entry) and stages it as `pending_import.zip` in the app data dir. The
/// actual replacement happens on next launch, before the frontend opens the
/// database (see `apply_pending_import`) — the caller must restart the app
/// (or call `relaunch`) for the import to take effect.
#[tauri::command]
pub fn request_import_backup(app: AppHandle, zip_path: String) -> Result<(), String> {
    let file = fs::File::open(&zip_path).map_err(|e| format!("nepodařilo se otevřít soubor: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("soubor není platná záloha (ZIP): {e}"))?;
    if archive.by_name(DB_FILE_NAME).is_err() {
        return Err("Soubor neobsahuje databázi zálohy — nevypadá jako záloha MySillyTavern.".to_string());
    }
    drop(archive);

    let dest = app_data_dir(&app)?.join(PENDING_IMPORT_FILE_NAME);
    fs::copy(&zip_path, &dest).map_err(|e| format!("nepodařilo se uložit zálohu k importu: {e}"))?;
    Ok(())
}

/// Returns `true` if an import is staged and waiting for the app to
/// restart — lets the UI show "import pending, please restart" if the user
/// navigates away before restarting.
#[tauri::command]
pub fn has_pending_import(app: AppHandle) -> Result<bool, String> {
    Ok(app_data_dir(&app)?.join(PENDING_IMPORT_FILE_NAME).exists())
}

/// Cancels a staged import (deletes `pending_import.zip` without applying
/// it), in case the user changes their mind before restarting.
#[tauri::command]
pub fn cancel_pending_import(app: AppHandle) -> Result<(), String> {
    let path = app_data_dir(&app)?.join(PENDING_IMPORT_FILE_NAME);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("nepodařilo se zrušit import: {e}"))?;
    }
    Ok(())
}

fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else if path.exists() {
        fs::remove_file(path)
    } else {
        Ok(())
    }
}

/// Applies a staged `pending_import.zip`, if one exists, replacing the DB
/// file (and its WAL/SHM sidecars, if any) and the `avatars/` directory with
/// the zip's contents. Must run before anything opens the sqlite connection
/// — called from the `.setup()` hook in `run()`, which executes before the
/// frontend gets a chance to call `Database.load()`. Logs and swallows
/// errors rather than panicking, so a corrupt staged zip doesn't stop the
/// whole app from starting — worst case, the import silently doesn't apply
/// and the user's existing data is untouched (the pending file may still
/// need clearing).
pub fn apply_pending_import(app: &AppHandle) {
    let pending = match app_data_dir(app) {
        Ok(dir) => dir.join(PENDING_IMPORT_FILE_NAME),
        Err(e) => {
            eprintln!("apply_pending_import: {e}");
            return;
        }
    };
    if !pending.exists() {
        return;
    }

    if let Err(e) = apply_pending_import_inner(app, &pending) {
        eprintln!("apply_pending_import failed: {e}");
    }
    // Always remove the marker afterwards, success or failure — a failed
    // import shouldn't retry forever on every subsequent launch.
    let _ = fs::remove_file(&pending);
}

fn apply_pending_import_inner(app: &AppHandle, pending: &Path) -> Result<(), String> {
    let file = fs::File::open(pending).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    let data_dir = app_data_dir(app)?;
    let staging = data_dir.join("_import_staging");
    remove_if_exists(&staging).map_err(|e| e.to_string())?;
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    archive.extract(&staging).map_err(|e| format!("nepodařilo se rozbalit zálohu: {e}"))?;

    let db = data_dir.join(DB_FILE_NAME);
    remove_if_exists(&db).map_err(|e| e.to_string())?;
    remove_if_exists(&db.with_extension("db-wal")).map_err(|e| e.to_string())?;
    remove_if_exists(&db.with_extension("db-shm")).map_err(|e| e.to_string())?;

    let staged_db = staging.join(DB_FILE_NAME);
    if staged_db.exists() {
        fs::rename(&staged_db, &db).map_err(|e| e.to_string())?;
    }
    for sidecar in ["mysillytavern.db-wal", "mysillytavern.db-shm"] {
        let staged = staging.join(sidecar);
        if staged.exists() {
            let _ = fs::rename(&staged, data_dir.join(sidecar));
        }
    }

    let avatars = data_dir.join("avatars");
    let staged_avatars = staging.join("avatars");
    if staged_avatars.exists() {
        remove_if_exists(&avatars).map_err(|e| e.to_string())?;
        fs::rename(&staged_avatars, &avatars).map_err(|e| e.to_string())?;
    }

    remove_if_exists(&staging).map_err(|e| e.to_string())?;
    Ok(())
}

// ── M14.1 auto-backup ───────────────────────────────────────────────────

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join(BACKUPS_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("nepodařilo se vytvořit adresář záloh: {e}"))?;
    Ok(dir)
}

/// Formats a `SystemTime` as a compact timestamp suitable for filenames
/// (e.g. `2025-07-14T183045`). Falls back to `"unknown"` when the time is
/// before the Unix epoch (should never happen on a real system).
fn format_timestamp(ts: SystemTime) -> String {
    match ts.duration_since(UNIX_EPOCH) {
        Ok(dur) => {
            let secs = dur.as_secs();
            //  seconds since epoch → broken-down UTC
            let days = secs / 86400;
            let time_of_day = secs % 86400;
            let hours = time_of_day / 3600;
            let minutes = (time_of_day % 3600) / 60;
            let secs_rem = time_of_day % 60;

            //  days since 1970-01-01 → year/month/day using civil calendar
            //  algorithm (Howard Hinnant / std::chrono compatible)
            let (y, m, d) = civil_from_days(days as i64);
            format!("{y:04}-{m:02}-{d:02}T{hours:02}{minutes:02}{secs_rem:02}")
        }
        Err(_) => "unknown".to_string(),
    }
}

/// Converts days since 1970-01-01 to (year, month, day) using the
/// Howard Hinnant algorithm (public domain).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Keeps only the `max_count` most-recently-modified `.zip` files in the
/// backups directory. Silently ignores I/O errors on individual files
/// (missing metadata, permissions) — a single unreadable file shouldn't
/// block the rotation.
fn cleanup_old_backups(app: &AppHandle, max_count: usize) {
    let dir = match backups_dir(app) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("cleanup_old_backups: {e}");
            return;
        }
    };
    let mut entries: Vec<(PathBuf, SystemTime)> = match fs::read_dir(&dir) {
        Ok(iter) => iter
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "zip"))
            .filter_map(|e| {
                let md = e.metadata().ok()?;
                Some((e.path(), md.modified().ok()?))
            })
            .collect(),
        Err(e) => {
            eprintln!("cleanup_old_backups: read_dir failed: {e}");
            return;
        }
    };
    if entries.len() <= max_count {
        return;
    }
    // newest first
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    for (path, _) in entries.into_iter().skip(max_count) {
        let _ = fs::remove_file(&path);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupEntry {
    path: String,
    size: u64,
    created_at: String,
}

/// Creates a timestamped backup zip in `$APPDATA/backups/`, then rotates
/// old backups so at most `max_count` remain.  Spawned from the setup hook
/// (with default `max_count`) and also callable from the frontend on-demand.
#[tauri::command]
pub fn run_auto_backup(app: AppHandle, max_count: Option<usize>) -> Result<String, String> {
    let max_count = max_count.unwrap_or(DEFAULT_MAX_BACKUPS);
    let dir = backups_dir(&app)?;
    //  Build a filename like `mysillytavern-backup-2025-07-14T183045.zip`
    let ts = format_timestamp(SystemTime::now());
    let name = format!("mysillytavern-backup-{ts}.zip");
    let out_path = dir.join(&name);
    let out_str = out_path.to_string_lossy().to_string();

    // Reuse the existing export logic
    export_backup_inner(&app, &out_str)?;
    cleanup_old_backups(&app, max_count);
    Ok(out_str)
}

/// Internal helper: same logic as the `export_backup` command but takes an
/// `&AppHandle` + `&str` path so `run_auto_backup` can call it without
/// going through Tauri command dispatch.
fn export_backup_inner(app: &AppHandle, out_path: &str) -> Result<(), String> {
    let db = db_path(app)?;
    if !db.exists() {
        return Err("Databáze zatím neexistuje, není co zálohovat.".to_string());
    }
    let avatars = avatars_path(app)?;

    let file = fs::File::create(out_path)
        .map_err(|e| format!("nepodařilo se vytvořit soubor zálohy: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    add_file_if_exists(&mut zip, &db, DB_FILE_NAME, options)?;
    add_file_if_exists(
        &mut zip,
        &db.with_extension("db-wal"),
        "mysillytavern.db-wal",
        options,
    )?;
    add_file_if_exists(
        &mut zip,
        &db.with_extension("db-shm"),
        "mysillytavern.db-shm",
        options,
    )?;
    add_dir_recursive(&mut zip, &avatars, "avatars/", options)?;

    zip.finish()
        .map_err(|e| format!("nepodařilo se dokončit zálohu: {e}"))?;
    Ok(())
}

/// Lists all `.zip` files in the backups directory with their size and
/// last-modified timestamp. Returns newest-first.
#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupEntry>, String> {
    let dir = backups_dir(&app)?;
    let mut entries: Vec<BackupEntry> = Vec::new();
    let iter = fs::read_dir(&dir)
        .map_err(|e| format!("nepodařilo se přečíst adresář záloh: {e}"))?;
    for entry in iter {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().map_or(true, |ext| ext != "zip") {
            continue;
        }
        let meta = match path.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let created_at = meta
            .modified()
            .map(format_timestamp)
            .unwrap_or_else(|_| "unknown".to_string());
        entries.push(BackupEntry {
            path: path.to_string_lossy().to_string(),
            size: meta.len(),
            created_at,
        });
    }
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

/// Entry-point called from the Tauri setup hook (before the frontend
/// opens the DB). Uses the default max-backup count since the settings
/// table isn't accessible yet. The work is spawned onto a background
/// thread so it doesn't block startup.
pub fn run_auto_backup_at_startup(app: &AppHandle) {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = (|| -> Result<(), String> {
            let dir = backups_dir(&app_handle)?;
            let ts = format_timestamp(SystemTime::now());
            let name = format!("mysillytavern-backup-{ts}.zip");
            let out_path = dir.join(&name);
            let out_str = out_path.to_string_lossy().to_string();
            export_backup_inner(&app_handle, &out_str)?;
            cleanup_old_backups(&app_handle, DEFAULT_MAX_BACKUPS);
            Ok(())
        })() {
            eprintln!("run_auto_backup_at_startup failed: {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Builds a zip in memory containing a fake DB file and one avatar,
    /// then round-trips it through the same extraction logic
    /// `apply_pending_import_inner` uses, verified against a temp dir
    /// standing in for the app data dir (no AppHandle needed for this part).
    #[test]
    fn zip_roundtrip_extracts_db_and_avatars() {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            zip.start_file(DB_FILE_NAME, options).unwrap();
            zip.write_all(b"fake sqlite bytes").unwrap();
            zip.start_file("avatars/abc.png", options).unwrap();
            zip.write_all(b"fake png bytes").unwrap();
            zip.finish().unwrap();
        }

        let dir = std::env::temp_dir().join(format!("mst_backup_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let mut archive = ZipArchive::new(Cursor::new(&buf)).unwrap();
        assert!(archive.by_name(DB_FILE_NAME).is_ok());
        archive.extract(&dir).unwrap();

        assert_eq!(fs::read(dir.join(DB_FILE_NAME)).unwrap(), b"fake sqlite bytes");
        assert_eq!(fs::read(dir.join("avatars/abc.png")).unwrap(), b"fake png bytes");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_zip_without_db_entry() {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            zip.start_file("not_a_db.txt", options).unwrap();
            zip.write_all(b"hello").unwrap();
            zip.finish().unwrap();
        }
        let mut archive = ZipArchive::new(Cursor::new(&buf)).unwrap();
        assert!(archive.by_name(DB_FILE_NAME).is_err());
    }
}
