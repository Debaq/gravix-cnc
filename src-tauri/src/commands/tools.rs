use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tool {
    pub id: String,
    pub category: String,
    pub name: String,
    #[serde(rename = "type")]
    pub tool_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diameter: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    #[serde(rename = "feedRate", skip_serializing_if = "Option::is_none")]
    pub feed_rate: Option<f64>,
    #[serde(rename = "plungeRate", skip_serializing_if = "Option::is_none")]
    pub plunge_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pressure: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thickness: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

fn get_data_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")).join("data")
}

fn get_tools_file(app: &AppHandle) -> PathBuf {
    get_data_path(app).join("tools.json")
}

fn read_tools(app: &AppHandle) -> Result<Vec<Tool>, String> {
    let path = get_tools_file(app);
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_tools(app: &AppHandle, tools: &[Tool]) -> Result<(), String> {
    let path = get_tools_file(app);
    let dir = path.parent().unwrap();
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(tools).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_tools(app: AppHandle) -> Result<Vec<Tool>, String> {
    read_tools(&app)
}

#[tauri::command]
pub fn save_tool(app: AppHandle, tool: Tool) -> Result<Tool, String> {
    let mut tools = read_tools(&app)?;

    let mut tool = tool;
    if tool.id.is_empty() {
        tool.id = format!("tool_{}", uuid::Uuid::new_v4());
    }

    if let Some(pos) = tools.iter().position(|t| t.id == tool.id) {
        tools[pos] = tool.clone();
    } else {
        tools.push(tool.clone());
    }

    write_tools(&app, &tools)?;
    Ok(tool)
}

#[tauri::command]
pub fn delete_tool(app: AppHandle, id: String) -> Result<(), String> {
    let mut tools = read_tools(&app)?;
    tools.retain(|t| t.id != id);
    write_tools(&app, &tools)
}
