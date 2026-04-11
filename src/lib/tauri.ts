/**
 * Utilidades para detectar y usar Tauri de forma segura.
 * Permite que la app funcione tanto dentro de Tauri como en modo web dev.
 */

/**
 * Retorna true si la app se esta ejecutando dentro de Tauri.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Wrapper seguro para invoke(). Si Tauri no esta disponible, lanza un error controlado.
 */
export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri no disponible: no se puede ejecutar '${cmd}'`)
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/**
 * Wrapper seguro para listen(). Retorna un unlisten noop si Tauri no esta disponible.
 */
export async function tauriListen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<() => void> {
  if (!isTauri()) {
    return () => {}
  }
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, (e) => handler(e.payload))
}
