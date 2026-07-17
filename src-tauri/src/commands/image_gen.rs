use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::commands::secrets::get_api_key;
use crate::providers::{self, ConnectionDto};

/// Generates an illustration via Gemini, resizes it to max 512px,
/// and saves it as a PNG in the avatars directory.
/// Returns the absolute filesystem path of the saved file.
#[tauri::command]
pub async fn generate_illustration(
    app: AppHandle,
    connection: ConnectionDto,
    prompt: String,
) -> Result<String, String> {
    let api_key = get_api_key(&connection.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pro toto připojení není uložen žádný API klíč.".to_string())?;

    // Try Gemini first, fall back to free Pollinations.ai if geo-blocked
    let image_bytes = match providers::image_gen::generate_image(&connection, &api_key, &prompt).await {
        Ok(bytes) => bytes,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("not available in your country") || msg.contains("FAILED_PRECONDITION") {
                providers::image_gen::generate_image_free(&prompt).await.map_err(|e| e.to_string())?
            } else {
                return Err(msg);
            }
        }
    };

    // Resize to max 512px on the longer side — icons and avatars don't
    // need more, and smaller files load faster in the UI.
    let resized = resize_max(&image_bytes, 512)
        .map_err(|e| format!("nepodařilo se zmenšit obrázek: {e}"))?;

    let dir = avatars_dir(&app)?;
    let filename = format!("illustration_{}.png", uuid::Uuid::new_v4());
    let dest = dir.join(&filename);
    fs::write(&dest, &resized)
        .map_err(|e| format!("nepodařilo se uložit obrázek: {e}"))?;

    Ok(dest.to_string_lossy().to_string())
}

/// Resizes a PNG to at most `max_dim` pixels on the longer side,
/// keeping the aspect ratio. Returns the resized PNG bytes.
fn resize_max(png_bytes: &[u8], max_dim: u32) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(png_bytes)
        .map_err(|e| format!("nepodařilo se načíst obrázek: {e}"))?;

    let (w, h) = (img.width(), img.height());
    if w <= max_dim && h <= max_dim {
        // Already small enough — re-encode as PNG anyway to strip
        // any extra chunks the API might include.
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png)
            .map_err(|e| format!("nepodařilo se uložit obrázek: {e}"))?;
        return Ok(buf.into_inner());
    }

    let ratio = if w > h {
        max_dim as f64 / w as f64
    } else {
        max_dim as f64 / h as f64
    };
    let new_w = (w as f64 * ratio) as u32;
    let new_h = (h as f64 * ratio) as u32;

    let resized = img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3);
    let mut buf = Cursor::new(Vec::new());
    resized
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("nepodařilo se uložit obrázek: {e}"))?;
    Ok(buf.into_inner())
}

fn avatars_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("nepodařilo se najít adresář aplikace: {e}"))?;
    let dir = base.join("avatars");
    fs::create_dir_all(&dir).map_err(|e| format!("nepodařilo se vytvořit adresář avatarů: {e}"))?;
    Ok(dir)
}
