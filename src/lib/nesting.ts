/**
 * Nesting / auto-layout — acomoda piezas dentro del area de trabajo para
 * desperdiciar menos material.
 *
 * Alcance honesto: el empaque trabaja sobre el **rectangulo minimo** de cada
 * pieza, no sobre su contorno real (true-shape nesting con no-fit polygons es
 * otro orden de problema). A cambio hace dos cosas que si rinden:
 *
 *  1. Alinea cada pieza a su rectangulo de area minima antes de empacar, asi
 *     una pieza diagonal deja de ocupar el cuadrado que la contiene.
 *  2. Empaca con MaxRects (best short side fit), que aprovecha bastante mejor
 *     que una grilla o un shelf simple, y prueba la pieza girada 90 grados.
 *
 * Todo en milimetros; el canvas hace la conversion.
 */

import type { Point2D } from '@/lib/types'

// ============================================
// TIPOS
// ============================================

export interface NestingPiece {
  id: string
  /** Contorno(s) de la pieza en mm, en coordenadas absolutas del area. */
  outline: Point2D[]
  /** Angulo actual de la pieza en grados CAD (Y arriba), para no perderlo. */
  currentAngleDeg: number
}

export interface NestingOptions {
  /** Area util donde acomodar, en mm. */
  binWidth: number
  binHeight: number
  /** Separacion minima entre piezas (mm). */
  spacing: number
  /** Margen contra el borde del area (mm). */
  margin: number
  /** Probar cada pieza tambien girada 90 grados. */
  allowRotate90: boolean
  /** Girar cada pieza para alinearla con su rectangulo de area minima. */
  alignToMinRect: boolean
}

export interface NestingPlacement {
  id: string
  /** Rotacion total a aplicar respecto del angulo actual (grados CAD, CCW). */
  rotateDeg: number
  /** Centro destino de la pieza, en mm dentro del area. */
  centerX: number
  centerY: number
}

export interface NestingResult {
  placements: NestingPlacement[]
  /** Piezas que no entraron: se quedan donde estaban. */
  unplaced: string[]
  /** Fraccion del area util ocupada por los rectangulos colocados (0..1). */
  usage: number
}

// ============================================
// CASCO CONVEXO + RECTANGULO DE AREA MINIMA
// ============================================

/** Casco convexo (monotone chain). Devuelve los puntos en sentido CCW. */
export function convexHull(points: Point2D[]): Point2D[] {
  if (points.length < 3) return [...points]

  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: Point2D[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Point2D[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

export interface MinAreaRect {
  /** Angulo del rectangulo en radianes (sentido canvas). */
  angle: number
  width: number
  height: number
  center: Point2D
}

/**
 * Rectangulo de area minima que contiene a los puntos (rotating calipers sobre
 * el casco: el rectangulo optimo siempre apoya un lado en una arista del casco).
 */
export function minAreaRect(points: Point2D[]): MinAreaRect {
  const hull = convexHull(points)
  if (hull.length < 3) {
    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    return {
      angle: 0,
      width: maxX - minX,
      height: maxY - minY,
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    }
  }

  let best: MinAreaRect | null = null

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const edgeAngle = Math.atan2(b.y - a.y, b.x - a.x)
    const cos = Math.cos(-edgeAngle)
    const sin = Math.sin(-edgeAngle)

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of hull) {
      const rx = p.x * cos - p.y * sin
      const ry = p.x * sin + p.y * cos
      if (rx < minX) minX = rx
      if (rx > maxX) maxX = rx
      if (ry < minY) minY = ry
      if (ry > maxY) maxY = ry
    }

    const w = maxX - minX
    const h = maxY - minY
    if (!best || w * h < best.width * best.height) {
      // El centro se calcula en el marco rotado y se lleva de vuelta
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      best = {
        angle: edgeAngle,
        width: w,
        height: h,
        center: {
          x: cx * Math.cos(edgeAngle) - cy * Math.sin(edgeAngle),
          y: cx * Math.sin(edgeAngle) + cy * Math.cos(edgeAngle),
        },
      }
    }
  }

  return best!
}

// ============================================
// MAXRECTS
// ============================================

interface FreeRect { x: number; y: number; w: number; h: number }

interface PackItem {
  id: string
  w: number
  h: number
}

export interface PackedRect {
  id: string
  x: number
  y: number
  w: number
  h: number
  rotated: boolean
}

/**
 * Empaque MaxRects con heuristica "best short side fit": de todos los huecos
 * libres se elige el que deja el sobrante mas chico en su lado corto.
 */
export function packRectangles(
  items: PackItem[],
  binWidth: number,
  binHeight: number,
  allowRotate: boolean,
): { packed: PackedRect[]; unpacked: string[] } {
  const free: FreeRect[] = [{ x: 0, y: 0, w: binWidth, h: binHeight }]
  const packed: PackedRect[] = []
  const unpacked: string[] = []

  // De mayor a menor: las piezas grandes primero dejan mejores huecos
  const queue = [...items].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h))

  for (const item of queue) {
    let bestScore1 = Infinity
    let bestScore2 = Infinity
    let bestNode: PackedRect | null = null

    for (const node of free) {
      const tryFit = (w: number, h: number, rotated: boolean) => {
        if (w > node.w || h > node.h) return
        const leftoverH = node.w - w
        const leftoverV = node.h - h
        const shortSide = Math.min(leftoverH, leftoverV)
        const longSide = Math.max(leftoverH, leftoverV)
        if (shortSide < bestScore1 || (shortSide === bestScore1 && longSide < bestScore2)) {
          bestScore1 = shortSide
          bestScore2 = longSide
          bestNode = { id: item.id, x: node.x, y: node.y, w, h, rotated }
        }
      }

      tryFit(item.w, item.h, false)
      if (allowRotate) tryFit(item.h, item.w, true)
    }

    if (!bestNode) {
      unpacked.push(item.id)
      continue
    }

    packed.push(bestNode)
    splitFreeRects(free, bestNode)
    pruneFreeRects(free)
  }

  return { packed, unpacked }
}

/** Parte cada hueco que solape con la pieza colocada. */
function splitFreeRects(free: FreeRect[], used: PackedRect): void {
  for (let i = free.length - 1; i >= 0; i--) {
    const f = free[i]
    const overlaps =
      used.x < f.x + f.w && used.x + used.w > f.x &&
      used.y < f.y + f.h && used.y + used.h > f.y
    if (!overlaps) continue

    free.splice(i, 1)

    // Arriba
    if (used.y > f.y) free.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y })
    // Abajo
    if (used.y + used.h < f.y + f.h) {
      free.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - (used.y + used.h) })
    }
    // Izquierda
    if (used.x > f.x) free.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h })
    // Derecha
    if (used.x + used.w < f.x + f.w) {
      free.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - (used.x + used.w), h: f.h })
    }
  }
}

/** Saca los huecos contenidos dentro de otro. */
function pruneFreeRects(free: FreeRect[]): void {
  for (let i = free.length - 1; i >= 0; i--) {
    for (let j = free.length - 1; j >= 0; j--) {
      if (i === j) continue
      const a = free[i]
      const b = free[j]
      if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) {
        free.splice(i, 1)
        break
      }
    }
  }
}

// ============================================
// PLAN COMPLETO
// ============================================

/**
 * Calcula donde y con que giro va cada pieza. No toca el canvas: devuelve las
 * transformaciones para que las aplique quien corresponda.
 */
export function planNesting(
  pieces: NestingPiece[],
  opts: NestingOptions,
): NestingResult {
  const usableW = opts.binWidth - opts.margin * 2
  const usableH = opts.binHeight - opts.margin * 2
  if (usableW <= 0 || usableH <= 0) {
    return { placements: [], unplaced: pieces.map(p => p.id), usage: 0 }
  }

  // Paso 1: medir cada pieza (y, si corresponde, enderezarla)
  const measured = new Map<string, { w: number; h: number; extraRotDeg: number }>()
  const items: PackItem[] = []

  for (const piece of pieces) {
    if (piece.outline.length === 0) continue

    let w: number
    let h: number
    let extraRotDeg = 0

    if (opts.alignToMinRect) {
      const rect = minAreaRect(piece.outline)
      w = rect.width
      h = rect.height
      // Girar la pieza al reves del angulo de su rectangulo la deja derecha
      extraRotDeg = -(rect.angle * 180) / Math.PI
    } else {
      const xs = piece.outline.map(p => p.x)
      const ys = piece.outline.map(p => p.y)
      w = Math.max(...xs) - Math.min(...xs)
      h = Math.max(...ys) - Math.min(...ys)
    }

    measured.set(piece.id, { w, h, extraRotDeg })
    // La separacion se mete en el tamaño: asi el empaque la respeta sin saber de ella
    items.push({ id: piece.id, w: w + opts.spacing, h: h + opts.spacing })
  }

  const { packed, unpacked } = packRectangles(
    items,
    usableW + opts.spacing,
    usableH + opts.spacing,
    opts.allowRotate90,
  )

  const placements: NestingPlacement[] = []
  let usedArea = 0

  for (const rect of packed) {
    const m = measured.get(rect.id)
    if (!m) continue

    const realW = rect.rotated ? m.h : m.w
    const realH = rect.rotated ? m.w : m.h
    usedArea += realW * realH

    placements.push({
      id: rect.id,
      rotateDeg: m.extraRotDeg + (rect.rotated ? 90 : 0),
      centerX: opts.margin + rect.x + realW / 2,
      centerY: opts.margin + rect.y + realH / 2,
    })
  }

  return {
    placements,
    unplaced: unpacked,
    usage: usableW * usableH > 0 ? usedArea / (usableW * usableH) : 0,
  }
}
