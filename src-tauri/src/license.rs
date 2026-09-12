use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::path::PathBuf;

const PUBLIC_KEY: &str = "-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXbySC6lzdYJ4UWW+/57eE7RvuK3i
GxzwHM+vq54MOelKlrps4auakqj0Qti1skH7ACIUerrHivAzlG2dIM6aKg==
-----END PUBLIC KEY-----";

#[derive(Debug, Serialize, Deserialize)]
pub struct LicenseClaims {
    pub email: String,
    pub order: String,
    pub product: String,
    pub version: u32,
    pub iat: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct LicenseStatus {
    pub is_valid: bool,
    pub email: Option<String>,
    pub error: Option<String>,
}

pub fn verify_license(token: &str) -> LicenseStatus {
    let key = match DecodingKey::from_ec_pem(PUBLIC_KEY.as_bytes()) {
        Ok(k) => k,
        Err(e) => return LicenseStatus {
            is_valid: false,
            email: None,
            error: Some(format!("Error de clave pública: {}", e)),
        },
    };

    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_required_spec_claims(&["email", "order", "product"]);
    validation.validate_exp = false;

    match decode::<LicenseClaims>(token, &key, &validation) {
        Ok(data) => {
            if data.claims.product != "gravix" {
                return LicenseStatus {
                    is_valid: false,
                    email: None,
                    error: Some("Licencia no es para Gravix".into()),
                };
            }
            LicenseStatus {
                is_valid: true,
                email: Some(data.claims.email),
                error: None,
            }
        }
        Err(e) => LicenseStatus {
            is_valid: false,
            email: None,
            error: Some(format!("Licencia inválida: {}", e)),
        },
    }
}

// `app_config_dir` puede fallar (HOME sin definir, perfil corrupto). Antes
// hacía `.unwrap()` y tumbaba la app entera por no poder leer un archivo
// opcional: ahora se degrada a "sin licencia".
pub fn license_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    match app.path().app_config_dir() {
        Ok(dir) => Some(dir.join("license.key")),
        Err(e) => {
            eprintln!("No se pudo resolver el directorio de configuracion: {}", e);
            None
        }
    }
}

pub fn load_saved_license(app: &tauri::AppHandle) -> Option<String> {
    let path = license_path(app)?;
    std::fs::read_to_string(path).ok()
}

pub fn save_license(app: &tauri::AppHandle, token: &str) -> Result<(), String> {
    let path = license_path(app)
        .ok_or_else(|| "No se pudo resolver el directorio de configuracion".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear el directorio de configuracion: {}", e))?;
    }
    std::fs::write(path, token)
        .map_err(|e| format!("No se pudo guardar la licencia: {}", e))
}
