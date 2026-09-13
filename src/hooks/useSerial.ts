import { useEffect, useCallback } from 'react'
import { useSerialStore } from '@/stores/useSerialStore'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { isTauri, isRemote, tauriInvoke, tauriListen } from '@/lib/tauri'
import { getClientRole } from '@/lib/client-role'
import { activeMachine, activeDialect, buildAxisLimits, buildSerialConfig } from '@/lib/machine-limits'
import {
  rememberConnection,
  markIntentionalDisconnect,
  clearIntentionalDisconnect,
  handleDisconnected,
  cancelReconnect,
} from '@/lib/serial-reconnect'
import type { MachineState } from '@/lib/types'
import type { Dialect } from '@/lib/generated/Dialect'
import type { PortInfo } from '@/lib/generated/PortInfo'
import type { GrblStatus } from '@/lib/generated/GrblStatus'
import { parseStatusReport, parseParserState } from '@/lib/grbl-diagnostics'
import type { GrblData } from '@/lib/generated/GrblData'
import type { SendProgress } from '@/lib/generated/SendProgress'
import type { RealtimeCmd } from '@/lib/generated/RealtimeCmd'

// Estados en los que la máquina no puede aceptar un programa nuevo.
// Arrancar un job en Alarm o Hold es la vía rápida a un choque o a un job que
// se ejecuta a medias sin que el operador se entere.
const BLOCKING_STATES: MachineState[] = ['Alarm', 'Hold', 'Run', 'Home', 'Jog']

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

// Los eventos serial son globales al proceso, no por componente. El guard
// anterior era un `useRef`, y como `useSerial()` se consume desde nueve
// lugares cada uno registraba su propio juego de listeners: cada línea del
// firmware entraba nueve veces a la consola y cada evento se procesaba nueve
// veces. Ahora se registran una sola vez y se sueltan cuando se desmonta el
// último consumidor.
let listenerRefCount = 0
let listenerHandle: Promise<() => void> | null = null

function setupSerialListeners(): Promise<() => void> {
  const addConsoleLine = (line: string) => useAppStore.getState().addConsoleLine(line)
  const unlisteners: (() => void)[] = []

  async function setupListeners() {
    const unlData = await tauriListen<GrblData>('serial:data', (payload) => {
      // Los reportes de status ya no llegan por este canal, y los `ok` de un
      // job los suprime el backend. Lo que queda es todo relevante.
      if (payload.data_type === 'status') return
      addConsoleLine(payload.line)
      if (payload.data_type === 'error' || payload.data_type === 'alarm') {
        useSerialStore.getState().setLastError(payload.line)
      }
      // Respuesta a `$G`: modos activos del parser (G54, G90, M5, T0...).
      const parsed = parseParserState(payload.line)
      if (parsed) useSerialStore.getState().setParserState(parsed)
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
      // Pines, buffers y overrides viven en el reporte crudo, no en los
      // campos que el backend ya normaliza.
      if (payload.raw) {
        useSerialStore.getState().setDiagnostics(parseStatusReport(payload.raw))
      }
    })
    unlisteners.push(unlStatus)

    const unlProgress = await tauriListen<SendProgress>('serial:progress', (payload) => {
      const { setSendProgress, setSending } = useSerialStore.getState()
      setSending(true)
      setSendProgress(payload.percent)
      const wf = useWorkflowStore.getState()
      if (wf.activeGCode) {
        wf.setActiveGCodeLine(payload.current)
      }
    })
    unlisteners.push(unlProgress)

    // El backend manda por qué terminó: done | cancelled | error | alarm | reset.
    const unlComplete = await tauriListen<string>('serial:complete', (result) => {
      const { setSending, setSendProgress } = useSerialStore.getState()
      setSending(false)
      if (result === 'done') {
        setSendProgress(100)
        addConsoleLine('Envio de G-code completado')
      } else {
        setSendProgress(0)
        addConsoleLine(`Envio interrumpido (${result ?? 'desconocido'})`)
      }
    })
    unlisteners.push(unlComplete)

    const unlDisconnected = await tauriListen<string>('serial:disconnected', (reason) => {
      const { setConnected, setMachineState, setSending, setSendProgress, sending } =
        useSerialStore.getState()
      // Se lee `sending` antes de limpiarlo: distingue "se cayó el cable" de
      // "se cayó el cable con la herramienta dentro del material".
      const wasSending = sending
      setConnected(false)
      setSending(false)
      setSendProgress(0)
      setMachineState('Idle')
      addConsoleLine(`Conexion serial cerrada${reason ? `: ${reason}` : ''}`)
      handleDisconnected(reason, wasSending)
    })
    unlisteners.push(unlDisconnected)
  }

  return setupListeners().then(() => () => {
    unlisteners.forEach((fn) => fn())
  })
}

function acquireSerialListeners(): () => void {
  listenerRefCount += 1
  if (!listenerHandle) {
    listenerHandle = setupSerialListeners()
  }
  return () => {
    listenerRefCount -= 1
    if (listenerRefCount > 0 || !listenerHandle) return
    const pending = listenerHandle
    listenerHandle = null
    void pending.then((off) => off())
  }
}

export function useSerial() {
  const store = useSerialStore()
  const { addConsoleLine } = useAppStore()

  useEffect(() => {
    if (!isTauri() && !isRemote()) return
    return acquireSerialListeners()
  }, [])

  // El polling de status vive en el hilo serial del backend: `?` es un comando
  // realtime que no consume buffer del firmware, así que sigue corriendo durante
  // el job. Pollear desde JS agregaba un `\r\n` de más por cada `?`, y ese `ok`
  // espurio desincronizaba el conteo del streaming.

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
      const active = activeMachine()
      const dialect = activeDialect()
      const effectiveBaud = baudRate || active?.protocol.baudRate || 115200
      addConsoleLine(`Conectando a ${port} @ ${effectiveBaud} (${dialect})...`)
      await tauriInvoke('serial_connect', {
        port,
        baudRate: effectiveBaud,
        dialect,
        config: buildSerialConfig(active),
      })
      store.setConnected(true)
      store.setPort(port)
      store.setBaudRate(effectiveBaud)
      rememberConnection(port, effectiveBaud)
      addConsoleLine(`Conectado a ${port}`)
      // `$G` devuelve los modos activos del parser. GRBL no los manda solo, así
      // que se pide una vez al conectar para poblar el panel de diagnostico.
      if (dialect === 'grbl') {
        try {
          await tauriInvoke('serial_send', { command: '$G' })
        } catch {
          // Firmware sin soporte: el panel simplemente no muestra parser state.
        }
      }
    } catch (err) {
      addConsoleLine(`Error conectando: ${err}`)
      store.setConnected(false)
      cancelReconnect()
    }
  }, [isLocal, store, addConsoleLine])

  const disconnect = useCallback(async () => {
    if (!isLocal) return
    try {
      // Se marca antes del invoke: el evento `serial:disconnected` puede llegar
      // mientras esta promesa sigue pendiente, y sin la marca el reconector lo
      // leería como una caída inesperada.
      markIntentionalDisconnect()
      // El backend frena la máquina antes de cerrar si hay un job en vuelo.
      await tauriInvoke('serial_disconnect')
      store.setConnected(false)
      store.setPort('')
      store.setSending(false)
      store.setMachineState('Idle')
      addConsoleLine('Desconectado')
    } catch (err) {
      // La desconexión no prosperó: se levanta la marca para no silenciar una
      // caída real posterior.
      clearIntentionalDisconnect()
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

  // Comandos realtime: bytes crudos, sin terminador, saltan la cola.
  // Es el camino que deben tomar parada, reanudar, reset y jog-cancel.
  const sendRealtime = useCallback(async (cmd: RealtimeCmd) => {
    if (!isLocal || !store.connected) return
    try {
      await tauriInvoke('serial_realtime', { cmd })
    } catch (err) {
      addConsoleLine(`Error realtime (${cmd}): ${err}`)
    }
  }, [isLocal, store.connected, addConsoleLine])

  const sendGCode = useCallback(async (gcode: string) => {
    if (!isLocal || !store.connected) return
    const state = useSerialStore.getState().machineState
    if (BLOCKING_STATES.includes(state)) {
      addConsoleLine(`No se puede iniciar: la maquina esta en ${state}.`)
      return
    }
    try {
      store.setSending(true)
      store.setSendProgress(0)
      // El backend valida la envolvente antes del primer byte y rechaza el job
      // entero si alguna coordenada se sale.
      await tauriInvoke('serial_send_gcode', {
        gcode,
        limits: buildAxisLimits(activeMachine()),
      })
      addConsoleLine('Enviando G-code...')
    } catch (err) {
      store.setSending(false)
      store.setSendProgress(0)
      addConsoleLine(`Error enviando G-code: ${err}`)
      useSerialStore.getState().setLastError(String(err))
    }
  }, [isLocal, store, addConsoleLine])

  // Valida sin enviar. Sirve para avisar antes de que el operador apriete start.
  const checkBounds = useCallback(async (gcode: string): Promise<string | null> => {
    const limits = buildAxisLimits(activeMachine())
    if (!limits || !isLocal) return null
    try {
      await tauriInvoke('serial_check_bounds', { gcode, limits })
      return null
    } catch (err) {
      return String(err)
    }
  }, [isLocal])

  // Detiene de verdad: feed hold, deceleración y soft reset en el backend.
  // Dejar de mandar líneas no alcanza — GRBL sigue con los bloques del planner.
  const cancelSend = useCallback(async () => {
    if (!isLocal) return
    try {
      await tauriInvoke('serial_cancel_send')
      addConsoleLine('Parada solicitada')
    } catch (err) {
      addConsoleLine(`Error cancelando: ${err}`)
    }
  }, [isLocal, addConsoleLine])

  const home = useCallback(async () => {
    const active = activeMachine()
    if (active && !active.homing.enabled) {
      addConsoleLine('Homing deshabilitado en el perfil de máquina activo.')
      return
    }
    if (useSerialStore.getState().sending) {
      addConsoleLine('No se puede hacer homing con un job en curso.')
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
    if (activeDialect() === 'marlin') {
      addConsoleLine('Unlock no aplica en Marlin.')
      return Promise.resolve()
    }
    return sendCommand('$X')
  }, [sendCommand, addConsoleLine])

  const reset = useCallback(() => sendRealtime('soft-reset'), [sendRealtime])
  const stop = useCallback(() => sendRealtime('feed-hold'), [sendRealtime])
  const resume = useCallback(() => sendRealtime('cycle-start'), [sendRealtime])
  const jogCancel = useCallback(() => sendRealtime('jog-cancel'), [sendRealtime])

  // Parada de emergencia. El backend hace feed hold → deceleración → soft reset
  // en la secuencia y con los tiempos correctos; acá solo se dispara.
  const abort = useCallback(async () => {
    try {
      await sendRealtime('feed-hold')
      if (isLocal) {
        try { await tauriInvoke('serial_cancel_send') } catch { /* ignore */ }
      }
      store.setSending(false)
      addConsoleLine('ABORT: feed hold + parada + reset')
    } catch (err) {
      addConsoleLine(`Error abort: ${err}`)
    }
  }, [sendRealtime, isLocal, store, addConsoleLine])

  const requestStatus = useCallback(() => sendRealtime('status-report'), [sendRealtime])

  const laserOff = useCallback(() => sendCommand('M5 S0'), [sendCommand])

  const jog = useCallback(
    async (axes: { x?: number; y?: number; z?: number }, feedRate: number) => {
      if (useSerialStore.getState().sending) return
      const isLaser = useCanvasStore.getState().globalConfig.operationType === 'laser'
      if (isLaser) await sendCommand('M5 S0')
      for (const cmd of buildJogCommands(activeDialect(), axes, feedRate)) {
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
    sendRealtime,
    sendGCode,
    checkBounds,
    cancelSend,
    home,
    unlock,
    reset,
    stop,
    abort,
    resume,
    jogCancel,
    requestStatus,
    laserOff,
    jogXY,
    jogZ,
    setZero,
  }
}
