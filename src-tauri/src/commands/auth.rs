use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
struct PasswordData {
    hash: String,
}

fn get_password_file(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")).join("data").join("password.json")
}

#[tauri::command]
pub fn authenticate(app: AppHandle, password: String) -> Result<bool, String> {
    let path = get_password_file(&app);

    if !path.exists() {
        // Create default password file with "admin"
        let hash = bcrypt::hash("admin", bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
        let data = PasswordData { hash };
        let dir = path.parent().unwrap();
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())?;
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data: PasswordData = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    bcrypt::verify(&password, &data.hash).map_err(|e| e.to_string())
}
