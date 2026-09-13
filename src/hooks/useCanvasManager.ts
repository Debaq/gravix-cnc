import { useCallback, useRef } from 'react'
import {
  Canvas,
  Rect,
  Circle,
  Ellipse,
  Line,
  Path,
  Polygon as FabricPolygon,
  Group,
  FabricObject,
  FabricImage,
  FabricText,
  ActiveSelection,
  loadSVGFromString,
  Point,
  util,
} from 'fabric'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { invalidateSnapCache } from '@/lib/snap-engine'
import type { CanvasElement, GCodePath, GCodeJob, Point2D } from '@/lib/types'
import { isTauri } from '@/lib/tauri'
import { useAppStore } from '@/stores/useAppStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { linearizeCubicBezier, linearizeQuadraticBezier, arcFrom3Points, catmullRomToCubicBezier } from '@/lib/geometry'
import { booleanOperation } from '@/lib/boolean-ops'
import { autoJoinPaths, removeTinySpans, removeDuplicatePaths } from '@/lib/vector-diagnostics'
import { offsetPolygon } from '@/lib/geometry'
import { parseDxf, dxfToFabricObjects } from '@/lib/dxf-parser'

// ============================================
// Shared canvas reference for cross-component access
// ============================================
let sharedCanvasRef: Canvas | null = null

export function getSharedCanvas(): Canvas | null {
  return sharedCanvasRef
}

export function setSharedCanvas(canvas: Canvas | null): void {
  sharedCanvasRef = canvas
}

// ============================================
// Constants
// ============================================
const PIXELS_PER_MM = 3.78 // ~96 DPI -> 3.78 px/mm
const GRID_SPACING_MM = 20
const GRID_MAJOR_EVERY = 5 // linea gruesa cada 5 * 20mm = 100mm
const WORK_AREA_PADDING = 40 // px padding around work area
const MIN_ZOOM = 0.1
const MAX_ZOOM = 20
const ZOOM_STEP = 1.1

// Custom property keys stored on fabric objects
const ELEMENT_ID_KEY = '_elementId'
const NON_INTERACTIVE_KEY = '_nonInteractive'

// ============================================
// Helper: set/get custom property on FabricObject
// We cast through unknown to bypass TS index signature check
// ============================================
function setCustomProp(obj: FabricObject, key: string, value: unknown): void {
  ;(obj as unknown as Record<string, unknown>)[key] = value
}

function getCustomProp(obj: FabricObject, key: string): unknown {
  return (obj as unknown as Record<string, unknown>)[key]
}

// ============================================
// Helper: mark gcode as stale after canvas changes
// ============================================
function markGCodeStale(): void {
  const state = useGCodeStore.getState()
  if (state.gcodeGenerated) {
    state.setGCodeNeedsRegeneration(true)
  }
}

// ============================================
// Helper: generate unique ID
// ============================================
function generateId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// ============================================
// Helper: get origin position in pixels
// ============================================
function getOriginPixels(
  origin: string,
  workW: number,
  workH: number,
  offsetX: number,
  offsetY: number,
): { x: number; y: number } {
  switch (origin) {
    case 'top-left':
      return { x: offsetX, y: offsetY }
    case 'top-center':
      return { x: offsetX + workW / 2, y: offsetY }
    case 'top-right':
      return { x: offsetX + workW, y: offsetY }
    case 'center-left':
      return { x: offsetX, y: offsetY + workH / 2 }
    case 'center':
      return { x: offsetX + workW / 2, y: offsetY + workH / 2 }
    case 'center-right':
      return { x: offsetX + workW, y: offsetY + workH / 2 }
    case 'bottom-left':
      return { x: offsetX, y: offsetY + workH }
    case 'bottom-center':
      return { x: offsetX + workW / 2, y: offsetY + workH }
    case 'bottom-right':
      return { x: offsetX + workW, y: offsetY + workH }
    default:
      return { x: offsetX, y: offsetY + workH }
  }
}

// ============================================
// Helper: generate regular polygon points
// ============================================
function regularPolygonPoints(
  sides: number,
  radius: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2
    pts.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
  }
  return pts
}

// ============================================
// Helper: generate star points
// ============================================
function starPoints(
  numPoints: number,
  outerR: number,
  innerR: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < numPoints * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (Math.PI * i) / numPoints - Math.PI / 2
    pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) })
  }
  return pts
}

// ============================================
// Helper: bolt positions for rectangular bolt pattern
// ============================================
function boltRectPositions(
  w: number,
  h: number,
  inset: number,
  count: number,
): { x: number; y: number }[] {
  const TL = { x: -w / 2 + inset, y: -h / 2 + inset }
  const TR = { x: w / 2 - inset, y: -h / 2 + inset }
  const BL = { x: -w / 2 + inset, y: h / 2 - inset }
  const BR = { x: w / 2 - inset, y: h / 2 - inset }
  const TC = { x: 0, y: -h / 2 + inset }
  const BC = { x: 0, y: h / 2 - inset }
  const LC = { x: -w / 2 + inset, y: 0 }
  const RC = { x: w / 2 - inset, y: 0 }
  const CC = { x: 0, y: 0 }

  switch (count) {
    case 1:  return [CC]
    case 2:  return [LC, RC]
    case 3:  return [LC, RC, CC]
    case 4:  return [TL, TR, BL, BR]
    case 5:  return [TL, TR, BL, BR, CC]
    case 6:  return [TL, TR, BL, BR, TC, BC]
    case 7:  return [TL, TR, BL, BR, TC, BC, CC]
    case 8:  return [TL, TR, BL, BR, TC, BC, LC, RC]
    case 9:  return [TL, TR, BL, BR, TC, BC, LC, RC, CC]
    default: return [TL, TR, BL, BR]
  }
}

// ============================================
// Find next free position near the work area origin
// ============================================
const PLACEMENT_GAP = 3 * PIXELS_PER_MM // 3mm gap

function findNextFreePosition(
  canvas: Canvas,
  objWidthPx: number,
  objHeightPx: number,
): { left: number; top: number } {
  const { workArea } = useCanvasStore.getState()
  const workWPx = workArea.width * PIXELS_PER_MM
  const workHPx = workArea.height * PIXELS_PER_MM

  const areaLeft = WORK_AREA_PADDING
  const areaTop = WORK_AREA_PADDING
  const areaRight = WORK_AREA_PADDING + workWPx
  const areaBottom = WORK_AREA_PADDING + workHPx

  const origin = workArea.origin || 'bottom-left'

  // Growth direction: away from origin
  const growRight = !origin.includes('right')
  const growDown =
    origin.includes('top') ||
    origin === 'center' ||
    origin === 'center-left' ||
    origin === 'center-right'

  // Starting position near origin with gap from edges
  let startLeft: number
  let startTop: number

  if (origin.includes('right')) {
    startLeft = areaRight - objWidthPx - PLACEMENT_GAP
  } else {
    startLeft = areaLeft + PLACEMENT_GAP
  }

  if (origin.includes('bottom')) {
    startTop = areaBottom - objHeightPx - PLACEMENT_GAP
  } else if (
    origin === 'center' ||
    origin === 'center-left' ||
    origin === 'center-right'
  ) {
    startTop = areaTop + workHPx / 2 - objHeightPx / 2
  } else {
    startTop = areaTop + PLACEMENT_GAP
  }

  // Existing user objects bounding rects
  const existingRects = canvas
    .getObjects()
    .filter((o) => getCustomProp(o, NON_INTERACTIVE_KEY) !== true)
    .map((o) => {
      const b = o.getBoundingRect()
      return { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height }
    })

  if (existingRects.length === 0) {
    return { left: startLeft, top: startTop }
  }

  const hasOverlap = (l: number, t: number): boolean => {
    const r = l + objWidthPx
    const b = t + objHeightPx
    return existingRects.some(
      (e) =>
        l < e.right + PLACEMENT_GAP &&
        r > e.left - PLACEMENT_GAP &&
        t < e.bottom + PLACEMENT_GAP &&
        b > e.top - PLACEMENT_GAP,
    )
  }

  const inBounds = (l: number, t: number): boolean =>
    l >= areaLeft &&
    t >= areaTop &&
    l + objWidthPx <= areaRight &&
    t + objHeightPx <= areaBottom

  if (!hasOverlap(startLeft, startTop)) {
    return { left: startLeft, top: startTop }
  }

  // Scan for free position row by row
  let curLeft = startLeft
  let curTop = startTop

  for (let row = 0; row < 50; row++) {
    curLeft = startLeft

    for (let col = 0; col < 50; col++) {
      if (inBounds(curLeft, curTop) && !hasOverlap(curLeft, curTop)) {
        return { left: curLeft, top: curTop }
      }

      // Advance past overlapping object horizontally
      let advanced = false
      for (const e of existingRects) {
        const overlapping =
          curLeft < e.right + PLACEMENT_GAP &&
          curLeft + objWidthPx > e.left - PLACEMENT_GAP &&
          curTop < e.bottom + PLACEMENT_GAP &&
          curTop + objHeightPx > e.top - PLACEMENT_GAP

        if (overlapping) {
          curLeft = growRight
            ? e.right + PLACEMENT_GAP
            : e.left - objWidthPx - PLACEMENT_GAP
          advanced = true
          break
        }
      }

      if (!advanced || !inBounds(curLeft, curTop)) break
    }

    // Move to next row
    const rowObjects = existingRects.filter(
      (e) =>
        curTop < e.bottom + PLACEMENT_GAP &&
        curTop + objHeightPx > e.top - PLACEMENT_GAP,
    )

    if (growDown) {
      const edge = rowObjects.reduce((max, e) => Math.max(max, e.bottom), curTop)
      curTop = edge + PLACEMENT_GAP
    } else {
      const edge = rowObjects.reduce(
        (min, e) => Math.min(min, e.top),
        curTop + objHeightPx,
      )
      curTop = edge - objHeightPx - PLACEMENT_GAP
    }

    if (!inBounds(startLeft, curTop)) break
  }

  // Fallback: origin position even if overlapping
  return { left: startLeft, top: startTop }
}

// ============================================
// Build work area background objects (non-interactive)
// ============================================
export function buildWorkAreaObjects(
  workAreaWidth: number,
  workAreaHeight: number,
  origin: string,
  showGrid: boolean,
): FabricObject[] {
  const objects: FabricObject[] = []
  const workW = workAreaWidth * PIXELS_PER_MM
  const workH = workAreaHeight * PIXELS_PER_MM
  const offsetX = WORK_AREA_PADDING
  const offsetY = WORK_AREA_PADDING

  // Work area background
  const bg = new Rect({
    left: offsetX,
    top: offsetY,
    width: workW,
    height: workH,
    fill: 'rgba(255, 255, 255, 0.85)',
    stroke: '#5B4B9F',
    strokeWidth: 2,
    selectable: false,
    evented: false,
    hoverCursor: 'default',
  })
  setCustomProp(bg, NON_INTERACTIVE_KEY, true)
  objects.push(bg)

  // Grid is drawn natively via drawGrid() in DesignCanvas after:render
  // No Fabric objects needed — see DesignCanvas.tsx

  // Origin marker
  const originPos = getOriginPixels(origin, workW, workH, offsetX, offsetY)
  const axisLen = 30

  // X axis (red)
  const xAxis = new Line(
    [originPos.x, originPos.y, originPos.x + axisLen, originPos.y],
    {
      stroke: '#FF0000',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      hoverCursor: 'default',
    },
  )
  setCustomProp(xAxis, NON_INTERACTIVE_KEY, true)
  objects.push(xAxis)

  // Y axis (green) — Y+ goes UP in CNC, but canvas Y goes down
  const yAxis = new Line(
    [originPos.x, originPos.y, originPos.x, originPos.y - axisLen],
    {
      stroke: '#00CC00',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      hoverCursor: 'default',
    },
  )
  setCustomProp(yAxis, NON_INTERACTIVE_KEY, true)
  objects.push(yAxis)

  // Origin dot (yellow)
  const originDot = new Circle({
    left: originPos.x - 5,
    top: originPos.y - 5,
    radius: 5,
    fill: '#FFD700',
    stroke: '#2D1B69',
    strokeWidth: 2,
    selectable: false,
    evented: false,
    hoverCursor: 'default',
  })
  setCustomProp(originDot, NON_INTERACTIVE_KEY, true)
  objects.push(originDot)

  return objects
}

// ============================================
// Undo / Redo History (module-level)
// ============================================
interface HistoryEntry {
  fabricJSON: string
  storeElements: string
  selectedElementId: string | null
}

const historyStack: HistoryEntry[] = []
let historyIndex = -1
const MAX_HISTORY = 50
let isRestoring = false

export function pushToHistory(): void {
  // Toda mutacion pasa por aca, asi que es el punto natural para tirar el
  // indice de snaps (booleanas, offset, arrays, nodos, trim/extend, undo...)
  invalidateSnapCache()

  if (isRestoring) return
  const canvas = sharedCanvasRef
  if (!canvas) return

  // Truncate future entries
  historyStack.splice(historyIndex + 1)

  const fabricJSON = JSON.stringify(
    (canvas as unknown as { toJSON(props: string[]): object }).toJSON([ELEMENT_ID_KEY, NON_INTERACTIVE_KEY]),
  )
  const state = useCanvasStore.getState()
  const storeElements = JSON.stringify(state.elements, (key, val) =>
    key === 'fabricObject' ? undefined : val,
  )

  historyStack.push({
    fabricJSON,
    storeElements,
    selectedElementId: state.selectedElementId,
  })

  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift()
  }
  historyIndex = historyStack.length - 1
}

export function canUndo(): boolean {
  return historyIndex > 0
}

export function canRedo(): boolean {
  return historyIndex < historyStack.length - 1
}

export function clearHistory(): void {
  historyStack.length = 0
  historyIndex = -1
}

// ============================================
// Internal clipboard (module-level)
// ============================================
let clipboardObjectJSON: object | null = null
let clipboardElementData: Omit<CanvasElement, 'fabricObject'> | null = null

// ============================================
// Hook: useCanvasManager
// ============================================

/**
 * Aplica una propiedad (x/y/width/height/angle en mm o grados) sobre el objeto,
 * respetando el anclaje que corresponde al origen configurado.
 * No toca historial ni render: eso lo hace quien llama.
 */
function applyObjectPropRaw(active: FabricObject, prop: string, value: number): void {
    const wa = useCanvasStore.getState().workArea
    const originPos = getOriginPixels(
      wa.origin,
      wa.width * PIXELS_PER_MM,
      wa.height * PIXELS_PER_MM,
      WORK_AREA_PADDING,
      WORK_AREA_PADDING,
    )
    const flipY = wa.origin.startsWith('bottom')

    switch (prop) {
      case 'x':
        active.set('left', value * PIXELS_PER_MM + originPos.x)
        break
      case 'y': {
        const bounds = active.getBoundingRect()
        if (flipY) {
          active.set('top', originPos.y - value * PIXELS_PER_MM - bounds.height)
        } else {
          active.set('top', value * PIXELS_PER_MM + originPos.y)
        }
        break
      }
      case 'width': {
        // Use geometric width (not bounding rect which includes stroke)
        const geomW = (active.width ?? 0) * (active.scaleX ?? 1)
        const currentWMm = geomW / PIXELS_PER_MM
        if (currentWMm > 0) {
          const boundsW = active.getBoundingRect()
          const rightEdge = (active.left ?? 0) + boundsW.width
          const scale = value / currentWMm
          active.set('scaleX', (active.scaleX ?? 1) * scale)
          active.setCoords()
          if (wa.origin.endsWith('right')) {
            const newW = active.getBoundingRect().width
            active.set('left', rightEdge - newW)
          } else if (wa.origin.endsWith('center') || wa.origin === 'center') {
            const newW = active.getBoundingRect().width
            active.set('left', (active.left ?? 0) - (newW - boundsW.width) / 2)
          }
        }
        break
      }
      case 'height': {
        const geomH = (active.height ?? 0) * (active.scaleY ?? 1)
        const currentHMm = geomH / PIXELS_PER_MM
        if (currentHMm > 0) {
          const boundsH = active.getBoundingRect()
          const bottomEdge = (active.top ?? 0) + boundsH.height
          const scale = value / currentHMm
          active.set('scaleY', (active.scaleY ?? 1) * scale)
          active.setCoords()
          if (flipY) {
            const newH = active.getBoundingRect().height
            active.set('top', bottomEdge - newH)
          } else if (wa.origin.startsWith('center')) {
            const newH = active.getBoundingRect().height
            active.set('top', (active.top ?? 0) - (newH - boundsH.height) / 2)
          }
        }
        break
      }
      case 'angle':
        active.set('angle', value)
        break
    }

}

export function useCanvasManager() {
  // We use the module-level sharedCanvasRef so all hook instances share the same canvas
  const getCanvas = useCallback((): Canvas | null => sharedCanvasRef, [])

  const {
    addElement,
    removeElement,
    updateElement,
    selectElement,
    setSvgDimensions,
    setSelectedObjectProps,
    activeLayerId,
  } = useCanvasStore()

  // ------------------------------------------
  // Set canvas ref (called from DesignCanvas)
  // ------------------------------------------
  const setCanvas = useCallback((canvas: Canvas | null) => {
    setSharedCanvas(canvas)
  }, [])

  // ------------------------------------------
  // Load SVG from File
  // ------------------------------------------
  const loadSVG = useCallback(
    async (file: File) => {
      const canvas = getCanvas()
      if (!canvas) return

      const text = await file.text()
      const { objects, options } = await loadSVGFromString(text)

      const validObjects = objects.filter(
        (obj): obj is FabricObject => obj !== null,
      )

      if (validObjects.length === 0) return

      const group = util.groupSVGElements(validObjects, options)

      // Place the SVG near origin, avoiding existing objects
      const svgW = (group.width ?? 100) * (group.scaleX ?? 1)
      const svgH = (group.height ?? 100) * (group.scaleY ?? 1)
      const svgPos = findNextFreePosition(canvas, svgW, svgH)
      group.set({
        left: svgPos.left,
        top: svgPos.top,
      })

      const elementId = generateId()
      setCustomProp(group, ELEMENT_ID_KEY, elementId)

      canvas.add(group)
      canvas.setActiveObject(group)
      canvas.requestRenderAll()

      // Get bounding dimensions in mm
      const bounds = group.getBoundingRect()
      const widthMM = Math.round(bounds.width / PIXELS_PER_MM)
      const heightMM = Math.round(bounds.height / PIXELS_PER_MM)

      setSvgDimensions({ width: widthMM, height: heightMM, x: 0, y: 0 })

      // Create children from individual paths
      const children: CanvasElement[] = validObjects.map((obj, idx) => ({
        id: `${elementId}_child_${idx}`,
        type: 'svg' as const,
        name: `Path ${idx + 1}`,
        visible: true,
        locked: false,
        config: null,
        children: [],
        parent: elementId,
        fabricObject: obj,
      }))

      const element: CanvasElement = {
        id: elementId,
        type: 'svg',
        name: file.name.replace(/\.svg$/i, ''),
        visible: true,
        locked: false,
        config: null,
        children,
        svgData: text,
        fabricObject: group,
      }

      addElement(element)
      selectElement(elementId)
      pushToHistory()
      markGCodeStale()
    },
    [addElement, selectElement, setSvgDimensions],
  )

  const loadDXF = useCallback(
    async (file: File) => {
      const canvas = getCanvas()
      if (!canvas) return

      const text = await file.text()
      try {
        const entities = parseDxf(text)
        const objects = dxfToFabricObjects(entities)

        if (objects.length === 0) return

        const group = new Group(objects)
        const elementId = generateId()
        setCustomProp(group, ELEMENT_ID_KEY, elementId)

        const svgW = (group.width ?? 100) * (group.scaleX ?? 1)
        const svgH = (group.height ?? 100) * (group.scaleY ?? 1)
        const svgPos = findNextFreePosition(canvas, svgW, svgH)
        group.set({ left: svgPos.left, top: svgPos.top })

        const element: CanvasElement = {
          id: elementId,
          type: 'svg',
          name: file.name.replace(/\.dxf$/i, ''),
          visible: true,
          locked: false,
          config: null,
          children: [],
          fabricObject: group,
        }

        addElement(element)
        canvas.add(group)
        canvas.setActiveObject(group)
        canvas.requestRenderAll()
        pushToHistory()
        markGCodeStale()
      } catch (err) {
        console.error('Error loading DXF:', err)
      }
    },
    [addElement, pushToHistory],
  )

  // ------------------------------------------
  // Load Image for laser raster (uses Tauri native dialog)
  // ------------------------------------------
  const loadImage = useCallback(
    async () => {
      if (!isTauri()) return

      const { globalConfig, setGlobalConfig } = useCanvasStore.getState()
      const { openModal, addConsoleLine } = useAppStore.getState()

      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const result = await open({
          multiple: false,
          filters: [{
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'tiff', 'tif'],
          }],
        })

        if (!result) return

        const filePath = typeof result === 'string' ? result : String(result)
        sessionStorage.setItem('rasterImagePath', filePath)
        addConsoleLine(`Imagen: ${filePath}`)
      } catch (err) {
        addConsoleLine(`Error dialogo: ${err}`)
        return
      }

      if (globalConfig.operationType !== 'laser' || globalConfig.laserMode !== 'raster') {
        setGlobalConfig({ operationType: 'laser', laserMode: 'raster' })
      }

      openModal('imageWizard')
    },
    [],
  )

  // ------------------------------------------
  // Add processed raster image to canvas
  // ------------------------------------------
  const addRasterToCanvas = useCallback(
    async (previewBase64: string, name?: string) => {
      const canvas = getCanvas()
      if (!canvas) return

      const { workArea } = useCanvasStore.getState()

      const img = await FabricImage.fromURL(previewBase64)

      const workWPx = workArea.width * PIXELS_PER_MM
      const workHPx = workArea.height * PIXELS_PER_MM
      const imgW = img.width || 100
      const imgH = img.height || 100
      const scale = Math.min(workWPx / imgW, workHPx / imgH)

      const scaledW = imgW * scale
      const scaledH = imgH * scale
      const imgPos = findNextFreePosition(canvas, scaledW, scaledH)

      img.set({
        left: imgPos.left,
        top: imgPos.top,
        scaleX: scale,
        scaleY: scale,
      })

      const elementId = generateId()
      setCustomProp(img, ELEMENT_ID_KEY, elementId)

      canvas.add(img)
      canvas.setActiveObject(img)
      canvas.requestRenderAll()

      const element: CanvasElement = {
        id: elementId,
        type: 'svg',
        name: name || 'Raster',
        visible: true,
        locked: false,
        config: null,
        children: [],
        fabricObject: img,
      }

      addElement(element)
      selectElement(elementId)
      markGCodeStale()
    },
    [addElement, selectElement],
  )

  // ------------------------------------------
  // Add shape (basic + maker models)
  // ------------------------------------------
  const addShape = useCallback(
    (type: string) => {
      const canvas = getCanvas()
      if (!canvas) return

      const elementId = generateId()
      const defaultSize = 50 * PIXELS_PER_MM // 50mm
      const stroke = '#333333'
      const baseProps = { fill: 'transparent', stroke, strokeWidth: 1 }

      // Determine object dimensions for placement
      let objW = defaultSize
      let objH = defaultSize
      switch (type) {
        case 'roundRect':
        case 'slot':
          objH = defaultSize * 0.6
          break
        case 'ellipse':
          objH = defaultSize * 0.66
          break
        case 'dome':
          objH = defaultSize / 2
          break
      }

      const pos = findNextFreePosition(canvas, objW, objH)

      let fabricObj: FabricObject
      let isMaker = false
      let makerType: string | undefined
      let makerParams: Record<string, number> | undefined

      switch (type) {
        case 'rect':
          fabricObj = new Rect({
            left: pos.left,
            top: pos.top,
            width: defaultSize,
            height: defaultSize,
            ...baseProps,
          })
          break

        case 'square':
          fabricObj = new Rect({
            left: pos.left,
            top: pos.top,
            width: defaultSize,
            height: defaultSize,
            ...baseProps,
          })
          break

        case 'circle':
          fabricObj = new Circle({
            left: pos.left,
            top: pos.top,
            radius: defaultSize / 2,
            ...baseProps,
          })
          break

        case 'line':
          fabricObj = new Line(
            [pos.left, pos.top, pos.left + defaultSize, pos.top + defaultSize],
            { stroke, strokeWidth: 1 },
          )
          break

        case 'roundRect': {
          const cornerR = 8 * PIXELS_PER_MM
          fabricObj = new Rect({
            left: pos.left,
            top: pos.top,
            width: objW,
            height: objH,
            rx: cornerR,
            ry: cornerR,
            ...baseProps,
          })
          isMaker = true
          makerType = 'roundRect'
          makerParams = { width: 50, height: 30, cornerRadius: 8 }
          break
        }

        case 'ellipse': {
          fabricObj = new Ellipse({
            left: pos.left,
            top: pos.top,
            rx: objW / 2,
            ry: objH / 2,
            ...baseProps,
          })
          isMaker = true
          makerType = 'ellipse'
          makerParams = { rx: 25, ry: 16.5 }
          break
        }

        case 'ring': {
          const outerR = defaultSize / 2
          const innerR = outerR * 0.6
          // SVG path: outer circle CW + inner circle CCW (hole)
          const d =
            `M ${outerR},0 A ${outerR},${outerR} 0 1,1 -${outerR},0 A ${outerR},${outerR} 0 1,1 ${outerR},0 Z ` +
            `M ${innerR},0 A ${innerR},${innerR} 0 1,0 -${innerR},0 A ${innerR},${innerR} 0 1,0 ${innerR},0 Z`
          fabricObj = new Path(d, {
            left: pos.left,
            top: pos.top,
            ...baseProps,
          })
          isMaker = true
          makerType = 'ring'
          makerParams = { outerRadius: 25, innerRadius: 15 }
          break
        }

        case 'polygon': {
          const sides = 6
          const radius = defaultSize / 2
          const pts = regularPolygonPoints(sides, radius)
          fabricObj = new FabricPolygon(pts, {
            left: pos.left,
            top: pos.top,
            ...baseProps,
          })
          isMaker = true
          makerType = 'polygon'
          makerParams = { sides: 6, radius: 25 }
          break
        }

        case 'star': {
          const numPts = 5
          const outerR = defaultSize / 2
          const innerR = outerR * 0.4
          const pts = starPoints(numPts, outerR, innerR)
          fabricObj = new FabricPolygon(pts, {
            left: pos.left,
            top: pos.top,
            ...baseProps,
          })
          isMaker = true
          makerType = 'star'
          makerParams = { points: 5, outerRadius: 25, innerRadius: 10 }
          break
        }

        case 'slot': {
          // Stadium/slot shape: rounded ends
          const r = objH / 2
          const d =
            `M ${r},0 L ${objW - r},0 ` +
            `A ${r},${r} 0 0,1 ${objW - r},${objH} ` +
            `L ${r},${objH} ` +
            `A ${r},${r} 0 0,1 ${r},0 Z`
          fabricObj = new Path(d, {
            left: pos.left,
            top: pos.top,
            ...baseProps,
          })
          isMaker = true
          makerType = 'slot'
          makerParams = { width: 50, height: 30 }
          break
        }

        case 'dome': {
          const r = objW / 2
          const d = `M 0,${r} A ${r},${r} 0 0,1 ${objW},${r} L 0,${r} Z`
          fabricObj = new Path(d, {
            left: pos.left,
            top: pos.top,
            ...baseProps,
          })
          isMaker = true
          makerType = 'dome'
          makerParams = { radius: 25 }
          break
        }

        case 'boltCircle': {
          const mainR = defaultSize / 2
          const boltR = 3 * PIXELS_PER_MM
          const boltCount = 6
          const boltDist = mainR * 0.7
          const children: FabricObject[] = []
          // Main circle
          children.push(new Circle({ radius: mainR, originX: 'center', originY: 'center', ...baseProps }))
          // Bolt holes
          for (let i = 0; i < boltCount; i++) {
            const angle = (2 * Math.PI * i) / boltCount - Math.PI / 2
            children.push(
              new Circle({
                radius: boltR,
                left: boltDist * Math.cos(angle),
                top: boltDist * Math.sin(angle),
                originX: 'center',
                originY: 'center',
                ...baseProps,
              }),
            )
          }
          fabricObj = new Group(children, {
            left: pos.left,
            top: pos.top,
          })
          isMaker = true
          makerType = 'boltCircle'
          makerParams = { radius: 25, boltRadius: 3, boltCount: 6 }
          break
        }

        case 'boltRect': {
          const w = defaultSize
          const h = defaultSize
          const boltR = 3 * PIXELS_PER_MM
          const inset = 8 * PIXELS_PER_MM
          const boltCount = 4
          const children: FabricObject[] = []
          children.push(
            new Rect({ width: w, height: h, left: -w / 2, top: -h / 2, ...baseProps }),
          )
          for (const c of boltRectPositions(w, h, inset, boltCount)) {
            children.push(
              new Circle({
                radius: boltR,
                left: c.x,
                top: c.y,
                originX: 'center',
                originY: 'center',
                ...baseProps,
              }),
            )
          }
          fabricObj = new Group(children, {
            left: pos.left,
            top: pos.top,
          })
          isMaker = true
          makerType = 'boltRect'
          makerParams = { width: 50, height: 50, boltRadius: 3, inset: 8, boltCount: 4 }
          break
        }

        default:
          return
      }

      setCustomProp(fabricObj, ELEMENT_ID_KEY, elementId)

      // Maker shapes: disable scale handles — dimensions come from params
      if (isMaker) {
        fabricObj.set({ lockScalingX: true, lockScalingY: true })
        fabricObj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, tl: false, tr: false, bl: false, br: false })
      }

      canvas.add(fabricObj)
      canvas.setActiveObject(fabricObj)
      canvas.requestRenderAll()

      // Display names for each type
      const typeNames: Record<string, string> = {
        rect: 'Rect',
        square: 'Square',
        circle: 'Circle',
        line: 'Line',
        roundRect: 'RoundRect',
        ellipse: 'Ellipse',
        ring: 'Ring',
        polygon: 'Polygon',
        star: 'Star',
        slot: 'Slot',
        dome: 'Dome',
        boltCircle: 'BoltCircle',
        boltRect: 'BoltRect',
      }

      const element: CanvasElement = {
        id: elementId,
        type: isMaker ? 'maker' : (type as CanvasElement['type']),
        name: `${typeNames[type] || type} ${Date.now() % 1000}`,
        visible: true,
        locked: false,
        config: null,
        children: [],
        fabricObject: fabricObj,
        makerType,
        makerParams,
      }

      addElement(element)
      selectElement(elementId)
      pushToHistory()
      markGCodeStale()
    },
    [addElement, selectElement],
  )

  // ------------------------------------------
  // Add polyline from drawn points (pixel coords)
  // ------------------------------------------
  /**
   * Crea rect / circulo / elipse a partir del rectangulo que el usuario
   * arrastro en el lienzo (coordenadas canvas en px).
   */
  const addShapeAt = useCallback(
    (
      type: 'rect' | 'circle' | 'ellipse',
      box: { left: number; top: number; width: number; height: number },
    ) => {
      const canvas = getCanvas()
      if (!canvas) return
      if (box.width < 2 || box.height < 2) return

      const elementId = generateId()
      const baseProps = { fill: 'transparent', stroke: '#333333', strokeWidth: 1 }

      let fabricObj: FabricObject
      let makerType: string | undefined
      let makerParams: Record<string, number> | undefined

      if (type === 'circle') {
        const r = Math.min(box.width, box.height) / 2
        fabricObj = new Circle({ left: box.left, top: box.top, radius: r, ...baseProps })
      } else if (type === 'ellipse') {
        fabricObj = new Ellipse({
          left: box.left,
          top: box.top,
          rx: box.width / 2,
          ry: box.height / 2,
          ...baseProps,
        })
        makerType = 'ellipse'
        makerParams = {
          rx: +(box.width / 2 / PIXELS_PER_MM).toFixed(2),
          ry: +(box.height / 2 / PIXELS_PER_MM).toFixed(2),
        }
      } else {
        fabricObj = new Rect({
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          ...baseProps,
        })
      }

      setCustomProp(fabricObj, ELEMENT_ID_KEY, elementId)

      // Las formas parametricas se redimensionan por parametros, no por handles
      if (makerType) {
        fabricObj.set({ lockScalingX: true, lockScalingY: true })
        fabricObj.setControlsVisibility({
          ml: false, mr: false, mt: false, mb: false,
          tl: false, tr: false, bl: false, br: false,
        })
      }

      canvas.add(fabricObj)
      canvas.setActiveObject(fabricObj)
      canvas.requestRenderAll()

      const names: Record<string, string> = { rect: 'Rect', circle: 'Circle', ellipse: 'Ellipse' }
      const element: CanvasElement = {
        id: elementId,
        type: makerType ? 'maker' : (type as CanvasElement['type']),
        name: `${names[type]} ${Date.now() % 1000}`,
        visible: true,
        locked: false,
        config: null,
        children: [],
        fabricObject: fabricObj,
        makerType,
        makerParams,
      }

      addElement(element)
      selectElement(elementId)
      pushToHistory()
      markGCodeStale()
    },
    [addElement, selectElement],
  )

  const addPolyline = useCallback(
    (pixelPoints: { x: number; y: number }[], closed = false) => {
      const canvas = getCanvas()
      if (!canvas || pixelPoints.length < 2) return

      const elementId = generateId()

      // Store points in mm relative to first point
      const first = pixelPoints[0]
      const pointsX = pixelPoints.map(p => +((p.x - first.x) / PIXELS_PER_MM).toFixed(3))
      const pointsY = pixelPoints.map(p => +((p.y - first.y) / PIXELS_PER_MM).toFixed(3))

      // Build SVG path with absolute pixel coords
      let d = pixelPoints
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`)
        .join(' ')
      if (closed) d += ' Z'

      const fabricObj = new Path(d, {
        fill: 'transparent',
        stroke: '#333333',
        strokeWidth: 1,
        lockScalingX: true,
        lockScalingY: true,
      })
      fabricObj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, tl: false, tr: false, bl: false, br: false })

      setCustomProp(fabricObj, ELEMENT_ID_KEY, elementId)

      canvas.add(fabricObj)
      canvas.setActiveObject(fabricObj)
      canvas.requestRenderAll()

      const element: CanvasElement = {
        id: elementId,
        type: 'maker',
        name: `${closed ? 'Polygon' : 'Polyline'} ${Date.now() % 1000}`,
        visible: true,
        locked: false,
        config: null,
        children: [],
        fabricObject: fabricObj,
        makerType: 'polyline',
        makerParams: { pointsX, pointsY, closed: closed ? 1 : 0 },
      }

      addElement(element)
      selectElement(elementId)
      pushToHistory()
      markGCodeStale()
    },
    [addElement, selectElement],
  )

  // ------------------------------------------
  // Add arc from 3 pixel-coordinate points (start, mid, end)
  // ------------------------------------------
  const addArc = useCallback(
    (p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }) => {
      const canvas = getCanvas()
      if (!canvas) return

      const elementId = generateId()

      // Linearize arc through 3 points
      const arcPts = arcFrom3Points(p1, p2, p3)
      if (arcPts.length < 2) return

      // Store in mm relative to first point
      const first = arcPts[0]
      const startX = 0
      const startY = 0
      const midX = +((p2.x - first.x) / PIXELS_PER_MM).toFixed(3)
      const midY = +((p2.y - first.y) / PIXELS_PER_MM).toFixed(3)
      const endX = +((p3.x - first.x) / PIXELS_PER_MM).toFixed(3)
      const endY = +((p3.y - first.y) / PIXELS_PER_MM).toFixed(3)

      // Build path with absolute pixel coords
      const d = arcPts
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`)
        .join(' ')

      const fabricObj = new Path(d, {
        fill: 'transparent',
        stroke: '#333333',
        strokeWidth: 1,
        lockScalingX: true,
        lockScalingY: true,
      })
      fabricObj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, tl: false, tr: false, bl: false, br: false })

      setCustomProp(fabricObj, ELEMENT_ID_KEY, elementId)

      canvas.add(fabricObj)
      canvas.setActiveObject(fabricObj)
      canvas.requestRenderAll()

      const element: CanvasElement = {
        id: elementId,
        type: 'maker',
        name: `Arc ${Date.now() % 1000}`,
        visible: true,
        locked: false,
        config: null,
        children: [],
        fabricObject: fabricObj,
        makerType: 'arc',
        makerParams: { startX, startY, midX, midY, endX, endY },
      }

      addElement(element)
      selectElement(elementId)
      pushToHistory()
      markGCodeStale()
    },
    [addElement, selectElement],
  )

  // ------------------------------------------
  // Add bezier curve from pixel-coordinate anchor points
  // ------------------------------------------
  const addBezierCurve = useCallback(
    (pixelPoints: { x: number; y: number }[], closed = false) => {
      const canvas = getCanvas()
      if (!canvas || pixelPoints.length < 2) return

      const elementId = generateId()

      // Store anchor points in mm relative to first point
      const first = pixelPoints[0]
      const pointsX = pixelPoints.map(p => +((p.x - first.x) / PIXELS_PER_MM).toFixed(3))
      const pointsY = pixelPoints.map(p => +((p.y - first.y) / PIXELS_PER_MM).toFixed(3))

      // Generate cubic bezier segments via Catmull-Rom
      const segments = catmullRomToCubicBezier(pixelPoints, closed)

      // Build SVG path with C commands
      let d = `M ${pixelPoints[0].x.toFixed(2)},${pixelPoints[0].y.toFixed(2)}`
      for (const seg of segments) {
        d += ` C ${seg.cp1.x.toFixed(2)},${seg.cp1.y.toFixed(2)} ${seg.cp2.x.toFixed(2)},${seg.cp2.y.toFixed(2)} ${seg.end.x.toFixed(2)},${seg.end.y.toFixed(2)}`
      }
      if (closed) d += ' Z'

      const fabricObj = new Path(d, {
        fill: 'transparent',
        stroke: '#333333',
        strokeWidth: 1,
        lockScalingX: true,
        lockScalingY: true,
      })
      fabricObj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, tl: false, tr: false, bl: false, br: false })

      setCustomProp(fabricObj, ELEMENT_ID_KEY, elementId)

      canvas.add(fabricObj)
      canvas.setActiveObject(fabricObj)
      canvas.requestRenderAll()

      const element: CanvasElement = {
        id: elementId,
        type: 'maker',
        name: `${closed ? 'ClosedCurve' : 'Curve'} ${Date.now() % 1000}`,
        visible: true,
        locked: false,
        config: null,
        children: [],
        fabricObject: fabricObj,
        makerType: 'bezier',
        makerParams: { pointsX, pointsY, closed: closed ? 1 : 0 },
      }

      addElement(element)
      selectElement(elementId)
      pushToHistory()
      markGCodeStale()
    },
    [addElement, selectElement],
  )

  // ------------------------------------------
  // Add text converted to SVG path
  // ------------------------------------------
  const addTextPath = useCallback(
    (svgPathD: string, text: string, fontUrl: string, fontSizeMm: number, letterSpacing: number) => {
      const canvas = getCanvas()
      if (!canvas || !svgPathD) return

      const elementId = generateId()

      const fabricObj = new Path(svgPathD, {
        fill: 'transparent',
        stroke: '#333333',
        strokeWidth: 1,
        lockScalingX: true,
        lockScalingY: true,
      })
      fabricObj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, tl: false, tr: false, bl: false, br: false })

      // Position in next free slot
      const bounds = fabricObj.getBoundingRect()
      const pos = findNextFreePosition(canvas, bounds.width, bounds.height)
      fabricObj.set({ left: pos.left, top: pos.top })

      setCustomProp(fabricObj, ELEMENT_ID_KEY, elementId)

      canvas.add(fabricObj)
      canvas.setActiveObject(fabricObj)
      canvas.requestRenderAll()

      const element: CanvasElement = {
        id: elementId,
        type: 'maker',
        name: `Text "${text.slice(0, 12)}"`,
        visible: true,
        locked: false,
        config: null,
        children: [],
        fabricObject: fabricObj,
        makerType: 'text',
        makerParams: { text, fontUrl, fontSize: fontSizeMm, letterSpacing },
      }

      addElement(element)
      selectElement(elementId)
      pushToHistory()
      markGCodeStale()
    },
    [addElement, selectElement],
  )

  // ------------------------------------------
  // Remove object by element ID
  // ------------------------------------------
  const removeObject = useCallback(
    (elementId: string) => {
      const canvas = getCanvas()
      if (!canvas) return

      const obj = canvas
        .getObjects()
        .find((o) => getCustomProp(o, ELEMENT_ID_KEY) === elementId)

      if (obj) {
        canvas.remove(obj)
        canvas.requestRenderAll()
      }

      removeElement(elementId)
      pushToHistory()
      markGCodeStale()
    },
    [removeElement],
  )

  // ------------------------------------------
  // Toggle visibility
  // ------------------------------------------
  const toggleVisibility = useCallback(
    (elementId: string) => {
      const canvas = getCanvas()
      if (!canvas) return

      const currentElements = useCanvasStore.getState().elements
      const el = currentElements.find((e) => e.id === elementId)
      if (!el) return

      const newVisible = !el.visible

      const obj = canvas
        .getObjects()
        .find((o) => getCustomProp(o, ELEMENT_ID_KEY) === elementId)

      if (obj) {
        obj.set({ visible: newVisible })
        canvas.requestRenderAll()
      }

      updateElement(elementId, { visible: newVisible })
    },
    [updateElement],
  )

  // ------------------------------------------
  // Toggle lock
  // ------------------------------------------
  const toggleLock = useCallback(
    (elementId: string) => {
      const canvas = getCanvas()
      if (!canvas) return

      const currentElements = useCanvasStore.getState().elements
      const el = currentElements.find((e) => e.id === elementId)
      if (!el) return

      const newLocked = !el.locked

      const obj = canvas
        .getObjects()
        .find((o) => getCustomProp(o, ELEMENT_ID_KEY) === elementId)

      if (obj) {
        obj.set({
          selectable: !newLocked,
          evented: !newLocked,
          lockMovementX: newLocked,
          lockMovementY: newLocked,
          lockRotation: newLocked,
          lockScalingX: newLocked,
          lockScalingY: newLocked,
        })
        canvas.requestRenderAll()
      }

      updateElement(elementId, { locked: newLocked })
    },
    [updateElement],
  )

  // ------------------------------------------
  // Zoom controls
  // ------------------------------------------
  const zoomIn = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const currentZoom = canvas.getZoom()
    const newZoom = Math.min(currentZoom * ZOOM_STEP, MAX_ZOOM)
    const center = canvas.getCenterPoint()
    canvas.zoomToPoint(new Point(center.x, center.y), newZoom)
    canvas.requestRenderAll()
  }, [])

  const zoomOut = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const currentZoom = canvas.getZoom()
    const newZoom = Math.max(currentZoom / ZOOM_STEP, MIN_ZOOM)
    const center = canvas.getCenterPoint()
    canvas.zoomToPoint(new Point(center.x, center.y), newZoom)
    canvas.requestRenderAll()
  }, [])

  const fitView = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    const wa = useCanvasStore.getState().workArea
    const workW = wa.width * PIXELS_PER_MM + WORK_AREA_PADDING * 2
    const workH = wa.height * PIXELS_PER_MM + WORK_AREA_PADDING * 2

    const canvasW = canvas.getWidth()
    const canvasH = canvas.getHeight()

    const zoom = Math.min(canvasW / workW, canvasH / workH) * 0.95

    // Reset and re-center
    const vpt: [number, number, number, number, number, number] = [
      zoom,
      0,
      0,
      zoom,
      (canvasW - workW * zoom) / 2,
      (canvasH - workH * zoom) / 2,
    ]
    canvas.setViewportTransform(vpt)
    canvas.requestRenderAll()
  }, [])

  /** Zoom a la seleccion actual (o a todos los elementos si no hay seleccion). */
  const fitSelection = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    const active = canvas.getActiveObject()
    const targets = active
      ? [active]
      : canvas.getObjects().filter(o => getCustomProp(o, NON_INTERACTIVE_KEY) !== true && o.visible)

    if (targets.length === 0) {
      fitView()
      return
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const obj of targets) {
      const b = obj.getBoundingRect()
      minX = Math.min(minX, b.left)
      minY = Math.min(minY, b.top)
      maxX = Math.max(maxX, b.left + b.width)
      maxY = Math.max(maxY, b.top + b.height)
    }
    const w = maxX - minX
    const h = maxY - minY
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
      fitView()
      return
    }

    const margin = 40
    const canvasW = canvas.getWidth()
    const canvasH = canvas.getHeight()
    const zoom = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.min((canvasW - margin * 2) / w, (canvasH - margin * 2) / h)),
    )

    canvas.setViewportTransform([
      zoom, 0, 0, zoom,
      canvasW / 2 - (minX + w / 2) * zoom,
      canvasH / 2 - (minY + h / 2) * zoom,
    ])
    canvas.requestRenderAll()
  }, [fitView])

  // ------------------------------------------
  // Flip controls
  // ------------------------------------------
  const flipH = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    const active = canvas.getActiveObject()
    if (!active) return

    active.set({ flipX: !active.flipX })
    canvas.requestRenderAll()
    pushToHistory()
  }, [])

  const flipV = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    const active = canvas.getActiveObject()
    if (!active) return

    active.set({ flipY: !active.flipY })
    canvas.requestRenderAll()
    pushToHistory()
  }, [])

  // ------------------------------------------
  // Undo
  // ------------------------------------------
  const undo = useCallback(async () => {
    if (!canUndo() || isRestoring) return
    const canvas = getCanvas()
    if (!canvas) return

    isRestoring = true
    historyIndex--
    const entry = historyStack[historyIndex]

    await canvas.loadFromJSON(entry.fabricJSON)

    // Restore store elements
    const elements: CanvasElement[] = JSON.parse(entry.storeElements)
    useCanvasStore.getState().setElements(elements)
    useCanvasStore.getState().selectElement(entry.selectedElementId)

    canvas.requestRenderAll()
    isRestoring = false
  }, [])

  // ------------------------------------------
  // Redo
  // ------------------------------------------
  const redo = useCallback(async () => {
    if (!canRedo() || isRestoring) return
    const canvas = getCanvas()
    if (!canvas) return

    isRestoring = true
    historyIndex++
    const entry = historyStack[historyIndex]

    await canvas.loadFromJSON(entry.fabricJSON)

    // Restore store elements
    const elements: CanvasElement[] = JSON.parse(entry.storeElements)
    useCanvasStore.getState().setElements(elements)
    useCanvasStore.getState().selectElement(entry.selectedElementId)

    canvas.requestRenderAll()
    isRestoring = false
  }, [])

  // ------------------------------------------
  // Delete selected object(s)
  // ------------------------------------------
  const deleteSelected = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    const active = canvas.getActiveObject()
    if (!active) return

    if (active instanceof ActiveSelection) {
      const objects = active.getObjects()
      canvas.discardActiveObject()
      for (const obj of objects) {
        const elId = getCustomProp(obj, ELEMENT_ID_KEY)
        canvas.remove(obj)
        if (typeof elId === 'string') {
          removeElement(elId)
        }
      }
    } else {
      const elId = getCustomProp(active, ELEMENT_ID_KEY)
      canvas.remove(active)
      if (typeof elId === 'string') {
        removeElement(elId)
      }
    }

    canvas.discardActiveObject()
    canvas.requestRenderAll()
    selectElement(null)
    pushToHistory()
    markGCodeStale()
  }, [removeElement, selectElement])

  // ------------------------------------------
  // Duplicate selected object
  // ------------------------------------------
  const duplicateSelected = useCallback(async () => {
    const canvas = getCanvas()
    if (!canvas) return

    const active = canvas.getActiveObject()
    if (!active) return

    const clone = await active.clone([ELEMENT_ID_KEY])
    const newId = generateId()
    setCustomProp(clone, ELEMENT_ID_KEY, newId)
    clone.set({
      left: (clone.left ?? 0) + 20,
      top: (clone.top ?? 0) + 20,
    })

    canvas.add(clone)
    canvas.setActiveObject(clone)
    canvas.requestRenderAll()

    // Build element from original
    const originalId = getCustomProp(active, ELEMENT_ID_KEY)
    const originalEl =
      typeof originalId === 'string'
        ? useCanvasStore.getState().findElementById(originalId)
        : null

    const element: CanvasElement = {
      id: newId,
      type: originalEl?.type || 'rect',
      name: `${originalEl?.name || 'Element'} (copia)`,
      visible: true,
      locked: false,
      config: originalEl?.config ? { ...originalEl.config } : null,
      children: [],
      svgData: originalEl?.svgData,
      fabricObject: clone,
    }

    addElement(element)
    selectElement(newId)
    pushToHistory()
    markGCodeStale()
  }, [addElement, selectElement])

  // ------------------------------------------
  // Select all user objects
  // ------------------------------------------
  const selectAll = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    const userObjects = canvas
      .getObjects()
      .filter((o) => getCustomProp(o, NON_INTERACTIVE_KEY) !== true)

    if (userObjects.length === 0) return

    canvas.discardActiveObject()
    if (userObjects.length === 1) {
      canvas.setActiveObject(userObjects[0])
    } else {
      const selection = new ActiveSelection(userObjects, { canvas })
      canvas.setActiveObject(selection)
    }
    canvas.requestRenderAll()
  }, [])

  // ------------------------------------------
  // Deselect all
  // ------------------------------------------
  const deselectAll = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    canvas.discardActiveObject()
    canvas.requestRenderAll()
    selectElement(null)
  }, [selectElement])

  // ------------------------------------------
  // Nudge selected object by px
  // ------------------------------------------
  const nudge = useCallback((dx: number, dy: number) => {
    const canvas = getCanvas()
    if (!canvas) return

    const active = canvas.getActiveObject()
    if (!active) return

    active.set({
      left: (active.left ?? 0) + dx,
      top: (active.top ?? 0) + dy,
    })
    active.setCoords()
    canvas.requestRenderAll()
  }, [])

  // ------------------------------------------
  // Commit nudge to history (call on keyup)
  // ------------------------------------------
  const commitNudge = useCallback(() => {
    pushToHistory()
  }, [])

  // ------------------------------------------
  // Copy selected to clipboard
  // ------------------------------------------
  const copySelected = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    const active = canvas.getActiveObject()
    if (!active) return

    clipboardObjectJSON = active.toObject([ELEMENT_ID_KEY])

    const elId = getCustomProp(active, ELEMENT_ID_KEY)
    if (typeof elId === 'string') {
      const el = useCanvasStore.getState().findElementById(elId)
      if (el) {
        clipboardElementData = JSON.parse(
          JSON.stringify(el, (key, val) =>
            key === 'fabricObject' ? undefined : val,
          ),
        )
      }
    }
  }, [])

  // ------------------------------------------
  // Paste from clipboard
  // ------------------------------------------
  const paste = useCallback(async () => {
    if (!clipboardObjectJSON) return
    const canvas = getCanvas()
    if (!canvas) return

    const objects = await util.enlivenObjects([clipboardObjectJSON])
    if (objects.length === 0) return

    const obj = objects[0] as FabricObject
    const newId = generateId()
    setCustomProp(obj, ELEMENT_ID_KEY, newId)

    obj.set({
      left: (obj.left ?? 0) + 20,
      top: (obj.top ?? 0) + 20,
    })

    canvas.add(obj)
    canvas.setActiveObject(obj)
    canvas.requestRenderAll()

    const element: CanvasElement = {
      id: newId,
      type: (clipboardElementData?.type as CanvasElement['type']) || 'rect',
      name: `${clipboardElementData?.name || 'Element'} (copia)`,
      visible: true,
      locked: false,
      config: clipboardElementData?.config
        ? { ...clipboardElementData.config }
        : null,
      children: [],
      svgData: clipboardElementData?.svgData,
      fabricObject: obj,
    }

    addElement(element)
    selectElement(newId)

    // Update clipboard offset for next paste
    clipboardObjectJSON = obj.toObject([ELEMENT_ID_KEY])

    pushToHistory()
    markGCodeStale()
  }, [addElement, selectElement])

  // ------------------------------------------
  // Z-ordering: Bring forward / Send backward
  // ------------------------------------------
  const bringForward = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    canvas.bringObjectForward(active)
    canvas.requestRenderAll()
    pushToHistory()
  }, [])

  const sendBackward = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    canvas.sendObjectBackwards(active)

    // Ensure user object stays above non-interactive objects
    const objects = canvas.getObjects()
    const idx = objects.indexOf(active)
    let lastNonInteractiveIdx = -1
    for (let i = 0; i < objects.length; i++) {
      if (getCustomProp(objects[i], NON_INTERACTIVE_KEY) === true) {
        lastNonInteractiveIdx = i
      }
    }
    if (idx <= lastNonInteractiveIdx) {
      canvas.remove(active)
      canvas.insertAt(lastNonInteractiveIdx + 1, active)
    }

    canvas.requestRenderAll()
    pushToHistory()
  }, [])

  const bringToFront = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    canvas.bringObjectToFront(active)
    canvas.requestRenderAll()
    pushToHistory()
  }, [])

  const sendToBack = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    // Find position just above the last non-interactive object
    const objects = canvas.getObjects()
    let lastNonInteractiveIdx = -1
    for (let i = 0; i < objects.length; i++) {
      if (getCustomProp(objects[i], NON_INTERACTIVE_KEY) === true) {
        lastNonInteractiveIdx = i
      }
    }

    canvas.remove(active)
    canvas.insertAt(lastNonInteractiveIdx + 1, active)
    canvas.requestRenderAll()
    pushToHistory()
  }, [])

  // ------------------------------------------
  // Extract paths for G-code generation
  // ------------------------------------------
  // Los SVG/DXF importados suelen traer paths casi cerrados, segmentos de
  // longitud cero y contornos duplicados: eso rompe pocket, kerf y offset.
  // Se limpian aca, en el unico punto por el que pasan todos los toolpaths.
  const cleanPaths = (paths: GCodePath[]): GCodePath[] => {
    const cfg = useCanvasStore.getState().vectorCleanup
    if (!cfg?.enabled) return paths
    let out = removeTinySpans(paths, cfg.tinySpanTolerance)
    out = autoJoinPaths(out, cfg.joinTolerance)
    if (cfg.removeDuplicates) out = removeDuplicatePaths(out)
    return out
  }

  const getPathsForGCode = useCallback((options?: { raw?: boolean }): GCodePath[] => {
    const canvas = getCanvas()
    if (!canvas) return []

    const wa = useCanvasStore.getState().workArea
    const paths: GCodePath[] = []

    const originPos = getOriginPixels(
      wa.origin,
      wa.width * PIXELS_PER_MM,
      wa.height * PIXELS_PER_MM,
      WORK_AREA_PADDING,
      WORK_AREA_PADDING,
    )

    const userObjects = canvas
      .getObjects()
      .filter((o) => getCustomProp(o, NON_INTERACTIVE_KEY) !== true)

    for (const obj of userObjects) {
      if (!obj.visible) continue

      if (obj instanceof Path) {
        const pathPoints = extractPathPoints(obj, originPos, wa.origin)
        if (pathPoints.length > 0) {
          paths.push({ points: pathPoints, closed: isPathClosed(obj) })
        }
      } else if (obj instanceof Rect) {
        const left = obj.left ?? 0
        const top = obj.top ?? 0
        const w = (obj.width ?? 0) * (obj.scaleX ?? 1)
        const h = (obj.height ?? 0) * (obj.scaleY ?? 1)

        const points = convertToMM(
          [
            { x: left, y: top },
            { x: left + w, y: top },
            { x: left + w, y: top + h },
            { x: left, y: top + h },
          ],
          originPos,
          wa.origin,
        )
        paths.push({ points, closed: true })
      } else if (obj instanceof Circle) {
        const cx = (obj.left ?? 0) + (obj.radius ?? 0) * (obj.scaleX ?? 1)
        const cy = (obj.top ?? 0) + (obj.radius ?? 0) * (obj.scaleY ?? 1)
        const r = (obj.radius ?? 0) * (obj.scaleX ?? 1)
        const segments = 72
        const circlePoints: Point2D[] = []

        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2
          circlePoints.push({
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
          })
        }

        const points = convertToMM(circlePoints, originPos, wa.origin)
        paths.push({ points, closed: true })
      } else if (obj instanceof Line) {
        const x1 = obj.x1 ?? 0
        const y1 = obj.y1 ?? 0
        const x2 = obj.x2 ?? 0
        const y2 = obj.y2 ?? 0

        const points = convertToMM(
          [
            { x: (obj.left ?? 0) + x1, y: (obj.top ?? 0) + y1 },
            { x: (obj.left ?? 0) + x2, y: (obj.top ?? 0) + y2 },
          ],
          originPos,
          wa.origin,
        )
        paths.push({ points, closed: false })
      } else if (obj instanceof Ellipse) {
        const extracted = extractObjectPaths(obj, originPos, wa.origin)
        paths.push(...extracted)
      } else if (obj instanceof FabricPolygon) {
        const extracted = extractObjectPaths(obj, originPos, wa.origin)
        paths.push(...extracted)
      } else if (obj instanceof Group) {
        const groupObjects = obj.getObjects()
        for (const child of groupObjects) {
          if (child instanceof Path) {
            const pathPoints = extractPathPoints(child, originPos, wa.origin, obj)
            if (pathPoints.length > 0) {
              paths.push({ points: pathPoints, closed: isPathClosed(child) })
            }
          } else {
            const extracted = extractObjectPaths(child, originPos, wa.origin)
            paths.push(...extracted)
          }
        }
      }
    }

    return options?.raw ? paths : cleanPaths(paths)
  }, [])

  // ------------------------------------------
  // Extract jobs (paths + per-element config) for G-code generation
  // ------------------------------------------
  const getJobsForGCode = useCallback((): GCodeJob[] => {
    const canvas = getCanvas()
    if (!canvas) return []

    const state = useCanvasStore.getState()
    const wa = state.workArea
    const jobs: GCodeJob[] = []

    const originPos = getOriginPixels(
      wa.origin,
      wa.width * PIXELS_PER_MM,
      wa.height * PIXELS_PER_MM,
      WORK_AREA_PADDING,
      WORK_AREA_PADDING,
    )

    const userObjects = canvas
      .getObjects()
      .filter((o) => getCustomProp(o, NON_INTERACTIVE_KEY) !== true)

    // Group objects by layer
    const objectsByLayer: Record<string, FabricObject[]> = {}
    userObjects.forEach((obj) => {
      const elId = getCustomProp(obj, ELEMENT_ID_KEY) as string | undefined
      const element = elId ? state.findElementById(elId) : undefined
      const layerId = element?.layerId || state.activeLayerId
      if (!objectsByLayer[layerId]) objectsByLayer[layerId] = []
      objectsByLayer[layerId].push(obj)
    })

    // Sort layers by order and process visible ones
    const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order)

    for (const layer of sortedLayers) {
      if (!layer.visible) continue
      const layerObjects = objectsByLayer[layer.id] || []

      for (const obj of layerObjects) {
        if (!obj.visible) continue

        // Find the CanvasElement for this Fabric object
        const elId = getCustomProp(obj, ELEMENT_ID_KEY) as string | undefined
        const element = elId ? state.findElementById(elId) : undefined
        
        // Config priority: element > layer > global
        const config = element?.config 
          ? state.getElementConfig(element) 
          : (layer.config || state.globalConfig)
          
        const elementName = element?.name ?? `Object`

        // Capture stroke color for plotter color grouping
        const objStroke = typeof obj.stroke === 'string' ? obj.stroke : undefined

        // Extract paths from this object
        const paths: GCodePath[] = []

        if (obj instanceof Path) {
        const pathPoints = extractPathPoints(obj, originPos, wa.origin)
        if (pathPoints.length > 0) {
          paths.push({ points: pathPoints, closed: isPathClosed(obj) })
        }
      } else if (obj instanceof Rect) {
        const left = obj.left ?? 0
        const top = obj.top ?? 0
        const w = (obj.width ?? 0) * (obj.scaleX ?? 1)
        const h = (obj.height ?? 0) * (obj.scaleY ?? 1)

        const points = convertToMM(
          [
            { x: left, y: top },
            { x: left + w, y: top },
            { x: left + w, y: top + h },
            { x: left, y: top + h },
          ],
          originPos,
          wa.origin,
        )
        paths.push({ points, closed: true })
      } else if (obj instanceof Circle) {
        const cx = (obj.left ?? 0) + (obj.radius ?? 0) * (obj.scaleX ?? 1)
        const cy = (obj.top ?? 0) + (obj.radius ?? 0) * (obj.scaleY ?? 1)
        const r = (obj.radius ?? 0) * (obj.scaleX ?? 1)
        const segments = 72
        const circlePoints: Point2D[] = []

        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2
          circlePoints.push({
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
          })
        }

        const points = convertToMM(circlePoints, originPos, wa.origin)
        paths.push({ points, closed: true })
      } else if (obj instanceof Line) {
        const x1 = obj.x1 ?? 0
        const y1 = obj.y1 ?? 0
        const x2 = obj.x2 ?? 0
        const y2 = obj.y2 ?? 0

        const points = convertToMM(
          [
            { x: (obj.left ?? 0) + x1, y: (obj.top ?? 0) + y1 },
            { x: (obj.left ?? 0) + x2, y: (obj.top ?? 0) + y2 },
          ],
          originPos,
          wa.origin,
        )
        paths.push({ points, closed: false })
      } else if (obj instanceof Ellipse) {
        const extracted = extractObjectPaths(obj, originPos, wa.origin)
        paths.push(...extracted)
      } else if (obj instanceof FabricPolygon) {
        const extracted = extractObjectPaths(obj, originPos, wa.origin)
        paths.push(...extracted)
      } else if (obj instanceof Group) {
        const groupObjects = obj.getObjects()
        for (const child of groupObjects) {
          if (child instanceof Path) {
            const pathPoints = extractPathPoints(child, originPos, wa.origin, obj)
            if (pathPoints.length > 0) {
              paths.push({ points: pathPoints, closed: isPathClosed(child) })
            }
          } else {
            const extracted = extractObjectPaths(child, originPos, wa.origin)
            paths.push(...extracted)
          }
        }
      }

      const cleaned = cleanPaths(paths)
      paths.length = 0
      paths.push(...cleaned)

      if (paths.length > 0) {
        // Tag paths with stroke color for plotter color grouping
        if (objStroke) {
          for (const p of paths) {
            if (!p.strokeColor) p.strokeColor = objStroke
          }
        }

        // Support multiple operations per element
        const ops =
          element?.operations && element.operations.length > 0
            ? element.operations
            : [config]

        for (const opConfig of ops) {
          const job: GCodeJob = {
            elementId: elId ?? '',
            elementName,
            config: opConfig,
            paths,
          }
          // Attach color mappings for laser mode
          if (opConfig.operationType === 'laser') {
            const mappings = state.colorMappings
            if (mappings && mappings.length > 0) {
              job.colorMappings = mappings
            }
          }
          jobs.push(job)
        }
      }
      }
      }

      return jobs
      }, [])
  // ------------------------------------------
  // Update selected object properties in the store (in mm)
  // Throttled via rAF to avoid store churn during drags
  // ------------------------------------------
  const updateSelectedObjectPropsImmediate = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) {
      setSelectedObjectProps(null)
      return
    }

    const active = canvas.getActiveObject()
    if (!active || getCustomProp(active, NON_INTERACTIVE_KEY) === true) {
      setSelectedObjectProps(null)
      return
    }

    const wa = useCanvasStore.getState().workArea
    const originPos = getOriginPixels(
      wa.origin,
      wa.width * PIXELS_PER_MM,
      wa.height * PIXELS_PER_MM,
      WORK_AREA_PADDING,
      WORK_AREA_PADDING,
    )

    const flipY = wa.origin.startsWith('bottom')
    const bounds = active.getBoundingRect()
    const left = active.left ?? 0
    const top = active.top ?? 0

    const xMM = (left - originPos.x) / PIXELS_PER_MM
    const yMM = flipY
      ? (originPos.y - top - bounds.height) / PIXELS_PER_MM
      : (top - originPos.y) / PIXELS_PER_MM
    const wMM = bounds.width / PIXELS_PER_MM
    const hMM = bounds.height / PIXELS_PER_MM

    setSelectedObjectProps({
      x: parseFloat(xMM.toFixed(2)),
      y: parseFloat(yMM.toFixed(2)),
      width: parseFloat(wMM.toFixed(2)),
      height: parseFloat(hMM.toFixed(2)),
      angle: parseFloat((active.angle ?? 0).toFixed(1)),
    })
  }, [setSelectedObjectProps])

  const rafId = useRef(0)
  const updateSelectedObjectProps = useCallback(() => {
    cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(updateSelectedObjectPropsImmediate)
  }, [updateSelectedObjectPropsImmediate])

  // ------------------------------------------
  // Apply property changes from the footer to the canvas object
  // ------------------------------------------
  const applyObjectProps = useCallback((prop: string, value: number) => {
    const canvas = getCanvas()
    if (!canvas) return

    const active = canvas.getActiveObject()
    if (!active) return

    applyObjectPropRaw(active, prop, value)

    active.setCoords()
    canvas.requestRenderAll()
    updateSelectedObjectProps()
    pushToHistory()
  }, [updateSelectedObjectProps])

  /**
   * Redimensiona la seleccion al valor que muestra el panel (bounding box en
   * mm). Se calcula la razon contra el bounding box y se aplica sobre la
   * medida geometrica, que es la que entiende el anclaje por origen.
   */
  const resizeSelected = useCallback((
    dim: 'width' | 'height',
    valueMm: number,
    keepAspect: boolean,
  ) => {
    const canvas = getCanvas()
    if (!canvas || valueMm <= 0) return

    const active = canvas.getActiveObject()
    if (!active) return

    const bounds = active.getBoundingRect()
    const currentMm = (dim === 'width' ? bounds.width : bounds.height) / PIXELS_PER_MM
    if (currentMm <= 1e-4) return

    const ratio = valueMm / currentMm
    const geomWmm = ((active.width ?? 0) * (active.scaleX ?? 1)) / PIXELS_PER_MM
    const geomHmm = ((active.height ?? 0) * (active.scaleY ?? 1)) / PIXELS_PER_MM

    if (keepAspect || dim === 'width') applyObjectPropRaw(active, 'width', geomWmm * ratio)
    if (keepAspect || dim === 'height') applyObjectPropRaw(active, 'height', geomHmm * ratio)

    active.setCoords()
    canvas.requestRenderAll()
    updateSelectedObjectProps()
    pushToHistory()
  }, [updateSelectedObjectProps])

  // ------------------------------------------
  // Update maker params: regenerate Fabric object with new parameters
  // ------------------------------------------
  const updateMakerParams = useCallback(
    (elementId: string, newParams: Record<string, number | string | number[]>) => {
      const canvas = getCanvas()
      if (!canvas) return

      const element = useCanvasStore.getState().findElementById(elementId)
      if (!element || !element.makerType) return

      // Find current fabric object and save its center + angle
      const oldObj = canvas
        .getObjects()
        .find((o) => getCustomProp(o, ELEMENT_ID_KEY) === elementId)
      if (!oldObj) return

      const oldBounds = oldObj.getBoundingRect()
      const centerX = oldBounds.left + oldBounds.width / 2
      const centerY = oldBounds.top + oldBounds.height / 2
      const savedAngle = oldObj.angle ?? 0

      const stroke = '#333333'
      const baseProps = { fill: 'transparent', stroke, strokeWidth: 1 }
      const mergedParams = { ...element.makerParams, ...newParams }
      const params = mergedParams as Record<string, number> // legacy numeric access
      let fabricObj: FabricObject

      switch (element.makerType) {
        case 'roundRect': {
          const cornerR = (params.cornerRadius ?? 8) * PIXELS_PER_MM
          const w = (params.width ?? 50) * PIXELS_PER_MM
          const h = (params.height ?? 30) * PIXELS_PER_MM
          fabricObj = new Rect({ width: w, height: h, rx: cornerR, ry: cornerR, ...baseProps })
          break
        }
        case 'oval':
        case 'ellipse': {
          const rx = (params.rx ?? 25) * PIXELS_PER_MM
          const ry = (params.ry ?? 16.5) * PIXELS_PER_MM
          fabricObj = new Ellipse({ rx, ry, ...baseProps })
          break
        }
        case 'ring': {
          const outerR = (params.outerRadius ?? 25) * PIXELS_PER_MM
          const innerR = (params.innerRadius ?? 15) * PIXELS_PER_MM
          const d =
            `M ${outerR},0 A ${outerR},${outerR} 0 1,1 -${outerR},0 A ${outerR},${outerR} 0 1,1 ${outerR},0 Z ` +
            `M ${innerR},0 A ${innerR},${innerR} 0 1,0 -${innerR},0 A ${innerR},${innerR} 0 1,0 ${innerR},0 Z`
          fabricObj = new Path(d, baseProps)
          break
        }
        case 'polygon': {
          const sides = params.sides ?? 6
          const radius = (params.radius ?? 25) * PIXELS_PER_MM
          const pts = regularPolygonPoints(sides, radius)
          fabricObj = new FabricPolygon(pts, baseProps)
          break
        }
        case 'star': {
          const numPts = params.points ?? 5
          const outerR = (params.outerRadius ?? 25) * PIXELS_PER_MM
          const innerR = (params.innerRadius ?? 10) * PIXELS_PER_MM
          const pts = starPoints(numPts, outerR, innerR)
          fabricObj = new FabricPolygon(pts, baseProps)
          break
        }
        case 'slot': {
          const w = (params.width ?? 50) * PIXELS_PER_MM
          const h = (params.height ?? 30) * PIXELS_PER_MM
          const r = h / 2
          const d =
            `M ${r},0 L ${w - r},0 ` +
            `A ${r},${r} 0 0,1 ${w - r},${h} ` +
            `L ${r},${h} ` +
            `A ${r},${r} 0 0,1 ${r},0 Z`
          fabricObj = new Path(d, baseProps)
          break
        }
        case 'dome': {
          const radius = (params.radius ?? 25) * PIXELS_PER_MM
          const w = radius * 2
          const d = `M 0,${radius} A ${radius},${radius} 0 0,1 ${w},${radius} L 0,${radius} Z`
          fabricObj = new Path(d, baseProps)
          break
        }
        case 'boltCircle': {
          const mainR = (params.radius ?? 25) * PIXELS_PER_MM
          const boltR = (params.boltRadius ?? 3) * PIXELS_PER_MM
          const boltCount = params.boltCount ?? 6
          const boltDist = mainR * 0.7
          const children: FabricObject[] = []
          children.push(new Circle({ radius: mainR, originX: 'center', originY: 'center', ...baseProps }))
          for (let i = 0; i < boltCount; i++) {
            const angle = (2 * Math.PI * i) / boltCount - Math.PI / 2
            children.push(
              new Circle({
                radius: boltR,
                left: boltDist * Math.cos(angle),
                top: boltDist * Math.sin(angle),
                originX: 'center',
                originY: 'center',
                ...baseProps,
              }),
            )
          }
          fabricObj = new Group(children)
          break
        }
        case 'boltRect': {
          const w = (params.width ?? 50) * PIXELS_PER_MM
          const h = (params.height ?? 50) * PIXELS_PER_MM
          const boltR = (params.boltRadius ?? 3) * PIXELS_PER_MM
          const inset = (params.inset ?? 8) * PIXELS_PER_MM
          const boltCount = params.boltCount ?? 4
          const children: FabricObject[] = []
          children.push(new Rect({ width: w, height: h, left: -w / 2, top: -h / 2, ...baseProps }))
          for (const c of boltRectPositions(w, h, inset, boltCount)) {
            children.push(
              new Circle({
                radius: boltR,
                left: c.x,
                top: c.y,
                originX: 'center',
                originY: 'center',
                ...baseProps,
              }),
            )
          }
          fabricObj = new Group(children)
          break
        }
        case 'text': {
          // Text requires async font loading — rebuild path from params
          // For now, we can't do this synchronously. The text tool stores the SVG path
          // in the Fabric Path, so this case is only needed if params change.
          // We handle it by regenerating via the text-to-path module.
          const textVal = String(mergedParams.text ?? '')
          const fontUrlVal = String(mergedParams.fontUrl ?? '/fonts/Roboto.ttf')
          const fontSizeVal = Number(mergedParams.fontSize ?? 15)
          const letterSpacingVal = Number(mergedParams.letterSpacing ?? 0)

          // Async font load — we rebuild the path after loading
          import('@/lib/text-to-path').then(async (mod) => {
            try {
              const font = await mod.loadFont(fontUrlVal)
              const d = mod.textToSvgPath(textVal, font, fontSizeVal, letterSpacingVal)
              const newObj = new Path(d, baseProps)
              newObj.set({ angle: savedAngle, lockScalingX: true, lockScalingY: true })
              newObj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, tl: false, tr: false, bl: false, br: false })
              setCustomProp(newObj, ELEMENT_ID_KEY, elementId)

              const currentObj = canvas.getObjects().find(o => getCustomProp(o, ELEMENT_ID_KEY) === elementId)
              if (currentObj) canvas.remove(currentObj)
              canvas.add(newObj)

              const newBounds = newObj.getBoundingRect()
              newObj.set({
                left: (newObj.left ?? 0) + (centerX - newBounds.left - newBounds.width / 2),
                top: (newObj.top ?? 0) + (centerY - newBounds.top - newBounds.height / 2),
              })
              newObj.setCoords()
              canvas.setActiveObject(newObj)
              canvas.requestRenderAll()
              updateElement(elementId, { makerParams: mergedParams, fabricObject: newObj })
              pushToHistory()
              markGCodeStale()
            } catch { /* font load failed */ }
          })
          return // Early return — async handling above
        }
        case 'arc': {
          const sX = Number(mergedParams.startX ?? 0) * PIXELS_PER_MM
          const sY = Number(mergedParams.startY ?? 0) * PIXELS_PER_MM
          const mX = Number(mergedParams.midX ?? 0) * PIXELS_PER_MM
          const mY = Number(mergedParams.midY ?? 0) * PIXELS_PER_MM
          const eX = Number(mergedParams.endX ?? 0) * PIXELS_PER_MM
          const eY = Number(mergedParams.endY ?? 0) * PIXELS_PER_MM

          const arcPts = arcFrom3Points({ x: sX, y: sY }, { x: mX, y: mY }, { x: eX, y: eY })
          const arcD = arcPts
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`)
            .join(' ')
          fabricObj = new Path(arcD, baseProps)
          break
        }
        case 'bezier': {
          const bPtsX = (mergedParams.pointsX ?? [0]) as number[]
          const bPtsY = (mergedParams.pointsY ?? [0]) as number[]
          const bClosed = Number(mergedParams.closed ?? 0)

          const bPixelPts = bPtsX.map((x, i) => ({
            x: (x as number) * PIXELS_PER_MM,
            y: ((bPtsY[i] as number) ?? 0) * PIXELS_PER_MM,
          }))

          const bSegs = catmullRomToCubicBezier(bPixelPts, !!bClosed)
          let bD = `M ${bPixelPts[0].x.toFixed(2)},${bPixelPts[0].y.toFixed(2)}`
          for (const seg of bSegs) {
            bD += ` C ${seg.cp1.x.toFixed(2)},${seg.cp1.y.toFixed(2)} ${seg.cp2.x.toFixed(2)},${seg.cp2.y.toFixed(2)} ${seg.end.x.toFixed(2)},${seg.end.y.toFixed(2)}`
          }
          if (bClosed) bD += ' Z'

          fabricObj = new Path(bD, baseProps)
          break
        }
        case 'polyline': {
          const ptsX = (mergedParams.pointsX ?? [0]) as number[]
          const ptsY = (mergedParams.pointsY ?? [0]) as number[]
          const isClosed = Number(mergedParams.closed ?? 0)

          const pixelPts = ptsX.map((x, i) => ({
            x: (x as number) * PIXELS_PER_MM,
            y: ((ptsY[i] as number) ?? 0) * PIXELS_PER_MM,
          }))

          let d = pixelPts
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`)
            .join(' ')
          if (isClosed) d += ' Z'

          fabricObj = new Path(d, baseProps)
          break
        }
        default:
          return
      }

      // Place new object at scale 1, preserving center position and angle
      fabricObj.set({ angle: savedAngle, lockScalingX: true, lockScalingY: true })
      fabricObj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, tl: false, tr: false, bl: false, br: false })
      setCustomProp(fabricObj, ELEMENT_ID_KEY, elementId)

      // Replace on canvas first so we can measure the new bounds
      canvas.remove(oldObj)
      canvas.add(fabricObj)
      fabricObj.setCoords()

      const newBounds = fabricObj.getBoundingRect()
      fabricObj.set({
        left: (fabricObj.left ?? 0) + (centerX - newBounds.left - newBounds.width / 2),
        top: (fabricObj.top ?? 0) + (centerY - newBounds.top - newBounds.height / 2),
      })
      fabricObj.setCoords()

      canvas.setActiveObject(fabricObj)
      canvas.requestRenderAll()

      // Update store
      updateElement(elementId, { makerParams: mergedParams, fabricObject: fabricObj })
      updateSelectedObjectProps()
      pushToHistory()
      markGCodeStale()
    },
    [updateElement, updateSelectedObjectProps],
  )

  // ------------------------------------------
  // Helper: decompose ActiveSelection to work with absolute coords,
  // apply changes, then recompose.
  // ------------------------------------------
  const withAbsoluteObjects = useCallback((
    action: (objects: FabricObject[], canvas: Canvas) => void,
  ) => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    if (active instanceof ActiveSelection) {
      // Decompose: remove from ActiveSelection so objects get absolute coords
      const objects = active.getObjects()
      canvas.discardActiveObject()

      // Now objects have absolute coordinates
      action(objects, canvas)

      // Recompose selection
      const newSelection = new ActiveSelection(objects, { canvas })
      canvas.setActiveObject(newSelection)
    } else {
      action([active], canvas)
    }

    canvas.requestRenderAll()
    updateSelectedObjectProps()
    pushToHistory()
    markGCodeStale()
  }, [updateSelectedObjectProps])

  // ------------------------------------------
  // Align to first selected object
  // ------------------------------------------
  const alignToFirst = useCallback((side: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
    withAbsoluteObjects((objects) => {
      if (objects.length < 2) return

      const refBounds = objects[0].getBoundingRect()

      for (let i = 1; i < objects.length; i++) {
        const obj = objects[i]
        const bounds = obj.getBoundingRect()
        let dx = 0
        let dy = 0

        switch (side) {
          case 'left':
            dx = refBounds.left - bounds.left
            break
          case 'centerH':
            dx = (refBounds.left + refBounds.width / 2) - (bounds.left + bounds.width / 2)
            break
          case 'right':
            dx = (refBounds.left + refBounds.width) - (bounds.left + bounds.width)
            break
          case 'top':
            dy = refBounds.top - bounds.top
            break
          case 'centerV':
            dy = (refBounds.top + refBounds.height / 2) - (bounds.top + bounds.height / 2)
            break
          case 'bottom':
            dy = (refBounds.top + refBounds.height) - (bounds.top + bounds.height)
            break
        }

        obj.set({
          left: (obj.left ?? 0) + dx,
          top: (obj.top ?? 0) + dy,
        })
        obj.setCoords()
      }
    })
  }, [withAbsoluteObjects])

  // ------------------------------------------
  // Align to work area
  // ------------------------------------------
  const alignToWorkArea = useCallback((side: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
    withAbsoluteObjects((objects) => {
      const wa = useCanvasStore.getState().workArea
      const waLeft = WORK_AREA_PADDING
      const waTop = WORK_AREA_PADDING
      const waRight = WORK_AREA_PADDING + wa.width * PIXELS_PER_MM
      const waBottom = WORK_AREA_PADDING + wa.height * PIXELS_PER_MM
      const waCenterX = (waLeft + waRight) / 2
      const waCenterY = (waTop + waBottom) / 2

      for (const obj of objects) {
        const bounds = obj.getBoundingRect()
        let dx = 0
        let dy = 0

        switch (side) {
          case 'left':
            dx = waLeft - bounds.left
            break
          case 'centerH':
            dx = waCenterX - (bounds.left + bounds.width / 2)
            break
          case 'right':
            dx = waRight - (bounds.left + bounds.width)
            break
          case 'top':
            dy = waTop - bounds.top
            break
          case 'centerV':
            dy = waCenterY - (bounds.top + bounds.height / 2)
            break
          case 'bottom':
            dy = waBottom - (bounds.top + bounds.height)
            break
        }

        obj.set({
          left: (obj.left ?? 0) + dx,
          top: (obj.top ?? 0) + dy,
        })
        obj.setCoords()
      }
    })
  }, [withAbsoluteObjects])

  // ------------------------------------------
  // Distribute objects evenly
  // ------------------------------------------
  const distribute = useCallback((axis: 'horizontal' | 'vertical') => {
    withAbsoluteObjects((objects) => {
      if (objects.length < 3) return

      const items = objects.map(obj => ({
        obj,
        bounds: obj.getBoundingRect(),
      }))

      if (axis === 'horizontal') {
        items.sort((a, b) => a.bounds.left - b.bounds.left)

        const first = items[0].bounds
        const last = items[items.length - 1].bounds
        const totalSpan = (last.left + last.width) - first.left
        const totalObjWidth = items.reduce((sum, i) => sum + i.bounds.width, 0)
        const gap = (totalSpan - totalObjWidth) / (items.length - 1)

        let currentLeft = first.left
        for (const item of items) {
          const dx = currentLeft - item.bounds.left
          item.obj.set({ left: (item.obj.left ?? 0) + dx })
          item.obj.setCoords()
          currentLeft += item.bounds.width + gap
        }
      } else {
        items.sort((a, b) => a.bounds.top - b.bounds.top)

        const first = items[0].bounds
        const last = items[items.length - 1].bounds
        const totalSpan = (last.top + last.height) - first.top
        const totalObjHeight = items.reduce((sum, i) => sum + i.bounds.height, 0)
        const gap = (totalSpan - totalObjHeight) / (items.length - 1)

        let currentTop = first.top
        for (const item of items) {
          const dy = currentTop - item.bounds.top
          item.obj.set({ top: (item.obj.top ?? 0) + dy })
          item.obj.setCoords()
          currentTop += item.bounds.height + gap
        }
      }
    })
  }, [withAbsoluteObjects])

  // ------------------------------------------
  // Group selected objects
  // ------------------------------------------
  const groupSelected = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!(active instanceof ActiveSelection)) return

    const objects = active.getObjects()
    if (objects.length < 2) return

    // Collect element IDs before removing from canvas
    const childElementIds = objects
      .map(o => getCustomProp(o, ELEMENT_ID_KEY) as string | undefined)
      .filter((id): id is string => !!id)

    // Remove from ActiveSelection and canvas
    canvas.discardActiveObject()
    for (const obj of objects) {
      canvas.remove(obj)
    }

    // Create Fabric Group
    const group = new Group(objects)
    const groupId = generateId()
    setCustomProp(group, ELEMENT_ID_KEY, groupId)

    canvas.add(group)
    canvas.setActiveObject(group)
    canvas.requestRenderAll()

    // Build children elements from existing store elements
    const storeState = useCanvasStore.getState()
    const childElements: CanvasElement[] = []
    const remainingElements: CanvasElement[] = []

    for (const el of storeState.elements) {
      if (childElementIds.includes(el.id)) {
        childElements.push({ ...el, parent: groupId })
      } else {
        remainingElements.push(el)
      }
    }

    const groupElement: CanvasElement = {
      id: groupId,
      type: 'group',
      name: `Group ${Date.now() % 1000}`,
      visible: true,
      locked: false,
      config: null,
      children: childElements,
      fabricObject: group,
    }

    // Replace store elements: remove children, add group
    useCanvasStore.getState().setElements([...remainingElements, groupElement])
    selectElement(groupId)
    pushToHistory()
    markGCodeStale()
  }, [selectElement])

  // ------------------------------------------
  // Ungroup selected group
  // ------------------------------------------
  const ungroupSelected = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    const activeId = getCustomProp(active, ELEMENT_ID_KEY) as string | undefined
    if (!activeId) return

    const storeState = useCanvasStore.getState()
    const element = storeState.findElementById(activeId)
    if (!element || element.type !== 'group') return

    // Get group objects
    if (!(active instanceof Group) || active instanceof ActiveSelection) return

    const objects = active.getObjects()
    // Remove group from canvas
    canvas.remove(active)

    // Add individual objects back
    const newElementIds: string[] = []
    for (const obj of objects) {
      canvas.add(obj)
      obj.setCoords()
      newElementIds.push(getCustomProp(obj, ELEMENT_ID_KEY) as string || '')
    }

    canvas.requestRenderAll()

    // Restore store: remove group element, add children back as top-level
    const remainingElements = storeState.elements.filter(e => e.id !== activeId)
    const restoredChildren = (element.children || []).map(child => ({
      ...child,
      parent: undefined,
    }))

    useCanvasStore.getState().setElements([...remainingElements, ...restoredChildren])

    // Select all ungrouped objects
    if (objects.length > 1) {
      const selection = new ActiveSelection(objects, { canvas })
      canvas.setActiveObject(selection)
    } else if (objects.length === 1) {
      canvas.setActiveObject(objects[0])
    }

    canvas.requestRenderAll()
    selectElement(null)
    pushToHistory()
    markGCodeStale()
  }, [selectElement])

  // Boolean Operations (Union, Difference, Intersection, XOR)
  const booleanOperationSelected = useCallback(async (op: 'union' | 'difference' | 'intersection' | 'xor') => {
    const canvas = getCanvas()
    if (!canvas) return
    const activeObject = canvas.getActiveObject()
    if (!activeObject) return

    let objects: FabricObject[] = []
    if (activeObject instanceof ActiveSelection) {
      objects = activeObject.getObjects()
    }

    if (objects.length < 2) return

    const { workArea } = useCanvasStore.getState()
    const { width, height, origin } = workArea
    
    // Calculate origin in pixels
    const originPos = getOriginPixels(
      origin, 
      width * PIXELS_PER_MM, 
      height * PIXELS_PER_MM, 
      0, 0
    )

    const subjectPaths: Point2D[][] = []
    const clipPaths: Point2D[][] = []

    if (op === 'union') {
      objects.forEach(obj => {
        const paths = extractObjectPaths(obj, originPos, origin)
        subjectPaths.push(...paths.map(p => p.points))
      })
    } else {
      // Sort by z-index to determine subject (bottom-most in stack)
      const allCanvasObjects = canvas.getObjects()
      const sorted = [...objects].sort((a, b) => {
        return allCanvasObjects.indexOf(a) - allCanvasObjects.indexOf(b)
      })
      
      const subjectObj = sorted[0]
      const clipObjs = sorted.slice(1)

      const sPaths = extractObjectPaths(subjectObj, originPos, origin)
      subjectPaths.push(...sPaths.map(p => p.points))

      clipObjs.forEach(obj => {
        const cPaths = extractObjectPaths(obj, originPos, origin)
        clipPaths.push(...cPaths.map(p => p.points))
      })
    }

    const resultPoints = await booleanOperation(subjectPaths, clipPaths, op)
    
    if (resultPoints.length === 0) {
      deleteSelected()
      return
    }

    const flipY = origin.startsWith('bottom')
    const toPx = (p: Point2D) => {
      const x = p.x * PIXELS_PER_MM + originPos.x
      const y = flipY 
        ? originPos.y - (p.y * PIXELS_PER_MM)
        : (p.y * PIXELS_PER_MM) + originPos.y
      return { x, y }
    }

    // Build the SVG path data
    let pathString = ""
    resultPoints.forEach(poly => {
      if (poly.length < 2) return
      const first = toPx(poly[0])
      pathString += `M ${first.x} ${first.y} `
      for (let i = 1; i < poly.length; i++) {
        const pt = toPx(poly[i])
        pathString += `L ${pt.x} ${pt.y} `
      }
      pathString += "Z "
    })

    const newPath = new Path(pathString, {
      fill: 'rgba(0,0,0,0.1)',
      stroke: '#333',
      strokeWidth: 1,
    })

    // Remove originals
    objects.forEach(obj => {
      const elementId = getCustomProp(obj, ELEMENT_ID_KEY) as string
      if (elementId) removeElement(elementId)
      canvas.remove(obj)
    })

    // Add new result
    const newId = generateId()
    setCustomProp(newPath, ELEMENT_ID_KEY, newId)
    const element: CanvasElement = {
      id: newId,
      type: 'svg',
      name: `${op.charAt(0).toUpperCase() + op.slice(1)} Result`,
      visible: true,
      locked: false,
      config: null,
      children: [],
      fabricObject: newPath,
    }
    addElement(element)
    canvas.add(newPath)
    canvas.setActiveObject(newPath)
    
    canvas.requestRenderAll()
    pushToHistory()
    markGCodeStale()
  }, [addElement, removeElement, pushToHistory, deleteSelected])

  // Offset a shape by distance in mm
  const offsetSelected = useCallback(async (distanceMm: number) => {
    const canvas = getCanvas()
    if (!canvas || Math.abs(distanceMm) < 0.001) return
    
    const activeObject = canvas.getActiveObject()
    if (!activeObject) return

    let objects: FabricObject[] = []
    if (activeObject instanceof ActiveSelection) {
      objects = activeObject.getObjects()
    } else {
      objects = [activeObject]
    }

    const { workArea } = useCanvasStore.getState()
    const { width, height, origin } = workArea
    const originPos = getOriginPixels(origin, width * PIXELS_PER_MM, height * PIXELS_PER_MM, 0, 0)
    const flipY = origin.startsWith('bottom')

    const toPx = (p: Point2D) => {
      const x = p.x * PIXELS_PER_MM + originPos.x
      const y = flipY 
        ? originPos.y - (p.y * PIXELS_PER_MM)
        : (p.y * PIXELS_PER_MM) + originPos.y
      return { x, y }
    }

    const newPaths: Path[] = []

    for (const obj of objects) {
      const gcodePaths = extractObjectPaths(obj, originPos, origin)
      for (const gp of gcodePaths) {
        const resultPolys = await offsetPolygon(gp.points, distanceMm, gp.closed, 'round')
        
        if (resultPolys.length > 0) {
          let pathString = ""
          resultPolys.forEach(poly => {
            if (poly.length < 2) return
            const first = toPx(poly[0])
            pathString += `M ${first.x} ${first.y} `
            for (let i = 1; i < poly.length; i++) {
              const pt = toPx(poly[i])
              pathString += `L ${pt.x} ${pt.y} `
            }
            pathString += "Z "
          })
          
          const newPath = new Path(pathString, {
            fill: 'rgba(0,0,0,0.05)',
            stroke: '#666',
            strokeWidth: 1,
            strokeDashArray: [5, 5]
          })
          newPaths.push(newPath)
        }
      }
    }

    if (newPaths.length > 0) {
      newPaths.forEach(path => {
        const newId = generateId()
        setCustomProp(path, ELEMENT_ID_KEY, newId)
        const element: CanvasElement = {
          id: newId,
          type: 'svg',
          name: `Offset ${distanceMm}mm`,
          visible: true,
          locked: false,
          config: null,
          children: [],
          fabricObject: path,
        }
        addElement(element)
        canvas.add(path)
      })
      
      const selection = new ActiveSelection(newPaths, { canvas })
      canvas.setActiveObject(selection)
      canvas.requestRenderAll()
      pushToHistory()
      markGCodeStale()
    }
  }, [addElement, pushToHistory])

  // Create a rectangular array of copies
  const arrayRectangular = useCallback(async (
    rows: number,
    cols: number,
    spacingX: number,
    spacingY: number
  ) => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    const objects = active instanceof ActiveSelection ? active.getObjects() : [active]

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue

        for (const obj of objects) {
          const cloned = await obj.clone()
          const dx = c * spacingX * PIXELS_PER_MM
          const dy = r * spacingY * PIXELS_PER_MM

          cloned.set({
            left: (obj.left ?? 0) + dx,
            top: (obj.top ?? 0) + dy
          })

          const newId = generateId()
          setCustomProp(cloned, ELEMENT_ID_KEY, newId)

          const element: CanvasElement = {
            id: newId,
            type: 'svg',
            name: `Copy R${r}C${c}`,
            visible: true,
            locked: false,
            config: null,
            children: [],
            fabricObject: cloned,
          }

          addElement(element)
          canvas.add(cloned)
        }
      }
    }

    canvas.requestRenderAll()
    pushToHistory()
    markGCodeStale()
  }, [addElement, pushToHistory])

  // Create a polar array of copies
  const arrayPolar = useCallback(async (
    count: number,
    totalAngle: number,
    centerX: number,
    centerY: number
  ) => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    const objects = active instanceof ActiveSelection ? active.getObjects() : [active]
    const angleStep = totalAngle / count

    const cx = centerX * PIXELS_PER_MM
    const cy = centerY * PIXELS_PER_MM

    for (let i = 1; i < count; i++) {
      const angleDeg = i * angleStep
      const angleRad = angleDeg * (Math.PI / 180)

      for (const obj of objects) {
        const cloned = await obj.clone()
        const ox = obj.left ?? 0
        const oy = obj.top ?? 0

        const s = Math.sin(angleRad)
        const co = Math.cos(angleRad)

        const tx = ox - cx
        const ty = oy - cy

        cloned.set({
          left: tx * co - ty * s + cx,
          top: tx * s + ty * co + cy,
          angle: (obj.angle ?? 0) + angleDeg
        })

        const newId = generateId()
        setCustomProp(cloned, ELEMENT_ID_KEY, newId)

        const element: CanvasElement = {
          id: newId,
          type: 'svg',
          name: `Polar Copy ${i}`,
          visible: true,
          locked: false,
          config: null,
          children: [],
          fabricObject: cloned,
        }

        addElement(element)
        canvas.add(cloned)
      }
    }

    canvas.requestRenderAll()
    pushToHistory()
    markGCodeStale()
  }, [addElement, pushToHistory])

  // Mirror selected objects horizontally or vertically with copy
  const mirrorSelected = useCallback((axis: 'h' | 'v') => {
    const canvas = getCanvas()
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    const objects = active instanceof ActiveSelection ? active.getObjects() : [active]
    const bounds = active.getBoundingRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2

    objects.forEach(obj => {
      obj.clone().then((cloned: FabricObject) => {
        if (axis === 'h') {
          // Reflect across vertical axis passing through centerX
          const dx = centerX - (obj.left ?? 0)
          cloned.set({
            left: centerX + dx - (obj.width ?? 0) * (obj.scaleX ?? 1),
            flipX: !obj.flipX
          })
        } else {
          // Reflect across horizontal axis passing through centerY
          const dy = centerY - (obj.top ?? 0)
          cloned.set({
            top: centerY + dy - (obj.height ?? 0) * (obj.scaleY ?? 1),
            flipY: !obj.flipY
          })
        }

        const newId = generateId()
        setCustomProp(cloned, ELEMENT_ID_KEY, newId)
        
        const element: CanvasElement = {
          id: newId,
          type: 'svg',
          name: `${getCustomProp(obj, '_name') || 'Object'} Mirror`,
          visible: true,
          locked: false,
          config: null,
          children: [],
          fabricObject: cloned,
        }
        
        addElement(element)
        canvas.add(cloned)
      })
    })

    pushToHistory()
    markGCodeStale()
  }, [addElement, pushToHistory])

  // Export canvas to SVG file
  const exportSVG = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    const svg = canvas.toSVG({
      width: String(useCanvasStore.getState().workArea.width * PIXELS_PER_MM),
      height: String(useCanvasStore.getState().workArea.height * PIXELS_PER_MM),
      viewBox: {
        x: 0,
        y: 0,
        width: useCanvasStore.getState().workArea.width * PIXELS_PER_MM,
        height: useCanvasStore.getState().workArea.height * PIXELS_PER_MM
      }
    })

    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${useAppStore.getState().projectName || 'export'}.svg`
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  // Export canvas to DXF
  const exportDXF = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return

    const wa = useCanvasStore.getState().workArea
    const originPos = getOriginPixels(
      wa.origin,
      wa.width * PIXELS_PER_MM,
      wa.height * PIXELS_PER_MM,
      WORK_AREA_PADDING,
      WORK_AREA_PADDING,
    )
    const flipY = wa.origin.startsWith('bottom')

    const toMM = (px: number, py: number) => ({
      x: (px - originPos.x) / PIXELS_PER_MM,
      y: flipY
        ? (originPos.y - py) / PIXELS_PER_MM
        : (py - originPos.y) / PIXELS_PER_MM,
    })

    let dxf = "  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n"

    const userObjects = canvas.getObjects().filter(o => getCustomProp(o, NON_INTERACTIVE_KEY) !== true)

    const emitPolyline = (pts: Point2D[], closed: boolean) => {
      if (pts.length < 2) return
      dxf += `  0\nLWPOLYLINE\n  8\n0\n100\nAcDbEntity\n100\nAcDbPolyline\n 90\n${pts.length}\n 70\n${closed ? 1 : 0}\n`
      for (const p of pts) {
        dxf += ` 10\n${p.x.toFixed(4)}\n 20\n${p.y.toFixed(4)}\n`
      }
    }

    for (const obj of userObjects) {
      if (!obj.visible) continue

      if (obj instanceof Circle) {
        const matrix = obj.calcTransformMatrix()
        const center = util.transformPoint(new Point(0, 0), matrix)
        const c = toMM(center.x, center.y)
        const r = (obj.radius ?? 0) * (obj.scaleX ?? 1) / PIXELS_PER_MM
        dxf += `  0\nCIRCLE\n  8\n0\n 10\n${c.x.toFixed(4)}\n 20\n${c.y.toFixed(4)}\n 40\n${r.toFixed(4)}\n`
      } else if (obj instanceof Ellipse) {
        const extracted = extractObjectPaths(obj, originPos, wa.origin)
        for (const p of extracted) emitPolyline(p.points, true)
      } else if (obj instanceof Rect) {
        const w = (obj.width ?? 0)
        const h = (obj.height ?? 0)
        const matrix = obj.calcTransformMatrix()
        const corners = [
          util.transformPoint(new Point(-w / 2, -h / 2), matrix),
          util.transformPoint(new Point(w / 2, -h / 2), matrix),
          util.transformPoint(new Point(w / 2, h / 2), matrix),
          util.transformPoint(new Point(-w / 2, h / 2), matrix),
        ].map(p => toMM(p.x, p.y))
        emitPolyline(corners, true)
      } else if (obj instanceof Line) {
        const matrix = obj.calcTransformMatrix()
        const p1 = util.transformPoint(new Point(obj.x1 ?? 0, obj.y1 ?? 0), matrix)
        const p2 = util.transformPoint(new Point(obj.x2 ?? 0, obj.y2 ?? 0), matrix)
        const a = toMM(p1.x, p1.y)
        const b = toMM(p2.x, p2.y)
        dxf += `  0\nLINE\n  8\n0\n 10\n${a.x.toFixed(4)}\n 20\n${a.y.toFixed(4)}\n 11\n${b.x.toFixed(4)}\n 21\n${b.y.toFixed(4)}\n`
      } else if (obj instanceof Path) {
        const pts = extractPathPoints(obj, originPos, wa.origin)
        if (pts.length > 0) emitPolyline(pts, isPathClosed(obj))
      } else if (obj instanceof FabricPolygon) {
        const extracted = extractObjectPaths(obj, originPos, wa.origin)
        for (const p of extracted) emitPolyline(p.points, true)
      } else if (obj instanceof Group) {
        const children = obj.getObjects()
        for (const child of children) {
          if (child instanceof Path) {
            const pts = extractPathPoints(child, originPos, wa.origin, obj)
            if (pts.length > 0) emitPolyline(pts, isPathClosed(child))
          } else {
            const extracted = extractObjectPaths(child, originPos, wa.origin)
            for (const p of extracted) emitPolyline(p.points, p.closed)
          }
        }
      }
    }

    dxf += "  0\nENDSEC\n  0\nEOF\n"

    const blob = new Blob([dxf], { type: 'application/dxf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${useAppStore.getState().projectName || 'export'}.dxf`
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  // Add a persistent dimension (cota) between two points
  const addCota = useCallback((p1: Point2D, p2: Point2D) => {
    const canvas = getCanvas()
    if (!canvas) return

    const distPx = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
    const distMm = distPx / PIXELS_PER_MM
    const angleRad = Math.atan2(p2.y - p1.y, p2.x - p1.x)
    
    // Perpendicular vector for offset
    const nx = -Math.sin(angleRad)
    const ny = Math.cos(angleRad)
    
    const offset = 20 // Pixels offset from points
    
    const x1 = p1.x + nx * offset
    const y1 = p1.y + ny * offset
    const x2 = p2.x + nx * offset
    const y2 = p2.y + ny * offset

    // Dimension line
    const line = new Line([x1, y1, x2, y2], {
      stroke: '#0ea5e9',
      strokeWidth: 1,
    })

    // Extension lines (dotted)
    const ext1 = new Line([p1.x, p1.y, x1 + nx * 5, y1 + ny * 5], {
      stroke: '#0ea5e9',
      strokeWidth: 0.5,
      strokeDashArray: [2, 2]
    })
    const ext2 = new Line([p2.x, p2.y, x2 + nx * 5, y2 + ny * 5], {
      stroke: '#0ea5e9',
      strokeWidth: 0.5,
      strokeDashArray: [2, 2]
    })

    // Text label
    // Rotate text to be readable (0-180 range)
    let textAngle = angleRad * (180 / Math.PI)
    if (textAngle > 90) textAngle -= 180
    if (textAngle < -90) textAngle += 180

    const text = new FabricText(`${distMm.toFixed(2)} mm`, {
      left: (x1 + x2) / 2,
      top: (y1 + y2) / 2,
      fontSize: 10,
      fill: '#0ea5e9',
      angle: textAngle,
      originX: 'center',
      originY: 'bottom',
      fontFamily: 'Inter, sans-serif'
    })

    const group = new Group([line, ext1, ext2, text], {
      selectable: true,
      hasControls: false,
    })

    const elementId = generateId()
    setCustomProp(group, ELEMENT_ID_KEY, elementId)
    setCustomProp(group, NON_INTERACTIVE_KEY, true) // Don't export to G-code

    const element: CanvasElement = {
      id: elementId,
      type: 'cota',
      name: `Cota ${distMm.toFixed(1)}mm`,
      visible: true,
      locked: false,
      config: null,
      children: [],
      fabricObject: group,
      makerParams: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, dist: distMm }
    }

    addElement(element)
    canvas.add(group)
    canvas.requestRenderAll()
    pushToHistory()
  }, [addElement, pushToHistory])

  // Register a path created by split operation
  const addSplitPath = useCallback((fabricObj: FabricObject) => {
    const elementId = generateId()
    setCustomProp(fabricObj, ELEMENT_ID_KEY, elementId)
    const element: CanvasElement = {
      id: elementId,
      type: 'svg',
      name: `Path ${Date.now() % 1000}`,
      visible: true,
      locked: false,
      config: null,
      children: [],
      fabricObject: fabricObj,
    }
    addElement(element)
    markGCodeStale()
  }, [addElement])

  return {
    setCanvas,
    loadSVG,
    loadDXF,
    loadImage,
    addRasterToCanvas,
    addShape,
    addShapeAt,
    addPolyline,
    addArc,
    addBezierCurve,
    addTextPath,
    updateMakerParams,
    removeObject,
    toggleVisibility,
    toggleLock,
    zoomIn,
    zoomOut,
    fitView,
    fitSelection,
    flipH,
    flipV,
    undo,
    redo,
    deleteSelected,
    duplicateSelected,
    selectAll,
    deselectAll,
    nudge,
    commitNudge,
    copySelected,
    paste,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    getPathsForGCode,
    getJobsForGCode,
    updateSelectedObjectProps,
    applyObjectProps,
    resizeSelected,
    alignToFirst,
    alignToWorkArea,
    distribute,
    groupSelected,
    ungroupSelected,
    booleanOperationSelected,
    offsetSelected,
    arrayRectangular,
    arrayPolar,
    mirrorSelected,
    exportSVG,
    exportDXF,
    addCota,
    addSplitPath,
  }
}

// ============================================
// Utility functions for G-code path extraction
// ============================================
function convertToMM(
  pixelPoints: Point2D[],
  originPos: { x: number; y: number },
  origin: string,
): Point2D[] {
  const flipY = origin.startsWith('bottom')
  return pixelPoints.map((p) => ({
    x: (p.x - originPos.x) / PIXELS_PER_MM,
    y: flipY
      ? (originPos.y - p.y) / PIXELS_PER_MM
      : (p.y - originPos.y) / PIXELS_PER_MM,
  }))
}

function extractPathPoints(
  pathObj: Path,
  originPos: { x: number; y: number },
  origin: string,
  parentGroup?: Group,
): Point2D[] {
  const points: Point2D[] = []
  const pathData = pathObj.path

  if (!pathData || !Array.isArray(pathData)) return points

  // Use calcTransformMatrix + pathOffset for correct positioning.
  // This accounts for Fabric's internal path centering (pathOffset)
  // and all transforms (position, rotation, scale, parent group).
  const matrix = parentGroup
    ? util.multiplyTransformMatrices(
        parentGroup.calcTransformMatrix(),
        pathObj.calcOwnMatrix(),
      )
    : pathObj.calcTransformMatrix()
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
        const linearizedC = linearizeCubicBezier(prevC, cp1, cp2, endC, 0.38)
        points.push(...linearizedC.slice(1))
        break
      }
      case 'Q': {
        const prevQ = points[points.length - 1] ?? txPt(0, 0)
        const cpQ = txPt(cmd[1], cmd[2])
        const endQ = txPt(cmd[3], cmd[4])
        const linearizedQ = linearizeQuadraticBezier(prevQ, cpQ, endQ, 0.38)
        points.push(...linearizedQ.slice(1))
        break
      }
      case 'Z':
        break
    }
  }

  return convertToMM(points, originPos, origin)
}

function isPathClosed(pathObj: Path): boolean {
  const pathData = pathObj.path
  if (!pathData || !Array.isArray(pathData) || pathData.length === 0) return false
  const lastCmd = pathData[pathData.length - 1]
  return lastCmd[0] === 'Z'
}

// Apply a 2D affine transform matrix [a, b, c, d, e, f] to a point
function applyMatrix(x: number, y: number, m: number[]): Point2D {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  }
}

// Extract paths from any FabricObject using its full transform matrix
// Works for both standalone objects and group children
function extractObjectPaths(
  obj: FabricObject,
  originPos: { x: number; y: number },
  origin: string,
): GCodePath[] {
  const paths: GCodePath[] = []
  const matrix = obj.calcTransformMatrix()

  if (obj instanceof Circle) {
    const r = obj.radius ?? 0
    const segments = 72
    const pts: Point2D[] = []
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pts.push(applyMatrix(r * Math.cos(a), r * Math.sin(a), matrix))
    }
    paths.push({ points: convertToMM(pts, originPos, origin), closed: true })
  } else if (obj instanceof Ellipse) {
    const rx = obj.rx ?? 0
    const ry = obj.ry ?? 0
    const segments = 72
    const pts: Point2D[] = []
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pts.push(applyMatrix(rx * Math.cos(a), ry * Math.sin(a), matrix))
    }
    paths.push({ points: convertToMM(pts, originPos, origin), closed: true })
  } else if (obj instanceof FabricPolygon) {
    const polyPts = obj.points
    if (polyPts && polyPts.length > 0) {
      const po = (obj as unknown as { pathOffset: { x: number; y: number } }).pathOffset ?? { x: 0, y: 0 }
      const pts: Point2D[] = polyPts.map((p) =>
        applyMatrix(p.x - po.x, p.y - po.y, matrix),
      )
      paths.push({ points: convertToMM(pts, originPos, origin), closed: true })
    }
  } else if (obj instanceof Rect) {
    const w = obj.width ?? 0
    const h = obj.height ?? 0
    const corners = [
      applyMatrix(-w / 2, -h / 2, matrix),
      applyMatrix(w / 2, -h / 2, matrix),
      applyMatrix(w / 2, h / 2, matrix),
      applyMatrix(-w / 2, h / 2, matrix),
    ]
    paths.push({ points: convertToMM(corners, originPos, origin), closed: true })
  }

  return paths
}

/**
 * Paso de grilla efectivo en mm para el zoom actual.
 *
 * Con la grilla adaptativa activa se elige el escalon 1/2/5 x 10^k mas chico
 * que todavia se vea separado en pantalla, asi la grilla se subdivide al
 * acercarse y se agrupa al alejarse en vez de desaparecer o empastarse.
 * `major` es cada cuantas lineas va la linea gruesa.
 */
export function effectiveGridSpacing(zoom: number): { spacingMm: number; major: number } {
  const { gridSpacingMm, gridAdaptive } = useCanvasStore.getState()
  const base = gridSpacingMm > 0 ? gridSpacingMm : 10

  if (!gridAdaptive) {
    return { spacingMm: base, major: GRID_MAJOR_EVERY }
  }

  const MIN_SCREEN_PX = 12
  const mantissas = [1, 2, 5]
  // Arranca bien abajo y sube hasta que la separacion en pantalla alcanza
  let decade = -2
  for (let i = 0; i < 12; i++) {
    for (const m of mantissas) {
      const candidate = m * Math.pow(10, decade)
      if (candidate * PIXELS_PER_MM * zoom >= MIN_SCREEN_PX) {
        // Linea gruesa en el salto de decada: 1 -> cada 10, 2 -> cada 5, 5 -> cada 2
        const major = m === 1 ? 10 : m === 2 ? 5 : 2
        return { spacingMm: candidate, major }
      }
    }
    decade++
  }
  return { spacingMm: base, major: GRID_MAJOR_EVERY }
}

/**
 * Escalon 1/2/5 x 10^k mas chico cuyo ancho en pantalla llega a `minPx`.
 * Sirve tanto para la grilla como para el espaciado de etiquetas de las reglas.
 */
export function niceStepMm(zoom: number, minPx: number): number {
  const mantissas = [1, 2, 5]
  let decade = -2
  for (let i = 0; i < 12; i++) {
    for (const m of mantissas) {
      const candidate = m * Math.pow(10, decade)
      if (candidate * PIXELS_PER_MM * zoom >= minPx) return candidate
    }
    decade++
  }
  return 100
}

/** Convierte un punto del canvas (px) a mm respecto al origen del area. */
export function canvasToMm(
  canvasX: number,
  canvasY: number,
  workArea: { width: number; height: number; origin: string },
): { x: number; y: number } {
  const originPos = getOriginPixels(
    workArea.origin,
    workArea.width * PIXELS_PER_MM,
    workArea.height * PIXELS_PER_MM,
    WORK_AREA_PADDING,
    WORK_AREA_PADDING,
  )
  const flipY = workArea.origin.startsWith('bottom')
  return {
    x: (canvasX - originPos.x) / PIXELS_PER_MM,
    y: flipY
      ? (originPos.y - canvasY) / PIXELS_PER_MM
      : (canvasY - originPos.y) / PIXELS_PER_MM,
  }
}

/** Inverso de canvasToMm: mm -> px del canvas. */
export function mmToCanvas(
  mmX: number,
  mmY: number,
  workArea: { width: number; height: number; origin: string },
): { x: number; y: number } {
  const originPos = getOriginPixels(
    workArea.origin,
    workArea.width * PIXELS_PER_MM,
    workArea.height * PIXELS_PER_MM,
    WORK_AREA_PADDING,
    WORK_AREA_PADDING,
  )
  const flipY = workArea.origin.startsWith('bottom')
  return {
    x: originPos.x + mmX * PIXELS_PER_MM,
    y: flipY ? originPos.y - mmY * PIXELS_PER_MM : originPos.y + mmY * PIXELS_PER_MM,
  }
}

// Re-export constants for use in DesignCanvas
export {
  PIXELS_PER_MM,
  WORK_AREA_PADDING,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  GRID_SPACING_MM,
  GRID_MAJOR_EVERY,
  ELEMENT_ID_KEY,
  NON_INTERACTIVE_KEY,
  getCustomProp,
  getOriginPixels,
}
