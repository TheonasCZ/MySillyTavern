use std::fs;
use std::io::Write;

use tauri::AppHandle;

use crate::commands::logging::{logs_dir, rotate_if_needed};
use crate::commands::secrets::get_api_key;
use crate::providers::{self, ChatMessage, ConnectionDto, Role};

const EXTRACTION_SYSTEM_PROMPT: &str = r#"You are a game state extractor for an RPG. Read the narrator's response below and extract any game-mechanical changes into a single JSON object.

Return ONLY the JSON object, no other text, no markdown fences. The JSON must use this schema:

{
  "time_elapsed_minutes": number | null,
  "inventory": [{"op": "add" | "remove", "item": "string", "qty": number}],
  "skills": [{"name": "string", "delta": number}],
  "levels": {"xp_delta": number, "level_delta": number},
  "conditions": [{"op": "add" | "remove", "name": "string", "description": "string | null", "duration": "string | null"}],
  "modifications": [{"op": "add" | "remove", "name": "string"}],
  "factions": [{"name": "string", "delta": number}],
  "crafting": [{"result_item": "string", "ingredients": ["string"]}],
  "crafted": [{"result_item": "string", "perks": ["string"]}],
  "quests": [{"op": "start" | "complete" | "fail" | "note", "name": "string", "note": "string | null"}],
  "game_over": "string | null",
  "check_skill": "string | null",
  "relevant_context": {
    "skills": ["string"],
    "item_keywords": ["string"],
    "recipe_keywords": ["string"]
  }
}

Rules:
- If nothing changed in a category, use an empty array or null.
- time_elapsed_minutes: how many minutes passed in the story (e.g. "two hours later" = 120). If unclear, use null.
- inventory: items gained, lost, or whose qty changed. "He found a sword" = add sword qty 1. "He dropped his shield" = remove shield qty 1.
- skills: new skills learned or existing ones improved. Delta is the change (positive = improved, negative = worsened).
- levels: xp_delta is XP change, level_delta is level change.
- conditions: temporary effects like "exhausted", "injured", "blessed".
- modifications: permanent body changes like "scar on cheek", "tattoo".
- factions: reputation changes with named groups.
- crafting: new recipes discovered (result_item + ingredients).
- crafted: items successfully crafted (result_item + perks).
- quests: new quests started, completed, failed, or noted.
- game_over: if the character died, state the reason. Otherwise null.
- check_skill: if a skill check was called, name the skill. Otherwise null.
- relevant_context: helps filter what skills/items/recipes to show the storyteller in the next turn. Look at the current scene and list:
  - skills: name any character skills the scene suggests could be useful (e.g. a river suggests Swimming, a locked door suggests Lockpicking). Include skills that ARE ALREADY KNOWN by the character. Empty array if no skills stand out.
  - item_keywords: keywords from the scene that suggest what items might be needed (e.g. "river" → "voda", "rope", "boat"). These help surface relevant inventory items.
  - recipe_keywords: keywords from materials or crafting opportunities in the scene (e.g. "iron ore" → "železo", "ruda"). These help surface relevant crafting recipes.

IMPORTANT: Only extract changes that are explicitly described in the text. Do not invent or hallucinate. If the text just describes scenery or dialogue with no mechanical changes, return empty arrays."#;

const EXTRACTOR_LOG_FILE_NAME: &str = "extractor.log";
const EXTRACTOR_LOG_ROTATE_AT: u64 = 2 * 1024 * 1024; // 2 MB

fn extractor_log_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    logs_dir(app).map(|d| d.join(EXTRACTOR_LOG_FILE_NAME))
}

fn append_extractor_log(app: &AppHandle, line: &str) {
    let Ok(path) = extractor_log_path(app) else { return };
    // Rotate before appending so the extractor log doesn't grow unbounded.
    let _ = rotate_if_needed(&path, EXTRACTOR_LOG_ROTATE_AT);
    let mut file = match fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let _ = writeln!(file, "{line}");
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let secs_rem = time_of_day % 60;
    let total_days = days_since_epoch as i64;
    let z = total_days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02}T{hours:02}:{minutes:02}:{secs_rem:02}.{millis:03}Z")
}

/// Sends the narrator's response to a tag-extraction model (typically a
/// fast/free model like Gemini Flash) and returns the model's JSON output.
/// Also writes a detailed debug log to `extractor.log` in the app data
/// directory so the user can inspect extraction I/O in real time.
#[tauri::command]
pub async fn extract_game_tags(
    app: AppHandle,
    connection: ConnectionDto,
    response_text: String,
    state_context: Option<String>,
) -> Result<String, String> {
    let ts = chrono_now();

    // Build the user message: state context (if any) + narrator response.
    let user_message = match state_context {
        Some(ref ctx) if !ctx.is_empty() => format!("{ctx}\n\n---\n\n{response_text}"),
        _ => response_text.clone(),
    };

    // Log input (truncated)
    let input_preview: String = response_text.chars().take(500).collect();
    append_extractor_log(
        &app,
        &format!(
            "══════ EXTRACT {ts} IN ({}/{}) ══════\n{input_preview}…",
            connection.provider, connection.model
        ),
    );

    let api_key = get_api_key(&connection.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pro toto připojení není uložen žádný API klíč.".to_string())?;

    let messages = vec![
        ChatMessage {
            role: Role::System,
            content: EXTRACTION_SYSTEM_PROMPT.into(),
            function_call: None,
            function_response: None,
        },
        ChatMessage {
            role: Role::User,
            content: user_message,
            function_call: None,
            function_response: None,
        },
    ];

    let raw = providers::complete(&connection, &api_key, &messages)
        .await
        .map_err(|e| {
            append_extractor_log(&app, &format!("ERROR: {e}"));
            e.to_string()
        })?;

    // Log output (truncated)
    let output_preview: String = raw.chars().take(800).collect();
    append_extractor_log(
        &app,
        &format!("══════ RESULT {ts} ══════\n{output_preview}"),
    );

    // Strip markdown fences
    let trimmed = raw.trim();
    if trimmed.starts_with("```") {
        let inner = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .unwrap_or(trimmed);
        let cleaned = inner.strip_suffix("```").unwrap_or(inner);
        Ok(cleaned.trim().to_string())
    } else {
        Ok(trimmed.to_string())
    }
}
