import { create } from 'zustand'
import { tauriInvoke } from '@/lib/tauri'
import type { MachineProfile } from '@/lib/profiles'
import { getBuiltinPresets, clonePreset } from '@/lib/machine-presets'

interface MachinesFile {
  machines: MachineProfile[]
  activeMachineId?: string | null
}

interface MachineState {
  machines: MachineProfile[]
  activeMachineId: string | null
  loaded: boolean
  loading: boolean
  error: string | null

  load: () => Promise<void>
  persist: () => Promise<void>
  setActive: (id: string | null) => Promise<void>
  getActive: () => MachineProfile | null
  addMachine: (m: MachineProfile) => Promise<void>
  updateMachine: (id: string, patch: Partial<MachineProfile>) => void
  deleteMachine: (id: string) => Promise<void>
  cloneFromPreset: (presetId: string, name?: string) => Promise<MachineProfile | null>
  resetPresets: () => Promise<void>
}

function mergeWithPresets(user: MachineProfile[]): MachineProfile[] {
  const byId = new Map<string, MachineProfile>()
  for (const p of getBuiltinPresets()) byId.set(p.id, p)
  for (const m of user) byId.set(m.id, m)
  return Array.from(byId.values())
}

// Debounce para updateMachine: el modal dispara un update por keystroke en
// cada input; evita N escrituras Tauri.
let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(fn: () => Promise<void>) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void fn()
  }, 300)
}

export const useMachineStore = create<MachineState>((set, get) => ({
  machines: [],
  activeMachineId: null,
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const data = await tauriInvoke<MachinesFile>('get_machines')
      const userMachines = Array.isArray(data?.machines) ? data.machines : []
      const merged = mergeWithPresets(userMachines)
      const savedActive = data?.activeMachineId ?? null
      const validActive = savedActive && merged.some((m) => m.id === savedActive)
      const active = validActive ? savedActive : (merged[0]?.id ?? null)
      set({ machines: merged, activeMachineId: active, loaded: true, loading: false })
      // Persist solo si fallback reasignó active (sino es write a lo pedo).
      if (active !== savedActive) await get().persist()
    } catch (e) {
      set({ error: String(e), loading: false, loaded: true, machines: getBuiltinPresets() })
    }
  },

  persist: async () => {
    const { machines, activeMachineId } = get()
    const userMachines = machines.filter((m) => !m.isBuiltin)
    try {
      await tauriInvoke<void>('save_machines', {
        data: { machines: userMachines, activeMachineId },
      })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  setActive: async (id) => {
    if (get().activeMachineId === id) return
    set({ activeMachineId: id })
    await get().persist()
  },

  getActive: () => {
    const { machines, activeMachineId } = get()
    return machines.find((m) => m.id === activeMachineId) ?? null
  },

  addMachine: async (m) => {
    set((s) => ({ machines: [...s.machines, m] }))
    await get().persist()
  },

  updateMachine: (id, patch) => {
    set((s) => ({
      machines: s.machines.map((m) =>
        m.id === id && !m.isBuiltin
          ? { ...m, ...patch, updatedAt: new Date().toISOString() }
          : m,
      ),
    }))
    schedulePersist(() => get().persist())
  },

  deleteMachine: async (id) => {
    const m = get().machines.find((x) => x.id === id)
    if (!m || m.isBuiltin) return
    set((s) => {
      const machines = s.machines.filter((x) => x.id !== id)
      const activeMachineId = s.activeMachineId === id ? (machines[0]?.id ?? null) : s.activeMachineId
      return { machines, activeMachineId }
    })
    await get().persist()
  },

  cloneFromPreset: async (presetId, name) => {
    const preset = get().machines.find((m) => m.id === presetId)
    if (!preset) return null
    const clone = clonePreset(preset, name)
    await get().addMachine(clone)
    return clone
  },

  resetPresets: async () => {
    set({ machines: mergeWithPresets(get().machines.filter((m) => !m.isBuiltin)) })
    await get().persist()
  },
}))
