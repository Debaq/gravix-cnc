import { create } from 'zustand'
import type { SavedMacro, SavedPosition, WorkflowStep } from '@/lib/types'

interface WorkflowState {
  // Macros
  macros: SavedMacro[]
  addMacro: (macro: SavedMacro) => void
  removeMacro: (id: string) => void
  updateMacro: (id: string, data: Partial<SavedMacro>) => void

  // Posiciones guardadas
  positions: SavedPosition[]
  addPosition: (pos: SavedPosition) => void
  removePosition: (id: string) => void
  updatePosition: (id: string, data: Partial<SavedPosition>) => void

  // Workflow queue
  steps: WorkflowStep[]
  currentStepIndex: number
  workflowRunning: boolean
  addStep: (step: WorkflowStep) => void
  removeStep: (id: string) => void
  moveStep: (fromIndex: number, toIndex: number) => void
  setStepStatus: (id: string, status: WorkflowStep['status']) => void
  startWorkflow: () => void
  stopWorkflow: () => void
  advanceStep: () => void
  resetWorkflow: () => void
  clearSteps: () => void

  // GCode actual en ejecución
  activeGCode: string
  activeGCodeName: string
  activeGCodeLine: number
  activeGCodeTotal: number
  setActiveGCode: (name: string, gcode: string) => void
  setActiveGCodeLine: (line: number) => void
  clearActiveGCode: () => void
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  // Macros - presets de ejemplo
  macros: [
    { id: 'probe-z', name: 'Probe Z', gcode: 'G38.2 Z-20 F100\nG10 L20 P1 Z0\nG0 Z5', icon: 'probe' },
    { id: 'spindle-on', name: 'Spindle ON', gcode: 'M3 S12000', icon: 'cog' },
    { id: 'spindle-off', name: 'Spindle OFF', gcode: 'M5', icon: 'cog' },
    { id: 'coolant-on', name: 'Coolant ON', gcode: 'M8', icon: 'droplet' },
    { id: 'coolant-off', name: 'Coolant OFF', gcode: 'M9', icon: 'droplet' },
  ],
  addMacro: (macro) => set((s) => ({ macros: [...s.macros, macro] })),
  removeMacro: (id) => set((s) => ({ macros: s.macros.filter((m) => m.id !== id) })),
  updateMacro: (id, data) =>
    set((s) => ({ macros: s.macros.map((m) => (m.id === id ? { ...m, ...data } : m)) })),

  // Posiciones
  positions: [
    { id: 'origin', name: 'Origen', x: 0, y: 0, z: 0 },
  ],
  addPosition: (pos) => set((s) => ({ positions: [...s.positions, pos] })),
  removePosition: (id) => set((s) => ({ positions: s.positions.filter((p) => p.id !== id) })),
  updatePosition: (id, data) =>
    set((s) => ({ positions: s.positions.map((p) => (p.id === id ? { ...p, ...data } : p)) })),

  // Workflow
  steps: [],
  currentStepIndex: -1,
  workflowRunning: false,
  addStep: (step) => set((s) => ({ steps: [...s.steps, step] })),
  removeStep: (id) => set((s) => ({ steps: s.steps.filter((st) => st.id !== id) })),
  moveStep: (from, to) =>
    set((s) => {
      const arr = [...s.steps]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return { steps: arr }
    }),
  setStepStatus: (id, status) =>
    set((s) => ({ steps: s.steps.map((st) => (st.id === id ? { ...st, status } : st)) })),
  startWorkflow: () => set({ workflowRunning: true, currentStepIndex: 0 }),
  stopWorkflow: () => set({ workflowRunning: false }),
  advanceStep: () =>
    set((s) => {
      const next = s.currentStepIndex + 1
      if (next >= s.steps.length) {
        return { currentStepIndex: -1, workflowRunning: false }
      }
      return { currentStepIndex: next }
    }),
  resetWorkflow: () =>
    set((s) => ({
      currentStepIndex: -1,
      workflowRunning: false,
      steps: s.steps.map((st) => ({ ...st, status: 'pending' as const })),
    })),
  clearSteps: () => set({ steps: [], currentStepIndex: -1, workflowRunning: false }),

  // GCode activo
  activeGCode: '',
  activeGCodeName: '',
  activeGCodeLine: 0,
  activeGCodeTotal: 0,
  setActiveGCode: (name, gcode) =>
    set({
      activeGCodeName: name,
      activeGCode: gcode,
      activeGCodeLine: 0,
      activeGCodeTotal: gcode.split('\n').filter((l) => l.trim()).length,
    }),
  setActiveGCodeLine: (line) => set({ activeGCodeLine: line }),
  clearActiveGCode: () =>
    set({ activeGCode: '', activeGCodeName: '', activeGCodeLine: 0, activeGCodeTotal: 0 }),
}))
