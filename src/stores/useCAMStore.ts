import { create } from 'zustand'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { normalizeConfig } from '@/lib/config-defaults'
import { pushHistory } from '@/lib/history-bridge'
import type { GlobalConfig, Stock } from '@/lib/types'

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
  stock: Stock // bloque de material sobre la mesa
  /** Reordena las operaciones por cercania antes de generar. */
  optimizeOrder: boolean
}

interface CAMState {
  operations: CAMOperation[]
  markers: CAMMarker[]
  setup: CAMSetup
  selectedOperationId: string | null
  selectedMarkerId: string | null
  soloOperationId: string | null
  operationOrder: string[]
  /** Ids apagados que vinieron del proyecto y aun no se reconciliaron. */
  restoredDisabled?: Set<string>

  // Actions
  syncFromCanvas: () => void
  selectOperation: (id: string | null) => void
  selectMarker: (id: string | null) => void
  toggleOperationEnabled: (id: string) => void
  soloOperation: (id: string | null) => void
  updateOperationConfig: (id: string, updates: Partial<GlobalConfig>) => void
  reorderOperations: (fromIndex: number, toIndex: number) => void
  /** Mueve `dragId` justo antes de `targetId` en el orden del arbol. */
  moveOperationBefore: (dragId: string, targetId: string) => void
  /** Agrega una operacion mas al elemento de `id`, copiando su config. */
  addOperation: (opId: string) => void
  duplicateOperation: (opId: string) => void
  /** Solo se puede borrar si al elemento le queda al menos una operacion. */
  removeOperation: (opId: string) => boolean
  /** Copia la config de `opId` a todas las operaciones del mismo tipo. */
  applyConfigToAll: (opId: string, onlySameWorkType?: boolean) => number
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
  // Persistencia en el proyecto
  serialize: () => CAMSnapshot
  restore: (snapshot: CAMSnapshot | null | undefined) => void
}

/** Lo que del CAM vale la pena guardar en el proyecto. */
export interface CAMSnapshot {
  setup: CAMSetup
  markers: CAMMarker[]
  operationOrder: string[]
  disabledOperations: string[]
}

function validateOp(op: CAMOperation, stock?: Stock): { status: 'valid' | 'warning' | 'error'; warnings: string[] } {
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

    // Profundidad contra el bloque de material definido en el setup
    if (stock?.enabled && stock.thickness > 0) {
      const cut = Math.abs(cfg.depth)
      if (cut > stock.thickness + 0.001) {
        warnings.push(`Corta ${cut.toFixed(1)}mm en un stock de ${stock.thickness}mm`)
      } else if (cfg.workType === 'outside' || cfg.workType === 'inside' || cfg.workType === 'outline') {
        if (cut < stock.thickness) {
          warnings.push(`El corte no atraviesa el stock (${cut.toFixed(1)} de ${stock.thickness}mm)`)
        }
      }
    }

    if (cfg.finishPassEnabled && cfg.finishAllowance <= 0) {
      warnings.push('Pasada de acabado sin sobremedida: no deja material que sacar')
    }
    if (cfg.toolDiameter > 0 && cfg.finishAllowance >= cfg.toolDiameter) {
      warnings.push('Sobremedida mayor que la fresa')
    }
    if (cfg.tabMode === 'manual' && cfg.tabsEnabled && cfg.tabPositions.length === 0) {
      warnings.push('Tabs manuales sin posiciones definidas')
    }
    // Un control que compensa el radio necesita entrar al contorno con un
    // movimiento previo; sin lead-in la compensacion arranca sobre la pieza.
    if (cfg.cutterComp !== 'off' && cfg.leadType === 'none') {
      warnings.push('G41/G42 sin entrada tangente')
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

const DEFAULT_STOCK: Stock = {
  enabled: false,
  auto: true,
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  thickness: 12,
  margin: 5,
  zeroAt: 'top',
}

const DEFAULT_SETUP: CAMSetup = {
  safeZ: 5,
  toolChangePosition: { x: 0, y: 0, z: 30 },
  toolChangeSize: { width: 0, height: 0 },
  clamps: [],
  stock: { ...DEFAULT_STOCK },
  optimizeOrder: false,
}

export const useCAMStore = create<CAMState>((set, get) => ({
  operations: [],
  markers: [],
  setup: { ...DEFAULT_SETUP },
  selectedOperationId: null,
  selectedMarkerId: null,
  soloOperationId: null,
  operationOrder: [],
  restoredDisabled: undefined,

  syncFromCanvas: () => {
    const { elements, getElementConfig, layers } = useCanvasStore.getState()
    const stock = get().setup.stock
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
          const config = normalizeConfig(el.operations![i])
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
          const v = validateOp(op, stock)
          op.status = v.status
          op.warnings = v.warnings
          ops.push(op)
        }
      } else {
        const config = normalizeConfig(getElementConfig(el))
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
        const v = validateOp(op, stock)
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
      } else if (prev.restoredDisabled?.has(op.id)) {
        // Primer sync despues de abrir un proyecto: recupera lo apagado
        op.enabled = false
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
      restoredDisabled: undefined,
      selectedOperationId: selectedStillExists ? prev.selectedOperationId : null,
      soloOperationId: prev.soloOperationId && ops.some((o) => o.id === prev.soloOperationId) ? prev.soloOperationId : null,
    })
  },

  selectOperation: (id) => set({ selectedOperationId: id, selectedMarkerId: null }),

  selectMarker: (id) => set({ selectedMarkerId: id, selectedOperationId: null }),

  toggleOperationEnabled: (id) => {
    set((s) => ({
      operations: s.operations.map((op) =>
        op.id === id ? { ...op, enabled: !op.enabled } : op,
      ),
    }))
    pushHistory()
  },

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
    const v = validateOp(newOp, state.setup.stock)
    newOp.status = v.status
    newOp.warnings = v.warnings

    set((s) => ({
      operations: s.operations.map((o) => (o.id === id ? newOp : o)),
    }))
    // Un arrastre de slider manda decenas de updates del mismo campo: se
    // fusionan en una entrada para no vaciar la pila con un solo gesto.
    pushHistory(`cam-op:${id}:${Object.keys(updates).join(',')}`)
  },

  /**
   * Convierte el elemento a lista de operaciones si todavia no lo es y le
   * agrega una. Un elemento sin `operations` corre una sola operacion tomada
   * de su config (o de la capa/global), asi que esa es la semilla de la lista.
   */
  addOperation: (opId) => {
    const op = get().operations.find((o) => o.id === opId)
    if (!op) return

    const { findElementById, updateElement, getElementConfig } = useCanvasStore.getState()
    const element = findElementById(op.elementId)
    if (!element) return

    const base = element.operations && element.operations.length > 0
      ? element.operations
      : [normalizeConfig(getElementConfig(element))]

    const seed = normalizeConfig(base[base.length - 1])
    updateElement(op.elementId, { operations: [...base, { ...seed }] })
    get().syncFromCanvas()
    set({ selectedOperationId: `${op.elementId}:op${base.length}` })
    pushHistory()
  },

  duplicateOperation: (opId) => {
    const op = get().operations.find((o) => o.id === opId)
    if (!op) return

    const { findElementById, updateElement, getElementConfig } = useCanvasStore.getState()
    const element = findElementById(op.elementId)
    if (!element) return

    const base = element.operations && element.operations.length > 0
      ? element.operations
      : [normalizeConfig(getElementConfig(element))]

    const index = op.operationIndex >= 0 ? op.operationIndex : 0
    const copy = { ...normalizeConfig(base[index] ?? op.config) }
    const next = [...base]
    next.splice(index + 1, 0, copy)

    updateElement(op.elementId, { operations: next })
    get().syncFromCanvas()
    set({ selectedOperationId: `${op.elementId}:op${index + 1}` })
    pushHistory()
  },

  removeOperation: (opId) => {
    const op = get().operations.find((o) => o.id === opId)
    if (!op) return false

    const { findElementById, updateElement } = useCanvasStore.getState()
    const element = findElementById(op.elementId)
    if (!element) return false

    const list = element.operations ?? []
    // Sin lista de operaciones el elemento corre su config implicita: no hay
    // nada que borrar, se apaga con el ojo.
    if (list.length <= 1) return false

    const index = op.operationIndex >= 0 ? op.operationIndex : 0
    const next = list.filter((_, i) => i !== index)
    updateElement(op.elementId, { operations: next })

    set({ selectedOperationId: null })
    get().syncFromCanvas()
    pushHistory()
    return true
  },

  applyConfigToAll: (opId, onlySameWorkType = false) => {
    const state = get()
    const source = state.operations.find((o) => o.id === opId)
    if (!source) return 0

    const targets = state.operations.filter((o) => {
      if (o.id === opId) return false
      if (o.config.operationType !== source.config.operationType) return false
      if (onlySameWorkType && o.config.workType !== source.config.workType) return false
      return true
    })

    for (const target of targets) {
      // El tipo de trabajo de cada operacion se respeta salvo que se pida
      // explicitamente igualarlo: copiar parametros no es re-estrategiar.
      const { workType, ...rest } = source.config
      state.updateOperationConfig(target.id, onlySameWorkType ? { ...rest, workType } : rest)
    }

    if (targets.length > 0) pushHistory()
    return targets.length
  },

  moveOperationBefore: (dragId, targetId) => {
    if (dragId === targetId) return
    const order = get().operationOrder.filter((id) => id !== dragId)
    const at = order.indexOf(targetId)
    if (at < 0) return
    order.splice(at, 0, dragId)

    set({ operationOrder: order })
    const gc = useGCodeStore.getState()
    if (gc.gcodeGenerated) gc.setGCodeNeedsRegeneration(true)
    pushHistory()
  },

  reorderOperations: (fromIndex, toIndex) =>
    set((s) => {
      const order = [...s.operationOrder]
      const [moved] = order.splice(fromIndex, 1)
      order.splice(toIndex, 0, moved)
      return { operationOrder: order }
    }),

  validateOperation: (op) => validateOp(op, get().setup.stock),

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
    pushHistory()
  },

  updateMarker: (id, updates) =>
    set((s) => ({
      markers: s.markers
        .map((m) => (m.id === id ? { ...m, ...updates } : m))
        .sort((a, b) => a.progress - b.progress),
    })),

  removeMarker: (id) => {
    set((s) => ({
      markers: s.markers.filter((m) => m.id !== id),
      selectedMarkerId: s.selectedMarkerId === id ? null : s.selectedMarkerId,
    }))
    pushHistory()
  },

  updateParkPosition: (id, pos) =>
    set((s) => ({
      markers: s.markers.map((m) =>
        m.id === id ? { ...m, parkPosition: { ...m.parkPosition, ...pos } } : m,
      ),
    })),

  // CAM setup
  updateSetup: (updates) => {
    set((s) => ({ setup: { ...s.setup, ...updates } }))
    // Safe Z y stock cambian lo que va a salir generado
    const gc = useGCodeStore.getState()
    if (gc.gcodeGenerated) gc.setGCodeNeedsRegeneration(true)
    pushHistory(`cam-setup:${Object.keys(updates).join(',')}`)
  },

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
    pushHistory()
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
    // Arrastrar el clamp en el visor 3D emite un update por frame
    pushHistory(`cam-clamp:${id}`)
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
    pushHistory()
  },

  serialize: () => {
    const s = get()
    return {
      setup: s.setup,
      markers: s.markers,
      operationOrder: s.operationOrder,
      disabledOperations: s.operations.filter((o) => !o.enabled).map((o) => o.id),
    }
  },

  restore: (snapshot) => {
    if (!snapshot) {
      set({
        setup: { ...DEFAULT_SETUP, stock: { ...DEFAULT_STOCK } },
        markers: [],
        operationOrder: [],
        operations: [],
        selectedOperationId: null,
        selectedMarkerId: null,
        soloOperationId: null,
      })
      return
    }

    // Los campos que no existan en proyectos viejos se completan con el default
    const setup: CAMSetup = {
      ...DEFAULT_SETUP,
      ...snapshot.setup,
      stock: { ...DEFAULT_STOCK, ...(snapshot.setup?.stock ?? {}) },
    }
    const disabled = new Set(snapshot.disabledOperations ?? [])

    set((s) => ({
      setup,
      markers: snapshot.markers ?? [],
      operationOrder: snapshot.operationOrder ?? [],
      // El arbol se rearma en el proximo sync; hasta entonces se respeta el
      // apagado guardado sobre lo que ya haya en memoria.
      operations: s.operations.map((o) => ({ ...o, enabled: !disabled.has(o.id) })),
      selectedOperationId: null,
      selectedMarkerId: null,
      soloOperationId: null,
    }))

    set({ restoredDisabled: disabled })
  },
}))
