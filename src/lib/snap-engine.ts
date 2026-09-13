/**
 * Snap Engine — snaps geometricos estilo CAD sobre objetos Fabric.
 *
 * Trabaja en coordenadas CANVAS (pixeles), igual que trim-extend.ts.
 * Todo lo que se expone aca es puro: no toca Fabric mas que para leer geometria.
 *
 * Uso: construir el indice una vez (entrar a modo dibujo, iniciar un drag) y
 * consultarlo en cada mouse:move. La consulta descarta por cercania antes de
 * calcular lo caro (intersecciones, perpendiculares, tangentes).
 */

import {
  Path,
  Rect,
  Circle,
  Ellipse,
  Polygon as FabricPolygon,
  Group,
  FabricObject,
  Point,
  util,
} from 'fabric'
import type { TMat2D } from 'fabric'
import type { Point2D } from '@/lib/types'
import { linearizeCubicBezier, linearizeQuadraticBezier } from '@/lib/geometry'
import { segmentIntersection, type Segment } from '@/lib/trim-extend'

// ============================================
// TIPOS
// ============================================

export type SnapKind =
  | 'endpoint'
  | 'intersection'
  | 'center'
  | 'quadrant'
  | 'midpoint'
  | 'perpendicular'
  | 'tangent'
  | 'grid'
  | 'onEdge'

/** Orden de preferencia: menor numero gana ante empate de distancia. */
const KIND_PRIORITY: Record<SnapKind, number> = {
  endpoint: 0,
  intersection: 1,
  center: 2,
  quadrant: 3,
  midpoint: 4,
  perpendicular: 5,
  tangent: 6,
  grid: 7,
  onEdge: 8,
}

export interface SnapHit {
  x: number
  y: number
  kind: SnapKind
}

export interface SnapCircle {
  cx: number
  cy: number
  r: number
}

export interface SnapIndex {
  /** Puntos fijos precalculados (extremos, centros, medios, cuadrantes). */
  points: SnapHit[]
  /** Segmentos linealizados de toda la geometria visible. */
  segments: Segment[]
  /** Circulos reales (transform conforme) para tangentes. */
  circles: SnapCircle[]
}

export type SnapKindFlags = Partial<Record<SnapKind, boolean>>

export interface SnapQueryOptions {
  /** Radio de captura en unidades canvas (px de pantalla / zoom). */
  threshold: number
  /** Que tipos de snap estan habilitados. */
  kinds: SnapKindFlags
  /** Grilla en unidades canvas. Solo se usa si kinds.grid. */
  grid?: { spacing: number; originX: number; originY: number }
  /** Punto de referencia (ultimo punto colocado) para perpendicular y tangente. */
  reference?: Point2D | null
}

export const EMPTY_SNAP_INDEX: SnapIndex = { points: [], segments: [], circles: [] }

/**
 * Contador de invalidacion: cualquier mutacion de geometria lo incrementa y el
 * consumidor reconstruye su indice. Evita que cada sitio que toca el canvas
 * tenga que conocer al consumidor.
 */
let cacheGeneration = 0

export function invalidateSnapCache(): void {
  cacheGeneration++
}

export function snapCacheGeneration(): number {
  return cacheGeneration
}

/** Tope de seguridad para SVGs gigantes: evita indices de cientos de miles de puntos. */
const MAX_POINTS = 40000
const MAX_SEGMENTS = 60000
/** Maximo de segmentos cercanos que se cruzan entre si para buscar intersecciones. */
const MAX_INTERSECTION_SEGMENTS = 40

// ============================================
// CONSTRUCCION DEL INDICE
// ============================================

export function buildSnapIndex(
  objects: FabricObject[],
  exclude?: ReadonlySet<FabricObject>,
): SnapIndex {
  const index: SnapIndex = { points: [], segments: [], circles: [] }

  for (const obj of objects) {
    if (!obj.visible) continue
    if (exclude?.has(obj)) continue
    collect(obj, null, index, exclude)
  }

  return index
}

function collect(
  obj: FabricObject,
  parentMatrix: TMat2D | null,
  out: SnapIndex,
  exclude?: ReadonlySet<FabricObject>,
): void {
  if (!obj.visible) return
  if (out.points.length > MAX_POINTS || out.segments.length > MAX_SEGMENTS) return

  // Misma convencion que useCanvasManager: dentro de un grupo se multiplica la
  // matriz del padre por la propia del hijo.
  const matrix: TMat2D = parentMatrix
    ? util.multiplyTransformMatrices(parentMatrix, obj.calcOwnMatrix())
    : obj.calcTransformMatrix()

  if (obj instanceof Group) {
    for (const child of obj.getObjects()) {
      if (exclude?.has(child)) continue
      collect(child, matrix, out, exclude)
    }
    return
  }

  if (obj instanceof Path) {
    collectPath(obj, matrix, out)
    return
  }

  if (obj instanceof Rect) {
    const w = obj.width ?? 0
    const h = obj.height ?? 0
    const corners = [
      tx(-w / 2, -h / 2, matrix),
      tx(w / 2, -h / 2, matrix),
      tx(w / 2, h / 2, matrix),
      tx(-w / 2, h / 2, matrix),
    ]
    pushPolygon(corners, out)
    out.points.push({ ...tx(0, 0, matrix), kind: 'center' })
    return
  }

  if (obj instanceof Circle) {
    const r = obj.radius ?? 0
    collectRadial(r, r, matrix, out)
    return
  }

  if (obj instanceof Ellipse) {
    collectRadial(obj.rx ?? 0, obj.ry ?? 0, matrix, out)
    return
  }

  if (obj instanceof FabricPolygon) {
    const pts = obj.points
    if (!pts || pts.length === 0) return
    const po = (obj as unknown as { pathOffset?: Point2D }).pathOffset ?? { x: 0, y: 0 }
    pushPolygon(pts.map(p => tx(p.x - po.x, p.y - po.y, matrix)), out)
    return
  }

  // Fallback (texto, imagen, raster): esquinas y medios del bounding box.
  const b = obj.getBoundingRect()
  if (b.width <= 0 && b.height <= 0) return
  const corners: Point2D[] = [
    { x: b.left, y: b.top },
    { x: b.left + b.width, y: b.top },
    { x: b.left + b.width, y: b.top + b.height },
    { x: b.left, y: b.top + b.height },
  ]
  pushPolygon(corners, out)
  out.points.push({ x: b.left + b.width / 2, y: b.top + b.height / 2, kind: 'center' })
}

/** Extremos + medios + segmentos de un contorno cerrado de pocos vertices. */
function pushPolygon(corners: Point2D[], out: SnapIndex): void {
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % corners.length]
    out.points.push({ x: a.x, y: a.y, kind: 'endpoint' })
    out.points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: 'midpoint' })
    out.segments.push({ start: a, end: b })
  }
}

/** Circulo o elipse: centro, 4 cuadrantes, poligonal para intersecciones. */
function collectRadial(rx: number, ry: number, matrix: TMat2D, out: SnapIndex): void {
  if (rx <= 0 || ry <= 0) return

  const center = tx(0, 0, matrix)
  out.points.push({ ...center, kind: 'center' })

  const quadrants = [
    tx(rx, 0, matrix),
    tx(0, ry, matrix),
    tx(-rx, 0, matrix),
    tx(0, -ry, matrix),
  ]
  for (const q of quadrants) out.points.push({ ...q, kind: 'quadrant' })

  // Tangentes solo con transform conforme (misma escala en ambos ejes, sin skew).
  const rxLen = Math.hypot(quadrants[0].x - center.x, quadrants[0].y - center.y)
  const ryLen = Math.hypot(quadrants[1].x - center.x, quadrants[1].y - center.y)
  if (rxLen > 1e-6 && Math.abs(rxLen - ryLen) / rxLen < 0.02) {
    out.circles.push({ cx: center.x, cy: center.y, r: rxLen })
  }

  const n = 72
  let prev = tx(rx, 0, matrix)
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const p = tx(rx * Math.cos(a), ry * Math.sin(a), matrix)
    out.segments.push({ start: prev, end: p })
    prev = p
  }
}

/**
 * Path: los anclas (M/L y el final de C/Q) son 'endpoint', el medio de cada
 * tramo entre anclas es 'midpoint', y las curvas se linealizan para segmentos.
 */
function collectPath(pathObj: Path, matrix: TMat2D, out: SnapIndex): void {
  const pathData = pathObj.path
  if (!pathData || !Array.isArray(pathData)) return

  const pOff = pathObj.pathOffset ?? { x: 0, y: 0 }
  const p = (px: number, py: number) => tx(px - pOff.x, py - pOff.y, matrix)

  // Poligonal continua (para segmentos) + anclas (para endpoints)
  let cursor: Point2D | null = null
  let subpathStart: Point2D | null = null
  let subpathStartAnchor: Point2D | null = null

  const addSegment = (a: Point2D, b: Point2D) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) return
    out.segments.push({ start: a, end: b })
  }
  const addAnchor = (pt: Point2D) => {
    out.points.push({ x: pt.x, y: pt.y, kind: 'endpoint' })
  }
  const addMid = (a: Point2D, b: Point2D) => {
    out.points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: 'midpoint' })
  }

  for (const cmd of pathData as unknown as (string | number)[][]) {
    const c = cmd[0]
    switch (c) {
      case 'M': {
        const pt = p(cmd[1] as number, cmd[2] as number)
        addAnchor(pt)
        cursor = pt
        subpathStart = pt
        subpathStartAnchor = pt
        break
      }
      case 'L': {
        const pt = p(cmd[1] as number, cmd[2] as number)
        if (cursor) { addSegment(cursor, pt); addMid(cursor, pt) }
        addAnchor(pt)
        cursor = pt
        break
      }
      case 'C': {
        const cp1 = p(cmd[1] as number, cmd[2] as number)
        const cp2 = p(cmd[3] as number, cmd[4] as number)
        const end = p(cmd[5] as number, cmd[6] as number)
        if (cursor) {
          const lin = linearizeCubicBezier(cursor, cp1, cp2, end, 0.5)
          for (let i = 0; i < lin.length - 1; i++) addSegment(lin[i], lin[i + 1])
          // Medio geometrico aproximado de la curva
          const midIdx = Math.floor(lin.length / 2)
          if (lin[midIdx]) out.points.push({ ...lin[midIdx], kind: 'midpoint' })
        }
        addAnchor(end)
        cursor = end
        break
      }
      case 'Q': {
        const cp = p(cmd[1] as number, cmd[2] as number)
        const end = p(cmd[3] as number, cmd[4] as number)
        if (cursor) {
          const lin = linearizeQuadraticBezier(cursor, cp, end, 0.5)
          for (let i = 0; i < lin.length - 1; i++) addSegment(lin[i], lin[i + 1])
          const midIdx = Math.floor(lin.length / 2)
          if (lin[midIdx]) out.points.push({ ...lin[midIdx], kind: 'midpoint' })
        }
        addAnchor(end)
        cursor = end
        break
      }
      case 'Z': {
        if (cursor && subpathStart) {
          addSegment(cursor, subpathStart)
          addMid(cursor, subpathStart)
        }
        cursor = subpathStartAnchor
        break
      }
    }
  }
}

function tx(x: number, y: number, matrix: TMat2D): Point2D {
  const p = util.transformPoint(new Point(x, y), matrix)
  return { x: p.x, y: p.y }
}

// ============================================
// CONSULTA
// ============================================

/**
 * Devuelve el mejor snap para el cursor, o null si no hay ninguno dentro del
 * threshold. Empata por prioridad de tipo primero, distancia despues.
 */
export function querySnap(
  index: SnapIndex,
  cursor: Point2D,
  opts: SnapQueryOptions,
): SnapHit | null {
  const { threshold, kinds } = opts
  const thrSq = threshold * threshold

  let best: SnapHit | null = null
  let bestPriority = Infinity
  let bestDistSq = Infinity

  const consider = (x: number, y: number, kind: SnapKind) => {
    if (!kinds[kind]) return
    const dSq = (x - cursor.x) ** 2 + (y - cursor.y) ** 2
    if (dSq > thrSq) return
    const prio = KIND_PRIORITY[kind]
    if (prio < bestPriority || (prio === bestPriority && dSq < bestDistSq)) {
      best = { x, y, kind }
      bestPriority = prio
      bestDistSq = dSq
    }
  }

  // ---- Puntos precalculados ----
  for (const p of index.points) consider(p.x, p.y, p.kind)

  // ---- Segmentos cercanos (base de interseccion / perpendicular / onEdge) ----
  const needSegments =
    kinds.intersection || kinds.perpendicular || kinds.onEdge
  const nearby: Segment[] = []
  if (needSegments) {
    for (const s of index.segments) {
      if (!segmentNearPoint(s, cursor, threshold)) continue
      nearby.push(s)
      if (nearby.length >= MAX_INTERSECTION_SEGMENTS) break
    }
  }

  // ---- Interseccion ----
  if (kinds.intersection) {
    for (let i = 0; i < nearby.length; i++) {
      for (let j = i + 1; j < nearby.length; j++) {
        const pt = segmentIntersection(
          nearby[i].start, nearby[i].end,
          nearby[j].start, nearby[j].end,
        )
        // Dos segmentos consecutivos del mismo contorno "se cortan" en el
        // vertice que comparten: eso es un extremo, no una interseccion.
        if (pt && !touchesEndpoint(pt, nearby[i], nearby[j])) {
          consider(pt.x, pt.y, 'intersection')
        }
      }
    }
  }

  // ---- Perpendicular desde el punto de referencia ----
  if (kinds.perpendicular && opts.reference) {
    const ref = opts.reference
    for (const s of nearby) {
      const foot = projectOnSegment(ref, s.start, s.end)
      if (foot) consider(foot.x, foot.y, 'perpendicular')
    }
  }

  // ---- Tangente desde el punto de referencia ----
  if (kinds.tangent && opts.reference) {
    const ref = opts.reference
    for (const c of index.circles) {
      const d = Math.hypot(ref.x - c.cx, ref.y - c.cy)
      if (d <= c.r + 1e-6) continue
      const base = Math.atan2(ref.y - c.cy, ref.x - c.cx)
      const alpha = Math.acos(c.r / d)
      for (const sign of [1, -1]) {
        const a = base + sign * alpha
        consider(c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a), 'tangent')
      }
    }
  }

  // ---- Grilla ----
  if (kinds.grid && opts.grid && opts.grid.spacing > 0) {
    const { spacing, originX, originY } = opts.grid
    const gx = Math.round((cursor.x - originX) / spacing) * spacing + originX
    const gy = Math.round((cursor.y - originY) / spacing) * spacing + originY
    consider(gx, gy, 'grid')
  }

  // ---- Sobre el borde (lo mas debil) ----
  if (kinds.onEdge) {
    for (const s of nearby) {
      const p = closestPointOnSegment(cursor, s.start, s.end)
      consider(p.x, p.y, 'onEdge')
    }
    for (const c of index.circles) {
      const d = Math.hypot(cursor.x - c.cx, cursor.y - c.cy)
      if (d < 1e-9) continue
      consider(
        c.cx + ((cursor.x - c.cx) / d) * c.r,
        c.cy + ((cursor.y - c.cy) / d) * c.r,
        'onEdge',
      )
    }
  }

  return best
}

/** True si el punto coincide con algun extremo de cualquiera de los segmentos. */
function touchesEndpoint(p: Point2D, a: Segment, b: Segment): boolean {
  const EPS = 1e-6
  const near = (q: Point2D) => Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS
  return near(a.start) || near(a.end) || near(b.start) || near(b.end)
}

function segmentNearPoint(s: Segment, p: Point2D, threshold: number): boolean {
  // Descarte rapido por bounding box expandido
  const minX = Math.min(s.start.x, s.end.x) - threshold
  const maxX = Math.max(s.start.x, s.end.x) + threshold
  const minY = Math.min(s.start.y, s.end.y) - threshold
  const maxY = Math.max(s.start.y, s.end.y) + threshold
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
}

export function closestPointOnSegment(p: Point2D, a: Point2D, b: Point2D): Point2D {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return { x: a.x, y: a.y }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/** Pie de la perpendicular desde p al segmento; null si cae fuera del segmento. */
function projectOnSegment(p: Point2D, a: Point2D, b: Point2D): Point2D | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return null
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  if (t < 0 || t > 1) return null
  return { x: a.x + t * dx, y: a.y + t * dy }
}

// ============================================
// ORTHO / POLAR
// ============================================

export interface AngleLockResult {
  point: Point2D
  /** Angulo del rayo en grados, 0 = +X, medido en sentido CCW en pantalla. */
  angleDeg: number
}

/**
 * Restringe el cursor al rayo mas cercano que sale de `from` en multiplos de
 * `stepDeg`. La distancia sobre el rayo es la proyeccion del cursor (igual que
 * el polar tracking de AutoCAD), asi que alejarse del eje acorta el trazo.
 */
export function applyAngleLock(from: Point2D, to: Point2D, stepDeg: number): AngleLockResult {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9 || stepDeg <= 0) {
    return { point: { x: from.x, y: from.y }, angleDeg: 0 }
  }

  const step = (stepDeg * Math.PI) / 180
  const raw = Math.atan2(dy, dx)
  const locked = Math.round(raw / step) * step

  const ux = Math.cos(locked)
  const uy = Math.sin(locked)
  const proj = Math.max(0, dx * ux + dy * uy)

  // Angulo reportado en convencion CAD: Y hacia arriba positivo
  let deg = (-locked * 180) / Math.PI
  if (deg < 0) deg += 360
  if (deg >= 360) deg -= 360

  return { point: { x: from.x + ux * proj, y: from.y + uy * proj }, angleDeg: deg }
}

/** Redondea la distancia desde `from` a multiplos de `step` manteniendo direccion. */
export function snapLengthAlongRay(from: Point2D, to: Point2D, step: number): Point2D {
  if (step <= 0) return to
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return to
  const snapped = Math.round(len / step) * step
  if (snapped <= 0) return { x: from.x, y: from.y }
  return { x: from.x + (dx / len) * snapped, y: from.y + (dy / len) * snapped }
}

/** Angulo en grados CAD (Y arriba) del vector from→to. */
export function angleDegCad(from: Point2D, to: Point2D): number {
  let deg = (-Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
  if (deg < 0) deg += 360
  if (deg >= 360) deg -= 360
  return deg
}
