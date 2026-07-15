use serde_json::{json, Value};

use super::{ChatMessage, ConnectionDto, ProviderError, Role};

pub async fn complete(
    connection: &ConnectionDto,
    api_key: &str,
    messages: &[ChatMessage],
) -> Result<String, ProviderError> {
    let client = reqwest::Client::new();

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
    if let Some(sys) = system_instruction {
        body["systemInstruction"] = sys;
    }

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
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
        return Err(ProviderError::Api {
            status: status.as_u16(),
            message,
        });
    }

    let json: Value = res.json().await?;
    let text = json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or_else(|| ProviderError::UnexpectedShape(json.to_string()))?;
    Ok(text.to_string())
}
