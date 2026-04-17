use crate::workspace::{load_config, save_config};
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn get_workspace(app: tauri::AppHandle) -> Option<String> {
    load_config(&app).workspace_path
}

#[tauri::command]
pub async fn pick_workspace(app: tauri::AppHandle) -> Option<String> {
    let folder = app.dialog().file().blocking_pick_folder();
    if let Some(path) = folder {
        let path_str = path.as_path().unwrap().to_string_lossy().to_string();
        let mut config = load_config(&app);
        config.recent_workspaces.retain(|p| p != &path_str);
        config.recent_workspaces.insert(0, path_str.clone());
        config.recent_workspaces.truncate(5);
        config.workspace_path = Some(path_str.clone());
        save_config(&app, &config);
        Some(path_str)
    } else {
        None
    }
}

#[tauri::command]
pub fn get_recent_workspaces(app: tauri::AppHandle) -> Vec<String> {
    load_config(&app).recent_workspaces
}

#[tauri::command]
pub fn set_workspace(app: tauri::AppHandle, path: String) -> bool {
    let p = std::path::Path::new(&path);
    if !p.exists() || !p.is_dir() {
        return false;
    }
    let mut config = load_config(&app);
    config.recent_workspaces.retain(|x| x != &path);
    config.recent_workspaces.insert(0, path.clone());
    config.recent_workspaces.truncate(5);
    config.workspace_path = Some(path);
    save_config(&app, &config);
    true
}

#[tauri::command]
pub fn list_projects(app: tauri::AppHandle) -> Vec<ProjectMeta> {
    let config = load_config(&app);
    let Some(ws) = config.workspace_path else {
        return vec![];
    };
    let dir = std::path::Path::new(&ws);
    if !dir.exists() {
        return vec![];
    }

    let mut projects = vec![];
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("gravix") {
                let meta = entry.metadata().ok();
                let modified = meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                if let Ok(raw) = std::fs::read_to_string(&path) {
                    if let Ok(header) = serde_json::from_str::<ProjectHeader>(&raw) {
                        projects.push(ProjectMeta {
                            filename: path
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string(),
                            path: path.to_string_lossy().to_string(),
                            name: header.name,
                            mode: header.mode,
                            width: header.width,
                            height: header.height,
                            modified_at: modified,
                        });
                    }
                }
            }
        }
    }
    projects.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    projects
}

#[tauri::command]
pub fn save_gravix_project(path: String, data: String) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_gravix_project(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_gravix_project(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
struct ProjectHeader {
    name: String,
    mode: String,
    #[serde(default)]
    width: f64,
    #[serde(default)]
    height: f64,
}

#[derive(Serialize)]
pub struct ProjectMeta {
    pub filename: String,
    pub path: String,
    pub name: String,
    pub mode: String,
    pub width: f64,
    pub height: f64,
    pub modified_at: u64,
}
