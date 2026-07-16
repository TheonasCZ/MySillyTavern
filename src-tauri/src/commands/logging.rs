//! Error log collection (roadmap M11 §3): frontend `console.error`/`warn`,
//! window `error`/`unhandledrejection` events, and (in principle) Rust-side
//! errors all funnel into a single `$APPDATA/logs/app.log` file so a user
//! can attach it when reporting a bug. The frontend does the actual
//! wrapping/capturing (see `src/logging.ts`); this module just owns the
//! append-with-rotation logic and exposes it as a command.
//!
//! Rotation keeps at most two files (`app.log` + `app.log.1`) capped at
//! ~2 MB each, checked before every write so the log can never grow
//! unbounded even if the app runs for a long time without a restart.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "app.log";
const ROTATE_AT_BYTES: u64 = 2 * 1024 * 1024; // 2 MB
const MAX_LINE_CHARS: usize = 4000;

fn logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("nepodařilo se najít adresář aplikace: {e}"))?
        .join(LOG_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("nepodařilo se vytvořit adresář logů: {e}"))?;
    Ok(dir)
}

/// Rotates `log_path` to `log_path.1` (overwriting any previous `.1`) if it
/// currently exceeds `max_bytes`. Pure over `Path` so it's testable without
/// an `AppHandle`/temp app data dir.
fn rotate_if_needed(log_path: &Path, max_bytes: u64) -> std::io::Result<()> {
    let size = match fs::metadata(log_path) {
        Ok(meta) => meta.len(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if size <= max_bytes {
        return Ok(());
    }
    let rotated = log_path.with_extension("log.1");
    // `rename` overwrites the destination on both Unix and Windows here
    // (std::fs::rename replaces an existing file on Unix; on Windows it
    // would fail, so remove first defensively).
    if rotated.exists() {
        fs::remove_file(&rotated)?;
    }
    fs::rename(log_path, &rotated)
}

/// Appends one line to the app log, rotating first if needed. Truncates
/// `line` to `MAX_LINE_CHARS` characters (counted, not bytes, to stay on a
/// char boundary) so a single pathological error can't blow up the file.
#[tauri::command]
pub fn append_log(app: AppHandle, line: String) -> Result<(), String> {
    let dir = logs_dir(&app)?;
    let path = dir.join(LOG_FILE_NAME);

    rotate_if_needed(&path, ROTATE_AT_BYTES).map_err(|e| format!("nepodařilo se rotovat log: {e}"))?;

    let truncated: String = if line.chars().count() > MAX_LINE_CHARS {
        line.chars().take(MAX_LINE_CHARS).collect::<String>() + "…"
    } else {
        line
    };

    use std::fs::OpenOptions;
    use std::io::Write;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("nepodařilo se otevřít log: {e}"))?;
    writeln!(file, "{truncated}").map_err(|e| format!("nepodařilo se zapsat do logu: {e}"))?;
    Ok(())
}

/// Returns the absolute path to `app.log` (whether or not it exists yet) so
/// the UI can show it and the "open log folder" button can reveal it.
#[tauri::command]
pub fn get_log_path(app: AppHandle) -> Result<String, String> {
    let path = logs_dir(&app)?.join(LOG_FILE_NAME);
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_log_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("mst_logging_test_{name}_{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn no_op_when_file_missing() {
        let path = temp_log_path("missing");
        assert!(!path.exists());
        rotate_if_needed(&path, 100).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn no_op_when_under_limit() {
        let path = temp_log_path("under");
        fs::write(&path, b"small").unwrap();
        rotate_if_needed(&path, 100).unwrap();
        assert!(path.exists());
        assert_eq!(fs::read(&path).unwrap(), b"small");
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn rotates_when_over_limit() {
        let path = temp_log_path("over");
        let rotated = path.with_extension("log.1");
        let _ = fs::remove_file(&rotated);

        fs::write(&path, vec![b'x'; 200]).unwrap();
        rotate_if_needed(&path, 100).unwrap();

        assert!(!path.exists(), "original should have been moved away");
        assert!(rotated.exists());
        assert_eq!(fs::read(&rotated).unwrap().len(), 200);

        fs::remove_file(&rotated).unwrap();
    }

    #[test]
    fn overwrites_previous_rotated_file() {
        let path = temp_log_path("overwrite");
        let rotated = path.with_extension("log.1");

        fs::write(&rotated, b"old rotated contents").unwrap();
        fs::write(&path, vec![b'y'; 300]).unwrap();
        rotate_if_needed(&path, 100).unwrap();

        assert!(!path.exists());
        assert_eq!(fs::read(&rotated).unwrap().len(), 300);

        fs::remove_file(&rotated).unwrap();
    }
}
