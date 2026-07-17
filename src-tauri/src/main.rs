// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Use native file dialogs via XDG portal when available (KDE, GNOME, …);
    // falls back to GTK dialog when no portal backend is installed.
    std::env::set_var("GTK_USE_PORTAL", "1");

    // WebKitGTK on Wayland renders a blank window on some systems (NVIDIA/
    // dmabuf); force X11/XWayland and disable dmabuf unless the user
    // overrides these themselves.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    mysillytavern_lib::run()
}
