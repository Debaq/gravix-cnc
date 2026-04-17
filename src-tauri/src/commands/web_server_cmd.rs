use crate::mdns;
use crate::shared_state::AppState;
use crate::web_server;
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub ips: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ServerStartResult {
    pub success: bool,
    pub port: u16,
    pub ips: Vec<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_server_status(state: State<'_, Arc<AppState>>) -> ServerStatus {
    ServerStatus {
        running: state.server_running.load(Ordering::SeqCst),
        port: state.server_port.load(Ordering::SeqCst),
        ips: web_server::get_local_ips(),
    }
}

#[tauri::command]
pub async fn start_web_server(
    state: State<'_, Arc<AppState>>,
    port: u16,
) -> Result<ServerStartResult, String> {
    if state.server_running.load(Ordering::SeqCst) {
        return Err("El servidor ya está corriendo".to_string());
    }

    if !web_server::check_port_available(port) {
        return Err(format!("El puerto {} está ocupado", port));
    }

    let state_clone = state.inner().clone();

    // Arrancar servidor en background
    tauri::async_runtime::spawn(async move {
        if let Err(e) = web_server::start_server(state_clone, port).await {
            eprintln!("Error servidor web: {}", e);
        }
    });

    // Registrar mDNS
    if let Err(e) = mdns::register_service(port, "Gravix") {
        eprintln!("Advertencia mDNS: {}", e);
    }

    // Esperar un momento para verificar que arrancó
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    if state.server_running.load(Ordering::SeqCst) {
        Ok(ServerStartResult {
            success: true,
            port,
            ips: web_server::get_local_ips(),
            error: None,
        })
    } else {
        Err(format!("No se pudo iniciar el servidor en puerto {}", port))
    }
}

#[tauri::command]
pub fn stop_web_server(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if !state.server_running.load(Ordering::SeqCst) {
        return Err("El servidor no está corriendo".to_string());
    }
    state.server_shutdown.notify_one();
    Ok(())
}

#[tauri::command]
pub fn check_port(port: u16) -> bool {
    web_server::check_port_available(port)
}

#[tauri::command]
pub fn get_local_ips() -> Vec<String> {
    web_server::get_local_ips()
}

#[tauri::command]
pub fn check_firewall(port: u16) -> Vec<String> {
    web_server::check_firewall(port)
}
