use crate::license::{verify_license, save_license, load_saved_license, LicenseStatus};
use tauri::Manager;

#[tauri::command]
pub fn activate_license(app: tauri::AppHandle, token: String) -> LicenseStatus {
    let status = verify_license(&token);
    if status.is_valid {
        save_license(&app, &token);
    }
    status
}

#[tauri::command]
pub fn get_license_status(app: tauri::AppHandle) -> LicenseStatus {
    match load_saved_license(&app) {
        Some(token) => verify_license(&token),
        None => LicenseStatus {
            is_valid: false,
            email: None,
            error: None,
        },
    }
}

#[tauri::command]
pub fn remove_license(app: tauri::AppHandle) {
    let path = app.path().app_config_dir()
        .unwrap().join("license.key");
    std::fs::remove_file(path).ok();
}
