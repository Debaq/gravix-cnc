/**
 * Nesting / auto-layout — acomoda piezas dentro del area de trabajo para
 * desperdiciar menos material.
 *
 * Dos estrategias:
 *
 *  - **Por rectangulo** (rapida): alinea cada pieza a su rectangulo de area
 *    minima — asi una pieza diagonal deja de ocupar el cuadrado que la
 *    contiene — y empaca con MaxRects (best short side fit), probando tambien
 *    la pieza girada 90 grados.
 *  - **Por contorno real** (true-shape): rasteriza cada pieza y la coloca con
 *    bottom-left first-fit sobre una grilla de ocupacion. Una pieza en U o en
 *    L deja anidar otra adentro, cosa que el rectangulo nunca permite. Cuesta
 *    mas tiempo y la precision es la del paso de grilla.
 *
 * La via rasterizada se eligio sobre los no-fit polygons a proposito: el NFP
 * exacto para poligonos con concavidades y agujeros es otro orden de problema
 * (descomposicion convexa + suma de Minkowski + robustez numerica), y la
 * grilla da el mismo resultado practico con un error acotado por el paso.
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
  /** Empacar por contorno real en vez de por rectangulo envolvente. */
  trueShape?: boolean
  /** Giros a probar en true-shape (2 = 0/180, 4 = cada 90, 8 = cada 45...). */
  rotations?: number
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
  /** Fraccion del area util cubierta por el contorno de las piezas (0..1). */
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
// TRUE-SHAPE: RASTERIZADO + BOTTOM-LEFT
// ============================================

/** Mascara de una pieza en celdas, guardada como tramos por fila. */
interface ShapeMask {
  /** Ancho y alto en celdas, ya con el borde de separacion incluido. */
  cols: number
  rows: number
  /** Por fila, pares [inicio, fin) de celdas ocupadas. */
  spans: number[][]
  /** Celdas de relleno agregadas alrededor del contorno (separacion). */
  pad: number
  /** Bounding box del contorno girado, en mm. */
  minX: number
  minY: number
  width: number
  height: number
}

/** Area del poligono (shoelace). Siempre positiva. */
export function polygonArea(pts: Point2D[]): number {
  let acc = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    acc += a.x * b.y - b.x * a.y
  }
  return Math.abs(acc) / 2
}

/** Gira el poligono alrededor del origen, en grados CAD (CCW). */
function rotatePolygon(pts: Point2D[], deg: number): Point2D[] {
  if (deg === 0) return pts
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const sn = Math.sin(rad)
  return pts.map((p) => ({ x: p.x * c - p.y * sn, y: p.x * sn + p.y * c }))
}

/**
 * Rasteriza el poligono a celdas con relleno par-impar por scanline, y lo
 * engorda `pad` celdas para que la separacion entre piezas salga sola.
 */
function rasterizeShape(pts: Point2D[], cell: number, pad: number): ShapeMask | null {
  if (pts.length < 3) return null

  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const width = Math.max(...xs) - minX
  const height = Math.max(...ys) - minY
  if (width <= 0 || height <= 0) return null

  // Sin celda de sobra: una pieza que mide exactamente lo que queda libre
  // tiene que entrar
  const cols = Math.max(1, Math.ceil(width / cell)) + pad * 2
  const rows = Math.max(1, Math.ceil(height / cell)) + pad * 2
  const grid = new Uint8Array(cols * rows)

  // Scanline por el centro de cada fila de celdas
  for (let r = pad; r < rows - pad; r++) {
    const y = minY + (r - pad + 0.5) * cell
    const crossings: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (a.y === b.y) continue
      if (y >= Math.min(a.y, b.y) && y < Math.max(a.y, b.y)) {
        crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
      }
    }
    crossings.sort((p, q) => p - q)

    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const c0 = Math.floor((crossings[k] - minX) / cell)
      const c1 = Math.ceil((crossings[k + 1] - minX) / cell)
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1 - pad * 2, c1); c++) {
        grid[r * cols + (c + pad)] = 1
      }
    }
  }

  // Un contorno muy fino puede no cruzar ningun centro de fila: se marca al
  // menos la celda de cada vertice para que la pieza no desaparezca
  for (const p of pts) {
    const c = Math.round((p.x - minX) / cell) + pad
    const r = Math.round((p.y - minY) / cell) + pad
    if (c >= 0 && c < cols && r >= 0 && r < rows) grid[r * cols + c] = 1
  }

  if (pad > 0) dilate(grid, cols, rows, pad)

  const spans: number[][] = []
  for (let r = 0; r < rows; r++) {
    const rowSpans: number[] = []
    let start = -1
    for (let c = 0; c < cols; c++) {
      const on = grid[r * cols + c] === 1
      if (on && start < 0) start = c
      if (!on && start >= 0) {
        rowSpans.push(start, c)
        start = -1
      }
    }
    if (start >= 0) rowSpans.push(start, cols)
    spans.push(rowSpans)
  }

  return { cols, rows, spans, pad, minX, minY, width, height }
}

/** Dilatacion cuadrada de radio `r`, separada en horizontal y vertical. */
function dilate(grid: Uint8Array, cols: number, rows: number, r: number): void {
  const tmp = new Uint8Array(grid.length)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!grid[y * cols + x]) continue
      const from = Math.max(0, x - r)
      const to = Math.min(cols - 1, x + r)
      for (let c = from; c <= to; c++) tmp[y * cols + c] = 1
    }
  }
  grid.fill(0)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!tmp[y * cols + x]) continue
      const from = Math.max(0, y - r)
      const to = Math.min(rows - 1, y + r)
      for (let rr = from; rr <= to; rr++) grid[rr * cols + x] = 1
    }
  }
}

/** Grilla de ocupacion del area util, en bits (32 celdas por palabra). */
class OccupancyGrid {
  readonly cols: number
  readonly rows: number
  private readonly wordsPerRow: number
  private readonly bits: Uint32Array

  constructor(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    this.wordsPerRow = Math.ceil(cols / 32)
    this.bits = new Uint32Array(this.wordsPerRow * rows)
  }

  /** true si alguna celda del tramo [x0, x1) de la fila esta ocupada. */
  spanBusy(row: number, x0: number, x1: number): boolean {
    const base = row * this.wordsPerRow
    const w0 = x0 >> 5
    const w1 = (x1 - 1) >> 5
    // Palabras del medio: comparacion directa; los bordes van enmascarados
    for (let w = w0; w <= w1; w++) {
      let mask = 0xffffffff
      if (w === w0) mask &= 0xffffffff << (x0 & 31)
      if (w === w1) {
        const end = (x1 - 1) & 31
        mask &= end === 31 ? 0xffffffff : ~(0xffffffff << (end + 1))
      }
      if ((this.bits[base + w] & mask) !== 0) return true
    }
    return false
  }

  markSpan(row: number, x0: number, x1: number): void {
    const base = row * this.wordsPerRow
    for (let x = x0; x < x1; x++) {
      this.bits[base + (x >> 5)] |= 1 << (x & 31)
    }
  }
}

/** ¿Cabe la mascara con su esquina inferior izquierda en (cx, cy)? */
function maskFits(grid: OccupancyGrid, mask: ShapeMask, cx: number, cy: number): boolean {
  for (let r = 0; r < mask.rows; r++) {
    const rowSpans = mask.spans[r]
    if (rowSpans.length === 0) continue
    const row = cy + r
    for (let i = 0; i < rowSpans.length; i += 2) {
      if (grid.spanBusy(row, cx + rowSpans[i], cx + rowSpans[i + 1])) return false
    }
  }
  return true
}

function stampMask(grid: OccupancyGrid, mask: ShapeMask, cx: number, cy: number): void {
  for (let r = 0; r < mask.rows; r++) {
    const rowSpans = mask.spans[r]
    for (let i = 0; i < rowSpans.length; i += 2) {
      grid.markSpan(cy + r, cx + rowSpans[i], cx + rowSpans[i + 1])
    }
  }
}

/**
 * Empaque por contorno real: para cada pieza se prueba cada giro y se toma la
 * primera posicion libre recorriendo de abajo hacia arriba y de izquierda a
 * derecha (bottom-left first-fit). Entre giros gana el que quede mas abajo.
 */
function planTrueShape(pieces: NestingPiece[], opts: NestingOptions): NestingResult {
  const usableW = opts.binWidth - opts.margin * 2
  const usableH = opts.binHeight - opts.margin * 2

  // El paso de grilla acota la precision y el costo: mas fino aprovecha mejor
  // el material pero multiplica las posiciones a probar
  const cell = Math.min(3, Math.max(0.4, Math.min(usableW, usableH) / 250))
  const gridCols = Math.floor(usableW / cell)
  const gridRows = Math.floor(usableH / cell)
  if (gridCols <= 0 || gridRows <= 0) {
    return { placements: [], unplaced: pieces.map((p) => p.id), usage: 0 }
  }

  const pad = Math.max(0, Math.round(opts.spacing / 2 / cell))

  // La grilla se agranda `pad` celdas por lado y el area util queda adentro:
  // la separacion es entre piezas, no contra el borde, asi que el relleno
  // puede asomarse fuera del area sin que la pieza se salga
  const grid = new OccupancyGrid(gridCols + pad * 2, gridRows + pad * 2)
  const originOffset = opts.margin - pad * cell

  const steps = Math.max(1, Math.round(opts.rotations ?? 4))
  const angles = Array.from({ length: steps }, (_, i) => (360 / steps) * i)
  const placements: NestingPlacement[] = []
  const unplaced: string[] = []
  let usedArea = 0

  // Las piezas grandes primero: colocadas al final no encuentran hueco
  const queue = [...pieces]
    .filter((p) => p.outline.length >= 3)
    .sort((a, b) => polygonArea(b.outline) - polygonArea(a.outline))

  for (const piece of pieces) {
    if (piece.outline.length < 3) unplaced.push(piece.id)
  }

  for (const piece of queue) {
    let best: { angle: number; cx: number; cy: number; mask: ShapeMask } | null = null

    // Enderezar la pieza contra su rectangulo minimo suele dar el mejor
    // encaje de todos, y los pasos regulares no lo encuentran salvo por azar
    const candidates = [...angles]
    if (opts.alignToMinRect) {
      const straighten = -(minAreaRect(piece.outline).angle * 180) / Math.PI
      candidates.push(straighten, straighten + 90)
    }

    for (const angle of candidates) {
      const rotated = rotatePolygon(piece.outline, angle)
      const mask = rasterizeShape(rotated, cell, pad)
      if (!mask) continue
      if (mask.cols > grid.cols || mask.rows > grid.rows) continue

      let found: { cx: number; cy: number } | null = null
      for (let cy = 0; cy + mask.rows <= grid.rows && !found; cy++) {
        for (let cx = 0; cx + mask.cols <= grid.cols; cx++) {
          if (maskFits(grid, mask, cx, cy)) {
            found = { cx, cy }
            break
          }
        }
      }
      if (!found) continue

      // Gana la posicion mas baja; a igual altura, la mas a la izquierda
      if (!best || found.cy < best.cy || (found.cy === best.cy && found.cx < best.cx)) {
        best = { angle, cx: found.cx, cy: found.cy, mask: mask }
      }
    }

    if (!best) {
      unplaced.push(piece.id)
      continue
    }

    stampMask(grid, best.mask, best.cx, best.cy)
    usedArea += polygonArea(piece.outline)

    // La mascara arranca `pad` celdas antes del contorno
    const originX = originOffset + (best.cx + best.mask.pad) * cell
    const originY = originOffset + (best.cy + best.mask.pad) * cell

    placements.push({
      id: piece.id,
      rotateDeg: best.angle,
      centerX: originX + best.mask.width / 2,
      centerY: originY + best.mask.height / 2,
    })
  }

  return {
    placements,
    unplaced,
    usage: usableW * usableH > 0 ? usedArea / (usableW * usableH) : 0,
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

  if (opts.trueShape) return planTrueShape(pieces, opts)

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
  const outlineById = new Map(pieces.map((p) => [p.id, p.outline]))

  for (const rect of packed) {
    const m = measured.get(rect.id)
    if (!m) continue

    const realW = rect.rotated ? m.h : m.w
    const realH = rect.rotated ? m.w : m.h
    // El area ocupada se mide sobre el contorno, no sobre el rectangulo: asi
    // el porcentaje significa lo mismo en las dos estrategias
    usedArea += polygonArea(outlineById.get(rect.id) ?? [])

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
