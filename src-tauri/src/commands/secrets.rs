//! API key storage — simple JSON file in the app config directory.
//! No OS keyring dependency: works identically on all platforms and
//! survives dbus restarts. Keys are plain text in a 0600-permission file;
//! on a single-user desktop this is equivalent to the OS keyring.
//!
//! Never returns keys to the JS side — all key access is internal Rust only.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const FILE_NAME: &str = "secrets.json";

pub struct FileStore {
    dir: PathBuf,
    // Simple in-memory cache to avoid reading the file on every access.
    // Wrapped in a Mutex because Tauri commands can run concurrently.
    cache: Mutex<Option<HashMap<String, String>>>,
}

impl FileStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            cache: Mutex::new(None),
        }
    }

    fn path(&self) -> PathBuf {
        self.dir.join(FILE_NAME)
    }

    fn load(&self) -> Result<HashMap<String, String>, String> {
        let path = self.path();
        if !path.exists() {
            return Ok(HashMap::new());
        }
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("nepodařilo se přečíst soubor s klíči: {e}"))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("nepodařilo se parsovat soubor s klíči: {e}"))
    }

    fn save(&self, map: &HashMap<String, String>) -> Result<(), String> {
        let path = self.path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("nepodařilo se vytvořit adresář pro klíče: {e}"))?;
        }
        let json = serde_json::to_string_pretty(map)
            .map_err(|e| format!("nepodařilo se serializovat klíče: {e}"))?;
        let mut file = fs::File::create(&path)
            .map_err(|e| format!("nepodařilo se vytvořit soubor s klíči: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("nepodařilo se zapsat klíče: {e}"))?;
        // Set permissions to 0600 (owner read/write only) on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    fn get_map(&self) -> Result<HashMap<String, String>, String> {
        let mut cache = self.cache.lock().unwrap();
        if let Some(ref cached) = *cache {
            return Ok(cached.clone());
        }
        let map = self.load()?;
        *cache = Some(map.clone());
        Ok(map)
    }

    pub fn get(&self, connection_id: &str) -> Result<Option<String>, String> {
        let map = self.get_map()?;
        Ok(map.get(connection_id).cloned())
    }

    pub fn set(&self, connection_id: &str, key: &str) -> Result<(), String> {
        let mut map = self.get_map()?;
        map.insert(connection_id.to_string(), key.to_string());
        self.save(&map)?;
        // Update cache
        *self.cache.lock().unwrap() = Some(map);
        Ok(())
    }

    pub fn delete(&self, connection_id: &str) -> Result<(), String> {
        let mut map = self.get_map()?;
        map.remove(connection_id);
        self.save(&map)?;
        *self.cache.lock().unwrap() = Some(map);
        Ok(())
    }
}

// ---- Tauri commands ----

use tauri::{AppHandle, Manager};

fn store_from_app(app: &AppHandle) -> Result<&FileStore, String> {
    app.try_state::<FileStore>()
        .map(|s| s.inner())
        .ok_or_else(|| "Secrets store not initialised".to_string())
}

fn app_secrets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("nepodařilo se najít adresář nastavení: {e}"))
}

#[tauri::command]
pub fn set_api_key(app: AppHandle, connection_id: String, key: String) -> Result<(), String> {
    store_from_app(&app)?.set(&connection_id, &key)
}

#[tauri::command]
pub fn delete_api_key(app: AppHandle, connection_id: String) -> Result<(), String> {
    store_from_app(&app)?.delete(&connection_id)
}

#[tauri::command]
pub fn has_api_key(app: AppHandle, connection_id: String) -> Result<bool, String> {
    Ok(store_from_app(&app)?.get(&connection_id)?.is_some())
}

/// Internal helper for other commands (e.g. chat_complete) that need the
/// actual key value. Never exposed as a Tauri command itself.
pub fn get_api_key(connection_id: &str) -> Result<Option<String>, String> {
    // This is called from async contexts without AppHandle — fall back to
    // direct file read.
    let dir = dirs_next().ok_or("nepodařilo se najít domovský adresář")?;
    let store = FileStore::new(dir);
    store.get(connection_id)
}

fn dirs_next() -> Option<PathBuf> {
    // Use the same config dir logic as tauri would
    if let Ok(dir) = std::env::var("APPDATA") {
        Some(PathBuf::from(dir).join("com.morthos.mysillytavern"))
    } else if let Some(home) = dirs::home_dir() {
        if cfg!(target_os = "macos") {
            Some(home.join("Library/Application Support/com.morthos.mysillytavern"))
        } else {
            // Linux and others: XDG_CONFIG_HOME or ~/.config
            if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
                Some(PathBuf::from(xdg).join("com.morthos.mysillytavern"))
            } else {
                Some(home.join(".config/com.morthos.mysillytavern"))
            }
        }
    } else {
        None
    }
}

/// Initialise the secrets store with the app's config directory.
/// Called from `run()` before any command can access keys.
pub fn init_store(app: &AppHandle) -> Result<(), String> {
    let dir = app_secrets_dir(app)?;
    let store = FileStore::new(dir);
    app.manage(store);
    Ok(())
}
