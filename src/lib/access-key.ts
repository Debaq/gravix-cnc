// Clave de acceso al servidor de red.
//
// El equipo que corre Gravix genera una clave al arrancar y la muestra junto a
// la URL. Los demas equipos de la red la mandan en cada pedido: sin ella el
// servidor no entrega herramientas, proyectos, cola de trabajos ni el trafico
// de la maquina. El propio equipo (loopback) no la necesita.

const STORAGE_KEY = 'gravix-access-key'

function safeStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Clave guardada, o la que viene en la URL (`?k=...`) la primera vez. */
export function getAccessKey(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('k')
    if (fromUrl) {
      safeStorage()?.setItem(STORAGE_KEY, fromUrl)
      return fromUrl
    }
  } catch {
    // sin URL utilizable
  }
  return safeStorage()?.getItem(STORAGE_KEY) ?? ''
}

export function setAccessKey(key: string) {
  safeStorage()?.setItem(STORAGE_KEY, key.trim())
}

let asking: Promise<string> | null = null

/** Pide la clave al usuario (una sola vez aunque fallen varios pedidos juntos). */
export function askAccessKey(): Promise<string> {
  if (!asking) {
    asking = Promise.resolve().then(() => {
      const typed = window.prompt('Clave de acceso de Gravix (se muestra en el equipo que tiene la maquina):') ?? ''
      if (typed.trim()) setAccessKey(typed)
      asking = null
      return typed.trim()
    })
  }
  return asking
}
