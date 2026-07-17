mod commands;
mod migrations;
mod png_card;
mod providers;

use commands::backup::{
    apply_pending_import, cancel_pending_import, export_backup, has_pending_import,
    list_backups, request_import_backup, run_auto_backup,
};
use commands::cards::{ensure_placeholder_avatar, export_card_png, import_card_png, read_card_json_file};
use commands::chat::{
    chat_abort, chat_complete, chat_stream, embed_texts, list_models, StreamRegistry,
};
use commands::dice::eval_dice;
use commands::export_campaign::export_campaign_zip;
use commands::export_chronicle::{
    cancel_export, get_export_status, resume_export, start_export, ExportRegistry,
};
use commands::files::{read_text_file, write_text_file};
use commands::image_gen::generate_illustration;
use commands::logging::{append_log, get_log_path};
use commands::secrets::{delete_api_key, has_api_key, init_store, set_api_key};
use commands::sync_journal::{
    append_journal_line, delete_sync_file, list_sync_entries, read_journal_chunk,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(target_os = "android"))]
    {
        builder = builder
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:mysillytavern.db", migrations::all_migrations())
                .build(),
        )
        .manage(StreamRegistry::default())
        .manage(ExportRegistry::default())
        .setup(|app| {
            init_store(app.handle())?;
            apply_pending_import(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_api_key,
            delete_api_key,
            has_api_key,
            chat_complete,
            chat_stream,
            chat_abort,
            list_models,
            embed_texts,
            import_card_png,
            export_card_png,
            read_card_json_file,
            ensure_placeholder_avatar,
            read_text_file,
            write_text_file,
            export_backup,
            request_import_backup,
            has_pending_import,
            cancel_pending_import,
            run_auto_backup,
            list_backups,
            append_log,
            get_log_path,
            eval_dice,
            generate_illustration,
            export_campaign_zip,
            start_export,
            resume_export,
            get_export_status,
            cancel_export,
            append_journal_line,
            list_sync_entries,
            read_journal_chunk,
            delete_sync_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
