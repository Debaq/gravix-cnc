import { useTranslation } from 'react-i18next'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Code, Download, Send, Copy, Cog, AlertTriangle } from 'lucide-react'
import { useSerialStore } from '@/stores/useSerialStore'

export function GCodePanel() {
  const { t } = useTranslation('gcode')
  const { gcode, gcodeGenerated, gcodeLines, gcodeNeedsRegeneration, estimates } = useGCodeStore()
  const { elements } = useCanvasStore()
  const { addConsoleLine } = useAppStore()
  const { connected } = useSerialStore()

  const handleGenerate = () => {
    if (elements.length === 0) {
      addConsoleLine('No hay elementos para generar G-code')
      return
    }
    addConsoleLine('Generando G-code...')
    // TODO: connect to actual gcode generator
  }

  const handleDownload = () => {
    if (!gcodeGenerated) return
    const blob = new Blob([gcode], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'output.gcode'
    a.click()
    URL.revokeObjectURL(url)
    addConsoleLine('G-code descargado')
  }

  const handleCopy = () => {
    if (!gcodeGenerated) return
    navigator.clipboard.writeText(gcode)
    addConsoleLine('G-code copiado al portapapeles')
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
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={!gcodeGenerated || !connected}
          title={t('sendToGRBL')}
        >
          <Send className="h-3 w-3" />
        </Button>
      </div>

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
