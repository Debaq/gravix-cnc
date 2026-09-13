import { useRef, useEffect, useCallback, useState } from 'react'
import { Canvas, Point, FabricObject, ActiveSelection, Group, Rect, Circle, Path, Ellipse, Polygon as FabricPolygon, util } from 'fabric'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import {
  useCanvasManager,
  buildWorkAreaObjects,
  pushToHistory,
  PIXELS_PER_MM,
  WORK_AREA_PADDING,
  MIN_ZOOM,
  MAX_ZOOM,
  effectiveGridSpacing,
  niceStepMm,
  canvasToMm,
  mmToCanvas,
  getOriginPixels,
  NON_INTERACTIVE_KEY,
  ELEMENT_ID_KEY,
  getCustomProp,
  markViewTouched,
  isViewTouched,
} from '@/hooks/useCanvasManager'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { arcFrom3Points, sampleCatmullRom } from '@/lib/geometry'
import { applyConstraints, getConstraintIndicators } from '@/lib/constraints'
import {
  extractNodes,
  moveNode,
  finalizeNodeMove,
  addNodeOnSegment,
  deleteNode,
  hitTestNode,
  hitTestSegment,
  toggleNodeSmooth,
  splitPathAtNode,
  togglePathClosed,
  filletNode,
  chamferNode,
  dogboneNode,
  symmetricNode,
  breakNode,
  type NodeEditData,
} from '@/lib/node-editor'
import {
  trimPathAtClick,
  extendPathToIntersection,
} from '@/lib/trim-extend'
import {
  buildSnapIndex,
  querySnap,
  applyAngleLock,
  snapLengthAlongRay,
  angleDegCad,
  EMPTY_SNAP_INDEX,
  invalidateSnapCache,
  snapCacheGeneration,
  type SnapIndex,
  type SnapHit,
  type SnapKind,
  type SnapKindFlags,
} from '@/lib/snap-engine'
import type { Point2D } from '@/lib/types'

// ============================================
// Node editing — module-level state
// ============================================
let nodeEditData: NodeEditData | null = null
let nodeEditObject: FabricObject | null = null
let nodeDragging = false
let nodeDragIndex = -1
let nodeDragStartPos: { x: number; y: number } | null = null
let nodeHoverIndex = -1
let segmentHoverAnchorIdx = -1

// Measuring mode state
let measureStart: Point | null = null
let measureEnd: Point | null = null
let measureMid: Point | null = null  // vertex for angle measurement
let measureAnglePoints: Point[] = [] // 0=start, 1=vertex, 2=end

// ============================================
// Snap system — lightweight, no Fabric objects for guides
// ============================================

interface SnapEdges {
  left: number; right: number; top: number; bottom: number; centerX: number; centerY: number
}

// Cached bounds of other objects, built once on drag start
let cachedOtherBounds: SnapEdges[] = []

interface SnapGuides {
  h: { y: number; x1: number; x2: number }[]
  v: { x: number; y1: number; y2: number }[]
  dots: { x: number; y: number }[]
}

let activeGuides: SnapGuides = { h: [], v: [], dots: [] }

// ============================================
// Snap geometrico (CAD) — indice + resultado activo
// ============================================

/** Radio de captura en pixeles de PANTALLA (se divide por el zoom al usarlo). */
const SNAP_CAPTURE_PX = 12

let snapIndex: SnapIndex = EMPTY_SNAP_INDEX
let snapIndexGeneration = -1
let snapIndexExcluded: FabricObject | null = null

/** Snap mostrado bajo el cursor (marcador + etiqueta en after:render). */
let activeSnap: SnapHit | null = null
/** Rayo de ortho/polar activo, dibujado como guia punteada. */
let orthoRay: { from: Point2D; to: Point2D } | null = null
/** HUD de longitud/angulo que sigue al cursor mientras se dibuja. */
let cursorHud: { x: number; y: number; lengthMm: number; angleDeg: number } | null = null

/** Ultima posicion del cursor en pixeles de pantalla, para las reglas. */
let rulerCursor: { x: number; y: number } | null = null

/** Guia que se esta arrastrando (nueva desde la regla, o una existente). */
let draggingGuide: { id: string; axis: 'x' | 'y'; isNew: boolean } | null = null
/** Guia bajo el cursor, para resaltarla. */
let hoveredGuideId: string | null = null

/** Guias en coordenadas canvas, como las espera el motor de snap. */
function guidesInCanvasCoords(): { x: number[]; y: number[] } {
  const st = useCanvasStore.getState()
  if (!st.showGuides) return { x: [], y: [] }
  const x: number[] = []
  const y: number[] = []
  for (const g of st.guides) {
    const pt = mmToCanvas(
      g.axis === 'x' ? g.mm : 0,
      g.axis === 'y' ? g.mm : 0,
      st.workArea,
    )
    if (g.axis === 'x') x.push(pt.x)
    else y.push(pt.y)
  }
  return { x, y }
}

function invalidateSnapIndex(): void {
  invalidateSnapCache()
}

function clearSnapFeedback(): void {
  activeSnap = null
  orthoRay = null
  cursorHud = null
}

function ensureSnapIndex(canvas: Canvas, exclude: FabricObject | null): SnapIndex {
  const gen = snapCacheGeneration()
  if (gen === snapIndexGeneration && snapIndexExcluded === exclude) return snapIndex
  const objects = canvas.getObjects().filter(
    o => getCustomProp(o, NON_INTERACTIVE_KEY) !== true && o !== exclude,
  )
  snapIndex = buildSnapIndex(objects)
  snapIndexGeneration = gen
  snapIndexExcluded = exclude
  return snapIndex
}

function gridSpacingPx(zoom: number): number {
  return effectiveGridSpacing(zoom).spacingMm * PIXELS_PER_MM
}

function enabledSnapKinds(): SnapKindFlags {
  const st = useCanvasStore.getState()
  const kinds: SnapKindFlags = { grid: st.snapToGrid }
  if (st.snapGeometry) {
    for (const [kind, on] of Object.entries(st.snapKinds)) {
      kinds[kind as SnapKind] = on
    }
  }
  return kinds
}

export interface SnappedPoint {
  point: Point2D
  snap: SnapHit | null
  /** Angulo CAD del tramo desde la referencia, si hay referencia. */
  angleDeg: number | null
  orthoActive: boolean
}

/**
 * Convierte el cursor crudo en un punto util: aplica ortho/polar (si esta
 * activo o si se aprieta Shift) y luego el snap geometrico/grilla.
 * Deja listo el feedback visual (marcador, rayo, HUD).
 */
function resolveSnappedPoint(
  canvas: Canvas,
  raw: Point2D,
  reference: Point2D | null,
  shiftKey: boolean,
  exclude: FabricObject | null = null,
): SnappedPoint {
  const st = useCanvasStore.getState()
  const zoom = canvas.getZoom() || 1
  const threshold = SNAP_CAPTURE_PX / zoom

  // Shift invierte el estado de ortho (igual que F8 + Shift en CAD clasico)
  const orthoActive = (st.orthoMode !== shiftKey) && !!reference

  let candidate = raw
  let rayDir: Point2D | null = null
  if (orthoActive && reference) {
    const locked = applyAngleLock(reference, raw, st.orthoAngleDeg || 45)
    candidate = locked.point
    const rad = (-locked.angleDeg * Math.PI) / 180
    rayDir = { x: Math.cos(rad), y: Math.sin(rad) }
    // Sobre el rayo, redondear la longitud a la grilla si esta activa
    if (st.snapToGrid) {
      const stepped = snapLengthAlongRay(reference, candidate, gridSpacingPx(zoom))
      if (Math.hypot(stepped.x - candidate.x, stepped.y - candidate.y) <= threshold) {
        candidate = stepped
      }
    }
    orthoRay = { from: reference, to: candidate }
  } else {
    orthoRay = null
  }

  const kinds = enabledSnapKinds()
  // Con ortho la grilla ya se aplico a lo largo del rayo: dejarla aca la sacaria del eje
  if (orthoActive) kinds.grid = false

  const index = (st.snapGeometry || (st.snapToGrid && !orthoActive))
    ? ensureSnapIndex(canvas, exclude)
    : EMPTY_SNAP_INDEX

  const guides = guidesInCanvasCoords()
  kinds.guide = st.showGuides && (guides.x.length > 0 || guides.y.length > 0)

  let hit = querySnap(index, candidate, {
    threshold,
    kinds,
    grid: st.snapToGrid && !orthoActive
      ? { spacing: gridSpacingPx(zoom), originX: WORK_AREA_PADDING, originY: WORK_AREA_PADDING }
      : undefined,
    guides,
    reference,
  })

  let point = hit ? { x: hit.x, y: hit.y } : candidate

  // Con ortho el punto NO puede salirse del rayo: el snap solo fija la
  // distancia sobre el, y solo si cae lo bastante cerca del eje.
  if (orthoActive && reference && rayDir && hit) {
    const along = (hit.x - reference.x) * rayDir.x + (hit.y - reference.y) * rayDir.y
    const projected = {
      x: reference.x + rayDir.x * along,
      y: reference.y + rayDir.y * along,
    }
    const perp = Math.hypot(hit.x - projected.x, hit.y - projected.y)
    if (along >= 0 && perp <= threshold) {
      point = projected
      hit = { ...hit, x: projected.x, y: projected.y }
    } else {
      point = candidate
      hit = null
    }
  }

  activeSnap = hit
  if (orthoRay) orthoRay = { from: orthoRay.from, to: point }

  const angleDeg = reference ? angleDegCad(reference, point) : null
  cursorHud = reference
    ? {
        x: point.x,
        y: point.y,
        lengthMm: Math.hypot(point.x - reference.x, point.y - reference.y) / PIXELS_PER_MM,
        angleDeg: angleDeg ?? 0,
      }
    : null

  return { point, snap: hit, angleDeg, orthoActive }
}

function cacheOtherBounds(canvas: Canvas, movingObj: FabricObject): void {
  cachedOtherBounds = canvas.getObjects()
    .filter(o =>
      (o as unknown as Record<string, unknown>)[NON_INTERACTIVE_KEY] !== true &&
      o !== movingObj &&
      o.visible
    )
    .map(o => {
      const b = o.getBoundingRect()
      return {
        left: b.left, top: b.top,
        right: b.left + b.width, bottom: b.top + b.height,
        centerX: b.left + b.width / 2, centerY: b.top + b.height / 2,
      }
    })
}

function calculateSnap(
  zoom: number,
  movingObj: FabricObject,
  snapToGrid: boolean,
  snapToObjects: boolean,
  gridSpacingPx: number,
  workArea: { width: number; height: number; origin: string },
): { dx: number; dy: number } {
  const threshold = 10 / zoom

  // Bounding rect for all snaps
  const bounds = movingObj.getBoundingRect()
  const bL = bounds.left, bT = bounds.top
  const bR = bL + bounds.width, bB = bT + bounds.height
  const bCX = bL + bounds.width / 2, bCY = bT + bounds.height / 2

  let bestDx = Infinity
  let bestDy = Infinity
  const guidesH: SnapGuides['h'] = []
  const guidesV: SnapGuides['v'] = []
  const dots: SnapGuides['dots'] = []

  // Track the reference point that snapped for the dot
  let dotRefX = bL, dotRefY = bT

  const tryX = (val: number, target: number, refX: number, yMin?: number, yMax?: number) => {
    const d = target - val
    if (Math.abs(d) > threshold) return
    if (Math.abs(d) < Math.abs(bestDx)) {
      bestDx = d; guidesV.length = 0; dotRefX = refX
    }
    if (Math.abs(d) === Math.abs(bestDx) && yMin !== undefined && yMax !== undefined) {
      guidesV.push({ x: target, y1: yMin, y2: yMax })
    }
  }

  const tryY = (val: number, target: number, refY: number, xMin?: number, xMax?: number) => {
    const d = target - val
    if (Math.abs(d) > threshold) return
    if (Math.abs(d) < Math.abs(bestDy)) {
      bestDy = d; guidesH.length = 0; dotRefY = refY
    }
    if (Math.abs(d) === Math.abs(bestDy) && xMin !== undefined && xMax !== undefined) {
      guidesH.push({ y: target, x1: xMin, x2: xMax })
    }
  }

  const waL = WORK_AREA_PADDING
  const waT = WORK_AREA_PADDING
  const waR = WORK_AREA_PADDING + workArea.width * PIXELS_PER_MM
  const waB = WORK_AREA_PADDING + workArea.height * PIXELS_PER_MM
  const waCX = (waL + waR) / 2
  const waCY = (waT + waB) / 2
  const vExt = { min: Math.min(bT, waT) - 10, max: Math.max(bB, waB) + 10 }
  const hExt = { min: Math.min(bL, waL) - 10, max: Math.max(bR, waR) + 10 }

  // Snap bounding edges to work area
  tryX(bL, waL, bL, vExt.min, vExt.max); tryX(bR, waR, bR, vExt.min, vExt.max); tryX(bCX, waCX, bCX, vExt.min, vExt.max)
  tryY(bT, waT, bT, hExt.min, hExt.max); tryY(bB, waB, bB, hExt.min, hExt.max); tryY(bCY, waCY, bCY, hExt.min, hExt.max)

  // Grid — snap the reference corner (based on configured origin) to grid intersections
  // Uses a wider threshold than object snap and shows crosshair guides
  if (snapToGrid) {
    const gridThreshold = threshold * 1.8 // wider capture zone for grid
    const origin = workArea.origin || 'bottom-left'

    // Reference point based on configured CNC origin
    let refX: number
    if (origin.endsWith('right')) refX = bR
    else if (origin.endsWith('center') || origin === 'center') refX = bCX
    else refX = bL

    let refY: number
    if (origin.startsWith('bottom')) refY = bB
    else if (origin.startsWith('center') || origin === 'center') refY = bCY
    else refY = bT

    const nearX = Math.round((refX - waL) / gridSpacingPx) * gridSpacingPx + waL
    const nearY = Math.round((refY - waT) / gridSpacingPx) * gridSpacingPx + waT
    const gx = nearX - refX
    const gy = nearY - refY

    if (Math.abs(gx) <= gridThreshold && Math.abs(gx) < Math.abs(bestDx)) {
      bestDx = gx
      dotRefX = refX
      // Vertical crosshair line at the grid X position
      guidesV.push({ x: nearX, y1: waT, y2: waB })
    }
    if (Math.abs(gy) <= gridThreshold && Math.abs(gy) < Math.abs(bestDy)) {
      bestDy = gy
      dotRefY = refY
      // Horizontal crosshair line at the grid Y position
      guidesH.push({ y: nearY, x1: waL, x2: waR })
    }
  }

  // Snap de los bordes del bounding box a las guias de usuario
  {
    const guides = guidesInCanvasCoords()
    for (const gx of guides.x) {
      tryX(bL, gx, bL, vExt.min, vExt.max)
      tryX(bR, gx, bR, vExt.min, vExt.max)
      tryX(bCX, gx, bCX, vExt.min, vExt.max)
    }
    for (const gy of guides.y) {
      tryY(bT, gy, bT, hExt.min, hExt.max)
      tryY(bB, gy, bB, hExt.min, hExt.max)
      tryY(bCY, gy, bCY, hExt.min, hExt.max)
    }
  }

  // Snap bounding edges to other objects
  if (snapToObjects) {
    for (const o of cachedOtherBounds) {
      const vE = { min: Math.min(bT, o.top) - 10, max: Math.max(bB, o.bottom) + 10 }
      const hE = { min: Math.min(bL, o.left) - 10, max: Math.max(bR, o.right) + 10 }

      tryX(bL, o.left, bL, vE.min, vE.max); tryX(bL, o.right, bL, vE.min, vE.max)
      tryX(bR, o.left, bR, vE.min, vE.max); tryX(bR, o.right, bR, vE.min, vE.max)
      tryX(bCX, o.centerX, bCX, vE.min, vE.max)

      tryY(bT, o.top, bT, hE.min, hE.max); tryY(bT, o.bottom, bT, hE.min, hE.max)
      tryY(bB, o.top, bB, hE.min, hE.max); tryY(bB, o.bottom, bB, hE.min, hE.max)
      tryY(bCY, o.centerY, bCY, hE.min, hE.max)
    }
  }

  const dx = Math.abs(bestDx) <= threshold ? bestDx : 0
  const dy = Math.abs(bestDy) <= threshold ? bestDy : 0

  if (dx !== 0 || dy !== 0) {
    // Dot at the reference point that snapped
    dots.push({ x: dotRefX + dx, y: dotRefY + dy })
    activeGuides = { h: guidesH, v: guidesV, dots }
  } else {
    activeGuides = { h: [], v: [], dots: [] }
  }
  return { dx, dy }
}

// ============================================
// Drawing mode — module-level state (like snap system)
// ============================================
let drawingPoints: { x: number; y: number }[] = []
let drawingMousePos: { x: number; y: number } | null = null
let drawingNearStart = false // true when mouse is close to first point (snap-to-close)
// Arc drawing: collects exactly 3 points
let arcPoints: { x: number; y: number }[] = []
// Formas por arrastre (rect / circulo / elipse): esquina inicial y actual
let shiftHeld = false
let dragShapeStart: { x: number; y: number } | null = null
let dragShapeCurrent: { x: number; y: number } | null = null

/** Caja normalizada del arrastre; con `square` fuerza proporcion 1:1. */
function dragShapeBox(square: boolean): { left: number; top: number; width: number; height: number } | null {
  if (!dragShapeStart || !dragShapeCurrent) return null
  let dx = dragShapeCurrent.x - dragShapeStart.x
  let dy = dragShapeCurrent.y - dragShapeStart.y
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * side
    dy = Math.sign(dy || 1) * side
  }
  return {
    left: Math.min(dragShapeStart.x, dragShapeStart.x + dx),
    top: Math.min(dragShapeStart.y, dragShapeStart.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  }
}

function distancePxBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

// ============================================
// Dimension annotations (cotas) — shown when object is selected
// ============================================
interface CotaData {
  // Segment endpoints in canvas coords
  ax: number; ay: number
  bx: number; by: number
  // Perpendicular direction (outward from object)
  nx: number; ny: number
  // Value in mm
  valueMm: number
  // Label position (midpoint, offset perpendicular)
  labelX: number; labelY: number
  // Text rotation (aligned with segment)
  angle: number
  // Edit info
  editType: 'polyline-segment' | 'width' | 'height' | 'diameter'
  editIndex: number
  elementId: string
}

let activeCotas: CotaData[] = []
let hoveredCotaIndex = -1

function makeCota(
  ax: number, ay: number, bx: number, by: number,
  nx: number, ny: number, valueMm: number, cotaOffset: number,
  editType: CotaData['editType'], editIndex: number, elementId: string,
): CotaData | null {
  const dx = bx - ax, dy = by - ay
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return null
  let angle = Math.atan2(dy, dx)
  if (angle > Math.PI / 2) angle -= Math.PI
  if (angle < -Math.PI / 2) angle += Math.PI
  return {
    ax, ay, bx, by, nx, ny, valueMm,
    labelX: (ax + bx) / 2 + nx * cotaOffset,
    labelY: (ay + by) / 2 + ny * cotaOffset,
    angle, editType, editIndex, elementId,
  }
}

function computeCotas(canvas: Canvas): CotaData[] {
  const active = canvas.getActiveObject()
  if (!active || active instanceof ActiveSelection) return []

  const elId = getCustomProp(active, ELEMENT_ID_KEY) as string | undefined
  if (!elId) return []

  const element = useCanvasStore.getState().findElementById(elId)
  if (!element) return []

  const cotas: CotaData[] = []
  const zoom = canvas.getZoom()
  const cotaOffset = 14 / zoom

  if (element.makerType === 'polyline') {
    // Read actual path geometry from Fabric — guaranteed to match rendered position
    const pathObj = active as Path
    const pathData = pathObj.path
    if (!pathData || !Array.isArray(pathData)) return []

    const matrix = pathObj.calcTransformMatrix()
    const pOff = pathObj.pathOffset ?? { x: 0, y: 0 }

    const canvasPts: { x: number; y: number }[] = []
    for (const cmd of pathData) {
      if ((cmd[0] === 'M' || cmd[0] === 'L') && typeof cmd[1] === 'number') {
        const tp = util.transformPoint(
          new Point(cmd[1] - pOff.x, cmd[2] - pOff.y),
          matrix,
        )
        canvasPts.push({ x: tp.x, y: tp.y })
      }
    }
    if (canvasPts.length < 2) return []

    const isClosed = Number(element.makerParams?.closed ?? 0)
    const segCount = isClosed ? canvasPts.length : canvasPts.length - 1

    for (let i = 0; i < segCount; i++) {
      const a = canvasPts[i]
      const b = canvasPts[(i + 1) % canvasPts.length]
      const dx = b.x - a.x, dy = b.y - a.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 1) continue
      // Left perpendicular (consistent outward for CW winding)
      const nx = -dy / len, ny = dx / len
      const c = makeCota(a.x, a.y, b.x, b.y, nx, ny, len / PIXELS_PER_MM, cotaOffset,
        'polyline-segment', i, elId)
      if (c) cotas.push(c)
    }
  } else if (active instanceof Rect) {
    // getCoords() returns actual corners in canvas space: [tl, tr, br, bl]
    const coords = active.getCoords()
    const tl = coords[0], tr = coords[1], br = coords[2], bl = coords[3]
    const wMm = (active.width ?? 0) * (active.scaleX ?? 1) / PIXELS_PER_MM
    const hMm = (active.height ?? 0) * (active.scaleY ?? 1) / PIXELS_PER_MM

    // Width cota — bottom edge (bl → br), perpendicular outward = down
    {
      const dx = br.x - bl.x, dy = br.y - bl.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        const nx = -dy / len, ny = dx / len // left perp of left→right = down
        const c = makeCota(bl.x, bl.y, br.x, br.y, nx, ny, wMm, cotaOffset,
          'width', 0, elId)
        if (c) cotas.push(c)
      }
    }

    // Height cota — right edge (tr → br), perpendicular outward = right
    {
      const dx = br.x - tr.x, dy = br.y - tr.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        const nx = dy / len, ny = -dx / len // right perp of top→bottom = right
        const c = makeCota(tr.x, tr.y, br.x, br.y, nx, ny, hMm, cotaOffset,
          'height', 0, elId)
        if (c) cotas.push(c)
      }
    }
  } else if (active instanceof Circle) {
    const center = active.getCenterPoint()
    const r = (active.radius ?? 0) * (active.scaleX ?? 1)
    const dMm = (r * 2) / PIXELS_PER_MM

    const c = makeCota(center.x - r, center.y, center.x + r, center.y, 0, -1, dMm, cotaOffset,
      'diameter', 0, elId)
    if (c) cotas.push(c)
  } else if (element.makerType === 'text' || element.makerType === 'arc') {
    // Width/height cotas for text paths and arcs (same as Rect, using bounding corners)
    const coords = active.getCoords()
    const tl = coords[0], tr = coords[1], br = coords[2], bl = coords[3]
    const bounds = active.getBoundingRect()
    const wMm = bounds.width / PIXELS_PER_MM
    const hMm = bounds.height / PIXELS_PER_MM

    // Width — bottom edge
    {
      const dx = br.x - bl.x, dy = br.y - bl.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        const nx = -dy / len, ny = dx / len
        const c = makeCota(bl.x, bl.y, br.x, br.y, nx, ny, wMm, cotaOffset, 'width', 0, elId)
        if (c) cotas.push(c)
      }
    }
    // Height — right edge
    {
      const dx = br.x - tr.x, dy = br.y - tr.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        const nx = dy / len, ny = -dx / len
        const c = makeCota(tr.x, tr.y, br.x, br.y, nx, ny, hMm, cotaOffset, 'height', 0, elId)
        if (c) cotas.push(c)
      }
    }
  }

  return cotas
}

// Exit node editing mode and restore object interactivity
function exitNodeEditing(canvas: Canvas): void {
  if (nodeEditObject) {
    nodeEditObject.selectable = true
    nodeEditObject.evented = true
    nodeEditObject.objectCaching = true
    nodeEditObject.dirty = true
  }
  nodeEditData = null
  nodeEditObject = null
  nodeDragging = false
  nodeDragIndex = -1
  nodeHoverIndex = -1
  segmentHoverAnchorIdx = -1
  canvas.selection = true
  canvas.upperCanvasEl.style.cursor = ''
  useCanvasStore.getState().setNodeEditing(null)
  canvas.requestRenderAll()
}

const RULER_SIZE = 18

/**
 * Encuadra el area de trabajo en el lienzo: calcula el zoom que la hace entrar
 * y la centra. Devuelve false si el contenedor todavia no tiene tamaño — pasa
 * cuando la ventana arranca oculta, y encuadrar contra 0 deja la matriz en
 * cero: no se ve nada y toda la matematica de puntero da NaN.
 */
function fitWorkAreaToCanvas(
  canvas: Canvas,
  workArea: { width: number; height: number },
): boolean {
  const cw = canvas.getWidth()
  const ch = canvas.getHeight()
  if (cw <= 0 || ch <= 0) return false

  // Las reglas se dibujan encima del lienzo, sobre el borde superior y el
  // izquierdo: centrar contra el lienzo entero deja el dibujo corrido y con la
  // esquina tapada
  const inset = useCanvasStore.getState().showRulers ? RULER_SIZE : 0
  const availW = cw - inset
  const availH = ch - inset
  if (availW <= 0 || availH <= 0) return false

  const workW = workArea.width * PIXELS_PER_MM + WORK_AREA_PADDING * 2
  const workH = workArea.height * PIXELS_PER_MM + WORK_AREA_PADDING * 2
  const zoom = Math.min(availW / workW, availH / workH) * 0.95
  if (!Number.isFinite(zoom) || zoom <= 0) return false

  canvas.setViewportTransform([
    zoom,
    0,
    0,
    zoom,
    inset + (availW - workW * zoom) / 2,
    inset + (availH - workH * zoom) / 2,
  ])
  canvas.requestRenderAll()
  return true
}

/**
 * Reglas en mm sobre los bordes del lienzo. Se dibujan en coordenadas de
 * PANTALLA (sin la transform del viewport) para que no escalen con el zoom.
 */
function drawRulers(
  ctx: CanvasRenderingContext2D,
  canvas: Canvas,
  workArea: { width: number; height: number; origin: string },
): void {
  const vpt = canvas.viewportTransform
  if (!vpt) return
  const zoom = canvas.getZoom() || 1
  const w = canvas.getWidth()
  const h = canvas.getHeight()

  const { spacingMm } = effectiveGridSpacing(zoom)
  // Las etiquetas necesitan mucho mas aire que las marcas: se eligen aparte
  const labelStep = Math.max(spacingMm, niceStepMm(zoom, 64))
  const originPos = getOriginPixels(
    workArea.origin,
    workArea.width * PIXELS_PER_MM,
    workArea.height * PIXELS_PER_MM,
    WORK_AREA_PADDING,
    WORK_AREA_PADDING,
  )
  const flipY = workArea.origin.startsWith('bottom')

  const screenX = (mm: number) => (originPos.x + mm * PIXELS_PER_MM) * zoom + vpt[4]
  const screenY = (mm: number) =>
    (flipY ? originPos.y - mm * PIXELS_PER_MM : originPos.y + mm * PIXELS_PER_MM) * zoom + vpt[5]

  // Rango visible en mm
  const mmAtX = (px: number) => ((px - vpt[4]) / zoom - originPos.x) / PIXELS_PER_MM
  const mmAtY = (px: number) => {
    const cy = (px - vpt[5]) / zoom
    return flipY ? (originPos.y - cy) / PIXELS_PER_MM : (cy - originPos.y) / PIXELS_PER_MM
  }

  ctx.save()
  ctx.setLineDash([])
  ctx.font = '9px Inter, sans-serif'
  ctx.textBaseline = 'middle'

  // Franjas de fondo
  ctx.fillStyle = 'rgba(248,247,252,0.97)'
  ctx.fillRect(0, 0, w, RULER_SIZE)
  ctx.fillRect(0, 0, RULER_SIZE, h)
  ctx.strokeStyle = '#D6D1E6'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, RULER_SIZE + 0.5); ctx.lineTo(w, RULER_SIZE + 0.5)
  ctx.moveTo(RULER_SIZE + 0.5, 0); ctx.lineTo(RULER_SIZE + 0.5, h)
  ctx.stroke()

  const decimals = labelStep < 1 ? 2 : labelStep < 10 ? 1 : 0

  // ---- Regla horizontal ----
  {
    const from = Math.floor(mmAtX(RULER_SIZE) / spacingMm) * spacingMm
    const to = Math.ceil(mmAtX(w) / spacingMm) * spacingMm
    const steps = Math.min(4000, Math.max(0, Math.round((to - from) / spacingMm)))
    ctx.strokeStyle = '#9B93B5'
    ctx.fillStyle = '#5C5470'
    ctx.textAlign = 'left'
    for (let i = 0; i <= steps; i++) {
      const mm = from + i * spacingMm
      const x = screenX(mm)
      if (x < RULER_SIZE || x > w) continue
      const isMajor = Math.abs(mm / labelStep - Math.round(mm / labelStep)) < 1e-6
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, isMajor ? 3 : RULER_SIZE - 5)
      ctx.lineTo(Math.round(x) + 0.5, RULER_SIZE)
      ctx.stroke()
      if (isMajor) ctx.fillText(mm.toFixed(decimals), x + 2, 7)
    }
  }

  // ---- Regla vertical ----
  {
    const yTop = mmAtY(RULER_SIZE)
    const yBottom = mmAtY(h)
    const lo = Math.min(yTop, yBottom)
    const hi = Math.max(yTop, yBottom)
    const from = Math.floor(lo / spacingMm) * spacingMm
    const steps = Math.min(4000, Math.max(0, Math.round((hi - from) / spacingMm)))
    ctx.strokeStyle = '#9B93B5'
    ctx.fillStyle = '#5C5470'
    ctx.textAlign = 'center'
    for (let i = 0; i <= steps; i++) {
      const mm = from + i * spacingMm
      const y = screenY(mm)
      if (y < RULER_SIZE || y > h) continue
      const isMajor = Math.abs(mm / labelStep - Math.round(mm / labelStep)) < 1e-6
      ctx.beginPath()
      ctx.moveTo(isMajor ? 3 : RULER_SIZE - 5, Math.round(y) + 0.5)
      ctx.lineTo(RULER_SIZE, Math.round(y) + 0.5)
      ctx.stroke()
      if (isMajor) {
        ctx.save()
        ctx.translate(8, y)
        ctx.rotate(-Math.PI / 2)
        ctx.fillText(mm.toFixed(decimals), 0, 0)
        ctx.restore()
      }
    }
  }

  // ---- Marcador del cursor ----
  if (rulerCursor) {
    ctx.strokeStyle = '#EF4444'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(Math.round(rulerCursor.x) + 0.5, 0)
    ctx.lineTo(Math.round(rulerCursor.x) + 0.5, RULER_SIZE)
    ctx.moveTo(0, Math.round(rulerCursor.y) + 0.5)
    ctx.lineTo(RULER_SIZE, Math.round(rulerCursor.y) + 0.5)
    ctx.stroke()
  }

  // Esquina
  ctx.fillStyle = 'rgba(248,247,252,0.97)'
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE)
  ctx.strokeStyle = '#D6D1E6'
  ctx.strokeRect(0.5, 0.5, RULER_SIZE, RULER_SIZE)
  ctx.fillStyle = '#8B84A3'
  ctx.textAlign = 'center'
  ctx.fillText('mm', RULER_SIZE / 2, RULER_SIZE / 2)

  ctx.restore()
}

/**
 * Marcador del snap activo. Cada tipo tiene su glifo, como en cualquier CAD:
 * cuadrado = extremo, triangulo = medio, circulo = centro, rombo = cuadrante,
 * X = interseccion, y asi.
 */
function drawSnapMarker(
  ctx: CanvasRenderingContext2D,
  hit: SnapHit,
  z: number,
  label: string,
): void {
  const r = 6 / z
  ctx.save()
  ctx.translate(hit.x, hit.y)
  ctx.strokeStyle = '#10B981'
  ctx.fillStyle = 'rgba(16,185,129,0.18)'
  ctx.lineWidth = 1.6 / z
  ctx.setLineDash([])

  switch (hit.kind) {
    case 'endpoint':
      ctx.beginPath(); ctx.rect(-r, -r, r * 2, r * 2); ctx.fill(); ctx.stroke()
      break
    case 'midpoint':
      ctx.beginPath()
      ctx.moveTo(0, -r); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath()
      ctx.fill(); ctx.stroke()
      break
    case 'center':
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      break
    case 'quadrant':
      ctx.beginPath()
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      break
    case 'intersection':
      ctx.beginPath()
      ctx.moveTo(-r, -r); ctx.lineTo(r, r)
      ctx.moveTo(r, -r); ctx.lineTo(-r, r)
      ctx.stroke()
      break
    case 'perpendicular':
      ctx.beginPath()
      ctx.moveTo(-r, -r); ctx.lineTo(-r, r); ctx.lineTo(r, r)
      ctx.moveTo(-r, 0); ctx.lineTo(0, 0); ctx.lineTo(0, r)
      ctx.stroke()
      break
    case 'tangent':
      ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.8, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(-r, -r * 0.7); ctx.lineTo(r, -r * 0.7); ctx.stroke()
      break
    case 'grid':
      ctx.beginPath()
      ctx.moveTo(-r, 0); ctx.lineTo(r, 0)
      ctx.moveTo(0, -r); ctx.lineTo(0, r)
      ctx.stroke()
      break
    case 'onEdge':
      ctx.beginPath()
      ctx.moveTo(-r, -r * 0.6); ctx.lineTo(r, -r * 0.6)
      ctx.moveTo(-r, r * 0.6); ctx.lineTo(r, r * 0.6)
      ctx.stroke()
      break
  }
  ctx.restore()

  if (!label) return
  const fontSize = 10 / z
  ctx.save()
  ctx.font = `${fontSize}px Inter, sans-serif`
  const tw = ctx.measureText(label).width
  const pad = 3 / z
  const lx = hit.x + 10 / z
  const ly = hit.y - 10 / z
  ctx.fillStyle = 'rgba(16,185,129,0.92)'
  ctx.fillRect(lx, ly - fontSize, tw + pad * 2, fontSize + pad * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, lx + pad, ly - fontSize / 2 + pad / 2)
  ctx.restore()
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  hasSelection: boolean
  hasMultiSelection: boolean
  isGroup: boolean
  isPathOrPoly: boolean
}

export function DesignCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const isPanning = useRef(false)
  const lastPanPoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  /** El encuadre inicial quedo pendiente porque el lienzo medía 0. */
  const needsFit = useRef(false)
  /** Barra espaciadora sostenida: modo paneo, como en cualquier editor. */
  const spaceHeld = useRef(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, hasSelection: false, hasMultiSelection: false, isGroup: false, isPathOrPoly: false,
  })

  const { t } = useTranslation('canvas')
  // after:render corre dentro del effect de montaje: leemos t por ref para que
  // las etiquetas dibujadas sigan el idioma activo sin recrear el canvas.
  const tRef = useRef(t)
  tRef.current = t
  const { 
    workArea, 
    showGrid, 
    gridSpacingMm,
    gridAdaptive,
    showRulers,
    guides,
    showGuides,
    activeSheetId,
    pendingCanvasJSON,
    selectElement, 
    setSelectedElements, 
    setIsGroupSelection,
    drawingMode,
    setDrawingMode,
    measuringMode,
    setMeasuringMode,
    trimMode,
    setTrimMode,
    extendMode,
    setExtendMode
  } = useCanvasStore()
  const cm = useCanvasManager()
  const { setCanvas, updateSelectedObjectProps } = cm
  const [distanceOverlay, setDistanceOverlay] = useState<{
    screenX: number; screenY: number; valueMm: string; angleDeg: string
  } | null>(null)
  const distanceInputRef = useRef<HTMLInputElement>(null)
  const angleInputRef = useRef<HTMLInputElement>(null)
  const [cotaEdit, setCotaEdit] = useState<{
    screenX: number; screenY: number; valueMm: string
    cota: CotaData
  } | null>(null)
  const cotaInputRef = useRef<HTMLInputElement>(null)

  // Keyboard shortcuts (Delete, Ctrl+Z, Ctrl+C/V/D/A, arrows, etc.)
  useKeyboardShortcuts()

  // ------------------------------------------
  // Rebuild the work area background objects
  // ------------------------------------------
  const rebuildWorkArea = useCallback(
    (canvas: Canvas) => {
      // Remove existing non-interactive objects
      const toRemove = canvas
        .getObjects()
        .filter((obj) => getCustomProp(obj, NON_INTERACTIVE_KEY) === true)
      for (const obj of toRemove) {
        canvas.remove(obj)
      }

      // Build new work area objects
      const waObjects = buildWorkAreaObjects(
        workArea.width,
        workArea.height,
        workArea.origin,
        showGrid,
      )

      // Insert at beginning so they are behind user objects
      for (let i = 0; i < waObjects.length; i++) {
        canvas.insertAt(i, waObjects[i])
      }

      canvas.requestRenderAll()
    },
    [workArea, showGrid],
  )

  // ------------------------------------------
  // Initialize Fabric.js Canvas
  // ------------------------------------------
  useEffect(() => {
    if (!canvasElRef.current || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    const canvas = new Canvas(canvasElRef.current, {
      width,
      height,
      backgroundColor: '#F0F0F0',
      selection: true,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: true,
      fireMiddleClick: true,
    })

    fabricRef.current = canvas
    setCanvas(canvas)

    // Build initial work area
    rebuildWorkArea(canvas)

    // Encuadre inicial. La ventana se crea con `maximized: true` y
    // `visible: false`, asi que el tamaño de este momento no es el definitivo:
    // si el encuadre no se puede hacer todavia queda pendiente para el primer
    // resize real
    needsFit.current = !fitWorkAreaToCanvas(canvas, workArea)

    // ---- Event: Mouse wheel zoom ----
    canvas.on('mouse:wheel', (opt) => {
      const evt = opt.e as WheelEvent
      evt.preventDefault()
      evt.stopPropagation()

      const delta = evt.deltaY
      let newZoom = canvas.getZoom()
      newZoom *= delta > 0 ? 1 / 1.05 : 1.05
      newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom))

      canvas.zoomToPoint(new Point(evt.offsetX, evt.offsetY), newZoom)
      markViewTouched(canvas, true)
      canvas.requestRenderAll()
    })

    // ---- Paneo: rueda del medio, barra espaciadora o Alt+arrastre ----
    // Shift queda para la seleccion multiple (default de Fabric). Alt no
    // alcanza por si solo: en Linux el gestor de ventanas se queda con
    // Alt+arrastre para mover la ventana y el evento nunca llega al lienzo
    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent
      if (evt.button === 1 || spaceHeld.current || (evt.altKey && evt.button === 0)) {
        isPanning.current = true
        lastPanPoint.current = { x: evt.clientX, y: evt.clientY }
        canvas.selection = false
        canvas.setCursor('grab')
        evt.preventDefault()
      }
    })

    canvas.on('mouse:move', (opt) => {
      if (!isPanning.current) return
      const evt = opt.e as MouseEvent
      const currentVpt = canvas.viewportTransform
      if (!currentVpt) return

      currentVpt[4] += evt.clientX - lastPanPoint.current.x
      currentVpt[5] += evt.clientY - lastPanPoint.current.y
      lastPanPoint.current = { x: evt.clientX, y: evt.clientY }
      canvas.setViewportTransform(currentVpt)
      markViewTouched(canvas, true)
      canvas.requestRenderAll()
    })

    canvas.on('mouse:up', () => {
      if (isPanning.current) {
        isPanning.current = false
        canvas.selection = !spaceHeld.current
        canvas.setCursor(spaceHeld.current ? 'grab' : 'default')
      }
    })

    // ---- Barra espaciadora: modo paneo mientras se sostiene ----
    const isTyping = (el: EventTarget | null) => {
      const node = el as HTMLElement | null
      const tag = node?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || node?.isContentEditable === true
    }

    const onSpaceDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping(e.target)) return
      // Sin esto la barra desplaza la pagina y activa el boton que tenga foco
      e.preventDefault()
      spaceHeld.current = true
      canvas.selection = false
      canvas.defaultCursor = 'grab'
      canvas.setCursor('grab')
    }

    const onSpaceUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceHeld.current = false
      isPanning.current = false
      canvas.selection = true
      canvas.defaultCursor = 'default'
      canvas.setCursor('default')
    }

    // Si el foco se va con la barra apretada, el modo queda pegado
    const onBlurReset = () => {
      if (!spaceHeld.current) return
      spaceHeld.current = false
      isPanning.current = false
      canvas.selection = true
      canvas.defaultCursor = 'default'
    }

    window.addEventListener('keydown', onSpaceDown)
    window.addEventListener('keyup', onSpaceUp)
    window.addEventListener('blur', onBlurReset)

    // ---- Guias: crear arrastrando desde la regla, mover y borrar ----
    /** Devuelve la guia cuya linea esta a menos de `tol` px de pantalla. */
    const guideAtScreen = (sx: number, sy: number): { id: string; axis: 'x' | 'y' } | null => {
      const st = useCanvasStore.getState()
      if (!st.showGuides) return null
      const vptG = canvas.viewportTransform
      if (!vptG) return null
      const zoomG = canvas.getZoom() || 1
      const tol = 5

      for (const g of st.guides) {
        const pt = mmToCanvas(
          g.axis === 'x' ? g.mm : 0,
          g.axis === 'y' ? g.mm : 0,
          st.workArea,
        )
        if (g.axis === 'x') {
          if (Math.abs(pt.x * zoomG + vptG[4] - sx) <= tol) return { id: g.id, axis: 'x' }
        } else {
          if (Math.abs(pt.y * zoomG + vptG[5] - sy) <= tol) return { id: g.id, axis: 'y' }
        }
      }
      return null
    }

    /** Posicion en mm (segun el eje) del cursor de pantalla. */
    const guideMmAt = (sx: number, sy: number, axis: 'x' | 'y'): number => {
      const vptG = canvas.viewportTransform!
      const zoomG = canvas.getZoom() || 1
      const st = useCanvasStore.getState()
      const mm = canvasToMm((sx - vptG[4]) / zoomG, (sy - vptG[5]) / zoomG, st.workArea)
      return axis === 'x' ? mm.x : mm.y
    }

    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent
      if (evt.button !== 0 || evt.altKey) return
      const st = useCanvasStore.getState()
      if (st.drawingMode || st.measuringMode || st.trimMode || st.extendMode) return
      if (st.nodeEditingElementId) return

      const inRulerX = st.showRulers && evt.offsetY <= RULER_SIZE
      const inRulerY = st.showRulers && evt.offsetX <= RULER_SIZE

      // Desde la regla nace una guia nueva
      if (inRulerX || inRulerY) {
        const axis: 'x' | 'y' = inRulerY && !inRulerX ? 'x' : inRulerX && !inRulerY ? 'y' : 'x'
        const mm = guideMmAt(evt.offsetX, evt.offsetY, axis)
        const id = st.addGuide(axis, +mm.toFixed(2))
        draggingGuide = { id, axis, isNew: true }
        canvas.selection = false
        evt.preventDefault()
        canvas.requestRenderAll()
        return
      }

      // Sobre una guia existente: moverla
      const hit = guideAtScreen(evt.offsetX, evt.offsetY)
      if (hit) {
        draggingGuide = { ...hit, isNew: false }
        canvas.selection = false
        evt.preventDefault()
      }
    })

    canvas.on('mouse:move', (opt) => {
      const evt = opt.e as MouseEvent

      if (draggingGuide) {
        const mm = guideMmAt(evt.offsetX, evt.offsetY, draggingGuide.axis)
        useCanvasStore.getState().moveGuide(draggingGuide.id, +mm.toFixed(2))
        canvas.requestRenderAll()
        return
      }

      const st = useCanvasStore.getState()
      if (st.drawingMode || st.nodeEditingElementId) return
      const hit = guideAtScreen(evt.offsetX, evt.offsetY)
      const newHover = hit?.id ?? null
      if (newHover !== hoveredGuideId) {
        hoveredGuideId = newHover
        canvas.upperCanvasEl.style.cursor = newHover
          ? (hit!.axis === 'x' ? 'ew-resize' : 'ns-resize')
          : ''
        canvas.requestRenderAll()
      }
    })

    canvas.on('mouse:up', (opt) => {
      if (!draggingGuide) return
      const evt = opt.e as MouseEvent
      const st = useCanvasStore.getState()

      // Soltar sobre la regla (o fuera del lienzo) descarta la guia
      const backToRuler = st.showRulers &&
        (evt.offsetX <= RULER_SIZE || evt.offsetY <= RULER_SIZE)
      const outside =
        evt.offsetX < 0 || evt.offsetY < 0 ||
        evt.offsetX > canvas.getWidth() || evt.offsetY > canvas.getHeight()

      if (backToRuler || outside) {
        st.removeGuide(draggingGuide.id)
      }

      draggingGuide = null
      canvas.selection = true
      canvas.requestRenderAll()
    })

    // ---- Event: posicion del cursor (footer + marcador en las reglas) ----
    let cursorRaf = 0
    let lastRulerPaint = { x: -1, y: -1 }
    canvas.on('mouse:move', (opt) => {
      const evt = opt.e as MouseEvent
      rulerCursor = { x: evt.offsetX, y: evt.offsetY }
      if (cursorRaf) return
      cursorRaf = requestAnimationFrame(() => {
        cursorRaf = 0
        if (!rulerCursor) return
        // Repintar solo si el cursor cambio de pixel: evita renders en vano
        const moved =
          Math.round(rulerCursor.x) !== lastRulerPaint.x ||
          Math.round(rulerCursor.y) !== lastRulerPaint.y
        if (!moved) return
        lastRulerPaint = { x: Math.round(rulerCursor.x), y: Math.round(rulerCursor.y) }
        const vptNow = canvas.viewportTransform
        if (!vptNow) return
        const zoomNow = canvas.getZoom() || 1
        const state = useCanvasStore.getState()
        state.setCursorMm(canvasToMm(
          (rulerCursor.x - vptNow[4]) / zoomNow,
          (rulerCursor.y - vptNow[5]) / zoomNow,
          state.workArea,
        ))
        if (state.showRulers) canvas.requestRenderAll()
      })
    })

    canvas.on('mouse:out', () => {
      rulerCursor = null
      useCanvasStore.getState().setCursorMm(null)
      canvas.requestRenderAll()
    })

    // ---- Event: Right-click context menu ----
    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent
      if (evt.button !== 2) return

      evt.preventDefault()
      evt.stopPropagation()

      const active = canvas.getActiveObject()
      const hasSelection = !!active && getCustomProp(active, NON_INTERACTIVE_KEY) !== true
      const hasMultiSelection = active instanceof ActiveSelection
      const isGroupObj = hasSelection && active instanceof Group && !(active instanceof ActiveSelection)

      // Get position relative to container
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()

      const isPathOrPoly = hasSelection && !hasMultiSelection &&
        (active instanceof Path || active instanceof FabricPolygon)

      setContextMenu({
        visible: true,
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top,
        hasSelection,
        hasMultiSelection,
        isGroup: isGroupObj,
        isPathOrPoly,
      })
    })

    // ---- Event: Object selection -> sync with store ----
    const syncSelection = (selected: FabricObject[] | undefined) => {
      if (!selected || selected.length === 0) return
      const active = canvas.getActiveObject()
      const isGroup = active instanceof ActiveSelection && selected.length > 1

      if (selected.length === 1) {
        const elId = getCustomProp(selected[0], ELEMENT_ID_KEY)
        if (typeof elId === 'string') {
          selectElement(elId)
        }
      } else if (selected.length > 0) {
        // For multi-selection, select the first element's ID for basic display
        const firstId = getCustomProp(selected[0], ELEMENT_ID_KEY)
        if (typeof firstId === 'string') {
          selectElement(firstId)
        }
      }

      setIsGroupSelection(isGroup)
      // Build selectedElements array from selected fabric objects
      const storeState = useCanvasStore.getState()
      const elements = selected
        .map(obj => {
          const elId = getCustomProp(obj, ELEMENT_ID_KEY)
          return typeof elId === 'string' ? storeState.findElementById(elId) : undefined
        })
        .filter((el): el is NonNullable<typeof el> => !!el)
      setSelectedElements(elements)
      updateSelectedObjectProps()
    }

    // El indice de snap se invalida ante cualquier cambio de geometria
    canvas.on('object:added', invalidateSnapIndex)
    canvas.on('object:removed', invalidateSnapIndex)
    canvas.on('object:modified', invalidateSnapIndex)

    canvas.on('selection:created', (opt) => syncSelection(opt.selected))
    canvas.on('selection:updated', (opt) => syncSelection(opt.selected))

    canvas.on('selection:cleared', () => {
      selectElement(null)
      setIsGroupSelection(false)
      setSelectedElements([])
      updateSelectedObjectProps()
      hoveredCotaIndex = -1
      canvas.upperCanvasEl.style.cursor = ''
    })

    // ---- after:render: draw grid + snap guides on main canvas ----
    // Using contextContainer (not contextTop) so it clears properly each frame
    canvas.on('after:render', () => {
      const ctx = canvas.contextContainer
      if (!ctx) return
      const vpt = canvas.viewportTransform
      if (!vpt) return
      const z = canvas.getZoom() || 1
      const wa = useCanvasStore.getState()

      ctx.save()
      ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5])

      // ---- Grid ----
      if (wa.showGrid) {
        const { spacingMm, major } = effectiveGridSpacing(z)
        const gridPx = spacingMm * PIXELS_PER_MM
        const ox = WORK_AREA_PADDING
        const oy = WORK_AREA_PADDING
        const workW = wa.workArea.width * PIXELS_PER_MM
        const workH = wa.workArea.height * PIXELS_PER_MM
        const totalCols = Math.floor(workW / gridPx)
        const totalRows = Math.floor(workH / gridPx)

        // Minor lines
        ctx.strokeStyle = '#C9BEE6'
        ctx.lineWidth = 0.5 / z
        ctx.setLineDash([])
        ctx.beginPath()
        for (let i = 1; i <= totalCols; i++) {
          if (i % major === 0) continue
          const x = ox + i * gridPx
          ctx.moveTo(x, oy); ctx.lineTo(x, oy + workH)
        }
        for (let i = 1; i <= totalRows; i++) {
          if (i % major === 0) continue
          const y = oy + i * gridPx
          ctx.moveTo(ox, y); ctx.lineTo(ox + workW, y)
        }
        ctx.stroke()

        // Major lines
        ctx.strokeStyle = '#8B7BBF'
        ctx.lineWidth = 1 / z
        ctx.beginPath()
        for (let i = major; i <= totalCols; i += major) {
          const x = ox + i * gridPx
          ctx.moveTo(x, oy); ctx.lineTo(x, oy + workH)
        }
        for (let i = major; i <= totalRows; i += major) {
          const y = oy + i * gridPx
          ctx.moveTo(ox, y); ctx.lineTo(ox + workW, y)
        }
        ctx.stroke()
      }

      // ---- Guias de usuario ----
      if (wa.showGuides && wa.guides.length > 0) {
        const vptG = canvas.viewportTransform!
        // Extremos del viewport en coordenadas canvas, para cubrir toda la vista
        const left = -vptG[4] / z
        const top = -vptG[5] / z
        const right = left + canvas.getWidth() / z
        const bottom = top + canvas.getHeight() / z

        for (const g of wa.guides) {
          const pt = mmToCanvas(
            g.axis === 'x' ? g.mm : 0,
            g.axis === 'y' ? g.mm : 0,
            wa.workArea,
          )
          const isActive = g.id === hoveredGuideId || g.id === draggingGuide?.id
          ctx.strokeStyle = isActive ? '#0EA5E9' : 'rgba(14,165,233,0.55)'
          ctx.lineWidth = (isActive ? 1.5 : 1) / z
          ctx.setLineDash([7 / z, 4 / z])
          ctx.beginPath()
          if (g.axis === 'x') {
            ctx.moveTo(pt.x, top); ctx.lineTo(pt.x, bottom)
          } else {
            ctx.moveTo(left, pt.y); ctx.lineTo(right, pt.y)
          }
          ctx.stroke()
        }
        ctx.setLineDash([])
      }

      // ---- Snap guides + dots ----
      if (activeGuides.h.length > 0 || activeGuides.v.length > 0 || activeGuides.dots.length > 0) {
        ctx.strokeStyle = '#FF6B35'
        ctx.lineWidth = 1 / z
        ctx.setLineDash([4 / z, 4 / z])
        ctx.beginPath()
        for (const g of activeGuides.v) {
          ctx.moveTo(g.x, g.y1); ctx.lineTo(g.x, g.y2)
        }
        for (const g of activeGuides.h) {
          ctx.moveTo(g.x1, g.y); ctx.lineTo(g.x2, g.y)
        }
        ctx.stroke()

        // Dots at snap points
        ctx.fillStyle = '#FF6B35'
        ctx.setLineDash([])
        const r = 4 / z
        for (const d of activeGuides.dots) {
          ctx.beginPath()
          ctx.arc(d.x, d.y, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // ---- Drawing mode preview ----
      if (drawingPoints.length > 0) {
        // Solid lines between placed points
        if (drawingPoints.length >= 2) {
          ctx.strokeStyle = '#0EA5E9'
          ctx.lineWidth = 1.5 / z
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(drawingPoints[0].x, drawingPoints[0].y)
          for (let i = 1; i < drawingPoints.length; i++) {
            ctx.lineTo(drawingPoints[i].x, drawingPoints[i].y)
          }
          ctx.stroke()
        }

        // Dashed preview line from last point to mouse (snaps to first point when near)
        if (drawingMousePos) {
          const lastPt = drawingPoints[drawingPoints.length - 1]
          const targetPt = drawingNearStart && drawingPoints.length >= 3
            ? drawingPoints[0]
            : drawingMousePos
          ctx.strokeStyle = '#0EA5E9'
          ctx.lineWidth = 1 / z
          ctx.setLineDash([6 / z, 4 / z])
          ctx.beginPath()
          ctx.moveTo(lastPt.x, lastPt.y)
          ctx.lineTo(targetPt.x, targetPt.y)
          ctx.stroke()
        }

        // Dots at each placed point
        ctx.fillStyle = '#0369A1'
        ctx.setLineDash([])
        const ptR = 4 / z
        for (const p of drawingPoints) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, ptR, 0, Math.PI * 2)
          ctx.fill()
        }

        // Snap-to-close indicator: ring around first point when mouse is near
        if (drawingNearStart && drawingPoints.length >= 3) {
          const fp = drawingPoints[0]
          ctx.strokeStyle = '#0EA5E9'
          ctx.lineWidth = 2 / z
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.arc(fp.x, fp.y, 8 / z, 0, Math.PI * 2)
          ctx.stroke()
          // Filled inner dot
          ctx.fillStyle = '#0EA5E9'
          ctx.beginPath()
          ctx.arc(fp.x, fp.y, 4 / z, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // ---- Preview de forma por arrastre ----
      if (dragShapeStart && dragShapeCurrent) {
        const mode = wa.drawingMode
        const box = dragShapeBox(shiftHeld)
        if (box && (box.width > 0 || box.height > 0)) {
          ctx.strokeStyle = '#0EA5E9'
          ctx.lineWidth = 1.5 / z
          ctx.setLineDash([6 / z, 4 / z])
          ctx.beginPath()
          if (mode === 'circle') {
            const r = Math.min(box.width, box.height) / 2
            ctx.arc(box.left + r, box.top + r, r, 0, Math.PI * 2)
          } else if (mode === 'ellipse') {
            ctx.ellipse(
              box.left + box.width / 2, box.top + box.height / 2,
              box.width / 2, box.height / 2, 0, 0, Math.PI * 2,
            )
          } else {
            ctx.rect(box.left, box.top, box.width, box.height)
          }
          ctx.stroke()
          ctx.setLineDash([])

          // Medidas junto al cursor
          const wMm = box.width / PIXELS_PER_MM
          const hMm = box.height / PIXELS_PER_MM
          const text = mode === 'circle'
            ? `⌀ ${(Math.min(wMm, hMm)).toFixed(2)} mm`
            : `${wMm.toFixed(2)} x ${hMm.toFixed(2)} mm`
          const fontSize = 11 / z
          ctx.font = `bold ${fontSize}px Inter, sans-serif`
          const tw = ctx.measureText(text).width
          const pad = 4 / z
          const bx = dragShapeCurrent.x + 14 / z
          const by = dragShapeCurrent.y + 14 / z
          ctx.fillStyle = 'rgba(15,23,42,0.88)'
          ctx.fillRect(bx, by, tw + pad * 2, fontSize + pad * 2)
          ctx.fillStyle = '#F8FAFC'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText(text, bx + pad, by + pad)
        }
      }

      // ---- Arc drawing preview ----
      if (arcPoints.length > 0) {
        ctx.fillStyle = '#0369A1'
        ctx.setLineDash([])
        const aPtR = 4 / z
        for (const p of arcPoints) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, aPtR, 0, Math.PI * 2)
          ctx.fill()
        }

        if (arcPoints.length >= 2 && drawingMousePos) {
          // Preview arc through placed points + mouse
          const previewPts = arcPoints.length === 2
            ? arcFrom3Points(arcPoints[0], arcPoints[1], drawingMousePos)
            : arcFrom3Points(arcPoints[0], arcPoints[1], arcPoints[2])

          if (previewPts.length >= 2) {
            ctx.strokeStyle = '#0EA5E9'
            ctx.lineWidth = 1.5 / z
            ctx.setLineDash(arcPoints.length < 3 ? [6 / z, 4 / z] : [])
            ctx.beginPath()
            ctx.moveTo(previewPts[0].x, previewPts[0].y)
            for (let i = 1; i < previewPts.length; i++) {
              ctx.lineTo(previewPts[i].x, previewPts[i].y)
            }
            ctx.stroke()
          }
        } else if (arcPoints.length === 1 && drawingMousePos) {
          // Dashed line from first point to mouse
          ctx.strokeStyle = '#0EA5E9'
          ctx.lineWidth = 1 / z
          ctx.setLineDash([6 / z, 4 / z])
          ctx.beginPath()
          ctx.moveTo(arcPoints[0].x, arcPoints[0].y)
          ctx.lineTo(drawingMousePos.x, drawingMousePos.y)
          ctx.stroke()
        }
      }

      // ---- Bezier curve drawing preview ----
      if (wa.drawingMode === 'bezier' && drawingPoints.length > 0) {
        const previewPts = drawingMousePos
          ? [...drawingPoints, drawingMousePos]
          : drawingPoints

        if (previewPts.length >= 2) {
          const sampled = sampleCatmullRom(previewPts, false, 12)
          ctx.strokeStyle = '#0EA5E9'
          ctx.lineWidth = 1.5 / z
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(sampled[0].x, sampled[0].y)
          for (let i = 1; i < sampled.length; i++) {
            ctx.lineTo(sampled[i].x, sampled[i].y)
          }
          ctx.stroke()
        }

        // Dots at anchor points
        ctx.fillStyle = '#0369A1'
        ctx.setLineDash([])
        const bPtR = 4 / z
        for (const p of drawingPoints) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, bPtR, 0, Math.PI * 2)
          ctx.fill()
        }

        // Snap-to-close indicator
        if (drawingNearStart && drawingPoints.length >= 3) {
          const fp = drawingPoints[0]
          ctx.strokeStyle = '#0EA5E9'
          ctx.lineWidth = 2 / z
          ctx.beginPath()
          ctx.arc(fp.x, fp.y, 8 / z, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // ---- Dimension annotations (cotas) for selected object ----
      activeCotas = computeCotas(canvas)
      if (activeCotas.length > 0) {
        for (let ci = 0; ci < activeCotas.length; ci++) {
          const c = activeCotas[ci]
          const isHover = ci === hoveredCotaIndex

          const dx = c.bx - c.ax
          const dy = c.by - c.ay
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len < 1) continue
          // Use stored perpendicular direction (matches label offset)
          const nx = c.nx, ny = c.ny
          const off = 10 / z

          const lineColor = isHover ? '#0EA5E9' : '#999'
          const textColor = isHover ? '#0284C7' : '#555'
          const lineW = isHover ? 1 / z : 0.7 / z

          // Extension lines (from near edge outward in perpendicular direction)
          ctx.strokeStyle = lineColor
          ctx.lineWidth = lineW
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(c.ax + nx * 3 / z, c.ay + ny * 3 / z)
          ctx.lineTo(c.ax + nx * (off + 5 / z), c.ay + ny * (off + 5 / z))
          ctx.moveTo(c.bx + nx * 3 / z, c.by + ny * 3 / z)
          ctx.lineTo(c.bx + nx * (off + 5 / z), c.by + ny * (off + 5 / z))
          ctx.stroke()

          // Dimension line (parallel to edge, offset outward)
          const aOx = c.ax + nx * off, aOy = c.ay + ny * off
          const bOx = c.bx + nx * off, bOy = c.by + ny * off
          ctx.strokeStyle = lineColor
          ctx.lineWidth = lineW
          ctx.beginPath()
          ctx.moveTo(aOx, aOy)
          ctx.lineTo(bOx, bOy)
          ctx.stroke()

          // Arrows at ends of dimension line
          const arrowLen = 5 / z
          const adx = dx / len, ady = dy / len
          ctx.beginPath()
          ctx.moveTo(aOx, aOy)
          ctx.lineTo(aOx + (adx * arrowLen + nx * arrowLen * 0.4), aOy + (ady * arrowLen + ny * arrowLen * 0.4))
          ctx.moveTo(aOx, aOy)
          ctx.lineTo(aOx + (adx * arrowLen - nx * arrowLen * 0.4), aOy + (ady * arrowLen - ny * arrowLen * 0.4))
          ctx.moveTo(bOx, bOy)
          ctx.lineTo(bOx - (adx * arrowLen + nx * arrowLen * 0.4), bOy - (ady * arrowLen + ny * arrowLen * 0.4))
          ctx.moveTo(bOx, bOy)
          ctx.lineTo(bOx - (adx * arrowLen - nx * arrowLen * 0.4), bOy - (ady * arrowLen - ny * arrowLen * 0.4))
          ctx.stroke()

          // Text label with background
          const text = c.valueMm.toFixed(1)
          const fontSize = 10 / z
          ctx.save()
          ctx.translate(c.labelX, c.labelY)
          ctx.rotate(c.angle)
          ctx.font = `bold ${fontSize}px sans-serif`
          const tw = ctx.measureText(text).width
          const pad = 2 / z
          ctx.fillStyle = isHover ? 'rgba(224,242,254,0.95)' : 'rgba(255,255,255,0.85)'
          ctx.fillRect(-tw / 2 - pad, -fontSize / 2 - pad, tw + pad * 2, fontSize + pad * 2)
          if (isHover) {
            ctx.strokeStyle = '#0EA5E9'
            ctx.lineWidth = 0.5 / z
            ctx.strokeRect(-tw / 2 - pad, -fontSize / 2 - pad, tw + pad * 2, fontSize + pad * 2)
          }
          ctx.fillStyle = textColor
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(text, 0, 0)
          ctx.restore()
        }
      }

      // ---- Node editing overlay ----
      if (nodeEditData && nodeEditObject) {
        const nodeR = 5 / z
        const handleR = 4 / z
        const lineW = 1 / z

        // Draw segments between anchors (highlight)
        const anchors = nodeEditData.nodes.filter(n => n.type === 'anchor')
        ctx.strokeStyle = '#0EA5E9'
        ctx.lineWidth = 1.5 / z
        ctx.setLineDash([])
        if (anchors.length >= 2) {
          ctx.beginPath()
          ctx.moveTo(anchors[0].x, anchors[0].y)
          for (let i = 1; i < anchors.length; i++) {
            ctx.lineTo(anchors[i].x, anchors[i].y)
          }
          if (nodeEditData.isClosed) {
            ctx.closePath()
          }
          ctx.stroke()
        }

        // Draw bezier handle lines
        ctx.strokeStyle = 'rgba(14,165,233,0.5)'
        ctx.lineWidth = lineW
        ctx.setLineDash([3 / z, 3 / z])
        for (const [anchorIdx, handle] of nodeEditData.handles) {
          const anchor = anchors[anchorIdx]
          if (!anchor) continue
          if (handle.cp1) {
            const cpNode = nodeEditData.nodes[handle.cp1.nodeIndex]
            if (cpNode) {
              ctx.beginPath()
              ctx.moveTo(anchor.x, anchor.y)
              ctx.lineTo(cpNode.x, cpNode.y)
              ctx.stroke()
            }
          }
          if (handle.cp2) {
            const cpNode = nodeEditData.nodes[handle.cp2.nodeIndex]
            if (cpNode) {
              ctx.beginPath()
              ctx.moveTo(anchor.x, anchor.y)
              ctx.lineTo(cpNode.x, cpNode.y)
              ctx.stroke()
            }
          }
        }
        ctx.setLineDash([])

        // Draw segment hover indicator
        if (segmentHoverAnchorIdx >= 0 && segmentHoverAnchorIdx < anchors.length) {
          const a = anchors[segmentHoverAnchorIdx]
          const b = segmentHoverAnchorIdx < anchors.length - 1
            ? anchors[segmentHoverAnchorIdx + 1]
            : nodeEditData.isClosed ? anchors[0] : null
          if (a && b) {
            ctx.strokeStyle = '#F59E0B'
            ctx.lineWidth = 2.5 / z
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }

        // Draw control points (diamonds)
        const selectedNode = useCanvasStore.getState().nodeEditSelectedNode
        for (let i = 0; i < nodeEditData.nodes.length; i++) {
          const node = nodeEditData.nodes[i]
          if (node.type !== 'controlPoint') continue
          const isSelected = i === selectedNode
          const isHover = i === nodeHoverIndex

          ctx.save()
          ctx.translate(node.x, node.y)
          ctx.rotate(Math.PI / 4)
          const s = handleR * 1.2
          ctx.fillStyle = isSelected ? '#F59E0B' : isHover ? '#FCD34D' : '#93C5FD'
          ctx.strokeStyle = isSelected ? '#D97706' : '#3B82F6'
          ctx.lineWidth = lineW
          ctx.fillRect(-s, -s, s * 2, s * 2)
          ctx.strokeRect(-s, -s, s * 2, s * 2)
          ctx.restore()
        }

        // Draw anchor nodes (circles)
        for (let i = 0; i < nodeEditData.nodes.length; i++) {
          const node = nodeEditData.nodes[i]
          if (node.type !== 'anchor') continue
          const isSelected = i === selectedNode
          const isHover = i === nodeHoverIndex

          ctx.beginPath()
          ctx.arc(node.x, node.y, isSelected || isHover ? nodeR * 1.2 : nodeR, 0, Math.PI * 2)
          ctx.fillStyle = isSelected ? '#0EA5E9' : isHover ? '#60A5FA' : '#FFFFFF'
          ctx.fill()
          ctx.strokeStyle = isSelected ? '#0369A1' : '#3B82F6'
          ctx.lineWidth = isSelected ? 2 / z : lineW
          ctx.stroke()

          // First node indicator
          if (node.isFirst) {
            ctx.beginPath()
            ctx.arc(node.x, node.y, nodeR * 0.4, 0, Math.PI * 2)
            ctx.fillStyle = isSelected ? '#0369A1' : '#3B82F6'
            ctx.fill()
          }
        }

        // Draw constraint indicators (H/V badges)
        const indicators = getConstraintIndicators(
          useCanvasStore.getState().nodeConstraints,
          nodeEditData.nodes,
        )
        for (const ind of indicators) {
          const badgeSize = 6 / z
          const badgeX = ind.x + nodeR * 1.5
          const badgeY = ind.y - nodeR * 1.5
          ctx.fillStyle = ind.type === 'horizontal' ? '#F59E0B' : ind.type === 'vertical' ? '#10B981' : '#EF4444'
          ctx.fillRect(badgeX - badgeSize, badgeY - badgeSize, badgeSize * 2, badgeSize * 2)
          ctx.fillStyle = '#FFF'
          ctx.font = `bold ${8 / z}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const label = ind.type === 'horizontal' ? 'H' : ind.type === 'vertical' ? 'V' : 'F'
          ctx.fillText(label, badgeX, badgeY)
        }
      }

      // ---- Draw Measurement: distance ----
      if (measureStart && measureEnd && measureAnglePoints.length === 0) {
        const dist = Math.sqrt((measureEnd.x - measureStart.x) ** 2 + (measureEnd.y - measureStart.y) ** 2) / PIXELS_PER_MM

        ctx.save()
        ctx.setLineDash([5 / z, 5 / z])
        ctx.strokeStyle = '#EF4444'
        ctx.lineWidth = 1.5 / z

        ctx.beginPath()
        ctx.moveTo(measureStart.x, measureStart.y)
        ctx.lineTo(measureEnd.x, measureEnd.y)
        ctx.stroke()

        const midX = (measureStart.x + measureEnd.x) / 2
        const midY = (measureStart.y + measureEnd.y) / 2

        ctx.setLineDash([])
        ctx.font = `bold ${12 / z}px Inter, sans-serif`
        const text = `${dist.toFixed(2)} mm`
        const metrics = ctx.measureText(text)
        const pad = 4 / z
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)'
        ctx.fillRect(midX - metrics.width / 2 - pad, midY - 10 / z, metrics.width + pad * 2, 20 / z)
        ctx.fillStyle = '#FFFFFF'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, midX, midY)

        // Dots at endpoints
        ctx.fillStyle = '#EF4444'
        for (const p of [measureStart, measureEnd]) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4 / z, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }

      // ---- Draw Measurement: angle ----
      if (measureAnglePoints.length >= 2) {
        ctx.save()
        ctx.strokeStyle = '#8B5CF6'
        ctx.lineWidth = 1.5 / z
        ctx.setLineDash([5 / z, 5 / z])

        const pts = measureAnglePoints
        // Draw lines from vertex (pts[1]) to pts[0] and pts[2] or mousePos
        const vertex = pts[1]
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        ctx.lineTo(vertex.x, vertex.y)
        ctx.stroke()

        const endPt = pts.length >= 3 ? pts[2] : measureEnd
        if (endPt) {
          ctx.beginPath()
          ctx.moveTo(vertex.x, vertex.y)
          ctx.lineTo(endPt.x, endPt.y)
          ctx.stroke()

          // Calculate angle
          const a1 = Math.atan2(pts[0].y - vertex.y, pts[0].x - vertex.x)
          const a2 = Math.atan2(endPt.y - vertex.y, endPt.x - vertex.x)
          let angleDeg = (a2 - a1) * (180 / Math.PI)
          if (angleDeg < 0) angleDeg += 360
          if (angleDeg > 180) angleDeg = 360 - angleDeg

          // Draw arc indicator
          const arcR = 25 / z
          ctx.setLineDash([])
          ctx.strokeStyle = '#8B5CF6'
          ctx.lineWidth = 2 / z
          const startAngle = Math.min(a1, a2)
          const endAngle = Math.max(a1, a2)
          ctx.beginPath()
          ctx.arc(vertex.x, vertex.y, arcR, startAngle, endAngle)
          ctx.stroke()

          // Label
          const labelAngle = (a1 + a2) / 2
          const labelX = vertex.x + arcR * 1.8 * Math.cos(labelAngle)
          const labelY = vertex.y + arcR * 1.8 * Math.sin(labelAngle)

          ctx.font = `bold ${12 / z}px Inter, sans-serif`
          const text = `${angleDeg.toFixed(1)}°`
          const metrics = ctx.measureText(text)
          const pad = 4 / z
          ctx.fillStyle = 'rgba(139, 92, 246, 0.9)'
          ctx.fillRect(labelX - metrics.width / 2 - pad, labelY - 10 / z, metrics.width + pad * 2, 20 / z)
          ctx.fillStyle = '#FFFFFF'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(text, labelX, labelY)
        }

        // Dots at points
        ctx.setLineDash([])
        ctx.fillStyle = '#8B5CF6'
        for (const p of pts) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4 / z, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }

      // ---- Ortho / polar: rayo guia ----
      if (orthoRay) {
        const dx = orthoRay.to.x - orthoRay.from.x
        const dy = orthoRay.to.y - orthoRay.from.y
        const len = Math.hypot(dx, dy)
        if (len > 1e-6) {
          // Extiende el rayo mas alla del cursor para que se lea la direccion
          const ext = 2000 / z
          ctx.save()
          ctx.strokeStyle = 'rgba(16,185,129,0.55)'
          ctx.lineWidth = 1 / z
          ctx.setLineDash([8 / z, 5 / z])
          ctx.beginPath()
          ctx.moveTo(orthoRay.from.x, orthoRay.from.y)
          ctx.lineTo(orthoRay.from.x + (dx / len) * ext, orthoRay.from.y + (dy / len) * ext)
          ctx.stroke()
          ctx.restore()
        }
      }

      // ---- HUD de longitud / angulo junto al cursor ----
      if (cursorHud && (wa.drawingMode || wa.measuringMode)) {
        const text = `${cursorHud.lengthMm.toFixed(2)} mm  ${cursorHud.angleDeg.toFixed(1)}°`
        const fontSize = 11 / z
        ctx.save()
        ctx.font = `bold ${fontSize}px Inter, sans-serif`
        const tw = ctx.measureText(text).width
        const pad = 4 / z
        const bx = cursorHud.x + 14 / z
        const by = cursorHud.y + 14 / z
        ctx.fillStyle = 'rgba(15,23,42,0.88)'
        ctx.fillRect(bx, by, tw + pad * 2, fontSize + pad * 2)
        ctx.fillStyle = '#F8FAFC'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(text, bx + pad, by + pad)
        ctx.restore()
      }

      // ---- Marcador del snap activo ----
      if (activeSnap) {
        drawSnapMarker(ctx, activeSnap, z, tRef.current(`snapKind.${activeSnap.kind}`))
      }

      ctx.restore()

      // ---- Reglas (fuera de la transform: siempre en pantalla) ----
      if (wa.showRulers) {
        drawRulers(ctx, canvas, wa.workArea)
      }

      // Mantener el zoom del store sincronizado para el footer
      if (Math.abs(z - wa.zoomLevel) > 1e-6) {
        useCanvasStore.getState().setZoomLevel(z)
      }
    })

    // ---- Cota hover detection — change color when mouse is near a cota label ----
    canvas.on('mouse:move', (opt) => {
      if (activeCotas.length === 0) {
        if (hoveredCotaIndex >= 0) {
          hoveredCotaIndex = -1
          canvas.requestRenderAll()
        }
        return
      }
      if (useCanvasStore.getState().drawingMode) return

      const evt = opt.e as MouseEvent
      const vpt = canvas.viewportTransform!
      const zoom = canvas.getZoom()
      const cx = (evt.offsetX - vpt[4]) / zoom
      const cy = (evt.offsetY - vpt[5]) / zoom
      const hitRadius = 18 / zoom

      let newHovered = -1
      for (let i = 0; i < activeCotas.length; i++) {
        const c = activeCotas[i]
        const d = Math.sqrt((cx - c.labelX) ** 2 + (cy - c.labelY) ** 2)
        if (d < hitRadius) { newHovered = i; break }
      }

      if (newHovered !== hoveredCotaIndex) {
        hoveredCotaIndex = newHovered
        canvas.upperCanvasEl.style.cursor = hoveredCotaIndex >= 0 ? 'pointer' : ''
        canvas.requestRenderAll()
      }
    })

    // ---- Cache bounds when drag starts ----
    let isDragging = false
    canvas.on('object:moving', (opt) => {
      const obj = opt.target
      if (!obj) return

      // Cache other bounds on first move
      if (!isDragging) {
        isDragging = true
        const snapState = useCanvasStore.getState()
        if (snapState.snapToGrid || snapState.snapToObjects) {
          cacheOtherBounds(canvas, obj)
        }
      }

      const snapState = useCanvasStore.getState()
      const hasGuides = snapState.showGuides && snapState.guides.length > 0
      if (snapState.snapToGrid || snapState.snapToObjects || hasGuides) {
        const gridSpacing = gridSpacingPx(canvas.getZoom())
        const snap = calculateSnap(
          canvas.getZoom(), obj,
          snapState.snapToGrid,
          snapState.snapToObjects,
          gridSpacing,
          snapState.workArea,
        )
        if (snap.dx !== 0 || snap.dy !== 0) {
          obj.set({
            left: (obj.left ?? 0) + snap.dx,
            top: (obj.top ?? 0) + snap.dy,
          })
          obj.setCoords()
        }
      } else {
        activeGuides = { h: [], v: [], dots: [] }
      }

      updateSelectedObjectProps()
    })
    canvas.on('object:scaling', () => updateSelectedObjectProps())
    canvas.on('object:rotating', () => updateSelectedObjectProps())

    // ---- Event: Object modified (drag, resize, rotate) -> save to history ----
    canvas.on('object:modified', (opt) => {
      // Apply snap one final time — Fabric recalculates position on release
      const obj = opt.target
      if (obj && isDragging) {
        const snapState = useCanvasStore.getState()
        const hasGuides = snapState.showGuides && snapState.guides.length > 0
        if (snapState.snapToGrid || snapState.snapToObjects || hasGuides) {
          const gridSpacing = gridSpacingPx(canvas.getZoom())
          const snap = calculateSnap(
            canvas.getZoom(), obj,
            snapState.snapToGrid,
            snapState.snapToObjects,
            gridSpacing,
            snapState.workArea,
          )
          if (snap.dx !== 0 || snap.dy !== 0) {
            obj.set({
              left: (obj.left ?? 0) + snap.dx,
              top: (obj.top ?? 0) + snap.dy,
            })
            obj.setCoords()
          }
        }
      }

      isDragging = false
      activeGuides = { h: [], v: [], dots: [] }
      cachedOtherBounds = []
      canvas.requestRenderAll()
      updateSelectedObjectProps()
      pushToHistory()
      const gcodeState = useGCodeStore.getState()
      if (gcodeState.gcodeGenerated) {
        gcodeState.setGCodeNeedsRegeneration(true)
      }
    })

    // ---- Double-click on dimension annotation (cota) → inline edit ----
    // Save cotas on mouse:down (object still selected) for use in dblclick
    // (Fabric deselects the object if dblclick lands outside it, which clears activeCotas)
    let savedCotasForDblClick: CotaData[] = []
    canvas.on('mouse:down', () => {
      if (activeCotas.length > 0) {
        savedCotasForDblClick = [...activeCotas]
      }
    })

    canvas.on('mouse:dblclick', (opt) => {
      const storeState = useCanvasStore.getState()
      if (storeState.drawingMode) return

      const evt = opt.e as MouseEvent
      const vpt = canvas.viewportTransform!
      const zoom = canvas.getZoom()
      const canvasX = (evt.offsetX - vpt[4]) / zoom
      const canvasY = (evt.offsetY - vpt[5]) / zoom

      // ---- Double-click on Path/Polygon → enter node editing ----
      if (!storeState.nodeEditingElementId) {
        const target = canvas.findTarget(opt.e as MouseEvent)
        if (target && (target instanceof Path || target instanceof FabricPolygon)) {
          const elId = getCustomProp(target, ELEMENT_ID_KEY)
          if (typeof elId === 'string') {
            const data = extractNodes(target)
            if (data && data.nodes.length > 0) {
              nodeEditData = data
              nodeEditObject = target
              // Make object non-selectable/movable while editing nodes
              target.selectable = false
              target.evented = false
              target.objectCaching = false
              canvas.discardActiveObject()
              canvas.selection = false
              storeState.setNodeEditing(elId)
              canvas.requestRenderAll()
              savedCotasForDblClick = []
              return
            }
          }
        }
      }

      // ---- Double-click on node in editing mode → toggle smooth/corner ----
      if (storeState.nodeEditingElementId && nodeEditData && nodeEditObject) {
        const hitIdx = hitTestNode(nodeEditData, canvasX, canvasY, 12 / zoom, true)
        if (hitIdx >= 0) {
          const newData = toggleNodeSmooth(nodeEditObject, nodeEditData, hitIdx)
          if (newData) {
            nodeEditData = newData
            canvas.requestRenderAll()
            pushToHistory()
          }
          savedCotasForDblClick = []
          return
        }
      }

      // ---- Double-click on dimension annotation (cota) → inline edit ----
      const cotasToCheck = activeCotas.length > 0 ? activeCotas : savedCotasForDblClick
      if (cotasToCheck.length === 0) return

      const hitRadius = 20 / zoom
      let closest: CotaData | null = null
      let closestDist = Infinity
      for (const c of cotasToCheck) {
        const d = Math.sqrt((canvasX - c.labelX) ** 2 + (canvasY - c.labelY) ** 2)
        if (d < hitRadius && d < closestDist) {
          closestDist = d
          closest = c
        }
      }

      if (closest) {
        evt.preventDefault()
        evt.stopPropagation()

        // Re-select the object if Fabric deselected it
        const obj = canvas.getObjects().find(
          o => getCustomProp(o, ELEMENT_ID_KEY) === closest!.elementId,
        )
        if (obj && canvas.getActiveObject() !== obj) {
          canvas.setActiveObject(obj)
          canvas.requestRenderAll()
        }

        const screenX = closest.labelX * zoom + vpt[4]
        const screenY = closest.labelY * zoom + vpt[5]
        setCotaEdit({
          screenX, screenY,
          valueMm: closest.valueMm.toFixed(2),
          cota: closest,
        })
        setTimeout(() => cotaInputRef.current?.select(), 50)
      }
      savedCotasForDblClick = []
    })

    // ---- Node editing: mouse handlers ----
    canvas.on('mouse:down', (opt) => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      const evt = opt.e as MouseEvent
      if (evt.button !== 0) return // solo click izquierdo

      const vpt = canvas.viewportTransform!
      const zoom = canvas.getZoom()
      const cx = (evt.offsetX - vpt[4]) / zoom
      const cy = (evt.offsetY - vpt[5]) / zoom
      const threshold = 10 / zoom

      // Hit test nodos
      const hitIdx = hitTestNode(nodeEditData, cx, cy, threshold)
      if (hitIdx >= 0) {
        state.setNodeEditSelectedNode(hitIdx)
        nodeDragging = true
        nodeDragIndex = hitIdx
        const node = nodeEditData.nodes[hitIdx]
        nodeDragStartPos = { x: node.x, y: node.y }
        canvas.requestRenderAll()
        evt.preventDefault()
        evt.stopPropagation()
        return
      }

      // Hit test segmentos (para agregar nodo)
      const segHit = hitTestSegment(nodeEditData, cx, cy, threshold)
      if (segHit) {
        const newData = addNodeOnSegment(nodeEditObject, nodeEditData, segHit.anchorIndex, segHit.t)
        if (newData) {
          nodeEditData = newData
          canvas.requestRenderAll()
          pushToHistory()
        }
        evt.preventDefault()
        evt.stopPropagation()
        return
      }

      // Click fuera de nodos/segmentos → salir del modo edición
      exitNodeEditing(canvas)
    })

    canvas.on('mouse:move', (opt) => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return

      const evt = opt.e as MouseEvent
      const vpt = canvas.viewportTransform!
      const zoom = canvas.getZoom()
      const cx = (evt.offsetX - vpt[4]) / zoom
      const cy = (evt.offsetY - vpt[5]) / zoom
      const threshold = 10 / zoom

      if (nodeDragging && nodeDragIndex >= 0) {
        let targetX = cx
        let targetY = cy

        // Shift key constraint (Horizontal/Vertical lock)
        if (evt.shiftKey && nodeDragStartPos) {
          const dx = Math.abs(cx - nodeDragStartPos.x)
          const dy = Math.abs(cy - nodeDragStartPos.y)
          if (dx > dy) {
            targetY = nodeDragStartPos.y
          } else {
            targetX = nodeDragStartPos.x
          }
          clearSnapFeedback()
        } else {
          // Snap geometrico + grilla contra el resto de la geometria
          const snapped = resolveSnappedPoint(
            canvas, { x: cx, y: cy }, null, false, nodeEditObject,
          )
          targetX = snapped.point.x
          targetY = snapped.point.y
        }

        // Apply persistent constraints (H/V/fixed)
        const constrained = applyConstraints(
          targetX, targetY, nodeDragIndex, state.nodeConstraints, nodeEditData.nodes,
        )
        targetX = constrained.x
        targetY = constrained.y

        moveNode(nodeEditObject, nodeEditData, nodeDragIndex, targetX, targetY)
        // Re-extraer todos los nodos para sincronizar overlay con path real
        const refreshed = extractNodes(nodeEditObject)
        if (refreshed) nodeEditData = refreshed
        canvas.requestRenderAll()
        return
      }

      // Hover detection
      const hitIdx = hitTestNode(nodeEditData, cx, cy, threshold)
      const segHit = hitIdx < 0 ? hitTestSegment(nodeEditData, cx, cy, threshold) : null

      let needRender = false
      if (activeSnap) {
        clearSnapFeedback()
        needRender = true
      }
      if (hitIdx !== nodeHoverIndex) {
        nodeHoverIndex = hitIdx
        needRender = true
      }
      const newSegHover = segHit ? segHit.anchorIndex : -1
      if (newSegHover !== segmentHoverAnchorIdx) {
        segmentHoverAnchorIdx = newSegHover
        needRender = true
      }

      // Cursor
      if (hitIdx >= 0) {
        canvas.upperCanvasEl.style.cursor = 'pointer'
      } else if (segHit) {
        canvas.upperCanvasEl.style.cursor = 'cell'  // add node cursor
      } else {
        canvas.upperCanvasEl.style.cursor = ''
      }

      if (needRender) canvas.requestRenderAll()
    })

    canvas.on('mouse:up', () => {
      if (nodeDragging) {
        nodeDragging = false
        nodeDragIndex = -1
        // Recalcular bounding box y refrescar nodos después del drag
        if (nodeEditObject) {
          finalizeNodeMove(nodeEditObject)
          nodeEditData = extractNodes(nodeEditObject)
          canvas.requestRenderAll()
        }
        pushToHistory()
        const gcState = useGCodeStore.getState()
        if (gcState.gcodeGenerated) {
          gcState.setGCodeNeedsRegeneration(true)
        }
      }
    })

    // ---- Node editing: keyboard events via custom events ----
    const handleNodeExit = () => {
      if (useCanvasStore.getState().nodeEditingElementId) {
        exitNodeEditing(canvas)
      }
    }
    const handleNodeDelete = () => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      if (state.nodeEditSelectedNode < 0) return
      const newData = deleteNode(nodeEditObject, nodeEditData, state.nodeEditSelectedNode)
      if (newData) {
        nodeEditData = newData
        state.setNodeEditSelectedNode(-1)
        canvas.requestRenderAll()
        pushToHistory()
      }
    }
    const handleNodeToggleSmooth = () => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      if (state.nodeEditSelectedNode < 0) return
      const newData = toggleNodeSmooth(nodeEditObject, nodeEditData, state.nodeEditSelectedNode)
      if (newData) {
        nodeEditData = newData
        canvas.requestRenderAll()
        pushToHistory()
      }
    }
    const handleNodeSplit = () => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      if (state.nodeEditSelectedNode < 0) return
      const result = splitPathAtNode(nodeEditObject, nodeEditData, state.nodeEditSelectedNode)
      if (result) {
        // Replace current path with path1, add path2 as new object
        const pathObj = nodeEditObject as Path
        pathObj.path = result.path1 as Path['path']
        ;(pathObj as unknown as { setDimensions(): void }).setDimensions()
        pathObj.setCoords()

        // Create path2 as new Path object
        const path2Str = result.path2.map(c => c.join(' ')).join(' ')
        const newPath = new Path(path2Str, {
          fill: 'transparent',
          stroke: pathObj.stroke,
          strokeWidth: pathObj.strokeWidth,
        })
        canvas.add(newPath)

        // Register in store via canvas manager
        cm.addSplitPath(newPath)

        // Re-extract and refresh
        nodeEditData = extractNodes(nodeEditObject)
        canvas.requestRenderAll()
        pushToHistory()
      }
    }
    const handleNodeToggleClosed = () => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      const newData = togglePathClosed(nodeEditObject, nodeEditData)
      if (newData) {
        nodeEditData = newData
        canvas.requestRenderAll()
        pushToHistory()
      }
    }
    const handleNodeFillet = (e: any) => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      if (state.nodeEditSelectedNode < 0) return
      const radiusPx = (e.detail.radius || 0) * PIXELS_PER_MM
      const newData = filletNode(nodeEditObject, nodeEditData, state.nodeEditSelectedNode, radiusPx)
      if (newData) {
        nodeEditData = newData
        canvas.requestRenderAll()
        pushToHistory()
      }
    }
    const handleNodeChamfer = (e: any) => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      if (state.nodeEditSelectedNode < 0) return
      const distPx = (e.detail.distance || 0) * PIXELS_PER_MM
      const newData = chamferNode(nodeEditObject, nodeEditData, state.nodeEditSelectedNode, distPx)
      if (newData) {
        nodeEditData = newData
        canvas.requestRenderAll()
        pushToHistory()
      }
    }

    // Entrar a edicion de nodos desde el teclado (tecla N)
    const handleNodeEnter = () => {
      const active = canvas.getActiveObject()
      if (!active || !(active instanceof Path || active instanceof FabricPolygon)) return
      const elId = getCustomProp(active, ELEMENT_ID_KEY)
      if (typeof elId !== 'string') return
      const data = extractNodes(active)
      if (!data || data.nodes.length === 0) return
      nodeEditData = data
      nodeEditObject = active
      active.selectable = false
      active.evented = false
      canvas.discardActiveObject()
      canvas.selection = false
      useCanvasStore.getState().setNodeEditing(elId)
      canvas.requestRenderAll()
    }

    window.addEventListener('node-edit:enter', handleNodeEnter)
    window.addEventListener('node-edit:exit', handleNodeExit)
    window.addEventListener('node-edit:delete', handleNodeDelete)
    window.addEventListener('node-edit:toggle-smooth', handleNodeToggleSmooth)
    window.addEventListener('node-edit:split', handleNodeSplit)
    window.addEventListener('node-edit:toggle-closed', handleNodeToggleClosed)
    const handleNodeDogbone = (e: any) => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      if (state.nodeEditSelectedNode < 0) return
      const radiusPx = (e.detail.radius || 0) * PIXELS_PER_MM
      const newData = dogboneNode(nodeEditObject, nodeEditData, state.nodeEditSelectedNode, radiusPx)
      if (newData) {
        nodeEditData = newData
        canvas.requestRenderAll()
        pushToHistory()
      }
    }

    const handleNodeSymmetric = () => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      if (state.nodeEditSelectedNode < 0) return
      const newData = symmetricNode(nodeEditObject, nodeEditData, state.nodeEditSelectedNode)
      if (newData) {
        nodeEditData = newData
        canvas.requestRenderAll()
        pushToHistory()
      }
    }
    const handleNodeBreak = () => {
      const state = useCanvasStore.getState()
      if (!state.nodeEditingElementId || !nodeEditData || !nodeEditObject) return
      if (state.nodeEditSelectedNode < 0) return
      const newData = breakNode(nodeEditObject, nodeEditData, state.nodeEditSelectedNode)
      if (newData) {
        nodeEditData = newData
        canvas.requestRenderAll()
        pushToHistory()
      }
    }

    window.addEventListener('node-edit:symmetric', handleNodeSymmetric)
    window.addEventListener('node-edit:break', handleNodeBreak)
    window.addEventListener('node-edit:fillet', handleNodeFillet)
    window.addEventListener('node-edit:chamfer', handleNodeChamfer)
    window.addEventListener('node-edit:dogbone', handleNodeDogbone)

    // Save initial state to history
    pushToHistory()

    // ---- Resize Observer ----
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: newW, height: newH } = entry.contentRect
        if (newW <= 0 || newH <= 0) continue

        const prevW = canvas.getWidth()
        const prevH = canvas.getHeight()
        canvas.setDimensions({ width: newW, height: newH })

        if (needsFit.current || !isViewTouched(canvas)) {
          // La vista sigue siendo la automatica: se reencuadra contra el tamaño
          // nuevo. Es el caso de arranque — la ventana se crea maximizada pero
          // el lienzo monta antes, con un tamaño que no es el que se va a ver
          needsFit.current = !fitWorkAreaToCanvas(canvas, useCanvasStore.getState().workArea)
        } else {
          // Ya hay una vista armada: se respeta el zoom del usuario y se mueve
          // el viewport la mitad del cambio, asi lo que estaba en el centro
          // sigue en el centro en vez de irse a una esquina
          const vpt = canvas.viewportTransform
          if (vpt) {
            vpt[4] += (newW - prevW) / 2
            vpt[5] += (newH - prevH) / 2
            canvas.setViewportTransform(vpt)
          }
        }
        canvas.requestRenderAll()
      }
    })
    observer.observe(container)

    // Cleanup
    return () => {
      window.removeEventListener('node-edit:enter', handleNodeEnter)
      window.removeEventListener('node-edit:exit', handleNodeExit)
      window.removeEventListener('node-edit:delete', handleNodeDelete)
      window.removeEventListener('node-edit:toggle-smooth', handleNodeToggleSmooth)
      window.removeEventListener('node-edit:split', handleNodeSplit)
      window.removeEventListener('node-edit:toggle-closed', handleNodeToggleClosed)
      window.removeEventListener('node-edit:symmetric', handleNodeSymmetric)
      window.removeEventListener('node-edit:break', handleNodeBreak)
      window.removeEventListener('node-edit:fillet', handleNodeFillet)
      window.removeEventListener('node-edit:chamfer', handleNodeChamfer)
      window.removeEventListener('node-edit:dogbone', handleNodeDogbone)
      window.removeEventListener('keydown', onSpaceDown)
      window.removeEventListener('keyup', onSpaceUp)
      window.removeEventListener('blur', onBlurReset)
      observer.disconnect()
      canvas.dispose()
      fabricRef.current = null
      setCanvas(null)
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------
  // Rebuild work area when workArea or showGrid changes
  // ------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    rebuildWorkArea(canvas)
  }, [rebuildWorkArea])

  // ------------------------------------------
  // Cargar el lienzo de un proyecto recien abierto
  // ------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas || !pendingCanvasJSON) return

    let cancelled = false

    const load = async () => {
      await canvas.loadFromJSON(pendingCanvasJSON)
      if (cancelled) return

      // El snapshot trae su propia area de trabajo: se descarta y se rearma
      // con la del proyecto que se acaba de abrir.
      rebuildWorkArea(canvas)

      // Reconectar cada elemento del store con su objeto Fabric: el panel de
      // capas trabaja sobre esa referencia.
      const state = useCanvasStore.getState()
      const byId = new Map<string, FabricObject>()
      for (const obj of canvas.getObjects()) {
        const id = getCustomProp(obj, ELEMENT_ID_KEY)
        if (typeof id === 'string') byId.set(id, obj)
      }
      for (const el of state.elements) {
        const obj = byId.get(el.id)
        if (obj) state.updateElement(el.id, { fabricObject: obj })
      }

      cm.applySheetVisibility()
      invalidateSnapIndex()
      canvas.requestRenderAll()
      cm.fitView()
      state.setPendingCanvasJSON(null)
      pushToHistory()
    }

    void load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCanvasJSON])

  // ------------------------------------------
  // Hoja activa: mostrar solo lo que vive en ella
  // ------------------------------------------
  useEffect(() => {
    if (!fabricRef.current) return
    cm.applySheetVisibility()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheetId])

  // ------------------------------------------
  // Repintar al cambiar grilla o reglas
  // ------------------------------------------
  useEffect(() => {
    fabricRef.current?.requestRenderAll()
  }, [gridSpacingMm, gridAdaptive, showRulers, showGrid, guides, showGuides])

  // ------------------------------------------
  // Drawing mode: setup/teardown event handlers
  // ------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    if (!drawingMode && !measuringMode && !trimMode && !extendMode) {
      // Clean up drawing state when exiting
      clearSnapFeedback()
      if (drawingPoints.length > 0 || arcPoints.length > 0 || measureStart || measureAnglePoints.length > 0 || dragShapeStart) {
        drawingPoints = []
        arcPoints = []
        dragShapeStart = null
        dragShapeCurrent = null
        drawingMousePos = null
        measureStart = null
        measureEnd = null
        measureAnglePoints = []
        canvas.requestRenderAll()
      }
      canvas.selection = true
      canvas.skipTargetFind = false
      canvas.defaultCursor = 'default'
      canvas.hoverCursor = 'move'
      setDistanceOverlay(null)
      return
    }

    // Enter drawing mode — common setup
    canvas.discardActiveObject()
    canvas.selection = false
    canvas.skipTargetFind = true
    canvas.defaultCursor = 'crosshair'
    canvas.hoverCursor = 'crosshair'
    drawingPoints = []
    drawingMousePos = null
    drawingNearStart = false
    arcPoints = []
    dragShapeStart = null
    dragShapeCurrent = null
    setDistanceOverlay(null)
    canvas.requestRenderAll()

    // Helpers shared by modes
    const getCanvasCoords = (evt: MouseEvent) => {
      const vpt = canvas.viewportTransform!
      const zoom = canvas.getZoom()
      return { x: (evt.offsetX - vpt[4]) / zoom, y: (evt.offsetY - vpt[5]) / zoom }
    }

    // El indice de snap se arma al entrar al modo; los cambios de geometria
    // lo invalidan via los listeners de object:added/removed/modified.
    invalidateSnapIndex()

    /**
     * Punto del cursor ya pasado por ortho + snap. `reference` es el ultimo
     * punto colocado (o null si es el primero del trazo).
     */
    const getSnappedCoords = (evt: MouseEvent, reference: Point2D | null): Point2D =>
      resolveSnappedPoint(canvas, getCanvasCoords(evt), reference, evt.shiftKey).point

    const lastDrawingPoint = (): Point2D | null =>
      drawingPoints.length > 0 ? drawingPoints[drawingPoints.length - 1] : null

    const cancelAll = () => {
      drawingPoints = []; arcPoints = []; drawingMousePos = null; drawingNearStart = false
      dragShapeStart = null; dragShapeCurrent = null
      clearSnapFeedback()
      setDistanceOverlay(null); setDrawingMode(null); canvas.requestRenderAll()
    }

    let handleMouseDown: (opt: { e: Event }) => void
    let handleMouseMove: (opt: { e: Event }) => void
    let handleMouseUp: ((opt: { e: Event }) => void) | null = null
    let handleDblClick: (() => void) | null = null
    let handleKeyDown: (e: KeyboardEvent) => void

    if (drawingMode === 'line') {
      // ===== POLYLINE MODE =====
      const CLOSE_THRESHOLD_PX = 12

      const isNearFirstPoint = (cx: number, cy: number): boolean => {
        if (drawingPoints.length < 3) return false
        const first = drawingPoints[0]
        const zoom = canvas.getZoom()
        const dx = (cx - first.x) * zoom, dy = (cy - first.y) * zoom
        return Math.sqrt(dx * dx + dy * dy) < CLOSE_THRESHOLD_PX
      }

      const showOverlay = () => {
        if (drawingPoints.length < 2) return
        const prev = drawingPoints[drawingPoints.length - 2]
        const curr = drawingPoints[drawingPoints.length - 1]
        const dist = distancePxBetween(prev, curr) / PIXELS_PER_MM
        const vpt = canvas.viewportTransform!
        const zoom = canvas.getZoom()
        setDistanceOverlay({
          screenX: ((prev.x + curr.x) / 2) * zoom + vpt[4],
          screenY: ((prev.y + curr.y) / 2) * zoom + vpt[5] - 30,
          valueMm: dist.toFixed(2),
          angleDeg: angleDegCad(prev, curr).toFixed(1),
        })
        setTimeout(() => distanceInputRef.current?.select(), 50)
      }

      const finishLine = (closed = false) => {
        if (drawingPoints.length >= 2) cm.addPolyline([...drawingPoints], closed)
        drawingPoints = []; drawingMousePos = null; drawingNearStart = false
        setDistanceOverlay(null); setDrawingMode(null)
      }

      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return
        const { x, y } = getSnappedCoords(evt, lastDrawingPoint())
        if (isNearFirstPoint(x, y)) { finishLine(true); return }
        drawingPoints.push({ x, y }); canvas.requestRenderAll(); showOverlay()
      }

      handleMouseMove = (opt) => {
        const evt = opt.e as MouseEvent
        const { x, y } = getSnappedCoords(evt, lastDrawingPoint())
        if (drawingPoints.length === 0) { canvas.requestRenderAll(); return }
        drawingMousePos = { x, y }; drawingNearStart = isNearFirstPoint(x, y)
        canvas.requestRenderAll()
      }

      handleDblClick = () => {
        if (drawingPoints.length > 1) drawingPoints.pop()
        finishLine()
      }

      handleKeyDown = (e) => {
        const inOverlayInput =
          document.activeElement === distanceInputRef.current ||
          document.activeElement === angleInputRef.current
        if (e.key === 'Escape') {
          e.preventDefault()
          if (inOverlayInput) { (document.activeElement as HTMLElement).blur(); return }
          cancelAll()
        } else if (e.key === 'Enter') {
          if (inOverlayInput) return
          e.preventDefault(); finishLine()
        }
      }
    } else if (drawingMode === 'arc') {
      // ===== ARC MODE (3 clicks) =====
      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return
        const pt = getSnappedCoords(evt, arcPoints.length > 0 ? arcPoints[arcPoints.length - 1] : null)
        arcPoints.push(pt)
        canvas.requestRenderAll()

        if (arcPoints.length === 3) {
          // Finish immediately
          cm.addArc(arcPoints[0], arcPoints[1], arcPoints[2])
          arcPoints = []; drawingMousePos = null; setDrawingMode(null)
        }
      }

      handleMouseMove = (opt) => {
        const evt = opt.e as MouseEvent
        const pt = getSnappedCoords(evt, arcPoints.length > 0 ? arcPoints[arcPoints.length - 1] : null)
        if (arcPoints.length === 0) { canvas.requestRenderAll(); return }
        drawingMousePos = pt
        canvas.requestRenderAll()
      }

      handleKeyDown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancelAll() }
      }
    } else if (drawingMode === 'bezier') {
      // ===== BEZIER CURVE MODE (reuses drawingPoints like polyline) =====
      const CLOSE_THRESHOLD_PX = 12

      const isNearFirst = (cx: number, cy: number): boolean => {
        if (drawingPoints.length < 3) return false
        const first = drawingPoints[0]
        const zoom = canvas.getZoom()
        const dx = (cx - first.x) * zoom, dy = (cy - first.y) * zoom
        return Math.sqrt(dx * dx + dy * dy) < CLOSE_THRESHOLD_PX
      }

      const finishBezier = (closed = false) => {
        if (drawingPoints.length >= 2) cm.addBezierCurve([...drawingPoints], closed)
        drawingPoints = []; drawingMousePos = null; drawingNearStart = false
        setDrawingMode(null)
      }

      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return
        const { x, y } = getSnappedCoords(evt, lastDrawingPoint())
        if (isNearFirst(x, y)) { finishBezier(true); return }
        drawingPoints.push({ x, y }); canvas.requestRenderAll()
      }

      handleMouseMove = (opt) => {
        const evt = opt.e as MouseEvent
        const { x, y } = getSnappedCoords(evt, lastDrawingPoint())
        if (drawingPoints.length === 0) { canvas.requestRenderAll(); return }
        drawingMousePos = { x, y }; drawingNearStart = isNearFirst(x, y)
        canvas.requestRenderAll()
      }

      handleDblClick = () => {
        if (drawingPoints.length > 1) drawingPoints.pop()
        finishBezier()
      }

      handleKeyDown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancelAll() }
        else if (e.key === 'Enter') { e.preventDefault(); finishBezier() }
      }
    } else if (drawingMode === 'rect' || drawingMode === 'circle' || drawingMode === 'ellipse') {
      // ===== FORMAS POR ARRASTRE =====
      const shapeType = drawingMode

      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return
        // Sin referencia: aca Shift significa proporcion 1:1, no ortho
        const pt = resolveSnappedPoint(canvas, getCanvasCoords(evt), null, false).point
        dragShapeStart = pt
        dragShapeCurrent = pt
        canvas.requestRenderAll()
      }

      handleMouseMove = (opt) => {
        const evt = opt.e as MouseEvent
        shiftHeld = evt.shiftKey
        const pt = resolveSnappedPoint(canvas, getCanvasCoords(evt), null, false).point
        if (!dragShapeStart) { canvas.requestRenderAll(); return }
        dragShapeCurrent = pt
        canvas.requestRenderAll()
      }

      handleMouseUp = (opt) => {
        const evt = opt.e as MouseEvent
        if (!dragShapeStart) return
        const box = dragShapeBox(evt.shiftKey)
        dragShapeStart = null
        dragShapeCurrent = null
        clearSnapFeedback()
        if (box && box.width >= 2 && box.height >= 2) {
          cm.addShapeAt(shapeType, box)
          setDrawingMode(null)
        } else {
          canvas.requestRenderAll()
        }
      }

      handleKeyDown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancelAll() }
      }
    } else if (drawingMode === 'cota') {
      // ===== COTA DRAWING MODE =====
      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return
        const pt = getSnappedCoords(evt, lastDrawingPoint())
        drawingPoints.push(pt)
        if (drawingPoints.length === 2) {
          cm.addCota(drawingPoints[0], drawingPoints[1])
          drawingPoints = []
          setDrawingMode(null)
        }
        canvas.requestRenderAll()
      }

      handleMouseMove = (opt) => {
        const evt = opt.e as MouseEvent
        const pt = getSnappedCoords(evt, lastDrawingPoint())
        if (drawingPoints.length === 0) { canvas.requestRenderAll(); return }
        drawingMousePos = pt
        canvas.requestRenderAll()
      }

      handleKeyDown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancelAll() }
      }
    } else if (measuringMode === 'distance') {
      // ===== DISTANCE MEASURING =====
      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return
        const pt = getSnappedCoords(evt, measureStart)
        if (!measureStart) {
          measureStart = new Point(pt.x, pt.y)
        } else {
          measureStart = null
          measureEnd = null
          setMeasuringMode(false)
        }
        canvas.requestRenderAll()
      }

      handleMouseMove = (opt) => {
        const evt = opt.e as MouseEvent
        const pt = getSnappedCoords(evt, measureStart)
        if (!measureStart) { canvas.requestRenderAll(); return }
        measureEnd = new Point(pt.x, pt.y)
        canvas.requestRenderAll()
      }

      handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          measureStart = null; measureEnd = null
          setMeasuringMode(false)
          canvas.requestRenderAll()
        }
      }
    } else if (measuringMode === 'angle') {
      // ===== ANGLE MEASURING (3 clicks: point, vertex, point) =====
      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return
        const angleRef = measureAnglePoints.length > 0
          ? measureAnglePoints[measureAnglePoints.length - 1]
          : null
        const pt = getSnappedCoords(evt, angleRef)
        measureAnglePoints.push(new Point(pt.x, pt.y))

        if (measureAnglePoints.length === 3) {
          // Keep showing result until next click or Escape
        } else if (measureAnglePoints.length > 3) {
          measureAnglePoints = []
          measureEnd = null
          setMeasuringMode(false)
        }
        canvas.requestRenderAll()
      }

      handleMouseMove = (opt) => {
        const evt = opt.e as MouseEvent
        const angleRef = measureAnglePoints.length > 0
          ? measureAnglePoints[measureAnglePoints.length - 1]
          : null
        const pt = getSnappedCoords(evt, angleRef)
        if (measureAnglePoints.length < 2 || measureAnglePoints.length >= 3) {
          canvas.requestRenderAll()
          return
        }
        measureEnd = new Point(pt.x, pt.y)
        canvas.requestRenderAll()
      }

      handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          measureAnglePoints = []
          measureStart = null; measureEnd = null
          setMeasuringMode(false)
          canvas.requestRenderAll()
        }
      }
    } else if (trimMode) {
      // ===== TRIM MODE — recortar path en intersecciones =====
      canvas.skipTargetFind = false  // necesitamos encontrar el target bajo el click
      canvas.hoverCursor = 'crosshair'

      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return

        const target = canvas.findTarget(opt.e as MouseEvent)
        if (!target || !(target instanceof Path || target instanceof FabricPolygon)) return

        const clickCanvas = getCanvasCoords(evt)

        // Obtener todos los otros objetos del canvas (no non-interactive, no el target)
        const otherObjects = canvas.getObjects()
          .filter(o => o !== target && getCustomProp(o, NON_INTERACTIVE_KEY) !== true)

        if (target instanceof Path) {
          const newPathData = trimPathAtClick(target, clickCanvas, otherObjects)
          if (newPathData) {
            // Crear un nuevo Path con las coords absolutas (canvas)
            const newPath = new Path(newPathData as unknown as string, {
              fill: 'transparent',
              stroke: target.stroke,
              strokeWidth: target.strokeWidth,
              strokeLineCap: target.strokeLineCap,
              strokeLineJoin: target.strokeLineJoin,
              strokeDashArray: target.strokeDashArray,
              selectable: target.selectable,
              evented: target.evented,
            })

            // Copiar propiedades custom
            const elId = getCustomProp(target, ELEMENT_ID_KEY)
            if (typeof elId === 'string') {
              (newPath as unknown as Record<string, unknown>)[ELEMENT_ID_KEY] = elId
            }

            // Reemplazar en el canvas
            const idx = canvas.getObjects().indexOf(target)
            canvas.remove(target)
            canvas.insertAt(idx, newPath)
            newPath.setCoords()

            pushToHistory()
            useGCodeStore.getState().setGCodeNeedsRegeneration(true)
            canvas.requestRenderAll()
          }
        }
      }
      handleMouseMove = () => { }
      handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          setTrimMode(false)
        }
      }
    } else if (extendMode) {
      // ===== EXTEND MODE — extender path hasta intersección =====
      canvas.skipTargetFind = false
      canvas.hoverCursor = 'crosshair'

      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return

        const target = canvas.findTarget(opt.e as MouseEvent)
        if (!target || !(target instanceof Path)) return

        const clickCanvas = getCanvasCoords(evt)

        // Determinar si el click está más cerca del inicio o del final del path
        const pathData = target.path as unknown[][]
        if (!pathData || !Array.isArray(pathData) || pathData.length < 2) return

        // Obtener los puntos transformados del path
        const matrix = target.calcTransformMatrix()
        const pOff = target.pathOffset ?? new Point(0, 0)
        const txPt = (px: number, py: number) => {
          const tp = util.transformPoint(new Point(px - pOff.x, py - pOff.y), matrix)
          return { x: tp.x, y: tp.y }
        }

        // Primer y último punto del path
        const firstCmd = pathData[0]
        const firstPt = firstCmd[0] === 'M' ? txPt(firstCmd[1] as number, firstCmd[2] as number) : null

        // Encontrar último comando geométrico
        let lastPt: { x: number; y: number } | null = null
        for (let i = pathData.length - 1; i >= 0; i--) {
          const cmd = pathData[i]
          if (cmd[0] === 'L') { lastPt = txPt(cmd[1] as number, cmd[2] as number); break }
          if (cmd[0] === 'C') { lastPt = txPt(cmd[5] as number, cmd[6] as number); break }
          if (cmd[0] === 'Q') { lastPt = txPt(cmd[3] as number, cmd[4] as number); break }
          if (cmd[0] === 'M' && i === pathData.length - 1) { lastPt = txPt(cmd[1] as number, cmd[2] as number); break }
        }

        if (!firstPt || !lastPt) return

        const distToFirst = Math.hypot(clickCanvas.x - firstPt.x, clickCanvas.y - firstPt.y)
        const distToLast = Math.hypot(clickCanvas.x - lastPt.x, clickCanvas.y - lastPt.y)
        const endpointIndex: 0 | -1 = distToFirst < distToLast ? 0 : -1

        // Obtener todos los otros objetos del canvas
        const otherObjects = canvas.getObjects()
          .filter(o => o !== target && getCustomProp(o, NON_INTERACTIVE_KEY) !== true)

        const newPathData = extendPathToIntersection(target, endpointIndex, otherObjects)
        if (newPathData) {
          target.path = newPathData as unknown as Path['path']
          ;(target as unknown as { setDimensions(): void }).setDimensions()
          target.setCoords()

          pushToHistory()
          useGCodeStore.getState().setGCodeNeedsRegeneration(true)
          canvas.requestRenderAll()
        }
      }
      handleMouseMove = () => { }
      handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          setExtendMode(false)
        }
      }
    } else {
      handleMouseDown = () => {}
      handleMouseMove = () => {}
      handleKeyDown = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelAll() } }
    }

    canvas.on('mouse:down', handleMouseDown)
    canvas.on('mouse:move', handleMouseMove)
    if (handleMouseUp) canvas.on('mouse:up', handleMouseUp)
    if (handleDblClick) canvas.on('mouse:dblclick', handleDblClick)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      canvas.off('mouse:down', handleMouseDown)
      canvas.off('mouse:move', handleMouseMove)
      if (handleMouseUp) canvas.off('mouse:up', handleMouseUp)
      if (handleDblClick) canvas.off('mouse:dblclick', handleDblClick)
      window.removeEventListener('keydown', handleKeyDown)
      clearSnapFeedback()
      canvas.requestRenderAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drawingMode, measuringMode, trimMode, extendMode])
  // ------------------------------------------
  // Recoloca el overlay sobre el tramo recien editado
  const repositionDrawingOverlay = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas || drawingPoints.length < 2) return
    const prev = drawingPoints[drawingPoints.length - 2]
    const curr = drawingPoints[drawingPoints.length - 1]
    const vpt = canvas.viewportTransform!
    const zoom = canvas.getZoom()
    setDistanceOverlay(o => o ? {
      ...o,
      screenX: ((prev.x + curr.x) / 2) * zoom + vpt[4],
      screenY: ((prev.y + curr.y) / 2) * zoom + vpt[5] - 30,
    } : null)
    canvas.requestRenderAll()
  }, [])

  // Handle distance input change — adjust last point in real time
  // ------------------------------------------
  const handleDistanceChange = useCallback((newValue: string) => {
    setDistanceOverlay(prev => prev ? { ...prev, valueMm: newValue } : null)

    const num = parseFloat(newValue)
    if (isNaN(num) || num <= 0 || drawingPoints.length < 2) return

    const prev = drawingPoints[drawingPoints.length - 2]
    const curr = drawingPoints[drawingPoints.length - 1]
    const dx = curr.x - prev.x
    const dy = curr.y - prev.y
    const currentDist = Math.sqrt(dx * dx + dy * dy)
    if (currentDist === 0) return

    const newDistPx = num * PIXELS_PER_MM
    const scale = newDistPx / currentDist
    drawingPoints[drawingPoints.length - 1] = {
      x: prev.x + dx * scale,
      y: prev.y + dy * scale,
    }

    repositionDrawingOverlay()
  }, [])

  // ------------------------------------------
  // Handle angle input change — rota el ultimo tramo manteniendo su largo
  // ------------------------------------------
  const handleAngleChange = useCallback((newValue: string) => {
    setDistanceOverlay(prev => prev ? { ...prev, angleDeg: newValue } : null)

    const deg = parseFloat(newValue)
    if (isNaN(deg) || drawingPoints.length < 2) return

    const prev = drawingPoints[drawingPoints.length - 2]
    const curr = drawingPoints[drawingPoints.length - 1]
    const len = distancePxBetween(prev, curr)
    if (len === 0) return

    // Grados CAD (Y hacia arriba) -> radianes de canvas (Y hacia abajo)
    const rad = (-deg * Math.PI) / 180
    drawingPoints[drawingPoints.length - 1] = {
      x: prev.x + Math.cos(rad) * len,
      y: prev.y + Math.sin(rad) * len,
    }

    repositionDrawingOverlay()
  }, [])


  // ------------------------------------------
  // Apply cota edit — adjust object dimension
  // ------------------------------------------
  const applyCotaEdit = useCallback((value: string) => {
    const num = parseFloat(value)
    if (!cotaEdit || isNaN(num) || num <= 0) {
      setCotaEdit(null)
      return
    }

    const { cota } = cotaEdit

    if (cota.editType === 'polyline-segment') {
      const element = useCanvasStore.getState().findElementById(cota.elementId)
      if (!element?.makerParams) { setCotaEdit(null); return }

      const ptsX = [...(element.makerParams.pointsX as number[])]
      const ptsY = [...(element.makerParams.pointsY as number[])]
      const i = cota.editIndex
      const ni = (i + 1) % ptsX.length

      const dx = ptsX[ni] - ptsX[i]
      const dy = ptsY[ni] - ptsY[i]
      const oldDist = Math.sqrt(dx * dx + dy * dy)
      if (oldDist === 0) { setCotaEdit(null); return }

      const scale = num / oldDist
      const newX = ptsX[i] + dx * scale
      const newY = ptsY[i] + dy * scale
      // Chain-shift: move all points from ni onwards by delta
      const deltaX = newX - ptsX[ni]
      const deltaY = newY - ptsY[ni]

      const isClosed = Number(element.makerParams.closed ?? 0)
      if (isClosed) {
        // For closed shapes, only adjust the target point
        ptsX[ni] = +newX.toFixed(3)
        ptsY[ni] = +newY.toFixed(3)
      } else {
        for (let j = ni; j < ptsX.length; j++) {
          ptsX[j] = +(ptsX[j] + deltaX).toFixed(3)
          ptsY[j] = +(ptsY[j] + deltaY).toFixed(3)
        }
      }

      cm.updateMakerParams(cota.elementId, { pointsX: ptsX, pointsY: ptsY })
    } else if (cota.editType === 'width') {
      cm.applyObjectProps('width', num)
    } else if (cota.editType === 'height') {
      cm.applyObjectProps('height', num)
    } else if (cota.editType === 'diameter') {
      const canvas = fabricRef.current
      const active = canvas?.getActiveObject()
      if (active instanceof Circle) {
        const r = active.radius ?? 1
        const newRadiusPx = (num * PIXELS_PER_MM) / 2
        const newScale = newRadiusPx / r
        active.set({ scaleX: newScale, scaleY: newScale })
        active.setCoords()
        canvas?.requestRenderAll()
        pushToHistory()
      }
    }

    setCotaEdit(null)
  }, [cotaEdit, cm])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu.visible) return
    const handleClick = () => closeContextMenu()
    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu', handleClick)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu', handleClick)
    }
  }, [contextMenu.visible, closeContextMenu])

  const handleContextAction = useCallback((action: () => void) => {
    action()
    closeContextMenu()
  }, [closeContextMenu])

  return (
    <div ref={containerRef} className="canvas-container w-full h-full relative">
      <canvas ref={canvasElRef} />

      {/* Distance input overlay for drawing mode */}
      {distanceOverlay && (
        <div
          className="absolute z-50 flex items-center gap-1 bg-background/95 backdrop-blur-sm border rounded px-2 py-1 shadow-md"
          style={{
            left: distanceOverlay.screenX,
            top: distanceOverlay.screenY,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <input
            ref={distanceInputRef}
            type="number"
            step="0.1"
            min="0"
            title={t('distanceMm')}
            className="w-20 h-6 text-xs text-center bg-transparent border rounded px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={distanceOverlay.valueMm}
            onChange={(e) => handleDistanceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                distanceInputRef.current?.blur()
              } else if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault()
                angleInputRef.current?.select()
              }
              e.stopPropagation()
            }}
          />
          <span className="text-xs text-muted-foreground">mm</span>
          <input
            ref={angleInputRef}
            type="number"
            step="1"
            title={t('angleDeg')}
            className="w-16 h-6 text-xs text-center bg-transparent border rounded px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={distanceOverlay.angleDeg}
            onChange={(e) => handleAngleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                angleInputRef.current?.blur()
              } else if (e.key === 'Tab' && e.shiftKey) {
                e.preventDefault()
                distanceInputRef.current?.select()
              }
              e.stopPropagation()
            }}
          />
          <span className="text-xs text-muted-foreground">°</span>
        </div>
      )}

      {/* Cota inline edit overlay */}
      {cotaEdit && (
        <div
          className="absolute z-50 flex items-center gap-1 bg-background border rounded px-2 py-1 shadow-lg"
          style={{
            left: cotaEdit.screenX,
            top: cotaEdit.screenY,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <input
            ref={cotaInputRef}
            type="number"
            step="0.1"
            min="0"
            className="w-24 h-7 text-sm text-center bg-transparent border rounded px-1 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={cotaEdit.valueMm}
            onChange={(e) => setCotaEdit(prev => prev ? { ...prev, valueMm: e.target.value } : null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyCotaEdit(cotaEdit.valueMm)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setCotaEdit(null)
              }
              e.stopPropagation()
            }}
            onBlur={() => applyCotaEdit(cotaEdit.valueMm)}
          />
          <span className="text-xs text-muted-foreground font-medium">mm</span>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="absolute z-50 min-w-[180px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Selection */}
          <ContextMenuItem label={`${t('selectAll')}  Ctrl+A`} onClick={() => handleContextAction(cm.selectAll)} />

          {contextMenu.hasSelection && (
            <>
              <div className="h-px bg-border my-1" />

              {/* Seleccionar similares */}
              <ContextMenuItem label={t('selectSameType')} onClick={() => handleContextAction(() => cm.selectSimilar('type'))} />
              <ContextMenuItem label={t('selectSameLayer')} onClick={() => handleContextAction(() => cm.selectSimilar('layer'))} />
              <ContextMenuItem label={t('selectSameColor')} onClick={() => handleContextAction(() => cm.selectSimilar('color'))} />

              <div className="h-px bg-border my-1" />

              {/* Edit */}
              <ContextMenuItem label={`${t('copy')}  Ctrl+C`} onClick={() => handleContextAction(cm.copySelected)} />
              <ContextMenuItem label={`${t('paste')}  Ctrl+V`} onClick={() => handleContextAction(cm.paste)} />
              <ContextMenuItem label={`${t('duplicate')}  Ctrl+D`} onClick={() => handleContextAction(cm.duplicateSelected)} />
              <ContextMenuItem label={`${t('delete')}  Supr`} onClick={() => handleContextAction(cm.deleteSelected)} destructive />

              <div className="h-px bg-border my-1" />

              {/* Group */}
              {contextMenu.hasMultiSelection && (
                <ContextMenuItem label={`${t('group')}  Ctrl+G`} onClick={() => handleContextAction(cm.groupSelected)} />
              )}
              {contextMenu.isGroup && (
                <ContextMenuItem label={`${t('ungroup')}  Ctrl+Shift+G`} onClick={() => handleContextAction(cm.ungroupSelected)} />
              )}
              {(contextMenu.hasMultiSelection || contextMenu.isGroup) && (
                <div className="h-px bg-border my-1" />
              )}

              {/* Boolean Operations */}
              {contextMenu.hasMultiSelection && (
                <>
                  <ContextMenuItem label={t('boolUnion')} onClick={() => handleContextAction(() => cm.booleanOperationSelected('union'))} />
                  <ContextMenuItem label={t('boolDifference')} onClick={() => handleContextAction(() => cm.booleanOperationSelected('difference'))} />
                  <ContextMenuItem label={t('boolIntersection')} onClick={() => handleContextAction(() => cm.booleanOperationSelected('intersection'))} />
                  <ContextMenuItem label={t('boolXor')} onClick={() => handleContextAction(() => cm.booleanOperationSelected('xor'))} />
                  <div className="h-px bg-border my-1" />
                </>
              )}

              {/* Z-Order */}              <ContextMenuItem label={`${t('bringToFront')}  Ctrl+Shift+]`} onClick={() => handleContextAction(cm.bringToFront)} />
              <ContextMenuItem label={`${t('bringForward')}  Ctrl+]`} onClick={() => handleContextAction(cm.bringForward)} />
              <ContextMenuItem label={`${t('sendBackward')}  Ctrl+[`} onClick={() => handleContextAction(cm.sendBackward)} />
              <ContextMenuItem label={`${t('sendToBack')}  Ctrl+Shift+[`} onClick={() => handleContextAction(cm.sendToBack)} />

              <div className="h-px bg-border my-1" />

              {/* Transform */}
              <ContextMenuItem label={t('flipH')} onClick={() => handleContextAction(cm.flipH)} />
              <ContextMenuItem label={t('flipV')} onClick={() => handleContextAction(cm.flipV)} />

              {/* Node editing */}
              {contextMenu.isPathOrPoly && (
                <>
                  <div className="h-px bg-border my-1" />
                  <ContextMenuItem
                    label={`${t('editNodes')}  Dbl-click`}
                    onClick={() => handleContextAction(() => {
                      const canvas = fabricRef.current
                      if (!canvas) return
                      const active = canvas.getActiveObject()
                      if (!active || !(active instanceof Path || active instanceof FabricPolygon)) return
                      const elId = getCustomProp(active, ELEMENT_ID_KEY)
                      if (typeof elId !== 'string') return
                      const data = extractNodes(active)
                      if (!data || data.nodes.length === 0) return
                      nodeEditData = data
                      nodeEditObject = active
                      active.selectable = false
                      active.evented = false
                      canvas.discardActiveObject()
                      canvas.selection = false
                      useCanvasStore.getState().setNodeEditing(elId)
                      canvas.requestRenderAll()
                    })}
                  />
                </>
              )}
            </>
          )}

          {!contextMenu.hasSelection && (
            <>
              <ContextMenuItem label={`${t('paste')}  Ctrl+V`} onClick={() => handleContextAction(cm.paste)} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ContextMenuItem({
  label,
  onClick,
  destructive,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-xs cursor-pointer hover:bg-accent hover:text-accent-foreground ${
        destructive ? 'text-destructive' : ''
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
