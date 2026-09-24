import { useMemo, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { checkSafeArea, printSheetHTML, regmarkLayout, regmarksSvg } from '@/lib/print-cut'
import { saveTextFile } from '@/lib/save-file'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Download, Info, Printer } from 'lucide-react'

export function PrintSheetModal() {
  const { activeModal, closeModal, projectName, addConsoleLine } = useAppStore()
  const printCut = useCanvasStore((s) => s.printCut)
  const elements = useCanvasStore((s) => s.elements)
  const { getPrintSVG, getElementBoundsMm } = useCanvasManager()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const isOpen = activeModal === 'print-sheet'

  const layout = regmarkLayout(printCut)
  const { html, content, count, issues } = useMemo(() => {
    if (!isOpen) return { html: '', content: '', count: 0, issues: [] }
    const { svg, count } = getPrintSVG()
    return {
      html: printSheetHTML(layout, svg),
      content: svg,
      count,
      issues: checkSafeArea(layout, getElementBoundsMm()),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, printCut, elements, getPrintSVG, getElementBoundsMm])

  const blocked = issues.length > 0

  const handlePrint = () => {
    // Se imprime el iframe: sale exactamente la hoja, sin la interfaz
    const win = frameRef.current?.contentWindow
    if (!win) return
    win.focus()
    win.print()
    addConsoleLine('Print & cut: hoja enviada a imprimir. Revisa que la escala sea 100%.')
  }

  const handleSave = async () => {
    const { width: w, height: h } = layout.paper
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${content}${regmarksSvg(layout)}</svg>`
    const saved = await saveTextFile(svg, `${projectName || 'proyecto'}-print.svg`, {
      name: 'Imagen SVG',
      extensions: ['svg'],
    })
    if (saved) addConsoleLine(`Hoja de print & cut guardada: ${saved}`)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            Imprimir hoja de print & cut
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-start gap-1.5 text-sky-700 dark:text-sky-400">
            <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>
              En el dialogo de impresion usa <strong>escala 100% / tamaño real</strong>, nunca "ajustar a la pagina".
              Para comprobarlo, mide con una regla la distancia entre el borde exterior del cuadrado y el de la escuadra
              de la derecha: tiene que dar <strong>{layout.width.toFixed(1)} mm</strong>.
            </span>
          </div>
          {count === 0 && (
            <div className="flex items-start gap-1.5 text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>No hay elementos para imprimir: sale una hoja solo con las marcas (sirve para probar el sensor).</span>
            </div>
          )}
          {issues.map((i) => (
            <div key={i.id} className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span><strong>{i.name}</strong> {i.problem}</span>
            </div>
          ))}
        </div>

        <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
          <iframe ref={frameRef} title="Hoja de print & cut" srcDoc={html} className="w-full h-full" />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="gap-1.5" onClick={handleSave} disabled={blocked}>
            <Download className="h-4 w-4" />
            Guardar SVG
          </Button>
          <Button
            className="gap-1.5"
            onClick={handlePrint}
            disabled={blocked}
            title={blocked ? 'Mueve los elementos marcados al area segura' : undefined}
          >
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
