// ============================================
// TIPOS COMPARTIDOS - Gravix v1.0.0
// ============================================

// Workspaces
export type Workspace = 'cad' | 'cam' | 'cnc'

// Tipos de operación
export type OperationType = 'cnc' | 'laser' | 'plotter' | 'pencil'

// Tipos de trabajo CNC
export type WorkType = 'outline' | 'inside' | 'outside' | 'pocket' | 'vcarve' | 'drill' | 'chamfer'

// Modos de operación láser
export type LaserMode = 'cut' | 'engrave' | 'fill' | 'raster'

// Modos de dithering para grabado ráster
export type DitheringMode = 'threshold' | 'floydSteinberg' | 'ordered' | 'atkinson' | 'grayscale'

// Datos de imagen ráster procesada
export interface RasterData {
  width: number
  height: number
  pixel_size_mm: number
  preview_base64: string
  pixels_path: string  // path al archivo temporal con pixeles crudos
}

// Compensación de herramienta
export type ToolCompensation = 'center' | 'inside' | 'outside'

// Estrategia de cajeado (pocket)
export type PocketStrategy = 'contour-parallel' | 'zigzag'

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
  stepover: number
  pocketStrategy: PocketStrategy
  pressure: number
  speed: number
  pressureZ: number
  bladeOffset: number         // Compensación de cuchilla plotter (mm)
  toolLengthOffset: number    // Offset Z de herramienta (mm) para G43
  // Configuración láser avanzada
  laserMode: LaserMode
  laserDynamic: boolean      // true = M4 (potencia dinámica), false = M3 (potencia constante)
  fillAngle: number          // Ángulo de las líneas de relleno (0-360°)
  fillSpacing: number        // Espaciado entre líneas de relleno (mm)
  fillBidirectional: boolean // Escaneo bidireccional en relleno
  overscan: number           // Margen extra en mm para aceleración/desaceleración
  // Configuración ráster
  rasterDpi: number          // Resolución en puntos por pulgada
  rasterDithering: DitheringMode
  rasterThreshold: number    // Umbral de blanco/negro (0-255)
  rasterInvert: boolean      // Invertir imagen (para materiales oscuros)
  rasterBidirectional: boolean // Escaneo bidireccional en ráster
  // Kerf compensation láser
  laserKerf: number          // Ancho de corte láser (mm) para compensación
  laserLeadIn: number        // Distancia lead-in/out (mm, 0 = disabled)
  laserFocusZ: number        // Altura Z de foco láser (mm, 0 = surface)
  // Drill CNC
  drillPeckDepth: number        // Profundidad por picotazo en G83 (mm, 0 = G81 simple)
  drillRetract: number          // Altura de retracción entre pecks (mm)
  // V-Carve CNC
  vcarveAngle: number           // Ángulo total del V-bit (grados, e.g. 60, 90)
  vcarveMaxDepth: number        // Profundidad máxima V-carve (mm)
  vcarveStepSize: number        // Resolución de offset (mm)
  vcarveFlatDepth: number       // Profundidad flat-bottom (0 = standard)
  // Rest machining CNC
  restMachiningEnabled: boolean  // Segundo pass con fresa chica en esquinas
  restToolDiameter: number       // Diámetro de fresa de acabado (mm)
  // Ramping / Lead-in CNC
  rampEnabled: boolean        // Entrada en rampa en vez de plunge directo
  rampAngle: number           // Ángulo de rampa (grados, 0-45)
  // Tabs/soportes para corte CNC
  tabsEnabled: boolean       // Activar tabs en cortes
  tabWidth: number           // Ancho de cada tab (mm)
  tabHeight: number          // Altura del tab (mm, material que queda sin cortar)
  tabCount: number           // Cantidad de tabs alrededor del contorno
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
  type: 'svg' | 'rect' | 'circle' | 'line' | 'maker' | 'group' | 'cota'
  name: string
  visible: boolean
  locked: boolean
  layerId?: string // ID de la capa a la que pertenece
  expanded?: boolean
  showConfig?: boolean
  config: GlobalConfig | null
  operations?: GlobalConfig[]  // Múltiples operaciones (cajeado + corte, etc.)
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

// Capa del diseño
export interface Layer {
  id: string
  name: string
  color: string
  visible: boolean
  locked: boolean
  order: number
  config: GlobalConfig | null // Override de operación para toda la capa
}

// Tool y Material se generan desde Rust via ts-rs.
// Re-exportados acá para que los callers existentes (import from '@/lib/types')
// sigan funcionando sin cambiar rutas.
export type { Tool } from '@/lib/generated/Tool'
export type { ToolCategory } from '@/lib/generated/ToolCategory'
export type { Material } from '@/lib/generated/Material'
export type { CncSettings } from '@/lib/generated/CncSettings'
export type { LaserSettings } from '@/lib/generated/LaserSettings'
export type { PlotterSettings } from '@/lib/generated/PlotterSettings'

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
  strokeColor?: string  // Color de stroke para agrupación plotter (hex)
}

// Job de G-code: un elemento con su config resuelta y paths extraidos
export interface GCodeJob {
  elementId: string
  elementName: string
  config: GlobalConfig
  paths: GCodePath[]
  colorMappings?: ColorMapping[]  // Laser color→config mappings
}

// Color mapping para láser (colores SVG → configuraciones)
export interface ColorMapping {
  color: string        // hex color (#ff0000)
  name: string         // display name (Corte, Grabado, etc.)
  mode: LaserMode      // cut, engrave, fill
  power: number        // % power
  speed: number        // mm/min
  passes: number
  enabled: boolean
}

// Marcadores CAM insertados entre jobs
export interface GCodeMarker {
  type: 'pause' | 'tool-change' | 'message'
  message: string
  afterJobIndex: number // insert after this job index in the jobs array
  parkPosition?: { x: number; y: number; z: number } // where tool parks during pause
}

// Clamp rectangle for collision avoidance in rapids
export interface ClampRect {
  x: number
  y: number
  width: number
  height: number
  zHeight: number // physical height in mm (0 = infinite)
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
  operations?: GlobalConfig[]
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

// Macro guardada
export interface SavedMacro {
  id: string
  name: string
  gcode: string
  icon?: string
  builtin?: boolean
}

// Posición guardada
export interface SavedPosition {
  id: string
  name: string
  x: number
  y: number
  z: number
}

// Paso del workflow
export type WorkflowStepType = 'gcode' | 'macro' | 'pause' | 'goto'

export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  name: string
  // gcode: contenido gcode, macro: id de macro, goto: id de posición, pause: mensaje
  data: string
  status: 'pending' | 'running' | 'done' | 'error'
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
