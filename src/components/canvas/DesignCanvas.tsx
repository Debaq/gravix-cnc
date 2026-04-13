import { useRef, useEffect, useCallback, useState } from 'react'
import { Canvas, Point, FabricObject, ActiveSelection, Group, Rect, Circle, Path, Ellipse, util } from 'fabric'
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
  GRID_SPACING_MM,
  GRID_MAJOR_EVERY,
  NON_INTERACTIVE_KEY,
  ELEMENT_ID_KEY,
  getCustomProp,
} from '@/hooks/useCanvasManager'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { arcFrom3Points, sampleCatmullRom } from '@/lib/geometry'

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

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  hasSelection: boolean
  hasMultiSelection: boolean
  isGroup: boolean
}

export function DesignCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const isPanning = useRef(false)
  const lastPanPoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, hasSelection: false, hasMultiSelection: false, isGroup: false,
  })

  const { t } = useTranslation('canvas')
  const { workArea, showGrid, selectElement, setSelectedElements, setIsGroupSelection } = useCanvasStore()
  const cm = useCanvasManager()
  const { setCanvas, updateSelectedObjectProps } = cm
  const drawingMode = useCanvasStore((s) => s.drawingMode)
  const setDrawingMode = useCanvasStore((s) => s.setDrawingMode)
  const [distanceOverlay, setDistanceOverlay] = useState<{
    screenX: number; screenY: number; valueMm: string
  } | null>(null)
  const distanceInputRef = useRef<HTMLInputElement>(null)
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

    // Fit view initially
    const workW = workArea.width * PIXELS_PER_MM + WORK_AREA_PADDING * 2
    const workH = workArea.height * PIXELS_PER_MM + WORK_AREA_PADDING * 2
    const zoom = Math.min(width / workW, height / workH) * 0.95
    const vpt: [number, number, number, number, number, number] = [
      zoom,
      0,
      0,
      zoom,
      (width - workW * zoom) / 2,
      (height - workH * zoom) / 2,
    ]
    canvas.setViewportTransform(vpt)

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
      canvas.requestRenderAll()
    })

    // ---- Event: Middle-click / Alt+click panning ----
    // Shift is reserved for multi-selection (Fabric.js default)
    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent
      if (evt.button === 1 || (evt.altKey && evt.button === 0)) {
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
      canvas.requestRenderAll()
    })

    canvas.on('mouse:up', () => {
      if (isPanning.current) {
        isPanning.current = false
        canvas.selection = true
        canvas.setCursor('default')
      }
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

      setContextMenu({
        visible: true,
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top,
        hasSelection,
        hasMultiSelection,
        isGroup: isGroupObj,
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
        const gridPx = GRID_SPACING_MM * PIXELS_PER_MM
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
          if (i % GRID_MAJOR_EVERY === 0) continue
          const x = ox + i * gridPx
          ctx.moveTo(x, oy); ctx.lineTo(x, oy + workH)
        }
        for (let i = 1; i <= totalRows; i++) {
          if (i % GRID_MAJOR_EVERY === 0) continue
          const y = oy + i * gridPx
          ctx.moveTo(ox, y); ctx.lineTo(ox + workW, y)
        }
        ctx.stroke()

        // Major lines
        ctx.strokeStyle = '#8B7BBF'
        ctx.lineWidth = 1 / z
        ctx.beginPath()
        for (let i = GRID_MAJOR_EVERY; i <= totalCols; i += GRID_MAJOR_EVERY) {
          const x = ox + i * gridPx
          ctx.moveTo(x, oy); ctx.lineTo(x, oy + workH)
        }
        for (let i = GRID_MAJOR_EVERY; i <= totalRows; i += GRID_MAJOR_EVERY) {
          const y = oy + i * gridPx
          ctx.moveTo(ox, y); ctx.lineTo(ox + workW, y)
        }
        ctx.stroke()
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

      ctx.restore()
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
      if (snapState.snapToGrid || snapState.snapToObjects) {
        const gridSpacingPx = GRID_SPACING_MM * PIXELS_PER_MM
        const snap = calculateSnap(
          canvas.getZoom(), obj,
          snapState.snapToGrid,
          snapState.snapToObjects,
          gridSpacingPx,
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
        if (snapState.snapToGrid || snapState.snapToObjects) {
          const gridSpacingPx = GRID_SPACING_MM * PIXELS_PER_MM
          const snap = calculateSnap(
            canvas.getZoom(), obj,
            snapState.snapToGrid,
            snapState.snapToObjects,
            gridSpacingPx,
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
      if (useCanvasStore.getState().drawingMode) return
      const cotasToCheck = activeCotas.length > 0 ? activeCotas : savedCotasForDblClick
      if (cotasToCheck.length === 0) return

      const evt = opt.e as MouseEvent
      const vpt = canvas.viewportTransform!
      const zoom = canvas.getZoom()
      const canvasX = (evt.offsetX - vpt[4]) / zoom
      const canvasY = (evt.offsetY - vpt[5]) / zoom

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

    // Save initial state to history
    pushToHistory()

    // ---- Resize Observer ----
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: newW, height: newH } = entry.contentRect
        if (newW > 0 && newH > 0) {
          canvas.setDimensions({ width: newW, height: newH })
          canvas.requestRenderAll()
        }
      }
    })
    observer.observe(container)

    // Cleanup
    return () => {
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
  // Drawing mode: setup/teardown event handlers
  // ------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    if (!drawingMode) {
      // Clean up drawing state when exiting
      if (drawingPoints.length > 0 || arcPoints.length > 0) {
        drawingPoints = []
        arcPoints = []
        drawingMousePos = null
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
    setDistanceOverlay(null)
    canvas.requestRenderAll()

    // Helpers shared by modes
    const getCanvasCoords = (evt: MouseEvent) => {
      const vpt = canvas.viewportTransform!
      const zoom = canvas.getZoom()
      return { x: (evt.offsetX - vpt[4]) / zoom, y: (evt.offsetY - vpt[5]) / zoom }
    }

    const cancelAll = () => {
      drawingPoints = []; arcPoints = []; drawingMousePos = null; drawingNearStart = false
      setDistanceOverlay(null); setDrawingMode(null); canvas.requestRenderAll()
    }

    let handleMouseDown: (opt: { e: Event }) => void
    let handleMouseMove: (opt: { e: Event }) => void
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
        const { x, y } = getCanvasCoords(evt)
        if (isNearFirstPoint(x, y)) { finishLine(true); return }
        drawingPoints.push({ x, y }); canvas.requestRenderAll(); showOverlay()
      }

      handleMouseMove = (opt) => {
        if (drawingPoints.length === 0) return
        const { x, y } = getCanvasCoords(opt.e as MouseEvent)
        drawingMousePos = { x, y }; drawingNearStart = isNearFirstPoint(x, y)
        canvas.requestRenderAll()
      }

      handleDblClick = () => {
        if (drawingPoints.length > 1) drawingPoints.pop()
        finishLine()
      }

      handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          if (document.activeElement === distanceInputRef.current) { distanceInputRef.current!.blur(); return }
          cancelAll()
        } else if (e.key === 'Enter') {
          if (document.activeElement === distanceInputRef.current) return
          e.preventDefault(); finishLine()
        }
      }
    } else if (drawingMode === 'arc') {
      // ===== ARC MODE (3 clicks) =====
      handleMouseDown = (opt) => {
        const evt = opt.e as MouseEvent
        if (evt.button !== 0 || evt.altKey) return
        const pt = getCanvasCoords(evt)
        arcPoints.push(pt)
        canvas.requestRenderAll()

        if (arcPoints.length === 3) {
          // Finish immediately
          cm.addArc(arcPoints[0], arcPoints[1], arcPoints[2])
          arcPoints = []; drawingMousePos = null; setDrawingMode(null)
        }
      }

      handleMouseMove = (opt) => {
        if (arcPoints.length === 0) return
        drawingMousePos = getCanvasCoords(opt.e as MouseEvent)
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
        const { x, y } = getCanvasCoords(evt)
        if (isNearFirst(x, y)) { finishBezier(true); return }
        drawingPoints.push({ x, y }); canvas.requestRenderAll()
      }

      handleMouseMove = (opt) => {
        if (drawingPoints.length === 0) return
        const { x, y } = getCanvasCoords(opt.e as MouseEvent)
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
    } else {
      handleMouseDown = () => {}
      handleMouseMove = () => {}
      handleKeyDown = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelAll() } }
    }

    canvas.on('mouse:down', handleMouseDown)
    canvas.on('mouse:move', handleMouseMove)
    if (handleDblClick) canvas.on('mouse:dblclick', handleDblClick)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      canvas.off('mouse:down', handleMouseDown)
      canvas.off('mouse:move', handleMouseMove)
      if (handleDblClick) canvas.off('mouse:dblclick', handleDblClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingMode])

  // ------------------------------------------
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

    const canvas = fabricRef.current
    if (canvas) {
      const newCurr = drawingPoints[drawingPoints.length - 1]
      const vpt = canvas.viewportTransform!
      const zoom = canvas.getZoom()
      const midX = ((prev.x + newCurr.x) / 2) * zoom + vpt[4]
      const midY = ((prev.y + newCurr.y) / 2) * zoom + vpt[5]
      setDistanceOverlay({ screenX: midX, screenY: midY - 30, valueMm: newValue })
      canvas.requestRenderAll()
    }
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
            className="w-20 h-6 text-xs text-center bg-transparent border rounded px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={distanceOverlay.valueMm}
            onChange={(e) => handleDistanceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                distanceInputRef.current?.blur()
              }
              e.stopPropagation()
            }}
          />
          <span className="text-xs text-muted-foreground">mm</span>
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

              {/* Z-Order */}
              <ContextMenuItem label={`${t('bringToFront')}  Ctrl+Shift+]`} onClick={() => handleContextAction(cm.bringToFront)} />
              <ContextMenuItem label={`${t('bringForward')}  Ctrl+]`} onClick={() => handleContextAction(cm.bringForward)} />
              <ContextMenuItem label={`${t('sendBackward')}  Ctrl+[`} onClick={() => handleContextAction(cm.sendBackward)} />
              <ContextMenuItem label={`${t('sendToBack')}  Ctrl+Shift+[`} onClick={() => handleContextAction(cm.sendToBack)} />

              <div className="h-px bg-border my-1" />

              {/* Transform */}
              <ContextMenuItem label={t('flipH')} onClick={() => handleContextAction(cm.flipH)} />
              <ContextMenuItem label={t('flipV')} onClick={() => handleContextAction(cm.flipV)} />
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
