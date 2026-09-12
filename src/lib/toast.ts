import { useToastStore, type ToastInput } from '@/stores/useToastStore'

type Options = Pick<ToastInput, 'detail' | 'duration'>

/**
 * API imperativa de notificaciones. Sirve dentro y fuera de React (callbacks de
 * stores, handlers de eventos Tauri, catch de promesas sueltas).
 */
export const toast = {
  success: (message: string, opts?: Options) =>
    useToastStore.getState().push({ variant: 'success', message, ...opts }),

  error: (message: string, opts?: Options) =>
    useToastStore.getState().push({ variant: 'error', message, ...opts }),

  warning: (message: string, opts?: Options) =>
    useToastStore.getState().push({ variant: 'warning', message, ...opts }),

  info: (message: string, opts?: Options) =>
    useToastStore.getState().push({ variant: 'info', message, ...opts }),

  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
}

/** Normaliza cualquier error (Error, string Tauri, objeto) a una línea legible. */
export function errorDetail(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}
