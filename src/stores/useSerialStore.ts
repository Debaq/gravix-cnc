import { create } from 'zustand'
import type { MachineState, PositionMode, MachinePosition } from '@/lib/types'
import type { GrblDiagnostics, GrblParserState } from '@/lib/grbl-diagnostics'

interface SerialState {
  // Connection
  connected: boolean
  port: string
  baudRate: number
  /** Reintento de conexion en curso tras una caida inesperada. */
  reconnecting: boolean
  reconnectAttempt: number

  // Machine state
  machineState: MachineState
  position: MachinePosition
  posMode: PositionMode

  // Jog
  jogDistance: number
  jogSpeed: number

  // Machine limits (from GRBL $$)
  maxTravel: { x: number; y: number; z: number }
  softLimitsEnabled: boolean

  // Coordinate system
  activeWorkspace: string  // G54-G59

  // Sending
  sending: boolean
  sendProgress: number

  // Laser power control
  laserPower: number
  laserTestDuration: number

  // Error tracking
  lastError: string | null
  lastErrorTime: number | null

  // Diagnostico I/O: pines, buffers, overrides y estado del parser ($G)
  diagnostics: GrblDiagnostics
  parserState: GrblParserState | null

  // Actions
  setConnected: (connected: boolean) => void
  setReconnecting: (reconnecting: boolean, attempt: number) => void
  setPort: (port: string) => void
  setBaudRate: (rate: number) => void
  setMachineState: (state: MachineState) => void
  setPosition: (pos: Partial<MachinePosition>) => void
  togglePosMode: () => void
  setJogDistance: (distance: number) => void
  setJogSpeed: (speed: number) => void
  setMaxTravel: (travel: { x: number; y: number; z: number }) => void
  setSoftLimitsEnabled: (enabled: boolean) => void
  setActiveWorkspace: (ws: string) => void
  setLaserPower: (power: number) => void
  setLastError: (error: string | null) => void
  clearLastError: () => void
  setDiagnostics: (diag: Partial<GrblDiagnostics>) => void
  setParserState: (state: GrblParserState | null) => void
  setSending: (sending: boolean) => void
  setSendProgress: (progress: number) => void
}

export const useSerialStore = create<SerialState>((set) => ({
  // Connection
  connected: false,
  port: '',
  baudRate: 115200,
  reconnecting: false,
  reconnectAttempt: 0,

  // Machine state
  machineState: 'Idle',
  position: { x: '0.000', y: '0.000', z: '0.000' },
  posMode: 'WPos',

  // Jog
  jogDistance: 1,
  jogSpeed: 1000,

  // Machine limits
  maxTravel: { x: 300, y: 300, z: 80 },
  softLimitsEnabled: true,

  // Coordinate system
  activeWorkspace: 'G54',

  // Sending
  sending: false,
  sendProgress: 0,

  // Laser power control
  laserPower: 0,
  laserTestDuration: 500,

  // Error tracking
  lastError: null,
  lastErrorTime: null,

  // Diagnostico I/O
  diagnostics: {
    limitX: false, limitY: false, limitZ: false,
    probe: false, door: false, hold: false, softReset: false, cycleStart: false,
    plannerBuffer: 0, rxBuffer: 0,
    currentFeed: 0, currentSpindle: 0,
    feedOverride: 100, rapidOverride: 100, spindleOverride: 100,
    spindleCW: false, spindleCCW: false, floodCoolant: false, mistCoolant: false,
  },
  parserState: null,

  // Actions
  setConnected: (connected) => set({ connected }),
  setReconnecting: (reconnecting, attempt) =>
    set({ reconnecting, reconnectAttempt: attempt }),
  setPort: (port) => set({ port }),
  setBaudRate: (rate) => set({ baudRate: rate }),
  setMachineState: (state) => set({ machineState: state }),
  setPosition: (pos) =>
    set((state) => ({
      position: { ...state.position, ...pos },
    })),
  togglePosMode: () =>
    set((state) => ({
      posMode: state.posMode === 'WPos' ? 'MPos' : 'WPos',
    })),
  setJogDistance: (distance) => set({ jogDistance: distance }),
  setJogSpeed: (speed) => set({ jogSpeed: speed }),
  setMaxTravel: (travel) => set({ maxTravel: travel }),
  setSoftLimitsEnabled: (enabled) => set({ softLimitsEnabled: enabled }),
  setActiveWorkspace: (ws) => set({ activeWorkspace: ws }),
  setLaserPower: (power) => set({ laserPower: Math.max(0, Math.min(1000, power)) }),
  setLastError: (error) => set({ lastError: error, lastErrorTime: error ? Date.now() : null }),
  clearLastError: () => set({ lastError: null, lastErrorTime: null }),

  setDiagnostics: (diag) => set((state) => ({
    diagnostics: { ...state.diagnostics, ...diag },
  })),
  setParserState: (parserState) => set({ parserState }),
  setSending: (sending) => set({ sending }),
  setSendProgress: (progress) => set({ sendProgress: progress }),
}))
