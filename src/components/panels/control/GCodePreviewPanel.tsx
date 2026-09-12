import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  FileCode,
  Eye,
  Play,
  Pause,
  Square,
  SkipBack,
  ChevronsRight,
  ChevronsLeft,
} from 'lucide-react'

const SIM_SPEEDS = [
  { label: '0.25x', ms: 200 },
  { label: '0.5x', ms: 100 },
  { label: '1x', ms: 50 },
  { label: '2x', ms: 25 },
  { label: '5x', ms: 10 },
  { label: '10x', ms: 5 },
]

export function GCodePreviewPanel() {
  const { t } = useTranslation('serial')
  const { t: tg } = useTranslation('gcode')
  const {
    activeGCode, activeGCodeName, activeGCodeLine, activeGCodeTotal,
    simulating, simPaused, simSpeed, simulatedPos,
    setSimPaused, setSimSpeed,
  } = useWorkflowStore()
  const { sending, sendProgress, machineState } = useSerialStore()

  const currentSpeedIdx = SIM_SPEEDS.findIndex(s => s.ms === simSpeed)
  const currentSpeedLabel = SIM_SPEEDS.find(s => s.ms === simSpeed)?.label ?? '1x'

  const handleSpeedUp = () => {
    const next = Math.min((currentSpeedIdx >= 0 ? currentSpeedIdx : 2) + 1, SIM_SPEEDS.length - 1)
    setSimSpeed(SIM_SPEEDS[next].ms)
  }
  const handleSpeedDown = () => {
    const next = Math.max((currentSpeedIdx >= 0 ? currentSpeedIdx : 2) - 1, 0)
    setSimSpeed(SIM_SPEEDS[next].ms)
  }

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
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <FileCode
              className="h-8 w-8 text-muted-foreground/40 mb-2"
              strokeWidth={1.5}
            />
            <p className="text-[13px] font-medium">{tg('noActiveGcodeTitle')}</p>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-[260px]">
              {tg('noActiveGcodeHint')}
            </p>
          </div>
        )}

        {/* Controles flotantes simulación */}
        {simulating && (
          <div className="px-2 py-1.5 border-t bg-muted/50 flex items-center justify-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleSpeedDown} title="Más lento">
              <ChevronsLeft className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                // Retroceder — emitimos evento custom que MacrosWorkflowPanel escucha
                window.dispatchEvent(new CustomEvent('sim-rewind'))
              }}
              title="Retroceder"
            >
              <SkipBack className="h-3 w-3" />
            </Button>
            <Button
              variant={simPaused ? 'default' : 'outline'}
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setSimPaused(!simPaused)}
              title={simPaused ? 'Reanudar' : 'Pausar'}
            >
              {simPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => window.dispatchEvent(new CustomEvent('sim-stop'))}
              title="Detener"
            >
              <Square className="h-3 w-3 text-destructive" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleSpeedUp} title="Más rápido">
              <ChevronsRight className="h-3 w-3" />
            </Button>
            <Badge variant="outline" className="text-[9px] h-4 ml-1">{currentSpeedLabel}</Badge>
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
              <span className="text-[11px] text-muted-foreground/60 px-4 text-center">
                {t('routingPreviewEmpty')}
              </span>
            )}
          </div>
        </div>

        {/* Coordenadas simuladas */}
        {simulating && (
          <div className="px-3 py-1.5 border-t flex items-center justify-between">
            <Badge variant="outline" className="text-[9px] h-4 gap-1 text-blue-500 border-blue-500/30">
              SIM
            </Badge>
            <div className="flex gap-3 font-mono text-[11px]">
              <span><span className="text-red-400">X</span>{simulatedPos.x.toFixed(2)}</span>
              <span><span className="text-green-400">Y</span>{simulatedPos.y.toFixed(2)}</span>
              <span><span className="text-blue-400">Z</span>{simulatedPos.z.toFixed(2)}</span>
            </div>
          </div>
        )}

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
              variant={simulating ? 'default' : machineState === 'Run' ? 'default' : machineState === 'Alarm' ? 'destructive' : 'secondary'}
              className="text-[9px] h-4"
            >
              {simulating ? 'Simulando' : machineState}
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
  const { t } = useTranslation('serial')
  const lines = gcode.split('\n')
  const points: { x: number; y: number; rapid: boolean; lineNum: number; step: number }[] = []
  let cx = 0, cy = 0, currentStep = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    // Detectar cambio de paso workflow
    if (raw.startsWith('; ── Paso')) {
      currentStep++
      continue
    }
    const trimmed = raw.toUpperCase()
    if (!trimmed || trimmed.startsWith('(') || trimmed.startsWith(';')) continue

    const isRapid = trimmed.startsWith('G0 ') || trimmed.startsWith('G00 ')
    const xMatch = trimmed.match(/X([-\d.]+)/)
    const yMatch = trimmed.match(/Y([-\d.]+)/)

    if (xMatch) cx = parseFloat(xMatch[1])
    if (yMatch) cy = parseFloat(yMatch[1])
    if (xMatch || yMatch) {
      points.push({ x: cx, y: cy, rapid: isRapid, lineNum: i + 1, step: currentStep })
    }
  }

  if (points.length < 2) {
    return (
      <span className="text-[11px] text-muted-foreground/60 px-4 text-center">
        {t('routingPreviewNoMoves')}
      </span>
    )
  }

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const padding = 8
  const size = 100

  const scale = (size - padding * 2) / Math.max(maxX - minX || 1, maxY - minY || 1)
  const toSvg = (x: number, y: number) => ({
    x: padding + (x - minX) * scale,
    y: padding + (maxY - y) * scale,
  })

  // Encontrar punto actual y paso activo
  let donePoints = 0
  if (currentLine > 0) {
    for (let i = 0; i < points.length; i++) {
      if (points[i].lineNum <= currentLine) donePoints = i + 1
      else break
    }
  }
  const activeStep = donePoints > 0 ? points[donePoints - 1].step : -1

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
      {/* Pendiente — gris tenue */}
      {points.map((pt, i) => {
        if (i === 0 || pt.rapid || i < donePoints) return null
        const from = toSvg(points[i - 1].x, points[i - 1].y)
        const to = toSvg(pt.x, pt.y)
        return (
          <line key={`p-${i}`}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke="hsl(var(--muted-foreground))" strokeWidth={0.4} strokeOpacity={0.15}
          />
        )
      })}
      {/* Recorrido — pasos anteriores gris, paso actual rojo */}
      {points.map((pt, i) => {
        if (i === 0 || i >= donePoints) return null
        const from = toSvg(points[i - 1].x, points[i - 1].y)
        const to = toSvg(pt.x, pt.y)
        const isActiveStep = pt.step === activeStep
        if (pt.rapid) {
          return (
            <line key={`d-${i}`}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="hsl(var(--muted-foreground))" strokeWidth={0.3}
              strokeOpacity={0.2} strokeDasharray="1.5 1"
            />
          )
        }
        return (
          <line key={`d-${i}`}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={isActiveStep ? '#ef4444' : 'hsl(var(--muted-foreground))'}
            strokeWidth={isActiveStep ? 1.2 : 0.8}
            strokeOpacity={isActiveStep ? 1 : 0.4}
          />
        )
      })}
      {/* Punto actual */}
      {donePoints > 0 && donePoints <= points.length && (() => {
        const idx = Math.min(donePoints - 1, points.length - 1)
        const cp = toSvg(points[idx].x, points[idx].y)
        return (
          <>
            <circle cx={cp.x} cy={cp.y} r={4} fill="#ef4444" fillOpacity={0.25} />
            <circle cx={cp.x} cy={cp.y} r={1.8} fill="#ef4444" />
          </>
        )
      })()}
    </svg>
  )
}
