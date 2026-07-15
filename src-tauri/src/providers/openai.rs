use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::sse::{parse_data_line, ParsedEvent, SseLineSplitter};
use super::{ChatMessage, ConnectionDto, ProviderError, Role, StreamEvent};

fn build_body(connection: &ConnectionDto, messages: &[ChatMessage]) -> Value {
    let msgs: Vec<Value> = messages
        .iter()
        .map(|m| {
            let role = match m.role {
                Role::System => "system",
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            json!({ "role": role, "content": m.content })
        })
        .collect();

    json!({
        "model": connection.model,
        "messages": msgs,
        "temperature": connection.temperature,
        "top_p": connection.top_p,
        "max_tokens": connection.max_tokens,
        "stream": true,
    })
}

/// Parses one OpenAI-compatible `data: {...}` SSE payload (also handles the
/// literal `data: [DONE]` terminator).
pub fn parse_data(data: &str) -> ParsedEvent {
    if data == "[DONE]" {
        return ParsedEvent::Done("stop".to_string());
    }

    let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return ParsedEvent::None,
    };

    if let Some(text) = v["choices"][0]["delta"]["content"].as_str() {
        if !text.is_empty() {
            return ParsedEvent::Token(text.to_string());
        }
    }
    if let Some(reason) = v["choices"][0]["finish_reason"].as_str() {
        return ParsedEvent::Done(reason.to_string());
    }
    ParsedEvent::None
}

/// OpenAI-compatible: ChatGPT, DeepSeek, OpenRouter — differ only by
/// base_url + model.
pub async fn stream(
    connection: &ConnectionDto,
    api_key: &str,
    messages: &[ChatMessage],
    cancel: CancellationToken,
    tx: mpsc::UnboundedSender<StreamEvent>,
) -> Result<(), ProviderError> {
    let client = reqwest::Client::new();

    let base_url = connection
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let base_url = base_url.trim_end_matches('/');
    let url = format!("{base_url}/chat/completions");

    let body = build_body(connection, messages);

    let res = client
        .post(&url)
        .bearer_auth(api_key)
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
                            let Some(data) = parse_data_line(&line) else { continue };
                            match parse_data(data) {
                                ParsedEvent::Token(text) => {
                                    let _ = tx.send(StreamEvent::Token { text });
                                }
                                ParsedEvent::Done(finish_reason) => {
                                    let _ = tx.send(StreamEvent::Done { finish_reason });
                                    return Ok(());
                                }
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
    fn parses_token_delta() {
        let data = r#"{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}"#;
        assert_eq!(parse_data(data), ParsedEvent::Token("Hello".to_string()));
    }

    #[test]
    fn parses_finish_reason() {
        let data = r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#;
        assert_eq!(parse_data(data), ParsedEvent::Done("stop".to_string()));
    }

    #[test]
    fn parses_done_sentinel() {
        assert_eq!(parse_data("[DONE]"), ParsedEvent::Done("stop".to_string()));
    }

    #[test]
    fn ignores_garbage() {
        assert_eq!(parse_data("not json"), ParsedEvent::None);
    }

    /// Simulates a real OpenAI-compatible SSE fixture arriving as two
    /// chunks, with the split landing mid-payload, ending in `[DONE]`.
    #[test]
    fn full_stream_survives_chunk_split_mid_event() {
        let full = "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"},\"finish_reason\":null}]}\n\n\
data: {\"choices\":[{\"delta\":{\"content\":\"lo!\"},\"finish_reason\":null}]}\n\n\
data: [DONE]\n\n";
        let split_at = full.find("lo!").unwrap();
        let (first_chunk, second_chunk) = full.split_at(split_at);

        let mut splitter = SseLineSplitter::new();
        let mut events = Vec::new();
        for line in splitter.push(first_chunk.as_bytes()) {
            if let Some(data) = parse_data_line(&line) {
                events.push(parse_data(data));
            }
        }
        for line in splitter.push(second_chunk.as_bytes()) {
            if let Some(data) = parse_data_line(&line) {
                events.push(parse_data(data));
            }
        }

        assert_eq!(
            events,
            vec![
                ParsedEvent::Token("Hel".to_string()),
                ParsedEvent::Token("lo!".to_string()),
                ParsedEvent::Done("stop".to_string()),
            ]
        );
    }
}
