// ============================================
// TIPOS COMPARTIDOS - GRBL Web Control Pro v5.0
// ============================================

// Workspaces
export type Workspace = 'design' | 'preview' | 'control'

// Tipos de operación
export type OperationType = 'cnc' | 'laser' | 'plotter' | 'pencil'

// Tipos de trabajo CNC
export type WorkType = 'outline' | 'inside' | 'outside' | 'pocket'

// Compensación de herramienta
export type ToolCompensation = 'center' | 'inside' | 'outside'

// Posiciones de origen
export type OriginPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

// Modo de posición
export type PositionMode = 'WPos' | 'MPos'

// Estado de la máquina GRBL
export type MachineState = 'Idle' | 'Run' | 'Hold' | 'Alarm' | 'Check' | 'Home' | 'Sleep' | 'Jog'

// Configuración del área de trabajo
export interface WorkArea {
  width: number
  height: number
  origin: OriginPosition
}

// Configuración global de mecanizado
export interface GlobalConfig {
  operationType: OperationType
  tool: string
  material: string
  workType: WorkType
  feedRate: number
  plungeRate: number
  spindleRPM: number
  laserPower: number
  passes: number
  depth: number
  depthStep: number
  toolDiameter: number
  compensation: ToolCompensation
  pressure: number
  speed: number
  pressureZ: number
}

// Posición de máquina
export interface MachinePosition {
  x: string
  y: string
  z: string
}

// Elemento del canvas
export interface CanvasElement {
  id: string
  type: 'svg' | 'rect' | 'circle' | 'line' | 'maker'
  name: string
  visible: boolean
  locked: boolean
  expanded?: boolean
  showConfig?: boolean
  config: GlobalConfig | null
  children: CanvasElement[]
  parent?: string
  // Datos de maker.js
  makerType?: string
  makerParams?: Record<string, number | string | number[]>
  // Datos SVG guardados
  svgData?: string | null
  // Fabric.js object reference (not serializable)
  fabricObject?: unknown
}

// Herramienta
export interface Tool {
  id: string
  category: 'cnc' | 'plotter' | 'pencil'
  name: string
  type: string
  diameter?: number
  angle?: number
  feedRate?: number
  plungeRate?: number
  rpm?: number
  pressure?: number
  speed?: number
  offset?: number
  thickness?: number
  color?: string
  notes?: string
}

// Material
export interface Material {
  id: string
  name: string
  category: string
  thickness: number
  description?: string
  color: string
  cnc?: {
    feedRate: number
    plungeRate: number
    rpm: number
    depthPerPass: number
    recommended?: string
  }
  laser?: {
    cutPower: number
    cutSpeed: number
    engravePower: number
    engraveSpeed: number
    passes?: number
    warning?: string
  }
  plotter?: {
    pressure: number
    speed: number
    passes: number
    blade: string
    offset?: number
  }
}

// Configuración GRBL
export interface GRBLSetting {
  code: string
  value: number
  description: string
  help: string
  unit: string
}

// Punto 2D
export interface Point2D {
  x: number
  y: number
}

// Path para generación de G-code
export interface GCodePath {
  points: Point2D[]
  closed: boolean
}

// Estimaciones de mecanizado
export interface MachiningEstimates {
  time: string
  distance: string
}

// Datos de proyecto serializados
export interface ProjectData {
  version: string
  metadata: {
    created: string
    modified: string
    appVersion: string
    projectName: string
  }
  workArea: WorkArea
  elements: SerializedElement[]
  globalConfig: GlobalConfig
  gcode: {
    generated: boolean
    code: string
    lines: number
  }
  selectedTool: string
  selectedMaterial: string
  extensions: Record<string, unknown>
}

// Elemento serializado (sin referencia Fabric.js)
export interface SerializedElement {
  id: string
  type: string
  name: string
  visible: boolean
  locked: boolean
  config: GlobalConfig | null
  makerType?: string
  makerParams?: Record<string, number | string | number[]>
  transform?: {
    left: number
    top: number
    scaleX: number
    scaleY: number
    angle: number
    flipX: boolean
    flipY: boolean
    width: number
    height: number
  } | null
  svgData?: string | null
  children: SerializedElement[]
}

// Form de herramienta
export interface ToolFormData {
  name: string
  type: string
  diameter: number
  angle: number
  feedRate: number
  plungeRate: number
  rpm: number
  pressure: number
  speed: number
  thickness: number
  color: string
  notes: string
}

// Form de material
export interface MaterialFormData {
  name: string
  thickness: number
  description: string
  color: string
  cncFeedRate: number
  cncPlungeRate: number
  cncRpm: number
  cncDepthPerPass: number
  laserCutPower: number
  laserCutSpeed: number
  laserEngravePower: number
  laserEngraveSpeed: number
}
