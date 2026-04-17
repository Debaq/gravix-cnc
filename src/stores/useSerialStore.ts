import { create } from 'zustand'
import type { MachineState, PositionMode, MachinePosition } from '@/lib/types'

interface SerialState {
  // Connection
  connected: boolean
  port: string
  baudRate: number

  // Machine state
  machineState: MachineState
  position: MachinePosition
  posMode: PositionMode
  feedOverride: number
  spindleOverride: number

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

  // Actions
  setConnected: (connected: boolean) => void
  setPort: (port: string) => void
  setBaudRate: (rate: number) => void
  setMachineState: (state: MachineState) => void
  setPosition: (pos: Partial<MachinePosition>) => void
  togglePosMode: () => void
  setFeedOverride: (value: number) => void
  setSpindleOverride: (value: number) => void
  setJogDistance: (distance: number) => void
  setJogSpeed: (speed: number) => void
  setMaxTravel: (travel: { x: number; y: number; z: number }) => void
  setSoftLimitsEnabled: (enabled: boolean) => void
  setActiveWorkspace: (ws: string) => void
  setLaserPower: (power: number) => void
  setLaserTestDuration: (ms: number) => void
  setLastError: (error: string | null) => void
  clearLastError: () => void
  setSending: (sending: boolean) => void
  setSendProgress: (progress: number) => void
}

export const useSerialStore = create<SerialState>((set) => ({
  // Connection
  connected: false,
  port: '',
  baudRate: 115200,

  // Machine state
  machineState: 'Idle',
  position: { x: '0.000', y: '0.000', z: '0.000' },
  posMode: 'WPos',
  feedOverride: 100,
  spindleOverride: 100,

  // Jog
  jogDistance: 1,
  jogSpeed: 1000,

  // Machine limits
  maxTravel: { x: 300, y: 300, z: 80 },
  softLimitsEnabled: false,

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

  // Actions
  setConnected: (connected) => set({ connected }),
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
  setFeedOverride: (value) => set({ feedOverride: value }),
  setSpindleOverride: (value) => set({ spindleOverride: value }),
  setJogDistance: (distance) => set({ jogDistance: distance }),
  setJogSpeed: (speed) => set({ jogSpeed: speed }),
  setMaxTravel: (travel) => set({ maxTravel: travel }),
  setSoftLimitsEnabled: (enabled) => set({ softLimitsEnabled: enabled }),
  setActiveWorkspace: (ws) => set({ activeWorkspace: ws }),
  setLaserPower: (power) => set({ laserPower: Math.max(0, Math.min(1000, power)) }),
  setLaserTestDuration: (ms) => set({ laserTestDuration: Math.max(100, Math.min(5000, ms)) }),
  setLastError: (error) => set({ lastError: error, lastErrorTime: error ? Date.now() : null }),
  clearLastError: () => set({ lastError: null, lastErrorTime: null }),
  setSending: (sending) => set({ sending }),
  setSendProgress: (progress) => set({ sendProgress: progress }),
}))
