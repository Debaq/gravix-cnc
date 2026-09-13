import type { GlobalConfig } from './types'

/**
 * Valores por defecto de una operacion. Unica fuente de verdad: el store de
 * canvas los usa como config global inicial y `normalizeConfig` los usa para
 * rellenar proyectos viejos que se guardaron antes de que existiera un campo.
 */
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
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
  rasterBrightness: 0,
  rasterContrast: 0,
  rasterGamma: 1,
  rasterSharpen: 0,
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
  photoMaxDepth: 2,
  photoMinDepth: 0.05,
  photoLineSpacing: 0,
  photoDirection: 'horizontal',
  photoInvert: false,
  photoBidirectional: true,
  photoStepMm: 0,
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
  tabMode: 'auto',
  tabPositions: [],
  // Entrada/salida tangente
  leadType: 'none',
  leadLength: 2,
  leadOutEnabled: false,
  // Sentido y compensacion
  millDirection: 'climb',
  cutterComp: 'off',
  cutterCompD: 1,
  // Acabado
  finishAllowance: 0,
  finishPassEnabled: false,
  // Feeds & speeds
  toolFlutes: 2,
  trochoidalRadius: 0,
}

/**
 * Completa una config parcial (proyecto viejo, plantilla, override de capa)
 * con los defaults. Sin esto, un campo agregado despues de guardar el proyecto
 * llega como `undefined` al generador y sale `NaN` en el G-code.
 */
export function normalizeConfig(config: Partial<GlobalConfig> | null | undefined): GlobalConfig {
  return { ...DEFAULT_GLOBAL_CONFIG, ...(config ?? {}) }
}
