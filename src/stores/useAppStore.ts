import { create } from 'zustand'
import type { Workspace } from '@/lib/types'

interface AppState {
  // Workspace
  currentWorkspace: Workspace
  setWorkspace: (ws: Workspace) => void

  // Sidebar
  leftPanelCollapsed: boolean
  toggleLeftPanel: () => void

  // Project
  projectName: string
  projectModified: boolean
  lastSavedTime: string | null
  setProjectName: (name: string) => void
  markModified: () => void
  markSaved: () => void

  // Language
  language: string
  setLanguage: (lang: string) => void

  // Modals
  activeModal: string | null
  openModal: (modal: string) => void
  closeModal: () => void

  // Console
  consoleLines: string[]
  addConsoleLine: (line: string) => void
  clearConsole: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // Workspace
  currentWorkspace: 'design',
  setWorkspace: (ws) => set({ currentWorkspace: ws }),

  // Sidebar
  leftPanelCollapsed: false,
  toggleLeftPanel: () => set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),

  // Project
  projectName: 'Untitled Project',
  projectModified: false,
  lastSavedTime: null,
  setProjectName: (name) => set({ projectName: name }),
  markModified: () => set({ projectModified: true }),
  markSaved: () => set({
    projectModified: false,
    lastSavedTime: new Date().toISOString(),
  }),

  // Language
  language: 'es',
  setLanguage: (lang) => set({ language: lang }),

  // Modals
  activeModal: null,
  openModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null }),

  // Console
  consoleLines: [],
  addConsoleLine: (line) =>
    set((state) => {
      const timestamp = new Date().toLocaleTimeString()
      const newLines = [...state.consoleLines, `[${timestamp}] ${line}`]
      if (newLines.length > 200) newLines.shift()
      return { consoleLines: newLines }
    }),
  clearConsole: () => set({ consoleLines: [] }),
}))
