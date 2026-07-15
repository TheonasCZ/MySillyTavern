//! Provider adapters. M1 only needs a non-streaming `complete` call for the
//! "test connection" button in Settings; full SSE streaming lands in M2.

pub mod claude;
pub mod gemini;
pub mod openai;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

/// Mirrors the `connections` table row plus the fields needed to talk to a
/// provider. The API key itself is never part of this struct — it is
/// fetched from the keyring by connection id inside the command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionDto {
    pub id: String,
    pub provider: String, // "openai" | "gemini" | "claude"
    pub base_url: Option<String>,
    pub model: String,
    pub temperature: f32,
    pub top_p: f32,
    pub max_tokens: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("provider error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("unexpected response shape: {0}")]
    UnexpectedShape(String),
    #[error("not yet supported: {0}")]
    NotSupported(String),
}

/// Non-streaming completion, used by `chat_complete`.
pub async fn complete(
    connection: &ConnectionDto,
    api_key: &str,
    messages: &[ChatMessage],
) -> Result<String, ProviderError> {
    match connection.provider.as_str() {
        "gemini" => gemini::complete(connection, api_key, messages).await,
        "openai" => openai::complete(connection, api_key, messages).await,
        "claude" => claude::complete(connection, api_key, messages).await,
        other => Err(ProviderError::NotSupported(format!(
            "provider '{other}' zatím není podporován"
        ))),
    }
}
