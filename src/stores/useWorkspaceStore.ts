import { create } from 'zustand'
import { isTauri, tauriInvoke } from '@/lib/tauri'

export interface ProjectMeta {
  filename: string
  path: string
  name: string
  mode: 'cnc' | 'laser' | 'plotter' | 'pencil'
  width: number
  height: number
  modified_at: number
}

interface WorkspaceState {
  path: string | null
  projects: ProjectMeta[]
  recentWorkspaces: string[]
  isLoading: boolean

  init: () => Promise<void>
  pick: () => Promise<string | null>
  setPath: (path: string) => Promise<void>
  refresh: () => Promise<void>
}

// Fallback web — sin Tauri no hay filesystem
const WEB_KEY = 'gravix-workspace'

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  path: null,
  projects: [],
  recentWorkspaces: [],
  isLoading: true,

  init: async () => {
    if (isTauri()) {
      const [path, recents] = await Promise.all([
        tauriInvoke<string | null>('get_workspace'),
        tauriInvoke<string[]>('get_recent_workspaces'),
      ])
      if (path) {
        const projects = await tauriInvoke<ProjectMeta[]>('list_projects')
        set({ path, projects, recentWorkspaces: recents, isLoading: false })
      } else {
        set({ path: null, recentWorkspaces: recents, isLoading: false })
      }
    } else {
      // Web fallback — no filesystem
      const saved = localStorage.getItem(WEB_KEY)
      set({ path: saved, projects: [], recentWorkspaces: [], isLoading: false })
    }
  },

  pick: async () => {
    if (!isTauri()) {
      // Web: no native dialog
      const fakeDir = '/web-workspace'
      localStorage.setItem(WEB_KEY, fakeDir)
      set({ path: fakeDir })
      return fakeDir
    }
    const path = await tauriInvoke<string | null>('pick_workspace')
    if (path) {
      const projects = await tauriInvoke<ProjectMeta[]>('list_projects')
      const recents = await tauriInvoke<string[]>('get_recent_workspaces')
      set({ path, projects, recentWorkspaces: recents })
    }
    return path
  },

  setPath: async (path: string) => {
    if (!isTauri()) {
      localStorage.setItem(WEB_KEY, path)
      set({ path, projects: [] })
      return
    }
    await tauriInvoke('set_workspace', { path })
    const projects = await tauriInvoke<ProjectMeta[]>('list_projects')
    const recents = await tauriInvoke<string[]>('get_recent_workspaces')
    set({ path, projects, recentWorkspaces: recents })
  },

  refresh: async () => {
    if (!isTauri()) return
    const projects = await tauriInvoke<ProjectMeta[]>('list_projects')
    set({ projects })
  },
}))
