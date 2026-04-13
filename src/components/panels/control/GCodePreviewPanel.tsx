import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { FileCode, Eye } from 'lucide-react'

export function GCodePreviewPanel() {
  const { t } = useTranslation('serial')
  const { activeGCode, activeGCodeName, activeGCodeLine, activeGCodeTotal } = useWorkflowStore()
  const { sending, sendProgress, machineState } = useSerialStore()

  const lines = activeGCode ? activeGCode.split('\n') : []
  const progressPercent = sending ? sendProgress : (activeGCodeTotal > 0 ? (activeGCodeLine / activeGCodeTotal) * 100 : 0)

  return (
    <div className="flex flex-col h-full bg-background border rounded-lg">
      {/* G-Code activo — parte superior */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <FileCode className="h-3.5 w-3.5" />
            {t('activeGcode')}
          </span>
          {activeGCodeName && (
            <Badge variant="outline" className="text-[10px]">{activeGCodeName}</Badge>
          )}
        </div>

        {lines.length > 0 ? (
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-1">
              {lines.map((line, i) => {
                const lineNum = i + 1
                const isActive = lineNum === activeGCodeLine
                const isDone = lineNum < activeGCodeLine
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-2 py-0.5 font-mono text-[11px] rounded ${
                      isActive
                        ? 'bg-primary/15 text-primary font-semibold'
                        : isDone
                          ? 'text-muted-foreground/50'
                          : 'text-muted-foreground'
                    }`}
                  >
                    <span className="w-8 text-right text-[10px] text-muted-foreground/40 select-none shrink-0">
                      {lineNum}
                    </span>
                    <span className="truncate">{line || ' '}</span>
                    {isActive && (
                      <span className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-muted-foreground">{t('noActiveGcode')}</p>
          </div>
        )}
      </div>

      <Separator />

      {/* Preview de ruteo — parte inferior */}
      <div className="flex-[0.6] min-h-0 flex flex-col">
        <div className="px-3 py-2 border-b flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" />
          <span className="text-sm font-semibold">{t('routingPreview')}</span>
        </div>

        <div className="flex-1 min-h-0 bg-muted/30 relative">
          {/* Canvas de preview - area donde se dibujaran las toolpaths */}
          <div className="absolute inset-2 border border-dashed border-muted-foreground/20 rounded flex items-center justify-center">
            {activeGCode ? (
              <MiniToolpathPreview gcode={activeGCode} currentLine={activeGCodeLine} />
            ) : (
              <span className="text-xs text-muted-foreground/50">Preview</span>
            )}
          </div>
        </div>

        {/* Timeline de progreso */}
        <div className="px-3 py-2 border-t space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{t('progress')}</span>
            <span className="font-mono">
              {activeGCodeLine} {t('lineOf')} {activeGCodeTotal}
            </span>
          </div>
          <Progress value={progressPercent} className="h-2" />
          <div className="flex items-center justify-between text-[10px]">
            <Badge
              variant={machineState === 'Run' ? 'default' : machineState === 'Alarm' ? 'destructive' : 'secondary'}
              className="text-[9px] h-4"
            >
              {machineState}
            </Badge>
            <span className="text-muted-foreground font-mono">{Math.round(progressPercent)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Mini preview 2D del toolpath */
function MiniToolpathPreview({ gcode, currentLine }: { gcode: string; currentLine: number }) {
  const lines = gcode.split('\n')
  const points: { x: number; y: number; rapid: boolean }[] = []
  let cx = 0, cy = 0

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase()
    if (!trimmed || trimmed.startsWith('(') || trimmed.startsWith(';')) continue

    const isRapid = trimmed.startsWith('G0 ') || trimmed.startsWith('G00 ')
    const xMatch = trimmed.match(/X([-\d.]+)/)
    const yMatch = trimmed.match(/Y([-\d.]+)/)

    if (xMatch) cx = parseFloat(xMatch[1])
    if (yMatch) cy = parseFloat(yMatch[1])
    if (xMatch || yMatch) {
      points.push({ x: cx, y: cy, rapid: isRapid })
    }
  }

  if (points.length < 2) {
    return <span className="text-xs text-muted-foreground/50">Preview</span>
  }

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const padding = 8
  const size = 100

  const scale = (size - padding * 2) / Math.max(rangeX, rangeY)
  const toSvg = (x: number, y: number) => ({
    x: padding + (x - minX) * scale,
    y: padding + (maxY - y) * scale, // flip Y
  })

  // Determinar cuántos puntos están "hechos" basándose en currentLine
  const doneRatio = currentLine > 0 ? Math.min(currentLine / lines.length, 1) : 0
  const donePoints = Math.floor(points.length * doneRatio)

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
      {points.map((pt, i) => {
        if (i === 0) return null
        const from = toSvg(points[i - 1].x, points[i - 1].y)
        const to = toSvg(pt.x, pt.y)
        const done = i < donePoints
        return (
          <line
            key={i}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={pt.rapid ? 'transparent' : done ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
            strokeWidth={done ? 1.2 : 0.6}
            strokeOpacity={done ? 1 : 0.3}
          />
        )
      })}
      {/* Punto actual */}
      {donePoints > 0 && donePoints < points.length && (() => {
        const cp = toSvg(points[donePoints].x, points[donePoints].y)
        return <circle cx={cp.x} cy={cp.y} r={2.5} fill="hsl(var(--primary))" />
      })()}
    </svg>
  )
}
