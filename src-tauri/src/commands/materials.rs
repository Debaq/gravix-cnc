use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CncSettings {
    #[serde(rename = "feedRate")]
    pub feed_rate: f64,
    #[serde(rename = "plungeRate")]
    pub plunge_rate: f64,
    pub rpm: f64,
    #[serde(rename = "depthPerPass")]
    pub depth_per_pass: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LaserSettings {
    #[serde(rename = "cutPower")]
    pub cut_power: f64,
    #[serde(rename = "cutSpeed")]
    pub cut_speed: f64,
    #[serde(rename = "engravePower")]
    pub engrave_power: f64,
    #[serde(rename = "engraveSpeed")]
    pub engrave_speed: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlotterSettings {
    pub pressure: f64,
    pub speed: f64,
    pub passes: u32,
    pub blade: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Material {
    pub id: String,
    pub name: String,
    pub category: String,
    pub thickness: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cnc: Option<CncSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub laser: Option<LaserSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plotter: Option<PlotterSettings>,
}

fn get_data_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")).join("data")
}

fn get_materials_file(app: &AppHandle) -> PathBuf {
    get_data_path(app).join("materials.json")
}

fn read_materials(app: &AppHandle) -> Result<Vec<Material>, String> {
    let path = get_materials_file(app);
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_materials(app: &AppHandle, materials: &[Material]) -> Result<(), String> {
    let path = get_materials_file(app);
    let dir = path.parent().unwrap();
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(materials).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_materials(app: AppHandle) -> Result<Vec<Material>, String> {
    read_materials(&app)
}

#[tauri::command]
pub fn save_material(app: AppHandle, material: Material) -> Result<Material, String> {
    let mut materials = read_materials(&app)?;

    let mut material = material;
    if material.id.is_empty() {
        material.id = format!("material_{}", uuid::Uuid::new_v4());
    }

    if let Some(pos) = materials.iter().position(|m| m.id == material.id) {
        materials[pos] = material.clone();
    } else {
        materials.push(material.clone());
    }

    write_materials(&app, &materials)?;
    Ok(material)
}

#[tauri::command]
pub fn delete_material(app: AppHandle, id: String) -> Result<(), String> {
    let mut materials = read_materials(&app)?;
    materials.retain(|m| m.id != id);
    write_materials(&app, &materials)
}
