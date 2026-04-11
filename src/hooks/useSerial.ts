import { useEffect, useCallback, useRef } from 'react'
import { useSerialStore } from '@/stores/useSerialStore'
import { useAppStore } from '@/stores/useAppStore'
import { isTauri, tauriInvoke, tauriListen } from '@/lib/tauri'
import type { MachineState } from '@/lib/types'

// Tipos para los eventos del backend
interface SerialPort {
  name: string
  port_type: string
}

interface SerialStatusEvent {
  state: MachineState
  mpos: { x: number; y: number; z: number }
  wpos: { x: number; y: number; z: number }
}

interface SerialProgressEvent {
  current: number
  total: number
  percent: number
}

interface SerialDataEvent {
  data: string
}

export function useSerial() {
  const store = useSerialStore()
  const { addConsoleLine } = useAppStore()
  const listenersRegistered = useRef(false)

  // Registrar listeners de eventos Tauri
  useEffect(() => {
    if (!isTauri() || listenersRegistered.current) return
    listenersRegistered.current = true

    const unlisteners: (() => void)[] = []

    async function setupListeners() {
      // Datos seriales recibidos
      const unlData = await tauriListen<SerialDataEvent>('serial:data', (payload) => {
        addConsoleLine(payload.data)
      })
      unlisteners.push(unlData)

      // Status report GRBL
      const unlStatus = await tauriListen<SerialStatusEvent>('serial:status', (payload) => {
        const { setMachineState, setPosition, posMode } = useSerialStore.getState()
        setMachineState(payload.state)
        const pos = posMode === 'WPos' ? payload.wpos : payload.mpos
        setPosition({
          x: pos.x.toFixed(3),
          y: pos.y.toFixed(3),
          z: pos.z.toFixed(3),
        })
      })
      unlisteners.push(unlStatus)

      // Progreso de envio G-code
      const unlProgress = await tauriListen<SerialProgressEvent>('serial:progress', (payload) => {
        const { setSendProgress } = useSerialStore.getState()
        setSendProgress(payload.percent)
      })
      unlisteners.push(unlProgress)

      // Envio completado
      const unlComplete = await tauriListen<Record<string, never>>('serial:complete', () => {
        const { setSending, setSendProgress } = useSerialStore.getState()
        setSending(false)
        setSendProgress(100)
        addConsoleLine('Envio de G-code completado')
      })
      unlisteners.push(unlComplete)

      // Desconexion
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

  const listPorts = useCallback(async (): Promise<SerialPort[]> => {
    if (!isTauri()) {
      addConsoleLine('Tauri no disponible: no se pueden listar puertos')
      return []
    }
    try {
      return await tauriInvoke<SerialPort[]>('serial_list_ports')
    } catch (err) {
      addConsoleLine(`Error listando puertos: ${err}`)
      return []
    }
  }, [addConsoleLine])

  const connect = useCallback(async (port: string, baudRate: number) => {
    if (!isTauri()) {
      addConsoleLine('Tauri no disponible: no se puede conectar')
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
  }, [store, addConsoleLine])

  const disconnect = useCallback(async () => {
    if (!isTauri()) return
    try {
      await tauriInvoke('serial_disconnect')
      store.setConnected(false)
      store.setPort('')
      store.setMachineState('Idle')
      addConsoleLine('Desconectado')
    } catch (err) {
      addConsoleLine(`Error desconectando: ${err}`)
    }
  }, [store, addConsoleLine])

  const sendCommand = useCallback(async (cmd: string) => {
    if (!isTauri() || !store.connected) return
    try {
      await tauriInvoke('serial_send', { command: cmd })
      addConsoleLine(`> ${cmd}`)
    } catch (err) {
      addConsoleLine(`Error enviando: ${err}`)
    }
  }, [store.connected, addConsoleLine])

  const sendGCode = useCallback(async (gcode: string) => {
    if (!isTauri() || !store.connected) return
    try {
      store.setSending(true)
      store.setSendProgress(0)
      await tauriInvoke('serial_send_gcode', { gcode })
      addConsoleLine('Enviando G-code...')
    } catch (err) {
      store.setSending(false)
      addConsoleLine(`Error enviando G-code: ${err}`)
    }
  }, [store, addConsoleLine])

  const cancelSend = useCallback(async () => {
    if (!isTauri()) return
    try {
      await tauriInvoke('serial_cancel_send')
      store.setSending(false)
      addConsoleLine('Envio cancelado')
    } catch (err) {
      addConsoleLine(`Error cancelando: ${err}`)
    }
  }, [store, addConsoleLine])

  // Comandos GRBL rapidos
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
    // Estado
    connected: store.connected,
    port: store.port,
    baudRate: store.baudRate,
    machineState: store.machineState,
    position: store.position,
    sending: store.sending,
    sendProgress: store.sendProgress,
    // Acciones de conexion
    listPorts,
    connect,
    disconnect,
    // Envio
    sendCommand,
    sendGCode,
    cancelSend,
    // Comandos GRBL
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
