use crate::license::{verify_license, save_license, load_saved_license, license_path, LicenseStatus};

#[tauri::command]
pub fn activate_license(app: tauri::AppHandle, token: String) -> LicenseStatus {
    let status = verify_license(&token);
    if status.is_valid {
        // Licencia válida que no se puede persistir: se avisa, porque si no el
        // usuario activa, ve "Pro" y al reiniciar vuelve a estar sin licencia.
        if let Err(e) = save_license(&app, &token) {
            return LicenseStatus {
                is_valid: true,
                email: status.email,
                error: Some(e),
            };
        }
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
    if let Some(path) = license_path(&app) {
        std::fs::remove_file(path).ok();
    }
}
