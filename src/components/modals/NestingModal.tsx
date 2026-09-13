import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { useAppStore } from '@/stores/useAppStore'
import { toast } from '@/lib/toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** Acomoda las piezas en el area de trabajo para desperdiciar menos material. */
export function NestingModal() {
  const { t } = useTranslation('canvas')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const cm = useCanvasManager()
  const workArea = useCanvasStore((s) => s.workArea)
  const selectedElementId = useCanvasStore((s) => s.selectedElementId)

  const [spacing, setSpacing] = useState(3)
  const [margin, setMargin] = useState(5)
  const [allowRotate90, setAllowRotate90] = useState(true)
  const [alignToMinRect, setAlignToMinRect] = useState(true)
  const [scope, setScope] = useState<'selection' | 'sheet'>('sheet')
  const [trueShape, setTrueShape] = useState(false)
  const [rotations, setRotations] = useState(4)

  const isOpen = activeModal === 'nesting'

  const handleApply = () => {
    const result = cm.nestElements({
      spacing, margin, allowRotate90, alignToMinRect, scope, trueShape, rotations,
    })

    if (result.placed === 0) {
      toast.warning(t('nesting.nothingPlaced'))
      closeModal()
      return
    }

    const pct = Math.round(result.usage * 100)
    const msg = t('nesting.done', { placed: result.placed, usage: pct })
    addConsoleLine(msg)

    if (result.unplaced > 0) {
      toast.warning(msg, { detail: t('nesting.unplaced', { count: result.unplaced }) })
    } else {
      toast.success(msg)
    }
    closeModal()
  }

  return (
    <Dialog open={isOpen} onOpenChange={closeModal}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('nesting.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Alcance */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('nesting.scope')}</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={scope === 'sheet' ? 'secondary' : 'outline'}
                className="flex-1 h-8 text-xs"
                onClick={() => setScope('sheet')}
              >
                {t('nesting.scopeSheet')}
              </Button>
              <Button
                size="sm"
                variant={scope === 'selection' ? 'secondary' : 'outline'}
                className="flex-1 h-8 text-xs"
                disabled={!selectedElementId}
                onClick={() => setScope('selection')}
              >
                {t('nesting.scopeSelection')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('nesting.spacing')}</Label>
              <Input
                type="number"
                className="h-8"
                step="0.5"
                min="0"
                value={spacing}
                onChange={(e) => setSpacing(Math.max(0, parseFloat(e.target.value) || 0))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('nesting.margin')}</Label>
              <Input
                type="number"
                className="h-8"
                step="0.5"
                min="0"
                value={margin}
                onChange={(e) => setMargin(Math.max(0, parseFloat(e.target.value) || 0))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-normal">{t('nesting.trueShape')}</Label>
              <p className="text-[10px] text-muted-foreground">{t('nesting.trueShapeHint')}</p>
            </div>
            <Switch checked={trueShape} onCheckedChange={setTrueShape} />
          </div>

          {trueShape ? (
            <div className="space-y-1.5">
              <Label className="text-xs">{t('nesting.rotations')}</Label>
              <div className="flex gap-2">
                {[1, 2, 4, 8].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={rotations === n ? 'secondary' : 'outline'}
                    className="flex-1 h-8 text-xs"
                    onClick={() => setRotations(n)}
                  >
                    {n === 1 ? t('nesting.rotationsNone') : `${360 / n}°`}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <Label className="text-xs font-normal">{t('nesting.rotate90')}</Label>
              <Switch checked={allowRotate90} onCheckedChange={setAllowRotate90} />
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-normal">{t('nesting.alignMinRect')}</Label>
              <p className="text-[10px] text-muted-foreground">{t('nesting.alignMinRectHint')}</p>
            </div>
            <Switch checked={alignToMinRect} onCheckedChange={setAlignToMinRect} />
          </div>

          <p className="text-[11px] text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            {t('nesting.areaInfo', { width: workArea.width, height: workArea.height })}
            <br />
            {trueShape ? t('nesting.trueShapeNote') : t('nesting.bboxNote')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeModal}>
            {t('nesting.cancel')}
          </Button>
          <Button onClick={handleApply}>{t('nesting.apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
