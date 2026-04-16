import { useEffect, useCallback, useRef } from 'react'
import { useSerialStore } from '@/stores/useSerialStore'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useAppStore } from '@/stores/useAppStore'
import { isTauri, isRemote, tauriInvoke, tauriListen } from '@/lib/tauri'
import { getClientRole } from '@/lib/client-role'
import type { MachineState } from '@/lib/types'

interface SerialPort {
  name: string
  port_type: string
}

interface SerialStatusEvent {
  state: MachineState
  mpos: { x: string; y: string; z: string }
  wpos: { x: string; y: string; z: string }
}

interface SerialProgressEvent {
  current: number
  total: number
  percent: number
}

interface SerialDataEvent {
  line: string
  data_type: string
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
      const unlData = await tauriListen<SerialDataEvent>('serial:data', (payload) => {
        if (payload.data_type === 'status') return
        if (payload.line === 'ok' && !useSerialStore.getState().sending) return
        addConsoleLine(payload.line)
      })
      unlisteners.push(unlData)

      const unlStatus = await tauriListen<SerialStatusEvent>('serial:status', (payload) => {
        const { setMachineState, setPosition, posMode } = useSerialStore.getState()
        setMachineState(payload.state)
        const pos = posMode === 'WPos' ? payload.wpos : payload.mpos
        setPosition({
          x: typeof pos.x === 'number' ? (pos.x as number).toFixed(3) : String(pos.x),
          y: typeof pos.y === 'number' ? (pos.y as number).toFixed(3) : String(pos.y),
          z: typeof pos.z === 'number' ? (pos.z as number).toFixed(3) : String(pos.z),
        })
      })
      unlisteners.push(unlStatus)

      const unlProgress = await tauriListen<SerialProgressEvent>('serial:progress', (payload) => {
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

  // Polling de status GRBL (solo local)
  useEffect(() => {
    if (getClientRole() !== 'local') return
    if (!isTauri() || !store.connected || store.sending) return
    const interval = setInterval(() => {
      tauriInvoke('serial_send', { command: '?' }).catch(() => {})
    }, 250)
    return () => clearInterval(interval)
  }, [store.connected, store.sending])

  const isLocal = getClientRole() === 'local'

  const listPorts = useCallback(async (): Promise<SerialPort[]> => {
    if (!isLocal) {
      addConsoleLine('Acceso remoto: listar puertos no disponible')
      return []
    }
    try {
      return await tauriInvoke<SerialPort[]>('serial_list_ports')
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
      addConsoleLine(`Conectando a ${port} @ ${baudRate}...`)
      await tauriInvoke('serial_connect', { port, baudRate })
      store.setConnected(true)
      store.setPort(port)
      store.setBaudRate(baudRate)
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

  const home = useCallback(() => sendCommand('$H'), [sendCommand])
  const unlock = useCallback(() => sendCommand('$X'), [sendCommand])
  const reset = useCallback(() => sendCommand('\x18'), [sendCommand])
  const stop = useCallback(() => sendCommand('!'), [sendCommand])
  const resume = useCallback(() => sendCommand('~'), [sendCommand])
  const requestStatus = useCallback(() => sendCommand('?'), [sendCommand])

  const jogXY = useCallback((x: number, y: number, feedRate: number) => {
    return sendCommand(`$J=G91 X${x} Y${y} F${feedRate}`)
  }, [sendCommand])

  const jogZ = useCallback((z: number, feedRate: number) => {
    return sendCommand(`$J=G91 Z${z} F${feedRate}`)
  }, [sendCommand])

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
    resume,
    requestStatus,
    jogXY,
    jogZ,
    setZero,
  }
}
