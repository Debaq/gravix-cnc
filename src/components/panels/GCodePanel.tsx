import { useTranslation } from 'react-i18next'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useSerial } from '@/hooks/useSerial'
import { useProject } from '@/hooks/useProject'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Code, Download, Send, Copy, Cog, AlertTriangle, Square } from 'lucide-react'
import { GCodeGenerator } from '@/lib/gcode-generator'

export function GCodePanel() {
  const { t } = useTranslation('gcode')
  const { gcode, gcodeGenerated, gcodeLines, gcodeNeedsRegeneration, estimates } = useGCodeStore()
  const { globalConfig, rasterData } = useCanvasStore()
  const { addConsoleLine, setWorkspace } = useAppStore()
  const { setGCode, setEstimates } = useGCodeStore()
  const { connected, sending, sendProgress } = useSerialStore()
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

    setWorkspace('preview')
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
