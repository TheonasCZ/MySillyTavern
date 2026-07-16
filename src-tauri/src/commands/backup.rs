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

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

const DB_FILE_NAME: &str = "mysillytavern.db";
const PENDING_IMPORT_FILE_NAME: &str = "pending_import.zip";

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
    let db = db_path(&app)?;
    if !db.exists() {
        return Err("Databáze zatím neexistuje, není co zálohovat.".to_string());
    }
    let avatars = avatars_path(&app)?;

    let file = fs::File::create(&out_path).map_err(|e| format!("nepodařilo se vytvořit soubor zálohy: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    add_file_if_exists(&mut zip, &db, DB_FILE_NAME, options)?;
    add_file_if_exists(&mut zip, &db.with_extension("db-wal"), "mysillytavern.db-wal", options)?;
    add_file_if_exists(&mut zip, &db.with_extension("db-shm"), "mysillytavern.db-shm", options)?;
    add_dir_recursive(&mut zip, &avatars, "avatars/", options)?;

    zip.finish().map_err(|e| format!("nepodařilo se dokončit zálohu: {e}"))?;
    Ok(())
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
