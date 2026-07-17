//! Campaign export: creates a ZIP bundle with all chat data for backup,
//! migration, or archival. Produces a versioned manifest so future importers
//! can detect the format version.
//!
//! ZIP layout:
//!   manifest.json     — version, export date, chat title
//!   chat.json         — { title, characterIds, messages[] }
//!   ledger.json       — { facts[] }
//!   summary.json      — { text, upToMessageId }
//!   quests.json       — { quests[] }
//!   lorebooks/        — one .json per linked lorebook
//!   chronicle/        — any chronicle exports (if present)

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignExportInput {
    pub chat_title: String,
    pub chat_json: String,
    pub ledger_json: String,
    pub summary_json: Option<String>,
    pub quests_json: String,
    /// Array of { name, description, entries[] } — one per linked lorebook.
    pub lorebooks_json: String,
    /// Optional chronicle HTML content from export_chronicle.
    pub chronicle_html: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CampaignManifest {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub chat_title: String,
}

/// Creates a campaign ZIP at `output_path` from the pre-collected JSON
/// blobs. The frontend gathers all data via its own DB queries and passes
/// them here; Rust only handles file creation and ZIP packaging.
#[tauri::command]
pub fn export_campaign_zip(
    _app: AppHandle,
    output_path: String,
    input: CampaignExportInput,
) -> Result<String, String> {
    let out = PathBuf::from(&output_path);
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("nepodařilo se vytvořit výstupní adresář: {e}"))?;
    }

    let file = fs::File::create(&out)
        .map_err(|e| format!("nepodařilo se vytvořit ZIP soubor: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);

    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // ── manifest.json ──────────────────────────────────────────────
    let manifest = CampaignManifest {
        format: "mysillytavern-campaign-v1".to_string(),
        version: 1,
        exported_at: chrono_now(),
        chat_title: input.chat_title.clone(),
    };
    zip.start_file("manifest.json", options)
        .map_err(|e| format!("ZIP: {e}"))?;
    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("JSON: {e}"))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("ZIP: {e}"))?;

    // ── chat.json ──────────────────────────────────────────────────
    zip.start_file("chat.json", options)
        .map_err(|e| format!("ZIP: {e}"))?;
    zip.write_all(input.chat_json.as_bytes())
        .map_err(|e| format!("ZIP: {e}"))?;

    // ── ledger.json ────────────────────────────────────────────────
    zip.start_file("ledger.json", options)
        .map_err(|e| format!("ZIP: {e}"))?;
    zip.write_all(input.ledger_json.as_bytes())
        .map_err(|e| format!("ZIP: {e}"))?;

    // ── summary.json ───────────────────────────────────────────────
    if let Some(ref summary) = input.summary_json {
        zip.start_file("summary.json", options)
            .map_err(|e| format!("ZIP: {e}"))?;
        zip.write_all(summary.as_bytes())
            .map_err(|e| format!("ZIP: {e}"))?;
    }

    // ── quests.json ────────────────────────────────────────────────
    zip.start_file("quests.json", options)
        .map_err(|e| format!("ZIP: {e}"))?;
    zip.write_all(input.quests_json.as_bytes())
        .map_err(|e| format!("ZIP: {e}"))?;

    // ── lorebooks/ ─────────────────────────────────────────────────
    let lorebooks: Vec<serde_json::Value> =
        serde_json::from_str(&input.lorebooks_json).unwrap_or_default();
    for (i, lb) in lorebooks.iter().enumerate() {
        let name = lb
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("unnamed");
        let safe_name = sanitize_filename(name);
        let path = if safe_name.is_empty() {
            format!("lorebooks/lorebook_{}.json", i)
        } else {
            format!("lorebooks/{}.json", safe_name)
        };
        zip.start_file(&path, options)
            .map_err(|e| format!("ZIP: {e}"))?;
        let lb_json =
            serde_json::to_string_pretty(lb).map_err(|e| format!("JSON: {e}"))?;
        zip.write_all(lb_json.as_bytes())
            .map_err(|e| format!("ZIP: {e}"))?;
    }

    // ── chronicle/ ─────────────────────────────────────────────────
    if let Some(ref html) = input.chronicle_html {
        zip.start_file("chronicle/chronicle.html", options)
            .map_err(|e| format!("ZIP: {e}"))?;
        zip.write_all(html.as_bytes())
            .map_err(|e| format!("ZIP: {e}"))?;
    }

    zip.finish().map_err(|e| format!("ZIP: {e}"))?;

    Ok(output_path)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn chrono_now() -> String {
    // Avoid pulling in chrono just for an ISO timestamp — format manually.
    use std::time::SystemTime;
    let dur = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    // Naive ISO-like: YYYY-MM-DDTHH:MM:SSZ
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let secs_rem = time_of_day % 60;

    // Convert days since Unix epoch to year/month/day
    let (year, month, day) = days_to_ymd(days_since_epoch as i64);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, secs_rem
    )
}

fn days_to_ymd(days: i64) -> (i64, u32, u32) {
    // Adapted from Howard Hinnant's algorithm
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_unsafe_chars() {
        assert_eq!(sanitize_filename("hello/world"), "hello_world");
        assert_eq!(sanitize_filename("test:file"), "test_file");
        assert_eq!(sanitize_filename("normal"), "normal");
        assert_eq!(sanitize_filename("a*b?c<d>e|f\"g"), "a_b_c_d_e_f_g");
    }

    #[test]
    fn chrono_now_produces_iso_like() {
        let ts = chrono_now();
        assert!(ts.ends_with("Z"));
        assert_eq!(ts.len(), 20);
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], "T");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
    }
}
