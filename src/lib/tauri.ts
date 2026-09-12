/**
 * Capa de transporte unificada.
 * Enruta automáticamente a Tauri invoke/listen o HTTP/WebSocket
 * según el entorno de ejecución.
 */

import { httpInvoke } from './http-transport'
import { wsTransport } from './ws-transport'

/**
 * Retorna true si la app se esta ejecutando dentro de Tauri.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Retorna true si la app se ejecuta en un browser servida por el servidor embebido.
 *
 * No se puede distinguir por puerto: cnc.sh elige uno libre cuando 5173 esta
 * ocupado, y con eso una sesion de `vite dev` pasaba por remota e intentaba
 * abrir un WebSocket contra un backend que no existe. `import.meta.env.DEV`
 * solo es true bajo el dev server de Vite, que es exactamente el caso a excluir.
 */
export function isRemote(): boolean {
  return !isTauri() && typeof window !== 'undefined' && !import.meta.env.DEV
}

/**
 * Invoca un comando. Enruta a Tauri invoke o HTTP según entorno.
 */
export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(cmd, args)
  }
  if (isRemote()) {
    return httpInvoke<T>(cmd, args)
  }
  throw new Error(`Tauri no disponible: no se puede ejecutar '${cmd}'`)
}

/**
 * Escucha un evento. Enruta a Tauri listen o WebSocket según entorno.
 */
export async function tauriListen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<() => void> {
  if (isTauri()) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<T>(event, (e) => handler(e.payload))
  }
  if (isRemote()) {
    return wsTransport.listen<T>(event, handler)
  }
  return () => {}
}
