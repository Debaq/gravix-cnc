import type { GlobalConfig, WorkArea, OriginPosition } from './types'
export type { OriginPosition } from './types'

// ============================================
// Machine Profiles — modelo multi-firmware
// ============================================

export type Firmware = 'grbl' | 'grblhal' | 'fluidnc' | 'marlin'

export type Kinematics = 'cartesian' | 'corexy' | 'delta'

export type MachineType = 'cnc' | 'laser' | 'plotter' | 'multi'

export type LineEnding = '\n' | '\r\n' | '\r'

// Qué puede hacer la máquina. Gate para generación de GCode y UI.
export interface MachineCapabilities {
  spindle: boolean          // M3/M5 con RPM
  laser: boolean            // modo láser (M3/M4 con S como potencia)
  plotter: boolean          // pluma con servo
  toolChanger: boolean      // cambio de herramienta automático
  probe: boolean            // sonda de Z (G38.x)
  homing: boolean           // soporta homing
  softLimits: boolean       // soft limits en firmware
  tlo: boolean              // Tool Length Offset (G43.1 estilo GRBL)
  coolant: boolean          // M7/M8/M9
  dwell: boolean            // G4
  arcs: boolean             // G2/G3 (algunos firmwares requieren G2/G3 → líneas)
}

// Parámetros de protocolo de comunicación serial.
export interface ProtocolConfig {
  baudRate: number
  lineEnding: LineEnding
  statusPollMs: number              // cada cuánto pedir status ('?' o M114)
  responseTimeoutMs: number         // timeout esperando respuesta a un comando
  statusCommand: string             // '?' GRBL, 'M114' Marlin, etc.
  okToken: string                   // 'ok', 'ok N', etc.
  errorPrefix: string               // 'error:' GRBL, 'Error:' Marlin
  alarmPrefix: string               // 'ALARM:' GRBL, '' Marlin
  // Regex para extraer MPos/WPos/state de línea de status.
  // GRBL: /<([A-Za-z]+)\|(?:MPos|WPos):([^|>]+)/
  // Marlin: /X:([-\d.]+).*Y:([-\d.]+).*Z:([-\d.]+)/
  statusRegex: string
  // Cómo interpretar grupos capturados: 'grbl-status' | 'marlin-m114'
  statusParser: 'grbl-status' | 'marlin-m114'
  // Flow control: solo ok por línea (simple) vs character-counting (streaming rápido)
  flowControl: 'simple' | 'character-counting'
  // Timeout handshake al conectar
  handshakeTimeoutMs: number
  // Comando identificación (para detección opcional)
  identifyCommand: string            // '$I' GRBL, 'M115' Marlin, '?' wildcard
}

// Secuencia de homing por máquina.
export interface HomingConfig {
  enabled: boolean
  command: string                    // '$H' GRBL, 'G28' Marlin, '' si no aplica
  // Secuencia opcional antes/después de home (ej: subir Z, desbloquear, etc.)
  preSequence: string[]
  postSequence: string[]
  requireBeforeJog: boolean          // bloquear jog hasta homed
}

// Generación de GCode: todo lo que varía por firmware.
export interface GcodeDialect {
  header: string[]                   // líneas al inicio de cada job
  footer: string[]                   // líneas al final
  unitsMm: string                    // 'G21' estándar
  absolutePositioning: string        // 'G90' estándar
  spindleOn: string                  // 'M3' constante
  spindleOnDynamic: string           // 'M4' para láser dinámico (GRBL 1.1+)
  spindleOff: string                 // 'M5'
  coolantOn: string                  // 'M8'
  coolantOff: string                 // 'M9'
  toolChange: string                 // 'M6 T{n}' o '' si no soporta
  pause: string                      // 'M0' o 'M25'
  dwell: string                      // 'G4 P{sec}' vs 'G4 S{sec}'
  tloMode: 'g43' | 'g43.1' | 'none'  // G43 H{n} clásico, G43.1 dinámico GRBL, none
  // Mapeo de ejes (kinematics cartesian usa X/Y/Z)
  axisMap: { x: string; y: string; z: string }
}

// Config de movimiento / límites.
export interface MotionConfig {
  maxTravel: { x: number; y: number; z: number }
  maxFeedRate: { x: number; y: number; z: number }
  defaultJogFeed: number
  // Si la máquina usa Z o solo XY (láser puro, plotter).
  hasZ: boolean
}

// Perfil de máquina completo.
export interface MachineProfile {
  id: string
  name: string
  type: MachineType
  firmware: Firmware
  kinematics: Kinematics
  isBuiltin?: boolean                // preset built-in (no borrable, sí clonable)
  capabilities: MachineCapabilities
  protocol: ProtocolConfig
  homing: HomingConfig
  motion: MotionConfig
  workArea: WorkArea
  gcodeDialect: GcodeDialect
  toolIds: string[]                  // herramientas compatibles (vacío = todas)
  notes?: string
  createdAt?: string
  updatedAt?: string
}

// Helper: crea un origen por defecto si falta.
export function defaultOrigin(): OriginPosition {
  return 'bottom-left'
}

// ============================================
// Toolpath Templates (sin cambios)
// ============================================

export interface ToolpathTemplate {
  id: string
  name: string
  operationType: string
  config: Partial<GlobalConfig>
  createdAt: string
}

const TEMPLATES_KEY = 'gravix_toolpath_templates'

export function loadToolpathTemplates(): ToolpathTemplate[] {
  try {
    const data = localStorage.getItem(TEMPLATES_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}

export function saveToolpathTemplates(templates: ToolpathTemplate[]): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates))
}

export function createTemplate(name: string, config: GlobalConfig): ToolpathTemplate {
  return {
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    operationType: config.operationType,
    config: { ...config },
    createdAt: new Date().toISOString(),
  }
}

export function exportTemplates(templates: ToolpathTemplate[]): void {
  const json = JSON.stringify(templates, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'toolpath-templates.json'; a.click()
  URL.revokeObjectURL(url)
}
