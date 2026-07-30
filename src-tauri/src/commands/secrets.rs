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
use std::sync::{Mutex, OnceLock};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use base64::Engine;
use rand::RngCore;

const FILE_NAME: &str = "secrets.json";

/// Reserved key (not a real connection id) under which the sync passphrase
/// itself is stored — reuses the same file/permissions as API keys instead
/// of introducing a second secrets store.
const SYNC_PASSPHRASE_KEY: &str = "__sync_passphrase__";

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

/// Derives a 256-bit AES key from a user passphrase + salt via Argon2id.
/// The salt doesn't need to be secret, only unique per encryption — it
/// travels alongside the ciphertext in the blob itself.
fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| format!("odvození klíče selhalo: {e}"))?;
    Ok(key)
}

/// Encrypts `plaintext` with a key derived from `passphrase`. Output is
/// `base64(salt ‖ nonce ‖ ciphertext+tag)` — self-contained, no separate
/// metadata file needed since the salt/nonce aren't secret.
fn encrypt_with_passphrase(passphrase: &str, plaintext: &str) -> Result<String, String> {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    let key_bytes = derive_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("šifrování selhalo: {e}"))?;

    let mut blob = Vec::with_capacity(SALT_LEN + NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&salt);
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(blob))
}

/// Decrypts a blob produced by `encrypt_with_passphrase`. A wrong passphrase
/// or corrupted blob fails the AEAD tag check and returns `Err` — never
/// panics, so callers can treat it as "not decryptable yet" and move on.
fn decrypt_with_passphrase(passphrase: &str, blob_b64: &str) -> Result<String, String> {
    let blob = base64::engine::general_purpose::STANDARD
        .decode(blob_b64)
        .map_err(|e| format!("neplatný blob: {e}"))?;
    if blob.len() < SALT_LEN + NONCE_LEN {
        return Err("blob je příliš krátký".to_string());
    }
    let (salt, rest) = blob.split_at(SALT_LEN);
    let (nonce_bytes, ciphertext) = rest.split_at(NONCE_LEN);

    let key_bytes = derive_key(passphrase, salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "dešifrování selhalo (špatné heslo?)".to_string())?;
    String::from_utf8(plaintext).map_err(|e| format!("neplatné UTF-8: {e}"))
}

/// Cached secrets directory, set once by `init_store` so `get_api_key`
/// always uses the same path as the Tauri-managed store.
static SECRETS_DIR: OnceLock<PathBuf> = OnceLock::new();

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

    fn save(&self, app: Option<&AppHandle>, map: &HashMap<String, String>) -> Result<(), String> {
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
        // Set permissions to 0600 (owner read/write only) on Unix. A failure
        // here is security-relevant (the API-key file would stay readable
        // by other local users) but not worth hard-failing the save over —
        // log it so it's at least visible instead of silently swallowed.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) = file.set_permissions(fs::Permissions::from_mode(0o600)) {
                if let Some(app) = app {
                    crate::commands::logging::log_line(
                        app,
                        crate::commands::logging::LogLevel::Warn,
                        &format!("secrets: failed to set 0600 permissions on {}: {e}", path.display()),
                    );
                }
            }
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

    pub fn set(&self, app: &AppHandle, connection_id: &str, key: &str) -> Result<(), String> {
        let mut map = self.get_map()?;
        map.insert(connection_id.to_string(), key.to_string());
        self.save(Some(app), &map)?;
        // Update cache
        *self.cache.lock().unwrap() = Some(map);
        Ok(())
    }

    pub fn delete(&self, app: &AppHandle, connection_id: &str) -> Result<(), String> {
        let mut map = self.get_map()?;
        map.remove(connection_id);
        self.save(Some(app), &map)?;
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
    store_from_app(&app)?.set(&app, &connection_id, &key)
}

#[tauri::command]
pub fn delete_api_key(app: AppHandle, connection_id: String) -> Result<(), String> {
    store_from_app(&app)?.delete(&app, &connection_id)
}

#[tauri::command]
pub fn has_api_key(app: AppHandle, connection_id: String) -> Result<bool, String> {
    Ok(store_from_app(&app)?.get(&connection_id)?.is_some())
}

// ---- Encrypted key sync (M14 follow-up) ----
//
// The sync passphrase itself lives in the same `FileStore` as API keys
// (under a reserved key) — it never leaves this device and is never sent
// to JS. Encrypt/decrypt of individual connection keys always happens
// entirely on the Rust side; only the resulting ciphertext blob crosses
// into JS (to be written into the sync journal / applied from it).

#[tauri::command]
pub fn set_sync_passphrase(app: AppHandle, passphrase: String) -> Result<(), String> {
    store_from_app(&app)?.set(&app, SYNC_PASSPHRASE_KEY, &passphrase)
}

#[tauri::command]
pub fn has_sync_passphrase(app: AppHandle) -> Result<bool, String> {
    Ok(store_from_app(&app)?.get(SYNC_PASSPHRASE_KEY)?.is_some())
}

#[tauri::command]
pub fn clear_sync_passphrase(app: AppHandle) -> Result<(), String> {
    store_from_app(&app)?.delete(&app, SYNC_PASSPHRASE_KEY)
}

/// Encrypts the locally stored API key for `connection_id` with the sync
/// passphrase, for writing into the sync journal. `Ok(None)` when this
/// connection has no key stored locally (nothing to sync).
#[tauri::command]
pub fn encrypt_secret_for_sync(app: AppHandle, connection_id: String) -> Result<Option<String>, String> {
    let store = store_from_app(&app)?;
    let passphrase = store
        .get(SYNC_PASSPHRASE_KEY)?
        .ok_or("sync heslo není nastavené")?;
    match store.get(&connection_id)? {
        Some(key) => Ok(Some(encrypt_with_passphrase(&passphrase, &key)?)),
        None => Ok(None),
    }
}

/// Decrypts a blob received via sync and stores it as the API key for
/// `connection_id` — the plaintext never crosses back into JS.
#[tauri::command]
pub fn apply_synced_secret(app: AppHandle, connection_id: String, blob: String) -> Result<(), String> {
    let store = store_from_app(&app)?;
    let passphrase = store
        .get(SYNC_PASSPHRASE_KEY)?
        .ok_or("sync heslo není nastavené")?;
    let plaintext = decrypt_with_passphrase(&passphrase, &blob)?;
    store.set(&app, &connection_id, &plaintext)
}

/// Internal helper for other commands (e.g. chat_complete) that need the
/// actual key value. Never exposed as a Tauri command itself.
pub fn get_api_key(connection_id: &str) -> Result<Option<String>, String> {
    // Prefer the cached path set by `init_store` (always correct for the
    // Tauri runtime), falling back to the legacy `dirs_next()` heuristic
    // only when the store hasn't been initialised yet (shouldn't happen).
    let dir = SECRETS_DIR
        .get()
        .cloned()
        .or_else(|| dirs_next())
        .ok_or("nepodařilo se najít domovský adresář")?;
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
    // Cache the directory so `get_api_key` (which doesn't have an
    // AppHandle) uses the same path as the Tauri-managed store.
    let _ = SECRETS_DIR.set(dir.clone());
    let store = FileStore::new(dir);
    app.manage(store);
    Ok(())
}
