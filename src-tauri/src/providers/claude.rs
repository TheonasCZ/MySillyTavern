use serde_json::{json, Value};

use super::{ChatMessage, ConnectionDto, ProviderError, Role};

pub async fn complete(
    connection: &ConnectionDto,
    api_key: &str,
    messages: &[ChatMessage],
) -> Result<String, ProviderError> {
    let client = reqwest::Client::new();

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
        "stream": false,
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }

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
        return Err(ProviderError::Api {
            status: status.as_u16(),
            message,
        });
    }

    let json: Value = res.json().await?;
    let text = json["content"][0]["text"]
        .as_str()
        .ok_or_else(|| ProviderError::UnexpectedShape(json.to_string()))?;
    Ok(text.to_string())
}
