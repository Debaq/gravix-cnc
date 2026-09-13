import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCAMStore } from '@/stores/useCAMStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { parseGCode } from '@/lib/gcode-parser'
import { resolveStock } from '@/lib/cam-jobs'
import {
  movesFromSegments,
  pickCellSize,
  MOVE_STRIDE,
  type HeightmapResult,
  type PackedMoves,
  type SimTool,
  type ToolShape,
} from '@/lib/heightmap'
import type { SimRequest, SimResponse } from '@/lib/heightmap.worker'
import SimWorker from '@/lib/heightmap.worker?worker'

/** Traduce el tipo de la libreria a la forma que entiende el simulador. */
function shapeFromToolType(type: string | undefined): ToolShape {
  if (type === 'ballnose') return 'ballnose'
  if (type === 'vbit') return 'vbit'
  return 'endmill'
}

export interface MaterialSimState {
  enabled: boolean
  running: boolean
  result: HeightmapResult | null
  error: string | null
  /** Hay stock y G-code: sin eso no hay nada que simular. */
  available: boolean
  toggle: () => void
}

/**
 * Simulacion de remocion sobre el bloque de material.
 *
 * Se recalcula cuando cambia el G-code, el stock o la posicion de la linea de
 * tiempo. El pedido va con un id y las respuestas viejas se descartan: durante
 * un arrastre del slider se encolan varias y solo importa la ultima.
 */
export function useMaterialSim(): MaterialSimState {
  const gcode = useGCodeStore((s) => s.gcode)
  const animationProgress = useGCodeStore((s) => s.animationProgress)
  const stockConfig = useCAMStore((s) => s.setup.stock)
  const operations = useCAMStore((s) => s.operations)
  const globalConfig = useCanvasStore((s) => s.globalConfig)
  const tools = useLibraryStore((s) => s.tools)

  const enabled = useGCodeStore((s) => s.simEnabled)
  const toggle = useGCodeStore((s) => s.toggleSim)
  const running = useGCodeStore((s) => s.simRunning)
  const setRunning = useGCodeStore((s) => s.setSimRunning)
  const [result, setResult] = useState<HeightmapResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const parsed = useMemo(() => (gcode ? parseGCode(gcode) : null), [gcode])

  const moves: PackedMoves = useMemo(
    () => (parsed ? movesFromSegments(parsed.segments) : new Float32Array(0)),
    [parsed],
  )
  const moveCount = moves.length / MOVE_STRIDE

  // Bbox del recorrido de corte, para el stock automatico
  const bbox = useMemo(() => {
    if (!parsed) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const seg of parsed.segments) {
      if (seg.type !== 'cut') continue
      minX = Math.min(minX, seg.from.x, seg.to.x)
      maxX = Math.max(maxX, seg.from.x, seg.to.x)
      minY = Math.min(minY, seg.from.y, seg.to.y)
      maxY = Math.max(maxY, seg.from.y, seg.to.y)
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
  }, [parsed])

  const stock = useMemo(() => resolveStock(stockConfig, bbox), [stockConfig, bbox])

  // La herramienta de la primera operacion CNC manda: simular un cambio de
  // herramienta a mitad de camino pide seguir la marca M6, que es trabajo de
  // otra pasada.
  const tool: SimTool = useMemo(() => {
    const cncOp = operations.find((o) => o.config.operationType === 'cnc' && o.enabled)
    const config = cncOp?.config ?? globalConfig
    const libTool = config.tool ? tools.find((t) => t.id === config.tool) : null
    return {
      shape: shapeFromToolType(libTool?.type),
      radius: Math.max(0.05, (libTool?.diameter ?? config.toolDiameter) / 2),
      angle: libTool?.angle ?? config.vcarveAngle ?? 90,
    }
  }, [operations, globalConfig, tools])

  const available = stockConfig.enabled && moveCount > 0 && stock.width > 0 && stock.height > 0

  // Identifica el conjunto simulado: si algo de esto cambia, el estado que el
  // worker tiene cacheado ya no sirve para seguir tallando.
  const datasetKey = useMemo(
    () => JSON.stringify([
      moves.length, tool.shape, tool.radius, tool.angle,
      stock.x, stock.y, stock.width, stock.height, stock.thickness, stock.zeroAt,
    ]),
    [moves.length, tool, stock],
  )

  useEffect(() => {
    if (!enabled) return
    const worker = new SimWorker()
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<SimResponse>) => {
      const data = event.data
      // Solo interesa la respuesta al ultimo pedido
      if (data.requestId !== requestIdRef.current) return
      setRunning(false)
      if (data.ok) {
        setResult(data.result)
        setError(null)
      } else {
        setResult(null)
        setError(data.error)
      }
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [enabled])

  const request = useCallback((upTo: number) => {
    const worker = workerRef.current
    if (!worker) return

    requestIdRef.current += 1
    setRunning(true)
    const payload: SimRequest = {
      requestId: requestIdRef.current,
      datasetKey,
      stock: {
        x: stock.x,
        y: stock.y,
        width: stock.width,
        height: stock.height,
        thickness: stock.thickness,
        zeroAt: stock.zeroAt,
      },
      tool,
      moves,
      upTo,
      cellSize: pickCellSize(stock.width, stock.height),
    }
    worker.postMessage(payload)
  }, [stock, tool, moves, datasetKey])

  useEffect(() => {
    if (!enabled || !available) {
      setResult(null)
      return
    }

    // Un arrastre del slider dispara decenas de cambios: se espera a que pare
    const upTo = Math.max(1, Math.round((animationProgress / 100) * moveCount))
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => request(upTo), 120)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, available, animationProgress, moveCount, request])

  return { enabled, running, result, error, available, toggle }
}
