use serde_json::{json, Value};

use super::{ChatMessage, ConnectionDto, ProviderError, Role};

/// OpenAI-compatible: ChatGPT, DeepSeek, OpenRouter — differ only by
/// base_url + model.
pub async fn complete(
    connection: &ConnectionDto,
    api_key: &str,
    messages: &[ChatMessage],
) -> Result<String, ProviderError> {
    let client = reqwest::Client::new();

    let base_url = connection
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let base_url = base_url.trim_end_matches('/');

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

    let body = json!({
        "model": connection.model,
        "messages": msgs,
        "temperature": connection.temperature,
        "top_p": connection.top_p,
        "max_tokens": connection.max_tokens,
        "stream": false,
    });

    let url = format!("{base_url}/chat/completions");

    let res = client
        .post(&url)
        .bearer_auth(api_key)
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
    let text = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| ProviderError::UnexpectedShape(json.to_string()))?;
    Ok(text.to_string())
}
