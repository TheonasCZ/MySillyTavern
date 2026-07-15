use crate::commands::secrets::get_api_key;
use crate::providers::{self, ChatMessage, ConnectionDto};

/// Non-streamed completion. In M1 this is used solely for the "test
/// connection" button in Settings. M2 adds `chat_stream`/`chat_abort`.
#[tauri::command]
pub async fn chat_complete(
    connection: ConnectionDto,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let api_key = get_api_key(&connection.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pro toto připojení není uložen žádný API klíč.".to_string())?;

    providers::complete(&connection, &api_key, &messages)
        .await
        .map_err(|e| e.to_string())
}
