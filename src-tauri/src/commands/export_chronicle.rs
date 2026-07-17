use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::commands::secrets::get_api_key;
use crate::providers::{self, ChatMessage, ConnectionDto, Role};

// ── Types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkInput {
    pub index: usize,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkResult {
    pub index: usize,
    pub prose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportStatus {
    pub status: String,
    pub progress: i32,
    pub output_path: Option<String>,
    pub current_chunk: i32,
    pub total_chunks: i32,
}

struct ExportJob {
    #[allow(dead_code)]
    job_id: String,
    status: String,
    progress: i32,
    total_chunks: i32,
    current_chunk: i32,
    output_path: Option<String>,
    cancel: CancellationToken,
}

#[derive(Default)]
pub struct ExportRegistry(Arc<Mutex<HashMap<String, ExportJob>>>);

// ── Commands ─────────────────────────────────────────────────────────

const CHRONICLER_PROMPT: &str =
    "Jsi kronikář. Přepiš následující herní deník do poutavé prózy. \
     Vynechej herní příkazy a opakování. Piš v přítomném čase, \
     živě a sugestivně, jako bys vyprávěl příběh u krbu.";

/// Starts a background export job. Chunks are pre-computed by the frontend
/// and passed as JSON. The command spawns a background task that processes
/// each chunk through the AI and assembles the final HTML file.
#[tauri::command]
pub async fn start_export(
    app: AppHandle,
    registry: State<'_, ExportRegistry>,
    job_id: String,
    connection: ConnectionDto,
    chunks_json: String,
    theme: String,
    format: String,
    include_illustrations: bool,
    output_dir: String,
) -> Result<(), String> {
    let chunks: Vec<ChunkInput> =
        serde_json::from_str(&chunks_json).map_err(|e| format!("invalid chunks_json: {e}"))?;
    let total = chunks.len() as i32;

    let cancel = CancellationToken::new();
    let cancel_clone = cancel.clone();

    let job = ExportJob {
        job_id: job_id.clone(),
        status: "running".to_string(),
        progress: 0,
        total_chunks: total,
        current_chunk: 0,
        output_path: None,
        cancel,
    };

    registry
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(job_id.clone(), job);

    // Resolve output directory
    let resolved_output_dir = if output_dir.is_empty() {
        app.path()
            .app_data_dir()
            .map(|p| p.join("chronicles"))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    } else {
        output_dir
    };

    let reg = Arc::clone(&registry.0);
    let jid = job_id.clone();

    tokio::spawn(async move {
        let result = run_export(
            &jid, &connection, &chunks, &theme, &format,
            include_illustrations, &resolved_output_dir, cancel_clone, &reg,
        ).await;

        let mut map = reg.lock().unwrap();
        if let Some(job) = map.get_mut(&jid) {
            match result {
                Ok(path) => {
                    job.status = "completed".to_string();
                    job.progress = 100;
                    job.output_path = Some(path);
                }
                Err(err) => {
                    job.status = "failed".to_string();
                    job.output_path = Some(err);
                }
            }
        }
    });

    Ok(())
}

/// Resumes a previously interrupted export job. Reads the already-processed
/// chunks from `chunks_json` and continues from `current_chunk`.
#[tauri::command]
pub async fn resume_export(
    app: AppHandle,
    registry: State<'_, ExportRegistry>,
    job_id: String,
    connection: ConnectionDto,
    chunks_json: String,
    processed_results_json: String,
    current_chunk: i32,
    theme: String,
    format: String,
    include_illustrations: bool,
    output_dir: String,
) -> Result<(), String> {
    let chunks: Vec<ChunkInput> =
        serde_json::from_str(&chunks_json).map_err(|e| format!("invalid chunks_json: {e}"))?;
    let processed: Vec<ChunkResult> =
        serde_json::from_str(&processed_results_json).map_err(|e| format!("invalid processed_results_json: {e}"))?;

    let total = chunks.len() as i32;
    let cancel = CancellationToken::new();
    let cancel_clone = cancel.clone();

    let job = ExportJob {
        job_id: job_id.clone(),
        status: "running".to_string(),
        progress: if total > 0 {
            (current_chunk * 100) / total
        } else {
            0
        },
        total_chunks: total,
        current_chunk,
        output_path: None,
        cancel,
    };

    // Resolve output directory
    let resolved_output_dir = if output_dir.is_empty() {
        app.path()
            .app_data_dir()
            .map(|p| p.join("chronicles"))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    } else {
        output_dir
    };

    registry
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(job_id.clone(), job);

    let reg = Arc::clone(&registry.0);
    let jid = job_id.clone();

    tokio::spawn(async move {
        let result = run_export_resume(
            &jid, &connection, &chunks, &processed, current_chunk as usize,
            &theme, &format, include_illustrations, &resolved_output_dir, cancel_clone, &reg,
        )
        .await;

        let mut map = reg.lock().unwrap();
        if let Some(job) = map.get_mut(&jid) {
            match result {
                Ok(path) => {
                    job.status = "completed".to_string();
                    job.progress = 100;
                    job.output_path = Some(path);
                }
                Err(err) => {
                    job.status = "failed".to_string();
                    job.output_path = Some(err);
                }
            }
        }
    });

    Ok(())
}

/// Returns the current status, progress, and output path of an export job.
#[tauri::command]
pub fn get_export_status(
    registry: State<'_, ExportRegistry>,
    job_id: String,
) -> Result<ExportStatus, String> {
    let map = registry.0.lock().map_err(|e| e.to_string())?;
    match map.get(&job_id) {
        Some(job) => Ok(ExportStatus {
            status: job.status.clone(),
            progress: job.progress,
            output_path: job.output_path.clone(),
            current_chunk: job.current_chunk,
            total_chunks: job.total_chunks,
        }),
        None => Ok(ExportStatus {
            status: "unknown".to_string(),
            progress: 0,
            output_path: None,
            current_chunk: 0,
            total_chunks: 0,
        }),
    }
}

/// Cancels a running export job by its id.
#[tauri::command]
pub fn cancel_export(
    registry: State<'_, ExportRegistry>,
    job_id: String,
) -> Result<(), String> {
    let mut map = registry.0.lock().map_err(|e| e.to_string())?;
    if let Some(job) = map.get_mut(&job_id) {
        job.cancel.cancel();
        job.status = "failed".to_string();
        job.output_path = Some("Cancelled".to_string());
    }
    Ok(())
}

// ── Processing ───────────────────────────────────────────────────────

async fn run_export(
    job_id: &str,
    connection: &ConnectionDto,
    chunks: &[ChunkInput],
    theme: &str,
    format: &str,
    _include_illustrations: bool,
    output_dir: &str,
    cancel: CancellationToken,
    registry: &Arc<Mutex<HashMap<String, ExportJob>>>,
) -> Result<String, String> {
    let api_key = get_api_key(&connection.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pro toto připojení není uložen žádný API klíč.".to_string())?;

    let mut results: Vec<ChunkResult> = Vec::with_capacity(chunks.len());
    let total = chunks.len();

    for (i, chunk) in chunks.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err("Cancelled".to_string());
        }

        let prose = process_chunk(connection, &api_key, chunk).await?;
        results.push(ChunkResult {
            index: chunk.index,
            prose,
        });

        // Update progress in registry
        if let Ok(mut map) = registry.lock() {
            if let Some(job) = map.get_mut(job_id) {
                job.current_chunk = (i + 1) as i32;
                job.progress = if total > 0 {
                    ((i + 1) as i32 * 100) / total as i32
                } else {
                    0
                };
            }
        }

        // Rate-limit: 4 second delay between chunks
        if i + 1 < total {
            tokio::time::sleep(tokio::time::Duration::from_secs(4)).await;
        }
    }

    assemble_and_write(job_id, &results, theme, format, output_dir)
}

async fn run_export_resume(
    job_id: &str,
    connection: &ConnectionDto,
    chunks: &[ChunkInput],
    processed: &[ChunkResult],
    start_from: usize,
    theme: &str,
    format: &str,
    _include_illustrations: bool,
    output_dir: &str,
    cancel: CancellationToken,
    registry: &Arc<Mutex<HashMap<String, ExportJob>>>,
) -> Result<String, String> {
    let api_key = get_api_key(&connection.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Pro toto připojení není uložen žádný API klíč.".to_string())?;

    let mut results: Vec<ChunkResult> = processed.to_vec();
    let remaining: Vec<&ChunkInput> = chunks.iter().filter(|c| c.index >= start_from).collect();
    let total_remaining = remaining.len();

    for (i, chunk) in remaining.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err("Cancelled".to_string());
        }

        let prose = process_chunk(connection, &api_key, chunk).await?;
        results.push(ChunkResult {
            index: chunk.index,
            prose,
        });

        // Update progress in registry
        if let Ok(mut map) = registry.lock() {
            if let Some(job) = map.get_mut(job_id) {
                job.current_chunk = (start_from + i + 1) as i32;
                job.progress = if job.total_chunks > 0 {
                    ((start_from + i + 1) as i32 * 100) / job.total_chunks
                } else {
                    0
                };
            }
        }

        if i + 1 < total_remaining {
            tokio::time::sleep(tokio::time::Duration::from_secs(4)).await;
        }
    }

    // Sort by index
    results.sort_by_key(|r| r.index);
    assemble_and_write(job_id, &results, theme, format, output_dir)
}

async fn process_chunk(
    connection: &ConnectionDto,
    api_key: &str,
    chunk: &ChunkInput,
) -> Result<String, String> {
    let mut messages: Vec<ChatMessage> = vec![ChatMessage {
        role: Role::System,
        content: CHRONICLER_PROMPT.to_string(),
    }];

    // Build a user message from the chunk's messages
    let diary_text: String = chunk
        .messages
        .iter()
        .map(|m| {
            let role_label = match m.role {
                Role::User => "Hráč",
                Role::Assistant => "Vypravěč",
                Role::System => "Systém",
            };
            format!("[{}]: {}", role_label, m.content)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    messages.push(ChatMessage {
        role: Role::User,
        content: format!("Přepiš následující herní deník do poutavé prózy:\n\n{diary_text}"),
    });

    providers::complete(connection, api_key, &messages)
        .await
        .map_err(|e| e.to_string())
}

fn assemble_and_write(
    job_id: &str,
    results: &[ChunkResult],
    theme: &str,
    format: &str,
    output_dir: &str,
) -> Result<String, String> {
    // Build a simple HTML book
    let prose_sections: Vec<String> = results
        .iter()
        .map(|r| {
            format!(
                r#"<section class="chapter" id="chunk-{}">
  <div class="chapter-content">{}</div>
</section>"#,
                r.index,
                r.prose.replace('\n', "</p>\n<p>")
            )
        })
        .collect();

    let (bg, accent, text, font) = theme_colors(theme);

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kronika — {job_id}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: {font};
    background-color: {bg};
    color: {text};
    line-height: 1.8;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }}
  h1 {{
    text-align: center;
    font-size: 2.5rem;
    margin-bottom: 2rem;
    color: {accent};
    border-bottom: 3px double {accent};
    padding-bottom: 1rem;
  }}
  .chapter {{
    margin-bottom: 3rem;
    page-break-after: always;
  }}
  .chapter-content p {{
    margin-bottom: 0.8rem;
    text-indent: 1.5em;
  }}
  .appendix {{
    margin-top: 4rem;
    padding-top: 2rem;
    border-top: 1px solid {accent};
    font-size: 0.9rem;
    color: {accent};
  }}
  @media print {{
    body {{ max-width: none; padding: 1cm; }}
    .chapter {{ page-break-after: always; }}
  }}
</style>
</head>
<body>
<h1>📖 Kronika dobrodružství</h1>
{chapters}
<div class="appendix">
  <p><em>Vygenerováno pomocí MySillyTavern — Kronika export</em></p>
  <p>Téma: {theme} | Formát: {format}</p>
</div>
</body>
</html>"#,
        chapters = prose_sections.join("\n"),
    );

    let ext = if format == "pdf" { "html" } else { "html" };
    let filename = format!("chronicle_{job_id}.{ext}");
    let dir = PathBuf::from(output_dir);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("nepodařilo se vytvořit výstupní adresář: {e}"))?;
    let dest = dir.join(&filename);
    fs::write(&dest, &html)
        .map_err(|e| format!("nepodařilo se zapsat kroniku: {e}"))?;

    Ok(dest.to_string_lossy().to_string())
}

fn theme_colors(theme: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    match theme {
        "horror" => (
            "#0a0a0a",
            "#8b0000",
            "#c0c0c0",
            "'Courier New', monospace",
        ),
        "cyberpunk" => (
            "#0d0221",
            "#00ffff",
            "#c0c0ff",
            "'Consolas', monospace",
        ),
        "universal" => (
            "#ffffff",
            "#333333",
            "#000000",
            "'Georgia', serif",
        ),
        _ => (
            // fantasy (default)
            "#f5e6c8",
            "#8b6914",
            "#3d2b1f",
            "'Georgia', serif",
        ),
    }
}
