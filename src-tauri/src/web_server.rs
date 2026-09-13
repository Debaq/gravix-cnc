use crate::commands::{
    auth, files,
    image_processing::{self, DitheringMode, ImageFilters, RasterResult},
    materials::{self, Material},
    serial::{self, PortInfo},
    tools::{self, Tool},
};
use crate::job_queue::{Job, JobStatus};
use crate::shared_state::AppState;
use axum::{
    extract::{
        connect_info::ConnectInfo,
        ws::{Message, WebSocket},
        Path as AxumPath, Request, State, WebSocketUpgrade,
    },
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

// --- Request types ---

#[derive(Deserialize)]
struct AuthRequest {
    password: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct SerialConnectRequest {
    port: String,
    baud_rate: u32,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct SerialSendRequest {
    command: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct SerialGcodeRequest {
    gcode: String,
}

#[derive(Deserialize)]
struct ProjectSaveRequest {
    path: String,
    data: serde_json::Value,
}

#[derive(Deserialize)]
struct ProjectLoadRequest {
    path: String,
}

#[derive(Deserialize)]
struct ImageProcessRequest {
    image_base64: String,
    width_mm: f64,
    height_mm: f64,
    dpi: f64,
    dithering: DitheringMode,
    threshold: u8,
    invert: bool,
    #[serde(default)]
    filters: Option<ImageFilters>,
}

#[derive(Deserialize)]
struct PixelsQuery {
    path: String,
}

// --- Error helper ---

fn app_err(e: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e)
}

// --- Tool handlers ---

async fn get_tools_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Tool>>, (StatusCode, String)> {
    tools::read_tools_from(&state.data_dir)
        .map(Json)
        .map_err(app_err)
}

async fn save_tool_handler(
    State(state): State<Arc<AppState>>,
    Json(tool): Json<Tool>,
) -> Result<Json<Tool>, (StatusCode, String)> {
    tools::save_tool_to(&state.data_dir, tool)
        .map(Json)
        .map_err(app_err)
}

async fn delete_tool_handler(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    tools::delete_tool_from(&state.data_dir, &id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(app_err)
}

// --- Material handlers ---

async fn get_materials_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Material>>, (StatusCode, String)> {
    materials::read_materials_from(&state.data_dir)
        .map(Json)
        .map_err(app_err)
}

async fn save_material_handler(
    State(state): State<Arc<AppState>>,
    Json(material): Json<Material>,
) -> Result<Json<Material>, (StatusCode, String)> {
    materials::save_material_to(&state.data_dir, material)
        .map(Json)
        .map_err(app_err)
}

async fn delete_material_handler(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    materials::delete_material_from(&state.data_dir, &id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(app_err)
}

// --- Auth handler ---

async fn auth_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AuthRequest>,
) -> Result<Json<bool>, (StatusCode, String)> {
    auth::authenticate_from(&state.data_dir, &req.password)
        .map(Json)
        .map_err(app_err)
}

// --- Project handlers ---

async fn save_project_handler(
    Json(req): Json<ProjectSaveRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    files::save_project_to(&req.path, req.data)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(app_err)
}

async fn load_project_handler(
    Json(req): Json<ProjectLoadRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    files::load_project_from(&req.path)
        .map(Json)
        .map_err(app_err)
}

// --- Image processing handlers ---

async fn process_image_handler(
    Json(req): Json<ImageProcessRequest>,
) -> Result<Json<RasterResult>, (StatusCode, String)> {
    tokio::task::spawn_blocking(move || {
        image_processing::process_image_base64(
            &req.image_base64,
            req.width_mm,
            req.height_mm,
            req.dpi,
            req.dithering,
            req.threshold,
            req.invert,
            req.filters,
        )
    })
    .await
    .map_err(|e| app_err(format!("Error en thread: {}", e)))?
    .map(Json)
    .map_err(app_err)
}

async fn read_pixels_handler(
    axum::extract::Query(q): axum::extract::Query<PixelsQuery>,
) -> Result<Vec<u8>, (StatusCode, String)> {
    std::fs::read(&q.path).map_err(|e| app_err(format!("Error leyendo pixeles: {}", e)))
}

// --- Serial handlers ---

async fn list_ports_handler() -> Result<Json<Vec<PortInfo>>, (StatusCode, String)> {
    serial::serial_list_ports_inner()
        .map(Json)
        .map_err(app_err)
}

async fn serial_status_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "connected": state.serial.is_connected(),
        "sending": state.serial.is_sending(),
        "port": state.serial.port_name(),
        "dialect": state.serial.current_dialect(),
        "status": state.serial.last_status(),
    }))
}

// --- WebSocket handler ---

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>) {
    // Enviar estado actual al conectar
    // Snapshot inicial: el cliente remoto ve posicion y estado sin esperar al
    // primer reporte periodico.
    let init = serde_json::json!({
        "type": "init",
        "payload": {
            "connected": state.serial.is_connected(),
            "sending": state.serial.is_sending(),
            "status": state.serial.last_status(),
        }
    });
    let _ = socket
        .send(Message::Text(serde_json::to_string(&init).unwrap().into()))
        .await;

    // Suscribirse al broadcast de eventos
    let mut rx = state.event_tx.subscribe();

    loop {
        tokio::select! {
            // Eventos del backend → cliente WS
            result = rx.recv() => {
                match result {
                    Ok(event) => {
                        let json = match serde_json::to_string(&event) {
                            Ok(j) => j,
                            Err(_) => continue,
                        };
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
            // Mensajes del cliente → servidor (ping/pong, futuro: comandos)
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

// --- Job queue handlers ---

async fn list_jobs_handler(State(state): State<Arc<AppState>>) -> Json<Vec<Job>> {
    Json(state.job_queue.list())
}

async fn create_job_handler(
    State(state): State<Arc<AppState>>,
    Json(job): Json<Job>,
) -> Json<Job> {
    Json(state.job_queue.add(job))
}

async fn delete_job_handler(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .job_queue
        .remove(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(app_err)
}

async fn approve_job_handler(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .job_queue
        .update_status(&id, JobStatus::Approved)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(app_err)
}

async fn cancel_job_handler(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .job_queue
        .update_status(&id, JobStatus::Cancelled)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(app_err)
}

// --- Middleware: solo local ---

async fn require_local(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if addr.ip().is_loopback() {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

// --- Endpoint de rol ---

async fn role_handler(ConnectInfo(addr): ConnectInfo<SocketAddr>) -> Json<serde_json::Value> {
    let is_local = addr.ip().is_loopback();
    Json(serde_json::json!({
        "role": if is_local { "local" } else { "remote" }
    }))
}

// --- Router ---

fn build_router(state: Arc<AppState>) -> Router {
    let dist_dir = state.dist_dir.clone();

    let serial_local = Router::new()
        .route("/ports", get(list_ports_handler))
        .route("/connect", post(|| async { StatusCode::NOT_IMPLEMENTED }))
        .route("/disconnect", post(|| async { StatusCode::NOT_IMPLEMENTED }))
        .route("/send", post(|| async { StatusCode::NOT_IMPLEMENTED }))
        .route("/gcode", post(|| async { StatusCode::NOT_IMPLEMENTED }))
        .route("/cancel", post(|| async { StatusCode::NOT_IMPLEMENTED }))
        .layer(middleware::from_fn(require_local));

    let api = Router::new()
        .route("/tools", get(get_tools_handler).post(save_tool_handler))
        .route("/tools/{id}", delete(delete_tool_handler))
        .route(
            "/materials",
            get(get_materials_handler).post(save_material_handler),
        )
        .route("/materials/{id}", delete(delete_material_handler))
        .route("/auth", post(auth_handler))
        .route("/projects/save", post(save_project_handler))
        .route("/projects/load", post(load_project_handler))
        .route("/image/process", post(process_image_handler))
        .route("/image/pixels", get(read_pixels_handler))
        .route("/serial/status", get(serial_status_handler))
        .nest("/serial", serial_local)
        .route("/jobs", get(list_jobs_handler).post(create_job_handler))
        .route("/jobs/{id}", delete(delete_job_handler))
        .route(
            "/jobs/{id}/approve",
            post(approve_job_handler).layer(middleware::from_fn(require_local)),
        )
        .route(
            "/jobs/{id}/cancel",
            post(cancel_job_handler).layer(middleware::from_fn(require_local)),
        )
        .route("/role", get(role_handler));

    Router::new()
        .nest("/api", api)
        .route("/ws", get(ws_handler))
        .fallback_service(
            ServeDir::new(&dist_dir)
                .not_found_service(ServeFile::new(dist_dir.join("index.html"))),
        )
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Arranca el servidor en el puerto dado. Retorna Ok si bindeó correctamente.
/// Se detiene cuando se notifica server_shutdown.
pub async fn start_server(state: Arc<AppState>, port: u16) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("No se pudo bindear puerto {}: {}", port, e))?;

    state.server_running.store(true, Ordering::SeqCst);
    state.server_port.store(port, Ordering::SeqCst);

    println!("Servidor web escuchando en http://0.0.0.0:{}", port);

    let app = build_router(state.clone());

    // Crear future de shutdown que sea 'static
    let shutdown_state = state.clone();
    let shutdown_future = async move {
        shutdown_state.server_shutdown.notified().await;
    };

    let result = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_future)
    .await;

    state.server_running.store(false, Ordering::SeqCst);
    state.server_port.store(0, Ordering::SeqCst);
    println!("Servidor web detenido");

    result.map_err(|e| format!("Error en servidor: {}", e))
}

/// Verifica si un puerto TCP está disponible
pub fn check_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("0.0.0.0", port)).is_ok()
}

/// Obtiene las IPs locales de la máquina (no loopback)
pub fn get_local_ips() -> Vec<String> {
    let mut ips = Vec::new();

    // Intentar con if-addrs si disponible, sino parsear ip addr
    #[cfg(unix)]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("ip").args(["addr", "show"]).output() {
            if let Ok(text) = String::from_utf8(output.stdout) {
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("inet ") && !trimmed.contains("127.0.0.1") {
                        if let Some(ip) = trimmed
                            .strip_prefix("inet ")
                            .and_then(|s| s.split('/').next())
                        {
                            ips.push(ip.to_string());
                        }
                    }
                }
            }
        }
    }

    if ips.is_empty() {
        ips.push("(no se detectaron IPs)".to_string());
    }

    ips
}

/// Verifica estado del firewall y da recomendaciones
pub fn check_firewall(port: u16) -> Vec<String> {
    let mut tips = Vec::new();

    #[cfg(unix)]
    {
        use std::process::Command;

        // Check ufw
        if let Ok(output) = Command::new("ufw").arg("status").output() {
            if let Ok(text) = String::from_utf8(output.stdout) {
                if text.contains("active") {
                    if text.contains(&port.to_string()) {
                        tips.push(format!("ufw: puerto {} ya permitido", port));
                    } else {
                        tips.push(format!(
                            "ufw activo. Ejecutar: sudo ufw allow {}/tcp",
                            port
                        ));
                    }
                } else {
                    tips.push("ufw: inactivo (OK)".to_string());
                }
            }
        }

        // Check iptables
        if tips.is_empty() {
            if let Ok(output) = Command::new("iptables").args(["-L", "-n"]).output() {
                if let Ok(text) = String::from_utf8(output.stdout) {
                    if text.contains("DROP") || text.contains("REJECT") {
                        tips.push(format!(
                            "iptables tiene reglas restrictivas. Agregar: sudo iptables -A INPUT -p tcp --dport {} -j ACCEPT",
                            port
                        ));
                    } else {
                        tips.push("iptables: sin restricciones (OK)".to_string());
                    }
                }
            }
        }

        // Check firewalld
        if let Ok(output) = Command::new("firewall-cmd").arg("--state").output() {
            if let Ok(text) = String::from_utf8(output.stdout) {
                if text.trim() == "running" {
                    tips.push(format!(
                        "firewalld activo. Ejecutar: sudo firewall-cmd --add-port={}/tcp --permanent && sudo firewall-cmd --reload",
                        port
                    ));
                }
            }
        }
    }

    if tips.is_empty() {
        tips.push("No se detectó firewall activo".to_string());
    }

    tips
}
