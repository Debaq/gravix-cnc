import { useCallback, useRef } from 'react'
import {
  Canvas,
  Rect,
  Circle,
  Line,
  Path,
  Group,
  FabricObject,
  loadSVGFromString,
  Point,
  util,
} from 'fabric'
import { useCanvasStore } from '@/stores/useCanvasStore'
import type { CanvasElement, GCodePath, Point2D } from '@/lib/types'

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

  // Grid lines
  if (showGrid) {
    const gridPx = GRID_SPACING_MM * PIXELS_PER_MM

    for (let x = gridPx; x < workW; x += gridPx) {
      const line = new Line([offsetX + x, offsetY, offsetX + x, offsetY + workH], {
        stroke: '#B5A8D6',
        strokeWidth: 0.5,
        selectable: false,
        evented: false,
        hoverCursor: 'default',
      })
      setCustomProp(line, NON_INTERACTIVE_KEY, true)
      objects.push(line)
    }

    for (let y = gridPx; y < workH; y += gridPx) {
      const line = new Line([offsetX, offsetY + y, offsetX + workW, offsetY + y], {
        stroke: '#B5A8D6',
        strokeWidth: 0.5,
        selectable: false,
        evented: false,
        hoverCursor: 'default',
      })
      setCustomProp(line, NON_INTERACTIVE_KEY, true)
      objects.push(line)
    }
  }

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
// Hook: useCanvasManager
// ============================================
export function useCanvasManager() {
  const fabricCanvasRef = useRef<Canvas | null>(null)

  const {
    addElement,
    removeElement,
    updateElement,
    selectElement,
    setSvgDimensions,
  } = useCanvasStore()

  // ------------------------------------------
  // Set canvas ref (called from DesignCanvas)
  // ------------------------------------------
  const setCanvas = useCallback((canvas: Canvas | null) => {
    fabricCanvasRef.current = canvas
    setSharedCanvas(canvas)
  }, [])

  // ------------------------------------------
  // Load SVG from File
  // ------------------------------------------
  const loadSVG = useCallback(
    async (file: File) => {
      const canvas = fabricCanvasRef.current
      if (!canvas) return

      const text = await file.text()
      const { objects, options } = await loadSVGFromString(text)

      const validObjects = objects.filter(
        (obj): obj is FabricObject => obj !== null,
      )

      if (validObjects.length === 0) return

      const group = util.groupSVGElements(validObjects, options)

      // Place the SVG in the work area
      group.set({
        left: WORK_AREA_PADDING + 10,
        top: WORK_AREA_PADDING + 10,
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
    },
    [addElement, selectElement, setSvgDimensions],
  )

  // ------------------------------------------
  // Add basic shape
  // ------------------------------------------
  const addShape = useCallback(
    (type: string) => {
      const canvas = fabricCanvasRef.current
      if (!canvas) return

      const elementId = generateId()
      const defaultSize = 50 * PIXELS_PER_MM // 50mm

      let fabricObj: FabricObject

      switch (type) {
        case 'rect':
          fabricObj = new Rect({
            left: WORK_AREA_PADDING + 20,
            top: WORK_AREA_PADDING + 20,
            width: defaultSize,
            height: defaultSize,
            fill: 'transparent',
            stroke: '#333333',
            strokeWidth: 1,
          })
          break
        case 'circle':
          fabricObj = new Circle({
            left: WORK_AREA_PADDING + 20,
            top: WORK_AREA_PADDING + 20,
            radius: defaultSize / 2,
            fill: 'transparent',
            stroke: '#333333',
            strokeWidth: 1,
          })
          break
        case 'line':
          fabricObj = new Line(
            [
              WORK_AREA_PADDING + 20,
              WORK_AREA_PADDING + 20,
              WORK_AREA_PADDING + 20 + defaultSize,
              WORK_AREA_PADDING + 20 + defaultSize,
            ],
            {
              stroke: '#333333',
              strokeWidth: 1,
            },
          )
          break
        default:
          return
      }

      setCustomProp(fabricObj, ELEMENT_ID_KEY, elementId)

      canvas.add(fabricObj)
      canvas.setActiveObject(fabricObj)
      canvas.requestRenderAll()

      const element: CanvasElement = {
        id: elementId,
        type: type as CanvasElement['type'],
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${Date.now() % 1000}`,
        visible: true,
        locked: false,
        config: null,
        children: [],
        fabricObject: fabricObj,
      }

      addElement(element)
      selectElement(elementId)
    },
    [addElement, selectElement],
  )

  // ------------------------------------------
  // Remove object by element ID
  // ------------------------------------------
  const removeObject = useCallback(
    (elementId: string) => {
      const canvas = fabricCanvasRef.current
      if (!canvas) return

      const obj = canvas
        .getObjects()
        .find((o) => getCustomProp(o, ELEMENT_ID_KEY) === elementId)

      if (obj) {
        canvas.remove(obj)
        canvas.requestRenderAll()
      }

      removeElement(elementId)
    },
    [removeElement],
  )

  // ------------------------------------------
  // Toggle visibility
  // ------------------------------------------
  const toggleVisibility = useCallback(
    (elementId: string) => {
      const canvas = fabricCanvasRef.current
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
      const canvas = fabricCanvasRef.current
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
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const currentZoom = canvas.getZoom()
    const newZoom = Math.min(currentZoom * ZOOM_STEP, MAX_ZOOM)
    const center = canvas.getCenterPoint()
    canvas.zoomToPoint(new Point(center.x, center.y), newZoom)
    canvas.requestRenderAll()
  }, [])

  const zoomOut = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const currentZoom = canvas.getZoom()
    const newZoom = Math.max(currentZoom / ZOOM_STEP, MIN_ZOOM)
    const center = canvas.getCenterPoint()
    canvas.zoomToPoint(new Point(center.x, center.y), newZoom)
    canvas.requestRenderAll()
  }, [])

  const fitView = useCallback(() => {
    const canvas = fabricCanvasRef.current
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

  // ------------------------------------------
  // Flip controls
  // ------------------------------------------
  const flipH = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return

    const active = canvas.getActiveObject()
    if (!active) return

    active.set({ flipX: !active.flipX })
    canvas.requestRenderAll()
  }, [])

  const flipV = useCallback(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return

    const active = canvas.getActiveObject()
    if (!active) return

    active.set({ flipY: !active.flipY })
    canvas.requestRenderAll()
  }, [])

  // ------------------------------------------
  // Extract paths for G-code generation
  // ------------------------------------------
  const getPathsForGCode = useCallback((): GCodePath[] => {
    const canvas = fabricCanvasRef.current
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
      } else if (obj instanceof Group) {
        const groupObjects = obj.getObjects()
        for (const child of groupObjects) {
          if (child instanceof Path) {
            const pathPoints = extractPathPoints(child, originPos, wa.origin, obj)
            if (pathPoints.length > 0) {
              paths.push({ points: pathPoints, closed: isPathClosed(child) })
            }
          }
        }
      }
    }

    return paths
  }, [])

  return {
    fabricCanvasRef,
    setCanvas,
    loadSVG,
    addShape,
    removeObject,
    toggleVisibility,
    toggleLock,
    zoomIn,
    zoomOut,
    fitView,
    flipH,
    flipV,
    getPathsForGCode,
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

  const offsetX = (pathObj.left ?? 0) + (parentGroup?.left ?? 0)
  const offsetY = (pathObj.top ?? 0) + (parentGroup?.top ?? 0)
  const scaleX = (pathObj.scaleX ?? 1) * (parentGroup?.scaleX ?? 1)
  const scaleY = (pathObj.scaleY ?? 1) * (parentGroup?.scaleY ?? 1)

  for (const cmd of pathData) {
    const command = cmd[0]
    switch (command) {
      case 'M':
      case 'L':
        points.push({
          x: cmd[1] * scaleX + offsetX,
          y: cmd[2] * scaleY + offsetY,
        })
        break
      case 'C':
        // Cubic bezier: use endpoint (cmd[5], cmd[6])
        points.push({
          x: cmd[5] * scaleX + offsetX,
          y: cmd[6] * scaleY + offsetY,
        })
        break
      case 'Q':
        // Quadratic bezier: use endpoint (cmd[3], cmd[4])
        points.push({
          x: cmd[3] * scaleX + offsetX,
          y: cmd[4] * scaleY + offsetY,
        })
        break
      case 'Z':
        // Close path — nothing to add
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

// Re-export constants for use in DesignCanvas
export {
  PIXELS_PER_MM,
  WORK_AREA_PADDING,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  ELEMENT_ID_KEY,
  NON_INTERACTIVE_KEY,
  getCustomProp,
}
