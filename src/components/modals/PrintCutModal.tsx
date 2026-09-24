import { useMemo } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { PAPERS, checkSafeArea, regmarkLayout, type PaperId } from '@/lib/print-cut'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AlertTriangle, CheckCircle2, Printer } from 'lucide-react'

export function PrintCutModal() {
  const { activeModal, closeModal } = useAppStore()
  const printCut = useCanvasStore((s) => s.printCut)
  const setPrintCut = useCanvasStore((s) => s.setPrintCut)
  const elements = useCanvasStore((s) => s.elements)
  const { getElementBoundsMm } = useCanvasManager()
  const isOpen = activeModal === 'print-cut'

  const layout = regmarkLayout(printCut)
  const issues = useMemo(
    () => (isOpen && printCut.enabled ? checkSafeArea(layout, getElementBoundsMm()) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, printCut, elements, getElementBoundsMm],
  )

  const setMargin = (key: 'marginX' | 'marginY', raw: string) => {
    const v = parseFloat(raw)
    if (Number.isFinite(v)) setPrintCut({ [key]: Math.min(50, Math.max(3, v)) })
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            Print & Cut
          </DialogTitle>
          <DialogDescription>
            Se imprime el diseño con marcas de registro y la cortadora recorta el borde leyendo esas marcas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Hoja con marcas de registro</Label>
            <Switch checked={printCut.enabled} onCheckedChange={(v) => setPrintCut({ enabled: v })} />
          </div>

          {printCut.enabled && (
            <>
              <div>
                <Label className="text-xs">Papel</Label>
                <Select value={printCut.paper} onValueChange={(v) => setPrintCut({ paper: v as PaperId })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAPERS).map(([id, p]) => (
                      <SelectItem key={id} value={id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  El area de trabajo pasa a ser la hoja. Va vertical, como entra a la cortadora.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Margen izquierdo (mm)</Label>
                  <Input
                    type="number"
                    className="mt-1"
                    min={3}
                    max={50}
                    step={0.5}
                    value={printCut.marginX}
                    onChange={(e) => setMargin('marginX', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Margen superior (mm)</Label>
                  <Input
                    type="number"
                    className="mt-1"
                    min={3}
                    max={50}
                    step={0.5}
                    value={printCut.marginY}
                    onChange={(e) => setMargin('marginY', e.target.value)}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Distancia del borde del papel a las marcas, igual en los dos lados. Tiene que quedar dentro de lo que
                tu impresora alcanza a imprimir.
              </p>

              <div className="text-xs rounded-md bg-muted/60 px-2 py-1.5 space-y-0.5">
                <div>Entre marcas: {layout.width.toFixed(1)} x {layout.length.toFixed(1)} mm</div>
                <div className="text-muted-foreground">
                  Las zonas rojas del lienzo quedan reservadas para las marcas: ahi no puede haber diseño.
                </div>
              </div>

              {issues.length === 0 ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Todo el diseño esta dentro del area segura
                </div>
              ) : (
                <div className="space-y-1">
                  {issues.map((i) => (
                    <div key={i.id} className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                      <span><strong>{i.name}</strong> {i.problem}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeModal}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
