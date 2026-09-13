import { useMemo, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useCAMStore } from '@/stores/useCAMStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { parseGCode, aggregateByOperation } from '@/lib/gcode-parser'
import { renderJobSheetHTML } from '@/lib/job-sheet'
import { applyCAMPlan, jobsBBox } from '@/lib/cam-jobs'
import { saveTextFile } from '@/lib/save-file'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Printer, Download, FileText } from 'lucide-react'

export function JobSheetModal() {
  const { activeModal, closeModal, projectName, addConsoleLine } = useAppStore()
  const { operations, operationOrder, markers, setup, soloOperationId } = useCAMStore()
  const workArea = useCanvasStore((s) => s.workArea)
  const { gcode, gcodeLines } = useGCodeStore()
  const { tools, materials } = useLibraryStore()
  const { getJobsForGCode } = useCanvasManager()
  const frameRef = useRef<HTMLIFrameElement>(null)

  const isOpen = activeModal === 'job-sheet'

  const html = useMemo(() => {
    if (!isOpen) return ''

    // Las mismas operaciones que van a salir generadas, en el mismo orden
    const rank = new Map(operationOrder.map((id, i) => [id, i]))
    const active = operations
      .filter((op) => (soloOperationId ? op.id === soloOperationId : op.enabled))
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))

    const parsed = gcode ? parseGCode(gcode) : null

    const jobs = applyCAMPlan(getJobsForGCode(), {
      order: operationOrder,
      disabled: new Set(operations.filter((o) => !o.enabled).map((o) => o.id)),
      soloId: soloOperationId,
    })

    return renderJobSheetHTML({
      projectName,
      workArea,
      setup,
      operations: active,
      markers,
      tools,
      materials,
      usage: parsed ? aggregateByOperation(parsed.segments) : [],
      totalTime: parsed?.stats.estimatedTime ?? 0,
      totalDistance: parsed?.stats.totalDistance ?? 0,
      gcodeLines,
      bbox: jobsBBox(jobs),
    })
  }, [
    isOpen, operations, operationOrder, soloOperationId, markers, setup,
    projectName, workArea, tools, materials, gcode, gcodeLines, getJobsForGCode,
  ])

  const handlePrint = () => {
    // Se imprime el iframe y no la ventana: lo que sale es exactamente lo que
    // se ve en la vista previa, sin la UI de la app de por medio.
    const win = frameRef.current?.contentWindow
    if (!win) return
    win.focus()
    win.print()
  }

  const handleSave = async () => {
    const name = `${projectName || 'proyecto'}-setup.html`
    const saved = await saveTextFile(html, name, {
      name: 'Pagina HTML',
      extensions: ['html'],
    })
    if (saved) addConsoleLine(`Hoja de setup guardada: ${saved}`)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Hoja de setup
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 border rounded-md overflow-hidden bg-white">
          <iframe
            ref={frameRef}
            title="Hoja de setup"
            srcDoc={html}
            className="w-full h-full"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleSave} className="gap-1.5">
            <Download className="h-4 w-4" />
            Guardar HTML
          </Button>
          <Button onClick={handlePrint} className="gap-1.5">
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
