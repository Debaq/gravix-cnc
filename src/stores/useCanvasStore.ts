import { create } from 'zustand'
import type { CanvasElement, WorkArea, GlobalConfig, RasterData, Layer, ColorMapping, VectorCleanupConfig } from '@/lib/types'
import { useGCodeStore } from '@/stores/useGCodeStore'
import type { NodeConstraint } from '@/lib/constraints'
import type { SnapKind } from '@/lib/snap-engine'

/** Subconjunto de SnapKind que el usuario puede activar/desactivar. */
export type GeometricSnapKind = Exclude<SnapKind, 'grid'>

export const GEOMETRIC_SNAP_KINDS: GeometricSnapKind[] = [
  'endpoint',
  'midpoint',
  'center',
  'quadrant',
  'intersection',
  'perpendicular',
  'tangent',
  'onEdge',
]

const defaultSnapKinds: Record<GeometricSnapKind, boolean> = {
  endpoint: true,
  midpoint: true,
  center: true,
  quadrant: true,
  intersection: true,
  perpendicular: true,
  tangent: false,
  onEdge: false,
}

/** Modo de dibujo activo. Los tres ultimos se dibujan arrastrando. */
export type DrawingMode =
  | 'line' | 'arc' | 'bezier' | 'cota'
  | 'rect' | 'circle' | 'ellipse'
  | null

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

  // Work area
  workArea: WorkArea

  // Grid
  showGrid: boolean
  /** Paso base de la grilla en mm (la adaptativa parte de aca). */
  gridSpacingMm: number
  /** La grilla se subdivide/agrupa segun el zoom para no saturar ni desaparecer. */
  gridAdaptive: boolean
  /** Reglas en mm en los bordes del lienzo. */
  showRulers: boolean

  // Lectura del lienzo
  /** Posicion del cursor en mm respecto al origen del area de trabajo. */
  cursorMm: { x: number; y: number } | null
  /** Zoom actual del canvas (1 = 100%). */
  zoomLevel: number


  // SVG info
  svgX: number
  svgY: number
  svgWidth: number
  svgHeight: number

  // Selected object properties (in mm, relative to work area origin)
  selectedObjectProps: SelectedObjectProps | null

  // Global config
  globalConfig: GlobalConfig

  // Raster data
  rasterData: RasterData | null

  // Snap
  snapToGrid: boolean
  snapToObjects: boolean
  snapThreshold: number

  // Snaps geometricos (estilo CAD) al dibujar y al mover nodos
  snapGeometry: boolean
  snapKinds: Record<GeometricSnapKind, boolean>

  // Ortho / polar: restringe la direccion al dibujar
  orthoMode: boolean
  orthoAngleDeg: number

  // Drawing mode
  drawingMode: DrawingMode

  // Measuring mode: 'distance' (2 clicks), 'angle' (3 clicks), or false
  measuringMode: 'distance' | 'angle' | false

  // Trim mode
  trimMode: boolean

  // Extend mode
  extendMode: boolean

  // Node editing mode
  nodeEditingElementId: string | null
  nodeEditSelectedNode: number   // índice del nodo seleccionado, -1 = ninguno
  nodeConstraints: NodeConstraint[]

  // Toolbar layout
  toolbarColumns: 1 | 2 | 3
  cycleToolbarColumns: () => void

  // Layers
  layers: Layer[]
  activeLayerId: string

  // Color mappings for laser mode
  colorMappings: ColorMapping[]

  // Limpieza automatica de vectores antes de generar G-code
  vectorCleanup: VectorCleanupConfig


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
  setWorkArea: (wa: WorkArea) => void
  setSvgDimensions: (dims: { x?: number; y?: number; width?: number; height?: number }) => void
  setSelectedObjectProps: (props: SelectedObjectProps | null) => void
  setGlobalConfig: (config: Partial<GlobalConfig>) => void
  setRasterData: (data: RasterData | null) => void
  setGridSpacing: (mm: number) => void
  toggleGridAdaptive: () => void
  toggleRulers: () => void
  setCursorMm: (pos: { x: number; y: number } | null) => void
  setZoomLevel: (zoom: number) => void
  toggleSnapToGrid: () => void
  toggleSnapToObjects: () => void
  toggleSnapGeometry: () => void
  setSnapKind: (kind: GeometricSnapKind, enabled: boolean) => void
  toggleOrtho: () => void
  setOrthoAngle: (deg: number) => void
  setDrawingMode: (mode: DrawingMode) => void
  setMeasuringMode: (mode: 'distance' | 'angle' | false) => void
  setTrimMode: (active: boolean) => void
  setExtendMode: (active: boolean) => void
  setNodeEditing: (elementId: string | null) => void
  setNodeConstraints: (constraints: NodeConstraint[]) => void
  setNodeEditSelectedNode: (index: number) => void

  // Layer actions
  addLayer: (name?: string, color?: string) => void
  removeLayer: (id: string) => void
  updateLayer: (id: string, updates: Partial<Layer>) => void
  reorderLayers: (layers: Layer[]) => void
  setActiveLayer: (id: string) => void
  setColorMappings: (mappings: ColorMapping[]) => void
  setVectorCleanup: (cleanup: Partial<VectorCleanupConfig>) => void
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
  depthStep: 0.5,
  toolDiameter: 3.175,
  stepover: 0.5,
  pocketStrategy: 'contour-parallel',
  pressure: 15,
  speed: 100,
  pressureZ: -1,
  bladeOffset: 0,
  toolLengthOffset: 0,
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
  // Kerf láser
  laserKerf: 0,
  laserLeadIn: 0,
  laserFocusZ: 0,
  // Drill
  drillPeckDepth: 0,
  drillRetract: 2,
  // V-Carve
  vcarveAngle: 90,
  vcarveMaxDepth: 5,
  vcarveStepSize: 0.2,
  vcarveFlatDepth: 0,
  // Rest machining
  restMachiningEnabled: false,
  restToolDiameter: 1,
  // Ramping
  rampEnabled: false,
  rampAngle: 3,
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

  // Work area
  workArea: { width: 400, height: 400, origin: 'bottom-left' },

  // Grid
  showGrid: true,
  gridSpacingMm: 10,
  gridAdaptive: true,
  showRulers: true,

  // Lectura del lienzo
  cursorMm: null,
  zoomLevel: 1,


  // SVG info
  svgX: 0,
  svgY: 0,
  svgWidth: 0,
  svgHeight: 0,

  // Selected object properties
  selectedObjectProps: null,

  // Global config
  globalConfig: { ...defaultGlobalConfig },

  // Raster data
  rasterData: null,

  // Toolbar layout
  toolbarColumns: 1 as 1 | 2 | 3,
  cycleToolbarColumns: () => set((state) => ({
    toolbarColumns: (state.toolbarColumns === 1 ? 2 : state.toolbarColumns === 2 ? 3 : 1) as 1 | 2 | 3,
  })),

  // Snap
  snapToGrid: true,
  snapToObjects: true,
  snapThreshold: 5,

  // Snaps geometricos
  snapGeometry: true,
  snapKinds: { ...defaultSnapKinds },

  // Ortho / polar
  orthoMode: false,
  orthoAngleDeg: 45,

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


  // Default color mappings (LightBurn style)
  colorMappings: [
    { color: '#ff0000', name: 'Corte', mode: 'cut', power: 90, speed: 300, passes: 1, enabled: true },
    { color: '#000000', name: 'Grabado', mode: 'engrave', power: 40, speed: 800, passes: 1, enabled: true },
    { color: '#0000ff', name: 'Marcado', mode: 'engrave', power: 15, speed: 1500, passes: 1, enabled: true },
    { color: '#00ff00', name: 'Fill', mode: 'fill', power: 60, speed: 600, passes: 1, enabled: true },
    { color: '#ffff00', name: 'Corte suave', mode: 'cut', power: 50, speed: 500, passes: 2, enabled: true },
  ],

  vectorCleanup: {
    enabled: true,
    joinTolerance: 0.1,
    tinySpanTolerance: 0.01,
    removeDuplicates: true,
  },

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
      }
      return { elements }
    }),

  setElements: (elements) => set({ elements }),

  selectElement: (id) => set({ selectedElementId: id }),

  setSelectedElements: (elements) => set({ selectedElements: elements }),

  setIsGroupSelection: (is) => set({ isGroupSelection: is }),

  setWorkArea: (wa) => set({ workArea: wa }),

  setSvgDimensions: (dims) =>
    set((state) => ({
      svgX: dims.x ?? state.svgX,
      svgY: dims.y ?? state.svgY,
      svgWidth: dims.width ?? state.svgWidth,
      svgHeight: dims.height ?? state.svgHeight,
    })),

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

  setGridSpacing: (mm) => set({ gridSpacingMm: Math.max(0.1, Math.min(500, mm)) }),
  toggleGridAdaptive: () => set((state) => ({ gridAdaptive: !state.gridAdaptive })),
  toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
  setCursorMm: (pos) => set({ cursorMm: pos }),
  setZoomLevel: (zoom) => set({ zoomLevel: zoom }),
  toggleSnapToGrid: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
  toggleSnapToObjects: () => set((state) => ({ snapToObjects: !state.snapToObjects })),
  toggleSnapGeometry: () => set((state) => ({ snapGeometry: !state.snapGeometry })),
  setSnapKind: (kind, enabled) =>
    set((state) => ({ snapKinds: { ...state.snapKinds, [kind]: enabled } })),
  toggleOrtho: () => set((state) => ({ orthoMode: !state.orthoMode })),
  setOrthoAngle: (deg) => set({ orthoAngleDeg: deg }),
  setDrawingMode: (mode) => set({ drawingMode: mode, measuringMode: false }),
  setMeasuringMode: (mode) => set({ measuringMode: mode, drawingMode: null, trimMode: false }),
  setTrimMode: (active) => set({ trimMode: active, extendMode: false, drawingMode: null, measuringMode: false }),
  setExtendMode: (active) => set({ extendMode: active, trimMode: false, drawingMode: null, measuringMode: false }),
  setNodeEditing: (elementId) => set({ nodeEditingElementId: elementId, nodeEditSelectedNode: -1, nodeConstraints: [] }),
  setNodeConstraints: (constraints) => set({ nodeConstraints: constraints }),
  setNodeEditSelectedNode: (index) => set({ nodeEditSelectedNode: index }),


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

  setColorMappings: (mappings) => set({ colorMappings: mappings }),

  setVectorCleanup: (cleanup) => set((state) => ({
    vectorCleanup: { ...state.vectorCleanup, ...cleanup },
  })),

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
