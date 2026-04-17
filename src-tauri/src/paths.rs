use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Directorio de datos de la app: $APPDATA/data. Fallback a ./data si Tauri no
// provee app_data_dir (tests / headless).
pub fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
}
