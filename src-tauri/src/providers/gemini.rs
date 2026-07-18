use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::sse::{parse_data_line, ParsedEvent, SseLineSplitter};
use super::{ChatMessage, ConnectionDto, ProviderError, Role, StreamEvent};

/// EXPERIMENTAL (function-calling prototype): the one tool scoped for this
/// proof of concept. Looks up full detail (note, duration, level, ...) for
/// an inventory/skill/condition/modification entry that the compact
/// `[GAME TAGS]` state list only shows by name (see
/// `promptBuilder.ts::formatCappedList`) — the model calls this when the
/// player references something whose specifics it actually needs instead of
/// the app always paying to include every entry's full detail up front.
const GET_ITEM_DETAIL_TOOL_NAME: &str = "get_item_detail";

fn tool_declarations() -> Value {
    json!([{
        "functionDeclarations": [{
            "name": GET_ITEM_DETAIL_TOOL_NAME,
            "description": "Vrátí plný detail (poznámku, trvání kondice, popis úpravy, úroveň dovednosti) k položce inventáře, dovednosti, kondici nebo tělesné úpravě, která je v aktuálním stavu hry vidět jen jménem (bez detailu, protože byla odsunuta do 'jen jména' seznamu kvůli délce kontextu). Volej POUZE když hráč odkazuje na něco konkrétního, jehož detail teď skutečně potřebuješ – ne preventivně u každé zmínky.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Přesný nebo přibližný název položky/dovednosti/kondice/úpravy, kterou chceš vyhledat."
                    }
                },
                "required": ["name"]
            }
        }]
    }])
}

fn build_body(connection: &ConnectionDto, messages: &[ChatMessage], tools: bool) -> Value {
    let system_instruction = messages
        .iter()
        .find(|m| matches!(m.role, Role::System))
        .map(|m| json!({ "parts": [{ "text": m.content }] }));

    let contents: Vec<Value> = messages
        .iter()
        .filter(|m| !matches!(m.role, Role::System))
        .map(|m| {
            // EXPERIMENTAL: function-call / function-response turns carry no
            // plain text — they replay the tool round-trip back to Gemini in
            // its expected wire shape instead of the usual `{text}` part.
            if let Some(fc) = &m.function_call {
                let mut part = json!({ "functionCall": { "name": fc.name, "args": fc.args } });
                // Must sit alongside functionCall on the part, matching how
                // Gemini originally sent it (see parse_data) — not nested
                // inside functionCall itself.
                if let Some(sig) = &fc.thought_signature {
                    part["thoughtSignature"] = json!(sig);
                }
                return json!({
                    "role": "model",
                    "parts": [part]
                });
            }
            if let Some(fr) = &m.function_response {
                return json!({
                    "role": "user",
                    "parts": [{ "functionResponse": { "name": fr.name, "response": fr.response } }]
                });
            }
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
    if tools {
        body["tools"] = tool_declarations();
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
        // EXPERIMENTAL: a `functionCall` part takes priority over any text
        // part in the same chunk — Gemini doesn't mix narrative text with a
        // tool call in one part, but checking first keeps this robust either
        // way.
        for part in parts {
            if let Some(name) = part["functionCall"]["name"].as_str() {
                let args = part["functionCall"]["args"].to_string();
                // Gemini attaches this at the *part* level, alongside (not
                // inside) functionCall — must be replayed verbatim on the
                // follow-up request or the API rejects it with HTTP 400.
                let thought_signature = part["thoughtSignature"].as_str().map(|s| s.to_string());
                return ParsedEvent::FunctionCall(name.to_string(), args, thought_signature);
            }
        }
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
    tools: bool,
) -> Result<(), ProviderError> {
    let client = reqwest::Client::new();
    let body = build_body(connection, messages, tools);
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
                                ParsedEvent::FunctionCall(name, args_json, thought_signature) => {
                                    let args = serde_json::from_str(&args_json)
                                        .unwrap_or(Value::Null);
                                    let _ = tx.send(StreamEvent::FunctionCall { name, args, thought_signature });
                                    // Gemini does not keep streaming narrative
                                    // text in the same turn after a
                                    // functionCall part — this call's job is
                                    // done; the frontend resumes with a fresh
                                    // `chat_stream` call once it has the tool
                                    // result.
                                    return Ok(());
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
    use super::super::{FunctionCallDto, FunctionResponseDto};

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

    /// EXPERIMENTAL (function-calling prototype): simulates the SSE chunk
    /// Gemini sends when the model decides to call `get_item_detail` instead
    /// of continuing to generate narrative text.
    #[test]
    fn parses_function_call() {
        let data = r#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_item_detail","args":{"name":"rezavý meč"}}}],"role":"model"}}]}"#;
        assert_eq!(
            parse_data(data),
            ParsedEvent::FunctionCall(
                "get_item_detail".to_string(),
                r#"{"name":"rezavý meč"}"#.to_string(),
                None,
            ),
        );
    }

    /// Regression test: Gemini attaches `thoughtSignature` at the *part*
    /// level (a sibling of `functionCall`, not nested inside it). Found via
    /// a live API call — omitting this on the follow-up request makes
    /// Gemini reject it with HTTP 400, so it must round-trip through
    /// parsing intact.
    #[test]
    fn parses_function_call_thought_signature() {
        let data = r#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_item_detail","args":{"name":"Stará bota"}},"thoughtSignature":"abc123"}],"role":"model"}}]}"#;
        assert_eq!(
            parse_data(data),
            ParsedEvent::FunctionCall(
                "get_item_detail".to_string(),
                r#"{"name":"Stará bota"}"#.to_string(),
                Some("abc123".to_string()),
            ),
        );
    }

    /// Regression test: `build_body` must replay `thoughtSignature` as a
    /// sibling of `functionCall` on the part, matching Gemini's own shape.
    #[test]
    fn build_body_replays_thought_signature() {
        let messages = vec![ChatMessage {
            role: Role::Assistant,
            content: String::new(),
            function_call: Some(FunctionCallDto {
                name: "get_item_detail".to_string(),
                args: json!({ "name": "Stará bota" }),
                thought_signature: Some("abc123".to_string()),
            }),
            function_response: None,
        }];
        let conn = ConnectionDto {
            id: "c1".to_string(),
            provider: "gemini".to_string(),
            base_url: None,
            model: "gemini-2.5-flash".to_string(),
            temperature: 0.7,
            top_p: 0.9,
            top_k: None,
            min_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            max_tokens: 1024,
        };
        let body = build_body(&conn, &messages, true);
        assert_eq!(body["contents"][0]["parts"][0]["thoughtSignature"], "abc123");
        assert_eq!(
            body["contents"][0]["parts"][0]["functionCall"]["name"],
            "get_item_detail"
        );
    }

    /// EXPERIMENTAL: `build_body` must encode a prior function-call turn as
    /// a `model`-role `functionCall` part and the app's answer as a
    /// `user`-role `functionResponse` part — this is the shape the
    /// follow-up `chat_stream` call sends to actually resume generation
    /// with the looked-up detail in context. Also checks the tool
    /// declaration is only attached when `tools` is true.
    #[test]
    fn build_body_encodes_function_round_trip_and_gates_tool_declaration() {
        let connection = ConnectionDto {
            id: "c1".to_string(),
            provider: "gemini".to_string(),
            base_url: None,
            model: "gemini-2.5-flash".to_string(),
            temperature: 0.7,
            top_p: 0.9,
            top_k: None,
            min_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            max_tokens: 1024,
        };
        let messages = vec![
            ChatMessage {
                role: Role::User,
                content: "Co je zač ten rezavý meč?".to_string(),
                function_call: None,
                function_response: None,
            },
            ChatMessage {
                role: Role::Assistant,
                content: String::new(),
                function_call: Some(FunctionCallDto {
                    name: "get_item_detail".to_string(),
                    args: json!({ "name": "rezavý meč" }),
                    thought_signature: None,
                }),
                function_response: None,
            },
            ChatMessage {
                role: Role::User,
                content: String::new(),
                function_call: None,
                function_response: Some(FunctionResponseDto {
                    name: "get_item_detail".to_string(),
                    response: json!({ "result": "Rezavý meč: poznámka „nalezen v kryptě, +1 k zastrašení“." }),
                }),
            },
        ];

        let no_tools_body = build_body(&connection, &messages, false);
        assert!(no_tools_body.get("tools").is_none());

        let body = build_body(&connection, &messages, true);
        assert_eq!(
            body["tools"][0]["functionDeclarations"][0]["name"],
            "get_item_detail"
        );

        let contents = body["contents"].as_array().expect("contents array");
        assert_eq!(contents.len(), 3);
        assert_eq!(contents[1]["role"], "model");
        assert_eq!(
            contents[1]["parts"][0]["functionCall"]["name"],
            "get_item_detail"
        );
        assert_eq!(
            contents[1]["parts"][0]["functionCall"]["args"]["name"],
            "rezavý meč"
        );
        assert_eq!(contents[2]["role"], "user");
        assert_eq!(
            contents[2]["parts"][0]["functionResponse"]["name"],
            "get_item_detail"
        );
        assert!(contents[2]["parts"][0]["functionResponse"]["response"]["result"]
            .as_str()
            .unwrap()
            .contains("nalezen v kryptě"));
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

    /// EXPERIMENTAL (function-calling prototype): simulates a full SSE
    /// fixture for a turn where the model streams a bit of narrative text
    /// and then decides to call the tool — proving the splitter + parser
    /// pipeline (the same one `stream()` drives) correctly surfaces the
    /// `FunctionCall` event in sequence with preceding tokens. This is the
    /// "mocked Gemini response" stand-in for a live-key smoke test — a real
    /// API call still needs to be tried separately with a real key.
    #[test]
    fn simulated_stream_with_mid_turn_function_call() {
        let full = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Sáhneš do batohu... \"}]}}]}\n\n\
data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"get_item_detail\",\"args\":{\"name\":\"rezavý meč\"}}}]}}]}\n\n";

        let mut splitter = SseLineSplitter::new();
        let mut events = Vec::new();
        for line in splitter.push(full.as_bytes()) {
            if let Some(data) = parse_data_line(&line) {
                events.push(parse_data(data));
            }
        }

        assert_eq!(
            events,
            vec![
                ParsedEvent::Token("Sáhneš do batohu... ".to_string()),
                ParsedEvent::FunctionCall(
                    "get_item_detail".to_string(),
                    r#"{"name":"rezavý meč"}"#.to_string(),
                    None,
                ),
            ]
        );
    }
}
