//! Character card import/export commands. Reads/writes the embedded PNG
//! metadata via `png_card` and manages the on-disk copies of card avatars
//! kept under `<app_data_dir>/avatars/`.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::png_card;

fn avatars_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("nepodařilo se najít adresář aplikace: {e}"))?;
    let dir = base.join("avatars");
    fs::create_dir_all(&dir).map_err(|e| format!("nepodařilo se vytvořit adresář avatarů: {e}"))?;
    Ok(dir)
}

#[derive(Debug, Serialize)]
pub struct ImportCardResult {
    pub card_json: String,
    pub avatar_saved_to: String,
}

/// Reads a character card from a PNG file at `path` (any location the user
/// picked via a file dialog) and stores a copy of that PNG under the app's
/// avatars directory, named by a freshly generated id — independent of
/// whatever character id the frontend later assigns the imported card.
#[tauri::command]
pub fn import_card_png(app: AppHandle, path: String) -> Result<ImportCardResult, String> {
    let bytes = fs::read(&path).map_err(|e| format!("nepodařilo se přečíst soubor: {e}"))?;
    let card_json = png_card::read_card_json(&bytes).map_err(|e| e.to_string())?;

    let dir = avatars_dir(&app)?;
    let filename = format!("{}.png", uuid::Uuid::new_v4());
    let dest = dir.join(&filename);
    fs::write(&dest, &bytes).map_err(|e| format!("nepodařilo se uložit avatar: {e}"))?;

    Ok(ImportCardResult {
        card_json,
        avatar_saved_to: dest.to_string_lossy().to_string(),
    })
}

/// Reads a plain (non-PNG) JSON card file and returns its raw text. Used by
/// `cardImport.ts` for JSON-only card imports (no avatar image involved).
#[tauri::command]
pub fn read_card_json_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("nepodařilo se přečíst soubor: {e}"))
}

/// Merges `card_json` into the PNG at `avatar_path` and writes the result
/// to `out_path`. Used for "export character to PNG".
#[tauri::command]
pub fn export_card_png(card_json: String, avatar_path: String, out_path: String) -> Result<(), String> {
    let bytes = fs::read(&avatar_path).map_err(|e| format!("nepodařilo se přečíst avatar: {e}"))?;
    let with_card = png_card::write_card_json(&bytes, &card_json).map_err(|e| e.to_string())?;
    fs::write(&out_path, with_card).map_err(|e| format!("nepodařilo se uložit soubor: {e}"))?;
    Ok(())
}

/// Ensures a placeholder avatar PNG exists under the app data directory and
/// returns its path. Used as the source image for exporting/creating
/// characters that were imported from plain JSON (no original PNG) or
/// created from scratch in the editor.
#[tauri::command]
pub fn ensure_placeholder_avatar(app: AppHandle) -> Result<String, String> {
    let dir = avatars_dir(&app)?;
    let dest = dir.join("_placeholder.png");
    if !dest.exists() {
        fs::write(&dest, png_card::placeholder_png())
            .map_err(|e| format!("nepodařilo se uložit výchozí avatar: {e}"))?;
    }
    Ok(dest.to_string_lossy().to_string())
}
