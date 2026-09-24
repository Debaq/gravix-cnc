// Cortadoras Silhouette / Graphtec.
//
// No hablan G-code: entienden GPGL (Graphtec Plotter Graphics Language). Cada
// comando es texto ASCII terminado en ETX (0x03); los de control van con ESC
// delante (ESC EOT inicializa, ESC ENQ pide el estado).
//
// Esta capa solo transporta. El programa GPGL lo arma el frontend
// (`src/lib/gpgl.ts`) a partir de la misma geometria que usa el plotter.
//
// Tres caminos hasta el equipo, todos con el mismo protocolo:
//  - USB: endpoints bulk. En Linux el kernel engancha `usblp` y hay que
//    soltarlo; sin regla udev el usuario no tiene permiso. En Windows nusb
//    necesita el driver WinUSB (Zadig).
//  - Bluetooth clasico (RFCOMM): una vez emparejado el sistema lo expone como
//    puerto serie (COMx, /dev/rfcommN, /dev/cu.*), asi que es un stream.
//  - Bluetooth LE: servicio GATT propio de Silhouette. Se escribe en paquetes
//    de 20 bytes con confirmacion y las respuestas llegan por notificaciones.
//
// Envio: el buffer del equipo es chico. Se manda en tandas de hasta 1 KB
// cortadas en un limite de comando y despues de cada una se espera a que el
// equipo vuelva a `ready`. Estado: ESC ENQ responde "0" listo, "1" moviendose,
// "2" sin material.

use btleplug::api::{Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Manager as BleManager, Peripheral as BlePeripheral};
use futures::StreamExt;
use nusb::descriptors::TransferType;
use nusb::transfer::{Buffer, Bulk, Direction, In, Out};
use nusb::{DeviceInfo, Endpoint, MaybeFuture};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::runtime::Handle;
use ts_rs::TS;
use uuid::Uuid;

const ETX: u8 = 0x03;
const ESC: u8 = 0x1b;
const EOT: u8 = 0x04;
const ENQ: u8 = 0x05;

/// Tamaño maximo de cada tanda. Silhouette Studio usa 1 KB por defecto.
const CHUNK: usize = 1024;
/// Cuanto puede tardar el equipo en terminar una tanda (cortes largos, lentos).
const CHUNK_READY_TIMEOUT: Duration = Duration::from_secs(180);
/// Cuanto se espera a que el usuario cargue el material.
const LOAD_TIMEOUT: Duration = Duration::from_secs(120);
const IO_TIMEOUT: Duration = Duration::from_secs(10);

const VENDOR_GRAPHTEC: u16 = 0x0b4d;
const VENDOR_CAMEO5_ALPHA: u16 = 0x3844;

// Servicio GATT de las Silhouette con BLE
const BLE_SERVICE: Uuid = Uuid::from_u128(0xe2088282_4fde_42f9_bb22_6ec3c7ed8f91);
const BLE_WRITE: Uuid = Uuid::from_u128(0x6d92661d_f429_4d67_929b_28e7a9780912);
const BLE_READ: Uuid = Uuid::from_u128(0x8dcf199a_30e7_4bd4_beb6_beb57dca866c);
/// Eventos de movimiento ("1", "0"). No se mezclan con las respuestas.
const BLE_CONTROL: Uuid = Uuid::from_u128(0x61490654_b5b4_458c_a867_9e15bc1471e0);
const BLE_PACKET: usize = 20;
const BLE_SCAN_TIMEOUT: Duration = Duration::from_secs(10);

// --- Tipos exportados a TS ---

/// Familia de firmware. Decide la forma de los comandos de herramienta:
/// las Cameo 3 en adelante los llevan con el numero de portaherramientas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "lowercase")]
pub enum SilhouetteFamily {
    /// Portrait 1/2, Cameo 1/2, SD, Craft Robo
    Legacy,
    Cameo3,
    /// Cameo 4, 5, Pro, Portrait 3/4: velocidad hasta 30, aceleracion TJ
    Cameo4,
}

/// Por donde se llega a la cortadora.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SilhouetteTarget {
    /// `id` es bus:direccion; sin id se toma la primera conectada.
    Usb { id: Option<String> },
    /// Bluetooth clasico ya emparejado, visto como puerto serie.
    Serial { port: String },
    /// Id de periferico BLE tal como lo devuelve el escaneo.
    Ble { id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "camelCase")]
pub struct SilhouetteDevice {
    pub target: SilhouetteTarget,
    pub name: String,
    pub family: SilhouetteFamily,
    /// Ancho util de corte (mm). 0 si el modelo no es conocido.
    pub width_mm: f64,
    /// Largo maximo sin tapete (mm).
    pub length_mm: f64,
    /// Margenes fisicos: el cero del equipo no siempre es el borde del material.
    pub margin_left_mm: f64,
    pub margin_top_mm: f64,
    pub two_tools: bool,
    pub max_pressure: u32,
    pub max_speed: u32,
    pub known: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "lowercase")]
pub enum SilhouetteState {
    Ready,
    Moving,
    Unloaded,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "camelCase")]
pub struct SilhouetteStatus {
    pub state: SilhouetteState,
    pub firmware: Option<String>,
    /// Modelo resuelto. Por Bluetooth sale de la version de firmware.
    pub device: SilhouetteDevice,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "camelCase")]
pub struct SilhouetteBleCutter {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "camelCase")]
pub struct SilhouetteProgress {
    pub sent_bytes: u32,
    pub total_bytes: u32,
    pub percent: f64,
    /// "connecting", "waiting-media", "sending", "finishing"
    pub phase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "camelCase")]
pub struct SilhouetteResult {
    pub success: bool,
    pub cancelled: bool,
    pub message: String,
}

// --- Tabla de modelos ---

struct Model {
    vendor: u16,
    product: u16,
    name: &'static str,
    /// Como se identifica por Bluetooth (respuesta a FG o nombre anunciado),
    /// sin espacios. Vacio si el modelo no tiene Bluetooth.
    bt_name: &'static str,
    family: SilhouetteFamily,
    width_mm: f64,
    length_mm: f64,
    margin_left_mm: f64,
    margin_top_mm: f64,
    two_tools: bool,
    max_pressure: u32,
}

#[allow(clippy::too_many_arguments)]
const fn model(
    vendor: u16,
    product: u16,
    name: &'static str,
    bt_name: &'static str,
    family: SilhouetteFamily,
    width_mm: f64,
    length_mm: f64,
    two_tools: bool,
) -> Model {
    Model {
        vendor,
        product,
        name,
        bt_name,
        family,
        width_mm,
        length_mm,
        margin_left_mm: 0.0,
        margin_top_mm: 0.0,
        two_tools,
        max_pressure: 33,
    }
}

use SilhouetteFamily::{Cameo3, Cameo4, Legacy};

// El orden importa para Bluetooth: los nombres mas especificos van antes
// ("CAMEO5ALPHAPLUS" antes que "CAMEO5ALPHA" antes que "CAMEO5").
const MODELS: &[Model] = &[
    Model {
        max_pressure: 40,
        ..model(VENDOR_CAMEO5_ALPHA, 0x0002, "Silhouette Cameo 5 Alpha Plus", "CAMEO5ALPHAPLUS", Cameo4, 372.0, 3000.0, true)
    },
    Model {
        max_pressure: 40,
        ..model(VENDOR_CAMEO5_ALPHA, 0x0001, "Silhouette Cameo 5 Alpha", "CAMEO5ALPHA", Cameo4, 330.2, 3000.0, true)
    },
    model(VENDOR_GRAPHTEC, 0x1141, "Silhouette Cameo 5 Plus", "CAMEO5PLUS", Cameo4, 372.0, 3000.0, true),
    model(VENDOR_GRAPHTEC, 0x1140, "Silhouette Cameo 5", "CAMEO5", Cameo4, 330.2, 3000.0, true),
    model(VENDOR_GRAPHTEC, 0x1146, "Silhouette Cameo Pro MK-II", "CAMEOPROMARK2", Cameo4, 609.0, 18290.0, true),
    model(VENDOR_GRAPHTEC, 0x1138, "Silhouette Cameo 4 Plus", "CAMEO4PLUS", Cameo4, 372.0, 3000.0, true),
    model(VENDOR_GRAPHTEC, 0x1139, "Silhouette Cameo 4 Pro", "CAMEO4PRO", Cameo4, 600.0, 3000.0, true),
    model(VENDOR_GRAPHTEC, 0x1137, "Silhouette Cameo 4", "CAMEO4", Cameo4, 304.8, 3000.0, true),
    model(VENDOR_GRAPHTEC, 0x112f, "Silhouette Cameo 3", "CAMEO3", Cameo3, 304.8, 3000.0, true),
    model(VENDOR_GRAPHTEC, 0x113f, "Silhouette Portrait 4", "PORTRAIT4", Cameo4, 216.0, 18290.0, false),
    model(VENDOR_GRAPHTEC, 0x113a, "Silhouette Portrait 3", "PORTRAIT3", Cameo4, 203.0, 18290.0, false),
    model(VENDOR_GRAPHTEC, 0x1132, "Silhouette Portrait 2", "PORTRAIT2", Legacy, 203.0, 3000.0, false),
    model(VENDOR_GRAPHTEC, 0x1123, "Silhouette Portrait", "", Legacy, 206.0, 3000.0, false),
    model(VENDOR_GRAPHTEC, 0x112b, "Silhouette Cameo 2", "", Legacy, 304.0, 3000.0, false),
    // La Cameo original no llega al borde izquierdo del material
    Model {
        margin_left_mm: 9.0,
        margin_top_mm: 1.0,
        ..model(VENDOR_GRAPHTEC, 0x1121, "Silhouette Cameo", "", Legacy, 304.0, 3000.0, false)
    },
    model(VENDOR_GRAPHTEC, 0x110a, "Craft Robo CC200-20", "", Legacy, 200.0, 1000.0, false),
    model(VENDOR_GRAPHTEC, 0x111a, "Craft Robo CC300-20", "", Legacy, 0.0, 0.0, false),
    model(VENDOR_GRAPHTEC, 0x111c, "Silhouette SD 1", "", Legacy, 0.0, 0.0, false),
    model(VENDOR_GRAPHTEC, 0x111d, "Silhouette SD 2", "", Legacy, 0.0, 0.0, false),
];

fn from_model(m: &Model, target: SilhouetteTarget) -> SilhouetteDevice {
    SilhouetteDevice {
        target,
        name: m.name.to_string(),
        family: m.family,
        width_mm: m.width_mm,
        length_mm: m.length_mm,
        margin_left_mm: m.margin_left_mm,
        margin_top_mm: m.margin_top_mm,
        two_tools: m.two_tools,
        max_pressure: m.max_pressure,
        max_speed: if m.family == Cameo4 { 30 } else { 10 },
        known: true,
    }
}

/// Equipo que no esta en la tabla: se ofrece con el dialecto mas
/// conservador, que es el que entienden todos.
fn unknown_device(name: String, target: SilhouetteTarget) -> SilhouetteDevice {
    SilhouetteDevice {
        target,
        name,
        family: Legacy,
        width_mm: 0.0,
        length_mm: 0.0,
        margin_left_mm: 0.0,
        margin_top_mm: 0.0,
        two_tools: false,
        max_pressure: 33,
        max_speed: 10,
        known: false,
    }
}

/// Busca el modelo por lo que el equipo dice de si mismo por Bluetooth, p.ej.
/// "CAMEO 4 PRO V1.10" o el nombre anunciado "CAMEO 4 PRO-1A2B".
fn model_by_bt_name(text: &str) -> Option<&'static Model> {
    let norm: String = text
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    MODELS
        .iter()
        .find(|m| !m.bt_name.is_empty() && norm.contains(m.bt_name))
}

fn looks_like_cutter(name: &str) -> bool {
    let up = name.to_uppercase();
    up.contains("CAMEO") || up.contains("PORTRAIT") || up.contains("CURIO") || up.contains("SILHOUETTE")
}

// --- USB ---

fn usb_id(info: &DeviceInfo) -> String {
    #[cfg(target_os = "linux")]
    let bus = info.busnum().to_string();
    #[cfg(not(target_os = "linux"))]
    let bus = info.bus_id().to_string();
    format!("{bus}:{}", info.device_address())
}

fn describe_usb(info: &DeviceInfo) -> Option<SilhouetteDevice> {
    let (vid, pid) = (info.vendor_id(), info.product_id());
    let target = SilhouetteTarget::Usb { id: Some(usb_id(info)) };
    if let Some(m) = MODELS.iter().find(|m| m.vendor == vid && m.product == pid) {
        return Some(from_model(m, target));
    }
    if vid == VENDOR_GRAPHTEC {
        let product = info.product_string().unwrap_or("Graphtec");
        return Some(unknown_device(
            format!("{product} (0x{pid:04x}, no reconocido)"),
            target,
        ));
    }
    None
}

fn usb_devices() -> Result<Vec<(DeviceInfo, SilhouetteDevice)>, String> {
    let list = nusb::list_devices()
        .wait()
        .map_err(|e| format!("No se pudo listar USB: {e}"))?;
    Ok(list
        .filter_map(|info| describe_usb(&info).map(|d| (info, d)))
        .collect())
}

fn usb_permission_hint(info: &DeviceInfo) -> String {
    if cfg!(target_os = "linux") {
        format!(
            "Sin permiso sobre el USB. Crea /etc/udev/rules.d/99-silhouette.rules con:\n\
             SUBSYSTEM==\"usb\", ATTR{{idVendor}}==\"{:04x}\", ATTR{{idProduct}}==\"{:04x}\", MODE=\"0666\"\n\
             y ejecuta: sudo udevadm control --reload && sudo udevadm trigger. Despues desenchufa y enchufa la cortadora.",
            info.vendor_id(),
            info.product_id()
        )
    } else if cfg!(target_os = "windows") {
        "Windows no deja abrir el equipo con su driver de fabrica. Instala el driver WinUSB para la cortadora con Zadig (zadig.akeo.ie).".to_string()
    } else {
        "El sistema no dejo abrir la cortadora. Cierra Silhouette Studio si esta abierto.".to_string()
    }
}

struct UsbLink {
    out: Endpoint<Bulk, Out>,
    inp: Endpoint<Bulk, In>,
}

impl UsbLink {
    fn open(info: &DeviceInfo) -> Result<Self, String> {
        let map_err = |e: nusb::Error| match e.kind() {
            nusb::ErrorKind::PermissionDenied => usb_permission_hint(info),
            nusb::ErrorKind::Busy => {
                "La cortadora esta ocupada por otro programa (¿Silhouette Studio abierto?)".to_string()
            }
            _ => format!("No se pudo abrir la cortadora por USB: {e}"),
        };

        let device = info.open().wait().map_err(map_err)?;
        // En Linux suelta a `usblp`, que engancha la interfaz como impresora
        let iface = device.detach_and_claim_interface(0).wait().map_err(map_err)?;

        // Casi todos los modelos usan 0x01/0x82, pero se buscan en el
        // descriptor por si acaso
        let desc = iface
            .descriptor()
            .ok_or_else(|| "La cortadora no expone la interfaz 0".to_string())?;
        let mut out_addr = None;
        let mut in_addr = None;
        for ep in desc.endpoints() {
            if ep.transfer_type() != TransferType::Bulk {
                continue;
            }
            match ep.direction() {
                Direction::Out if out_addr.is_none() => out_addr = Some(ep.address()),
                Direction::In if in_addr.is_none() => in_addr = Some(ep.address()),
                _ => {}
            }
        }
        let (Some(out_addr), Some(in_addr)) = (out_addr, in_addr) else {
            return Err("La cortadora no tiene endpoints bulk de entrada y salida".to_string());
        };

        Ok(Self {
            out: iface
                .endpoint::<Bulk, Out>(out_addr)
                .map_err(|e| format!("Endpoint de salida: {e}"))?,
            inp: iface
                .endpoint::<Bulk, In>(in_addr)
                .map_err(|e| format!("Endpoint de entrada: {e}"))?,
        })
    }
}

// --- Transporte comun ---

trait Transport: Send {
    fn write(&mut self, data: &[u8]) -> Result<(), String>;
    /// Lo que haya llegado dentro del plazo; `None` si no llego nada.
    fn read(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, String>;
}

impl Transport for UsbLink {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        let done = self
            .out
            .transfer_blocking(Buffer::from(data.to_vec()), IO_TIMEOUT);
        done.status
            .map_err(|e| format!("Error escribiendo a la cortadora: {e}"))?;
        if done.actual_len != data.len() {
            return Err(format!(
                "Escritura incompleta: {} de {} bytes",
                done.actual_len,
                data.len()
            ));
        }
        Ok(())
    }

    fn read(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, String> {
        let size = self.inp.max_packet_size().max(64);
        let done = self.inp.transfer_blocking(Buffer::new(size), timeout);
        match done.status {
            Ok(()) if done.actual_len > 0 => Ok(Some(done.buffer.into_vec())),
            Ok(()) | Err(nusb::transfer::TransferError::Cancelled) => Ok(None),
            Err(e) => Err(format!("Error leyendo de la cortadora: {e}")),
        }
    }
}

struct SerialLink {
    port: Box<dyn serialport::SerialPort>,
}

impl SerialLink {
    fn open(path: &str) -> Result<Self, String> {
        // RFCOMM ignora la velocidad, pero serialport exige una
        let port = serialport::new(path, 115_200)
            .timeout(IO_TIMEOUT)
            .open()
            .map_err(|e| match e.kind() {
                serialport::ErrorKind::NoDevice => format!(
                    "No se encontro {path}. Empareja la cortadora por Bluetooth primero{}",
                    if cfg!(target_os = "linux") {
                        " y enlazala con: sudo rfcomm bind 0 <MAC> 1"
                    } else {
                        ""
                    }
                ),
                _ => format!("No se pudo abrir {path}: {e}"),
            })?;
        Ok(Self { port })
    }
}

impl Transport for SerialLink {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        use std::io::Write;
        self.port
            .write_all(data)
            .and_then(|_| self.port.flush())
            .map_err(|e| format!("Error escribiendo por Bluetooth: {e}"))
    }

    fn read(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, String> {
        use std::io::Read;
        self.port
            .set_timeout(timeout)
            .map_err(|e| format!("Bluetooth: {e}"))?;
        let mut buf = [0u8; 256];
        match self.port.read(&mut buf) {
            Ok(0) => Ok(None),
            Ok(n) => Ok(Some(buf[..n].to_vec())),
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => Ok(None),
            Err(e) => Err(format!("Error leyendo por Bluetooth: {e}")),
        }
    }
}

type Inbox = Arc<(Mutex<Vec<u8>>, Condvar)>;

struct BleLink {
    rt: Handle,
    peripheral: BlePeripheral,
    write_char: Characteristic,
    inbox: Inbox,
    listener: tokio::task::JoinHandle<()>,
}

async fn ble_central() -> Result<btleplug::platform::Adapter, String> {
    let manager = BleManager::new()
        .await
        .map_err(|e| format!("Bluetooth no disponible: {e}"))?;
    manager
        .adapters()
        .await
        .map_err(|e| format!("Bluetooth no disponible: {e}"))?
        .into_iter()
        .next()
        .ok_or_else(|| "No hay adaptador Bluetooth en este equipo".to_string())
}

/// Escanea y devuelve las cortadoras visibles. Se reconocen por el servicio
/// GATT anunciado o, si el equipo no lo anuncia, por el nombre.
async fn ble_scan(duration: Duration) -> Result<Vec<(BlePeripheral, SilhouetteBleCutter)>, String> {
    let central = ble_central().await?;
    central
        .start_scan(ScanFilter::default())
        .await
        .map_err(|e| format!("No se pudo escanear Bluetooth: {e}"))?;
    tokio::time::sleep(duration).await;
    let _ = central.stop_scan().await;

    let mut found = Vec::new();
    for p in central.peripherals().await.map_err(|e| e.to_string())? {
        let Ok(Some(props)) = p.properties().await else { continue };
        let name = props
            .local_name
            .clone()
            .or(props.advertisement_name.clone())
            .unwrap_or_default();
        if props.services.contains(&BLE_SERVICE) || looks_like_cutter(&name) {
            let cutter = SilhouetteBleCutter {
                id: p.id().to_string(),
                name: if name.is_empty() { "Silhouette".to_string() } else { name },
            };
            found.push((p, cutter));
        }
    }
    Ok(found)
}

impl BleLink {
    fn open(rt: Handle, id: &str) -> Result<Self, String> {
        let id = id.to_string();
        rt.clone().block_on(async move {
            // El id solo vale mientras el sistema recuerde el periferico; si
            // no aparece entre los conocidos se escanea hasta encontrarlo
            let central = ble_central().await?;
            let mut peripheral = None;
            let deadline = Instant::now() + BLE_SCAN_TIMEOUT;
            let _ = central.start_scan(ScanFilter::default()).await;
            while peripheral.is_none() && Instant::now() < deadline {
                if let Ok(list) = central.peripherals().await {
                    peripheral = list.into_iter().find(|p| p.id().to_string() == id);
                }
                if peripheral.is_none() {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                }
            }
            let _ = central.stop_scan().await;
            let peripheral = peripheral.ok_or_else(|| {
                "No se encontro la cortadora por Bluetooth. ¿Esta encendida y cerca?".to_string()
            })?;

            peripheral
                .connect()
                .await
                .map_err(|e| format!("No se pudo conectar por Bluetooth: {e}"))?;
            peripheral
                .discover_services()
                .await
                .map_err(|e| format!("Bluetooth: {e}"))?;

            let chars = peripheral.characteristics();
            let find = |uuid: Uuid| chars.iter().find(|c| c.uuid == uuid).cloned();
            let (Some(write_char), Some(read_char), Some(control_char)) =
                (find(BLE_WRITE), find(BLE_READ), find(BLE_CONTROL))
            else {
                let _ = peripheral.disconnect().await;
                return Err("El equipo Bluetooth no expone el servicio de Silhouette".to_string());
            };

            let mut stream = peripheral
                .notifications()
                .await
                .map_err(|e| format!("Bluetooth: {e}"))?;
            peripheral
                .subscribe(&control_char)
                .await
                .map_err(|e| format!("Bluetooth: {e}"))?;
            peripheral
                .subscribe(&read_char)
                .await
                .map_err(|e| format!("Bluetooth: {e}"))?;

            let inbox: Inbox = Arc::new((Mutex::new(Vec::new()), Condvar::new()));
            let sink = inbox.clone();
            let listener = tokio::spawn(async move {
                while let Some(n) = stream.next().await {
                    // Solo las respuestas; los eventos de movimiento del canal
                    // de control confundirian a las consultas
                    if n.uuid != BLE_READ {
                        continue;
                    }
                    let (lock, cvar) = &*sink;
                    if let Ok(mut buf) = lock.lock() {
                        buf.extend_from_slice(&n.value);
                        cvar.notify_all();
                    }
                }
            });

            // Saludo: ESC EOT en las tres caracteristicas, y un segundo para
            // que el equipo se acomode
            for c in [&control_char, &read_char, &write_char] {
                peripheral
                    .write(c, &[ESC, EOT], WriteType::WithResponse)
                    .await
                    .map_err(|e| format!("Bluetooth: {e}"))?;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
            if let Ok(mut buf) = inbox.0.lock() {
                buf.clear();
            }

            Ok(Self {
                rt: Handle::current(),
                peripheral,
                write_char,
                inbox,
                listener,
            })
        })
    }
}

impl Transport for BleLink {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        let p = &self.peripheral;
        let ch = &self.write_char;
        self.rt.block_on(async {
            for packet in data.chunks(BLE_PACKET) {
                // El equipo contesta "ocupado" si el buffer se llena; se
                // reintenta con espera creciente
                let mut attempt = 0;
                loop {
                    match p.write(ch, packet, WriteType::WithResponse).await {
                        Ok(()) => break,
                        Err(_) if attempt < 3 => {
                            tokio::time::sleep(Duration::from_millis(100 << attempt)).await;
                            attempt += 1;
                        }
                        Err(e) => return Err(format!("Error escribiendo por Bluetooth: {e}")),
                    }
                }
            }
            Ok(())
        })
    }

    fn read(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, String> {
        let (lock, cvar) = &*self.inbox;
        let guard = lock.lock().map_err(|_| "Bluetooth: buffer envenenado".to_string())?;
        let (mut guard, _) = cvar
            .wait_timeout_while(guard, timeout, |buf| buf.is_empty())
            .map_err(|_| "Bluetooth: buffer envenenado".to_string())?;
        if guard.is_empty() {
            return Ok(None);
        }
        Ok(Some(std::mem::take(&mut *guard)))
    }
}

impl Drop for BleLink {
    fn drop(&mut self) {
        self.listener.abort();
        let p = self.peripheral.clone();
        let _ = self.rt.block_on(async move { p.disconnect().await });
    }
}

// --- Protocolo sobre cualquier transporte ---

struct Link {
    t: Box<dyn Transport>,
}

impl Link {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.t.write(data)
    }

    /// Descarta respuestas viejas para no confundirlas con la proxima.
    fn drain(&mut self) {
        while let Ok(Some(_)) = self.t.read(Duration::from_millis(10)) {}
    }

    /// Consulta y devuelve la respuesta sin el ETX final. Los transportes de
    /// tipo stream pueden entregar la respuesta en pedazos, asi que se junta
    /// hasta ver el ETX.
    fn query(&mut self, data: &[u8], timeout: Duration) -> Result<Option<String>, String> {
        self.drain();
        self.write(data)?;
        let deadline = Instant::now() + timeout;
        let mut resp = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Ok(None);
            }
            if let Some(chunk) = self.t.read(left)? {
                resp.extend_from_slice(&chunk);
            }
            if let Some(end) = resp.iter().position(|&b| b == ETX) {
                return Ok(Some(String::from_utf8_lossy(&resp[..end]).trim().to_string()));
            }
        }
    }

    fn state(&mut self) -> Result<SilhouetteState, String> {
        let resp = self.query(&[ESC, ENQ], Duration::from_secs(5))?;
        Ok(match resp.as_deref() {
            Some("0") => SilhouetteState::Ready,
            Some("1") => SilhouetteState::Moving,
            Some("2") => SilhouetteState::Unloaded,
            _ => SilhouetteState::Unknown,
        })
    }

    fn firmware(&mut self) -> Result<Option<String>, String> {
        self.query(b"FG\x03", Duration::from_secs(5))
    }

    /// Espera a `ready`. Mientras el equipo se mueve o no tiene material,
    /// sigue esperando hasta el plazo; `cancel` corta la espera.
    fn wait_ready(
        &mut self,
        timeout: Duration,
        poll: Duration,
        cancel: &AtomicBool,
        mut on_state: impl FnMut(SilhouetteState),
    ) -> Result<(), String> {
        let start = Instant::now();
        loop {
            let state = self.state()?;
            if state == SilhouetteState::Ready {
                return Ok(());
            }
            on_state(state);
            if cancel.load(Ordering::SeqCst) {
                return Err("cancelado".to_string());
            }
            if start.elapsed() > timeout {
                return Err(match state {
                    SilhouetteState::Unloaded => "La cortadora no tiene material cargado".to_string(),
                    SilhouetteState::Moving => {
                        "La cortadora no termino a tiempo; revisa el equipo".to_string()
                    }
                    _ => "La cortadora no responde".to_string(),
                });
            }
            std::thread::sleep(poll);
        }
    }
}

/// Abre la conexion y resuelve el modelo. Por USB el modelo sale del id de
/// producto; por Bluetooth de la respuesta a FG.
fn connect(rt: &Handle, target: &SilhouetteTarget) -> Result<(Link, SilhouetteDevice, Option<String>), String> {
    let (mut link, usb_dev) = match target {
        SilhouetteTarget::Usb { id } => {
            let mut found = usb_devices()?;
            if found.is_empty() {
                return Err("No hay ninguna cortadora Silhouette conectada por USB".to_string());
            }
            let (info, dev) = match id {
                Some(id) => found
                    .into_iter()
                    .find(|(_, d)| matches!(&d.target, SilhouetteTarget::Usb { id: Some(x) } if x == id))
                    .ok_or_else(|| "La cortadora elegida ya no esta conectada".to_string())?,
                None => found.remove(0),
            };
            (Link { t: Box::new(UsbLink::open(&info)?) }, Some(dev))
        }
        SilhouetteTarget::Serial { port } => (Link { t: Box::new(SerialLink::open(port)?) }, None),
        SilhouetteTarget::Ble { id } => (Link { t: Box::new(BleLink::open(rt.clone(), id)?) }, None),
    };

    let firmware = link.firmware()?;
    let device = match usb_dev {
        Some(d) => d,
        None => match firmware.as_deref().and_then(model_by_bt_name) {
            Some(m) => from_model(m, target.clone()),
            None => unknown_device(
                format!(
                    "Cortadora Bluetooth ({})",
                    firmware.as_deref().unwrap_or("sin respuesta de version")
                ),
                target.clone(),
            ),
        },
    };
    Ok((link, device, firmware))
}

/// Parte el programa en tandas de hasta `CHUNK` bytes sin cortar comandos.
fn split_chunks(data: &[u8]) -> Vec<&[u8]> {
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < data.len() {
        let limit = (start + CHUNK).min(data.len());
        let end = if limit == data.len() {
            limit
        } else {
            // Ultimo ETX dentro de la ventana; si un comando solo ya pasa el
            // limite (no deberia), se manda entero
            match data[start..limit].iter().rposition(|&b| b == ETX) {
                Some(p) => start + p + 1,
                None => data[start..]
                    .iter()
                    .position(|&b| b == ETX)
                    .map(|p| start + p + 1)
                    .unwrap_or(data.len()),
            }
        };
        chunks.push(&data[start..end]);
        start = end;
    }
    chunks
}

// --- Estado del envio ---

pub struct SilhouetteJobState {
    busy: AtomicBool,
    cancel: Arc<AtomicBool>,
}

impl SilhouetteJobState {
    pub fn new() -> Self {
        Self {
            busy: AtomicBool::new(false),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

// --- Comandos ---

/// Cortadoras por USB. Rapido: no abre nada, solo mira el bus.
#[tauri::command]
pub async fn silhouette_list_usb() -> Result<Vec<SilhouetteDevice>, String> {
    tokio::task::spawn_blocking(|| usb_devices().map(|v| v.into_iter().map(|(_, d)| d).collect()))
        .await
        .map_err(|e| e.to_string())?
}

/// Puertos serie candidatos para Bluetooth clasico. En Linux los enlaces
/// RFCOMM no siempre aparecen en la lista del sistema, asi que se suman.
#[tauri::command]
pub fn silhouette_list_serial() -> Vec<String> {
    let mut ports: Vec<String> = serialport::available_ports()
        .map(|v| v.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default();
    #[cfg(target_os = "linux")]
    if let Ok(dir) = std::fs::read_dir("/dev") {
        for entry in dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("rfcomm") {
                let path = format!("/dev/{name}");
                if !ports.contains(&path) {
                    ports.push(path);
                }
            }
        }
    }
    ports.retain(|p| !p.starts_with("/dev/ttyS"));
    ports
}

#[tauri::command]
pub async fn silhouette_scan_ble(seconds: Option<u64>) -> Result<Vec<SilhouetteBleCutter>, String> {
    let duration = Duration::from_secs(seconds.unwrap_or(5).clamp(2, 20));
    Ok(ble_scan(duration).await?.into_iter().map(|(_, c)| c).collect())
}

#[tauri::command]
pub async fn silhouette_status(
    target: SilhouetteTarget,
    state: State<'_, Arc<SilhouetteJobState>>,
) -> Result<SilhouetteStatus, String> {
    // Durante un envio el equipo es del hilo de envio
    if state.busy.load(Ordering::SeqCst) {
        return Err("La cortadora esta ocupada con un envio".to_string());
    }
    let rt = Handle::current();
    tokio::task::spawn_blocking(move || {
        let (mut link, device, firmware) = connect(&rt, &target)?;
        let state = link.state()?;
        Ok(SilhouetteStatus { state, firmware, device })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Manda un programa GPGL. Cada elemento de `commands` es un comando sin el
/// ETX, que se agrega aca. Vuelve apenas arranca: el avance llega por
/// `silhouette:progress` y el final por `silhouette:complete`.
#[tauri::command]
pub async fn silhouette_send(
    app: AppHandle,
    target: SilhouetteTarget,
    commands: Vec<String>,
    state: State<'_, Arc<SilhouetteJobState>>,
) -> Result<(), String> {
    if commands.is_empty() {
        return Err("No hay nada que cortar".to_string());
    }
    if commands.iter().any(|c| c.as_bytes().contains(&ETX)) {
        return Err("Comando GPGL invalido (contiene ETX)".to_string());
    }
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("Ya hay un envio a la cortadora en curso".to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);

    let job_state: Arc<SilhouetteJobState> = state.inner().clone();
    let rt = Handle::current();
    tokio::task::spawn_blocking(move || {
        let cancel = job_state.cancel.clone();
        let result = run_job(&app, &rt, &target, &commands, &cancel);
        job_state.busy.store(false, Ordering::SeqCst);
        let payload = match result {
            Ok(()) => SilhouetteResult {
                success: true,
                cancelled: false,
                message: "Corte terminado".to_string(),
            },
            Err(_) if cancel.load(Ordering::SeqCst) => SilhouetteResult {
                success: false,
                cancelled: true,
                message: "Envio cancelado".to_string(),
            },
            Err(e) => SilhouetteResult {
                success: false,
                cancelled: false,
                message: e,
            },
        };
        let _ = app.emit("silhouette:complete", payload);
    });
    Ok(())
}

#[tauri::command]
pub fn silhouette_cancel(state: State<'_, Arc<SilhouetteJobState>>) {
    state.cancel.store(true, Ordering::SeqCst);
}

fn emit_progress(app: &AppHandle, sent: usize, total: usize, phase: &str) {
    let percent = if total == 0 { 0.0 } else { sent as f64 * 100.0 / total as f64 };
    let _ = app.emit(
        "silhouette:progress",
        SilhouetteProgress {
            sent_bytes: sent as u32,
            total_bytes: total as u32,
            percent,
            phase: phase.to_string(),
        },
    );
}

fn run_job(
    app: &AppHandle,
    rt: &Handle,
    target: &SilhouetteTarget,
    commands: &[String],
    cancel: &AtomicBool,
) -> Result<(), String> {
    let mut program = Vec::with_capacity(commands.iter().map(|c| c.len() + 1).sum());
    for c in commands {
        program.extend_from_slice(c.as_bytes());
        program.push(ETX);
    }
    let total = program.len();

    emit_progress(app, 0, total, "connecting");
    let (mut link, _, _) = connect(rt, target)?;

    link.write(&[ESC, EOT])?;
    link.wait_ready(LOAD_TIMEOUT, Duration::from_millis(500), cancel, |s| {
        if s == SilhouetteState::Unloaded {
            emit_progress(app, 0, total, "waiting-media");
        }
    })?;

    let mut sent = 0;
    for chunk in split_chunks(&program) {
        if cancel.load(Ordering::SeqCst) {
            abort(&mut link);
            return Err("cancelado".to_string());
        }
        link.write(chunk)?;
        sent += chunk.len();
        emit_progress(app, sent, total, "sending");
        if let Err(e) = link.wait_ready(CHUNK_READY_TIMEOUT, Duration::from_millis(50), cancel, |_| {}) {
            if cancel.load(Ordering::SeqCst) {
                abort(&mut link);
            }
            return Err(e);
        }
    }

    emit_progress(app, total, total, "finishing");
    Ok(())
}

/// Corta en seco: reinicializar el equipo descarta lo que tenga en el buffer
/// y levanta la herramienta.
fn abort(link: &mut Link) {
    let _ = link.write(&[ESC, EOT]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_respect_command_boundaries() {
        let mut data = Vec::new();
        for i in 0..400 {
            data.extend_from_slice(format!("D{},{}", i * 10, i * 7).as_bytes());
            data.push(ETX);
        }
        let chunks = split_chunks(&data);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), data);
        for c in &chunks {
            assert!(c.len() <= CHUNK);
            assert_eq!(*c.last().unwrap(), ETX);
        }
    }

    #[test]
    fn short_program_is_one_chunk() {
        let data = b"FN0\x03TB50,0\x03".to_vec();
        assert_eq!(split_chunks(&data), vec![&data[..]]);
    }

    #[test]
    fn bluetooth_names_pick_the_most_specific_model() {
        assert_eq!(model_by_bt_name("CAMEO 4 PRO V1.10").unwrap().product, 0x1139);
        assert_eq!(model_by_bt_name("CAMEO 4 V1.10").unwrap().product, 0x1137);
        assert_eq!(model_by_bt_name("CAMEO 5 ALPHA PLUS-1234").unwrap().product, 0x0002);
        assert_eq!(model_by_bt_name("CAMEO3 V2.00").unwrap().product, 0x112f);
        assert!(model_by_bt_name("GRBL 1.1h").is_none());
    }
}
