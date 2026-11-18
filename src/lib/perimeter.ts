// ============================================
// Recorrer el perimetro del trabajo
// ============================================
//
// Una sola forma de "probar por donde va a pasar": la herramienta recorre la
// caja del diseno sin cortar. Antes habia cuatro botones (barra superior, CAM,
// Control y asistente), cada uno con su altura y su potencia, y el de Control
// mezclaba pixeles con milimetros.

import type { GCodeJob } from './types'
import { useCAMStore } from '@/stores/useCAMStore'
import { useCanvasStore } from '@/stores/useCanvasStore'

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

/** Potencia del laser para marcar el recorrido sin grabar (S sobre 1000). */
export const PERIMETER_LASER_POWER = 10

/** Altura segura del setup de CAM: la usan todos los movimientos manuales. */
export function setupSafeZ(): number {
  const z = useCAMStore.getState().setup.safeZ
  return Number.isFinite(z) && z > 0 ? z : 5
}

export function computeBBox(jobs: GCodeJob[]): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let has = false
  for (const job of jobs) {
    for (const path of job.paths) {
      for (const pt of path.points) {
        minX = Math.min(minX, pt.x)
        minY = Math.min(minY, pt.y)
        maxX = Math.max(maxX, pt.x)
        maxY = Math.max(maxY, pt.y)
        has = true
      }
    }
  }
  return has ? { minX, minY, maxX, maxY } : null
}

export function generateBoundaryGCode(
  bbox: BBox,
  mode: 'cnc' | 'laser',
  safeZ: number,
  laserTestPower: number,
): string {
  const { minX, minY, maxX, maxY } = bbox
  const f = (n: number) => n.toFixed(2)
  const lines: string[] = ['G90', 'G21']

  if (mode === 'laser') {
    lines.push('M5 S0')
    lines.push(`G0 X${f(minX)} Y${f(minY)}`)
    lines.push(`M4 S${laserTestPower}`)
    lines.push(`G1 X${f(maxX)} Y${f(minY)} F1000`)
    lines.push(`G1 X${f(maxX)} Y${f(maxY)} F1000`)
    lines.push(`G1 X${f(minX)} Y${f(maxY)} F1000`)
    lines.push(`G1 X${f(minX)} Y${f(minY)} F1000`)
    lines.push('M5 S0')
  } else {
    lines.push(`G0 Z${f(safeZ)}`)
    lines.push(`G0 X${f(minX)} Y${f(minY)}`)
    lines.push(`G0 X${f(maxX)} Y${f(minY)}`)
    lines.push(`G0 X${f(maxX)} Y${f(maxY)}`)
    lines.push(`G0 X${f(minX)} Y${f(maxY)}`)
    lines.push(`G0 X${f(minX)} Y${f(minY)}`)
  }
  return lines.join('\n')
}

/**
 * Programa de recorrido para el diseno actual. Sin piezas, recorre la hoja.
 * `usedWorkArea` avisa cual de los dos casos fue.
 */
export function perimeterProgram(jobs: GCodeJob[]): { gcode: string; bbox: BBox; usedWorkArea: boolean } {
  const { workArea, globalConfig } = useCanvasStore.getState()
  const fromJobs = computeBBox(jobs)
  const bbox = fromJobs ?? { minX: 0, minY: 0, maxX: workArea.width, maxY: workArea.height }
  const isLaser = jobs.length > 0
    ? jobs.every((j) => j.config.operationType === 'laser')
    : globalConfig.operationType === 'laser'
  return {
    gcode: generateBoundaryGCode(bbox, isLaser ? 'laser' : 'cnc', setupSafeZ(), PERIMETER_LASER_POWER),
    bbox,
    usedWorkArea: !fromJobs,
  }
}
