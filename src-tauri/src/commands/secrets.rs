//! API key storage abstracted behind the `SecretStore` trait so a future
//! mobile backend can swap in a different implementation without touching
//! the commands below. The key is never returned to the JS side.

use keyring::Entry;

const SERVICE_NAME: &str = "MySillyTavern";

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),
}

pub trait SecretStore: Send + Sync {
    fn get(&self, connection_id: &str) -> Result<Option<String>, SecretError>;
    fn set(&self, connection_id: &str, key: &str) -> Result<(), SecretError>;
    fn delete(&self, connection_id: &str) -> Result<(), SecretError>;
}

pub struct KeyringStore;

impl KeyringStore {
    fn entry(connection_id: &str) -> Result<Entry, SecretError> {
        Ok(Entry::new(SERVICE_NAME, connection_id)?)
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, connection_id: &str) -> Result<Option<String>, SecretError> {
        let entry = Self::entry(connection_id)?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    fn set(&self, connection_id: &str, key: &str) -> Result<(), SecretError> {
        let entry = Self::entry(connection_id)?;
        entry.set_password(key)?;
        Ok(())
    }

    fn delete(&self, connection_id: &str) -> Result<(), SecretError> {
        let entry = Self::entry(connection_id)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.into()),
        }
    }
}

#[tauri::command]
pub fn set_api_key(connection_id: String, key: String) -> Result<(), String> {
    KeyringStore.set(&connection_id, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_api_key(connection_id: String) -> Result<(), String> {
    KeyringStore.delete(&connection_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_api_key(connection_id: String) -> Result<bool, String> {
    KeyringStore
        .get(&connection_id)
        .map(|v| v.is_some())
        .map_err(|e| e.to_string())
}

/// Internal helper for other commands (e.g. chat_complete) that need the
/// actual key value. Never exposed as a Tauri command itself.
pub fn get_api_key(connection_id: &str) -> Result<Option<String>, SecretError> {
    KeyringStore.get(connection_id)
}
