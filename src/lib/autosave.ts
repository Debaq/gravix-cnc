import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { isTauri, tauriInvoke } from '@/lib/tauri'
import { toast, errorDetail } from '@/lib/toast'
import { serializeGravixProject, projectFingerprint } from '@/lib/project-file'
import i18n from '@/i18n'

/** Espera tras el ultimo cambio antes de escribir. */
const DEBOUNCE_MS = 2500

/** Tope: con edicion continua igual se guarda cada tanto. */
const MAX_INTERVAL_MS = 60_000

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let unsubscribers: (() => void)[] = []
let lastFingerprint: string | null = null
let lastWriteAt = 0
let writing = false
/** Un error ya avisado no vuelve a apilar toasts en cada intento. */
let errorNotified = false

function clearDebounce() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

/**
 * Escribe el proyecto activo al disco.
 *
 * `force` salta la comparacion de huella (guardado manual: el usuario pidio
 * guardar y espera ver confirmacion aunque no haya cambios).
 * Devuelve `true` si el archivo quedo escrito o ya estaba al dia.
 */
export async function saveNow(force = false): Promise<boolean> {
  if (!isTauri()) return false

  const { activeProjectPath, activeProjectCreatedAt, setSaveState, markSaved, markModified } =
    useAppStore.getState()

  // Sin archivo destino no hay autosave: son los flujos de "guardar como".
  if (!activeProjectPath) return false

  // Ya hay una escritura en vuelo. Reprogramar: lo que cambio mientras tanto
  // no debe quedar esperando al heartbeat.
  if (writing) {
    clearDebounce()
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void saveNow(force)
    }, DEBOUNCE_MS)
    return false
  }

  const fingerprint = projectFingerprint()
  if (!force && fingerprint === lastFingerprint) {
    // El archivo ya refleja el estado: no hay nada sucio que mostrar.
    useAppStore.setState({ projectModified: false })
    setSaveState('idle')
    return true
  }

  writing = true
  clearDebounce()
  setSaveState('saving')

  try {
    const data = JSON.stringify(
      serializeGravixProject(activeProjectCreatedAt ?? undefined),
      null,
      2,
    )
    await tauriInvoke('save_gravix_project', { path: activeProjectPath, data })

    lastFingerprint = fingerprint
    lastWriteAt = Date.now()
    errorNotified = false
    markSaved()
    return true
  } catch (err) {
    const detail = errorDetail(err)
    markModified()
    setSaveState('error', detail)
    // Un "no se guardo" silencioso en una app de taller significa perder el
    // trabajo sin enterarse. Se avisa una vez por racha de fallos.
    if (!errorNotified) {
      errorNotified = true
      toast.error(i18n.t('projects:autosaveFailed'), { detail })
    }
    console.error('[autosave] fallo al guardar:', detail)
    return false
  } finally {
    writing = false
  }
}

function scheduleSave() {
  if (!useAppStore.getState().activeProjectPath) return

  // Sin marcar nada todavia: las suscripciones no tienen selector y disparan
  // con seleccion, hover o el flag de generacion. Quien decide si hubo cambio
  // real es `saveNow`, comparando la huella de contenido.

  // Con edicion continua el debounce se reinicia para siempre; el tope
  // fuerza la escritura igual.
  if (Date.now() - lastWriteAt > MAX_INTERVAL_MS) {
    void saveNow()
    return
  }

  clearDebounce()
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void saveNow()
  }, DEBOUNCE_MS)
}

/**
 * Arranca el guardado automatico del proyecto activo.
 *
 * Se suscribe a los stores que componen el archivo. Son suscripciones sin
 * selector —zustand sin `subscribeWithSelector`— asi que disparan tambien con
 * cambios que no van al archivo (seleccion, hover); la huella de contenido
 * evita que eso se traduzca en escrituras.
 */
export function startAutosave(): void {
  if (!isTauri()) return
  stopAutosave()

  lastFingerprint = projectFingerprint()
  lastWriteAt = Date.now()
  errorNotified = false

  unsubscribers = [
    useCanvasStore.subscribe(scheduleSave),
    useGCodeStore.subscribe(scheduleSave),
    useAppStore.subscribe((state, prev) => {
      if (
        state.projectName !== prev.projectName ||
        state.projectOperationType !== prev.projectOperationType
      ) {
        scheduleSave()
      }
    }),
  ]

  // Red de seguridad: si algun cambio no pasa por los stores suscritos, esto
  // igual lo persiste dentro del minuto.
  heartbeat = setInterval(() => {
    if (projectFingerprint() !== lastFingerprint) void saveNow()
  }, MAX_INTERVAL_MS)
}

/** Detiene el autosave. No guarda: para eso `flushAutosave`. */
export function stopAutosave(): void {
  clearDebounce()
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
  unsubscribers.forEach((fn) => fn())
  unsubscribers = []
}

/** Guarda lo pendiente y corta. Para salir del proyecto o cerrar la app. */
export async function flushAutosave(): Promise<boolean> {
  clearDebounce()
  const ok = await saveNow()
  stopAutosave()
  return ok
}
