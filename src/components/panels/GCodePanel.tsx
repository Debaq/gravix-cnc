import { useTranslation } from 'react-i18next'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useSerial } from '@/hooks/useSerial'
import { useProject } from '@/hooks/useProject'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Code, Download, Send, Copy, Cog, AlertTriangle, Square } from 'lucide-react'
import { GCodeGenerator } from '@/lib/gcode-generator'
import type { GCodePath, Point2D } from '@/lib/types'

/**
 * Extrae GCodePath[] de los elementos del canvas.
 * Para elementos SVG con svgData, parsea el SVG y extrae los puntos de los paths.
 * Para formas basicas, genera paths geometricos simples.
 */
function extractPathsFromElements(elements: ReturnType<typeof useCanvasStore.getState>['elements']): GCodePath[] {
  const paths: GCodePath[] = []

  for (const el of elements) {
    if (!el.visible) continue

    if (el.type === 'svg' && el.svgData) {
      const svgPaths = parseSVGPaths(el.svgData)
      paths.push(...svgPaths)
    } else if (el.type === 'rect') {
      const w = (el.makerParams?.width as number) ?? 50
      const h = (el.makerParams?.height as number) ?? 30
      paths.push({
        points: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
          { x: 0, y: 0 },
        ],
        closed: true,
      })
    } else if (el.type === 'circle') {
      const r = (el.makerParams?.radius as number) ?? 25
      const segments = 36
      const points: Point2D[] = []
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        points.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) })
      }
      paths.push({ points, closed: true })
    } else if (el.type === 'line') {
      const length = (el.makerParams?.length as number) ?? 50
      paths.push({
        points: [
          { x: 0, y: 0 },
          { x: length, y: 0 },
        ],
        closed: false,
      })
    } else if (el.type === 'maker' && el.makerParams) {
      // Generar path basico segun makerType
      const makerPath = generateMakerPath(el.makerType ?? '', el.makerParams)
      if (makerPath) paths.push(makerPath)
    }

    // Procesar hijos tambien
    if (el.children) {
      const childPaths = extractPathsFromElements(el.children)
      paths.push(...childPaths)
    }
  }

  return paths
}

function parseSVGPaths(svgData: string): GCodePath[] {
  const paths: GCodePath[] = []
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgData, 'image/svg+xml')
  const pathElements = doc.querySelectorAll('path, line, rect, circle, ellipse, polyline, polygon')

  pathElements.forEach((pathEl) => {
    const tag = pathEl.tagName.toLowerCase()

    if (tag === 'path') {
      const d = pathEl.getAttribute('d')
      if (d) {
        const points = parsePathD(d)
        if (points.length >= 2) {
          const closed = d.toLowerCase().includes('z')
          paths.push({ points, closed })
        }
      }
    } else if (tag === 'line') {
      const x1 = parseFloat(pathEl.getAttribute('x1') ?? '0')
      const y1 = parseFloat(pathEl.getAttribute('y1') ?? '0')
      const x2 = parseFloat(pathEl.getAttribute('x2') ?? '0')
      const y2 = parseFloat(pathEl.getAttribute('y2') ?? '0')
      paths.push({ points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], closed: false })
    } else if (tag === 'rect') {
      const x = parseFloat(pathEl.getAttribute('x') ?? '0')
      const y = parseFloat(pathEl.getAttribute('y') ?? '0')
      const w = parseFloat(pathEl.getAttribute('width') ?? '0')
      const h = parseFloat(pathEl.getAttribute('height') ?? '0')
      paths.push({
        points: [
          { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y },
        ],
        closed: true,
      })
    } else if (tag === 'circle') {
      const cx = parseFloat(pathEl.getAttribute('cx') ?? '0')
      const cy = parseFloat(pathEl.getAttribute('cy') ?? '0')
      const r = parseFloat(pathEl.getAttribute('r') ?? '0')
      const segments = 36
      const points: Point2D[] = []
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
      }
      paths.push({ points, closed: true })
    } else if (tag === 'ellipse') {
      const cx = parseFloat(pathEl.getAttribute('cx') ?? '0')
      const cy = parseFloat(pathEl.getAttribute('cy') ?? '0')
      const rx = parseFloat(pathEl.getAttribute('rx') ?? '0')
      const ry = parseFloat(pathEl.getAttribute('ry') ?? '0')
      const segments = 36
      const points: Point2D[] = []
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) })
      }
      paths.push({ points, closed: true })
    } else if (tag === 'polyline' || tag === 'polygon') {
      const pointsStr = pathEl.getAttribute('points') ?? ''
      const points = pointsStr
        .trim()
        .split(/[\s,]+/)
        .reduce<Point2D[]>((acc, _, i, arr) => {
          if (i % 2 === 0 && i + 1 < arr.length) {
            acc.push({ x: parseFloat(arr[i]), y: parseFloat(arr[i + 1]) })
          }
          return acc
        }, [])
      if (points.length >= 2) {
        const closed = tag === 'polygon'
        if (closed) points.push({ ...points[0] })
        paths.push({ points, closed })
      }
    }
  })

  return paths
}

/**
 * Parser simplificado de path d="" de SVG.
 * Soporta M, L, H, V, Z (absolutos y relativos).
 */
function parsePathD(d: string): Point2D[] {
  const points: Point2D[] = []
  let currentX = 0
  let currentY = 0

  // Tokenizar: dividir en comandos y numeros
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens) return points

  let i = 0
  let cmd = ''

  const nextNum = (): number => {
    if (i < tokens.length && /[-+\d.]/.test(tokens[i][0])) {
      return parseFloat(tokens[i++])
    }
    return 0
  }

  while (i < tokens.length) {
    const token = tokens[i]
    if (/[a-zA-Z]/.test(token)) {
      cmd = token
      i++
    }

    switch (cmd) {
      case 'M':
        currentX = nextNum()
        currentY = nextNum()
        points.push({ x: currentX, y: currentY })
        cmd = 'L' // Subsequent coords are treated as L
        break
      case 'm':
        currentX += nextNum()
        currentY += nextNum()
        points.push({ x: currentX, y: currentY })
        cmd = 'l'
        break
      case 'L':
        currentX = nextNum()
        currentY = nextNum()
        points.push({ x: currentX, y: currentY })
        break
      case 'l':
        currentX += nextNum()
        currentY += nextNum()
        points.push({ x: currentX, y: currentY })
        break
      case 'H':
        currentX = nextNum()
        points.push({ x: currentX, y: currentY })
        break
      case 'h':
        currentX += nextNum()
        points.push({ x: currentX, y: currentY })
        break
      case 'V':
        currentY = nextNum()
        points.push({ x: currentX, y: currentY })
        break
      case 'v':
        currentY += nextNum()
        points.push({ x: currentX, y: currentY })
        break
      case 'Z':
      case 'z':
        if (points.length > 0) {
          points.push({ ...points[0] })
        }
        i++ // skip any more Z processing
        break
      default:
        // Para C, S, Q, T, A - avanzar los params sin procesar curvas (simplificacion)
        // Solo tomamos el punto final
        if (cmd === 'C') {
          nextNum(); nextNum(); nextNum(); nextNum()
          currentX = nextNum()
          currentY = nextNum()
          points.push({ x: currentX, y: currentY })
        } else if (cmd === 'c') {
          nextNum(); nextNum(); nextNum(); nextNum()
          const dx = nextNum()
          const dy = nextNum()
          currentX += dx
          currentY += dy
          points.push({ x: currentX, y: currentY })
        } else if (cmd === 'S' || cmd === 'Q') {
          nextNum(); nextNum()
          currentX = nextNum()
          currentY = nextNum()
          points.push({ x: currentX, y: currentY })
        } else if (cmd === 's' || cmd === 'q') {
          nextNum(); nextNum()
          const dx = nextNum()
          const dy = nextNum()
          currentX += dx
          currentY += dy
          points.push({ x: currentX, y: currentY })
        } else if (cmd === 'A') {
          nextNum(); nextNum(); nextNum(); nextNum(); nextNum()
          currentX = nextNum()
          currentY = nextNum()
          points.push({ x: currentX, y: currentY })
        } else if (cmd === 'a') {
          nextNum(); nextNum(); nextNum(); nextNum(); nextNum()
          const dx = nextNum()
          const dy = nextNum()
          currentX += dx
          currentY += dy
          points.push({ x: currentX, y: currentY })
        } else if (cmd === 'T') {
          currentX = nextNum()
          currentY = nextNum()
          points.push({ x: currentX, y: currentY })
        } else if (cmd === 't') {
          currentX += nextNum()
          currentY += nextNum()
          points.push({ x: currentX, y: currentY })
        } else {
          // Comando desconocido, avanzar
          i++
        }
        break
    }
  }

  return points
}

function generateMakerPath(makerType: string, params: Record<string, number | string | number[]>): GCodePath | null {
  const w = (params.width as number) ?? 50
  const h = (params.height as number) ?? 30
  const side = (params.side as number) ?? 40
  const r = (params.radius as number) ?? 25
  const segments = 36

  switch (makerType) {
    case 'Rectangle':
      return {
        points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }, { x: 0, y: 0 }],
        closed: true,
      }
    case 'Square':
      return {
        points: [{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }, { x: 0, y: 0 }],
        closed: true,
      }
    case 'RoundRectangle': {
      const corner = (params.corner as number) ?? 5
      const pts: Point2D[] = []
      // Esquinas redondeadas simplificadas
      const arcSegs = 4
      const corners = [
        { cx: corner, cy: corner, startAngle: Math.PI, endAngle: Math.PI * 1.5 },
        { cx: w - corner, cy: corner, startAngle: Math.PI * 1.5, endAngle: Math.PI * 2 },
        { cx: w - corner, cy: h - corner, startAngle: 0, endAngle: Math.PI * 0.5 },
        { cx: corner, cy: h - corner, startAngle: Math.PI * 0.5, endAngle: Math.PI },
      ]
      for (const c of corners) {
        for (let i = 0; i <= arcSegs; i++) {
          const angle = c.startAngle + (c.endAngle - c.startAngle) * (i / arcSegs)
          pts.push({ x: c.cx + corner * Math.cos(angle), y: c.cy + corner * Math.sin(angle) })
        }
      }
      pts.push({ ...pts[0] })
      return { points: pts, closed: true }
    }
    case 'Oval':
    case 'Ellipse': {
      const rx = (params.radiusX as number) ?? w / 2
      const ry = (params.radiusY as number) ?? h / 2
      const pts: Point2D[] = []
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        pts.push({ x: rx + rx * Math.cos(angle), y: ry + ry * Math.sin(angle) })
      }
      return { points: pts, closed: true }
    }
    case 'Ring': {
      const outer = (params.outerRadius as number) ?? 30
      const inner = (params.innerRadius as number) ?? 20
      const outerPts: Point2D[] = []
      const innerPts: Point2D[] = []
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        outerPts.push({ x: outer * Math.cos(angle), y: outer * Math.sin(angle) })
        innerPts.push({ x: inner * Math.cos(angle), y: inner * Math.sin(angle) })
      }
      // Retornar solo el path exterior; el interior se procesaria por separado en un caso real
      return { points: outerPts, closed: true }
    }
    case 'Polygon': {
      const sides = (params.sides as number) ?? 6
      const pts: Point2D[] = []
      for (let i = 0; i <= sides; i++) {
        const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
        pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) })
      }
      return { points: pts, closed: true }
    }
    case 'Star': {
      const starPoints = (params.points as number) ?? 5
      const outerR = (params.outerRadius as number) ?? 30
      const innerR = (params.innerRadius as number) ?? 15
      const pts: Point2D[] = []
      for (let i = 0; i <= starPoints * 2; i++) {
        const angle = (i / (starPoints * 2)) * Math.PI * 2 - Math.PI / 2
        const radius = i % 2 === 0 ? outerR : innerR
        pts.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
      }
      pts.push({ ...pts[0] })
      return { points: pts, closed: true }
    }
    case 'Slot':
      return {
        points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }, { x: 0, y: 0 }],
        closed: true,
      }
    case 'Dome':
      return {
        points: [{ x: 0, y: h }, { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
        closed: true,
      }
    default:
      return null
  }
}

export function GCodePanel() {
  const { t } = useTranslation('gcode')
  const { gcode, gcodeGenerated, gcodeLines, gcodeNeedsRegeneration, estimates } = useGCodeStore()
  const { elements, globalConfig } = useCanvasStore()
  const { addConsoleLine } = useAppStore()
  const { setGCode, setEstimates } = useGCodeStore()
  const { connected, sending, sendProgress } = useSerialStore()
  const serial = useSerial()
  const project = useProject()

  const handleGenerate = () => {
    if (elements.length === 0) {
      addConsoleLine('No hay elementos para generar G-code')
      return
    }

    addConsoleLine('Generando G-code...')

    const paths = extractPathsFromElements(elements)

    if (paths.length === 0) {
      addConsoleLine('No se encontraron paths validos en los elementos')
      return
    }

    const generator = new GCodeGenerator()
    const result = generator.generate(paths, globalConfig, globalConfig.operationType)
    const est = generator.getEstimates()

    setGCode(result)
    setEstimates({
      time: est.time > 60 ? `${(est.time / 60).toFixed(1)} min` : `${est.time.toFixed(0)} seg`,
      distance: est.distance > 1000 ? `${(est.distance / 1000).toFixed(2)} m` : `${est.distance.toFixed(1)} mm`,
    })

    const lineCount = result.split('\n').length
    addConsoleLine(`G-code generado: ${lineCount} lineas, ${paths.length} paths`)
  }

  const handleDownload = () => {
    if (!gcodeGenerated) return
    project.downloadGCode(gcode, 'output.gcode')
  }

  const handleCopy = () => {
    if (!gcodeGenerated) return
    navigator.clipboard.writeText(gcode)
    addConsoleLine('G-code copiado al portapapeles')
  }

  const handleSend = () => {
    if (!gcodeGenerated || !connected || sending) return
    serial.sendGCode(gcode)
  }

  const handleCancelSend = () => {
    serial.cancelSend()
  }

  return (
    <div className="absolute bottom-12 right-2 z-20 w-80 bg-background border rounded-lg shadow-lg max-h-[50vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4" />
          <span className="text-sm font-semibold">{t('preview')}</span>
          {gcodeGenerated && (
            <Badge variant="secondary" className="text-xs">
              {gcodeLines} {t('lines')}
            </Badge>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 px-3 py-2 border-b">
        <Button
          variant={gcodeNeedsRegeneration ? 'destructive' : 'default'}
          size="sm"
          className="flex-1 gap-1"
          onClick={handleGenerate}
        >
          {gcodeNeedsRegeneration ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            <Cog className="h-3 w-3" />
          )}
          {t('generate')}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={handleCopy}
          disabled={!gcodeGenerated}
          title={t('copy')}
        >
          <Copy className="h-3 w-3" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={handleDownload}
          disabled={!gcodeGenerated}
          title={t('download')}
        >
          <Download className="h-3 w-3" />
        </Button>
        {sending ? (
          <Button
            variant="destructive"
            size="icon"
            className="h-8 w-8"
            onClick={handleCancelSend}
            title={t('stop')}
          >
            <Square className="h-3 w-3" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleSend}
            disabled={!gcodeGenerated || !connected}
            title={t('sendToGRBL')}
          >
            <Send className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Progress bar */}
      {sending && (
        <div className="px-3 py-1.5 border-b">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">{t('sendToGRBL')}...</span>
            <span className="text-xs font-mono">{Math.round(sendProgress)}%</span>
          </div>
          <Progress value={sendProgress} />
        </div>
      )}

      {/* G-code preview */}
      <ScrollArea className="flex-1 max-h-[300px]">
        {gcodeGenerated ? (
          <pre className="p-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
            {gcode}
          </pre>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t('noGCode')}
          </div>
        )}
      </ScrollArea>

      {/* Stats footer */}
      {gcodeGenerated && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t text-xs text-muted-foreground">
          <span>{t('time')}: {estimates.time}</span>
          <span>{t('distance')}: {estimates.distance}</span>
        </div>
      )}
    </div>
  )
}
