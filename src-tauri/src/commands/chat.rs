use std::collections::HashMap;
use std::sync::Mutex;

use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::commands::secrets::get_api_key;
use crate::providers::{self, ChatMessage, ConnectionDto, StreamEvent};

/// Tracks in-flight streams by `request_id` so `chat_abort` can cancel
/// them. Managed as Tauri app state.
#[derive(Default)]
pub struct StreamRegistry(Mutex<HashMap<String, CancellationToken>>);

impl StreamRegistry {
    fn insert(&self, request_id: String, token: CancellationToken) {
        self.0.lock().unwrap().insert(request_id, token);
    }

    fn remove(&self, request_id: &str) -> Option<CancellationToken> {
        self.0.lock().unwrap().remove(request_id)
    }
}

/// Non-streamed completion. Used for the "test connection" button in
/// Settings and (later) the memory engine's extractor/summarizer. Shares
/// the same provider code path as `chat_stream`.
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

/// Streams a chat completion token-by-token over `on_event`. Emits exactly
/// one `Start`, then zero or more `Token`s, then exactly one `Done` or
/// `Error` (unless aborted via `chat_abort`, in which case the stream just
/// stops silently).
#[tauri::command]
pub async fn chat_stream(
    request_id: String,
    connection: ConnectionDto,
    messages: Vec<ChatMessage>,
    on_event: Channel<StreamEvent>,
    registry: State<'_, StreamRegistry>,
) -> Result<(), String> {
    let api_key = match get_api_key(&connection.id) {
        Ok(Some(key)) => key,
        Ok(None) => {
            let _ = on_event.send(StreamEvent::Error {
                message: "Pro toto připojení není uložen žádný API klíč.".to_string(),
                retryable: false,
            });
            return Ok(());
        }
        Err(err) => {
            let _ = on_event.send(StreamEvent::Error {
                message: err.to_string(),
                retryable: false,
            });
            return Ok(());
        }
    };

    let cancel = CancellationToken::new();
    registry.insert(request_id.clone(), cancel.clone());

    let _ = on_event.send(StreamEvent::Start);

    let (tx, mut rx) = mpsc::unbounded_channel::<StreamEvent>();
    let task = tokio::spawn(async move {
        providers::stream_chat(&connection, &api_key, &messages, cancel, tx).await;
    });

    let mut saw_terminal = false;
    while let Some(event) = rx.recv().await {
        let is_terminal = matches!(event, StreamEvent::Done { .. } | StreamEvent::Error { .. });
        let _ = on_event.send(event);
        if is_terminal {
            saw_terminal = true;
            break;
        }
    }

    let _ = task.await;
    // If `chat_abort` already removed the registry entry, this stream was
    // cancelled deliberately — the frontend already knows and doesn't need
    // a synthetic error. Otherwise, if we never saw a terminal event, the
    // stream ended abnormally (bug in a provider adapter) and the frontend
    // would otherwise spin forever waiting for one.
    let was_aborted = registry.remove(&request_id).is_none();
    if !saw_terminal && !was_aborted {
        let _ = on_event.send(StreamEvent::Error {
            message: "Stream skončil bez odpovědi.".to_string(),
            retryable: true,
        });
    }

    Ok(())
}

/// Cancels a running `chat_stream` by request id. No-op if it already
/// finished or never existed.
#[tauri::command]
pub fn chat_abort(request_id: String, registry: State<'_, StreamRegistry>) -> Result<(), String> {
    if let Some(token) = registry.remove(&request_id) {
        token.cancel();
    }
    Ok(())
}
