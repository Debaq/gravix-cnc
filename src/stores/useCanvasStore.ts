import { create } from 'zustand'
import type { CanvasElement, WorkArea, GlobalConfig, RasterData, Layer } from '@/lib/types'
import { useGCodeStore } from '@/stores/useGCodeStore'

export interface SelectedObjectProps {
  x: number
  y: number
  width: number
  height: number
  angle: number
}

interface CanvasState {
  // Elements
  elements: CanvasElement[]
  selectedElementId: string | null
  selectedElements: CanvasElement[]
  isGroupSelection: boolean
  showPropertiesPanel: boolean

  // Work area
  workArea: WorkArea

  // Grid
  gridSize: number
  showGrid: boolean

  // SVG info
  svgX: number
  svgY: number
  svgWidth: number
  svgHeight: number
  proportionalScale: boolean

  // Selected object properties (in mm, relative to work area origin)
  selectedObjectProps: SelectedObjectProps | null

  // Config status
  configStatus: 'unified' | 'multiple' | 'none'

  // Global config
  globalConfig: GlobalConfig

  // Raster data
  rasterData: RasterData | null

  // Snap
  snapToGrid: boolean
  snapToObjects: boolean
  snapThreshold: number

  // Drawing mode
  drawingMode: 'line' | 'arc' | 'bezier' | 'cota' | null

  // Measuring mode: 'distance' (2 clicks), 'angle' (3 clicks), or false
  measuringMode: 'distance' | 'angle' | false

  // Trim mode
  trimMode: boolean

  // Extend mode
  extendMode: boolean

  // Node editing mode
  nodeEditingElementId: string | null
  nodeEditSelectedNode: number   // índice del nodo seleccionado, -1 = ninguno
  nodeConstraints: { id: string; type: string; nodeIndex: number }[]

  // Layers
  layers: Layer[]
  activeLayerId: string

  // Per-operation-type remembered defaults (last used tool/material)
  operationDefaults: Record<string, { tool: string; material: string }>

  // Actions
  addElement: (element: CanvasElement) => void
  removeElement: (id: string) => void
  updateElement: (id: string, updates: Partial<CanvasElement>) => void
  setElements: (elements: CanvasElement[]) => void
  selectElement: (id: string | null) => void
  setSelectedElements: (elements: CanvasElement[]) => void
  setIsGroupSelection: (is: boolean) => void
  setShowPropertiesPanel: (show: boolean) => void
  setWorkArea: (wa: WorkArea) => void
  setGridSize: (size: number) => void
  toggleGrid: () => void
  setSvgDimensions: (dims: { x?: number; y?: number; width?: number; height?: number }) => void
  toggleProportionalScale: () => void
  setSelectedObjectProps: (props: SelectedObjectProps | null) => void
  setGlobalConfig: (config: Partial<GlobalConfig>) => void
  setRasterData: (data: RasterData | null) => void
  toggleSnapToGrid: () => void
  toggleSnapToObjects: () => void
  setDrawingMode: (mode: 'line' | 'arc' | 'bezier' | 'cota' | null) => void
  setMeasuringMode: (mode: 'distance' | 'angle' | false) => void
  setTrimMode: (active: boolean) => void
  setExtendMode: (active: boolean) => void
  setNodeEditing: (elementId: string | null) => void
  setNodeConstraints: (constraints: { id: string; type: string; nodeIndex: number }[]) => void
  setNodeEditSelectedNode: (index: number) => void
  updateConfigStatus: () => void

  // Layer actions
  addLayer: (name?: string, color?: string) => void
  removeLayer: (id: string) => void
  updateLayer: (id: string, updates: Partial<Layer>) => void
  reorderLayers: (layers: Layer[]) => void
  setActiveLayer: (id: string) => void
  moveElementToLayer: (elementId: string, layerId: string) => void

  findElementById: (id: string) => CanvasElement | undefined
  getElementConfig: (element: CanvasElement) => GlobalConfig
  applyInitialDefaults: (tools: { id: string; category: string }[], materials: { id: string; category: string }[]) => void
}

const defaultGlobalConfig: GlobalConfig = {
  operationType: 'cnc',
  tool: '',
  material: '',
  workType: 'outline',
  feedRate: 800,
  plungeRate: 400,
  spindleRPM: 10000,
  laserPower: 80,
  passes: 1,
  depth: -3,
  depthStep: 1,
  toolDiameter: 3.175,
  compensation: 'center',
  stepover: 0.5,
  pocketStrategy: 'contour-parallel',
  pressure: 15,
  speed: 100,
  pressureZ: -1,
  // Láser avanzado
  laserMode: 'cut',
  laserDynamic: false,
  fillAngle: 0,
  fillSpacing: 0.5,
  fillBidirectional: true,
  overscan: 2,
  // Ráster
  rasterDpi: 254,
  rasterDithering: 'floydSteinberg',
  rasterThreshold: 128,
  rasterInvert: false,
  rasterBidirectional: true,
  // Tabs/soportes
  tabsEnabled: false,
  tabWidth: 5,
  tabHeight: 1,
  tabCount: 4,
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // Elements
  elements: [],
  selectedElementId: null,
  selectedElements: [],
  isGroupSelection: false,
  showPropertiesPanel: false,

  // Work area
  workArea: { width: 400, height: 400, origin: 'bottom-left' },

  // Grid
  gridSize: 20,
  showGrid: true,

  // SVG info
  svgX: 0,
  svgY: 0,
  svgWidth: 0,
  svgHeight: 0,
  proportionalScale: true,

  // Selected object properties
  selectedObjectProps: null,

  // Config status
  configStatus: 'unified',

  // Global config
  globalConfig: { ...defaultGlobalConfig },

  // Raster data
  rasterData: null,

  // Snap
  snapToGrid: true,
  snapToObjects: true,
  snapThreshold: 5,

  // Drawing mode
  drawingMode: null,

  // Measuring mode
  measuringMode: false,

  // Trim mode
  trimMode: false,

  // Extend mode
  extendMode: false,

  // Node editing mode
  nodeEditingElementId: null,
  nodeEditSelectedNode: -1,
  nodeConstraints: [],

  // Layers
  layers: [
    { id: 'layer_001', name: 'Capa 1', color: '#333333', visible: true, locked: false, order: 0, config: null }
  ],
  activeLayerId: 'layer_001',

  // Per-operation-type defaults (initial defaults, overwritten by last used)
  operationDefaults: {
    cnc: { tool: 'cnc_001', material: 'mat_wood_004' },
    laser: { tool: 'laser_002', material: 'mat_wood_004' },
    plotter: { tool: 'plotter_001', material: '' },
    pencil: { tool: 'pencil_001', material: '' },
  },

  // Actions
  addElement: (element) =>
    set((state) => ({ 
      elements: [...state.elements, { ...element, layerId: element.layerId || state.activeLayerId }] 
    })),

  removeElement: (id) =>
    set((state) => ({
      elements: state.elements.filter((e) => e.id !== id),
    })),

  updateElement: (id, updates) =>
    set((state) => {
      const elements = state.elements.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      )
      // Mark gcode stale when config or operations change
      if ('config' in updates || 'operations' in updates) {
        const gcState = useGCodeStore.getState()
        if (gcState.gcodeGenerated) {
          gcState.setGCodeNeedsRegeneration(true)
        }
        const hasCustom = elements.some(
          (el) => el.config !== null || el.children?.some((c) => c.config !== null)
        )
        return { elements, configStatus: hasCustom ? 'multiple' as const : 'unified' as const }
      }
      return { elements }
    }),

  setElements: (elements) => set({ elements }),

  selectElement: (id) => set({ selectedElementId: id }),

  setSelectedElements: (elements) => set({ selectedElements: elements }),

  setIsGroupSelection: (is) => set({ isGroupSelection: is }),

  setShowPropertiesPanel: (show) => set({ showPropertiesPanel: show }),

  setWorkArea: (wa) => set({ workArea: wa }),

  setGridSize: (size) => set({ gridSize: size }),

  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),

  setSvgDimensions: (dims) =>
    set((state) => ({
      svgX: dims.x ?? state.svgX,
      svgY: dims.y ?? state.svgY,
      svgWidth: dims.width ?? state.svgWidth,
      svgHeight: dims.height ?? state.svgHeight,
    })),

  toggleProportionalScale: () =>
    set((state) => ({ proportionalScale: !state.proportionalScale })),

  setSelectedObjectProps: (props) => set({ selectedObjectProps: props }),

  setGlobalConfig: (config) => {
    const gcState = useGCodeStore.getState()
    if (gcState.gcodeGenerated) {
      gcState.setGCodeNeedsRegeneration(true)
    }
    return set((state) => {
      const prevType = state.globalConfig.operationType
      const newType = config.operationType ?? prevType
      let merged = { ...state.globalConfig, ...config }
      let newDefaults = state.operationDefaults

      // Save current tool/material as default for the current operation type
      if (config.tool !== undefined || config.material !== undefined) {
        newDefaults = {
          ...newDefaults,
          [prevType]: {
            tool: config.tool ?? state.globalConfig.tool,
            material: config.material ?? state.globalConfig.material,
          },
        }
      }

      // When switching operation type, load saved defaults for the new type
      if (config.operationType && config.operationType !== prevType) {
        // Save current state for the old type
        newDefaults = {
          ...newDefaults,
          [prevType]: {
            tool: state.globalConfig.tool,
            material: state.globalConfig.material,
          },
        }
        // Apply saved defaults for the new type
        const saved = newDefaults[config.operationType]
        if (saved) {
          merged = { ...merged, tool: saved.tool, material: saved.material }
        }
      }

      return { globalConfig: merged, operationDefaults: newDefaults }
    })
  },

  setRasterData: (data) => set({ rasterData: data }),

  toggleSnapToGrid: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
  toggleSnapToObjects: () => set((state) => ({ snapToObjects: !state.snapToObjects })),
  setDrawingMode: (mode) => set({ drawingMode: mode, measuringMode: false }),
  setMeasuringMode: (mode) => set({ measuringMode: mode, drawingMode: null, trimMode: false }),
  setTrimMode: (active) => set({ trimMode: active, extendMode: false, drawingMode: null, measuringMode: false }),
  setExtendMode: (active) => set({ extendMode: active, trimMode: false, drawingMode: null, measuringMode: false }),
  setNodeEditing: (elementId) => set({ nodeEditingElementId: elementId, nodeEditSelectedNode: -1, nodeConstraints: [] }),
  setNodeConstraints: (constraints) => set({ nodeConstraints: constraints }),
  setNodeEditSelectedNode: (index) => set({ nodeEditSelectedNode: index }),

  updateConfigStatus: () => {
    const { elements } = get()
    const hasCustomConfig = elements.some((el) => {
      if (el.config) return true
      if (el.children) {
        return el.children.some((c) => c.config)
      }
      return false
    })
    set({ configStatus: hasCustomConfig ? 'multiple' : 'unified' })
  },

  addLayer: (name, color) => set((state) => {
    const id = `layer_${Date.now()}`
    const newLayer: Layer = {
      id,
      name: name || `Capa ${state.layers.length + 1}`,
      color: color || '#333333',
      visible: true,
      locked: false,
      order: state.layers.length,
      config: null
    }
    return { 
      layers: [...state.layers, newLayer],
      activeLayerId: id
    }
  }),

  removeLayer: (id) => set((state) => {
    if (state.layers.length <= 1) return state // Mantener al menos una
    const layers = state.layers.filter(l => l.id !== id)
    let activeLayerId = state.activeLayerId
    if (activeLayerId === id) {
      activeLayerId = layers[0].id
    }
    // Mover elementos de la capa eliminada a la capa activa
    const elements = state.elements.map(el => 
      el.layerId === id ? { ...el, layerId: activeLayerId } : el
    )
    return { layers, activeLayerId, elements }
  }),

  updateLayer: (id, updates) => set((state) => ({
    layers: state.layers.map(l => l.id === id ? { ...l, ...updates } : l)
  })),

  reorderLayers: (layers) => set({ layers }),

  setActiveLayer: (id) => set({ activeLayerId: id }),

  moveElementToLayer: (elementId, layerId) => set((state) => ({
    elements: state.elements.map(el => el.id === elementId ? { ...el, layerId } : el)
  })),

  findElementById: (id) => {
    const { elements } = get()
    for (const el of elements) {
      if (el.id === id) return el
      if (el.children) {
        const child = el.children.find((c) => c.id === id)
        if (child) return child
      }
    }
    return undefined
  },

  getElementConfig: (element) => {
    const { elements, globalConfig } = get()
    if (element.config) return element.config
    if (element.parent) {
      const parent = elements.find((e) => e.id === element.parent)
      if (parent?.config) return parent.config
    }
    return globalConfig
  },

  applyInitialDefaults: (tools, materials) => {
    const { globalConfig, operationDefaults } = get()
    const opType = globalConfig.operationType

    // Validate saved defaults exist in loaded data, build corrected defaults
    const corrected = { ...operationDefaults }
    for (const [type, saved] of Object.entries(corrected)) {
      const toolExists = !saved.tool || tools.some((t) => t.id === saved.tool)
      const matExists = !saved.material || materials.some((m) => m.id === saved.material)
      if (!toolExists) {
        const first = tools.find((t) => t.category === type)
        corrected[type] = { ...saved, tool: first?.id ?? '' }
      }
      if (!matExists) {
        corrected[type] = { ...corrected[type], material: '' }
      }
    }

    // Apply default for current operation type if no tool/material set
    const currentDef = corrected[opType]
    const updates: Partial<GlobalConfig> = {}
    if (!globalConfig.tool && currentDef?.tool) {
      updates.tool = currentDef.tool
      // Also apply tool params
      const tool = tools.find((t) => t.id === currentDef.tool) as Record<string, unknown> | undefined
      if (tool) {
        if (tool.diameter) updates.toolDiameter = tool.diameter as number
        if (tool.feedRate) updates.feedRate = tool.feedRate as number
        if (tool.plungeRate) updates.plungeRate = tool.plungeRate as number
        if (tool.rpm) updates.spindleRPM = tool.rpm as number
      }
    }
    if (!globalConfig.material && currentDef?.material) {
      updates.material = currentDef.material
    }

    if (Object.keys(updates).length > 0) {
      set((state) => ({
        globalConfig: { ...state.globalConfig, ...updates },
        operationDefaults: corrected,
      }))
    } else {
      set({ operationDefaults: corrected })
    }
  },
}))
