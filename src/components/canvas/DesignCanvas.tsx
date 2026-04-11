import { useRef, useEffect } from 'react'
import { useCanvasStore } from '@/stores/useCanvasStore'

export function DesignCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { workArea } = useCanvasStore()

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return

    // TODO: Initialize Fabric.js canvas manager here
    // This is a placeholder - the actual Fabric.js initialization
    // will be done when we port canvas-manager.ts
    const canvas = canvasRef.current
    const container = containerRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
      drawGrid(ctx, canvas.width, canvas.height)
    }

    const drawGrid = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.fillStyle = '#F0F0F0'
      ctx.fillRect(0, 0, w, h)

      const pixelsPerMM = Math.min(w, h) * 0.8 / Math.max(workArea.width, workArea.height)
      const workW = workArea.width * pixelsPerMM
      const workH = workArea.height * pixelsPerMM
      const offsetX = (w - workW) / 2
      const offsetY = (h - workH) / 2

      // Work area background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.fillRect(offsetX, offsetY, workW, workH)

      // Grid lines
      const gridSpacing = 20 * pixelsPerMM // 20mm grid
      ctx.strokeStyle = '#B5A8D6'
      ctx.lineWidth = 0.5

      for (let x = 0; x <= workW; x += gridSpacing) {
        ctx.beginPath()
        ctx.moveTo(offsetX + x, offsetY)
        ctx.lineTo(offsetX + x, offsetY + workH)
        ctx.stroke()
      }

      for (let y = 0; y <= workH; y += gridSpacing) {
        ctx.beginPath()
        ctx.moveTo(offsetX, offsetY + y)
        ctx.lineTo(offsetX + workW, offsetY + y)
        ctx.stroke()
      }

      // Work area border
      ctx.strokeStyle = '#5B4B9F'
      ctx.lineWidth = 2
      ctx.strokeRect(offsetX, offsetY, workW, workH)

      // Origin marker
      const origin = workArea.origin
      let originX = offsetX
      let originY = offsetY + workH

      if (origin === 'center') {
        originX = offsetX + workW / 2
        originY = offsetY + workH / 2
      } else if (origin === 'top-left') {
        originX = offsetX
        originY = offsetY
      } else if (origin === 'top-right') {
        originX = offsetX + workW
        originY = offsetY
      } else if (origin === 'bottom-right') {
        originX = offsetX + workW
        originY = offsetY + workH
      }

      // X axis (red)
      ctx.strokeStyle = '#FF0000'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(originX, originY)
      ctx.lineTo(originX + 30, originY)
      ctx.stroke()

      // Y axis (green)
      ctx.strokeStyle = '#00FF00'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(originX, originY)
      ctx.lineTo(originX, originY - 30)
      ctx.stroke()

      // Origin dot
      ctx.fillStyle = '#FFD700'
      ctx.strokeStyle = '#2D1B69'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(originX, originY, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Area size label
      ctx.fillStyle = '#5B4B9F'
      ctx.font = '11px system-ui'
      ctx.fillText(`${workArea.width} x ${workArea.height} mm`, offsetX + 4, offsetY + workH - 4)
    }

    resize()

    const observer = new ResizeObserver(() => resize())
    observer.observe(container)

    return () => observer.disconnect()
  }, [workArea])

  return (
    <div ref={containerRef} className="canvas-container w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  )
}
