use crate::json_store::{read_json, write_json};
use crate::paths::data_dir;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Default)]
struct PasswordData {
    hash: String,
}

pub fn authenticate_from(dir: &Path, password: &str) -> Result<bool, String> {
    let path = dir.join("password.json");
    if !path.exists() {
        let hash = bcrypt::hash("admin", bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
        write_json(&path, &PasswordData { hash })?;
    }
    let data: PasswordData = read_json(&path)?;
    bcrypt::verify(password, &data.hash).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn authenticate(app: AppHandle, password: String) -> Result<bool, String> {
    authenticate_from(&data_dir(&app), &password)
}
