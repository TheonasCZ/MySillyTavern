// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Use native file dialogs via XDG portal when available (KDE, GNOME, …);
    // falls back to GTK dialog when no portal backend is installed.
    std::env::set_var("GTK_USE_PORTAL", "1");
    mysillytavern_lib::run()
}
