import { create } from 'zustand'
import { tauriInvoke } from '@/lib/tauri'

interface LicenseStatus {
  is_valid: boolean
  email: string | null
  error: string | null
}

interface LicenseStore {
  status: LicenseStatus | null
  isLoading: boolean
  check: () => Promise<void>
  activate: (token: string) => Promise<LicenseStatus>
  remove: () => Promise<void>
}

export const useLicense = create<LicenseStore>((set) => ({
  status: null,
  isLoading: true,

  check: async () => {
    const status = await tauriInvoke<LicenseStatus>('get_license_status')
    set({ status, isLoading: false })
  },

  activate: async (token: string) => {
    const status = await tauriInvoke<LicenseStatus>('activate_license', { token })
    if (status.is_valid) set({ status })
    return status
  },

  remove: async () => {
    await tauriInvoke('remove_license')
    set({ status: { is_valid: false, email: null, error: null } })
  },
}))
