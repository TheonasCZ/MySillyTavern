//! Provider adapters. `chat_stream` streams token-by-token via SSE;
//! `chat_complete` (used by "test connection" and later the memory engine)
//! shares the exact same streaming code path and simply collects it.

pub mod claude;
pub mod embeddings;
pub mod gemini;
pub mod image_gen;
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
    #[serde(default)] pub top_k: Option<f32>,
    #[serde(default)] pub min_p: Option<f32>,
    #[serde(default)] pub frequency_penalty: Option<f32>,
    #[serde(default)] pub presence_penalty: Option<f32>,
    pub max_tokens: i32,
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

/// Lists the models available for the given provider/key. Returns bare
/// model ids (e.g. "gemini-2.0-flash") suitable for the `model` field.
pub async fn list_models(
    provider: &str,
    base_url: Option<&str>,
    api_key: &str,
) -> Result<Vec<String>, ProviderError> {
    let client = reqwest::Client::new();

    // If the base URL looks like a localhost address, try the Ollama API
    // first — it's a best-effort fallback so a failure silently drops
    // through to the provider-specific match below.
    if let Some(base) = base_url {
        if base.contains("localhost") || base.contains("127.0.0.1") {
            let url = format!("{}/api/tags", base.trim_end_matches('/'));
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if let Some(models_arr) = body["models"].as_array() {
                            let mut ollama_models: Vec<String> = models_arr
                                .iter()
                                .filter_map(|m| m["name"].as_str().map(str::to_string))
                                .collect();
                            ollama_models.sort();
                            ollama_models.dedup();
                            return Ok(ollama_models);
                        }
                    }
                }
            }
        }
    }

    let mut models: Vec<String> = match provider {
        "gemini" => {
            let body: serde_json::Value = check_status(
                client
                    .get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000")
                    .header("x-goog-api-key", api_key)
                    .send()
                    .await?,
            )
            .await?;
            body["models"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter(|m| {
                            m["supportedGenerationMethods"]
                                .as_array()
                                .is_some_and(|ms| ms.iter().any(|x| x == "generateContent"))
                        })
                        .filter_map(|m| m["name"].as_str())
                        .map(|name| name.trim_start_matches("models/").to_string())
                        .collect()
                })
                .unwrap_or_default()
        }
        "openai" => {
            let base_url = base_url.unwrap_or("https://api.openai.com/v1");
            let url = format!("{}/models", base_url.trim_end_matches('/'));
            let body: serde_json::Value =
                check_status(client.get(url).bearer_auth(api_key).send().await?).await?;
            body["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["id"].as_str())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default()
        }
        "claude" => {
            let body: serde_json::Value = check_status(
                client
                    .get("https://api.anthropic.com/v1/models?limit=1000")
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .send()
                    .await?,
            )
            .await?;
            body["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["id"].as_str())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default()
        }
        other => {
            return Err(ProviderError::NotSupported(format!(
                "provider '{other}' zatím není podporován"
            )))
        }
    };
    models.sort();
    models.dedup();
    Ok(models)
}

pub(crate) async fn check_status(
    response: reqwest::Response,
) -> Result<serde_json::Value, ProviderError> {
    let status = response.status();
    if !status.is_success() {
        return Err(ProviderError::Api {
            status: status.as_u16(),
            message: response.text().await.unwrap_or_default(),
        });
    }
    Ok(response.json().await?)
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
