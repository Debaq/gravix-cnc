use crate::json_store::read_json;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Default)]
struct PasswordData {
    hash: String,
}

pub fn authenticate_from(dir: &Path, password: &str) -> Result<bool, String> {
    let path = dir.join("password.json");
    // Sin contrasena configurada no entra nadie. Antes se creaba sola con
    // el valor "admin", que es lo mismo que no tener ninguna.
    if !path.exists() {
        return Ok(false);
    }
    let data: PasswordData = read_json(&path)?;
    bcrypt::verify(password, &data.hash).map_err(|e| e.to_string())
}
