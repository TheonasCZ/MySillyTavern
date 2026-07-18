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

/// Appends one already-formatted line to the app log, rotating first if
/// needed. Truncates to `MAX_LINE_CHARS` characters (counted, not bytes, to
/// stay on a char boundary) so a single pathological error can't blow up
/// the file. This is the plain-function core shared by the `append_log`
/// Tauri command (frontend IPC) and `log_line` (direct Rust callers, see
/// below) — both funnel into the same `app.log`.
fn append_log_line(app: &AppHandle, line: String) -> Result<(), String> {
    let dir = logs_dir(app)?;
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

/// Thin IPC wrapper over `append_log_line` for the frontend's existing
/// `invoke("append_log", { line })` calls (see `src/logging.ts`) — the
/// frontend pre-builds the full `{timestamp} [{level}] {message}` line
/// itself, so this just writes it as-is.
#[tauri::command]
pub fn append_log(app: AppHandle, line: String) -> Result<(), String> {
    append_log_line(&app, line)
}

/// Log levels for Rust-side call sites, mirroring the frontend's
/// debug/info/warn/error scheme (see `src/logging.ts`). Rust-side logging
/// does not currently respect the user-configured minimum level (that
/// setting lives in SQLite and reading it synchronously from arbitrary
/// command handlers isn't worth the complexity yet, given how few Rust
/// call sites there are) — every level is always written.
#[derive(Clone, Copy)]
#[allow(dead_code)] // full four-level API kept for future call sites, not all levels used yet
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn as_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }
}

/// Writes one level-prefixed, timestamped line to `app.log` from Rust code
/// that already has an `AppHandle` in scope (most command handlers do).
/// Mirrors the exact format `buildLine` in `src/logging.ts` uses
/// (`{ISO timestamp} [{level}] {message}`) so the file has one consistent
/// format regardless of which side wrote a given line. Best-effort: a
/// failure to write is silently dropped (logging must never itself cause a
/// visible failure), matching the frontend's fire-and-forget semantics.
pub fn log_line(app: &AppHandle, level: LogLevel, message: &str) {
    let line = format!("{} [{}] {message}", iso_timestamp_now(), level.as_str());
    let _ = append_log_line(app, line);
}

/// Formats the current time as `YYYY-MM-DDTHH:MM:SS.mmmZ`, matching the
/// format `new Date().toISOString()` produces on the frontend (see
/// `buildLine` in `src/logging.ts`) so `app.log` has one consistent
/// timestamp format regardless of which side wrote a line. Deliberately
/// avoids pulling in the `chrono` crate for this — same manual-ISO
/// convention already used by `export_campaign::chrono_now`.
fn iso_timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let secs_rem = time_of_day % 60;
    let (year, month, day) = days_to_ymd(days_since_epoch as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, secs_rem, millis
    )
}

/// Converts days-since-Unix-epoch to a (year, month, day) triple. Adapted
/// from Howard Hinnant's algorithm — copy of
/// `export_campaign::days_to_ymd`, duplicated rather than shared to keep
/// this module self-contained (it's a handful of lines).
fn days_to_ymd(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
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
    fn iso_timestamp_matches_expected_shape() {
        // e.g. "2026-07-17T10:39:14.123Z" — same shape as JS's
        // `new Date().toISOString()`, which `buildLine` in src/logging.ts
        // uses, so app.log has one consistent format from both sides.
        let ts = iso_timestamp_now();
        assert_eq!(ts.len(), 24, "unexpected length: {ts}");
        assert!(ts.ends_with('Z'));
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], "T");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
        assert_eq!(&ts[19..20], ".");
    }

    #[test]
    fn log_level_as_str_matches_frontend_level_names() {
        assert_eq!(LogLevel::Debug.as_str(), "debug");
        assert_eq!(LogLevel::Info.as_str(), "info");
        assert_eq!(LogLevel::Warn.as_str(), "warn");
        assert_eq!(LogLevel::Error.as_str(), "error");
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
