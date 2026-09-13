import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertTriangle, CheckCircle2, Info, RefreshCw, XCircle } from 'lucide-react'
import { diagnoseVectors, type DiagnosticIssue } from '@/lib/vector-diagnostics'

const SEVERITY_META: Record<
  DiagnosticIssue['severity'],
  { icon: typeof Info; className: string }
> = {
  error: { icon: XCircle, className: 'text-red-500' },
  warning: { icon: AlertTriangle, className: 'text-amber-500' },
  info: { icon: Info, className: 'text-sky-500' },
}

export function VectorDiagnosticsModal() {
  const { t } = useTranslation('settings')
  const { activeModal, closeModal } = useAppStore()
  const cm = useCanvasManager()
  const vectorCleanup = useCanvasStore((s) => s.vectorCleanup)
  const setVectorCleanup = useCanvasStore((s) => s.setVectorCleanup)

  const isOpen = activeModal === 'vectorDiagnostics'

  // Un contador de "run" fuerza el re-análisis: los paths viven en Fabric, no
  // en el store, así que no hay nada a lo que suscribirse.
  const [run, setRun] = useState(0)

  const { issues, pathCount } = useMemo(() => {
    if (!isOpen) return { issues: [] as DiagnosticIssue[], pathCount: 0 }
    void run
    // Sin limpiar: el reporte tiene que mostrar los problemas reales del
    // diseño, no lo que queda despues de la auto-limpieza.
    const paths = cm.getPathsForGCode({ raw: true })
    return { issues: diagnoseVectors(paths), pathCount: paths.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, run])

  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 }
    for (const i of issues) c[i.severity]++
    return c
  }, [issues])

  return (
    <Dialog open={isOpen} onOpenChange={closeModal}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('vectorDiagnostics.title')}</DialogTitle>
          <DialogDescription>{t('vectorDiagnostics.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Resumen */}
          <div className="flex items-center gap-4 rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span>
              <span className="text-muted-foreground">{t('vectorDiagnostics.paths')}: </span>
              {pathCount}
            </span>
            <span className="text-red-500">{counts.error} err</span>
            <span className="text-amber-500">{counts.warning} warn</span>
            <span className="text-sky-500">{counts.info} info</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6 gap-1 px-2 text-xs"
              onClick={() => setRun((n) => n + 1)}
            >
              <RefreshCw className="h-3 w-3" />
              {t('vectorDiagnostics.reanalyze')}
            </Button>
          </div>

          {/* Lista de issues */}
          <ScrollArea className="h-52 rounded-md border">
            {issues.length === 0 ? (
              <div className="flex h-52 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                {pathCount === 0
                  ? t('vectorDiagnostics.noPaths')
                  : t('vectorDiagnostics.clean')}
              </div>
            ) : (
              <ul className="divide-y">
                {issues.map((issue, idx) => {
                  const meta = SEVERITY_META[issue.severity]
                  const Icon = meta.icon
                  return (
                    <li key={idx} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                      <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${meta.className}`} />
                      <span>{issue.message}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </ScrollArea>

          {/* Auto-limpieza */}
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-semibold">
                  {t('vectorDiagnostics.autoCleanup')}
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  {t('vectorDiagnostics.autoCleanupHint')}
                </p>
              </div>
              <Switch
                checked={vectorCleanup.enabled}
                onCheckedChange={(enabled) => {
                  setVectorCleanup({ enabled })
                  setRun((n) => n + 1)
                }}
              />
            </div>

            {vectorCleanup.enabled && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('vectorDiagnostics.joinTolerance')}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={vectorCleanup.joinTolerance}
                    onChange={(e) => {
                      setVectorCleanup({ joinTolerance: parseFloat(e.target.value) || 0 })
                      setRun((n) => n + 1)
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('vectorDiagnostics.tinySpanTolerance')}</Label>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    value={vectorCleanup.tinySpanTolerance}
                    onChange={(e) => {
                      setVectorCleanup({ tinySpanTolerance: parseFloat(e.target.value) || 0 })
                      setRun((n) => n + 1)
                    }}
                  />
                </div>
                <div className="col-span-2 flex items-center justify-between">
                  <Label className="text-xs">{t('vectorDiagnostics.removeDuplicates')}</Label>
                  <Switch
                    checked={vectorCleanup.removeDuplicates}
                    onCheckedChange={(removeDuplicates) => {
                      setVectorCleanup({ removeDuplicates })
                      setRun((n) => n + 1)
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={closeModal}>{t('vectorDiagnostics.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
