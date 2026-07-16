//! Embedding endpoints for the semantic memory layer. Claude has no
//! embedding API, so chats whose (extraction) connection is Claude simply
//! skip vector retrieval — the caller treats `NotSupported` as "feature
//! off", not as an error to surface.

use serde_json::json;

use super::{check_status, ProviderError};

const GEMINI_EMBEDDING_MODEL: &str = "gemini-embedding-001";
/// gemini-embedding-001 defaults to 3072 dims; 768 keeps storage/compute
/// small with negligible retrieval quality loss at this scale.
const GEMINI_OUTPUT_DIMS: u32 = 768;
const OPENAI_EMBEDDING_MODEL: &str = "text-embedding-3-small";

/// Both APIs cap batch sizes; 100 is safely under either limit.
const CHUNK_SIZE: usize = 100;

/// Returns one vector per input text, in input order, plus the model id
/// that produced them (stored alongside each vector so a model switch can
/// invalidate stale rows). `model_override` (the `embedding_model` setting)
/// replaces the per-provider default when set.
pub async fn embed_texts(
    provider: &str,
    base_url: Option<&str>,
    api_key: &str,
    model_override: Option<&str>,
    texts: &[String],
) -> Result<(String, Vec<Vec<f32>>), ProviderError> {
    let client = reqwest::Client::new();
    let mut vectors: Vec<Vec<f32>> = Vec::with_capacity(texts.len());
    let override_trimmed = model_override.map(str::trim).filter(|m| !m.is_empty());

    let model = match provider {
        "gemini" => {
            let model = override_trimmed.unwrap_or(GEMINI_EMBEDDING_MODEL);
            for chunk in texts.chunks(CHUNK_SIZE) {
                let requests: Vec<_> = chunk
                    .iter()
                    .map(|t| {
                        json!({
                            "model": format!("models/{model}"),
                            "content": { "parts": [{ "text": t }] },
                            "outputDimensionality": GEMINI_OUTPUT_DIMS
                        })
                    })
                    .collect();
                let url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"
                );
                let body: serde_json::Value = check_status(
                    client
                        .post(url)
                        .header("x-goog-api-key", api_key)
                        .json(&json!({ "requests": requests }))
                        .send()
                        .await?,
                )
                .await?;
                let embeddings = body["embeddings"].as_array().cloned().unwrap_or_default();
                if embeddings.len() != chunk.len() {
                    return Err(incomplete());
                }
                for e in &embeddings {
                    vectors.push(to_f32_vec(&e["values"])?);
                }
            }
            model
        }
        "openai" => {
            let model = override_trimmed.unwrap_or(OPENAI_EMBEDDING_MODEL);
            let base = base_url
                .unwrap_or("https://api.openai.com/v1")
                .trim_end_matches('/');
            for chunk in texts.chunks(CHUNK_SIZE) {
                let body: serde_json::Value = check_status(
                    client
                        .post(format!("{base}/embeddings"))
                        .bearer_auth(api_key)
                        .json(&json!({ "model": model, "input": chunk }))
                        .send()
                        .await?,
                )
                .await?;
                let mut data = body["data"].as_array().cloned().unwrap_or_default();
                data.sort_by_key(|d| d["index"].as_i64().unwrap_or(0));
                if data.len() != chunk.len() {
                    return Err(incomplete());
                }
                for d in &data {
                    vectors.push(to_f32_vec(&d["embedding"])?);
                }
            }
            model
        }
        other => {
            return Err(ProviderError::NotSupported(format!(
                "provider '{other}' nepodporuje embeddingy"
            )))
        }
    };

    Ok((model.to_string(), vectors))
}

fn to_f32_vec(values: &serde_json::Value) -> Result<Vec<f32>, ProviderError> {
    values
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).map(|v| v as f32).collect())
        .filter(|v: &Vec<f32>| !v.is_empty())
        .ok_or_else(incomplete)
}

fn incomplete() -> ProviderError {
    ProviderError::Api {
        status: 0,
        message: "embedding API vrátila neúplnou odpověď".to_string(),
    }
}
