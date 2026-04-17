use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::Path;

// Lee un JSON como T. Si el archivo no existe, retorna T::default().
pub fn read_json<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    if !path.exists() {
        return Ok(T::default());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

// Escribe T como JSON pretty-printed. Crea el directorio padre si falta.
pub fn write_json<T: Serialize>(path: &Path, data: &T) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}
