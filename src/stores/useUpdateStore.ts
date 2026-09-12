import { create } from 'zustand'
import {
  checkForUpdate,
  installUpdate,
  relaunchApp,
  discardPending,
  type UpdateInfo,
} from '@/lib/updater'
import { toast } from '@/lib/toast'
import i18n from '@/i18n'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'upToDate'
  | 'error'

interface UpdateState {
  status: UpdateStatus
  info: UpdateInfo | null
  /** 0..1, o -1 si el servidor no informa tamaño. */
  progress: number
  error: string | null
  /** El usuario descartó esta versión; no volver a molestar hasta reiniciar. */
  dismissedVersion: string | null

  /** `silent` omite el estado `upToDate` — para el chequeo automático del arranque. */
  check: (silent?: boolean) => Promise<void>
  install: () => Promise<void>
  relaunch: () => Promise<void>
  dismiss: () => void
  reset: () => void
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  info: null,
  progress: 0,
  error: null,
  dismissedVersion: null,

  check: async (silent = false) => {
    if (get().status === 'checking' || get().status === 'downloading') return

    set({ status: 'checking', error: null })
    try {
      const info = await checkForUpdate()
      if (!info) {
        set({ status: silent ? 'idle' : 'upToDate', info: null })
        return
      }
      if (silent && get().dismissedVersion === info.version) {
        set({ status: 'idle', info: null })
        await discardPending()
        return
      }
      set({ status: 'available', info, progress: 0 })

      // El chequeo del arranque avisa con un toast. Abrir el modal solo
      // porque la app arranco tapa la pantalla sin que nadie lo pidiera.
      if (silent) {
        toast.info(i18n.t('updater:toastAvailable', { version: info.version }), {
          detail: i18n.t('updater:toastAvailableDetail'),
          duration: 10_000,
        })
      }
    } catch (err) {
      // Sin red o sin endpoint publicado el chequeo automático no debe
      // gritarle al usuario: solo el manual reporta el fallo.
      const message = err instanceof Error ? err.message : String(err)
      if (silent) {
        console.error('[updater] chequeo automatico fallido:', message)
        set({ status: 'idle', error: null })
      } else {
        set({ status: 'error', error: message })
      }
    }
  },

  install: async () => {
    if (get().status !== 'available') return
    set({ status: 'downloading', progress: 0, error: null })
    try {
      await installUpdate((ratio) => set({ progress: ratio }))
      set({ status: 'ready', progress: 1 })
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  relaunch: async () => {
    try {
      await relaunchApp()
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  dismiss: () => {
    const { info } = get()
    void discardPending()
    set({
      status: 'idle',
      dismissedVersion: info?.version ?? null,
      info: null,
      progress: 0,
    })
  },

  reset: () => set({ status: 'idle', info: null, progress: 0, error: null }),
}))
