//! Image generation via Gemini's native multimodal output.
//! Uses `responseModalities: ["TEXT", "IMAGE"]` — the model returns both
//! a text description and a base64-encoded PNG inline.
//!
//! We discard the text and extract only the image data.

use base64::Engine;
use rand::Rng;
use serde_json::{json, Value};

use super::{ConnectionDto, ProviderError};

fn api_err(status: u16, msg: impl Into<String>) -> ProviderError {
    ProviderError::Api {
        status,
        message: msg.into(),
    }
}

/// Calls Gemini and returns the generated image as raw PNG bytes.
pub async fn generate_image(
    connection: &ConnectionDto,
    api_key: &str,
    prompt: &str,
) -> Result<Vec<u8>, ProviderError> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        connection.model
    );

    let body = json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": "1:1",
                "imageSize": "1K"
            }
        }
    });

    let res = client
        .post(&url)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .await?;

    let status = res.status();
    let text = res.text().await?;

    if !status.is_success() {
        return Err(api_err(status.as_u16(), text));
    }

    let v: Value = serde_json::from_str(&text).map_err(|e| api_err(200, format!("Invalid JSON: {e}")))?;
    let parts = v["candidates"][0]["content"]["parts"]
        .as_array()
        .ok_or_else(|| api_err(200, "No parts in Gemini image response"))?;

    for part in parts {
        if let Some(inline) = part["inlineData"].as_object() {
            if inline.get("mimeType").and_then(|m| m.as_str()) == Some("image/png") {
                if let Some(b64) = inline.get("data").and_then(|d| d.as_str()) {
                    return base64::engine::general_purpose::STANDARD
                        .decode(b64)
                        .map_err(|e| api_err(200, format!("Failed to decode base64 image: {e}")));
                }
            }
        }
    }

    Err(api_err(200, "No image data found in Gemini response"))
}

/// Free image generation via pollinations.ai — no API key needed.
/// Wraps Stable Diffusion behind a simple GET endpoint.
/// Falls back when Gemini is geo-blocked.
pub async fn generate_image_free(prompt: &str) -> Result<Vec<u8>, ProviderError> {
    let client = reqwest::Client::new();
    let seed: u64 = rand::thread_rng().gen();
    let styles = [
        "oil painting, dramatic lighting",
        "digital fantasy art, vibrant colors",
        "dark fantasy, moody atmosphere",
        "watercolor illustration, soft tones",
        "realistic portrait, detailed features",
        "comic book style, bold lines",
        "pencil sketch, rough shading",
        "anime art style, clean lines",
        "gothic illustration, ornate details",
        "minimalist vector art, flat colors",
    ];
    let style = styles[rand::thread_rng().gen_range(0..styles.len())];
    let unique_prompt = format!("{prompt}, {style} [seed:{seed}]");
    let url = format!(
        "https://image.pollinations.ai/prompt/{}?width=512&height=512&nologo=true",
        urlencoding(&unique_prompt)
    );

    let res = client.get(&url).send().await?;
    let status = res.status();
    if !status.is_success() {
        return Err(api_err(status.as_u16(), "Pollinations.ai request failed"));
    }
    res.bytes().await.map(|b| b.to_vec()).map_err(|e| api_err(500, format!("Failed to read image: {e}")))
}

fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
