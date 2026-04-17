type EventHandler<T> = (payload: T) => void

const EVENT_TYPE_MAP: Record<string, string> = {
  SerialData: 'serial:data',
  SerialStatus: 'serial:status',
  SerialProgress: 'serial:progress',
  SerialComplete: 'serial:complete',
  SerialDisconnected: 'serial:disconnected',
}

class WebSocketTransport {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<EventHandler<unknown>>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connected = false

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws`

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.connected = true
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
    }

    this.ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type: string; payload: unknown }
        const eventName = EVENT_TYPE_MAP[event.type] || event.type
        const handlers = this.listeners.get(eventName)
        if (handlers) {
          handlers.forEach((h) => h(event.payload))
        }
      } catch {
        // Ignorar mensajes no-JSON
      }
    }

    this.ws.onclose = () => {
      this.connected = false
      this.ws = null
      // Reconectar en 3 segundos
      this.reconnectTimer = setTimeout(() => this.connect(), 3000)
    }

    this.ws.onerror = () => {
      // onclose se llama automáticamente después de onerror
    }
  }

  listen<T>(event: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler as EventHandler<unknown>)

    // Conectar si no está conectado
    this.connect()

    return () => {
      this.listeners.get(event)?.delete(handler as EventHandler<unknown>)
    }
  }

  isConnected(): boolean {
    return this.connected
  }
}

export const wsTransport = new WebSocketTransport()
