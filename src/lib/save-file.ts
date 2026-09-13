// ============================================
// Guardado de archivos de texto
// ============================================

import { isTauri, tauriInvoke } from './tauri'

interface SaveFilter {
  name: string
  extensions: string[]
}

interface DialogPlugin {
  save(options: { defaultPath?: string; filters?: SaveFilter[] }): Promise<string | null>
}

async function getDialogPlugin(): Promise<DialogPlugin | null> {
  try {
    return (await import('@tauri-apps/plugin-dialog')) as unknown as DialogPlugin
  } catch {
    return null
  }
}

/**
 * Guarda texto en disco con el dialogo nativo; en web cae a una descarga.
 *
 * Devuelve la ruta elegida, `''` si fue por descarga del navegador, o `null`
 * si el usuario cancelo.
 */
export async function saveTextFile(
  content: string,
  filename: string,
  filter: SaveFilter,
): Promise<string | null> {
  if (isTauri()) {
    try {
      const dialog = await getDialogPlugin()
      if (dialog) {
        const path = await dialog.save({ defaultPath: filename, filters: [filter] })
        if (!path) return null
        await tauriInvoke('save_project', { path, data: content })
        return path
      }
    } catch {
      // Cae a la descarga del navegador
    }
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return ''
}
