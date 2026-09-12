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

/// Escribe el proyecto de forma atomica: primero a un temporal hermano, luego
/// un rename sobre el destino.
///
/// El autosave pisa el .gravix cada pocos segundos. Un `fs::write` directo que
/// se corta a mitad —crash, corte de luz, disco lleno— deja el archivo
/// truncado y el proyecto se pierde entero. El rename dentro del mismo
/// directorio es atomico en Linux, macOS y Windows: o queda la version vieja
/// completa, o la nueva completa.
#[tauri::command]
pub fn save_gravix_project(path: String, data: String) -> Result<(), String> {
    use std::io::Write;

    let dest = std::path::Path::new(&path);
    let dir = dest.parent().unwrap_or_else(|| std::path::Path::new("."));

    if !dir.exists() {
        std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {dir:?}: {e}"))?;
    }

    let tmp = dir.join(format!(
        ".{}.tmp",
        dest.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "proyecto.gravix".into())
    ));

    {
        let mut file = std::fs::File::create(&tmp)
            .map_err(|e| format!("No se pudo abrir temporal: {e}"))?;
        file.write_all(data.as_bytes())
            .map_err(|e| format!("No se pudo escribir: {e}"))?;
        // Sin sync_all el rename puede quedar ordenado antes que los datos.
        file.sync_all()
            .map_err(|e| format!("No se pudo sincronizar a disco: {e}"))?;
    }

    std::fs::rename(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("No se pudo reemplazar el proyecto: {e}")
    })
}

#[tauri::command]
pub fn load_gravix_project(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Copia el proyecto a `<nombre>.bak` antes de que algo lo sobrescriba.
///
/// Se usa al abrir un .gravix que no parseo: el autosave va a pisarlo en
/// segundos y el original —posiblemente recuperable a mano— desapareceria.
/// Devuelve la ruta del respaldo.
#[tauri::command]
pub fn backup_gravix_project(path: String) -> Result<String, String> {
    let src = std::path::Path::new(&path);
    if !src.exists() {
        return Err("El proyecto no existe".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let backup = src.with_extension(format!("{stamp}.bak"));
    std::fs::copy(src, &backup).map_err(|e| format!("No se pudo respaldar: {e}"))?;
    Ok(backup.to_string_lossy().to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gravix-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn guarda_y_relee() {
        let dir = tmp_dir("save");
        let path = dir.join("p.gravix").to_string_lossy().to_string();

        save_gravix_project(path.clone(), "{\"name\":\"uno\"}".into()).unwrap();
        assert_eq!(load_gravix_project(path).unwrap(), "{\"name\":\"uno\"}");
    }

    #[test]
    fn sobrescribe_sin_dejar_temporales() {
        let dir = tmp_dir("overwrite");
        let path = dir.join("p.gravix").to_string_lossy().to_string();

        save_gravix_project(path.clone(), "viejo".into()).unwrap();
        save_gravix_project(path.clone(), "nuevo".into()).unwrap();

        assert_eq!(load_gravix_project(path).unwrap(), "nuevo");
        // El .tmp del rename no debe sobrevivir: el autosave escribe seguido y
        // list_projects recorre el directorio.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "quedaron temporales: {leftovers:?}");
    }

    #[test]
    fn crea_el_directorio_si_falta() {
        let dir = tmp_dir("mkdir");
        let path = dir.join("sub/p.gravix").to_string_lossy().to_string();

        save_gravix_project(path.clone(), "x".into()).unwrap();
        assert_eq!(load_gravix_project(path).unwrap(), "x");
    }
}
