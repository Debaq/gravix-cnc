/**
 * Trim & Extend — Operaciones geométricas para recortar/extender paths
 * en el canvas Fabric.js contra otros objetos.
 *
 * Trabaja en coordenadas CANVAS (píxeles), no en mm.
 */

import type { Point2D } from '@/lib/types'
import {
  Path,
  FabricObject,
  Polygon as FabricPolygon,
  Rect,
  Circle,
  Ellipse,
  Point,
  util,
} from 'fabric'
import { linearizeCubicBezier, linearizeQuadraticBezier } from '@/lib/geometry'

// ============================================
// TIPOS
// ============================================

export interface Segment {
  start: Point2D
  end: Point2D
}

interface Intersection {
  point: Point2D
  segmentIndexA: number
  /** Parámetro t ∈ [0,1] dentro del segmento A */
  tA: number
}

// ============================================
// INTERSECCIÓN DE 2 SEGMENTOS
// ============================================

/**
 * Calcula la intersección exacta entre dos segmentos de línea.
 * Retorna null si no se cruzan (o son paralelos/colineales).
 */
export function segmentIntersection(
  a1: Point2D, a2: Point2D,
  b1: Point2D, b2: Point2D,
): Point2D | null {
  const dax = a2.x - a1.x
  const day = a2.y - a1.y
  const dbx = b2.x - b1.x
  const dby = b2.y - b1.y

  const denom = dax * dby - day * dbx
  if (Math.abs(denom) < 1e-10) return null // paralelos o colineales

  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom

  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null

  return {
    x: a1.x + t * dax,
    y: a1.y + t * day,
  }
}

/**
 * Intersección de rectas infinitas (para extend). Retorna t,u y punto.
 * t es el parámetro sobre la recta A, u sobre la recta B.
 * Solo verifica que u ∈ [0,1] (el segmento barrera), t puede ser cualquier valor.
 */
function lineSegmentIntersection(
  a1: Point2D, a2: Point2D,
  b1: Point2D, b2: Point2D,
): { point: Point2D; t: number; u: number } | null {
  const dax = a2.x - a1.x
  const day = a2.y - a1.y
  const dbx = b2.x - b1.x
  const dby = b2.y - b1.y

  const denom = dax * dby - day * dbx
  if (Math.abs(denom) < 1e-10) return null

  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom

  // u debe estar en el segmento barrera [0,1]
  if (u < -1e-9 || u > 1 + 1e-9) return null

  return {
    point: { x: a1.x + t * dax, y: a1.y + t * day },
    t,
    u,
  }
}

// ============================================
// EXTRAER SEGMENTOS DE UN FABRICOBJECT
// ============================================

/**
 * Extrae segmentos de línea (en coordenadas canvas) de cualquier FabricObject.
 * Soporta Path (M/L/C/Q/Z), Rect, Circle, Ellipse, Polygon.
 */
export function extractSegments(obj: FabricObject): Segment[] {
  const segments: Segment[] = []

  if (obj instanceof Path) {
    const points = extractPathCanvasPoints(obj)
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({ start: points[i], end: points[i + 1] })
    }
    // Cerrar si el path tiene Z
    const pathData = obj.path
    if (pathData && Array.isArray(pathData) && pathData.length > 0) {
      const lastCmd = pathData[pathData.length - 1]
      if (lastCmd[0] === 'Z' && points.length > 1) {
        const last = points[points.length - 1]
        const first = points[0]
        if (dist(last, first) > 1e-6) {
          segments.push({ start: last, end: first })
        }
      }
    }
  } else if (obj instanceof Rect) {
    const w = obj.width ?? 0
    const h = obj.height ?? 0
    const matrix = obj.calcTransformMatrix()
    const corners = [
      txMatrix(-w / 2, -h / 2, matrix),
      txMatrix(w / 2, -h / 2, matrix),
      txMatrix(w / 2, h / 2, matrix),
      txMatrix(-w / 2, h / 2, matrix),
    ]
    for (let i = 0; i < corners.length; i++) {
      segments.push({ start: corners[i], end: corners[(i + 1) % corners.length] })
    }
  } else if (obj instanceof Circle) {
    const r = obj.radius ?? 0
    const matrix = obj.calcTransformMatrix()
    const n = 72
    const pts: Point2D[] = []
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      pts.push(txMatrix(r * Math.cos(a), r * Math.sin(a), matrix))
    }
    for (let i = 0; i < pts.length - 1; i++) {
      segments.push({ start: pts[i], end: pts[i + 1] })
    }
  } else if (obj instanceof Ellipse) {
    const rx = obj.rx ?? 0
    const ry = obj.ry ?? 0
    const matrix = obj.calcTransformMatrix()
    const n = 72
    const pts: Point2D[] = []
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      pts.push(txMatrix(rx * Math.cos(a), ry * Math.sin(a), matrix))
    }
    for (let i = 0; i < pts.length - 1; i++) {
      segments.push({ start: pts[i], end: pts[i + 1] })
    }
  } else if (obj instanceof FabricPolygon) {
    const polyPts = obj.points
    if (polyPts && polyPts.length > 0) {
      const po = (obj as unknown as { pathOffset: { x: number; y: number } }).pathOffset ?? { x: 0, y: 0 }
      const matrix = obj.calcTransformMatrix()
      const pts = polyPts.map(p => txMatrix(p.x - po.x, p.y - po.y, matrix))
      for (let i = 0; i < pts.length; i++) {
        segments.push({ start: pts[i], end: pts[(i + 1) % pts.length] })
      }
    }
  }

  return segments
}

// ============================================
// ENCONTRAR TODAS LAS INTERSECCIONES
// ============================================

/**
 * Encuentra todas las intersecciones entre segmentos de A con segmentos de B.
 */
export function findAllIntersections(
  segmentsA: Segment[],
  segmentsB: Segment[],
): Intersection[] {
  const results: Intersection[] = []

  for (let i = 0; i < segmentsA.length; i++) {
    const sa = segmentsA[i]
    for (let j = 0; j < segmentsB.length; j++) {
      const sb = segmentsB[j]
      const pt = segmentIntersection(sa.start, sa.end, sb.start, sb.end)
      if (pt) {
        const dx = sa.end.x - sa.start.x
        const dy = sa.end.y - sa.start.y
        const len = Math.sqrt(dx * dx + dy * dy)
        let tA = 0
        if (len > 1e-10) {
          tA = ((pt.x - sa.start.x) * dx + (pt.y - sa.start.y) * dy) / (len * len)
        }
        results.push({ point: pt, segmentIndexA: i, tA: Math.max(0, Math.min(1, tA)) })
      }
    }
  }

  return results
}

// ============================================
// TRIM
// ============================================

/**
 * Calcula la "distancia a lo largo del path" para cada punto de intersección,
 * medido como (segmentIndex + tA). Luego encuentra las dos intersecciones
 * que rodean al click point y recorta el path entre ellas.
 *
 * Retorna el nuevo pathData (array de commands), o null si no hay suficientes intersecciones.
 */
export function trimPathAtClick(
  pathObj: Path,
  clickPoint: Point2D,
  otherObjects: FabricObject[],
): unknown[][] | null {
  const pathSegments = extractSegments(pathObj)
  if (pathSegments.length === 0) return null

  // Recopilar TODAS las intersecciones con todos los otros objetos
  const allIntersections: Intersection[] = []
  for (const other of otherObjects) {
    if (other === pathObj) continue
    const otherSegs = extractSegments(other)
    const ints = findAllIntersections(pathSegments, otherSegs)
    allIntersections.push(...ints)
  }

  if (allIntersections.length === 0) return null

  // Parametrizar: posición a lo largo del path = segmentIndex + tA
  const intParams = allIntersections.map((inter, idx) => ({
    param: inter.segmentIndexA + inter.tA,
    point: inter.point,
    idx,
  }))
  intParams.sort((a, b) => a.param - b.param)

  // Encontrar param del click point (proyección sobre el segmento más cercano)
  const clickParam = projectPointOnPath(clickPoint, pathSegments)

  // Encontrar las dos intersecciones que rodean al click
  let leftIdx = -1
  let rightIdx = -1
  for (let i = 0; i < intParams.length; i++) {
    if (intParams[i].param <= clickParam) {
      leftIdx = i
    }
    if (intParams[i].param > clickParam && rightIdx === -1) {
      rightIdx = i
    }
  }

  // Si no hay intersección a la izquierda, el recorte es desde el inicio hasta la primera intersección a la derecha
  // Si no hay intersección a la derecha, el recorte es desde la última intersección izquierda hasta el final
  // Si hay ambas, recortamos la sección entre las dos intersecciones más cercanas

  const pathData = pathObj.path as unknown[][]
  if (!pathData || !Array.isArray(pathData)) return null

  const points = extractPathCanvasPoints(pathObj)
  if (points.length < 2) return null

  // Detectar si el path está cerrado
  const isClosed = pathData.length > 0 && pathData[pathData.length - 1][0] === 'Z'

  if (isClosed) {
    // Para paths cerrados: eliminar la porción entre las 2 intersecciones más cercanas
    // al click, dejando el resto como un path abierto
    if (allIntersections.length < 2) return null
    if (leftIdx === -1 || rightIdx === -1) {
      // El click está antes de la primera o después de la última intersección
      // En un path cerrado, wrap around
      if (leftIdx === -1) leftIdx = intParams.length - 1
      if (rightIdx === -1) rightIdx = 0
    }

    const leftParam = intParams[leftIdx].param
    const rightParam = intParams[rightIdx].param
    const leftPoint = intParams[leftIdx].point
    const rightPoint = intParams[rightIdx].point

    // Construir el path que EXCLUYE la sección clickeada
    return buildTrimmedPathData(points, pathSegments, leftParam, rightParam, leftPoint, rightPoint, false)
  } else {
    // Path abierto
    if (leftIdx >= 0 && rightIdx >= 0) {
      // Hay intersecciones a ambos lados: eliminar sección entre ellas
      const leftParam = intParams[leftIdx].param
      const rightParam = intParams[rightIdx].param
      const leftPoint = intParams[leftIdx].point
      const rightPoint = intParams[rightIdx].point
      return buildTrimmedPathData(points, pathSegments, leftParam, rightParam, leftPoint, rightPoint, true)
    } else if (leftIdx >= 0) {
      // Solo intersecciones a la izquierda: recortar desde leftIntersection hasta el final
      const leftParam = intParams[leftIdx].param
      const leftPoint = intParams[leftIdx].point
      return buildTruncatedPathData(points, pathSegments, leftParam, leftPoint, 'after')
    } else if (rightIdx >= 0) {
      // Solo intersecciones a la derecha: recortar desde el inicio hasta rightIntersection
      const rightParam = intParams[rightIdx].param
      const rightPoint = intParams[rightIdx].point
      return buildTruncatedPathData(points, pathSegments, rightParam, rightPoint, 'before')
    }
  }

  return null
}

// ============================================
// EXTEND
// ============================================

/**
 * Extiende un endpoint de un path hasta la intersección más cercana
 * con alguno de los otros objetos.
 *
 * @param endpointIndex 0 = extender el inicio, -1 = extender el final
 * Retorna el nuevo pathData o null si no hay intersección posible.
 */
export function extendPathToIntersection(
  pathObj: Path,
  endpointIndex: 0 | -1,
  otherObjects: FabricObject[],
): unknown[][] | null {
  const points = extractPathCanvasPoints(pathObj)
  if (points.length < 2) return null

  const pathData = pathObj.path as unknown[][]
  if (!pathData || !Array.isArray(pathData)) return null

  // Determinar la dirección de extensión
  let extendFrom: Point2D
  let extendDir: Point2D

  if (endpointIndex === 0) {
    // Extender desde el inicio: dirección = del punto 1 al punto 0
    extendFrom = points[0]
    const nextPt = points[1]
    extendDir = { x: extendFrom.x - nextPt.x, y: extendFrom.y - nextPt.y }
  } else {
    // Extender desde el final: dirección = del penúltimo al último
    extendFrom = points[points.length - 1]
    const prevPt = points[points.length - 2]
    extendDir = { x: extendFrom.x - prevPt.x, y: extendFrom.y - prevPt.y }
  }

  // Normalizar dirección
  const dirLen = Math.sqrt(extendDir.x * extendDir.x + extendDir.y * extendDir.y)
  if (dirLen < 1e-10) return null
  extendDir.x /= dirLen
  extendDir.y /= dirLen

  // Punto muy lejano en la dirección de extensión (10000px)
  const farPoint: Point2D = {
    x: extendFrom.x + extendDir.x * 10000,
    y: extendFrom.y + extendDir.y * 10000,
  }

  // Buscar la intersección más cercana con cualquier otro objeto
  let bestDist = Infinity
  let bestPoint: Point2D | null = null

  for (const other of otherObjects) {
    if (other === pathObj) continue
    const otherSegs = extractSegments(other)

    for (const seg of otherSegs) {
      const result = lineSegmentIntersection(extendFrom, farPoint, seg.start, seg.end)
      if (!result) continue

      // t debe ser positivo (en la dirección de extensión) y no demasiado cercano al origen
      if (result.t < 0.001) continue

      const d = dist(extendFrom, result.point)
      if (d < bestDist) {
        bestDist = d
        bestPoint = result.point
      }
    }
  }

  if (!bestPoint) return null

  // Construir nuevo pathData con el endpoint extendido
  const newPathData = pathData.map(cmd => [...cmd])

  if (endpointIndex === 0) {
    // Modificar el primer M command
    if (newPathData[0][0] === 'M') {
      // Transformar el punto de canvas a coordenadas locales del path
      const localPt = canvasToPathLocal(bestPoint, pathObj)
      newPathData[0][1] = localPt.x
      newPathData[0][2] = localPt.y
    }
  } else {
    // Modificar el último L o el endpoint de la última curva
    const lastCmdIdx = findLastGeometricCommand(newPathData)
    if (lastCmdIdx >= 0) {
      const cmd = newPathData[lastCmdIdx]
      const localPt = canvasToPathLocal(bestPoint, pathObj)
      if (cmd[0] === 'L') {
        cmd[1] = localPt.x
        cmd[2] = localPt.y
      } else if (cmd[0] === 'C') {
        cmd[5] = localPt.x
        cmd[6] = localPt.y
      } else if (cmd[0] === 'Q') {
        cmd[3] = localPt.x
        cmd[4] = localPt.y
      }
    }
  }

  return newPathData
}

// ============================================
// FUNCIONES AUXILIARES INTERNAS
// ============================================

/**
 * Extrae puntos del path en coordenadas canvas (aplicando transform matrix + pathOffset).
 */
function extractPathCanvasPoints(pathObj: Path): Point2D[] {
  const points: Point2D[] = []
  const pathData = pathObj.path
  if (!pathData || !Array.isArray(pathData)) return points

  const matrix = pathObj.calcTransformMatrix()
  const pOff = pathObj.pathOffset ?? new Point(0, 0)

  const txPt = (px: number, py: number): Point2D => {
    const tp = util.transformPoint(
      new Point(px - pOff.x, py - pOff.y),
      matrix,
    )
    return { x: tp.x, y: tp.y }
  }

  for (const cmd of pathData) {
    const command = cmd[0]
    switch (command) {
      case 'M':
      case 'L':
        points.push(txPt(cmd[1], cmd[2]))
        break
      case 'C': {
        const prevC = points[points.length - 1] ?? txPt(0, 0)
        const cp1 = txPt(cmd[1], cmd[2])
        const cp2 = txPt(cmd[3], cmd[4])
        const endC = txPt(cmd[5], cmd[6])
        const lin = linearizeCubicBezier(prevC, cp1, cp2, endC, 0.5)
        points.push(...lin.slice(1))
        break
      }
      case 'Q': {
        const prevQ = points[points.length - 1] ?? txPt(0, 0)
        const cpQ = txPt(cmd[1], cmd[2])
        const endQ = txPt(cmd[3], cmd[4])
        const lin = linearizeQuadraticBezier(prevQ, cpQ, endQ, 0.5)
        points.push(...lin.slice(1))
        break
      }
      case 'Z':
        break
    }
  }

  return points
}

/**
 * Transforma un punto de coordenadas canvas a coordenadas locales del path.
 */
function canvasToPathLocal(canvasPt: Point2D, pathObj: Path): Point2D {
  const matrix = pathObj.calcTransformMatrix()
  const inv = util.invertTransform(matrix)
  const pOff = pathObj.pathOffset ?? new Point(0, 0)
  const local = util.transformPoint(new Point(canvasPt.x, canvasPt.y), inv)
  return { x: local.x + pOff.x, y: local.y + pOff.y }
}

/**
 * Aplica una matriz de transformación a un punto local.
 */
function txMatrix(x: number, y: number, matrix: number[]): Point2D {
  const pt = util.transformPoint(new Point(x, y), matrix)
  return { x: pt.x, y: pt.y }
}

/**
 * Distancia entre dos puntos.
 */
function dist(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Proyecta un punto sobre la polilínea del path y retorna el parámetro
 * (segmentIndex + t) a lo largo del path.
 */
function projectPointOnPath(point: Point2D, segments: Segment[]): number {
  let bestParam = 0
  let bestDist = Infinity

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const t = projectPointOnSegment(point, seg.start, seg.end)
    const proj = {
      x: seg.start.x + t * (seg.end.x - seg.start.x),
      y: seg.start.y + t * (seg.end.y - seg.start.y),
    }
    const d = dist(point, proj)
    if (d < bestDist) {
      bestDist = d
      bestParam = i + t
    }
  }

  return bestParam
}

/**
 * Proyecta un punto sobre un segmento, retorna t ∈ [0,1].
 */
function projectPointOnSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-10) return 0
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  return Math.max(0, Math.min(1, t))
}

/**
 * Encuentra el último command geométrico (no Z) en el pathData.
 */
function findLastGeometricCommand(pathData: unknown[][]): number {
  for (let i = pathData.length - 1; i >= 0; i--) {
    if (pathData[i][0] !== 'Z') return i
  }
  return -1
}

/**
 * Dado un array de puntos canvas del path y los parámetros de corte,
 * interpola los puntos de corte y construye nuevo pathData con solo L commands.
 *
 * Para un path abierto con intersecciones a ambos lados:
 * - Retorna DOS paths separados (antes de left y después de right)
 *   como un solo pathData que los conecta... pero la convención CNC es
 *   que el trim elimina la sección clickeada.
 *
 * Simplificación: retornamos el segmento MÁS LARGO de los dos trozos resultantes.
 * En la mayoría de los casos de uso CNC, el usuario quiere eliminar el tramo corto.
 *
 * @param keepOpen Si true (path abierto), retorna las 2 porciones como paths separados.
 *                 El usuario clickeó entre leftParam y rightParam -> eliminar esa sección.
 */
function buildTrimmedPathData(
  points: Point2D[],
  segments: Segment[],
  leftParam: number,
  rightParam: number,
  leftPoint: Point2D,
  rightPoint: Point2D,
  keepOpen: boolean,
): unknown[][] | null {
  if (points.length < 2) return null

  // Obtener el path object para convertir coords canvas a locales
  // Construimos los puntos del segmento CONSERVADO (no el eliminado)

  // Para path abierto: conservar [inicio...leftPoint] y [rightPoint...final]
  // Para path cerrado: conservar [rightPoint...leftPoint] (el camino largo)

  // Subdividir puntos según params
  const leftSegIdx = Math.floor(leftParam)
  const leftT = leftParam - leftSegIdx
  const rightSegIdx = Math.floor(rightParam)
  const rightT = rightParam - rightSegIdx

  // Obtener subconjunto de puntos antes del corte izquierdo
  const beforeLeft: Point2D[] = []
  for (let i = 0; i <= leftSegIdx && i < points.length; i++) {
    beforeLeft.push(points[i])
  }
  // Interpolar el punto de corte izquierdo
  if (leftSegIdx < segments.length) {
    const seg = segments[leftSegIdx]
    const interpLeft = {
      x: seg.start.x + leftT * (seg.end.x - seg.start.x),
      y: seg.start.y + leftT * (seg.end.y - seg.start.y),
    }
    beforeLeft.push(interpLeft)
  } else {
    beforeLeft.push(leftPoint)
  }

  // Obtener subconjunto de puntos después del corte derecho
  const afterRight: Point2D[] = []
  if (rightSegIdx < segments.length) {
    const seg = segments[rightSegIdx]
    const interpRight = {
      x: seg.start.x + rightT * (seg.end.x - seg.start.x),
      y: seg.start.y + rightT * (seg.end.y - seg.start.y),
    }
    afterRight.push(interpRight)
  } else {
    afterRight.push(rightPoint)
  }
  // Puntos desde el segmento después del corte derecho hasta el final
  const startIdx = rightSegIdx + 1
  for (let i = startIdx; i < points.length; i++) {
    afterRight.push(points[i])
  }

  if (keepOpen) {
    // Path abierto: retornar la porción más larga
    const lenBefore = pathLength(beforeLeft)
    const lenAfter = pathLength(afterRight)
    const kept = lenBefore >= lenAfter ? beforeLeft : afterRight
    if (kept.length < 2) return null
    return pointsToPathData(kept)
  } else {
    // Path cerrado: conservar [rightPoint ... leftPoint] recorriendo el "otro lado"
    // Es decir: afterRight + beforeLeft
    const kept = [...afterRight, ...beforeLeft]
    if (kept.length < 2) return null
    return pointsToPathData(kept)
  }
}

/**
 * Para cuando solo hay intersecciones a un lado del click.
 * Trunca el path dejando solo la porción que NO contiene el click.
 *
 * @param direction 'before' = conservar desde el inicio hasta cutPoint
 *                  'after' = conservar desde cutPoint hasta el final
 */
function buildTruncatedPathData(
  points: Point2D[],
  segments: Segment[],
  cutParam: number,
  cutPoint: Point2D,
  direction: 'before' | 'after',
): unknown[][] | null {
  const segIdx = Math.floor(cutParam)
  const t = cutParam - segIdx

  if (direction === 'before') {
    // Conservar [inicio ... cutPoint]
    const kept: Point2D[] = []
    for (let i = 0; i <= segIdx && i < points.length; i++) {
      kept.push(points[i])
    }
    if (segIdx < segments.length) {
      const seg = segments[segIdx]
      kept.push({
        x: seg.start.x + t * (seg.end.x - seg.start.x),
        y: seg.start.y + t * (seg.end.y - seg.start.y),
      })
    } else {
      kept.push(cutPoint)
    }
    if (kept.length < 2) return null
    return pointsToPathData(kept)
  } else {
    // Conservar [cutPoint ... final]
    const kept: Point2D[] = []
    if (segIdx < segments.length) {
      const seg = segments[segIdx]
      kept.push({
        x: seg.start.x + t * (seg.end.x - seg.start.x),
        y: seg.start.y + t * (seg.end.y - seg.start.y),
      })
    } else {
      kept.push(cutPoint)
    }
    const startIdx = segIdx + 1
    for (let i = startIdx; i < points.length; i++) {
      kept.push(points[i])
    }
    if (kept.length < 2) return null
    return pointsToPathData(kept)
  }
}

/**
 * Convierte un array de puntos canvas a pathData con M + L commands
 * en coordenadas LOCALES del path (para poder asignarlo a pathObj.path).
 * Los puntos ya están en canvas coords así que necesitamos un Path temporal
 * para hacer la inversión. Usamos la convención simple: pathData centrado en
 * sus propios bounds.
 */
function pointsToPathData(points: Point2D[]): unknown[][] {
  // Generar pathData en coordenadas absolutas (canvas)
  // Fabric.js recalcula pathOffset cuando se asigna, así que usamos coords directas
  const result: unknown[][] = []
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      result.push(['M', points[i].x, points[i].y])
    } else {
      result.push(['L', points[i].x, points[i].y])
    }
  }
  return result
}

/**
 * Calcula la longitud total de una polilínea.
 */
function pathLength(points: Point2D[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += dist(points[i - 1], points[i])
  }
  return len
}
