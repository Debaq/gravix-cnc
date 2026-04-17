import { create } from 'zustand'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import type { GlobalConfig } from '@/lib/types'

export interface CAMOperation {
  id: string
  elementId: string
  elementName: string
  operationIndex: number // -1 = element.config, 0+ = element.operations[i]
  config: GlobalConfig
  enabled: boolean
  status: 'valid' | 'warning' | 'error'
  warnings: string[]
}

export type CAMMarkerType = 'pause' | 'tool-change' | 'message'

export interface ParkPosition {
  x: number
  y: number
  z: number
}

export interface CAMMarker {
  id: string
  type: CAMMarkerType
  message: string
  progress: number // 0-100 — position on the timeline
  parkPosition: ParkPosition // where tool goes during pause
}

export interface CAMClamp {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number // footprint size (XY plane)
  zHeight: number // physical height in mm (0 = infinite, always avoid)
}

export interface CAMSetup {
  safeZ: number // retraction height (mm)
  toolChangePosition: ParkPosition // center of tool change area
  toolChangeSize: { width: number; height: number } // area size (0 = point)
  clamps: CAMClamp[] // visual clamp positions
}

interface CAMState {
  operations: CAMOperation[]
  markers: CAMMarker[]
  setup: CAMSetup
  selectedOperationId: string | null
  selectedMarkerId: string | null
  soloOperationId: string | null
  operationOrder: string[]

  // Actions
  syncFromCanvas: () => void
  selectOperation: (id: string | null) => void
  selectMarker: (id: string | null) => void
  toggleOperationEnabled: (id: string) => void
  soloOperation: (id: string | null) => void
  updateOperationConfig: (id: string, updates: Partial<GlobalConfig>) => void
  reorderOperations: (fromIndex: number, toIndex: number) => void
  validateOperation: (op: CAMOperation) => { status: 'valid' | 'warning' | 'error'; warnings: string[] }
  // Timeline markers
  addTimelineMarker: (progress: number, type: CAMMarkerType) => void
  updateMarker: (id: string, updates: Partial<Pick<CAMMarker, 'message' | 'type' | 'progress' | 'parkPosition'>>) => void
  removeMarker: (id: string) => void
  updateParkPosition: (id: string, pos: Partial<ParkPosition>) => void
  // CAM setup
  updateSetup: (updates: Partial<CAMSetup>) => void
  addClamp: () => void
  updateClamp: (id: string, updates: Partial<Omit<CAMClamp, 'id'>>) => void
  removeClamp: (id: string) => void
}

function validateOp(op: CAMOperation): { status: 'valid' | 'warning' | 'error'; warnings: string[] } {
  const warnings: string[] = []
  const cfg = op.config

  if (cfg.operationType === 'cnc') {
    if (!cfg.tool) {
      return { status: 'error', warnings: ['Selecciona una herramienta'] }
    }
    if (cfg.depth === 0) {
      warnings.push('Profundidad = 0')
    }
    if (cfg.depthStep <= 0) {
      warnings.push('Paso de profundidad invalido')
    }
    if (cfg.feedRate <= 0) {
      warnings.push('Feedrate = 0')
    }
  }

  if (cfg.operationType === 'laser') {
    if (cfg.laserPower <= 0) {
      warnings.push('Potencia laser = 0')
    }
    if (cfg.feedRate <= 0) {
      warnings.push('Velocidad = 0')
    }
  }

  return {
    status: warnings.length > 0 ? 'warning' : 'valid',
    warnings,
  }
}

const DEFAULT_PARK: ParkPosition = { x: 0, y: 0, z: 30 }

const DEFAULT_SETUP: CAMSetup = {
  safeZ: 5,
  toolChangePosition: { x: 0, y: 0, z: 30 },
  toolChangeSize: { width: 0, height: 0 },
  clamps: [],
}

export const useCAMStore = create<CAMState>((set, get) => ({
  operations: [],
  markers: [],
  setup: { ...DEFAULT_SETUP },
  selectedOperationId: null,
  selectedMarkerId: null,
  soloOperationId: null,
  operationOrder: [],

  syncFromCanvas: () => {
    const { elements, globalConfig, getElementConfig, layers } = useCanvasStore.getState()
    const ops: CAMOperation[] = []

    const sortedLayers = [...layers].sort((a, b) => a.order - b.order)
    const layerOrder = new Map(sortedLayers.map((l, i) => [l.id, i]))

    const visibleElements = elements.filter((el) => {
      if (!el.visible || el.type === 'cota') return false
      if (el.layerId) {
        const layer = layers.find((l) => l.id === el.layerId)
        if (layer && !layer.visible) return false
      }
      return true
    })

    visibleElements.sort((a, b) => {
      const la = a.layerId ? (layerOrder.get(a.layerId) ?? 999) : 999
      const lb = b.layerId ? (layerOrder.get(b.layerId) ?? 999) : 999
      return la - lb
    })

    for (const el of visibleElements) {
      const hasMultiOps = el.operations && el.operations.length > 0

      if (hasMultiOps) {
        for (let i = 0; i < el.operations!.length; i++) {
          const config = el.operations![i]
          const op: CAMOperation = {
            id: `${el.id}:op${i}`,
            elementId: el.id,
            elementName: el.name,
            operationIndex: i,
            config,
            enabled: true,
            status: 'valid',
            warnings: [],
          }
          const v = validateOp(op)
          op.status = v.status
          op.warnings = v.warnings
          ops.push(op)
        }
      } else {
        const config = getElementConfig(el)
        const op: CAMOperation = {
          id: `${el.id}:op-1`,
          elementId: el.id,
          elementName: el.name,
          operationIndex: -1,
          config,
          enabled: true,
          status: 'valid',
          warnings: [],
        }
        const v = validateOp(op)
        op.status = v.status
        op.warnings = v.warnings
        ops.push(op)
      }
    }

    // Preserve enabled state from previous sync
    const prev = get()
    const prevMap = new Map(prev.operations.map((o) => [o.id, o]))
    for (const op of ops) {
      const existing = prevMap.get(op.id)
      if (existing) {
        op.enabled = existing.enabled
      }
    }

    let ordered: string[]
    if (prev.operationOrder.length > 0) {
      const newIds = new Set(ops.map((o) => o.id))
      const kept = prev.operationOrder.filter((id) => newIds.has(id))
      const added = ops.filter((o) => !prev.operationOrder.includes(o.id)).map((o) => o.id)
      ordered = [...kept, ...added]
    } else {
      ordered = ops.map((o) => o.id)
    }

    const selectedStillExists = prev.selectedOperationId && ops.some((o) => o.id === prev.selectedOperationId)

    set({
      operations: ops,
      operationOrder: ordered,
      selectedOperationId: selectedStillExists ? prev.selectedOperationId : null,
      soloOperationId: prev.soloOperationId && ops.some((o) => o.id === prev.soloOperationId) ? prev.soloOperationId : null,
    })
  },

  selectOperation: (id) => set({ selectedOperationId: id, selectedMarkerId: null }),

  selectMarker: (id) => set({ selectedMarkerId: id, selectedOperationId: null }),

  toggleOperationEnabled: (id) =>
    set((s) => ({
      operations: s.operations.map((op) =>
        op.id === id ? { ...op, enabled: !op.enabled } : op,
      ),
    })),

  soloOperation: (id) =>
    set((s) => ({ soloOperationId: s.soloOperationId === id ? null : id })),

  updateOperationConfig: (id, updates) => {
    const state = get()
    const op = state.operations.find((o) => o.id === id)
    if (!op) return

    const newConfig = { ...op.config, ...updates }

    const { updateElement, findElementById } = useCanvasStore.getState()
    const element = findElementById(op.elementId)
    if (!element) return

    if (op.operationIndex === -1) {
      updateElement(op.elementId, { config: newConfig })
    } else {
      const ops = [...(element.operations ?? [])]
      ops[op.operationIndex] = newConfig
      updateElement(op.elementId, { operations: ops })
    }

    const newOp = { ...op, config: newConfig }
    const v = validateOp(newOp)
    newOp.status = v.status
    newOp.warnings = v.warnings

    set((s) => ({
      operations: s.operations.map((o) => (o.id === id ? newOp : o)),
    }))
  },

  reorderOperations: (fromIndex, toIndex) =>
    set((s) => {
      const order = [...s.operationOrder]
      const [moved] = order.splice(fromIndex, 1)
      order.splice(toIndex, 0, moved)
      return { operationOrder: order }
    }),

  validateOperation: (op) => validateOp(op),

  // Timeline markers — placed at any progress % on the timeline
  addTimelineMarker: (progress, type) => {
    const marker: CAMMarker = {
      id: `m:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      message: type === 'pause' ? 'Pausa' : type === 'tool-change' ? 'Cambiar herramienta' : '',
      progress: Math.max(0, Math.min(100, progress)),
      parkPosition: { ...DEFAULT_PARK },
    }
    set((s) => ({
      markers: [...s.markers, marker].sort((a, b) => a.progress - b.progress),
      selectedMarkerId: marker.id,
    }))
  },

  updateMarker: (id, updates) =>
    set((s) => ({
      markers: s.markers
        .map((m) => (m.id === id ? { ...m, ...updates } : m))
        .sort((a, b) => a.progress - b.progress),
    })),

  removeMarker: (id) =>
    set((s) => ({
      markers: s.markers.filter((m) => m.id !== id),
      selectedMarkerId: s.selectedMarkerId === id ? null : s.selectedMarkerId,
    })),

  updateParkPosition: (id, pos) =>
    set((s) => ({
      markers: s.markers.map((m) =>
        m.id === id ? { ...m, parkPosition: { ...m.parkPosition, ...pos } } : m,
      ),
    })),

  // CAM setup
  updateSetup: (updates) =>
    set((s) => ({ setup: { ...s.setup, ...updates } })),

  addClamp: () => {
    set((s) => ({
      setup: {
        ...s.setup,
        clamps: [
          ...s.setup.clamps,
          {
            id: `clamp-${Date.now()}`,
            label: `Clamp ${s.setup.clamps.length + 1}`,
            x: 10,
            y: 10,
            width: 30,
            height: 15,
            zHeight: 0, // 0 = infinite
          },
        ],
      },
    }))
    const gc = useGCodeStore.getState()
    if (gc.gcodeGenerated) gc.setGCodeNeedsRegeneration(true)
  },

  updateClamp: (id, updates) => {
    set((s) => ({
      setup: {
        ...s.setup,
        clamps: s.setup.clamps.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      },
    }))
    const gc = useGCodeStore.getState()
    if (gc.gcodeGenerated) gc.setGCodeNeedsRegeneration(true)
  },

  removeClamp: (id) => {
    set((s) => ({
      setup: {
        ...s.setup,
        clamps: s.setup.clamps.filter((c) => c.id !== id),
      },
    }))
    const gc = useGCodeStore.getState()
    if (gc.gcodeGenerated) gc.setGCodeNeedsRegeneration(true)
  },
}))
