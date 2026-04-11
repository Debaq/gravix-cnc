import { useRef, useEffect, useCallback } from 'react'
import { Canvas, Point } from 'fabric'
import { useCanvasStore } from '@/stores/useCanvasStore'
import {
  useCanvasManager,
  buildWorkAreaObjects,
  PIXELS_PER_MM,
  WORK_AREA_PADDING,
  MIN_ZOOM,
  MAX_ZOOM,
  NON_INTERACTIVE_KEY,
  ELEMENT_ID_KEY,
  getCustomProp,
} from '@/hooks/useCanvasManager'

export function DesignCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const isPanning = useRef(false)
  const lastPanPoint = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const { workArea, showGrid, selectElement } = useCanvasStore()
  const { setCanvas } = useCanvasManager()

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

    // ---- Event: Middle-click / Shift+click panning ----
    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent
      if (evt.button === 1 || (evt.shiftKey && evt.button === 0)) {
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

    // ---- Event: Object selection -> sync with store ----
    canvas.on('selection:created', (opt) => {
      const selected = opt.selected
      if (selected && selected.length === 1) {
        const elId = getCustomProp(selected[0], ELEMENT_ID_KEY)
        if (typeof elId === 'string') {
          selectElement(elId)
        }
      }
    })

    canvas.on('selection:updated', (opt) => {
      const selected = opt.selected
      if (selected && selected.length === 1) {
        const elId = getCustomProp(selected[0], ELEMENT_ID_KEY)
        if (typeof elId === 'string') {
          selectElement(elId)
        }
      }
    })

    canvas.on('selection:cleared', () => {
      selectElement(null)
    })

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

  return (
    <div ref={containerRef} className="canvas-container w-full h-full relative">
      <canvas ref={canvasElRef} />
    </div>
  )
}
