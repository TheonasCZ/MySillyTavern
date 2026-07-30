//! Sync journal I/O commands — thin Rust layer for the TS sync engine.
//! The TypeScript side owns the journal format, rotation logic, and merge
//! semantics; these commands are just generic filesystem primitives.
//!
//! `root` is the value the user picked in Settings → Sync (`sync_folder_path`):
//! on desktop it's a plain filesystem path (native folder dialog); on Android
//! it's a JSON-serialized `FsUri` (Storage Access Framework tree, picked via
//! `pick_sync_folder` — there is no native folder dialog on Android, and SAF
//! URIs aren't real paths, so they can't be joined with `std::fs`). `relative`
//! is always a plain `/`-joined path *within* that root (e.g. `"{deviceId}"`
//! or `"{deviceId}/journal.jsonl"`), built on the TS side exactly as before.

use tauri::AppHandle;

/// Sanity check for sync paths — unlike `commands/files.rs`'s
/// `validate_app_path`, this is deliberately *not* scoped to the app's own
/// data directory: the entire point of folder sync is writing to a
/// user-chosen external folder (Syncthing/Dropbox/Nextcloud), always picked
/// via a native OS directory dialog, never attacker-controlled input from
/// remote content (this webview never loads any). Restricting to
/// `app_data_dir` here previously made every sync write silently fail with
/// "access denied" the moment the user picked a real sync folder.
fn validate_sync_path(raw: &str) -> Result<(), String> {
    if raw.trim().is_empty() {
        return Err("sync path is empty".to_string());
    }
    Ok(())
}

/// Appends `line` + "\n" to `root`/`relative`, creating the file (and its
/// parent directories) if they don't exist yet. Returns the new file size in
/// bytes (so the TS side can trigger rotation when it crosses ~10 MB).
#[tauri::command]
pub fn append_journal_line(
    app: AppHandle,
    root: String,
    relative: String,
    line: String,
) -> Result<u64, String> {
    validate_sync_path(&root)?;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        desktop::append_journal_line(&root, &relative, &line)
    }
    #[cfg(target_os = "android")]
    {
        android::append_journal_line(&app, &root, &relative, &line)
    }
}

/// Lists immediate children of `root`/`relative` with `name`, `is_dir`, and
/// `size_bytes`. Returns an empty array when the directory does not exist
/// (sync disabled / folder not yet created) so the frontend never sees a
/// hard error.
#[tauri::command]
pub fn list_sync_entries(
    app: AppHandle,
    root: String,
    relative: String,
) -> Result<Vec<SyncDirEntry>, String> {
    validate_sync_path(&root)?;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        desktop::list_sync_entries(&root, &relative)
    }
    #[cfg(target_os = "android")]
    {
        android::list_sync_entries(&app, &root, &relative)
    }
}

/// Reads up to `max_bytes` from `root`/`relative` starting at `start_byte`,
/// returning (raw_text, next_start_byte) where next_start_byte is the
/// position after the last byte read (or `null` when EOF is reached). Used
/// by the journal reader to incrementally consume large journals.
#[tauri::command]
pub fn read_journal_chunk(
    app: AppHandle,
    root: String,
    relative: String,
    start_byte: u64,
    max_bytes: u64,
) -> Result<JournalChunk, String> {
    validate_sync_path(&root)?;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        desktop::read_journal_chunk(&root, &relative, start_byte, max_bytes)
    }
    #[cfg(target_os = "android")]
    {
        android::read_journal_chunk(&app, &root, &relative, start_byte, max_bytes)
    }
}

/// Deletes a file — used by the journal reader to clean up fully-processed
/// rotated journals after they've been consumed.
#[tauri::command]
pub fn delete_sync_file(app: AppHandle, root: String, relative: String) -> Result<(), String> {
    validate_sync_path(&root)?;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        desktop::delete_sync_file(&root, &relative)
    }
    #[cfg(target_os = "android")]
    {
        android::delete_sync_file(&app, &root, &relative)
    }
}

/// Opens the Android system directory picker (Storage Access Framework) and
/// persists read-write access to the chosen tree across app/device restarts.
/// Desktop has no equivalent — `tauri-plugin-dialog`'s native folder dialog
/// is used there instead (see `src/platform.ts::openDialog`).
#[tauri::command]
pub fn pick_sync_folder(app: AppHandle) -> Result<Option<PickedSyncFolder>, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("pick_sync_folder is Android-only".to_string())
    }
    #[cfg(target_os = "android")]
    {
        android::pick_sync_folder(&app)
    }
}

#[derive(serde::Serialize)]
pub struct SyncDirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
}

#[derive(serde::Serialize)]
pub struct JournalChunk {
    pub text: String,
    /// `null` when this chunk reached EOF.
    pub next_start_byte: Option<u64>,
    pub total_bytes: u64,
}

#[derive(serde::Serialize)]
pub struct PickedSyncFolder {
    /// JSON-serialized `FsUri` — stored verbatim as `sync_folder_path` and
    /// passed back as `root` on every subsequent sync command.
    pub root: String,
    /// Human-readable directory name, for display in Settings (the raw URI
    /// is not something a user should have to read).
    pub display_name: String,
}

#[cfg(not(target_os = "android"))]
mod desktop {
    use super::{JournalChunk, SyncDirEntry};
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    fn joined(root: &str, relative: &str) -> PathBuf {
        if relative.is_empty() {
            PathBuf::from(root)
        } else {
            Path::new(root).join(relative)
        }
    }

    pub fn append_journal_line(root: &str, relative: &str, line: &str) -> Result<u64, String> {
        let p = joined(root, relative);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("cannot create sync folder: {e}"))?;
        }
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&p)
            .map_err(|e| format!("cannot open journal: {e}"))?;
        writeln!(f, "{line}").map_err(|e| format!("cannot write journal: {e}"))?;
        let meta = f.metadata().map_err(|e| format!("cannot stat journal: {e}"))?;
        Ok(meta.len())
    }

    pub fn list_sync_entries(root: &str, relative: &str) -> Result<Vec<SyncDirEntry>, String> {
        let p = joined(root, relative);
        if !p.is_dir() {
            return Ok(Vec::new());
        }
        let mut entries = Vec::new();
        let iter = fs::read_dir(&p).map_err(|e| format!("cannot read sync folder: {e}"))?;
        for entry in iter {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue; // skip hidden files/folders
            }
            entries.push(SyncDirEntry {
                name,
                is_dir: meta.is_dir(),
                size_bytes: meta.len(),
            });
        }
        Ok(entries)
    }

    pub fn read_journal_chunk(
        root: &str,
        relative: &str,
        start_byte: u64,
        max_bytes: u64,
    ) -> Result<JournalChunk, String> {
        use std::io::Read;
        let p = joined(root, relative);
        let mut f =
            fs::File::open(&p).map_err(|e| format!("cannot open journal for reading: {e}"))?;
        let total = f.metadata().map_err(|e| format!("cannot stat journal: {e}"))?.len();
        if start_byte >= total {
            return Ok(JournalChunk {
                text: String::new(),
                next_start_byte: None,
                total_bytes: total,
            });
        }
        use std::io::Seek;
        f.seek(std::io::SeekFrom::Start(start_byte))
            .map_err(|e| format!("cannot seek journal: {e}"))?;
        let limit = std::cmp::min(max_bytes as usize, (total - start_byte) as usize);
        let mut buf = vec![0u8; limit];
        let n = f.read(&mut buf).map_err(|e| format!("cannot read journal: {e}"))?;
        buf.truncate(n);
        // Extend to the next newline so we never split a line.
        if (start_byte + n as u64) < total {
            let mut extra = Vec::new();
            let mut byte_buf = [0u8; 1];
            loop {
                match f.read(&mut byte_buf) {
                    Ok(0) => break,
                    Ok(1) => {
                        extra.push(byte_buf[0]);
                        if byte_buf[0] == b'\n' {
                            break;
                        }
                    }
                    Ok(_) => break, // buffer is 1 byte, only 0/1 possible
                    Err(_) => break,
                }
            }
            buf.extend(&extra);
        }
        let text = String::from_utf8_lossy(&buf).into_owned();
        let end = start_byte + buf.len() as u64;
        Ok(JournalChunk {
            text,
            next_start_byte: if end < total { Some(end) } else { None },
            total_bytes: total,
        })
    }

    pub fn delete_sync_file(root: &str, relative: &str) -> Result<(), String> {
        let p = joined(root, relative);
        match fs::remove_file(&p) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("cannot delete sync file: {e}")),
        }
    }
}

#[cfg(target_os = "android")]
mod android {
    use super::{JournalChunk, PickedSyncFolder, SyncDirEntry};
    use std::path::Path;
    use tauri::AppHandle;
    use tauri_plugin_android_fs::{AndroidFsExt, Entry, FileAccessMode, FsUri};

    fn root_uri(root: &str) -> Result<FsUri, String> {
        FsUri::from_json_str(root).map_err(|e| format!("invalid sync folder URI: {e}"))
    }

    /// Resolves an *existing* file, or `Ok(None)` if it (or an ancestor
    /// directory) doesn't exist yet — mirrors the desktop `is_dir()`/`File::open`
    /// "not there yet" cases, which callers treat as empty/absent rather than
    /// an error.
    fn try_resolve_file(app: &AppHandle, root: &FsUri, relative: &str) -> Option<FsUri> {
        app.android_fs().resolve_file_uri(root, relative).ok()
    }

    pub fn append_journal_line(
        app: &AppHandle,
        root: &str,
        relative: &str,
        line: &str,
    ) -> Result<u64, String> {
        use std::io::Write;
        let root = root_uri(root)?;
        let fs = app.android_fs();
        let uri = match try_resolve_file(app, &root, relative) {
            Some(uri) => uri,
            None => fs
                .create_new_file(&root, relative, Some("application/x-ndjson"))
                .map_err(|e| format!("cannot create journal: {e}"))?,
        };
        let mut f = fs
            .open_file(&uri, FileAccessMode::WriteAppend)
            .map_err(|e| format!("cannot open journal: {e}"))?;
        writeln!(f, "{line}").map_err(|e| format!("cannot write journal: {e}"))?;
        fs.get_len(&uri).map_err(|e| format!("cannot stat journal: {e}"))
    }

    pub fn list_sync_entries(
        app: &AppHandle,
        root: &str,
        relative: &str,
    ) -> Result<Vec<SyncDirEntry>, String> {
        let root = root_uri(root)?;
        let fs = app.android_fs();
        let dir_uri = if relative.is_empty() {
            root
        } else {
            match fs.resolve_dir_uri(&root, relative) {
                Ok(uri) => uri,
                Err(_) => return Ok(Vec::new()), // not created yet
            }
        };
        let entries = fs
            .read_dir(&dir_uri)
            .map_err(|e| format!("cannot read sync folder: {e}"))?;
        Ok(entries
            .into_iter()
            .filter_map(|e| match e {
                Entry::File { name, len, .. } if !name.starts_with('.') => {
                    Some(SyncDirEntry { name, is_dir: false, size_bytes: len })
                }
                Entry::Dir { name, .. } if !name.starts_with('.') => {
                    Some(SyncDirEntry { name, is_dir: true, size_bytes: 0 })
                }
                _ => None,
            })
            .collect())
    }

    pub fn read_journal_chunk(
        app: &AppHandle,
        root: &str,
        relative: &str,
        start_byte: u64,
        max_bytes: u64,
    ) -> Result<JournalChunk, String> {
        let root = root_uri(root)?;
        let fs = app.android_fs();
        let uri = try_resolve_file(app, &root, relative)
            .ok_or_else(|| "cannot open journal for reading: not found".to_string())?;
        // SAF file descriptors aren't reliably seekable (some providers hand
        // back a pipe), so — unlike desktop — this reads the whole file and
        // slices it in memory. Journals are capped at ~10 MB before rotation,
        // so this is a deliberate simplicity-over-throughput tradeoff.
        let data = fs.read(&uri).map_err(|e| format!("cannot read journal: {e}"))?;
        let total = data.len() as u64;
        if start_byte >= total {
            return Ok(JournalChunk { text: String::new(), next_start_byte: None, total_bytes: total });
        }
        let start = start_byte as usize;
        let limit = std::cmp::min(max_bytes as usize, data.len() - start);
        let mut end = start + limit;
        // Extend to the next newline so we never split a line.
        if end < data.len() {
            while end < data.len() && data[end - 1] != b'\n' {
                end += 1;
            }
        }
        let text = String::from_utf8_lossy(&data[start..end]).into_owned();
        Ok(JournalChunk {
            text,
            next_start_byte: if (end as u64) < total { Some(end as u64) } else { None },
            total_bytes: total,
        })
    }

    pub fn delete_sync_file(app: &AppHandle, root: &str, relative: &str) -> Result<(), String> {
        let root = root_uri(root)?;
        match try_resolve_file(app, &root, relative) {
            Some(uri) => app
                .android_fs()
                .remove_file(&uri)
                .map_err(|e| format!("cannot delete sync file: {e}")),
            None => Ok(()), // already gone
        }
    }

    pub fn pick_sync_folder(app: &AppHandle) -> Result<Option<PickedSyncFolder>, String> {
        let fs = app.android_fs();
        let picker = fs.picker();
        let Some(uri) = picker
            .pick_dir(None, false)
            .map_err(|e| format!("folder picker failed: {e}"))?
        else {
            return Ok(None);
        };
        picker
            .persist_uri_permission(&uri)
            .map_err(|e| format!("cannot persist folder access: {e}"))?;
        let display_name = fs
            .get_name(&uri)
            .unwrap_or_else(|_| Path::new(&uri.uri).to_string_lossy().into_owned());
        let root = uri
            .to_json_string()
            .map_err(|e| format!("cannot serialize folder URI: {e}"))?;
        Ok(Some(PickedSyncFolder { root, display_name }))
    }
}
