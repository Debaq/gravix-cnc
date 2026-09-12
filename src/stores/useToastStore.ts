import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  variant: ToastVariant
  message: string
  detail?: string
}

// Los errores no se van solos. En una app que maneja una máquina física, un
// "no se guardó" que desaparece a los 3 segundos es lo mismo que no avisar.
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 0,
}

// Más de esto y la pila tapa la UI. Se descartan los más viejos.
const MAX_VISIBLE = 4

export interface ToastInput {
  variant: ToastVariant
  message: string
  detail?: string
  /** ms hasta auto-descarte. 0 = persistente. Omitido = default por variante. */
  duration?: number
}

interface ToastState {
  toasts: Toast[]
  push: (input: ToastInput) => string
  dismiss: (id: string) => void
  clear: () => void
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(id: string) {
  const t = timers.get(id)
  if (t !== undefined) {
    clearTimeout(t)
    timers.delete(id)
  }
}

let seq = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: ({ variant, message, detail, duration }) => {
    const id = `toast-${Date.now()}-${seq++}`
    const toast: Toast = { id, variant, message, detail }

    set((s) => {
      const next = [...s.toasts, toast]
      // Se sueltan los timers de los que quedan fuera de la ventana visible.
      const dropped = next.slice(0, Math.max(0, next.length - MAX_VISIBLE))
      dropped.forEach((d) => clearTimer(d.id))
      return { toasts: next.slice(-MAX_VISIBLE) }
    })

    const ms = duration ?? DEFAULT_DURATION[variant]
    if (ms > 0) {
      timers.set(id, setTimeout(() => get().dismiss(id), ms))
    }
    return id
  },

  dismiss: (id) => {
    clearTimer(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  clear: () => {
    get().toasts.forEach((t) => clearTimer(t.id))
    set({ toasts: [] })
  },
}))
