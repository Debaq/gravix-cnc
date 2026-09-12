import { useSerialStore } from '@/stores/useSerialStore'
import { useAppStore } from '@/stores/useAppStore'
import { tauriInvoke } from '@/lib/tauri'
import { toast, errorDetail } from '@/lib/toast'
import { activeMachine, activeDialect, buildSerialConfig } from '@/lib/machine-limits'
import i18n from '@/i18n'
import type { PortInfo } from '@/lib/generated/PortInfo'

// Backoff exponencial: 0.5s, 1s, 2s, 4s, 8s, 8s. Seis intentos cubren el
// replug de un USB y el reboot de una placa sin dejar la app reintentando
// para siempre contra un cable que ya no está.
const MAX_ATTEMPTS = 6
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 8000

function delayFor(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS)
}

interface LastConnection {
  port: string
  baudRate: number
}

// Estado a nivel de módulo, no de componente: la conexión serial es única para
// todo el proceso y `useSerial()` se consume desde varios lugares a la vez.
let lastConnection: LastConnection | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let attempt = 0
let intentional = false
let running = false

function log(line: string) {
  useAppStore.getState().addConsoleLine(line)
}

/** Registra una conexión exitosa como objetivo de un futuro reintento. */
export function rememberConnection(port: string, baudRate: number) {
  lastConnection = { port, baudRate }
  // Una conexión nueva invalida cualquier intención de desconexión pendiente:
  // si `serial_disconnect` falló y el evento nunca llegó, la marca quedaba
  // levantada y se comía la primera caída inesperada de la sesión siguiente.
  intentional = false
  cancelReconnect()
}

/** Marca la próxima desconexión como pedida por el usuario (no se reintenta). */
export function markIntentionalDisconnect() {
  intentional = true
  lastConnection = null
  cancelReconnect()
}

/** Revierte `markIntentionalDisconnect` cuando la desconexión no se concretó. */
export function clearIntentionalDisconnect() {
  intentional = false
}

export function cancelReconnect() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  attempt = 0
  running = false
  const { reconnecting, setReconnecting } = useSerialStore.getState()
  if (reconnecting) setReconnecting(false, 0)
}

async function portIsBack(port: string): Promise<boolean> {
  try {
    const ports = await tauriInvoke<PortInfo[]>('serial_list_ports')
    return ports.some((p) => p.name === port)
  } catch {
    return false
  }
}

async function tryOnce() {
  if (!running || !lastConnection) return
  const { port, baudRate } = lastConnection

  useSerialStore.getState().setReconnecting(true, attempt)

  // Abrir un puerto que el SO todavía no reenumeró devuelve un error genérico
  // que no distingue "no está" de "está ocupado". Se chequea la lista primero.
  if (await portIsBack(port)) {
    try {
      await tauriInvoke('serial_connect', {
        port,
        baudRate,
        dialect: activeDialect(),
        config: buildSerialConfig(activeMachine()),
      })
      const store = useSerialStore.getState()
      store.setConnected(true)
      store.setPort(port)
      store.setBaudRate(baudRate)
      cancelReconnect()
      log(`Reconectado a ${port}`)
      // Deliberadamente NO se reanuda el job: tras una caída la posición de la
      // máquina es desconocida. El operador debe homear y relanzar.
      toast.success(i18n.t('toastReconnected', { port }))
      return
    } catch (err) {
      log(`Reintento ${attempt} fallido: ${errorDetail(err)}`)
    }
  }

  if (attempt >= MAX_ATTEMPTS) {
    cancelReconnect()
    log('Reconexion abandonada tras agotar los reintentos')
    toast.error(i18n.t('toastReconnectGaveUp'), {
      detail: i18n.t('toastReconnectGaveUpDetail'),
    })
    return
  }

  schedule()
}

function schedule() {
  attempt += 1
  const wait = delayFor(attempt)
  useSerialStore.getState().setReconnecting(true, attempt)
  timer = setTimeout(() => {
    timer = null
    void tryOnce()
  }, wait)
}

/**
 * Punto de entrada desde el evento `serial:disconnected`.
 * Arranca el reintento solo si la caída fue inesperada.
 */
export function handleDisconnected(reason: string | null, wasSending: boolean) {
  if (intentional) {
    intentional = false
    return
  }
  if (!lastConnection || running) return

  // Perder el puerto con un job en vuelo deja la máquina en posición
  // desconocida: eso se avisa aparte y no se descarta solo.
  if (wasSending) {
    toast.error(i18n.t('toastJobAbortedDisconnect'), {
      detail: i18n.t('toastJobAbortedDisconnectDetail'),
    })
  }

  running = true
  attempt = 0
  log(`Conexion perdida${reason ? `: ${reason}` : ''}. Reintentando...`)
  toast.warning(i18n.t('toastReconnecting'), {
    detail: i18n.t('toastReconnectAttempt', { attempt: 1, max: MAX_ATTEMPTS }),
  })
  schedule()
}

export const RECONNECT_MAX_ATTEMPTS = MAX_ATTEMPTS
