//! Copies avatar/generated-illustration image files alongside the sync
//! journal, so a second device doesn't end up with a broken avatar or have
//! to re-run (paid) image generation for something the first device already
//! made. Images always live locally under `<app_data_dir>/avatars/` (see
//! `commands/cards.rs`, `commands/image_gen.rs`) — this module only mirrors
//! them into/out of `<sync_root>/assets/<filename>` by filename. The DB
//! itself always stores each device's own local absolute path; the *journal*
//! carries just the filename (see `syncJournal.ts`/`syncReader.ts`), which
//! is why `filename` here is always a bare name, never a path.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn avatars_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    let dir = base.join("avatars");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create avatars dir: {e}"))?;
    Ok(dir)
}

/// Copies `<app_data_dir>/avatars/<filename>` into `<root>/assets/<filename>`.
/// A no-op if the local file doesn't exist (the entity being journaled may
/// reference an image that was since deleted locally) or if sync is off.
#[tauri::command]
pub fn sync_asset_push(app: AppHandle, root: String, filename: String) -> Result<(), String> {
    if root.trim().is_empty() || filename.trim().is_empty() {
        return Ok(());
    }
    let local = avatars_dir(&app)?.join(&filename);
    let bytes = match std::fs::read(&local) {
        Ok(b) => b,
        Err(_) => return Ok(()), // nothing to push
    };
    #[cfg(not(target_os = "android"))]
    {
        desktop::push(&root, &filename, &bytes)
    }
    #[cfg(target_os = "android")]
    {
        android::push(&app, &root, &filename, &bytes)
    }
}

/// Ensures `<app_data_dir>/avatars/<filename>` exists locally, pulling it
/// from `<root>/assets/<filename>` if not. Returns the local absolute path
/// on success, or `null` if the sync folder doesn't have it (yet) — the
/// journal entry may simply have arrived before the source device finished
/// pushing the image; a later sync run will pick it up.
#[tauri::command]
pub fn sync_asset_pull(
    app: AppHandle,
    root: String,
    filename: String,
) -> Result<Option<String>, String> {
    if root.trim().is_empty() || filename.trim().is_empty() {
        return Ok(None);
    }
    let local = avatars_dir(&app)?.join(&filename);
    if local.exists() {
        return Ok(Some(local.to_string_lossy().into_owned()));
    }
    #[cfg(not(target_os = "android"))]
    let bytes = desktop::pull(&root, &filename)?;
    #[cfg(target_os = "android")]
    let bytes = android::pull(&app, &root, &filename)?;

    match bytes {
        Some(b) => {
            std::fs::write(&local, &b).map_err(|e| format!("cannot write local asset: {e}"))?;
            Ok(Some(local.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[cfg(not(target_os = "android"))]
mod desktop {
    use std::fs;
    use std::path::Path;

    pub fn push(root: &str, filename: &str, bytes: &[u8]) -> Result<(), String> {
        let dir = Path::new(root).join("assets");
        fs::create_dir_all(&dir).map_err(|e| format!("cannot create sync assets folder: {e}"))?;
        fs::write(dir.join(filename), bytes).map_err(|e| format!("cannot write sync asset: {e}"))
    }

    pub fn pull(root: &str, filename: &str) -> Result<Option<Vec<u8>>, String> {
        let p = Path::new(root).join("assets").join(filename);
        match fs::read(&p) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("cannot read sync asset: {e}")),
        }
    }
}

#[cfg(target_os = "android")]
mod android {
    use tauri::AppHandle;
    use tauri_plugin_android_fs::{AndroidFsExt, FileAccessMode, FsUri};

    fn root_uri(root: &str) -> Result<FsUri, String> {
        FsUri::from_json_str(root).map_err(|e| format!("invalid sync folder URI: {e}"))
    }

    pub fn push(app: &AppHandle, root: &str, filename: &str, bytes: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let root = root_uri(root)?;
        let fs = app.android_fs();
        let relative = format!("assets/{filename}");
        let uri = match fs.resolve_file_uri(&root, &relative) {
            Ok(uri) => uri,
            Err(_) => fs
                .create_new_file(&root, &relative, None)
                .map_err(|e| format!("cannot create sync asset: {e}"))?,
        };
        let mut f = fs
            .open_file(&uri, FileAccessMode::WriteTruncate)
            .map_err(|e| format!("cannot open sync asset for writing: {e}"))?;
        f.write_all(bytes).map_err(|e| format!("cannot write sync asset: {e}"))
    }

    pub fn pull(app: &AppHandle, root: &str, filename: &str) -> Result<Option<Vec<u8>>, String> {
        let root = root_uri(root)?;
        let fs = app.android_fs();
        let relative = format!("assets/{filename}");
        match fs.resolve_file_uri(&root, &relative) {
            Ok(uri) => fs
                .read(&uri)
                .map(Some)
                .map_err(|e| format!("cannot read sync asset: {e}")),
            Err(_) => Ok(None),
        }
    }
}
