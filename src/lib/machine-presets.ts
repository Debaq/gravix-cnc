import type {
  MachineProfile,
  MachineCapabilities,
  ProtocolConfig,
  HomingConfig,
  GcodeDialect,
  MotionConfig,
  Firmware,
} from './profiles'
import { FIRMWARE_LABELS } from './firmware'

// ============================================
// Presets built-in: 4 firmwares principales.
// Cada preset es plantilla editable (el usuario clona y ajusta).
// ============================================

const commonMotion = (): MotionConfig => ({
  maxTravel: { x: 300, y: 300, z: 80 },
  maxFeedRate: { x: 3000, y: 3000, z: 600 },
  defaultJogFeed: 1000,
  hasZ: true,
})

const grblCapabilities = (): MachineCapabilities => ({
  spindle: true,
  laser: true,
  plotter: true,
  toolChanger: false,
  probe: true,
  homing: true,
  softLimits: true,
  tlo: true,
  coolant: true,
  dwell: true,
  arcs: true,
})

// ---------- GRBL 1.1 ----------

const grblProtocol = (): ProtocolConfig => ({
  baudRate: 115200,
  lineEnding: '\n',
  statusPollMs: 200,
  responseTimeoutMs: 2000,
  statusCommand: '?',
  okToken: 'ok',
  errorPrefix: 'error:',
  alarmPrefix: 'ALARM:',
  statusRegex: '<([A-Za-z]+)\\|(MPos|WPos):([^|>]+)',
  statusParser: 'grbl-status',
  flowControl: 'character-counting',
  handshakeTimeoutMs: 3000,
  identifyCommand: '$I',
})

const grblHoming = (): HomingConfig => ({
  enabled: true,
  command: '$H',
  preSequence: [],
  postSequence: [],
  requireBeforeJog: false,
})

const grblDialect = (): GcodeDialect => ({
  header: ['G21', 'G90', 'G17'],
  footer: ['M5', 'G0 Z5', 'M2'],
  unitsMm: 'G21',
  absolutePositioning: 'G90',
  spindleOn: 'M3',
  spindleOnDynamic: 'M4',
  spindleOff: 'M5',
  coolantOn: 'M8',
  coolantOff: 'M9',
  toolChange: 'M6 T{n}',
  pause: 'M0',
  dwell: 'G4 P{sec}',
  tloMode: 'g43.1',
  axisMap: { x: 'X', y: 'Y', z: 'Z' },
})

// GRBLHAL y FluidNC comparten formato GRBL 1.1 en status; usan grblProtocol() tal cual.

// ---------- Marlin 2.x ----------

const marlinCapabilities = (): MachineCapabilities => ({
  spindle: true,
  laser: true,
  plotter: true,
  toolChanger: true,     // Marlin soporta M6 via script
  probe: true,
  homing: true,
  softLimits: false,     // no estándar en Marlin
  tlo: false,            // Marlin básico no soporta G43.1
  coolant: false,
  dwell: true,
  arcs: true,
})

const marlinProtocol = (): ProtocolConfig => ({
  baudRate: 250000,
  lineEnding: '\n',
  statusPollMs: 1000,              // M114 es más pesado; poll menos frecuente
  responseTimeoutMs: 5000,
  statusCommand: 'M114',
  okToken: 'ok',
  errorPrefix: 'Error:',
  alarmPrefix: '',                 // Marlin no tiene concepto de ALARM
  statusRegex: 'X:([-\\d.]+)\\s+Y:([-\\d.]+)\\s+Z:([-\\d.]+)',
  statusParser: 'marlin-m114',
  flowControl: 'simple',
  handshakeTimeoutMs: 5000,
  identifyCommand: 'M115',
})

const marlinHoming = (): HomingConfig => ({
  enabled: true,
  command: 'G28',
  preSequence: [],
  postSequence: [],
  requireBeforeJog: false,
})

const marlinDialect = (): GcodeDialect => ({
  header: ['G21', 'G90'],
  footer: ['M5', 'G0 Z5'],
  unitsMm: 'G21',
  absolutePositioning: 'G90',
  spindleOn: 'M3',
  spindleOnDynamic: 'M3',           // Marlin no distingue M3/M4 dinámico
  spindleOff: 'M5',
  coolantOn: '',
  coolantOff: '',
  toolChange: 'M6 T{n}',
  pause: 'M0',
  dwell: 'G4 S{sec}',               // Marlin usa S (segundos), no P (ms)
  tloMode: 'none',
  axisMap: { x: 'X', y: 'Y', z: 'Z' },
})

// ============================================
// Factory
// ============================================

function basePreset(
  id: string,
  name: string,
  firmware: MachineProfile['firmware'],
): MachineProfile {
  return {
    id,
    name,
    type: 'multi',
    firmware,
    kinematics: 'cartesian',
    isBuiltin: true,
    capabilities: grblCapabilities(),
    protocol: grblProtocol(),
    homing: grblHoming(),
    motion: commonMotion(),
    workArea: { width: 300, height: 300, origin: 'bottom-left' },
    gcodeDialect: grblDialect(),
    toolIds: [],
    notes: '',
  }
}

// Presets son estáticos; se cachean en module scope para evitar re-crearlos en cada load.
let PRESETS_CACHE: MachineProfile[] | null = null

function preset(fw: Firmware): MachineProfile {
  return basePreset(`preset_${fw}`, FIRMWARE_LABELS[fw], fw)
}

export function getBuiltinPresets(): MachineProfile[] {
  if (PRESETS_CACHE) return PRESETS_CACHE
  PRESETS_CACHE = [
    preset('grbl'),
    {
      ...preset('grblhal'),
      notes: 'Superset de GRBL. Soporta más settings y ejes rotatorios.',
    },
    {
      ...preset('fluidnc'),
      notes: 'ESP32. Config YAML externa. Protocolo GRBL 1.1 compatible.',
    },
    {
      ...preset('marlin'),
      capabilities: marlinCapabilities(),
      protocol: marlinProtocol(),
      homing: marlinHoming(),
      gcodeDialect: marlinDialect(),
      notes: '3D printer firmware. Sin ALARM state. Position por M114 pull.',
    },
  ]
  return PRESETS_CACHE
}

export function clonePreset(preset: MachineProfile, newName?: string): MachineProfile {
  const now = new Date().toISOString()
  return {
    ...structuredClone(preset),
    id: `machine_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: newName ?? `${preset.name} (copia)`,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  }
}
