// ============================================
// Calculadora de feeds & speeds
// ============================================
//
// El modelo es el clasico de fresado: la viruta por diente (chipload) manda.
//
//   feed [mm/min] = RPM * filos * chipload [mm/diente]
//
// El chipload de tabla esta dado para una fresa de referencia; en fresas mas
// chicas hay que bajarlo o el filo se rompe, y en fresas grandes se puede subir
// sin cargar de mas el husillo. Se escala con la raiz del diametro, que es la
// aproximacion que usan las tablas de los fabricantes y evita los saltos
// bruscos de una tabla por diametro.

import type { Material } from './types'

/** Familia de material a efectos de corte. Es lo unico que cambia la receta. */
export type MaterialClass =
  | 'softwood'
  | 'hardwood'
  | 'plywood'
  | 'mdf'
  | 'acrylic'
  | 'plastic'
  | 'aluminum'
  | 'brass'
  | 'steel'
  | 'foam'

export interface ChiploadEntry {
  label: string
  /** mm por diente a `refDiameter`. */
  chipload: number
  refDiameter: number
  /** Velocidad de corte en superficie (m/min) -> de aca sale la RPM. */
  surfaceSpeed: number
  /** Profundidad por pasada como fraccion del diametro. */
  depthPerPassRatio: number
  /** Stepover recomendado (fraccion del diametro). */
  stepover: number
  /** Plunge como fraccion del feed. */
  plungeRatio: number
  /** RPM maxima razonable para el material (el acrilico se funde si sobra). */
  maxRpm: number
}

export const MATERIAL_CLASSES: Record<MaterialClass, ChiploadEntry> = {
  softwood:  { label: 'Madera blanda', chipload: 0.13, refDiameter: 6, surfaceSpeed: 400, depthPerPassRatio: 1.0, stepover: 0.45, plungeRatio: 0.4, maxRpm: 24000 },
  hardwood:  { label: 'Madera dura',   chipload: 0.10, refDiameter: 6, surfaceSpeed: 350, depthPerPassRatio: 0.8, stepover: 0.40, plungeRatio: 0.35, maxRpm: 24000 },
  plywood:   { label: 'Terciado',      chipload: 0.11, refDiameter: 6, surfaceSpeed: 380, depthPerPassRatio: 0.9, stepover: 0.45, plungeRatio: 0.4, maxRpm: 24000 },
  mdf:       { label: 'MDF',           chipload: 0.12, refDiameter: 6, surfaceSpeed: 400, depthPerPassRatio: 1.0, stepover: 0.45, plungeRatio: 0.4, maxRpm: 20000 },
  acrylic:   { label: 'Acrilico',      chipload: 0.08, refDiameter: 6, surfaceSpeed: 250, depthPerPassRatio: 0.6, stepover: 0.35, plungeRatio: 0.3, maxRpm: 16000 },
  plastic:   { label: 'Plastico',      chipload: 0.09, refDiameter: 6, surfaceSpeed: 280, depthPerPassRatio: 0.7, stepover: 0.40, plungeRatio: 0.3, maxRpm: 18000 },
  aluminum:  { label: 'Aluminio',      chipload: 0.05, refDiameter: 6, surfaceSpeed: 200, depthPerPassRatio: 0.3, stepover: 0.25, plungeRatio: 0.25, maxRpm: 18000 },
  brass:     { label: 'Bronce/laton',  chipload: 0.04, refDiameter: 6, surfaceSpeed: 150, depthPerPassRatio: 0.3, stepover: 0.25, plungeRatio: 0.25, maxRpm: 15000 },
  steel:     { label: 'Acero',         chipload: 0.02, refDiameter: 6, surfaceSpeed: 60,  depthPerPassRatio: 0.15, stepover: 0.15, plungeRatio: 0.2, maxRpm: 12000 },
  foam:      { label: 'Espuma',        chipload: 0.25, refDiameter: 6, surfaceSpeed: 500, depthPerPassRatio: 2.0, stepover: 0.60, plungeRatio: 0.6, maxRpm: 24000 },
}

/** Palabras que aparecen en los nombres/categorias de la libreria de materiales. */
const CLASS_KEYWORDS: [MaterialClass, RegExp][] = [
  ['plywood', /terciad|contrachap|plywood|multilamin/i],
  ['mdf', /\bmdf\b|fibrofacil|trupan/i],
  ['acrylic', /acrilic|acryl|pmma|plexi/i],
  ['aluminum', /alumin/i],
  ['brass', /bronce|laton|brass|cobre|copper/i],
  ['steel', /acero|steel|hierro|inox/i],
  ['foam', /espuma|foam|poliestiren|depron|eva\b/i],
  ['hardwood', /dura|roble|encina|nogal|raul[ií]|lenga|hardwood|haya|maple|cerezo/i],
  ['softwood', /pino|blanda|softwood|cedro|alamo|balsa/i],
  ['plastic', /pl[aá]stic|pvc|hdpe|abs|delrin|nylon|polycarb|policarb/i],
]

/** Adivina la familia a partir del nombre y la categoria del material. */
export function classifyMaterial(material?: Material | null): MaterialClass {
  if (!material) return 'mdf'
  const haystack = `${material.name} ${material.category} ${material.description ?? ''}`
  for (const [cls, re] of CLASS_KEYWORDS) {
    if (re.test(haystack)) return cls
  }
  return 'mdf'
}

export interface FeedsInput {
  materialClass: MaterialClass
  /** Diametro de la fresa (mm). */
  diameter: number
  /** Cantidad de filos. */
  flutes: number
  /** Limite de RPM de la maquina (0 = sin limite conocido). */
  maxRpm?: number
  /** Limite de feed de la maquina en mm/min (0 = sin limite conocido). */
  maxFeed?: number
  /** 0..1 — cuanto se aparta de la receta: 0.5 conservador, 1 nominal, 1.5 agresivo. */
  aggressiveness?: number
}

export interface FeedsResult {
  rpm: number
  feedRate: number
  plungeRate: number
  depthPerPass: number
  stepover: number
  /** Viruta real por diente con los numeros redondeados que se devuelven. */
  chipload: number
  /** Tasa de remocion de material, cm3/min, para contraste rapido. */
  mrr: number
  /** Avisos cuando la maquina recorta la receta. */
  notes: string[]
}

/**
 * Devuelve una receta de corte para un material y una fresa.
 *
 * La RPM sale de la velocidad de superficie (`v = pi * d * n`) y despues el
 * feed sale del chipload. Si la maquina no llega a esa RPM se recalcula el
 * feed con la RPM real, que es el error clasico de copiar tablas: bajar la
 * RPM sin bajar el avance rompe la fresa.
 */
export function calculateFeeds(input: FeedsInput): FeedsResult {
  const entry = MATERIAL_CLASSES[input.materialClass] ?? MATERIAL_CLASSES.mdf
  const notes: string[] = []

  const diameter = Math.max(0.1, input.diameter)
  const flutes = Math.max(1, Math.round(input.flutes))
  const k = Math.min(2, Math.max(0.3, input.aggressiveness ?? 1))

  // RPM desde velocidad de superficie: n = v / (pi * d)
  const idealRpm = (entry.surfaceSpeed * 1000) / (Math.PI * diameter)
  let rpm = Math.min(idealRpm, entry.maxRpm)

  const machineMaxRpm = input.maxRpm && input.maxRpm > 0 ? input.maxRpm : 0
  if (machineMaxRpm && rpm > machineMaxRpm) {
    rpm = machineMaxRpm
    notes.push(`RPM limitada por la maquina (${machineMaxRpm})`)
  }
  rpm = Math.round(rpm / 100) * 100

  // Chipload escalado por diametro: fresas chicas soportan menos viruta
  const scaled = entry.chipload * Math.sqrt(diameter / entry.refDiameter) * k
  const chipload = Math.max(0.005, scaled)

  let feedRate = rpm * flutes * chipload
  const machineMaxFeed = input.maxFeed && input.maxFeed > 0 ? input.maxFeed : 0
  if (machineMaxFeed && feedRate > machineMaxFeed) {
    feedRate = machineMaxFeed
    notes.push(`Avance limitado por la maquina (${machineMaxFeed} mm/min)`)
  }
  feedRate = Math.round(feedRate / 10) * 10

  const plungeRate = Math.max(20, Math.round((feedRate * entry.plungeRatio) / 10) * 10)
  const depthPerPass = Math.max(0.1, Math.round(diameter * entry.depthPerPassRatio * k * 100) / 100)
  const stepover = Math.min(0.9, Math.max(0.1, entry.stepover))

  // Viruta efectiva con los valores redondeados que se van a usar de verdad
  const realChipload = rpm > 0 ? feedRate / (rpm * flutes) : 0

  // MRR con corte a ancho de stepover y profundidad de una pasada
  const mrr = (feedRate * depthPerPass * diameter * stepover) / 1000

  if (realChipload < 0.01) {
    notes.push('Viruta muy fina: la fresa va a frotar en vez de cortar')
  }
  if (input.materialClass === 'acrylic' && realChipload < 0.05) {
    notes.push('En acrilico una viruta fina funde el material')
  }

  return {
    rpm,
    feedRate,
    plungeRate,
    depthPerPass,
    stepover,
    chipload: Math.round(realChipload * 1000) / 1000,
    mrr: Math.round(mrr * 100) / 100,
    notes,
  }
}
