//! Provider adapters. `chat_stream` streams token-by-token via SSE;
//! `chat_complete` (used by "test connection" and later the memory engine)
//! shares the exact same streaming code path and simply collects it.

pub mod claude;
pub mod gemini;
pub mod openai;
pub mod sse;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

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
    #[error("not yet supported: {0}")]
    NotSupported(String),
}

/// Streaming events emitted over the Tauri Channel to the frontend, and
/// internally over an mpsc channel from each provider adapter. Tagged
/// exactly as `{ event: "Token", data: { text } }` to match the TS
/// `StreamEvent` union in `src/providers/types.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum StreamEvent {
    Start,
    Token { text: String },
    Done { finish_reason: String },
    Error { message: String, retryable: bool },
}

/// Dispatches to the right provider's streaming implementation. Each
/// implementation sends `StreamEvent`s over `tx` as they arrive and is
/// responsible for eventually sending exactly one terminal `Done` or
/// `Error` event (unless cancelled, in which case it may simply stop).
pub async fn stream_chat(
    connection: &ConnectionDto,
    api_key: &str,
    messages: &[ChatMessage],
    cancel: CancellationToken,
    tx: mpsc::UnboundedSender<StreamEvent>,
) {
    let result = match connection.provider.as_str() {
        "gemini" => gemini::stream(connection, api_key, messages, cancel, tx.clone()).await,
        "openai" => openai::stream(connection, api_key, messages, cancel, tx.clone()).await,
        "claude" => claude::stream(connection, api_key, messages, cancel, tx.clone()).await,
        other => Err(ProviderError::NotSupported(format!(
            "provider '{other}' zatím není podporován"
        ))),
    };
    if let Err(err) = result {
        let _ = tx.send(StreamEvent::Error {
            message: err.to_string(),
            retryable: false,
        });
    }
}

/// Non-streaming completion, used by `chat_complete`. Internally drives the
/// same `stream_chat` path and concatenates the tokens.
pub async fn complete(
    connection: &ConnectionDto,
    api_key: &str,
    messages: &[ChatMessage],
) -> Result<String, ProviderError> {
    let (tx, mut rx) = mpsc::unbounded_channel::<StreamEvent>();
    let cancel = CancellationToken::new();

    let conn = connection.clone();
    let key = api_key.to_string();
    let msgs = messages.to_vec();
    tokio::spawn(async move {
        stream_chat(&conn, &key, &msgs, cancel, tx).await;
    });

    let mut text = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            StreamEvent::Token { text: t } => text.push_str(&t),
            StreamEvent::Done { .. } => break,
            StreamEvent::Error { message, .. } => {
                return Err(ProviderError::Api {
                    status: 0,
                    message,
                })
            }
            StreamEvent::Start => {}
        }
    }
    Ok(text)
}
