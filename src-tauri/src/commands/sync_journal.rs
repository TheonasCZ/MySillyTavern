//! Sync journal I/O commands — thin Rust layer for the TS sync engine.
//! The TypeScript side owns the journal format, rotation logic, and merge
//! semantics; these commands are just generic filesystem primitives.

use std::fs;
use std::io::Write;
use std::path::Path;

/// Appends `line` + "\n" to `path`, creating the file (and its parent
/// directories) if they don't exist yet. Returns the new file size in bytes
/// (so the TS side can trigger rotation when it crosses ~10 MB).
#[tauri::command]
pub fn append_journal_line(path: String, line: String) -> Result<u64, String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create sync folder: {e}"))?;
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p)
        .map_err(|e| format!("cannot open journal: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("cannot write journal: {e}"))?;
    let meta = f.metadata().map_err(|e| format!("cannot stat journal: {e}"))?;
    Ok(meta.len())
}

/// Lists immediate children of `dir` with `name`, `is_dir`, and `size_bytes`.
/// Returns an empty array when the directory does not exist (sync disabled /
/// folder not yet created) so the frontend never sees a hard error.
#[tauri::command]
pub fn list_sync_entries(dir: String) -> Result<Vec<SyncDirEntry>, String> {
    let p = Path::new(&dir);
    if !p.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let iter = fs::read_dir(p).map_err(|e| format!("cannot read sync folder: {e}"))?;
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

/// Reads up to `max_bytes` from `path` starting at `start_byte`, returning
/// (raw_text, next_start_byte) where next_start_byte is the position after
/// the last byte read (or `null` when EOF is reached). Used by the journal
/// reader to incrementally consume large journals.
#[tauri::command]
pub fn read_journal_chunk(
    path: String,
    start_byte: u64,
    max_bytes: u64,
) -> Result<JournalChunk, String> {
    use std::io::Read;
    let mut f = fs::File::open(&path).map_err(|e| format!("cannot open journal for reading: {e}"))?;
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

/// Deletes a file — used by the journal reader to clean up fully-processed
/// rotated journals after they've been consumed.
#[tauri::command]
pub fn delete_sync_file(path: String) -> Result<(), String> {
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot delete sync file: {e}")),
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
