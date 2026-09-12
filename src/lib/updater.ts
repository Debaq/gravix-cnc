import { isTauri } from '@/lib/tauri'

/**
 * Metadata de una actualizacion disponible. Es el subconjunto de
 * `Update` del plugin que nos interesa — no exponemos el objeto crudo
 * porque su ciclo de vida (download/install) lo maneja este modulo.
 */
export interface UpdateInfo {
  version: string
  currentVersion: string
  notes?: string
  date?: string
}

interface TauriUpdate {
  version: string
  currentVersion: string
  body?: string
  date?: string
  downloadAndInstall: (
    onEvent: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void,
  ) => Promise<void>
  close: () => Promise<void>
}

/** Update pendiente entre `checkForUpdate` e `installUpdate`. */
let pending: TauriUpdate | null = null

async function loadUpdaterPlugin(): Promise<{ check: () => Promise<TauriUpdate | null> } | null> {
  if (!isTauri()) return null
  try {
    return await import('@tauri-apps/plugin-updater')
  } catch {
    return null
  }
}

/**
 * Consulta el endpoint de releases.
 * Devuelve `null` si ya esta al dia o si no corre bajo Tauri.
 *
 * Tira si el endpoint no responde. Una `pubkey` vacia en tauri.conf.json no
 * rompe este chequeo —solo la instalacion posterior—, asi que ver un update
 * ofrecido no garantiza que se pueda instalar; ver docs/RELEASE.md.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const plugin = await loadUpdaterPlugin()
  if (!plugin) return null

  await discardPending()
  const update = await plugin.check()
  if (!update) return null

  pending = update
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body,
    date: update.date,
  }
}

/**
 * Descarga e instala el update pendiente. `onProgress` recibe 0..1, o -1
 * mientras el servidor no informe `Content-Length`.
 *
 * No reinicia la app: quien llama decide cuando, porque reiniciar con un
 * job en vuelo cortaria el envio a la maquina.
 */
export async function installUpdate(onProgress?: (ratio: number) => void): Promise<void> {
  if (!pending) throw new Error('No hay actualizacion pendiente')

  let total = 0
  let downloaded = 0

  await pending.downloadAndInstall((e) => {
    switch (e.event) {
      case 'Started':
        total = e.data?.contentLength ?? 0
        onProgress?.(total > 0 ? 0 : -1)
        break
      case 'Progress':
        downloaded += e.data?.chunkLength ?? 0
        if (total > 0) onProgress?.(Math.min(downloaded / total, 1))
        break
      case 'Finished':
        onProgress?.(1)
        break
    }
  })

  pending = null
}

/** Relanza la app para que corra la version recien instalada. */
export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

/** Libera el update pendiente sin instalarlo. */
export async function discardPending(): Promise<void> {
  if (!pending) return
  const stale = pending
  pending = null
  try {
    await stale.close()
  } catch {
    // El handle ya pudo cerrarse solo; no hay nada que recuperar aca.
  }
}
