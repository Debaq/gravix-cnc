use serde::Serialize;
use serialport::SerialPort;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

// --- Types ---

#[derive(Debug, Serialize, Clone)]
pub struct PortInfo {
    pub name: String,
    pub port_type: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GrblPosition {
    pub x: String,
    pub y: String,
    pub z: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GrblStatus {
    pub state: String,
    pub mpos: GrblPosition,
    pub wpos: GrblPosition,
}

#[derive(Debug, Serialize, Clone)]
pub struct GrblData {
    pub line: String,
    pub data_type: String, // "ok", "error", "alarm", "msg", "startup", "status", "unknown"
}

#[derive(Debug, Serialize, Clone)]
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
}

impl SerialState {
    pub fn new() -> Self {
        Self {
            port: Mutex::new(None),
            reader_running: Arc::new(AtomicBool::new(false)),
            sending: Arc::new(AtomicBool::new(false)),
            cancel_send: Arc::new(AtomicBool::new(false)),
        }
    }
}

// --- GRBL Parsing ---

fn parse_status_report(line: &str) -> Option<GrblStatus> {
    // Format: <Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|...>
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

fn classify_line(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed == "ok" {
        "ok".to_string()
    } else if trimmed.starts_with("error:") {
        "error".to_string()
    } else if trimmed.starts_with("ALARM:") {
        "alarm".to_string()
    } else if trimmed.starts_with("[MSG:") {
        "msg".to_string()
    } else if trimmed.starts_with("Grbl ") {
        "startup".to_string()
    } else if trimmed.starts_with('<') && trimmed.ends_with('>') {
        "status".to_string()
    } else {
        "unknown".to_string()
    }
}

// --- Commands ---

#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| format!("Error listando puertos: {}", e))?;

    Ok(ports
        .into_iter()
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

#[tauri::command]
pub fn serial_connect(
    app: AppHandle,
    state: State<'_, SerialState>,
    port: String,
    baud_rate: u32,
) -> Result<(), String> {
    // Check if already connected
    {
        let current = state.port.lock().map_err(|e| format!("Error de lock: {}", e))?;
        if current.is_some() {
            return Err("Ya hay un puerto conectado. Desconecte primero.".to_string());
        }
    }

    // Open serial port
    let serial_port = serialport::new(&port, baud_rate)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Error abriendo puerto {}: {}", port, e))?;

    // Clone for the reader thread
    let reader_port = serial_port
        .try_clone()
        .map_err(|e| format!("Error clonando puerto: {}", e))?;

    // Store the port
    {
        let mut current = state.port.lock().map_err(|e| format!("Error de lock: {}", e))?;
        *current = Some(serial_port);
    }

    // Start reader thread
    let reader_running = Arc::clone(&state.reader_running);
    reader_running.store(true, Ordering::SeqCst);

    let app_clone = app.clone();
    let port_name = port.clone();

    std::thread::spawn(move || {
        let mut reader = BufReader::new(reader_port);
        let mut line_buf = String::new();

        while reader_running.load(Ordering::SeqCst) {
            line_buf.clear();
            match reader.read_line(&mut line_buf) {
                Ok(0) => {
                    // EOF - port closed
                    break;
                }
                Ok(_) => {
                    let line = line_buf.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }

                    let data_type = classify_line(&line);

                    // Emit raw data event
                    let _ = app_clone.emit(
                        "serial:data",
                        GrblData {
                            line: line.clone(),
                            data_type: data_type.clone(),
                        },
                    );

                    // If it's a status report, parse and emit structured data
                    if data_type == "status" {
                        if let Some(status) = parse_status_report(&line) {
                            let _ = app_clone.emit("serial:status", status);
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    // Normal timeout, continue reading
                    continue;
                }
                Err(e) => {
                    // Unexpected error (USB disconnected, etc.)
                    let _ = app_clone.emit(
                        "serial:data",
                        GrblData {
                            line: format!("Error de lectura: {}", e),
                            data_type: "error".to_string(),
                        },
                    );
                    break;
                }
            }
        }

        // Notify disconnection
        let _ = app_clone.emit("serial:disconnected", port_name);
    });

    let _ = app.emit(
        "serial:data",
        GrblData {
            line: format!("Conectado a {} @ {} baud", port, baud_rate),
            data_type: "msg".to_string(),
        },
    );

    Ok(())
}

#[tauri::command]
pub fn serial_disconnect(
    app: AppHandle,
    state: State<'_, SerialState>,
) -> Result<(), String> {
    // Stop reader thread
    state.reader_running.store(false, Ordering::SeqCst);

    // Cancel any ongoing send
    state.cancel_send.store(true, Ordering::SeqCst);

    // Close the port
    {
        let mut port = state.port.lock().map_err(|e| format!("Error de lock: {}", e))?;
        if port.is_none() {
            return Err("No hay puerto conectado.".to_string());
        }
        *port = None; // Drop closes the port
    }

    let _ = app.emit("serial:disconnected", "manual");
    Ok(())
}

#[tauri::command]
pub fn serial_send(
    state: State<'_, SerialState>,
    command: String,
) -> Result<(), String> {
    let mut port_guard = state.port.lock().map_err(|e| format!("Error de lock: {}", e))?;
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
    state: State<'_, SerialState>,
    gcode: String,
) -> Result<(), String> {
    // Check if already sending
    if state.sending.load(Ordering::SeqCst) {
        return Err("Ya hay un envio de G-code en progreso.".to_string());
    }

    // Prepare lines: filter empty and comments-only lines
    let lines: Vec<String> = gcode
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('%'))
        .collect();

    let total = lines.len();
    if total == 0 {
        return Err("No hay lineas de G-code para enviar.".to_string());
    }

    // Clone the port for the sending thread
    let port_clone = {
        let port_guard = state.port.lock().map_err(|e| format!("Error de lock: {}", e))?;
        let port = port_guard
            .as_ref()
            .ok_or_else(|| "No hay puerto conectado.".to_string())?;
        port.try_clone()
            .map_err(|e| format!("Error clonando puerto: {}", e))?
    };

    let sending = Arc::clone(&state.sending);
    let cancel_send = Arc::clone(&state.cancel_send);

    sending.store(true, Ordering::SeqCst);
    cancel_send.store(false, Ordering::SeqCst);

    let app_clone = app.clone();

    std::thread::spawn(move || {
        let mut port = port_clone;
        // Create a reader from a cloned port for reading responses
        let reader_port = match port.try_clone() {
            Ok(p) => p,
            Err(e) => {
                let _ = app_clone.emit(
                    "serial:data",
                    GrblData {
                        line: format!("Error clonando puerto para lectura: {}", e),
                        data_type: "error".to_string(),
                    },
                );
                sending.store(false, Ordering::SeqCst);
                return;
            }
        };
        let mut reader = BufReader::new(reader_port);

        for (i, line) in lines.iter().enumerate() {
            if cancel_send.load(Ordering::SeqCst) {
                let _ = app_clone.emit(
                    "serial:data",
                    GrblData {
                        line: "Envio cancelado por el usuario.".to_string(),
                        data_type: "msg".to_string(),
                    },
                );
                break;
            }

            // Send the line
            let cmd = format!("{}\r\n", line);
            if let Err(e) = port.write_all(cmd.as_bytes()) {
                let _ = app_clone.emit(
                    "serial:data",
                    GrblData {
                        line: format!("Error enviando linea {}: {}", i + 1, e),
                        data_type: "error".to_string(),
                    },
                );
                break;
            }
            let _ = port.flush();

            // Wait for "ok" or "error" from GRBL
            let mut response_buf = String::new();
            loop {
                if cancel_send.load(Ordering::SeqCst) {
                    break;
                }

                response_buf.clear();
                match reader.read_line(&mut response_buf) {
                    Ok(0) => {
                        // EOF
                        break;
                    }
                    Ok(_) => {
                        let resp = response_buf.trim();
                        if resp.is_empty() {
                            continue;
                        }
                        if resp == "ok" || resp.starts_with("error:") {
                            break;
                        }
                        // Other responses (status reports, etc.) - just continue waiting
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        continue;
                    }
                    Err(e) => {
                        let _ = app_clone.emit(
                            "serial:data",
                            GrblData {
                                line: format!("Error leyendo respuesta: {}", e),
                                data_type: "error".to_string(),
                            },
                        );
                        cancel_send.store(true, Ordering::SeqCst);
                        break;
                    }
                }
            }

            // Emit progress
            let current = i + 1;
            let percent = (current as f32 / total as f32) * 100.0;
            let _ = app_clone.emit(
                "serial:progress",
                SendProgress {
                    current,
                    total,
                    percent,
                },
            );
        }

        sending.store(false, Ordering::SeqCst);

        if cancel_send.load(Ordering::SeqCst) {
            let _ = app_clone.emit("serial:complete", "cancelled");
        } else {
            let _ = app_clone.emit("serial:complete", "done");
        }
    });

    Ok(())
}

#[tauri::command]
pub fn serial_cancel_send(
    state: State<'_, SerialState>,
) -> Result<(), String> {
    if !state.sending.load(Ordering::SeqCst) {
        return Err("No hay envio en progreso.".to_string());
    }
    state.cancel_send.store(true, Ordering::SeqCst);
    Ok(())
}
