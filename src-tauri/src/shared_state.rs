use crate::commands::serial::{GrblData, GrblStatus, SendProgress, SerialState};
use crate::job_queue::JobQueue;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16};
use std::sync::Arc;
use tokio::sync::{broadcast, Notify};

/// Eventos que se emiten tanto a Tauri como a clientes WebSocket
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerEvent {
    SerialData(GrblData),
    SerialStatus(GrblStatus),
    SerialProgress(SendProgress),
    SerialComplete(String),
    SerialDisconnected(String),
}

/// Estado compartido entre Tauri y el servidor web Axum
pub struct AppState {
    pub serial: Arc<SerialState>,
    pub data_dir: PathBuf,
    pub dist_dir: PathBuf,
    pub event_tx: broadcast::Sender<ServerEvent>,
    pub job_queue: JobQueue,
    /// Servidor web activo
    pub server_running: AtomicBool,
    /// Puerto actual del servidor
    pub server_port: AtomicU16,
    /// Señal para detener el servidor
    pub server_shutdown: Notify,
}
