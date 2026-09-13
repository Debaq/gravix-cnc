// Capa serial: un único thread dueño del puerto.
//
// Regla de oro: NADIE excepto `io_loop` toca el file descriptor. Los comandos
// Tauri/HTTP solo encolan peticiones por un canal mpsc. Esto elimina la carrera
// que existía cuando `serial_connect` y `serial_send_gcode` clonaban el puerto y
// leían en paralelo con dos BufReader distintos (se robaban los `ok` entre sí y
// el envío quedaba colgado esperando una respuesta que el otro thread ya había
// consumido).
//
// Puntos clave del diseño:
//  - Comandos realtime (`?` `!` `~` 0x18 0x85) se escriben CRUDOS, sin terminador
//    y con prioridad sobre la cola. GRBL los procesa fuera del buffer RX.
//  - Streaming por conteo de caracteres: se mantiene el buffer RX de GRBL lleno
//    (128 B por defecto) en lugar de enviar una línea y esperar el `ok`. Sin esto
//    el planner se vacía entre líneas y el movimiento sale a tirones.
//  - El lector acumula bytes y parte por '\n'. Nunca descarta líneas parciales.
//  - El polling de status vive dentro del loop, así que sigue corriendo durante
//    el job (antes la posición quedaba congelada todo el corte).
//  - WPos se deriva de MPos - WCO cacheado, porque GRBL 1.1 solo manda `WCO:`
//    cada N reportes.
//  - Cancelar frena de verdad: feed hold, deceleración, soft reset.

use crate::shared_state::{AppState, ServerEvent};
use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
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

// Control de flujo del streaming.
// 'simple' = una línea en vuelo (Marlin y firmwares sin buffer conocido).
// 'character-counting' = se llena el buffer RX del firmware (GRBL).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "kebab-case")]
pub enum FlowControl {
    Simple,
    #[default]
    CharacterCounting,
}

// Comandos realtime: van crudos, sin terminador, con prioridad.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "kebab-case")]
pub enum RealtimeCmd {
    StatusReport,
    FeedHold,
    CycleStart,
    SoftReset,
    JogCancel,
    SafetyDoor,
}

impl RealtimeCmd {
    fn byte(self) -> u8 {
        match self {
            RealtimeCmd::StatusReport => b'?',
            RealtimeCmd::FeedHold => b'!',
            RealtimeCmd::CycleStart => b'~',
            RealtimeCmd::SoftReset => 0x18,
            RealtimeCmd::JogCancel => 0x85,
            RealtimeCmd::SafetyDoor => 0x84,
        }
    }
}

// Parámetros de protocolo que manda el perfil de máquina en el connect.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct SerialConfig {
    // Terminador de línea para comandos normales. GRBL trata '\r' como espacio,
    // así que '\n' ahorra un byte del buffer RX.
    pub line_ending: String,
    // Cada cuánto pedir reporte de status.
    pub status_poll_ms: u32,
    // Tamaño del buffer RX del firmware (GRBL 1.1 = 128).
    pub rx_buffer_size: usize,
    pub flow_control: FlowControl,
    // Si una línea de job devuelve `error:`, abortar el job.
    pub abort_on_error: bool,
}

impl Default for SerialConfig {
    fn default() -> Self {
        Self {
            line_ending: "\n".to_string(),
            status_poll_ms: 250,
            rx_buffer_size: 128,
            flow_control: FlowControl::CharacterCounting,
            abort_on_error: true,
        }
    }
}

impl SerialConfig {
    fn sanitized(mut self) -> Self {
        if self.line_ending.is_empty() {
            self.line_ending = "\n".to_string();
        }
        self.status_poll_ms = self.status_poll_ms.clamp(50, 5000);
        self.rx_buffer_size = self.rx_buffer_size.clamp(16, 4096);
        self
    }
}

// Envolvente permitida en coordenadas de trabajo. Se valida antes de arrancar
// el job: una coordenada fuera de rango es un choque de máquina.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct AxisLimits {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
    pub min_z: f64,
    pub max_z: f64,
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
    /// Reporte crudo (`<Idle|MPos:...|Pn:XZ|Bf:15,128|Ov:100,100,100>`). La UI
    /// lo parsea para pines, buffers y overrides; el backend solo mueve texto.
    pub raw: String,
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

// --- Peticiones al thread dueño del puerto ---

enum IoRequest {
    // Línea normal: pasa por la cola con control de flujo.
    Line(String),
    // Bytes crudos con prioridad, sin terminador.
    Realtime(Vec<u8>),
    StartJob(Vec<String>),
    // Feed hold + deceleración + soft reset.
    AbortJob,
    Disconnect,
}

// --- State ---

struct Handle {
    tx: Sender<IoRequest>,
    alive: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    port_name: String,
}

pub struct SerialState {
    handle: Mutex<Option<Handle>>,
    connected: Arc<AtomicBool>,
    sending: Arc<AtomicBool>,
    dialect: Mutex<Dialect>,
    last_status: Arc<Mutex<Option<GrblStatus>>>,
}

impl SerialState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
            connected: Arc::new(AtomicBool::new(false)),
            sending: Arc::new(AtomicBool::new(false)),
            dialect: Mutex::new(Dialect::default()),
            last_status: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    pub fn is_sending(&self) -> bool {
        self.sending.load(Ordering::SeqCst)
    }

    pub fn current_dialect(&self) -> Dialect {
        self.dialect.lock().map(|d| *d).unwrap_or_default()
    }

    pub fn last_status(&self) -> Option<GrblStatus> {
        self.last_status.lock().ok().and_then(|s| s.clone())
    }

    pub fn port_name(&self) -> Option<String> {
        self.handle
            .lock()
            .ok()
            .and_then(|h| h.as_ref().map(|h| h.port_name.clone()))
    }

    fn send_request(&self, req: IoRequest) -> Result<(), String> {
        let guard = self
            .handle
            .lock()
            .map_err(|e| format!("Error de lock: {}", e))?;
        let handle = guard
            .as_ref()
            .ok_or_else(|| "No hay puerto conectado.".to_string())?;
        handle
            .tx
            .send(req)
            .map_err(|_| "El hilo serial no responde. Reconecte el puerto.".to_string())
    }
}

impl Default for SerialState {
    fn default() -> Self {
        Self::new()
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

fn emit_msg(app: &AppHandle, line: impl Into<String>) {
    emit_data(
        app,
        GrblData {
            line: line.into(),
            data_type: DataKind::Msg,
        },
    );
}

fn emit_error(app: &AppHandle, line: impl Into<String>) {
    emit_data(
        app,
        GrblData {
            line: line.into(),
            data_type: DataKind::Error,
        },
    );
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

fn parse_grbl_position(coords: &str) -> Option<GrblPosition> {
    let vals: Vec<&str> = coords.split(',').collect();
    if vals.len() < 3 {
        return None;
    }
    Some(GrblPosition {
        x: vals[0].trim().to_string(),
        y: vals[1].trim().to_string(),
        z: vals[2].trim().to_string(),
    })
}

fn sub_position(a: &GrblPosition, b: &GrblPosition) -> Option<GrblPosition> {
    let f = |s: &str| s.parse::<f64>().ok();
    Some(GrblPosition {
        x: format!("{:.3}", f(&a.x)? - f(&b.x)?),
        y: format!("{:.3}", f(&a.y)? - f(&b.y)?),
        z: format!("{:.3}", f(&a.z)? - f(&b.z)?),
    })
}

// Parsea `<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>`.
// GRBL 1.1 manda WCO solo cada N reportes, así que se cachea fuera y WPos se
// deriva de MPos - WCO cuando el reporte no trae WPos explícito.
fn parse_grbl_status(line: &str, wco_cache: &mut Option<GrblPosition>) -> Option<GrblStatus> {
    let trimmed = line.trim().trim_start_matches('<').trim_end_matches('>');
    let mut parts = trimmed.split('|');
    // GRBL reporta subestado: `Hold:0`, `Door:1`, `Alarm`. La UI solo maneja el
    // estado base, y dejar el sufijo hacía que no matcheara ningun estado conocido.
    let state = parts.next()?.split(':').next().unwrap_or("").to_string();

    let mut mpos: Option<GrblPosition> = None;
    let mut wpos: Option<GrblPosition> = None;

    for part in parts {
        if let Some(coords) = part.strip_prefix("MPos:") {
            mpos = parse_grbl_position(coords);
        } else if let Some(coords) = part.strip_prefix("WPos:") {
            wpos = parse_grbl_position(coords);
        } else if let Some(coords) = part.strip_prefix("WCO:") {
            if let Some(p) = parse_grbl_position(coords) {
                *wco_cache = Some(p);
            }
        }
    }

    // Reporte con WPos: MPos = WPos + WCO. Reporte con MPos: WPos = MPos - WCO.
    let (mpos, wpos) = match (mpos, wpos, wco_cache.as_ref()) {
        (Some(m), Some(w), _) => (m, w),
        (Some(m), None, Some(wco)) => {
            let w = sub_position(&m, wco).unwrap_or_else(|| m.clone());
            (m, w)
        }
        (Some(m), None, None) => (m.clone(), m),
        (None, Some(w), Some(wco)) => {
            let m = sub_position(&w, &negate(wco)).unwrap_or_else(|| w.clone());
            (m, w)
        }
        (None, Some(w), None) => (w.clone(), w),
        (None, None, _) => {
            let zero = GrblPosition {
                x: "0.000".to_string(),
                y: "0.000".to_string(),
                z: "0.000".to_string(),
            };
            (zero.clone(), zero)
        }
    };

    Some(GrblStatus {
        state,
        mpos,
        wpos,
        raw: line.trim().to_string(),
    })
}

fn negate(p: &GrblPosition) -> GrblPosition {
    let f = |s: &String| s.parse::<f64>().map(|v| format!("{:.3}", -v)).unwrap_or_else(|_| s.clone());
    GrblPosition {
        x: f(&p.x),
        y: f(&p.y),
        z: f(&p.z),
    }
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
        raw: line.trim().to_string(),
    })
}

fn parse_status_report(
    line: &str,
    dialect: Dialect,
    wco_cache: &mut Option<GrblPosition>,
) -> Option<GrblStatus> {
    match dialect {
        Dialect::Grbl => parse_grbl_status(line, wco_cache),
        Dialect::Marlin => parse_marlin_status(line),
    }
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
            } else if trimmed.starts_with('[') {
                DataKind::Msg
            } else if trimmed.starts_with("Grbl ") || trimmed.starts_with("GrblHAL") {
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

// --- Normalización de G-code ---

// Saca comentarios y espacio sobrante. Los comentarios son válidos para GRBL
// pero comen buffer RX, que es el recurso escaso del streaming.
fn strip_comments(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth = 0usize;
    for ch in line.chars() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth = depth.saturating_sub(1);
            }
            ';' if depth == 0 => break,
            c if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

fn normalize_gcode(gcode: &str) -> Vec<String> {
    gcode
        .lines()
        .map(strip_comments)
        .filter(|l| !l.is_empty() && !l.starts_with('%'))
        .collect()
}

// --- Validación de límites ---

fn word_value(line: &str, letter: char) -> Option<f64> {
    let bytes = line.as_bytes();
    let upper = letter.to_ascii_uppercase();
    let lower = letter.to_ascii_lowercase();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == upper as u8 || bytes[i] == lower as u8 {
            let rest = &line[i + 1..];
            let end = rest
                .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+'))
                .unwrap_or(rest.len());
            if end > 0 {
                if let Ok(v) = rest[..end].trim().parse::<f64>() {
                    return Some(v);
                }
            }
        }
        i += 1;
    }
    None
}

// Cualquier línea con palabra X/Y/Z es un destino, incluida la forma sin
// espacios (`G1X10Y10`) y la que hereda el modo modal (`X10` sola).
// Se excluyen los códigos que no mueven a coordenadas de trabajo: offsets,
// posiciones predefinidas y sondeo.
const NON_MOTION_CODES: [&str; 6] = ["G53", "G10", "G92", "G28", "G30", "G38"];

fn has_motion(upper_line: &str) -> bool {
    if NON_MOTION_CODES.iter().any(|c| upper_line.contains(c)) {
        return false;
    }
    ['X', 'Y', 'Z']
        .iter()
        .any(|c| word_value(upper_line, *c).is_some())
}

// Recorre el programa con estado modal (G90/G91, G20/G21) y verifica que ningún
// destino caiga fuera de la envolvente. Devuelve la primera violación.
fn check_bounds(lines: &[String], limits: &AxisLimits) -> Result<(), String> {
    let mut absolute = true;
    let mut inches = false;
    let mut pos = [0.0f64; 3];
    let mut known = false;

    for (idx, raw) in lines.iter().enumerate() {
        let up = raw.to_ascii_uppercase();

        for tok in up.split_whitespace() {
            match tok {
                "G90" => absolute = true,
                "G91" => absolute = false,
                "G20" => inches = true,
                "G21" => inches = false,
                _ => {}
            }
        }
        if !has_motion(&up) {
            continue;
        }

        let scale = if inches { 25.4 } else { 1.0 };
        let mut target = pos;
        let mut touched = false;

        for (i, letter) in ['X', 'Y', 'Z'].iter().enumerate() {
            if let Some(v) = word_value(&up, *letter) {
                let v = v * scale;
                target[i] = if absolute { v } else { pos[i] + v };
                touched = true;
            }
        }

        if !touched {
            continue;
        }
        // En modo relativo sin un origen conocido no se puede afirmar nada.
        if !absolute && !known {
            pos = target;
            continue;
        }
        known = true;

        let ranges = [
            (limits.min_x, limits.max_x, 'X'),
            (limits.min_y, limits.max_y, 'Y'),
            (limits.min_z, limits.max_z, 'Z'),
        ];
        for (i, (min, max, name)) in ranges.iter().enumerate() {
            if max <= min {
                continue; // eje sin límite configurado
            }
            if target[i] < min - 0.001 || target[i] > max + 0.001 {
                return Err(format!(
                    "Linea {}: {}{:.3} fuera de los limites de la maquina ({:.3} a {:.3}). G-code: {}",
                    idx + 1,
                    name,
                    target[i],
                    min,
                    max,
                    raw.trim()
                ));
            }
        }
        pos = target;
    }

    Ok(())
}

// --- Thread dueño del puerto ---

// Silencio maximo tolerado en el puerto durante un job (GRBL pollea cada
// status_poll_ms, asi que 5 s son ~20 reportes perdidos).
const RX_SILENCE_TIMEOUT: Duration = Duration::from_secs(5);

struct Inflight {
    len: usize,
    is_job: bool,
}

struct Job {
    total: usize,
    acked: usize,
    remaining: VecDeque<String>,
}

enum Deferred {
    SoftReset,
    FinishAbort,
}

struct Io {
    port: Box<dyn SerialPort + Send>,
    app: AppHandle,
    cfg: SerialConfig,
    dialect: Dialect,
    line_ending: Vec<u8>,
    acc: Vec<u8>,
    queue: VecDeque<String>,
    inflight: VecDeque<Inflight>,
    inflight_bytes: usize,
    job: Option<Job>,
    wco: Option<GrblPosition>,
    deferred: Vec<(Instant, Deferred)>,
    last_poll: Instant,
    last_progress_emit: Instant,
    pending_status_reply: bool,
    last_status: Arc<Mutex<Option<GrblStatus>>>,
    sending: Arc<AtomicBool>,
    // Ultimo byte recibido del puerto. Con GRBL los reportes de status llegan
    // cada status_poll_ms, asi que el silencio prolongado significa cable
    // desconectado o firmware colgado: mejor abortar que dejar el job en el aire.
    last_rx: Instant,
    fatal: Option<String>,
}

impl Io {
    fn write_raw(&mut self, bytes: &[u8]) {
        if let Err(e) = self.port.write_all(bytes) {
            self.fatal = Some(format!("Error de escritura: {}", e));
            return;
        }
        if let Err(e) = self.port.flush() {
            self.fatal = Some(format!("Error en flush: {}", e));
        }
    }

    fn max_inflight_bytes(&self) -> usize {
        match self.cfg.flow_control {
            FlowControl::Simple => 0, // gestionado por conteo de líneas
            FlowControl::CharacterCounting => self.cfg.rx_buffer_size,
        }
    }

    fn can_send(&self, line_len: usize) -> bool {
        match self.cfg.flow_control {
            FlowControl::Simple => self.inflight.is_empty(),
            FlowControl::CharacterCounting => {
                // Estrictamente menor: llenar el buffer hasta el ultimo byte
                // arriesga que el firmware descarte la linea entera.
                self.inflight.is_empty()
                    || self.inflight_bytes + line_len < self.max_inflight_bytes()
            }
        }
    }

    // Escribe una línea normal (con terminador) y la registra como en vuelo.
    fn push_line(&mut self, line: String, is_job: bool) {
        let mut bytes = line.into_bytes();
        bytes.extend_from_slice(&self.line_ending);
        let len = bytes.len();
        self.write_raw(&bytes);
        if self.fatal.is_some() {
            return;
        }
        self.inflight_bytes += len;
        self.inflight.push_back(Inflight { len, is_job });
    }

    // Drena cola manual y job mientras quepa en el buffer del firmware.
    fn pump(&mut self) {
        loop {
            if self.fatal.is_some() {
                return;
            }
            // La cola manual (jog, $H, macros) tiene prioridad sobre el job.
            let next = if let Some(l) = self.queue.front() {
                Some((l.clone(), false))
            } else if let Some(job) = self.job.as_mut() {
                job.remaining.front().cloned().map(|l| (l, true))
            } else {
                None
            };

            let Some((line, is_job)) = next else { return };
            if !self.can_send(line.len() + self.line_ending.len()) {
                return;
            }
            if is_job {
                if let Some(job) = self.job.as_mut() {
                    job.remaining.pop_front();
                }
            } else {
                self.queue.pop_front();
            }
            self.push_line(line, is_job);
        }
    }

    fn ack(&mut self, was_error: bool) {
        let Some(entry) = self.inflight.pop_front() else {
            // `ok` sin línea en vuelo: reporte espurio (p. ej. una línea vacía
            // enviada de más). Se ignora en lugar de desincronizar el conteo.
            return;
        };
        self.inflight_bytes = self.inflight_bytes.saturating_sub(entry.len);

        if !entry.is_job {
            return;
        }
        let Some(job) = self.job.as_mut() else { return };
        job.acked += 1;
        let done = job.acked >= job.total;
        let (current, total) = (job.acked, job.total);

        if was_error && self.cfg.abort_on_error {
            emit_error(
                &self.app,
                format!("Job abortado por error en la linea {}.", current),
            );
            self.abort_job("error");
            return;
        }

        let now = Instant::now();
        if done || now.duration_since(self.last_progress_emit) >= Duration::from_millis(50) {
            self.last_progress_emit = now;
            emit_progress(
                &self.app,
                SendProgress {
                    current,
                    total,
                    percent: (current as f32 / total.max(1) as f32) * 100.0,
                },
            );
        }

        if done {
            self.job = None;
            self.sending.store(false, Ordering::SeqCst);
            emit_complete(&self.app, "done");
        }
    }

    // Secuencia de parada real: feed hold, deceleración, soft reset.
    // Solo `!` no alcanza (GRBL sigue con los bloques ya bufferizados) y solo
    // dejar de enviar líneas tampoco (hay hasta ~30 bloques en el planner).
    fn abort_job(&mut self, reason: &str) {
        self.queue.clear();
        if let Some(job) = self.job.as_mut() {
            job.remaining.clear();
        }
        if self.dialect == Dialect::Grbl {
            self.write_raw(b"!");
            self.deferred
                .push((Instant::now() + Duration::from_millis(250), Deferred::SoftReset));
            self.deferred.push((
                Instant::now() + Duration::from_millis(400),
                Deferred::FinishAbort,
            ));
        } else {
            // Marlin: M108 rompe esperas, M410 frena, M5 apaga.
            self.queue.push_back("M108".to_string());
            self.queue.push_back("M410".to_string());
            self.queue.push_back("M5".to_string());
            self.deferred.push((
                Instant::now() + Duration::from_millis(200),
                Deferred::FinishAbort,
            ));
        }
        emit_msg(
            &self.app,
            format!("Parada solicitada ({}): feed hold + reset.", reason),
        );
    }

    fn finish_abort(&mut self) {
        self.inflight.clear();
        self.inflight_bytes = 0;
        self.queue.clear();
        self.job = None;
        self.sending.store(false, Ordering::SeqCst);
        emit_complete(&self.app, "cancelled");
    }

    // El firmware reinició: su buffer RX está vacío y perdimos el hilo del job.
    fn on_startup(&mut self) {
        self.inflight.clear();
        self.inflight_bytes = 0;
        self.wco = None;
        if self.job.take().is_some() {
            self.queue.clear();
            self.sending.store(false, Ordering::SeqCst);
            emit_error(
                &self.app,
                "El firmware se reinicio durante el job. Envio abortado.",
            );
            emit_complete(&self.app, "reset");
        }
    }

    fn on_alarm(&mut self, line: &str) {
        self.inflight.clear();
        self.inflight_bytes = 0;
        self.queue.clear();
        if self.job.take().is_some() {
            self.sending.store(false, Ordering::SeqCst);
            emit_error(&self.app, format!("Job abortado por alarma: {}", line));
            emit_complete(&self.app, "alarm");
        }
    }

    fn handle_line(&mut self, line: &str) {
        let kind = classify_line(line, self.dialect);

        if kind == DataKind::Status {
            self.pending_status_reply = false;
            if let Some(status) = parse_status_report(line, self.dialect, &mut self.wco) {
                if let Ok(mut slot) = self.last_status.lock() {
                    *slot = Some(status.clone());
                }
                emit_status(&self.app, status);
            }
            // Los reportes de status no van a la consola: a 4 Hz la inundan.
            return;
        }

        // Durante un job los `ok` son miles. Se suprimen para no fundir la UI.
        let suppress = kind == DataKind::Ok && self.job.is_some();
        if !suppress {
            emit_data(
                &self.app,
                GrblData {
                    line: line.to_string(),
                    data_type: kind,
                },
            );
        }

        match kind {
            DataKind::Ok => self.ack(false),
            DataKind::Error => self.ack(true),
            DataKind::Alarm => self.on_alarm(line),
            DataKind::Startup => self.on_startup(),
            _ => {}
        }
    }

    // Acumula bytes y parte por '\n'. Una lectura que corta una línea al medio
    // deja el resto en `acc`; nunca se descarta (el código viejo hacía
    // `line_buf.clear()` tras cada timeout y perdía el fragmento).
    fn read_available(&mut self) -> bool {
        let mut buf = [0u8; 1024];
        match self.port.read(&mut buf) {
            Ok(0) => {
                self.fatal = Some("El puerto se cerro (EOF).".to_string());
                false
            }
            Ok(n) => {
                self.last_rx = Instant::now();
                self.acc.extend_from_slice(&buf[..n]);
                while let Some(idx) = self.acc.iter().position(|&b| b == b'\n') {
                    let raw: Vec<u8> = self.acc.drain(..=idx).collect();
                    let line = String::from_utf8_lossy(&raw).trim().to_string();
                    if !line.is_empty() {
                        self.handle_line(&line);
                    }
                }
                // Guarda contra basura binaria sin terminador.
                if self.acc.len() > 8192 {
                    self.acc.clear();
                }
                true
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => false,
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => false,
            Err(e) => {
                self.fatal = Some(format!("Error de lectura: {}", e));
                false
            }
        }
    }

    // Corta el job si el puerto deja de hablar. Sin esto un cable flojo dejaba
    // el envio colgado para siempre esperando un `ok` que no iba a llegar.
    fn check_liveness(&mut self) {
        // Solo aplica donde el poll genera trafico constante. En Marlin el poll
        // se omite durante el job, asi que el silencio no prueba nada.
        if self.dialect != Dialect::Grbl || self.job.is_none() {
            return;
        }
        if Instant::now().duration_since(self.last_rx) < RX_SILENCE_TIMEOUT {
            return;
        }
        emit_error(
            &self.app,
            format!(
                "Sin respuesta del firmware por {}s. Job abortado.",
                RX_SILENCE_TIMEOUT.as_secs()
            ),
        );
        self.queue.clear();
        self.job = None;
        self.inflight.clear();
        self.inflight_bytes = 0;
        self.sending.store(false, Ordering::SeqCst);
        emit_complete(&self.app, "timeout");
        self.last_rx = Instant::now();
    }

    fn poll_status(&mut self) {
        let now = Instant::now();
        if now.duration_since(self.last_poll) < Duration::from_millis(self.cfg.status_poll_ms as u64) {
            return;
        }
        self.last_poll = now;

        match self.dialect {
            // `?` es realtime: crudo, sin terminador, no consume buffer RX.
            // Por eso el poll puede seguir corriendo durante el job.
            Dialect::Grbl => self.write_raw(b"?"),
            Dialect::Marlin => {
                // M114 es una línea normal y consume un `ok`. Durante el job se
                // omite para no robarle slots de flujo.
                if self.job.is_none() && !self.pending_status_reply {
                    self.pending_status_reply = true;
                    self.queue.push_back("M114".to_string());
                }
            }
        }
    }

    fn run_deferred(&mut self) {
        let now = Instant::now();
        let due: Vec<Deferred> = {
            let mut due = Vec::new();
            let mut keep = Vec::new();
            for (at, action) in self.deferred.drain(..) {
                if at <= now {
                    due.push(action);
                } else {
                    keep.push((at, action));
                }
            }
            self.deferred = keep;
            due
        };
        for action in due {
            match action {
                Deferred::SoftReset => {
                    self.write_raw(&[0x18]);
                    emit_msg(
                        &self.app,
                        "Soft reset enviado. Si el homing esta activo la maquina queda en Alarm: use Unlock o Home.",
                    );
                }
                Deferred::FinishAbort => self.finish_abort(),
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn io_loop(
    port: Box<dyn SerialPort + Send>,
    rx: Receiver<IoRequest>,
    app: AppHandle,
    cfg: SerialConfig,
    dialect: Dialect,
    alive: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    sending: Arc<AtomicBool>,
    last_status_slot: Arc<Mutex<Option<GrblStatus>>>,
    port_name: String,
) {
    let line_ending = cfg.line_ending.clone().into_bytes();
    let mut io = Io {
        port,
        app: app.clone(),
        cfg,
        dialect,
        line_ending,
        acc: Vec::with_capacity(1024),
        queue: VecDeque::new(),
        inflight: VecDeque::new(),
        inflight_bytes: 0,
        job: None,
        wco: None,
        deferred: Vec::new(),
        last_poll: Instant::now(),
        last_progress_emit: Instant::now() - Duration::from_secs(1),
        pending_status_reply: false,
        last_status: Arc::clone(&last_status_slot),
        sending: Arc::clone(&sending),
        last_rx: Instant::now(),
        fatal: None,
    };

    let mut reason = String::from("closed");

    'main: loop {
        if !alive.load(Ordering::SeqCst) {
            break;
        }

        // 1) Peticiones. Realtime se escribe acá mismo, antes que cualquier
        //    línea encolada: es la garantía de prioridad del stop de emergencia.
        loop {
            match rx.try_recv() {
                Ok(IoRequest::Realtime(bytes)) => io.write_raw(&bytes),
                Ok(IoRequest::Line(line)) => io.queue.push_back(line),
                Ok(IoRequest::StartJob(lines)) => {
                    let total = lines.len();
                    io.job = Some(Job {
                        total,
                        acked: 0,
                        remaining: lines.into_iter().collect(),
                    });
                    io.last_progress_emit = Instant::now() - Duration::from_secs(1);
                    io.last_rx = Instant::now();
                    io.sending.store(true, Ordering::SeqCst);
                    emit_progress(
                        &app,
                        SendProgress {
                            current: 0,
                            total,
                            percent: 0.0,
                        },
                    );
                }
                Ok(IoRequest::AbortJob) => io.abort_job("usuario"),
                Ok(IoRequest::Disconnect) => {
                    // Desconectar con un job en vuelo dejaría la máquina
                    // cortando a ciegas: primero se frena.
                    if io.job.is_some() {
                        io.abort_job("desconexion");
                        // Se drena la secuencia de parada antes de cerrar.
                        let deadline = Instant::now() + Duration::from_millis(600);
                        while Instant::now() < deadline {
                            io.run_deferred();
                            io.read_available();
                        }
                    }
                    reason = "manual".to_string();
                    break 'main;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    reason = "handle dropped".to_string();
                    break 'main;
                }
            }
            if io.fatal.is_some() {
                break;
            }
        }

        // 2) Acciones diferidas (soft reset post feed-hold).
        io.run_deferred();

        // 3) Leer todo lo disponible. El timeout del puerto marca el ritmo del
        //    loop, así que no hace falta sleep.
        io.read_available();

        // 4) Status poll: corre siempre, también durante el job.
        io.poll_status();

        // 5) Llenar el buffer del firmware.
        io.pump();

        // 6) Watchdog de silencio.
        io.check_liveness();

        if let Some(err) = io.fatal.take() {
            emit_error(&app, err.clone());
            if io.job.take().is_some() {
                emit_complete(&app, "error");
            }
            reason = err;
            break;
        }
    }

    connected.store(false, Ordering::SeqCst);
    sending.store(false, Ordering::SeqCst);
    if let Ok(mut slot) = last_status_slot.lock() {
        *slot = None;
    }
    drop(io);
    emit_disconnected(&app, &format!("{} ({})", port_name, reason));
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

// Traduce un comando escrito a mano al byte realtime correspondiente.
// Estos caracteres NO llevan terminador: el `\r\n` que agregaba el código viejo
// generaba una línea vacía extra y, con ella, un `ok` espurio que desincronizaba
// el conteo del streaming.
fn realtime_from_text(cmd: &str) -> Option<Vec<u8>> {
    let t = cmd.trim_end_matches(['\r', '\n']);
    let mut chars = t.chars();
    let first = chars.next()?;
    if chars.next().is_some() {
        return None; // los realtime son siempre un solo caracter
    }
    let code = first as u32;
    match first {
        '?' | '!' | '~' => Some(vec![first as u8]),
        // Ctrl-X = soft reset.
        '\u{18}' => Some(vec![0x18]),
        // Realtime extendido de GRBL 1.1: jog cancel (0x85), safety door (0x84)
        // y overrides de feed/rapid/spindle (0x90..0x9D).
        _ if (0x80..=0xA5).contains(&code) => Some(vec![code as u8]),
        _ => None,
    }
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
    config: Option<SerialConfig>,
) -> Result<(), String> {
    let mut guard = state
        .handle
        .lock()
        .map_err(|e| format!("Error de lock: {}", e))?;
    if guard.is_some() {
        return Err("Ya hay un puerto conectado. Desconecte primero.".to_string());
    }

    let active_dialect = dialect.unwrap_or_default();
    let cfg = config.unwrap_or_default().sanitized();

    if let Ok(mut d) = state.dialect.lock() {
        *d = active_dialect;
    }

    // Timeout corto: marca el ritmo del loop de I/O sin quemar CPU.
    let serial_port = serialport::new(&port, baud_rate)
        .timeout(Duration::from_millis(2))
        .open()
        .map_err(|e| format!("Error abriendo puerto {}: {}", port, e))?;

    let (tx, rx) = mpsc::channel::<IoRequest>();
    let alive = Arc::new(AtomicBool::new(true));

    let thread_alive = Arc::clone(&alive);
    let connected = Arc::clone(&state.connected);
    let sending = Arc::clone(&state.sending);
    let last_status = Arc::clone(&state.last_status);
    let app_clone = app.clone();
    let port_name = port.clone();
    let cfg_thread = cfg.clone();

    connected.store(true, Ordering::SeqCst);
    sending.store(false, Ordering::SeqCst);

    let join = std::thread::Builder::new()
        .name("gravix-serial".into())
        .spawn(move || {
            io_loop(
                serial_port,
                rx,
                app_clone,
                cfg_thread,
                active_dialect,
                thread_alive,
                connected,
                sending,
                last_status,
                port_name,
            )
        })
        .map_err(|e| format!("Error creando hilo serial: {}", e))?;

    *guard = Some(Handle {
        tx,
        alive,
        join: Some(join),
        port_name: port.clone(),
    });
    drop(guard);

    emit_msg(
        &app,
        format!("Conectado a {} @ {} baud", port, baud_rate),
    );

    Ok(())
}

#[tauri::command]
pub async fn serial_disconnect(state: State<'_, Arc<SerialState>>) -> Result<(), String> {
    let handle = {
        let mut guard = state
            .handle
            .lock()
            .map_err(|e| format!("Error de lock: {}", e))?;
        guard.take()
    };

    let Some(mut handle) = handle else {
        return Err("No hay puerto conectado.".to_string());
    };

    // Pedido ordenado primero: el loop frena la maquina si hay un job en vuelo
    // antes de soltar el puerto.
    let _ = handle.tx.send(IoRequest::Disconnect);

    // Se espera a que el hilo suelte el descriptor, si no un reconnect inmediato
    // al mismo puerto falla con "device busy". En un task bloqueante para no
    // frenar el hilo principal (el loop emite eventos mientras cierra).
    let alive = Arc::clone(&handle.alive);
    let join = handle.join.take();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(join) = join else {
            alive.store(false, Ordering::SeqCst);
            return;
        };
        let deadline = Instant::now() + Duration::from_secs(3);
        while !join.is_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        alive.store(false, Ordering::SeqCst);
        let _ = join.join();
    })
    .await
    .map_err(|e| format!("Error cerrando el hilo serial: {}", e))?;

    // `handle` (y con el su Sender) sigue vivo hasta aca a proposito: soltarlo
    // antes cerraria el canal y el loop saldria sin hacer la parada segura.
    drop(handle);

    state.connected.store(false, Ordering::SeqCst);
    state.sending.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn serial_send(state: State<'_, Arc<SerialState>>, command: String) -> Result<(), String> {
    let cmd = command.trim_end_matches(['\r', '\n']).to_string();
    if cmd.is_empty() {
        // Una línea vacía provoca un `ok` extra que desincroniza el conteo.
        return Ok(());
    }
    if let Some(bytes) = realtime_from_text(&cmd) {
        return state.send_request(IoRequest::Realtime(bytes));
    }
    state.send_request(IoRequest::Line(cmd))
}

#[tauri::command]
pub fn serial_realtime(
    state: State<'_, Arc<SerialState>>,
    cmd: RealtimeCmd,
) -> Result<(), String> {
    state.send_request(IoRequest::Realtime(vec![cmd.byte()]))
}

#[tauri::command]
pub fn serial_send_gcode(
    state: State<'_, Arc<SerialState>>,
    gcode: String,
    limits: Option<AxisLimits>,
) -> Result<(), String> {
    if !state.is_connected() {
        return Err("No hay puerto conectado.".to_string());
    }
    if state.is_sending() {
        return Err("Ya hay un envio de G-code en progreso.".to_string());
    }

    let lines = normalize_gcode(&gcode);
    if lines.is_empty() {
        return Err("No hay lineas de G-code para enviar.".to_string());
    }

    // Validación de envolvente antes del primer byte: una coordenada fuera de
    // rango es un choque de máquina, no un error recuperable.
    if let Some(limits) = limits {
        check_bounds(&lines, &limits)?;
    }

    state.sending.store(true, Ordering::SeqCst);
    if let Err(e) = state.send_request(IoRequest::StartJob(lines)) {
        state.sending.store(false, Ordering::SeqCst);
        return Err(e);
    }
    Ok(())
}

// Valida un programa contra la envolvente sin enviarlo (dry run para la UI).
#[tauri::command]
pub fn serial_check_bounds(gcode: String, limits: AxisLimits) -> Result<(), String> {
    let lines = normalize_gcode(&gcode);
    check_bounds(&lines, &limits)
}

#[tauri::command]
pub fn serial_cancel_send(state: State<'_, Arc<SerialState>>) -> Result<(), String> {
    // No falla si no hay job: el botón de parada debe frenar igual.
    state.send_request(IoRequest::AbortJob)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits() -> AxisLimits {
        AxisLimits {
            min_x: 0.0,
            max_x: 300.0,
            min_y: 0.0,
            max_y: 300.0,
            min_z: -50.0,
            max_z: 10.0,
        }
    }

    #[test]
    fn strips_comments_and_keeps_code() {
        assert_eq!(strip_comments("G1 X10 ; baja"), "G1 X10");
        assert_eq!(strip_comments("G1 (rapido) X10"), "G1  X10");
        assert_eq!(strip_comments("; solo comentario"), "");
    }

    #[test]
    fn bounds_accepts_program_inside_envelope() {
        let lines = normalize_gcode("G21 G90\nG0 X10 Y10\nG1 Z-2 F100\nG1 X290 Y290");
        assert!(check_bounds(&lines, &limits()).is_ok());
    }

    #[test]
    fn bounds_rejects_overtravel() {
        let lines = normalize_gcode("G21 G90\nG0 X10 Y10\nG1 X410 Y10");
        let err = check_bounds(&lines, &limits()).unwrap_err();
        assert!(err.contains("X410"), "mensaje inesperado: {}", err);
    }

    #[test]
    fn bounds_follows_relative_mode() {
        let lines = normalize_gcode("G21 G90\nG0 X290 Y10\nG91\nG1 X50");
        assert!(check_bounds(&lines, &limits()).is_err());
    }

    #[test]
    fn bounds_converts_inches() {
        // G20 + X20in = 508 mm > 300 mm
        let lines = normalize_gcode("G20 G90\nG0 X20 Y1");
        assert!(check_bounds(&lines, &limits()).is_err());
    }

    #[test]
    fn realtime_chars_never_get_a_terminator() {
        assert_eq!(realtime_from_text("?"), Some(vec![b'?']));
        assert_eq!(realtime_from_text("!\r\n"), Some(vec![b'!']));
        assert_eq!(realtime_from_text("\u{18}"), Some(vec![0x18]));
        assert_eq!(realtime_from_text("\u{85}"), Some(vec![0x85]));
        assert_eq!(realtime_from_text("G0 X1"), None);
    }

    #[test]
    fn derives_wpos_from_cached_wco() {
        let mut wco = None;
        let first = parse_grbl_status(
            "<Idle|MPos:10.000,20.000,-5.000|FS:0,0|WCO:1.000,2.000,3.000>",
            &mut wco,
        )
        .unwrap();
        assert_eq!(first.wpos.x, "9.000");

        // Reporte posterior sin WCO: se usa el cacheado.
        let second =
            parse_grbl_status("<Run|MPos:11.000,20.000,-5.000|FS:500,0>", &mut wco).unwrap();
        assert_eq!(second.state, "Run");
        assert_eq!(second.wpos.x, "10.000");
        assert_eq!(second.wpos.y, "18.000");
    }

    #[test]
    fn strips_grbl_substate() {
        let mut wco = None;
        let s = parse_grbl_status("<Hold:0|MPos:1.000,2.000,3.000>", &mut wco).unwrap();
        assert_eq!(s.state, "Hold");
    }

    #[test]
    fn classifies_grbl_lines() {
        assert_eq!(classify_line("ok", Dialect::Grbl), DataKind::Ok);
        assert_eq!(classify_line("error:20", Dialect::Grbl), DataKind::Error);
        assert_eq!(classify_line("ALARM:1", Dialect::Grbl), DataKind::Alarm);
        assert_eq!(
            classify_line("Grbl 1.1f ['$' for help]", Dialect::Grbl),
            DataKind::Startup
        );
        assert_eq!(
            classify_line("<Idle|MPos:0.000,0.000,0.000>", Dialect::Grbl),
            DataKind::Status
        );
    }

    #[test]
    fn marlin_status_parses_m114() {
        let s = parse_marlin_status("X:1.00 Y:2.00 Z:3.00 E:0.00 Count X:80 Y:160 Z:240").unwrap();
        assert_eq!(s.mpos.x, "1.00");
        assert_eq!(s.wpos.z, "3.00");
    }
}
