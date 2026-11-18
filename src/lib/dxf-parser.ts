import { Path, Circle, Line, Point } from 'fabric'
import type { Point2D } from './types'

// Factor de escala DXF (generalmente mm) a Pixeles del canvas
import { OBJECT_STROKE_COLOR } from '@/lib/canvas-theme'

import { PIXELS_PER_MM } from './units'

interface DxfEntity {
  type: string
  x1?: number; y1?: number
  x2?: number; y2?: number
  centerX?: number; centerY?: number
  radius?: number
  startAngle?: number; endAngle?: number
  points?: Point2D[]
  /** Bulge por vertice (arco hacia el vertice siguiente). */
  bulges?: number[]
  closed?: boolean
  // Ellipse specific
  majorX?: number; majorY?: number  // major axis endpoint (relative)
  minorRatio?: number               // ratio minor/major
  // Spline specific
  degree?: number
  controlPoints?: Point2D[]
  knots?: number[]
  fitPoints?: Point2D[]
  // INSERT specific
  blockName?: string
  scaleX?: number; scaleY?: number
}

interface DxfBlock {
  baseX: number
  baseY: number
  entities: DxfEntity[]
}

/** $INSUNITS -> factor a milimetros. Sin unidad declarada se asume mm. */
const INSUNITS_TO_MM: Record<number, number> = {
  1: 25.4,    // pulgadas
  2: 304.8,   // pies
  4: 1,       // mm
  5: 10,      // cm
  6: 1000,    // m
  8: 0.0000254, // micropulgadas
  9: 0.0254,  // mils
  10: 914.4,  // yardas
  13: 0.001,  // micrones
  14: 100,    // dm
}

/** Lee los pares codigo/valor de una entidad ya abierta. */
function readEntityCode(ent: DxfEntity, code: number, value: string) {
  const num = parseFloat(value)
  const multiPoint = ent.type === 'LWPOLYLINE' || ent.type === 'VERTEX'

  switch (code) {
    case 10: ent.x1 = ent.centerX = num; break
    case 20: ent.y1 = ent.centerY = num; break
    case 11: ent.x2 = num; break
    case 21: ent.y2 = num; break
    case 40: ent.radius = num; break
    case 50: ent.startAngle = num; break
    case 51: ent.endAngle = num; break
    case 70: ent.closed = (parseInt(value) & 1) === 1; break
  }

  if (multiPoint) {
    if (code === 10) {
      (ent.points ??= []).push({ x: num, y: 0 });
      (ent.bulges ??= []).push(0)
    } else if (code === 20 && ent.points?.length) {
      ent.points[ent.points.length - 1].y = num
    } else if (code === 42 && ent.bulges?.length) {
      // Bulge: arco entre este vertice y el siguiente
      ent.bulges[ent.bulges.length - 1] = num
    }
  }

  if (ent.type === 'ELLIPSE') {
    if (code === 11) ent.majorX = num
    else if (code === 21) ent.majorY = num
    else if (code === 40) ent.minorRatio = num
    else if (code === 41) ent.startAngle = num // radians
    else if (code === 42) ent.endAngle = num   // radians
  }

  if (ent.type === 'SPLINE') {
    if (code === 71) ent.degree = parseInt(value)
    else if (code === 40) (ent.knots ??= []).push(num)
    else if (code === 10) (ent.controlPoints ??= []).push({ x: num, y: 0 })
    else if (code === 20 && ent.controlPoints?.length) ent.controlPoints[ent.controlPoints.length - 1].y = num
    else if (code === 11) (ent.fitPoints ??= []).push({ x: num, y: 0 })
    else if (code === 21 && ent.fitPoints?.length) ent.fitPoints[ent.fitPoints.length - 1].y = num
  }

  if (ent.type === 'INSERT') {
    if (code === 2) ent.blockName = value
    else if (code === 41) ent.scaleX = num
    else if (code === 42) ent.scaleY = num
  }
}

/** Une POLYLINE + VERTEX... + SEQEND en una sola entidad. */
function mergePolylines(entities: DxfEntity[]): DxfEntity[] {
  const merged: DxfEntity[] = []
  let polyline: DxfEntity | null = null
  const flush = () => {
    if (polyline?.points && polyline.points.length >= 2) merged.push(polyline)
    polyline = null
  }
  for (const ent of entities) {
    if (ent.type === 'POLYLINE') {
      flush()
      polyline = { type: 'POLYLINE', points: [], bulges: [], closed: ent.closed }
    } else if (ent.type === 'VERTEX' && polyline) {
      if (ent.points) {
        polyline.points!.push(...ent.points)
        polyline.bulges!.push(...(ent.bulges ?? ent.points.map(() => 0)))
      }
    } else if (ent.type === 'SEQEND') {
      flush()
    } else {
      flush()
      merged.push(ent)
    }
  }
  flush()
  return merged
}

/** Arco de un tramo con bulge, linealizado (sin incluir el punto inicial). */
function bulgeArc(p1: Point2D, p2: Point2D, bulge: number): Point2D[] {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const chord = Math.hypot(dx, dy)
  if (Math.abs(bulge) < 1e-9 || chord < 1e-9) return [p2]
  const theta = 4 * Math.atan(bulge) // angulo incluido, con signo (CCW > 0)
  const k = (1 - bulge * bulge) / (4 * bulge)
  const cx = (p1.x + p2.x) / 2 - dy * k
  const cy = (p1.y + p2.y) / 2 + dx * k
  const r = Math.hypot(p1.x - cx, p1.y - cy)
  const a0 = Math.atan2(p1.y - cy, p1.x - cx)
  const steps = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 36)))
  const out: Point2D[] = []
  for (let i = 1; i < steps; i++) {
    const a = a0 + (theta * i) / steps
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  out.push(p2)
  return out
}

/** Polilinea con sus bulges resueltos a puntos. */
function polylinePoints(ent: DxfEntity): Point2D[] {
  const pts = ent.points ?? []
  const bulges = ent.bulges ?? []
  if (pts.length === 0) return []
  const out: Point2D[] = [pts[0]]
  const last = ent.closed ? pts.length : pts.length - 1
  for (let i = 0; i < last; i++) {
    const next = pts[(i + 1) % pts.length]
    const arc = bulgeArc(pts[i], next, bulges[i] ?? 0)
    // En un lazo cerrado el ultimo punto repite el primero: lo cierra la Z
    if (ent.closed && i === last - 1) arc.pop()
    out.push(...arc)
  }
  return out
}

/** Evalua una B-spline (De Boor) y devuelve puntos sobre la curva. */
function splinePoints(ent: DxfEntity): Point2D[] {
  const ctrl = ent.controlPoints ?? []
  if (ctrl.length < 2) return ent.fitPoints ?? []
  const p = Math.max(1, Math.min(ent.degree ?? 3, ctrl.length - 1))
  const n = ctrl.length
  let knots = ent.knots ?? []
  if (knots.length !== n + p + 1) {
    // Sin nudos validos: vector uniforme anclado en los extremos
    knots = []
    for (let i = 0; i < n + p + 1; i++) {
      knots.push(i <= p ? 0 : i >= n ? n - p : i - p)
    }
  }
  const tMin = knots[p]
  const tMax = knots[n]
  if (!(tMax > tMin)) return ctrl

  const evalAt = (t: number): Point2D => {
    let k = p
    while (k < n - 1 && t >= knots[k + 1]) k++
    const d = []
    for (let j = 0; j <= p; j++) d.push({ ...ctrl[j + k - p] })
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = j + k - p
        const den = knots[i + p - r + 1] - knots[i]
        const alpha = den === 0 ? 0 : (t - knots[i]) / den
        d[j] = {
          x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
          y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
        }
      }
    }
    return d[p]
  }

  const samples = Math.max(16, (n - p) * 12)
  const out: Point2D[] = []
  for (let i = 0; i <= samples; i++) {
    out.push(evalAt(tMin + ((tMax - tMin) * i) / samples))
  }
  // Extremo exacto (evita el error de redondeo en tMax)
  if (knots.slice(n).every((kv) => kv === tMax)) out[out.length - 1] = { ...ctrl[n - 1] }
  return out
}

/** Elipse (o arco de elipse) linealizada, en coordenadas DXF (Y arriba). */
function ellipsePoints(ent: DxfEntity): { points: Point2D[]; closed: boolean } {
  const cx = ent.centerX ?? 0
  const cy = ent.centerY ?? 0
  const mx = ent.majorX ?? 1
  const my = ent.majorY ?? 0
  const ratio = ent.minorRatio ?? 1
  const start = ent.startAngle ?? 0
  let end = ent.endAngle ?? Math.PI * 2
  if (end <= start) end += Math.PI * 2
  const full = Math.abs(end - start - Math.PI * 2) < 0.01
  const steps = 72
  const points: Point2D[] = []
  for (let i = 0; i < (full ? steps : steps + 1); i++) {
    const t = start + ((end - start) * i) / steps
    // El eje menor es el mayor girado 90 grados antihorario
    points.push({
      x: cx + mx * Math.cos(t) - my * ratio * Math.sin(t),
      y: cy + my * Math.cos(t) + mx * ratio * Math.sin(t),
    })
  }
  return { points, closed: full }
}

/** Cualquier entidad como polilineas en coordenadas DXF (para bloques). */
function entityToPolylines(ent: DxfEntity): { points: Point2D[]; closed: boolean }[] {
  switch (ent.type) {
    case 'LINE':
      return [{ points: [{ x: ent.x1 ?? 0, y: ent.y1 ?? 0 }, { x: ent.x2 ?? 0, y: ent.y2 ?? 0 }], closed: false }]
    case 'CIRCLE':
    case 'ARC': {
      const cx = ent.centerX ?? 0
      const cy = ent.centerY ?? 0
      const r = ent.radius ?? 0
      const isArc = ent.type === 'ARC'
      const a0 = isArc ? ((ent.startAngle ?? 0) * Math.PI) / 180 : 0
      let a1 = isArc ? ((ent.endAngle ?? 0) * Math.PI) / 180 : Math.PI * 2
      if (isArc && a1 <= a0) a1 += Math.PI * 2
      const steps = Math.max(8, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 72))
      const points: Point2D[] = []
      for (let i = 0; i < (isArc ? steps + 1 : steps); i++) {
        const a = a0 + ((a1 - a0) * i) / steps
        points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
      }
      return [{ points, closed: !isArc }]
    }
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return [{ points: polylinePoints(ent), closed: !!ent.closed }]
    case 'ELLIPSE':
      return [ellipsePoints(ent)]
    case 'SPLINE':
      return [{ points: splinePoints(ent), closed: !!ent.closed }]
    default:
      return []
  }
}

/** Expande un INSERT a polilineas ya transformadas (escala, giro, posicion). */
function expandInsert(
  ins: DxfEntity,
  blocks: Map<string, DxfBlock>,
  depth: number,
): DxfEntity[] {
  const block = ins.blockName ? blocks.get(ins.blockName) : undefined
  if (!block || depth > 8) return []
  const sx = ins.scaleX ?? 1
  const sy = ins.scaleY ?? 1
  const rot = ((ins.startAngle ?? 0) * Math.PI) / 180
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const ox = ins.x1 ?? 0
  const oy = ins.y1 ?? 0
  const tx = (p: Point2D): Point2D => {
    const x = (p.x - block.baseX) * sx
    const y = (p.y - block.baseY) * sy
    return { x: ox + x * cos - y * sin, y: oy + x * sin + y * cos }
  }
  const out: DxfEntity[] = []
  for (const ent of block.entities) {
    const inner = ent.type === 'INSERT' ? expandInsert(ent, blocks, depth + 1) : [ent]
    for (const e of inner) {
      for (const poly of entityToPolylines(e)) {
        if (poly.points.length < 2) continue
        out.push({ type: 'POLYLINE', points: poly.points.map(tx), closed: poly.closed })
      }
    }
  }
  return out
}

function scaleEntity(ent: DxfEntity, k: number) {
  if (k === 1) return
  const sp = (pts?: Point2D[]) => pts?.forEach((p) => { p.x *= k; p.y *= k })
  for (const key of ['x1', 'y1', 'x2', 'y2', 'centerX', 'centerY', 'majorX', 'majorY'] as const) {
    if (ent[key] !== undefined) ent[key] = ent[key]! * k
  }
  // En ELLIPSE el codigo 40 es la relacion de ejes y en SPLINE son nudos
  if (ent.radius !== undefined && ent.type !== 'ELLIPSE' && ent.type !== 'SPLINE') ent.radius *= k
  sp(ent.points)
  sp(ent.controlPoints)
  sp(ent.fitPoints)
}

/** Lo que el importador no pudo traer, para avisarle al usuario. */
export interface DxfImportReport {
  /** Factor aplicado para pasar a mm (1 = ya estaba en mm o sin unidad). */
  unitScale: number
  /** Tipos de entidad ignorados y cuantas de cada uno. */
  skipped: Record<string, number>
}

export let lastDxfReport: DxfImportReport = { unitScale: 1, skipped: {} }

const SUPPORTED = new Set(['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'ELLIPSE', 'SPLINE', 'INSERT', 'POINT', 'VERTEX', 'SEQEND'])

/**
 * Parser de DXF enfocado en entidades 2D comunes para CNC. Devuelve las
 * entidades en milimetros (aplica $INSUNITS) y con los bloques (INSERT)
 * ya expandidos.
 */
export function parseDxf(content: string): DxfEntity[] {
  const lines = content.split(/\r?\n/).map(l => l.trim())
  const entities: DxfEntity[] = []
  const blocks = new Map<string, DxfBlock>()
  const skipped: Record<string, number> = {}

  let section = ''
  let expectSectionName = false
  let headerVar = ''
  let unitScale = 1
  let current: DxfEntity | null = null
  // Bloque en lectura (seccion BLOCKS)
  let blockName = ''
  let blockHeader: DxfEntity | null = null
  let blockEntities: DxfEntity[] | null = null

  const closeEntity = () => {
    if (!current) return
    if (blockHeader === current) {
      // Era la cabecera BLOCK: nombre y punto base
    } else if (blockEntities) {
      blockEntities.push(current)
    } else if (section === 'ENTITIES') {
      entities.push(current)
    }
    current = null
  }

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i])
    const value = lines[i + 1]
    if (isNaN(code)) continue

    if (code === 0) {
      closeEntity()
      if (value === 'SECTION') { expectSectionName = true; continue }
      if (value === 'ENDSEC') { section = ''; continue }
      if (value === 'EOF') break
      if (section === 'BLOCKS') {
        if (value === 'BLOCK') {
          blockHeader = current = { type: 'BLOCK' }
          blockEntities = []
          blockName = ''
          continue
        }
        if (value === 'ENDBLK') {
          if (blockEntities && blockName) {
            blocks.set(blockName, {
              baseX: blockHeader?.x1 ?? 0,
              baseY: blockHeader?.y1 ?? 0,
              entities: mergePolylines(blockEntities),
            })
          }
          blockEntities = null
          blockHeader = null
          continue
        }
      }
      if (section === 'ENTITIES' || (section === 'BLOCKS' && blockEntities)) {
        if (!SUPPORTED.has(value)) skipped[value] = (skipped[value] ?? 0) + 1
        current = { type: value }
      }
      continue
    }

    if (expectSectionName && code === 2) {
      section = value
      expectSectionName = false
      continue
    }

    if (section === 'HEADER') {
      if (code === 9) headerVar = value
      else if (headerVar === '$INSUNITS' && code === 70) {
        unitScale = INSUNITS_TO_MM[parseInt(value)] ?? 1
      }
      continue
    }

    if (!current) continue
    if (current === blockHeader) {
      if (code === 2) blockName = value
      else if (code === 10) current.x1 = parseFloat(value)
      else if (code === 20) current.y1 = parseFloat(value)
      continue
    }
    readEntityCode(current, code, value)
  }
  closeEntity()

  // Bloques expandidos y unidades a mm
  const result: DxfEntity[] = []
  for (const ent of mergePolylines(entities)) {
    if (ent.type === 'INSERT') result.push(...expandInsert(ent, blocks, 0))
    else result.push(ent)
  }
  for (const ent of result) scaleEntity(ent, unitScale)

  lastDxfReport = { unitScale, skipped }
  return result
}

/**
 * Convierte entidades DXF a objetos de Fabric.js.
 */
export function dxfToFabricObjects(entities: DxfEntity[]): any[] {
  const objects: any[] = []

  for (const ent of entities) {
    switch (ent.type) {
      case 'LINE':
        objects.push(new Line([
          (ent.x1 || 0) * PIXELS_PER_MM,
          -(ent.y1 || 0) * PIXELS_PER_MM, // DXF Y es arriba, Canvas es abajo
          (ent.x2 || 0) * PIXELS_PER_MM,
          -(ent.y2 || 0) * PIXELS_PER_MM
        ], {
          stroke: OBJECT_STROKE_COLOR,
          strokeWidth: 1
        }))
        break

      case 'CIRCLE': {
        const r = (ent.radius || 0) * PIXELS_PER_MM
        objects.push(new Circle({
          left: (ent.centerX || 0) * PIXELS_PER_MM - r,
          top: -(ent.centerY || 0) * PIXELS_PER_MM - r,
          radius: r,
          fill: 'transparent',
          stroke: OBJECT_STROKE_COLOR,
          strokeWidth: 1
        }))
        break
      }

      case 'ARC': {
        const cx = (ent.centerX || 0) * PIXELS_PER_MM
        const cy = -(ent.centerY || 0) * PIXELS_PER_MM
        const radius = (ent.radius || 0) * PIXELS_PER_MM
        const start = (ent.startAngle || 0) * (Math.PI / 180)
        const end = (ent.endAngle || 0) * (Math.PI / 180)
        
        // Aproximación simple: arco circular como Path
        // Para Fabric.js Path, usamos comandos A (Arc) o linearizamos
        // DXF angles son CCW desde el eje X positivo.
        const x1 = cx + radius * Math.cos(start)
        const y1 = cy - radius * Math.sin(start)
        const x2 = cx + radius * Math.cos(end)
        const y2 = cy - radius * Math.sin(end)
        
        const largeArc = (end - start + Math.PI * 2) % (Math.PI * 2) > Math.PI ? 1 : 0
        const pathStr = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 0 ${x2} ${y2}`
        
        objects.push(new Path(pathStr, {
          fill: 'transparent',
          stroke: OBJECT_STROKE_COLOR,
          strokeWidth: 1
        }))
        break
      }

      case 'LWPOLYLINE':
      case 'POLYLINE':
      case 'ELLIPSE':
      case 'SPLINE': {
        // Todas se linealizan en coordenadas DXF (arcos de bulge, B-spline
        // evaluada con De Boor, elipse con su eje menor bien orientado) y
        // recien al final se pasa a pixeles con la Y invertida.
        for (const poly of entityToPolylines(ent)) {
          if (poly.points.length < 2) continue
          let d = ''
          poly.points.forEach((p, i) => {
            d += `${i === 0 ? 'M' : ' L'} ${(p.x * PIXELS_PER_MM).toFixed(3)} ${(-p.y * PIXELS_PER_MM).toFixed(3)}`
          })
          if (poly.closed) d += ' Z'
          objects.push(new Path(d, { fill: 'transparent', stroke: OBJECT_STROKE_COLOR, strokeWidth: 1 }))
        }
        break
      }

      case 'POINT':
        // Skip points (not useful for CNC paths)
        break
    }
  }

  return objects
}
