// ============================================
// Plan de trabajo CAM -> lista de jobs
// ============================================
//
// El arbol de CAM define que operaciones corren, en que orden y con que
// config. Esta capa traduce esas decisiones a la lista de `GCodeJob` que
// consume el generador: sin esto, apagar o reordenar una operacion en CAM no
// cambiaba nada del G-code.

import type { GCodeJob, Point2D, Stock } from './types'
import { normalizeConfig } from './config-defaults'
import { orderByNearestEntry } from './geometry'

export interface CAMPlan {
  /** Orden de ids de operacion definido en el arbol. */
  order: string[]
  /** Ids de operaciones apagadas (ojo cerrado). */
  disabled: Set<string>
  /** Id de la operacion en modo solo, si hay una. */
  soloId?: string | null
  /** Reordenar por cercania en vez de respetar el arbol. */
  optimize?: boolean
}

function jobEntry(job: GCodeJob): { start: Point2D; end: Point2D } {
  const first = job.paths[0]?.points[0]
  const lastPath = job.paths[job.paths.length - 1]
  const last = lastPath?.points[lastPath.points.length - 1]
  const zero = { x: 0, y: 0 }
  return { start: first ?? zero, end: last ?? first ?? zero }
}

/**
 * Filtra y ordena los jobs segun el arbol de CAM y normaliza sus configs.
 *
 * Los jobs que no tengan `opId` (geometria sin operacion en el arbol) se
 * conservan al final antes que perderlos en silencio.
 */
export function applyCAMPlan(jobs: GCodeJob[], plan: CAMPlan): GCodeJob[] {
  const active = jobs.filter((job) => {
    if (!job.opId) return true
    if (plan.soloId) return job.opId === plan.soloId
    return !plan.disabled.has(job.opId)
  }).map((job) => ({ ...job, config: normalizeConfig(job.config) }))

  if (plan.optimize) {
    const order = orderByNearestEntry(active.map(jobEntry))
    return order.map((i) => active[i])
  }

  const rank = new Map(plan.order.map((id, i) => [id, i]))
  return [...active].sort((a, b) => {
    const ra = a.opId ? rank.get(a.opId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    const rb = b.opId ? rank.get(b.opId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    return ra - rb
  })
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

/** Bounding box de toda la geometria de los jobs, en mm de maquina. */
export function jobsBBox(jobs: GCodeJob[]): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const job of jobs) {
    for (const path of job.paths) {
      for (const p of path.points) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

/**
 * Stock efectivo: en modo `auto` el bloque se ajusta al dibujo mas el margen.
 * Sin geometria se devuelve el bloque manual tal cual.
 */
export function resolveStock(stock: Stock, bbox: BBox | null): Stock {
  if (!stock.auto || !bbox) return stock
  const m = Math.max(0, stock.margin)
  return {
    ...stock,
    x: bbox.minX - m,
    y: bbox.minY - m,
    width: (bbox.maxX - bbox.minX) + m * 2,
    height: (bbox.maxY - bbox.minY) + m * 2,
  }
}

/**
 * Avisos de stock que no dependen de una sola operacion: geometria que se sale
 * del bloque de material.
 */
export function checkStockCoverage(stock: Stock, bbox: BBox | null): string[] {
  if (!stock.enabled || !bbox) return []
  const out: string[] = []
  const right = stock.x + stock.width
  const top = stock.y + stock.height
  if (bbox.minX < stock.x - 0.001 || bbox.minY < stock.y - 0.001 || bbox.maxX > right + 0.001 || bbox.maxY > top + 0.001) {
    out.push('Hay geometria fuera del bloque de material')
  }
  return out
}
