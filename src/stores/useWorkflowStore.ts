import { create } from 'zustand'
import type { SavedMacro, SavedPosition, WorkflowStep } from '@/lib/types'

interface WorkflowState {
  // Macros
  macros: SavedMacro[]
  addMacro: (macro: SavedMacro) => void
  removeMacro: (id: string) => void

  // Posiciones guardadas
  positions: SavedPosition[]
  addPosition: (pos: SavedPosition) => void
  removePosition: (id: string) => void

  // Workflow queue
  steps: WorkflowStep[]
  currentStepIndex: number
  workflowRunning: boolean
  addStep: (step: WorkflowStep) => void
  updateStep: (id: string, data: Partial<Omit<WorkflowStep, 'id'>>) => void
  removeStep: (id: string) => void
  moveStep: (fromIndex: number, toIndex: number) => void
  setStepStatus: (id: string, status: WorkflowStep['status']) => void
  startWorkflow: () => void
  stopWorkflow: () => void
  advanceStep: () => void
  resetWorkflow: () => void
  clearSteps: () => void

  // Highlight para step recién añadido
  highlightStepId: string | null
  clearHighlight: () => void

  // GCode actual en ejecución
  activeGCode: string
  activeGCodeName: string
  activeGCodeLine: number
  activeGCodeTotal: number
  setActiveGCode: (name: string, gcode: string) => void
  setActiveGCodeLine: (line: number) => void
  clearActiveGCode: () => void

  // Simulación
  simulating: boolean
  simPaused: boolean
  simSpeed: number  // ms por línea
  simulatedPos: { x: number; y: number; z: number }
  simulatedFeed: number
  simulatedSpindle: number
  setSimulating: (v: boolean) => void
  setSimPaused: (v: boolean) => void
  setSimSpeed: (ms: number) => void
  setSimulatedPos: (pos: { x: number; y: number; z: number }) => void
  setSimulatedFeed: (f: number) => void
  setSimulatedSpindle: (s: number) => void
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  // Macros de usuario (los built-ins se generan dinamicamente en UI segun operationType)
  macros: [],
  addMacro: (macro) => set((s) => ({ macros: [...s.macros, macro] })),
  removeMacro: (id) => set((s) => ({ macros: s.macros.filter((m) => m.id !== id) })),

  // Posiciones
  positions: [
    { id: 'origin', name: 'Origen', x: 0, y: 0, z: 0 },
  ],
  addPosition: (pos) => set((s) => ({ positions: [...s.positions, pos] })),
  removePosition: (id) => set((s) => ({ positions: s.positions.filter((p) => p.id !== id) })),

  // Workflow
  steps: [],
  currentStepIndex: -1,
  workflowRunning: false,
  highlightStepId: null,
  clearHighlight: () => set({ highlightStepId: null }),
  addStep: (step) => set((s) => ({ steps: [...s.steps, step], highlightStepId: step.id })),
  updateStep: (id, data) =>
    set((s) => ({ steps: s.steps.map((st) => (st.id === id ? { ...st, ...data } : st)) })),
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

  // Simulación
  simulating: false,
  simPaused: false,
  simSpeed: 50,
  simulatedPos: { x: 0, y: 0, z: 0 },
  simulatedFeed: 0,
  simulatedSpindle: 0,
  setSimulating: (v) => set({ simulating: v, simPaused: false }),
  setSimPaused: (v) => set({ simPaused: v }),
  setSimSpeed: (ms) => set({ simSpeed: ms }),
  setSimulatedPos: (pos) => set({ simulatedPos: pos }),
  setSimulatedFeed: (f) => set({ simulatedFeed: f }),
  setSimulatedSpindle: (s) => set({ simulatedSpindle: s }),
}))
