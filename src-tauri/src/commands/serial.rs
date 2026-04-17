use crate::shared_state::{AppState, ServerEvent};
use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

// --- Types (exportados a TS via ts-rs) ---

// Dialectos de protocolo soportados.
// 'grbl' cubre GRBL 1.1, GRBLHAL y FluidNC (mismo parser).
// 'marlin' usa M114 pull y respuestas echo:/Error:.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "lowercase")]
pub enum Dialect {
    #[default]
    Grbl,
    Marlin,
}

// Clasificación de cada línea leída del puerto serie.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "lowercase")]
pub enum DataKind {
    Ok,
    Error,
    Alarm,
    Msg,
    Startup,
    Status,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct PortInfo {
    pub name: String,
    pub port_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct GrblPosition {
    pub x: String,
    pub y: String,
    pub z: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct GrblStatus {
    pub state: String,
    pub mpos: GrblPosition,
    pub wpos: GrblPosition,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct GrblData {
    pub line: String,
    pub data_type: DataKind,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct SendProgress {
    pub current: usize,
    pub total: usize,
    pub percent: f32,
}

// --- State ---

pub struct SerialState {
    port: Mutex<Option<Box<dyn SerialPort + Send>>>,
    reader_running: Arc<AtomicBool>,
    sending: Arc<AtomicBool>,
    cancel_send: Arc<AtomicBool>,
    // Dialecto activo de la conexión. Se fija en serial_connect y los threads lo snapshotean.
    dialect: Mutex<Dialect>,
}

impl SerialState {
    pub fn new() -> Self {
        Self {
            port: Mutex::new(None),
            reader_running: Arc::new(AtomicBool::new(false)),
            sending: Arc::new(AtomicBool::new(false)),
            cancel_send: Arc::new(AtomicBool::new(false)),
            dialect: Mutex::new(Dialect::default()),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.port.lock().map(|p| p.is_some()).unwrap_or(false)
    }

    pub fn current_dialect(&self) -> Dialect {
        self.dialect.lock().map(|d| *d).unwrap_or_default()
    }
}

// --- Bridge: emite a Tauri + broadcast para WebSocket ---

fn broadcast(app: &AppHandle, event: ServerEvent) {
    if let Some(shared) = app.try_state::<Arc<AppState>>() {
        let _ = shared.event_tx.send(event);
    }
}

fn emit_data(app: &AppHandle, data: GrblData) {
    let _ = app.emit("serial:data", data.clone());
    broadcast(app, ServerEvent::SerialData(data));
}

fn emit_status(app: &AppHandle, status: GrblStatus) {
    let _ = app.emit("serial:status", status.clone());
    broadcast(app, ServerEvent::SerialStatus(status));
}

fn emit_progress(app: &AppHandle, progress: SendProgress) {
    let _ = app.emit("serial:progress", progress.clone());
    broadcast(app, ServerEvent::SerialProgress(progress));
}

fn emit_complete(app: &AppHandle, result: &str) {
    let _ = app.emit("serial:complete", result);
    broadcast(app, ServerEvent::SerialComplete(result.to_string()));
}

fn emit_disconnected(app: &AppHandle, reason: &str) {
    let _ = app.emit("serial:disconnected", reason);
    broadcast(app, ServerEvent::SerialDisconnected(reason.to_string()));
}

// --- Parsing por dialecto ---

fn parse_status_report(line: &str, dialect: Dialect) -> Option<GrblStatus> {
    match dialect {
        Dialect::Grbl => parse_grbl_status(line),
        Dialect::Marlin => parse_marlin_status(line),
    }
}

fn parse_grbl_status(line: &str) -> Option<GrblStatus> {
    let trimmed = line.trim_start_matches('<').trim_end_matches('>');
    let parts: Vec<&str> = trimmed.split('|').collect();

    if parts.is_empty() {
        return None;
    }

    let state = parts[0].to_string();
    let mut mpos = GrblPosition {
        x: "0.000".to_string(),
        y: "0.000".to_string(),
        z: "0.000".to_string(),
    };
    let mut wpos = GrblPosition {
        x: "0.000".to_string(),
        y: "0.000".to_string(),
        z: "0.000".to_string(),
    };

    for part in &parts[1..] {
        if let Some(coords) = part.strip_prefix("MPos:") {
            let vals: Vec<&str> = coords.split(',').collect();
            if vals.len() >= 3 {
                mpos.x = vals[0].to_string();
                mpos.y = vals[1].to_string();
                mpos.z = vals[2].to_string();
            }
        } else if let Some(coords) = part.strip_prefix("WPos:") {
            let vals: Vec<&str> = coords.split(',').collect();
            if vals.len() >= 3 {
                wpos.x = vals[0].to_string();
                wpos.y = vals[1].to_string();
                wpos.z = vals[2].to_string();
            }
        }
    }

    Some(GrblStatus { state, mpos, wpos })
}

// Marlin M114: "X:0.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0"
// Primera ocurrencia de X:/Y:/Z: es la posición lógica; "Count X/Y/Z" es pasos.
// Marlin no distingue MPos/WPos ni reporta estado en M114 → state="Idle", ambos iguales.
fn parse_marlin_status(line: &str) -> Option<GrblStatus> {
    let mut x: Option<String> = None;
    let mut y: Option<String> = None;
    let mut z: Option<String> = None;
    for token in line.split_whitespace() {
        if x.is_none() {
            if let Some(v) = token.strip_prefix("X:") {
                x = Some(v.to_string());
                continue;
            }
        }
        if y.is_none() {
            if let Some(v) = token.strip_prefix("Y:") {
                y = Some(v.to_string());
                continue;
            }
        }
        if z.is_none() {
            if let Some(v) = token.strip_prefix("Z:") {
                z = Some(v.to_string());
                continue;
            }
        }
        if x.is_some() && y.is_some() && z.is_some() {
            break;
        }
    }
    let pos = GrblPosition {
        x: x?,
        y: y?,
        z: z?,
    };
    Some(GrblStatus {
        state: "Idle".to_string(),
        mpos: pos.clone(),
        wpos: pos,
    })
}

fn classify_line(line: &str, dialect: Dialect) -> DataKind {
    let trimmed = line.trim();
    match dialect {
        Dialect::Grbl => {
            if trimmed == "ok" {
                DataKind::Ok
            } else if trimmed.starts_with("error:") {
                DataKind::Error
            } else if trimmed.starts_with("ALARM:") {
                DataKind::Alarm
            } else if trimmed.starts_with("[MSG:") {
                DataKind::Msg
            } else if trimmed.starts_with("Grbl ") {
                DataKind::Startup
            } else if trimmed.starts_with('<') && trimmed.ends_with('>') {
                DataKind::Status
            } else {
                DataKind::Unknown
            }
        }
        Dialect::Marlin => {
            if trimmed == "ok" || trimmed.starts_with("ok ") {
                DataKind::Ok
            } else if trimmed.starts_with("Error:") || trimmed.starts_with("error:") {
                DataKind::Error
            } else if trimmed.starts_with("echo:") || trimmed.starts_with("//") {
                DataKind::Msg
            } else if trimmed.starts_with("FIRMWARE_NAME") || trimmed.starts_with("start") {
                DataKind::Startup
            } else if looks_like_m114(trimmed) {
                DataKind::Status
            } else {
                DataKind::Unknown
            }
        }
    }
}

fn looks_like_m114(line: &str) -> bool {
    line.starts_with("X:") && line.contains(" Y:") && line.contains(" Z:")
}

// --- Funciones desacopladas (usadas por web_server) ---

pub fn serial_list_ports_inner() -> Result<Vec<PortInfo>, String> {
    let ports =
        serialport::available_ports().map_err(|e| format!("Error listando puertos: {}", e))?;

    Ok(ports
        .into_iter()
        .filter(|p| {
            // Linux: ocultar puertos seriales legacy /dev/ttyS* (suelen ser virtuales/no conectados)
            !p.port_name.starts_with("/dev/ttyS")
        })
        .map(|p| {
            let port_type = match &p.port_type {
                serialport::SerialPortType::UsbPort(info) => {
                    let mut desc = "USB".to_string();
                    if let Some(manufacturer) = &info.manufacturer {
                        desc = format!("{} - {}", desc, manufacturer);
                    }
                    if let Some(product) = &info.product {
                        desc = format!("{} ({})", desc, product);
                    }
                    desc
                }
                serialport::SerialPortType::BluetoothPort => "Bluetooth".to_string(),
                serialport::SerialPortType::PciPort => "PCI".to_string(),
                serialport::SerialPortType::Unknown => "Desconocido".to_string(),
            };
            PortInfo {
                name: p.port_name,
                port_type,
            }
        })
        .collect())
}

// --- Comandos Tauri ---

#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<PortInfo>, String> {
    serial_list_ports_inner()
}

#[tauri::command]
pub fn serial_connect(
    app: AppHandle,
    state: State<'_, Arc<SerialState>>,
    port: String,
    baud_rate: u32,
    dialect: Option<Dialect>,
) -> Result<(), String> {
    {
        let current = state
            .port
            .lock()
            .map_err(|e| format!("Error de lock: {}", e))?;
        if current.is_some() {
            return Err("Ya hay un puerto conectado. Desconecte primero.".to_string());
        }
    }

    let active_dialect = dialect.unwrap_or_default();
    if let Ok(mut d) = state.dialect.lock() {
        *d = active_dialect;
    }

    let serial_port = serialport::new(&port, baud_rate)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Error abriendo puerto {}: {}", port, e))?;

    let reader_port = serial_port
        .try_clone()
        .map_err(|e| format!("Error clonando puerto: {}", e))?;

    {
        let mut current = state
            .port
            .lock()
            .map_err(|e| format!("Error de lock: {}", e))?;
        *current = Some(serial_port);
    }

    let reader_running = Arc::clone(&state.reader_running);
    let sending_flag = Arc::clone(&state.sending);
    reader_running.store(true, Ordering::SeqCst);

    let app_clone = app.clone();
    let port_name = port.clone();

    std::thread::spawn(move || {
        let mut reader = BufReader::new(reader_port);
        let mut line_buf = String::new();

        while reader_running.load(Ordering::SeqCst) {
            if sending_flag.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }

            line_buf.clear();
            match reader.read_line(&mut line_buf) {
                Ok(0) => break,
                Ok(_) => {
                    let line = line_buf.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }

                    let data_type = classify_line(&line, active_dialect);

                    emit_data(
                        &app_clone,
                        GrblData {
                            line: line.clone(),
                            data_type,
                        },
                    );

                    if data_type == DataKind::Status {
                        if let Some(status) = parse_status_report(&line, active_dialect) {
                            emit_status(&app_clone, status);
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                Err(e) => {
                    emit_data(
                        &app_clone,
                        GrblData {
                            line: format!("Error de lectura: {}", e),
                            data_type: DataKind::Error,
                        },
                    );
                    break;
                }
            }
        }

        emit_disconnected(&app_clone, &port_name);
    });

    emit_data(
        &app,
        GrblData {
            line: format!("Conectado a {} @ {} baud", port, baud_rate),
            data_type: DataKind::Msg,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn serial_disconnect(app: AppHandle, state: State<'_, Arc<SerialState>>) -> Result<(), String> {
    state.reader_running.store(false, Ordering::SeqCst);
    state.cancel_send.store(true, Ordering::SeqCst);

    {
        let mut port = state
            .port
            .lock()
            .map_err(|e| format!("Error de lock: {}", e))?;
        if port.is_none() {
            return Err("No hay puerto conectado.".to_string());
        }
        *port = None;
    }

    emit_disconnected(&app, "manual");
    Ok(())
}

#[tauri::command]
pub fn serial_send(state: State<'_, Arc<SerialState>>, command: String) -> Result<(), String> {
    let mut port_guard = state
        .port
        .lock()
        .map_err(|e| format!("Error de lock: {}", e))?;
    let port = port_guard
        .as_mut()
        .ok_or_else(|| "No hay puerto conectado.".to_string())?;

    let cmd = if command.ends_with('\n') || command.ends_with("\r\n") {
        command
    } else {
        format!("{}\r\n", command)
    };

    port.write_all(cmd.as_bytes())
        .map_err(|e| format!("Error enviando comando: {}", e))?;
    port.flush()
        .map_err(|e| format!("Error en flush: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn serial_send_gcode(
    app: AppHandle,
    state: State<'_, Arc<SerialState>>,
    gcode: String,
) -> Result<(), String> {
    if state.sending.load(Ordering::SeqCst) {
        return Err("Ya hay un envio de G-code en progreso.".to_string());
    }

    let lines: Vec<String> = gcode
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('%'))
        .collect();

    let total = lines.len();
    if total == 0 {
        return Err("No hay lineas de G-code para enviar.".to_string());
    }

    let port_clone = {
        let port_guard = state
            .port
            .lock()
            .map_err(|e| format!("Error de lock: {}", e))?;
        let port = port_guard
            .as_ref()
            .ok_or_else(|| "No hay puerto conectado.".to_string())?;
        port.try_clone()
            .map_err(|e| format!("Error clonando puerto: {}", e))?
    };

    let sending = Arc::clone(&state.sending);
    let cancel_send = Arc::clone(&state.cancel_send);
    let active_dialect = state.current_dialect();

    sending.store(true, Ordering::SeqCst);
    cancel_send.store(false, Ordering::SeqCst);

    let app_clone = app.clone();

    std::thread::spawn(move || {
        let mut port = port_clone;
        let reader_port = match port.try_clone() {
            Ok(p) => p,
            Err(e) => {
                emit_data(
                    &app_clone,
                    GrblData {
                        line: format!("Error clonando puerto para lectura: {}", e),
                        data_type: DataKind::Error,
                    },
                );
                sending.store(false, Ordering::SeqCst);
                return;
            }
        };
        let mut reader = BufReader::new(reader_port);

        for (i, line) in lines.iter().enumerate() {
            if cancel_send.load(Ordering::SeqCst) {
                emit_data(
                    &app_clone,
                    GrblData {
                        line: "Envio cancelado por el usuario.".to_string(),
                        data_type: DataKind::Msg,
                    },
                );
                break;
            }

            let cmd = format!("{}\r\n", line);
            if let Err(e) = port.write_all(cmd.as_bytes()) {
                emit_data(
                    &app_clone,
                    GrblData {
                        line: format!("Error enviando linea {}: {}", i + 1, e),
                        data_type: DataKind::Error,
                    },
                );
                break;
            }
            let _ = port.flush();

            let mut response_buf = String::new();
            loop {
                if cancel_send.load(Ordering::SeqCst) {
                    break;
                }

                response_buf.clear();
                match reader.read_line(&mut response_buf) {
                    Ok(0) => break,
                    Ok(_) => {
                        let resp = response_buf.trim().to_string();
                        if resp.is_empty() {
                            continue;
                        }

                        let resp_type = classify_line(&resp, active_dialect);
                        emit_data(
                            &app_clone,
                            GrblData {
                                line: resp.clone(),
                                data_type: resp_type,
                            },
                        );

                        if resp_type == DataKind::Status {
                            if let Some(status) = parse_status_report(&resp, active_dialect) {
                                emit_status(&app_clone, status);
                            }
                        }

                        if resp_type == DataKind::Ok || resp_type == DataKind::Error {
                            break;
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                    Err(e) => {
                        emit_data(
                            &app_clone,
                            GrblData {
                                line: format!("Error leyendo respuesta: {}", e),
                                data_type: DataKind::Error,
                            },
                        );
                        cancel_send.store(true, Ordering::SeqCst);
                        break;
                    }
                }
            }

            let current = i + 1;
            let percent = (current as f32 / total as f32) * 100.0;
            emit_progress(
                &app_clone,
                SendProgress {
                    current,
                    total,
                    percent,
                },
            );
        }

        sending.store(false, Ordering::SeqCst);

        if cancel_send.load(Ordering::SeqCst) {
            emit_complete(&app_clone, "cancelled");
        } else {
            emit_complete(&app_clone, "done");
        }
    });

    Ok(())
}

#[tauri::command]
pub fn serial_cancel_send(state: State<'_, Arc<SerialState>>) -> Result<(), String> {
    if !state.sending.load(Ordering::SeqCst) {
        return Err("No hay envio en progreso.".to_string());
    }
    state.cancel_send.store(true, Ordering::SeqCst);
    Ok(())
}
