import { create } from 'zustand'
import type { Workspace, OperationType } from '@/lib/types'

type AppView = 'projects' | 'workspace'

export type SaveState = 'idle' | 'saving' | 'error'

interface AppState {
  // View
  currentView: AppView
  setView: (view: AppView) => void

  // Workspace
  currentWorkspace: Workspace
  setWorkspace: (ws: Workspace) => void
  controlOnly: boolean
  setControlOnly: (v: boolean) => void

  // Sidebar
  leftPanelCollapsed: boolean
  toggleLeftPanel: () => void

  // Project
  projectName: string
  projectModified: boolean
  lastSavedTime: string | null
  projectOperationType: OperationType
  activeProjectPath: string | null
  /** `created_at` del .gravix abierto, para no pisarlo en cada guardado. */
  activeProjectCreatedAt: number | null
  /** Estado del guardado automatico, para el indicador del header. */
  saveState: SaveState
  saveError: string | null
  setProjectName: (name: string) => void
  setProjectOperationType: (op: OperationType) => void
  setActiveProjectPath: (path: string | null, createdAt?: number | null) => void
  setSaveState: (state: SaveState, error?: string | null) => void
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
  // View
  currentView: 'projects',
  setView: (view) => set({ currentView: view }),

  // Workspace
  currentWorkspace: 'cad',
  setWorkspace: (ws) => set({ currentWorkspace: ws }),
  controlOnly: false,
  setControlOnly: (v) => set({ controlOnly: v }),

  // Sidebar
  leftPanelCollapsed: false,
  toggleLeftPanel: () => set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),

  // Project
  projectName: '',
  projectModified: false,
  lastSavedTime: null,
  projectOperationType: 'cnc',
  activeProjectPath: null,
  activeProjectCreatedAt: null,
  saveState: 'idle',
  saveError: null,
  setProjectName: (name) => set({ projectName: name }),
  setProjectOperationType: (op) => set({ projectOperationType: op }),
  setActiveProjectPath: (path, createdAt = null) =>
    set({ activeProjectPath: path, activeProjectCreatedAt: createdAt }),
  setSaveState: (state, error = null) => set({ saveState: state, saveError: error }),
  markModified: () => set({ projectModified: true }),
  markSaved: () => set({
    projectModified: false,
    lastSavedTime: new Date().toISOString(),
    saveState: 'idle',
    saveError: null,
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
