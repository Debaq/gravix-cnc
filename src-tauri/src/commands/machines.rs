use crate::json_store::{read_json, write_json};
use crate::paths::data_dir;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use tauri::AppHandle;

// Tauri solo persiste el JSON; el shape vive en TS. Guardamos Value para no
// duplicar el modelo en Rust.

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MachinesFile {
    #[serde(default)]
    pub machines: Vec<Value>,
    #[serde(rename = "activeMachineId", default)]
    pub active_machine_id: Option<String>,
}

fn path(dir: &Path) -> std::path::PathBuf {
    dir.join("machines.json")
}

pub fn read_machines_from(dir: &Path) -> Result<MachinesFile, String> {
    read_json(&path(dir))
}

pub fn write_machines_to(dir: &Path, data: &MachinesFile) -> Result<(), String> {
    write_json(&path(dir), data)
}

#[tauri::command]
pub fn get_machines(app: AppHandle) -> Result<MachinesFile, String> {
    read_machines_from(&data_dir(&app))
}

#[tauri::command]
pub fn save_machines(app: AppHandle, data: MachinesFile) -> Result<(), String> {
    write_machines_to(&data_dir(&app), &data)
}
