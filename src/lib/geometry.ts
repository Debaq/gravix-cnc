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
const CLIPPER_SCALE = 1000

// Instancia lazy de Clipper (se carga una sola vez)
let clipperInstance: ClipperLibWrapper | null = null

async function getClipper(): Promise<ClipperLibWrapper> {
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

function toClipperPath(points: Point2D[]): IntPoint[] {
  return points.map(p => ({
    x: Math.round(p.x * CLIPPER_SCALE),
    y: Math.round(p.y * CLIPPER_SCALE),
  }))
}

function fromClipperPath(path: IntPoint[]): Point2D[] {
  return path.map(p => ({
    x: Math.round((p.x / CLIPPER_SCALE) * 1000) / 1000,
    y: Math.round((p.y / CLIPPER_SCALE) * 1000) / 1000,
  }))
}

// ============================================
// ÁREA Y DIRECCIÓN DE ENROLLADO
// ============================================

export function polygonArea(points: Point2D[]): number {
  let area = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }
  return area / 2
}

export function ensureCCW(points: Point2D[]): Point2D[] {
  return polygonArea(points) < 0 ? [...points].reverse() : points
}

export function ensureCW(points: Point2D[]): Point2D[] {
  return polygonArea(points) > 0 ? [...points].reverse() : points
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
  stepover: number
): Promise<PocketResult> {
  const toolDiameter = toolRadius * 2
  const stepDistance = toolDiameter * stepover

  // Pasada de acabado: offset exacto del radio de herramienta
  const finishingPaths = await offsetPolygon(boundary, -toolRadius, true, 'round')
  if (finishingPaths.length === 0) {
    return { roughing: [], finishing: [] }
  }
  const finishing = finishingPaths[0]

  // Contornos de desbaste: offsets progresivos hacia adentro
  const roughing: Point2D[][] = []
  let currentInset = toolRadius

  for (;;) {
    const contours = await offsetPolygon(boundary, -currentInset, true, 'round')
    if (contours.length === 0) break
    roughing.push(...contours)
    currentInset += stepDistance
  }

  return { roughing, finishing }
}

// ============================================
// ORDENAMIENTO DE PATHS (Nearest Neighbor)
// ============================================

export function orderPaths(paths: Point2D[][]): Point2D[][] {
  if (paths.length <= 1) return paths

  const remaining = [...paths]
  const ordered: Point2D[][] = []
  let currentPos: Point2D = { x: 0, y: 0 }

  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = Infinity

    for (let i = 0; i < remaining.length; i++) {
      const start = remaining[i][0]
      if (!start) continue
      const dist = distSq(currentPos, start)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestIdx = i
      }
    }

    const path = remaining.splice(nearestIdx, 1)[0]
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
