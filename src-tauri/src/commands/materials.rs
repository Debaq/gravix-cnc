use crate::json_store::{read_json, write_json};
use crate::paths::data_dir;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct CncSettings {
    #[serde(rename = "feedRate")]
    #[ts(rename = "feedRate")]
    pub feed_rate: f64,
    #[serde(rename = "plungeRate")]
    #[ts(rename = "plungeRate")]
    pub plunge_rate: f64,
    pub rpm: f64,
    #[serde(rename = "depthPerPass")]
    #[ts(rename = "depthPerPass")]
    pub depth_per_pass: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub recommended: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct LaserSettings {
    #[serde(rename = "cutPower")]
    #[ts(rename = "cutPower")]
    pub cut_power: f64,
    #[serde(rename = "cutSpeed")]
    #[ts(rename = "cutSpeed")]
    pub cut_speed: f64,
    #[serde(rename = "engravePower")]
    #[ts(rename = "engravePower")]
    pub engrave_power: f64,
    #[serde(rename = "engraveSpeed")]
    #[ts(rename = "engraveSpeed")]
    pub engrave_speed: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub passes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub warning: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct PlotterSettings {
    pub pressure: f64,
    pub speed: f64,
    pub passes: u32,
    pub blade: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub offset: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Material {
    pub id: String,
    pub name: String,
    pub category: String,
    pub thickness: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cnc: Option<CncSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub laser: Option<LaserSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub plotter: Option<PlotterSettings>,
}

// --- Funciones desacopladas de AppHandle (usadas por Tauri y Axum) ---

fn path(dir: &Path) -> std::path::PathBuf {
    dir.join("materials.json")
}

pub fn read_materials_from(dir: &Path) -> Result<Vec<Material>, String> {
    read_json(&path(dir))
}

pub fn write_materials_to(dir: &Path, materials: &[Material]) -> Result<(), String> {
    write_json(&path(dir), &materials.to_vec())
}

pub fn save_material_to(dir: &Path, material: Material) -> Result<Material, String> {
    let mut materials = read_materials_from(dir)?;
    let mut material = material;
    if material.id.is_empty() {
        material.id = format!("material_{}", uuid::Uuid::new_v4());
    }
    if let Some(pos) = materials.iter().position(|m| m.id == material.id) {
        materials[pos] = material.clone();
    } else {
        materials.push(material.clone());
    }
    write_materials_to(dir, &materials)?;
    Ok(material)
}

pub fn delete_material_from(dir: &Path, id: &str) -> Result<(), String> {
    let mut materials = read_materials_from(dir)?;
    materials.retain(|m| m.id != id);
    write_materials_to(dir, &materials)
}

// --- Comandos Tauri ---

#[tauri::command]
pub fn get_materials(app: AppHandle) -> Result<Vec<Material>, String> {
    read_materials_from(&data_dir(&app))
}

#[tauri::command]
pub fn save_material(app: AppHandle, material: Material) -> Result<Material, String> {
    save_material_to(&data_dir(&app), material)
}

#[tauri::command]
pub fn delete_material(app: AppHandle, id: String) -> Result<(), String> {
    delete_material_from(&data_dir(&app), &id)
}
