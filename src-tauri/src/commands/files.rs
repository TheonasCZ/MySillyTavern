//! Small generic file I/O commands used by frontend features that need to
//! read/write plain text files chosen via a native dialog (World Info JSON
//! import/export for lorebooks — M4). Kept separate from `cards.rs` since
//! it isn't card-specific.

use std::fs;
use std::path::Path;

use tauri::{AppHandle, Manager};

/// Rejects paths that resolve outside the app data directory (or its
/// `logs/` subdirectory). Returns the path unchanged on success.
fn validate_app_path(app: &AppHandle, raw: &str) -> Result<(), String> {
    let p = Path::new(raw);
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    let logs_dir = data_dir.join("logs");

    // Resolve to absolute — if the path exists, canonicalize it; otherwise
    // canonicalize the parent and join the filename.
    let resolved = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("current dir: {e}"))?
            .join(p)
    };

    if resolved.starts_with(&data_dir) || resolved.starts_with(&logs_dir) {
        Ok(())
    } else {
        Err(format!(
            "přístup odepřen: cesta je mimo adresář aplikace"
        ))
    }
}

/// Reads a text file at `path` and returns its contents. Generic
/// counterpart to `read_card_json_file` for non-card text files (e.g.
/// SillyTavern World Info JSON).
#[tauri::command]
pub fn read_text_file(app: AppHandle, path: String) -> Result<String, String> {
    validate_app_path(&app, &path)?;
    fs::read_to_string(&path).map_err(|e| format!("nepodařilo se přečíst soubor: {e}"))
}

/// Writes `contents` to a text file at `path`, overwriting it if it exists.
#[tauri::command]
pub fn write_text_file(app: AppHandle, path: String, contents: String) -> Result<(), String> {
    validate_app_path(&app, &path)?;
    fs::write(&path, contents).map_err(|e| format!("nepodařilo se uložit soubor: {e}"))
}
