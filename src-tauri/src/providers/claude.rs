use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::sse::{parse_data_line, parse_event_line, ParsedEvent, SseLineSplitter};
use super::{ChatMessage, ConnectionDto, ProviderError, Role, StreamEvent};

fn build_body(connection: &ConnectionDto, messages: &[ChatMessage]) -> Value {
    let system: String = messages
        .iter()
        .filter(|m| matches!(m.role, Role::System))
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n\n");

    let msgs: Vec<Value> = messages
        .iter()
        .filter(|m| !matches!(m.role, Role::System))
        .map(|m| {
            let role = match m.role {
                Role::Assistant => "assistant",
                _ => "user",
            };
            json!({ "role": role, "content": m.content })
        })
        .collect();

    let mut body = json!({
        "model": connection.model,
        "messages": msgs,
        "max_tokens": connection.max_tokens,
        "temperature": connection.temperature,
        "top_p": connection.top_p,
        "stream": true,
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    body
}

/// Parses one Claude SSE event, given its `event:` type and `data:`
/// payload. Claude interleaves several event types
/// (`message_start`, `content_block_start`, `content_block_delta`,
/// `content_block_stop`, `message_delta`, `message_stop`, `ping`) — only
/// `content_block_delta` (token text) and `message_stop`/`message_delta`
/// (completion) matter here.
pub fn parse_event(event_type: &str, data: &str) -> ParsedEvent {
    match event_type {
        "content_block_delta" => {
            let v: Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => return ParsedEvent::None,
            };
            match v["delta"]["text"].as_str() {
                Some(text) if !text.is_empty() => ParsedEvent::Token(text.to_string()),
                _ => ParsedEvent::None,
            }
        }
        "message_delta" => {
            let v: Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => return ParsedEvent::None,
            };
            match v["delta"]["stop_reason"].as_str() {
                Some(reason) => ParsedEvent::Done(reason.to_string()),
                None => ParsedEvent::None,
            }
        }
        "message_stop" => ParsedEvent::Done("stop".to_string()),
        "error" => {
            let v: Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => return ParsedEvent::None,
            };
            let message = v["error"]["message"].as_str().unwrap_or("Claude stream error");
            ParsedEvent::Done(format!("error: {message}"))
        }
        _ => ParsedEvent::None,
    }
}

pub async fn stream(
    connection: &ConnectionDto,
    api_key: &str,
    messages: &[ChatMessage],
    cancel: CancellationToken,
    tx: mpsc::UnboundedSender<StreamEvent>,
) -> Result<(), ProviderError> {
    let client = reqwest::Client::new();
    let body = build_body(connection, messages);

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;

    let status = res.status();
    if !status.is_success() {
        let message = res.text().await.unwrap_or_default();
        let retryable = status.as_u16() == 429 || status.as_u16() >= 500;
        let _ = tx.send(StreamEvent::Error { message, retryable });
        return Ok(());
    }

    let mut stream = res.bytes_stream();
    let mut splitter = SseLineSplitter::new();
    let mut current_event = String::new();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            chunk = stream.next() => {
                match chunk {
                    None => break,
                    Some(Err(e)) => {
                        let _ = tx.send(StreamEvent::Error { message: e.to_string(), retryable: true });
                        return Ok(());
                    }
                    Some(Ok(bytes)) => {
                        for line in splitter.push(&bytes) {
                            if let Some(ev) = parse_event_line(&line) {
                                current_event = ev.to_string();
                                continue;
                            }
                            let Some(data) = parse_data_line(&line) else { continue };
                            match parse_event(&current_event, data) {
                                ParsedEvent::Token(text) => {
                                    let _ = tx.send(StreamEvent::Token { text });
                                }
                                ParsedEvent::Done(finish_reason) => {
                                    let _ = tx.send(StreamEvent::Done { finish_reason });
                                    return Ok(());
                                }
                                // Function calling is not wired up for this
                                // provider (Gemini-only prototype scope).
                                ParsedEvent::FunctionCall(..) => {}
                                ParsedEvent::None => {}
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = tx.send(StreamEvent::Done { finish_reason: "stop".to_string() });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_content_block_delta() {
        let data = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#;
        assert_eq!(
            parse_event("content_block_delta", data),
            ParsedEvent::Token("Hi".to_string())
        );
    }

    #[test]
    fn parses_message_stop() {
        assert_eq!(parse_event("message_stop", "{}"), ParsedEvent::Done("stop".to_string()));
    }

    #[test]
    fn parses_message_delta_stop_reason() {
        let data = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#;
        assert_eq!(
            parse_event("message_delta", data),
            ParsedEvent::Done("end_turn".to_string())
        );
    }

    #[test]
    fn ignores_ping_and_other_events() {
        assert_eq!(parse_event("ping", "{}"), ParsedEvent::None);
        assert_eq!(parse_event("content_block_start", "{}"), ParsedEvent::None);
    }

    /// Simulates a real Claude SSE fixture (event: + data: line pairs)
    /// arriving as two chunks, with the split landing mid-payload.
    #[test]
    fn full_stream_survives_chunk_split_mid_event() {
        let full = "event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hel\"}}\n\n\
event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"lo!\"}}\n\n\
event: message_delta\n\
data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n\
event: message_stop\n\
data: {\"type\":\"message_stop\"}\n\n";
        let split_at = full.find("lo!").unwrap();
        let (first_chunk, second_chunk) = full.split_at(split_at);

        let mut splitter = SseLineSplitter::new();
        let mut current_event = String::new();
        let mut events = Vec::new();
        for chunk in [first_chunk, second_chunk] {
            for line in splitter.push(chunk.as_bytes()) {
                if let Some(ev) = parse_event_line(&line) {
                    current_event = ev.to_string();
                    continue;
                }
                if let Some(data) = parse_data_line(&line) {
                    events.push(parse_event(&current_event, data));
                }
            }
        }

        assert_eq!(
            events,
            vec![
                ParsedEvent::Token("Hel".to_string()),
                ParsedEvent::Token("lo!".to_string()),
                ParsedEvent::Done("end_turn".to_string()),
                ParsedEvent::Done("stop".to_string()),
            ]
        );
    }
}
