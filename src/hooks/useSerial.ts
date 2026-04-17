import { useEffect, useCallback, useRef } from 'react'
import { useSerialStore } from '@/stores/useSerialStore'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useMachineStore } from '@/stores/useMachineStore'
import { isTauri, isRemote, tauriInvoke, tauriListen } from '@/lib/tauri'
import { getClientRole } from '@/lib/client-role'
import type { MachineState } from '@/lib/types'
import type { MachineProfile } from '@/lib/profiles'
import type { Dialect } from '@/lib/generated/Dialect'
import type { PortInfo } from '@/lib/generated/PortInfo'
import type { GrblStatus } from '@/lib/generated/GrblStatus'
import type { GrblData } from '@/lib/generated/GrblData'
import type { SendProgress } from '@/lib/generated/SendProgress'
import { firmwareToDialect } from '@/lib/firmware'

function getActiveMachine(): MachineProfile | null {
  return useMachineStore.getState().getActive()
}

// Genera las líneas de jog incremental según dialecto.
// GRBL: una sola línea $J=G91. Marlin: G91 / G0 / G90.
function buildJogCommands(
  dialect: Dialect,
  axes: { x?: number; y?: number; z?: number },
  feedRate: number,
): string[] {
  const axisStr = (['x', 'y', 'z'] as const)
    .filter((k) => axes[k] !== undefined)
    .map((k) => `${k.toUpperCase()}${axes[k]}`)
    .join(' ')
  if (!axisStr) return []
  if (dialect === 'marlin') {
    return ['G91', `G0 ${axisStr} F${feedRate}`, 'G90']
  }
  return [`$J=G91 ${axisStr} F${feedRate}`]
}

export function useSerial() {
  const store = useSerialStore()
  const { addConsoleLine } = useAppStore()
  const listenersRegistered = useRef(false)

  // Registrar listeners de eventos (Tauri o WebSocket)
  useEffect(() => {
    if ((!isTauri() && !isRemote()) || listenersRegistered.current) return
    listenersRegistered.current = true

    const unlisteners: (() => void)[] = []

    async function setupListeners() {
      const unlData = await tauriListen<GrblData>('serial:data', (payload) => {
        if (payload.data_type === 'status') return
        if (payload.data_type === 'ok' && !useSerialStore.getState().sending) return
        addConsoleLine(payload.line)
        if (payload.data_type === 'error' || payload.data_type === 'alarm') {
          useSerialStore.getState().setLastError(payload.line)
        }
      })
      unlisteners.push(unlData)

      const unlStatus = await tauriListen<GrblStatus>('serial:status', (payload) => {
        const { setMachineState, setPosition, posMode, lastError, clearLastError } = useSerialStore.getState()
        // Backend reporta state como string (GRBL/Marlin/custom); narrow al union MachineState.
        const state = payload.state as MachineState
        setMachineState(state)
        if (state === 'Idle' && lastError) clearLastError()
        const pos = posMode === 'WPos' ? payload.wpos : payload.mpos
        setPosition({ x: pos.x, y: pos.y, z: pos.z })
      })
      unlisteners.push(unlStatus)

      const unlProgress = await tauriListen<SendProgress>('serial:progress', (payload) => {
        const { setSendProgress } = useSerialStore.getState()
        setSendProgress(payload.percent)
        const wf = useWorkflowStore.getState()
        if (wf.activeGCode) {
          wf.setActiveGCodeLine(payload.current)
        }
      })
      unlisteners.push(unlProgress)

      const unlComplete = await tauriListen<Record<string, never>>('serial:complete', () => {
        const { setSending, setSendProgress } = useSerialStore.getState()
        setSending(false)
        setSendProgress(100)
        addConsoleLine('Envio de G-code completado')
      })
      unlisteners.push(unlComplete)

      const unlDisconnected = await tauriListen<Record<string, never>>('serial:disconnected', () => {
        const { setConnected, setMachineState } = useSerialStore.getState()
        setConnected(false)
        setMachineState('Idle')
        addConsoleLine('Conexion serial perdida')
      })
      unlisteners.push(unlDisconnected)
    }

    setupListeners()

    return () => {
      listenersRegistered.current = false
      unlisteners.forEach((fn) => fn())
    }
  }, [addConsoleLine])

  // Polling de status según dialecto de la máquina activa.
  useEffect(() => {
    if (getClientRole() !== 'local') return
    if (!isTauri() || !store.connected || store.sending) return
    const active = getActiveMachine()
    const statusCmd = active?.protocol.statusCommand ?? '?'
    const intervalMs = active?.protocol.statusPollMs ?? 250
    const interval = setInterval(() => {
      tauriInvoke('serial_send', { command: statusCmd }).catch(() => {})
    }, intervalMs)
    return () => clearInterval(interval)
  }, [store.connected, store.sending])

  const isLocal = getClientRole() === 'local'

  const listPorts = useCallback(async (): Promise<PortInfo[]> => {
    if (!isLocal) {
      addConsoleLine('Acceso remoto: listar puertos no disponible')
      return []
    }
    try {
      return await tauriInvoke<PortInfo[]>('serial_list_ports')
    } catch (err) {
      addConsoleLine(`Error listando puertos: ${err}`)
      return []
    }
  }, [isLocal, addConsoleLine])

  const connect = useCallback(async (port: string, baudRate: number) => {
    if (!isLocal) {
      addConsoleLine('Acceso remoto: conexion serial deshabilitada')
      return
    }
    try {
      const active = getActiveMachine()
      const dialect = active ? firmwareToDialect(active.firmware) : 'grbl'
      const effectiveBaud = baudRate || active?.protocol.baudRate || 115200
      addConsoleLine(`Conectando a ${port} @ ${effectiveBaud} (${dialect})...`)
      await tauriInvoke('serial_connect', { port, baudRate: effectiveBaud, dialect })
      store.setConnected(true)
      store.setPort(port)
      store.setBaudRate(effectiveBaud)
      addConsoleLine(`Conectado a ${port}`)
    } catch (err) {
      addConsoleLine(`Error conectando: ${err}`)
      store.setConnected(false)
    }
  }, [isLocal, store, addConsoleLine])

  const disconnect = useCallback(async () => {
    if (!isLocal) return
    try {
      await tauriInvoke('serial_disconnect')
      store.setConnected(false)
      store.setPort('')
      store.setMachineState('Idle')
      addConsoleLine('Desconectado')
    } catch (err) {
      addConsoleLine(`Error desconectando: ${err}`)
    }
  }, [isLocal, store, addConsoleLine])

  const sendCommand = useCallback(async (cmd: string) => {
    if (!isLocal || !store.connected) return
    try {
      await tauriInvoke('serial_send', { command: cmd })
      addConsoleLine(`> ${cmd}`)
    } catch (err) {
      addConsoleLine(`Error enviando: ${err}`)
    }
  }, [isLocal, store.connected, addConsoleLine])

  const sendGCode = useCallback(async (gcode: string) => {
    if (!isLocal || !store.connected) return
    try {
      store.setSending(true)
      store.setSendProgress(0)
      await tauriInvoke('serial_send_gcode', { gcode })
      addConsoleLine('Enviando G-code...')
    } catch (err) {
      store.setSending(false)
      addConsoleLine(`Error enviando G-code: ${err}`)
    }
  }, [isLocal, store, addConsoleLine])

  const cancelSend = useCallback(async () => {
    if (!isLocal) return
    try {
      await tauriInvoke('serial_cancel_send')
      store.setSending(false)
      addConsoleLine('Envio cancelado')
    } catch (err) {
      addConsoleLine(`Error cancelando: ${err}`)
    }
  }, [isLocal, store, addConsoleLine])

  const home = useCallback(async () => {
    const active = getActiveMachine()
    if (active && !active.homing.enabled) {
      addConsoleLine('Homing deshabilitado en el perfil de máquina activo.')
      return
    }
    const pre = active?.homing.preSequence ?? []
    const cmd = active?.homing.command || '$H'
    const post = active?.homing.postSequence ?? []
    for (const c of pre) await sendCommand(c)
    await sendCommand(cmd)
    for (const c of post) await sendCommand(c)
  }, [sendCommand, addConsoleLine])

  // $X es GRBL-only (unlock alarm). Marlin no tiene equivalente.
  const unlock = useCallback(() => {
    const active = getActiveMachine()
    const dialect = active ? firmwareToDialect(active.firmware) : 'grbl'
    if (dialect === 'marlin') {
      addConsoleLine('Unlock no aplica en Marlin.')
      return Promise.resolve()
    }
    return sendCommand('$X')
  }, [sendCommand, addConsoleLine])

  const reset = useCallback(() => sendCommand('\x18'), [sendCommand])
  const stop = useCallback(() => sendCommand('!'), [sendCommand])
  const resume = useCallback(() => sendCommand('~'), [sendCommand])

  const abort = useCallback(async () => {
    try {
      await sendCommand('!')
      if (isLocal) {
        try { await tauriInvoke('serial_cancel_send') } catch { /* ignore */ }
      }
      await sendCommand('\x18')
      await sendCommand('M5 S0')
      store.setSending(false)
      addConsoleLine('ABORT: feed hold + cancel + reset + laser off')
    } catch (err) {
      addConsoleLine(`Error abort: ${err}`)
    }
  }, [sendCommand, isLocal, store, addConsoleLine])

  const requestStatus = useCallback(() => {
    const active = getActiveMachine()
    return sendCommand(active?.protocol.statusCommand ?? '?')
  }, [sendCommand])

  const laserOff = useCallback(() => sendCommand('M5 S0'), [sendCommand])

  const jog = useCallback(
    async (axes: { x?: number; y?: number; z?: number }, feedRate: number) => {
      const isLaser = useCanvasStore.getState().globalConfig.operationType === 'laser'
      if (isLaser) await sendCommand('M5 S0')
      const active = getActiveMachine()
      const dialect = active ? firmwareToDialect(active.firmware) : 'grbl'
      for (const cmd of buildJogCommands(dialect, axes, feedRate)) {
        await sendCommand(cmd)
      }
    },
    [sendCommand],
  )

  const jogXY = useCallback(
    (x: number, y: number, feedRate: number) => jog({ x, y }, feedRate),
    [jog],
  )

  const jogZ = useCallback(
    (z: number, feedRate: number) => jog({ z }, feedRate),
    [jog],
  )

  const setZero = useCallback((axis?: 'x' | 'y' | 'z') => {
    if (axis) {
      return sendCommand(`G10 L20 P1 ${axis.toUpperCase()}0`)
    }
    return sendCommand('G10 L20 P1 X0 Y0 Z0')
  }, [sendCommand])

  return {
    connected: store.connected,
    port: store.port,
    baudRate: store.baudRate,
    machineState: store.machineState,
    position: store.position,
    sending: store.sending,
    sendProgress: store.sendProgress,
    isLocal,
    listPorts,
    connect,
    disconnect,
    sendCommand,
    sendGCode,
    cancelSend,
    home,
    unlock,
    reset,
    stop,
    abort,
    resume,
    requestStatus,
    laserOff,
    jogXY,
    jogZ,
    setZero,
  }
}
