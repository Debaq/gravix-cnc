use serde_json::Value;
use std::fs;

// --- Funciones desacopladas ---

pub fn save_project_to(path: &str, data: Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn load_project_from(path: &str) -> Result<Value, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

// --- Comandos Tauri ---

#[tauri::command]
pub fn save_project(path: String, data: Value) -> Result<(), String> {
    save_project_to(&path, data)
}

#[tauri::command]
pub fn load_project(path: String) -> Result<Value, String> {
    load_project_from(&path)
}
