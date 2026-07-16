//! Small generic file I/O commands used by frontend features that need to
//! read/write plain text files chosen via a native dialog (World Info JSON
//! import/export for lorebooks — M4). Kept separate from `cards.rs` since
//! it isn't card-specific.

use std::fs;

/// Reads a text file at `path` and returns its contents. Generic
/// counterpart to `read_card_json_file` for non-card text files (e.g.
/// SillyTavern World Info JSON).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("nepodařilo se přečíst soubor: {e}"))
}

/// Writes `contents` to a text file at `path`, overwriting it if it exists.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("nepodařilo se uložit soubor: {e}"))
}
