mod commands;
mod migrations;
mod providers;

use commands::chat::{chat_abort, chat_complete, chat_stream, StreamRegistry};
use commands::secrets::{delete_api_key, has_api_key, set_api_key};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:mysillytavern.db", migrations::all_migrations())
                .build(),
        )
        .manage(StreamRegistry::default())
        .invoke_handler(tauri::generate_handler![
            set_api_key,
            delete_api_key,
            has_api_key,
            chat_complete,
            chat_stream,
            chat_abort,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
