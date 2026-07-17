use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::sse::{parse_data_line, ParsedEvent, SseLineSplitter};
use super::{ChatMessage, ConnectionDto, ProviderError, Role, StreamEvent};

fn build_body(connection: &ConnectionDto, messages: &[ChatMessage]) -> Value {
    let system_instruction = messages
        .iter()
        .find(|m| matches!(m.role, Role::System))
        .map(|m| json!({ "parts": [{ "text": m.content }] }));

    let contents: Vec<Value> = messages
        .iter()
        .filter(|m| !matches!(m.role, Role::System))
        .map(|m| {
            let role = match m.role {
                Role::Assistant => "model",
                _ => "user",
            };
            json!({ "role": role, "parts": [{ "text": m.content }] })
        })
        .collect();

    let mut body = json!({
        "contents": contents,
        "generationConfig": {
            "temperature": connection.temperature,
            "topP": connection.top_p,
            "maxOutputTokens": connection.max_tokens,
        }
    });
    if let Some(tk) = connection.top_k {
        body["generationConfig"]["topK"] = json!(tk);
    }
    // Gemini 2.5+/3.x models default to dynamic "thinking", which adds long
    // pauses before each reply — useless for roleplay streaming. Budget 0
    // disables it; older models (2.0 and below) reject the field.
    let m = connection.model.as_str();
    if m.contains("-2.5") || m.contains("-3") {
        body["generationConfig"]["thinkingConfig"] = json!({ "thinkingBudget": 0 });
    }
    if let Some(sys) = system_instruction {
        body["systemInstruction"] = sys;
    }
    body
}

/// Parses one Gemini `data: {...}` SSE payload.
pub fn parse_data(data: &str) -> ParsedEvent {
    let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return ParsedEvent::None,
    };

    if let Some(parts) = v["candidates"][0]["content"]["parts"].as_array() {
        let text: String = parts.iter().filter_map(|p| p["text"].as_str()).collect();
        if !text.is_empty() {
            return ParsedEvent::Token(text);
        }
    }
    if let Some(reason) = v["candidates"][0]["finishReason"].as_str() {
        return ParsedEvent::Done(reason.to_string());
    }
    ParsedEvent::None
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
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse",
        connection.model
    );

    let res = client
        .post(&url)
        .header("x-goog-api-key", api_key)
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
        let data = r#"{"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"}}]}"#;
        assert_eq!(parse_data(data), ParsedEvent::Token("Hello".to_string()));
    }

    #[test]
    fn parses_finish_reason() {
        let data = r#"{"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"STOP"}]}"#;
        assert_eq!(parse_data(data), ParsedEvent::Done("STOP".to_string()));
    }

    #[test]
    fn ignores_garbage() {
        assert_eq!(parse_data("not json"), ParsedEvent::None);
    }

    /// Simulates a real Gemini SSE fixture arriving as two chunks, with the
    /// split landing in the middle of a `data:` payload.
    #[test]
    fn full_stream_survives_chunk_split_mid_event() {
        let full = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hel\"}]}}]}\n\n\
data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"lo!\"}]}}]}\n\n\
data: {\"candidates\":[{\"content\":{\"parts\":[]},\"finishReason\":\"STOP\"}]}\n\n";
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
                ParsedEvent::Done("STOP".to_string()),
            ]
        );
    }
}
