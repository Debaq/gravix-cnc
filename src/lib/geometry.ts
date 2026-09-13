import type { Point2D } from './types'
import {
  loadNativeClipperLibInstanceAsync,
  NativeClipperLibRequestedFormat,
  JoinType,
  EndType,
  type ClipperLibWrapper,
  type IntPoint,
} from 'js-angusj-clipper/web'

// Factor de escala para convertir mm (float) a enteros de Clipper
// 1000 = precisión de 0.001mm (1 micra), más que suficiente para CNC
export const CLIPPER_SCALE = 1000

// Instancia lazy de Clipper (se carga una sola vez)
let clipperInstance: ClipperLibWrapper | null = null

export async function getClipper(): Promise<ClipperLibWrapper> {
  if (!clipperInstance) {
    clipperInstance = await loadNativeClipperLibInstanceAsync(
      NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
    )
  }
  return clipperInstance
}

// ============================================
// CONVERSIÓN CLIPPER ↔ POINT2D
// ============================================

export function toClipperPath(points: Point2D[]): IntPoint[] {
  return points.map(p => ({
    x: Math.round(p.x * CLIPPER_SCALE),
    y: Math.round(p.y * CLIPPER_SCALE),
  }))
}

export function fromClipperPath(path: IntPoint[]): Point2D[] {
  return path.map(p => ({
    x: Math.round((p.x / CLIPPER_SCALE) * 1000) / 1000,
    y: Math.round((p.y / CLIPPER_SCALE) * 1000) / 1000,
  }))
}

// ============================================
// LINEARIZACIÓN DE BEZIER
// ============================================

export function linearizeCubicBezier(
  p0: Point2D, cp1: Point2D, cp2: Point2D, p3: Point2D,
  tolerance: number = 0.1
): Point2D[] {
  const result: Point2D[] = [p0]
  subdivCubic(p0, cp1, cp2, p3, tolerance * tolerance, result)
  return result
}

function subdivCubic(
  p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D,
  tolSq: number, out: Point2D[]
) {
  // Test de planitud: distancia máxima de los puntos de control a la línea p0-p3
  const dx = p3.x - p0.x
  const dy = p3.y - p0.y
  const d1 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx)
  const d2 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx)
  const dSq = dx * dx + dy * dy

  if (dSq > 0 && ((d1 + d2) * (d1 + d2)) / dSq <= tolSq) {
    out.push(p3)
    return
  }

  // De Casteljau subdivision
  const m01 = mid(p0, p1)
  const m12 = mid(p1, p2)
  const m23 = mid(p2, p3)
  const m012 = mid(m01, m12)
  const m123 = mid(m12, m23)
  const m0123 = mid(m012, m123)

  subdivCubic(p0, m01, m012, m0123, tolSq, out)
  subdivCubic(m0123, m123, m23, p3, tolSq, out)
}

export function linearizeQuadraticBezier(
  p0: Point2D, cp: Point2D, p2: Point2D,
  tolerance: number = 0.1
): Point2D[] {
  const result: Point2D[] = [p0]
  subdivQuad(p0, cp, p2, tolerance * tolerance, result)
  return result
}

function subdivQuad(
  p0: Point2D, p1: Point2D, p2: Point2D,
  tolSq: number, out: Point2D[]
) {
  const dx = p2.x - p0.x
  const dy = p2.y - p0.y
  const d = Math.abs((p1.x - p2.x) * dy - (p1.y - p2.y) * dx)
  const dSq = dx * dx + dy * dy

  if (dSq > 0 && (d * d) / dSq <= tolSq) {
    out.push(p2)
    return
  }

  const m01 = mid(p0, p1)
  const m12 = mid(p1, p2)
  const m012 = mid(m01, m12)

  subdivQuad(p0, m01, m012, tolSq, out)
  subdivQuad(m012, m12, p2, tolSq, out)
}

function mid(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

// ============================================
// OFFSET DE POLÍGONOS (Wrapper Clipper)
// ============================================

export async function offsetPolygon(
  points: Point2D[],
  offset: number,
  closed: boolean = true,
  joinType: 'round' | 'miter' | 'square' = 'round'
): Promise<Point2D[][]> {
  if (points.length < 2) return []
  if (Math.abs(offset) < 0.001) return [points]

  const clipper = await getClipper()
  const clipperPath = toClipperPath(points)
  const delta = offset * CLIPPER_SCALE

  const jt = joinType === 'round' ? JoinType.Round
    : joinType === 'miter' ? JoinType.Miter
    : JoinType.Square

  const et = closed ? EndType.ClosedPolygon : EndType.OpenRound

  const result = clipper.offsetToPaths({
    delta,
    offsetInputs: [{
      joinType: jt,
      endType: et,
      data: clipperPath,
    }],
    miterLimit: 2,
    arcTolerance: 0.25 * CLIPPER_SCALE,
  })

  if (!result || result.length === 0) return []
  return result.map(fromClipperPath)
}

// ============================================
// GENERACIÓN DE CONTORNOS DE POCKET
// ============================================

export interface PocketResult {
  roughing: Point2D[][]
  finishing: Point2D[]
}

export async function generatePocketContours(
  boundary: Point2D[],
  toolRadius: number,
  stepover: number,
  /** Retracción inicial desde el borde. Por defecto el radio de la
   *  herramienta, porque `boundary` delimita material. Pasar 0 cuando
   *  `boundary` ya es una región de centro de herramienta (rest machining). */
  initialInset: number = toolRadius
): Promise<PocketResult> {
  const toolDiameter = toolRadius * 2
  const stepDistance = toolDiameter * stepover

  // Pasada de acabado: contorno al ras de la retracción inicial
  const finishingPaths = initialInset > 0
    ? await offsetPolygon(boundary, -initialInset, true, 'round')
    : [boundary]
  if (finishingPaths.length === 0) {
    return { roughing: [], finishing: [] }
  }
  const finishing = finishingPaths[0]

  // Contornos de desbaste: offsets progresivos hacia adentro
  const roughing: Point2D[][] = []
  let currentInset = initialInset

  for (;;) {
    const contours = currentInset > 0
      ? await offsetPolygon(boundary, -currentInset, true, 'round')
      : [boundary]
    if (contours.length === 0) break
    roughing.push(...contours)
    currentInset += stepDistance
  }

  return { roughing, finishing }
}

// ============================================
// ORDENAMIENTO DE PATHS (Nearest Neighbor)
// ============================================

/**
 * Order paths using nearest-neighbor with path reversal optimization.
 * For each candidate, checks both start and end point — if end is closer,
 * reverses the path. Reduces travel distance 30-50% on complex designs.
 */
export function orderPaths(paths: Point2D[][]): Point2D[][] {
  if (paths.length <= 1) return paths

  // Deduplicate identical paths
  const unique: Point2D[][] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (path.length === 0) continue
    const key = `${path[0].x.toFixed(2)},${path[0].y.toFixed(2)}-${path.length}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(path)
    }
  }

  const remaining = [...unique]
  const ordered: Point2D[][] = []
  let currentPos: Point2D = { x: 0, y: 0 }

  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = Infinity
    let reverse = false

    for (let i = 0; i < remaining.length; i++) {
      const path = remaining[i]
      const start = path[0]
      const end = path[path.length - 1]
      if (!start || !end) continue

      const dStart = distSq(currentPos, start)
      const dEnd = distSq(currentPos, end)

      if (dStart < nearestDist) {
        nearestDist = dStart
        nearestIdx = i
        reverse = false
      }
      if (dEnd < nearestDist) {
        nearestDist = dEnd
        nearestIdx = i
        reverse = true
      }
    }

    let path = remaining.splice(nearestIdx, 1)[0]
    if (reverse) path = [...path].reverse()

    ordered.push(path)
    const last = path[path.length - 1]
    if (last) currentPos = last
  }

  return ordered
}

function distSq(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dx * dx + dy * dy
}

// ============================================
// POINT-IN-POLYGON (Ray casting)
// ============================================

export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    if (
      ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)
    ) {
      inside = !inside
    }
  }
  return inside
}

// ============================================
// INSIDE-FIRST ORDERING (para láser/CNC)
// ============================================

/**
 * Reordena paths para que los interiores se corten/graben primero.
 * Detecta containment: si todos los puntos de un path están dentro de otro,
 * el interior va primero. Después aplica nearest-neighbor dentro de cada nivel.
 */
export function orderPathsInsideFirst(
  paths: { points: Point2D[]; closed: boolean }[]
): { points: Point2D[]; closed: boolean }[] {
  if (paths.length <= 1) return paths

  // Build containment: count how many other closed paths contain each path
  const depth: number[] = new Array(paths.length).fill(0)

  for (let i = 0; i < paths.length; i++) {
    if (paths[i].points.length === 0) continue
    const testPoint = paths[i].points[0]

    for (let j = 0; j < paths.length; j++) {
      if (i === j) continue
      if (!paths[j].closed || paths[j].points.length < 3) continue
      if (pointInPolygon(testPoint, paths[j].points)) {
        depth[i]++
      }
    }
  }

  // Sort: deeper (more contained) paths first, then nearest-neighbor within same depth
  const indexed = paths.map((p, i) => ({ path: p, depth: depth[i], index: i }))
  indexed.sort((a, b) => b.depth - a.depth)  // deepest first

  // Group by depth level, apply nearest-neighbor within each group
  const result: { points: Point2D[]; closed: boolean }[] = []
  let currentPos: Point2D = { x: 0, y: 0 }

  // Group into depth buckets
  const buckets = new Map<number, typeof indexed>()
  for (const item of indexed) {
    const bucket = buckets.get(item.depth) || []
    bucket.push(item)
    buckets.set(item.depth, bucket)
  }

  // Process from deepest to shallowest
  const depths = [...buckets.keys()].sort((a, b) => b - a)
  for (const d of depths) {
    const bucket = buckets.get(d)!
    const remaining = [...bucket]

    while (remaining.length > 0) {
      let nearestIdx = 0
      let nearestDist = Infinity

      for (let i = 0; i < remaining.length; i++) {
        const start = remaining[i].path.points[0]
        if (!start) continue
        const dist = distSq(currentPos, start)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestIdx = i
        }
      }

      const item = remaining.splice(nearestIdx, 1)[0]
      result.push(item.path)
      const pts = item.path.points
      const last = pts[pts.length - 1]
      if (last) currentPos = last
    }
  }

  return result
}

// ============================================
// GENERACIÓN DE LÍNEAS DE RELLENO (HATCH/FILL)
// ============================================

/**
 * Genera líneas de relleno (hatch) dentro de un polígono cerrado.
 *
 * @param polygon - Puntos del polígono cerrado
 * @param spacing - Distancia entre líneas en mm
 * @param angleDeg - Ángulo de las líneas en grados (0 = horizontal)
 * @param bidirectional - Si true, alterna la dirección de las líneas (zigzag)
 * @returns Array de segmentos [inicio, fin] dentro del polígono
 */
export function generateHatchLines(
  polygon: Point2D[],
  spacing: number,
  angleDeg: number = 0,
  bidirectional: boolean = true,
): { start: Point2D; end: Point2D }[] {
  if (polygon.length < 3 || spacing <= 0) return []

  const angleRad = (angleDeg * Math.PI) / 180
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)

  // Rotar polígono para trabajar con líneas horizontales
  const rotated = polygon.map(p => ({
    x: p.x * cosA + p.y * sinA,
    y: -p.x * sinA + p.y * cosA,
  }))

  // Bounding box del polígono rotado
  let minY = Infinity, maxY = -Infinity
  for (const p of rotated) {
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  // Generar líneas horizontales en el espacio rotado
  const segments: { start: Point2D; end: Point2D }[] = []
  const startY = Math.ceil(minY / spacing) * spacing
  let lineIndex = 0

  for (let y = startY; y <= maxY; y += spacing) {
    // Encontrar intersecciones con todos los bordes del polígono
    const intersections: number[] = []

    for (let i = 0; i < rotated.length; i++) {
      const j = (i + 1) % rotated.length
      const p1 = rotated[i]
      const p2 = rotated[j]

      // Verificar si la línea horizontal cruza este borde
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        const t = (y - p1.y) / (p2.y - p1.y)
        intersections.push(p1.x + t * (p2.x - p1.x))
      }
    }

    // Ordenar intersecciones de izquierda a derecha
    intersections.sort((a, b) => a - b)

    // Emparejar intersecciones (entrada/salida) para obtener segmentos interiores
    for (let k = 0; k + 1 < intersections.length; k += 2) {
      let sx = intersections[k]
      let ex = intersections[k + 1]

      // Bidireccional: alternar dirección en líneas pares/impares
      if (bidirectional && lineIndex % 2 === 1) {
        const tmp = sx
        sx = ex
        ex = tmp
      }

      // Rotar de vuelta al espacio original
      const start: Point2D = {
        x: sx * cosA - y * sinA,
        y: sx * sinA + y * cosA,
      }
      const end: Point2D = {
        x: ex * cosA - y * sinA,
        y: ex * sinA + y * cosA,
      }

      segments.push({ start, end })
    }

    lineIndex++
  }

  return segments
}

// ============================================
// POCKET ZIGZAG (Raster / Scanline)
// ============================================

export interface PocketZigzagResult {
  /** Segmentos de barrido paralelo que vacían el interior */
  hatch: { start: Point2D; end: Point2D }[]
  /** Contornos de acabado (perímetro a radio de herramienta) */
  finishing: Point2D[][]
}

/**
 * Estrategia de cajeado zigzag: barrido paralelo del interior más una
 * pasada de acabado por el perímetro. Complementa a
 * `generatePocketContours` (estrategia contour-parallel).
 */
export async function generatePocketZigzag(
  boundary: Point2D[],
  toolRadius: number,
  stepover: number,
  angleDeg: number = 45,
  /** Ver `generatePocketContours`: 0 si `boundary` ya es región de centro */
  initialInset: number = toolRadius
): Promise<PocketZigzagResult> {
  const stepDistance = toolRadius * 2 * stepover
  if (stepDistance <= 0) return { hatch: [], finishing: [] }

  // Región alcanzable por el centro de la herramienta
  const inner = initialInset > 0
    ? await offsetPolygon(boundary, -initialInset, true, 'round')
    : [boundary]
  if (inner.length === 0) return { hatch: [], finishing: [] }

  // El barrido se retrae medio stepover para que la pasada de acabado
  // no tenga que retirar material a ancho completo de herramienta
  const hatch: { start: Point2D; end: Point2D }[] = []
  for (const contour of inner) {
    const hatchArea = await offsetPolygon(contour, -stepDistance / 2, true, 'round')
    for (const region of hatchArea.length > 0 ? hatchArea : [contour]) {
      hatch.push(...generateHatchLines(region, stepDistance, angleDeg, true))
    }
  }

  return { hatch, finishing: inner }
}

// ============================================
// ANCHO MÍNIMO DE FEATURES (Tool vs Geometry)
// ============================================

/**
 * Distancia punto-a-segmento (perpendicular o al extremo más cercano).
 */
function pointToSegmentDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-10) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

/**
 * Estima el ancho mínimo de un polígono cerrado.
 * Para cada vértice, mide distancia a aristas no adyacentes.
 * El mínimo es una aproximación del "cuello" más estrecho.
 *
 * Para paths con muchos puntos (ej: texto), samplea cada N puntos.
 */
export function estimateMinFeatureWidth(points: Point2D[]): number {
  const n = points.length
  if (n < 3) return 0

  let minWidth = Infinity

  // Sampleo: max ~200 puntos para mantener O(n²) manejable
  const step = Math.max(1, Math.floor(n / 200))

  for (let i = 0; i < n; i += step) {
    const p = points[i]

    for (let j = 0; j < n; j++) {
      // Saltar aristas adyacentes (misma arista y vecinas)
      const next = (j + 1) % n
      if (j === i || j === (i - 1 + n) % n || next === i || next === (i + 1) % n) continue

      const a = points[j]
      const b = points[next]
      const dist = pointToSegmentDist(p, a, b)
      if (dist < minWidth) minWidth = dist
    }
  }

  return minWidth === Infinity ? 0 : minWidth
}

/**
 * Valida si una herramienta CNC cabe en un conjunto de paths.
 * Retorna warnings para paths donde el diámetro de herramienta es mayor
 * que el ancho mínimo del feature.
 */
export function validateToolVsPaths(
  paths: { points: Point2D[]; closed: boolean }[],
  toolDiameter: number,
  workType: string,
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = []
  const errors: string[] = []

  if (toolDiameter <= 0) return { warnings, errors }

  const toolRadius = toolDiameter / 2

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    if (!path.closed || path.points.length < 3) continue

    const minWidth = estimateMinFeatureWidth(path.points)
    if (minWidth <= 0) continue

    if (workType === 'inside' || workType === 'pocket') {
      // Herramienta debe caber adentro: diámetro < ancho mínimo
      if (toolDiameter >= minWidth) {
        errors.push(
          `Path ${i + 1}: herramienta ${toolDiameter}mm no cabe en shape de ${minWidth.toFixed(2)}mm ancho (${workType})`
        )
      } else if (toolDiameter > minWidth * 0.8) {
        warnings.push(
          `Path ${i + 1}: herramienta ${toolDiameter}mm muy ajustada para shape de ${minWidth.toFixed(2)}mm (${workType})`
        )
      }
    } else if (workType === 'outline') {
      // En outline, herramienta corta a lo largo del path — si el feature es
      // más angosto que el diámetro, detalle se pierde
      if (toolDiameter > minWidth) {
        warnings.push(
          `Path ${i + 1}: herramienta ${toolDiameter}mm mas ancha que detalle de ${minWidth.toFixed(2)}mm — se perdera detalle`
        )
      }
    } else if (workType === 'vcarve' || workType === 'chamfer') {
      // V-carve/chamfer adaptan profundidad, pero si es extremo, advertir
      if (toolDiameter > minWidth * 2) {
        warnings.push(
          `Path ${i + 1}: herramienta ${toolDiameter}mm grande para detalle de ${minWidth.toFixed(2)}mm`
        )
      }
    }
  }

  return { warnings, errors }
}

// ============================================
// ARCO POR 3 PUNTOS
// ============================================

/**
 * Calcula el círculo que pasa por 3 puntos usando bisectrices perpendiculares.
 * Retorna null si los puntos son colineales.
 */
export function circleFrom3Points(
  p1: Point2D, p2: Point2D, p3: Point2D,
): { cx: number; cy: number; r: number } | null {
  const ax = p1.x, ay = p1.y
  const bx = p2.x, by = p2.y
  const cx = p3.x, cy = p3.y

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-10) return null // colineales

  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d

  const r = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2)
  return { cx: ux, cy: uy, r }
}

/**
 * Lineariza un arco circular a segmentos de línea.
 * @param cx, cy - centro del círculo
 * @param r - radio
 * @param startAngle - ángulo inicial (radianes)
 * @param endAngle - ángulo final (radianes)
 * @param cw - true = sentido horario
 * @param segmentsPerRadian - resolución (~18 = ~1 punto cada 3.2°)
 */
export function linearizeArc(
  cx: number, cy: number, r: number,
  startAngle: number, endAngle: number,
  cw: boolean,
  segmentsPerRadian = 18,
): Point2D[] {
  let sweep = endAngle - startAngle
  if (cw && sweep > 0) sweep -= 2 * Math.PI
  if (!cw && sweep < 0) sweep += 2 * Math.PI

  const numSegments = Math.max(4, Math.round(Math.abs(sweep) * segmentsPerRadian))
  const points: Point2D[] = []

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments
    const angle = startAngle + sweep * t
    points.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    })
  }

  return points
}

/**
 * Dado 3 puntos (inicio, medio, fin), calcula los parámetros del arco
 * y retorna los puntos linearizados.
 */
export function arcFrom3Points(
  p1: Point2D, p2: Point2D, p3: Point2D,
  segmentsPerRadian = 18,
): Point2D[] {
  const circle = circleFrom3Points(p1, p2, p3)
  if (!circle) {
    // Colineales: retornar línea recta
    return [p1, p3]
  }

  const { cx, cy, r } = circle
  const a1 = Math.atan2(p1.y - cy, p1.x - cx)
  const a2 = Math.atan2(p2.y - cy, p2.x - cx)
  const a3 = Math.atan2(p3.y - cy, p3.x - cx)

  // Determinar dirección: el arco debe pasar por p2 entre p1 y p3
  // Probar CW y CCW, elegir el que pase más cerca de p2
  const cwPoints = linearizeArc(cx, cy, r, a1, a3, true, segmentsPerRadian)
  const ccwPoints = linearizeArc(cx, cy, r, a1, a3, false, segmentsPerRadian)

  // Medir distancia mínima de p2 al arco CW vs CCW
  const distToArc = (pts: Point2D[]) => {
    let minD = Infinity
    for (const p of pts) {
      const d = (p.x - p2.x) ** 2 + (p.y - p2.y) ** 2
      if (d < minD) minD = d
    }
    return minD
  }

  return distToArc(cwPoints) < distToArc(ccwPoints) ? cwPoints : ccwPoints
}

// ============================================
// CATMULL-ROM → CUBIC BEZIER
// ============================================

interface BezierSegment {
  cp1: Point2D
  cp2: Point2D
  end: Point2D
}

/**
 * Convierte una serie de puntos ancla en segmentos de Bezier cúbica
 * usando interpolación Catmull-Rom (curva pasa por todos los puntos).
 */
export function catmullRomToCubicBezier(
  points: Point2D[],
  closed: boolean,
): BezierSegment[] {
  const n = points.length
  if (n < 2) return []

  const segments: BezierSegment[] = []
  const segCount = closed ? n : n - 1

  for (let i = 0; i < segCount; i++) {
    const p0 = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[closed ? (i + 2) % n : Math.min(n - 1, i + 2)]

    segments.push({
      cp1: {
        x: p1.x + (p2.x - p0.x) / 6,
        y: p1.y + (p2.y - p0.y) / 6,
      },
      cp2: {
        x: p2.x - (p3.x - p1.x) / 6,
        y: p2.y - (p3.y - p1.y) / 6,
      },
      end: p2,
    })
  }

  return segments
}

/**
 * Evalúa puntos a lo largo de una curva Catmull-Rom (para preview rendering).
 * Retorna puntos muestreados a lo largo de toda la curva.
 */
export function sampleCatmullRom(
  points: Point2D[],
  closed: boolean,
  samplesPerSegment = 16,
): Point2D[] {
  const segments = catmullRomToCubicBezier(points, closed)
  if (segments.length === 0) return [...points]

  const result: Point2D[] = [points[0]]

  for (const seg of segments) {
    const start = result[result.length - 1]
    for (let t = 1; t <= samplesPerSegment; t++) {
      const u = t / samplesPerSegment
      const u2 = u * u, u3 = u2 * u
      const mu = 1 - u, mu2 = mu * mu, mu3 = mu2 * mu
      result.push({
        x: mu3 * start.x + 3 * mu2 * u * seg.cp1.x + 3 * mu * u2 * seg.cp2.x + u3 * seg.end.x,
        y: mu3 * start.y + 3 * mu2 * u * seg.cp1.y + 3 * mu * u2 * seg.cp2.y + u3 * seg.end.y,
      })
    }
  }

  return result
}

// ============================================
// ORIENTACION Y SENTIDO DE FRESADO
// ============================================

/** Area con signo. Positiva = antihorario (CCW) en ejes de maquina (Y arriba). */
export function signedArea(points: Point2D[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export function isCounterClockwise(points: Point2D[]): boolean {
  return signedArea(points) > 0
}

/** Devuelve el path recorrido en el sentido pedido (no muta el original). */
export function withOrientation(points: Point2D[], counterClockwise: boolean): Point2D[] {
  if (points.length < 3) return points
  return isCounterClockwise(points) === counterClockwise ? points : [...points].reverse()
}

/**
 * Sentido de recorrido para un contorno cerrado.
 *
 * Con la fresa girando en horario (lo normal en un router), el fresado en
 * concordancia (climb) deja la fresa empujando contra material sin cortar: por
 * fuera de la pieza se recorre en horario y por dentro en antihorario. El
 * fresado en oposicion (conventional) es al reves.
 */
export function millingCounterClockwise(
  workType: string,
  direction: 'climb' | 'conventional',
): boolean {
  // Por fuera del contorno la fresa deja la pieza a su izquierda en CW
  const outside = workType === 'outside'
  const climbCCW = !outside
  return direction === 'climb' ? climbCCW : !climbCCW
}

// ============================================
// ENTRADA / SALIDA TANGENTE (LEAD-IN / LEAD-OUT)
// ============================================

/**
 * Normal unitaria del path en su primer (o ultimo) punto, apuntando al lado
 * donde NO hay material, que es por donde tiene que venir la fresa.
 */
function leadNormal(points: Point2D[], atEnd: boolean, outward: boolean): { n: Point2D; t: Point2D } | null {
  const n = points.length
  if (n < 2) return null

  const a = atEnd ? points[n - 2] : points[0]
  const b = atEnd ? points[n - 1] : points[1]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return null

  const t = { x: dx / len, y: dy / len }
  // Normal izquierda respecto al avance
  const left = { x: -t.y, y: t.x }
  const ccw = isCounterClockwise(points)
  // En CCW el interior queda a la izquierda del avance
  const interior = ccw ? left : { x: -left.x, y: -left.y }
  const nrm = outward ? { x: -interior.x, y: -interior.y } : interior
  return { n: nrm, t }
}

/**
 * Puntos de aproximacion al contorno. `line` entra perpendicular al contorno
 * desde el lado libre; `arc` describe un cuarto de circunferencia tangente al
 * contorno, que es lo que evita la marca de entrada en el canto.
 *
 * Devuelve los puntos ANTES del inicio del path (entrada) o DESPUES del final
 * (salida, con `atEnd`). Vacio si no corresponde.
 */
export function buildLead(
  points: Point2D[],
  type: 'none' | 'line' | 'arc',
  length: number,
  outward: boolean,
  atEnd = false,
  arcSegments = 8,
): Point2D[] {
  if (type === 'none' || length <= 0 || points.length < 2) return []
  const base = leadNormal(points, atEnd, outward)
  if (!base) return []

  const p = atEnd ? points[points.length - 1] : points[0]
  const { n, t } = base

  if (type === 'line') {
    const start = { x: p.x + n.x * length, y: p.y + n.y * length }
    return atEnd ? [start] : [start]
  }

  // Arco tangente: centro desplazado una normal, barrido de 90 grados
  const r = length
  const cx = p.x + n.x * r
  const cy = p.y + n.y * r
  // Angulo del punto de contacto visto desde el centro
  const a0 = Math.atan2(p.y - cy, p.x - cx)
  // Con el angulo creciendo, la velocidad sobre el circulo en `p` apunta a
  // (n.y, -n.x). El signo dice si hay que recorrerlo en ese sentido o al reves
  // para que la tangente del arco coincida con el avance del contorno.
  const sign = (t.x * n.y - t.y * n.x) >= 0 ? 1 : -1
  const sweep = (Math.PI / 2) * sign * (atEnd ? 1 : -1)

  const out: Point2D[] = []
  for (let i = 0; i <= arcSegments; i++) {
    const f = i / arcSegments
    const ang = atEnd ? a0 + sweep * f : a0 + sweep * (1 - f)
    out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) })
  }
  // El extremo que coincide con el contorno lo aporta el propio path
  if (atEnd) out.shift()
  else out.pop()
  return out
}

// ============================================
// POCKET EN ESPIRAL
// ============================================

/** Rota un anillo cerrado para que empiece en el punto mas cercano a `ref`. */
function rotateRingToNearest(ring: Point2D[], ref: Point2D): Point2D[] {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = (ring[i].x - ref.x) ** 2 + (ring[i].y - ref.y) ** 2
    if (d < bestD) { bestD = d; best = i }
  }
  const rotated = [...ring.slice(best), ...ring.slice(0, best)]
  rotated.push(rotated[0])
  return rotated
}

/**
 * Cajeado en espiral: los mismos anillos del contour-parallel pero encadenados
 * de adentro hacia afuera en un solo recorrido continuo, sin levantar la fresa
 * entre anillo y anillo. Cada anillo arranca en el punto mas cercano al final
 * del anterior, que es el paso lateral de la espiral.
 *
 * Devuelve una polilinea ABIERTA por isla.
 */
export async function generatePocketSpiral(
  boundary: Point2D[],
  toolRadius: number,
  stepover: number,
  initialInset: number = toolRadius,
): Promise<Point2D[][]> {
  const { roughing } = await generatePocketContours(
    boundary, toolRadius, stepover, initialInset,
  )
  if (roughing.length === 0) return []

  // `generatePocketContours` entrega de afuera hacia adentro; la espiral va al
  // reves y termina en el anillo exterior, que hace de pasada de acabado. El
  // `finishing` que devuelve es ese mismo anillo, asi que no se agrega aparte.
  const inward = [...roughing].reverse().filter((r) => r.length >= 3)
  if (inward.length === 0) return []

  const spiral: Point2D[] = []
  let ref = inward[0][0]

  for (const ring of inward) {
    const rotated = rotateRingToNearest(ring, ref)
    spiral.push(...rotated)
    ref = rotated[rotated.length - 1]
  }

  return [spiral]
}

// ============================================
// ORDEN DE OPERACIONES (minimizar rapidos)
// ============================================

/**
 * Ordena bloques (operaciones) por vecino mas cercano entre el punto donde
 * termina uno y donde empieza el siguiente. Trabaja sobre indices para no
 * copiar geometria: devuelve el orden de los indices originales.
 */
export function orderByNearestEntry(
  entries: { start: Point2D; end: Point2D }[],
  origin: Point2D = { x: 0, y: 0 },
): number[] {
  if (entries.length <= 1) return entries.map((_, i) => i)

  const remaining = entries.map((_, i) => i)
  const order: number[] = []
  let cursor = origin

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const e = entries[remaining[i]]
      const d = (e.start.x - cursor.x) ** 2 + (e.start.y - cursor.y) ** 2
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    const chosen = remaining.splice(bestIdx, 1)[0]
    order.push(chosen)
    cursor = entries[chosen].end
  }

  return order
}

// ============================================
// DESBASTE TROCOIDAL
// ============================================

/** Reparametriza una polilinea a puntos equiespaciados sobre su longitud. */
function resampleByArcLength(points: Point2D[], spacing: number, closed: boolean): Point2D[] {
  if (points.length < 2 || spacing <= 0) return points
  const loop = closed ? [...points, points[0]] : points

  const out: Point2D[] = [loop[0]]
  let carry = 0

  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1]
    const b = loop[i]
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    if (segLen < 1e-9) continue

    let t = spacing - carry
    while (t <= segLen) {
      const f = t / segLen
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
      t += spacing
    }
    carry = (carry + segLen) % spacing
  }

  return out
}

/**
 * Convierte una guia en un recorrido trocoidal: bucles circulares de radio
 * `loopRadius` cuyo centro avanza `advance` mm por vuelta.
 *
 * La idea es que la fresa nunca entre a ancho completo. En un corte recto la
 * fresa muerde todo su diametro de golpe y se calienta; describiendo bucles,
 * cada vuelta saca una viruta de `advance` mm y el resto del giro va al aire.
 * El ancho barrido queda en `2 * loopRadius + diametro de fresa`.
 */
export function trochoidalPath(
  guide: Point2D[],
  loopRadius: number,
  advance: number,
  closed: boolean,
  segmentsPerLoop = 24,
): Point2D[] {
  if (guide.length < 2 || loopRadius <= 0 || advance <= 0) return guide

  const centers = resampleByArcLength(guide, advance, closed)
  if (centers.length < 2) return guide

  const out: Point2D[] = []

  for (let i = 0; i < centers.length; i++) {
    const c = centers[i]
    // El bucle arranca mirando hacia atras respecto al avance, asi el enlace
    // entre vuelta y vuelta cae sobre material ya cortado.
    const prev = centers[i - 1] ?? centers[i + 1] ?? c
    const dx = c.x - prev.x
    const dy = c.y - prev.y
    const heading = Math.atan2(dy, dx) || 0
    const start = heading + Math.PI

    for (let s = 0; s <= segmentsPerLoop; s++) {
      const ang = start + (s / segmentsPerLoop) * Math.PI * 2
      out.push({
        x: c.x + loopRadius * Math.cos(ang),
        y: c.y + loopRadius * Math.sin(ang),
      })
    }
  }

  return out
}

export interface PocketTrochoidalResult {
  /** Recorridos trocoidales de desbaste (polilineas abiertas). */
  loops: Point2D[][]
  /** Contorno de acabado al ras de la pared. */
  finishing: Point2D[]
}

/**
 * Cajeado trocoidal: los mismos anillos del contour-parallel, pero separados
 * el ancho de banda que barre el bucle y recorridos en trocoide.
 *
 * El desbaste arranca desplazado hacia adentro (el bucle sobresale del anillo
 * guia), asi que el material contra la pared lo saca la pasada de acabado que
 * se devuelve aparte.
 */
export async function generatePocketTrochoidal(
  boundary: Point2D[],
  toolRadius: number,
  stepover: number,
  loopRadius: number,
  initialInset: number = toolRadius,
): Promise<PocketTrochoidalResult> {
  const toolDiameter = toolRadius * 2
  const radius = Math.max(toolRadius * 0.25, loopRadius)
  // Ancho que barre un bucle completo, en pasos de `generatePocketContours`
  const bandWidth = 2 * radius + toolDiameter
  const ringStepover = bandWidth / toolDiameter

  const { roughing } = await generatePocketContours(
    boundary, toolRadius, ringStepover, initialInset + radius,
  )

  const finishingPaths = initialInset > 0
    ? await offsetPolygon(boundary, -initialInset, true, 'round')
    : [boundary]
  const finishing = finishingPaths[0] ?? []

  if (roughing.length === 0) {
    // Cabe el acabado pero no el desbaste: el cajeado es apenas mas ancho que
    // la fresa y se resuelve con una sola vuelta.
    return { loops: [], finishing }
  }

  // El avance por vuelta es la viruta radial de verdad
  const advance = Math.max(0.05, toolDiameter * stepover)

  return {
    loops: roughing
      .filter((ring) => ring.length >= 3)
      .map((ring) => trochoidalPath(ring, radius, advance, true)),
    finishing,
  }
}
