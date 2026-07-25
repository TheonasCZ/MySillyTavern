//! DeepSeek-specific: checks the user's account balance via the official
//! `GET /user/balance` endpoint. Only meaningful for DeepSeek connections;
//! other providers return a "not supported" error.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceInfo {
    pub currency: String,
    pub total_balance: String,
    pub granted_balance: String,
    pub topped_up_balance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserBalance {
    pub is_available: bool,
    pub balance_infos: Vec<BalanceInfo>,
}

/// Calls DeepSeek's `GET /user/balance` endpoint. The `base_url` should be
/// the same URL the user configured for chat completions (e.g.
/// `https://api.deepseek.com/v1`). The endpoint is at `/user/balance`
/// relative to the API root (we strip `/v1` if present).
#[tauri::command]
pub async fn get_user_balance(
    connection_id: String,
    base_url: Option<String>,
) -> Result<UserBalance, String> {
    let api_key = super::secrets::get_api_key(&connection_id)?
        .ok_or_else(|| "API key not found for this connection".to_string())?;

    // The /user/balance endpoint lives at the API root, not under /v1.
    // If the user's base_url is e.g. "https://api.deepseek.com/v1",
    // we need "https://api.deepseek.com/user/balance".
    let root = base_url
        .unwrap_or_else(|| "https://api.deepseek.com".to_string())
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .to_string();
    let url = format!("{root}/user/balance");

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error ({status}): {body}"));
    }

    let balance: UserBalance = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse balance response: {e}"))?;

    Ok(balance)
}
