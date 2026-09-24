// Presets que salen de la libreria: medidas de area de trabajo por tipo de
// maquina, que materiales tienen sentido para cada operacion y que valores
// de la config trae una herramienta o un material al elegirlos.

import type { GlobalConfig, Material, OperationType, Tool } from './types'

export interface AreaPreset {
  label: string
  w: number
  h: number
}

/** Pulgadas a mm, redondeado a centesimas para que el campo no muestre 304.79999. */
const inch = (n: number) => Math.round(n * 2540) / 100

export const WORK_AREA_PRESETS: Record<OperationType, AreaPreset[]> = {
  cnc: [
    { label: '200×200', w: 200, h: 200 },
    { label: '300×300', w: 300, h: 300 },
    { label: '300×400', w: 300, h: 400 },
    { label: '400×400', w: 400, h: 400 },
    { label: '500×500', w: 500, h: 500 },
    { label: '600×400', w: 600, h: 400 },
  ],
  laser: [
    { label: '200×200', w: 200, h: 200 },
    { label: '300×300', w: 300, h: 300 },
    { label: '400×400', w: 400, h: 400 },
    { label: '600×400', w: 600, h: 400 },
  ],
  // Tapetes de corte (ancho x largo) y hojas sueltas
  plotter: [
    { label: 'Tapete 12×12"', w: inch(12), h: inch(12) },
    { label: 'Tapete 12×24"', w: inch(12), h: inch(24) },
    { label: 'Tapete 15×15"', w: inch(15), h: inch(15) },
    { label: 'Tapete 24×24"', w: inch(24), h: inch(24) },
    { label: 'Portrait 8×12"', w: inch(8), h: inch(12) },
    { label: 'Carta', w: 215.9, h: 279.4 },
    { label: 'A4', w: 210, h: 297 },
  ],
  pencil: [
    { label: 'A4', w: 210, h: 297 },
    { label: 'Carta', w: 215.9, h: 279.4 },
    { label: 'A3', w: 297, h: 420 },
    { label: '300×300', w: 300, h: 300 },
  ],
}

/** Materiales con datos para la operacion. Para lapiz no hay datos: todos. */
export function materialsForOperation(materials: Material[], opType: OperationType): Material[] {
  switch (opType) {
    case 'cnc':
      return materials.filter((m) => (m.cnc?.feedRate ?? 0) > 0 || (m.cnc?.rpm ?? 0) > 0)
    case 'laser':
      return materials.filter((m) => (m.laser?.cutPower ?? 0) > 0 || (m.laser?.engravePower ?? 0) > 0)
    case 'plotter':
      return materials.filter((m) => (m.plotter?.pressure ?? 0) > 0)
    default:
      return materials
  }
}

/**
 * Lista para un selector: los materiales de la operacion mas el elegido,
 * aunque no tenga datos, para que el selector no quede en blanco.
 */
export function materialOptions(materials: Material[], opType: OperationType, selectedId?: string): Material[] {
  const list = materialsForOperation(materials, opType)
  const selected = selectedId ? materials.find((m) => m.id === selectedId) : undefined
  return selected && !list.includes(selected) ? [selected, ...list] : list
}

/** Valores que trae una herramienta al elegirla. */
export function toolPreset(tool: Tool): Partial<GlobalConfig> {
  const u: Partial<GlobalConfig> = { tool: tool.id }
  if (tool.diameter) u.toolDiameter = tool.diameter
  if (tool.feedRate) u.feedRate = tool.feedRate
  if (tool.plungeRate) u.plungeRate = tool.plungeRate
  if (tool.rpm) u.spindleRPM = tool.rpm
  if (tool.pressure) u.pressure = tool.pressure
  if (tool.speed) u.speed = tool.speed
  if (tool.category === 'plotter' && tool.offset !== undefined) u.bladeOffset = tool.offset
  return u
}

/**
 * Valores que trae un material para la operacion. Va despues de la
 * herramienta: el material manda en velocidad, presion y pasadas.
 */
export function materialPreset(mat: Material, opType: OperationType): Partial<GlobalConfig> {
  const u: Partial<GlobalConfig> = { material: mat.id }
  if (opType === 'cnc' && mat.cnc) {
    if (mat.cnc.feedRate) u.feedRate = mat.cnc.feedRate
    if (mat.cnc.plungeRate) u.plungeRate = mat.cnc.plungeRate
    if (mat.cnc.rpm) u.spindleRPM = mat.cnc.rpm
    if (mat.cnc.depthPerPass) u.depthStep = mat.cnc.depthPerPass
  } else if (opType === 'laser' && mat.laser) {
    if (mat.laser.cutPower) u.laserPower = mat.laser.cutPower
    if (mat.laser.cutSpeed) u.feedRate = mat.laser.cutSpeed
  } else if (opType === 'plotter' && mat.plotter) {
    if (mat.plotter.pressure) u.pressure = mat.plotter.pressure
    if (mat.plotter.speed) u.speed = mat.plotter.speed
    if (mat.plotter.passes) u.passes = mat.plotter.passes
    if (mat.plotter.offset !== undefined && mat.plotter.offset !== null) u.bladeOffset = mat.plotter.offset
  }
  return u
}
