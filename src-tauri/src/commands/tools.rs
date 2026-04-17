use crate::json_store::{read_json, write_json};
use crate::paths::data_dir;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "lowercase")]
pub enum ToolCategory {
    Cnc,
    Laser,
    Plotter,
    Pencil,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Tool {
    pub id: String,
    pub category: ToolCategory,
    pub name: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub tool_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub diameter: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub angle: Option<f64>,
    #[serde(rename = "feedRate", skip_serializing_if = "Option::is_none")]
    #[ts(rename = "feedRate", optional)]
    pub feed_rate: Option<f64>,
    #[serde(rename = "plungeRate", skip_serializing_if = "Option::is_none")]
    #[ts(rename = "plungeRate", optional)]
    pub plunge_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rpm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pressure: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub offset: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub thickness: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notes: Option<String>,
}

// --- Funciones desacopladas de AppHandle (usadas por Tauri y Axum) ---

fn path(dir: &Path) -> std::path::PathBuf {
    dir.join("tools.json")
}

pub fn read_tools_from(dir: &Path) -> Result<Vec<Tool>, String> {
    read_json(&path(dir))
}

pub fn write_tools_to(dir: &Path, tools: &[Tool]) -> Result<(), String> {
    write_json(&path(dir), &tools.to_vec())
}

pub fn save_tool_to(dir: &Path, tool: Tool) -> Result<Tool, String> {
    let mut tools = read_tools_from(dir)?;
    let mut tool = tool;
    if tool.id.is_empty() {
        tool.id = format!("tool_{}", uuid::Uuid::new_v4());
    }
    if let Some(pos) = tools.iter().position(|t| t.id == tool.id) {
        tools[pos] = tool.clone();
    } else {
        tools.push(tool.clone());
    }
    write_tools_to(dir, &tools)?;
    Ok(tool)
}

pub fn delete_tool_from(dir: &Path, id: &str) -> Result<(), String> {
    let mut tools = read_tools_from(dir)?;
    tools.retain(|t| t.id != id);
    write_tools_to(dir, &tools)
}

// --- Comandos Tauri ---

#[tauri::command]
pub fn get_tools(app: AppHandle) -> Result<Vec<Tool>, String> {
    read_tools_from(&data_dir(&app))
}

#[tauri::command]
pub fn save_tool(app: AppHandle, tool: Tool) -> Result<Tool, String> {
    save_tool_to(&data_dir(&app), tool)
}

#[tauri::command]
pub fn delete_tool(app: AppHandle, id: String) -> Result<(), String> {
    delete_tool_from(&data_dir(&app), &id)
}
