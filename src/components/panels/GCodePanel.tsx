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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Code, Download, Copy, Cog, AlertTriangle, Square, ListPlus, Scan, Loader2, Grid2X2 } from 'lucide-react'
import { GCodeGenerator } from '@/lib/gcode-generator'
import { withGenerating } from '@/lib/gcode-run'
import { generateBoundaryGCode, computeBBox } from '@/components/modals/SetupWizardModal'

export function GCodePanel() {
  const { t } = useTranslation('gcode')
  const { gcode, gcodeGenerated, gcodeLines, gcodeNeedsRegeneration, estimates } = useGCodeStore()
  const { globalConfig, rasterData } = useCanvasStore()
  const { addConsoleLine, setWorkspace, openModal } = useAppStore()
  const { setGCode, setEstimates } = useGCodeStore()
  const generating = useGCodeStore((s) => s.generating)
  const { connected, sending, sendProgress } = useSerialStore()
  const { addStep } = useWorkflowStore()
  const serial = useSerial()
  const project = useProject()
  const { getJobsForGCode } = useCanvasManager()

  const handleGenerate = async () => {
    const jobs = getJobsForGCode()
    // Los dos modos que tallan/graban desde la imagen y no desde la geometria
    const isLaserRaster = globalConfig.operationType === 'laser' && globalConfig.laserMode === 'raster'
    const isPhotoVCarve = globalConfig.operationType === 'cnc' && globalConfig.workType === 'photoVcarve'
    const fromImage = isLaserRaster || isPhotoVCarve

    if (jobs.length === 0 && !fromImage) {
      addConsoleLine('No se encontraron elementos validos en el canvas')
      return
    }

    if (fromImage && !rasterData) {
      addConsoleLine('No hay imagen cargada - importa una imagen primero')
      return
    }

    addConsoleLine('Generando G-code...')

    const { result, est } = await withGenerating(async () => {
      const generator = new GCodeGenerator()
      const out = await generator.generateFromJobs(jobs, rasterData)
      return { result: out, est: generator.getEstimates() }
    })

    setGCode(result)
    setEstimates({
      time: est.time > 60 ? `${(est.time / 60).toFixed(1)} min` : `${est.time.toFixed(0)} seg`,
      distance: est.distance > 1000 ? `${(est.distance / 1000).toFixed(2)} m` : `${est.distance.toFixed(1)} mm`,
    })

    const lineCount = result.split('\n').length
    const uniqueTools = new Set(jobs.map(j => j.config.tool).filter(Boolean)).size
    addConsoleLine(`G-code generado: ${lineCount} lineas, ${jobs.length} elementos, ${uniqueTools} herramientas`)

    setWorkspace('cam')
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
    const gcode = generateBoundaryGCode(bbox, isLaser ? 'laser' : 'cnc', 5, 10)
    serial.sendGCode(gcode)
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

  const handleCancelSend = () => {
    serial.cancelSend()
  }

  return (
    <div className="absolute bottom-12 right-2 z-20 w-80 max-w-[calc(100%-1rem)] bg-background border rounded-lg shadow-lg max-h-[calc(100%-5rem)] flex flex-col">
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
      <div className="flex flex-col gap-1 px-3 py-2 border-b">
        {/* Fila 1: Generar + Copiar + Descargar */}
        <div className="flex items-center gap-1">
          <Button
            variant={gcodeNeedsRegeneration ? 'destructive' : 'default'}
            size="sm"
            className="flex-1 gap-1"
            onClick={handleGenerate}
            disabled={generating}
            aria-busy={generating}
          >
            {generating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : gcodeNeedsRegeneration ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <Cog className="h-3 w-3" />
            )}
            {generating ? t('generating') : t('generate')}
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
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => openModal('tiling')}
            title={t('tiling.title') || 'Dividir en tiles'}
          >
            <Grid2X2 className="h-3 w-3" />
          </Button>
        </div>
        {/* Fila 2: Workflow + Dry Run */}
        <div className="flex items-center gap-1">
          {sending ? (
            <Button
              variant="destructive"
              size="sm"
              className="flex-1 gap-1"
              onClick={handleCancelSend}
            >
              <Square className="h-3 w-3" />
              {t('stop')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1"
              onClick={handleSendToWorkflow}
              disabled={!gcodeGenerated}
            >
              <ListPlus className="h-3 w-3" />
              {t('sendToWorkflow')}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleDryRun}
            disabled={!connected || sending}
            title={t('dryRun')}
          >
            <Scan className="h-3 w-3" />
          </Button>
        </div>
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

      {/* G-code preview with syntax highlight */}
      <ScrollArea className="flex-1 max-h-[300px]">
        {gcodeGenerated ? (
          <div className="p-3 text-xs font-mono whitespace-pre-wrap">
            {gcode.split('\n').map((line, i) => {
              const trimmed = line.trim()
              const isComment = trimmed.startsWith(';')
              const isRapid = /^G0\b/i.test(trimmed)
              const isCut = /^G1\b/i.test(trimmed)
              const isArc = /^G[23]\b/i.test(trimmed)
              const isMCode = /^M\d/i.test(trimmed)
              const isTool = /^(T\d|M6)/i.test(trimmed)
              const isSetup = /^G(90|91|20|21)\b/i.test(trimmed)
              const cls = isComment ? 'text-emerald-600'
                : isTool ? 'text-amber-500 font-semibold'
                : isMCode ? 'text-purple-500'
                : isRapid ? 'text-blue-400'
                : isCut ? 'text-foreground'
                : isArc ? 'text-cyan-500'
                : isSetup ? 'text-orange-400'
                : 'text-muted-foreground'
              return (
                <div key={i} className="flex hover:bg-muted/30">
                  <span className="text-muted-foreground/40 w-8 text-right pr-2 select-none shrink-0">{i + 1}</span>
                  <span className={cls}>{line}</span>
                </div>
              )
            })}
          </div>
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
