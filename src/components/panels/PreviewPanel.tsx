import { useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useSerial } from '@/hooks/useSerial'
import { useProject } from '@/hooks/useProject'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Cog,
  AlertTriangle,
  Copy,
  Download,
  Square,
  Box,
  ListPlus,
  Scan,
} from 'lucide-react'
import { GCodeGenerator } from '@/lib/gcode-generator'
import { generateBoundaryGCode, computeBBox } from '@/components/modals/SetupWizardModal'

function GCodeLineViewer() {
  const { t } = useTranslation('gcode')
  const { gcode, currentGCodeLine, viewer3DPlaying } = useGCodeStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => gcode.split('\n'), [gcode])

  useEffect(() => {
    if (currentGCodeLine > 0 && activeLineRef.current && containerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: viewer3DPlaying ? 'auto' : 'smooth',
        block: 'center',
      })
    }
  }, [currentGCodeLine, viewer3DPlaying])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('gcodeCode')}</h3>
        {currentGCodeLine > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('line')} {currentGCodeLine} / {lines.length}
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        className="max-h-[40vh] overflow-auto rounded-md border bg-muted/50 font-mono text-xs max-w-full"
      >
        {lines.map((line, i) => {
          const lineNum = i + 1
          const isActive = lineNum === currentGCodeLine
          return (
            <div
              key={i}
              ref={isActive ? activeLineRef : undefined}
              className={`flex px-1 leading-5 ${
                isActive
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'hover:bg-muted'
              }`}
            >
              <span
                className={`w-10 shrink-0 text-right pr-2 select-none ${
                  isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'
                }`}
              >
                {lineNum}
              </span>
              <span className="whitespace-pre overflow-hidden text-ellipsis">{line}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PreviewPanel() {
  const { t } = useTranslation('gcode')

  const {
    gcode,
    gcodeGenerated,
    gcodeLines,
    gcodeNeedsRegeneration,
    estimates,
    estimatedTime,
    totalDistance,
    maxDepth,
  } = useGCodeStore()

  const { globalConfig, rasterData } = useCanvasStore()
  const { addConsoleLine, setWorkspace } = useAppStore()
  const { setGCode, setEstimates } = useGCodeStore()
  const { connected, sending, sendProgress } = useSerialStore()
  const { addStep } = useWorkflowStore()
  const serial = useSerial()
  const project = useProject()
  const { getJobsForGCode } = useCanvasManager()

  const handleGenerate = async () => {
    const jobs = getJobsForGCode()
    const isRaster = globalConfig.operationType === 'laser' && globalConfig.laserMode === 'raster'

    if (jobs.length === 0 && !isRaster) {
      addConsoleLine('No se encontraron elementos validos en el canvas')
      return
    }

    if (isRaster && !rasterData) {
      addConsoleLine('No hay imagen raster cargada - importa una imagen primero')
      return
    }

    // Validate: CNC jobs MUST have a tool selected
    const cncJobsNoTool = jobs.filter(
      (j) => j.config.operationType === 'cnc' && !j.config.tool,
    )
    if (cncJobsNoTool.length > 0) {
      for (const j of cncJobsNoTool) {
        addConsoleLine(`ERROR: "${j.elementName}" no tiene herramienta asignada`)
      }
      addConsoleLine('Selecciona una herramienta para cada elemento CNC antes de generar')
      return
    }

    addConsoleLine('Generando G-code...')

    const generator = new GCodeGenerator()
    const result = await generator.generateFromJobs(jobs, rasterData)
    const est = generator.getEstimates()

    setGCode(result)
    setEstimates({
      time: est.time > 60 ? `${(est.time / 60).toFixed(1)} min` : `${est.time.toFixed(0)} seg`,
      distance: est.distance > 1000 ? `${(est.distance / 1000).toFixed(2)} m` : `${est.distance.toFixed(1)} mm`,
    })

    const lineCount = result.split('\n').length
    const uniqueTools = new Set(jobs.map(j => j.config.tool).filter(Boolean)).size
    addConsoleLine(`G-code generado: ${lineCount} lineas, ${jobs.length} elementos, ${uniqueTools} herramientas`)
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

  const handleDryRun = () => {
    if (!connected || sending) return
    const jobs = getJobsForGCode()
    const elementBBox = computeBBox(jobs)
    const { workArea } = useCanvasStore.getState()
    const bbox = elementBBox ?? { minX: 0, minY: 0, maxX: workArea.width, maxY: workArea.height }
    const isLaser = globalConfig.operationType === 'laser'
    const dryGCode = generateBoundaryGCode(bbox, isLaser ? 'laser' : 'cnc', 5, 10)
    serial.sendGCode(dryGCode)
    addConsoleLine(elementBBox ? t('dryRunStarted') : t('dryRunWorkArea'))
  }

  const handleSendToWorkflow = () => {
    if (!gcodeGenerated) return
    addStep({
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'gcode',
      name: `G-Code (${gcodeLines} ${t('lines')})`,
      data: gcode,
      status: 'pending',
    })
    addConsoleLine(t('sentToWorkflow'))
    setWorkspace('cnc')
  }

  if (!gcodeGenerated) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Box className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t('noGCode')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('generateFirst')}</p>
        </div>
        <Button
          variant="default"
          size="sm"
          className="w-full gap-1"
          onClick={handleGenerate}
        >
          <Cog className="h-3 w-3" />
          {t('generate')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 min-w-0 overflow-hidden">
      {/* Action buttons - 2 filas */}
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <Button
            variant={gcodeNeedsRegeneration ? 'destructive' : 'default'}
            size="sm"
            className="flex-1 min-w-0 gap-1 truncate"
            onClick={handleGenerate}
          >
            {gcodeNeedsRegeneration ? (
              <AlertTriangle className="h-3 w-3 shrink-0" />
            ) : (
              <Cog className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{t('generate')}</span>
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleCopy} title={t('copy')}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleDownload} title={t('download')}>
            <Download className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex items-center gap-1 min-w-0">
          {sending ? (
            <Button variant="destructive" size="sm" className="flex-1 min-w-0 gap-1 truncate" onClick={() => serial.cancelSend()}>
              <Square className="h-3 w-3 shrink-0" />
              <span className="truncate">{t('stop')}</span>
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="flex-1 min-w-0 gap-1 truncate" onClick={handleSendToWorkflow}>
              <ListPlus className="h-3 w-3 shrink-0" />
              <span className="truncate">{t('sendToWorkflow')}</span>
            </Button>
          )}
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleDryRun} disabled={!connected || sending} title={t('dryRun')}>
            <Scan className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Send progress */}
      {sending && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">{t('sendToGRBL')}...</span>
            <span className="text-xs font-mono">{Math.round(sendProgress)}%</span>
          </div>
          <Progress value={sendProgress} />
        </div>
      )}

      <Separator />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-muted rounded-md p-2">
          <p className="text-xs text-muted-foreground">{t('time')}</p>
          <p className="text-sm font-medium">{estimatedTime || estimates.time}</p>
        </div>
        <div className="bg-muted rounded-md p-2">
          <p className="text-xs text-muted-foreground">{t('distance')}</p>
          <p className="text-sm font-medium">{totalDistance || estimates.distance}</p>
        </div>
        <div className="bg-muted rounded-md p-2">
          <p className="text-xs text-muted-foreground">{t('depth')}</p>
          <p className="text-sm font-medium">{maxDepth || '-'}</p>
        </div>
        <div className="bg-muted rounded-md p-2">
          <p className="text-xs text-muted-foreground">{t('lines')}</p>
          <p className="text-sm font-medium">{gcodeLines}</p>
        </div>
      </div>

      <Separator />

      {/* G-code con highlighting */}
      <GCodeLineViewer />
    </div>
  )
}
