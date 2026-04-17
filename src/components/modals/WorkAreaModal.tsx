import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { OriginPosition } from '@/lib/types'

const PRESETS = [
  { name: '200x200', width: 200, height: 200 },
  { name: '300x300', width: 300, height: 300 },
  { name: '400x400', width: 400, height: 400 },
  { name: '500x500', width: 500, height: 500 },
  { name: '300x400', width: 300, height: 400 },
  { name: '600x400', width: 600, height: 400 },
]

const ORIGINS: { id: OriginPosition; label: string; row: number; col: number }[] = [
  { id: 'top-left', label: 'TL', row: 0, col: 0 },
  { id: 'top-center', label: 'TC', row: 0, col: 1 },
  { id: 'top-right', label: 'TR', row: 0, col: 2 },
  { id: 'center-left', label: 'CL', row: 1, col: 0 },
  { id: 'center', label: 'C', row: 1, col: 1 },
  { id: 'center-right', label: 'CR', row: 1, col: 2 },
  { id: 'bottom-left', label: 'BL', row: 2, col: 0 },
  { id: 'bottom-center', label: 'BC', row: 2, col: 1 },
  { id: 'bottom-right', label: 'BR', row: 2, col: 2 },
]

export function WorkAreaModal() {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const { workArea, setWorkArea } = useCanvasStore()

  const [tempWidth, setTempWidth] = useState(workArea.width)
  const [tempHeight, setTempHeight] = useState(workArea.height)
  const [tempOrigin, setTempOrigin] = useState<OriginPosition>(workArea.origin)

  const isOpen = activeModal === 'workArea'

  const handleApply = () => {
    setWorkArea({ width: tempWidth, height: tempHeight, origin: tempOrigin })
    addConsoleLine(`Area de trabajo: ${tempWidth} x ${tempHeight} mm, origen: ${tempOrigin}`)
    closeModal()
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setTempWidth(workArea.width)
      setTempHeight(workArea.height)
      setTempOrigin(workArea.origin)
    } else {
      closeModal()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workArea.title')}</DialogTitle>
          <DialogDescription>
            {t('workArea.width')} / {t('workArea.height')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Dimensions */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('workArea.width')}</Label>
              <Input
                type="number"
                value={tempWidth}
                onChange={(e) => setTempWidth(parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('workArea.height')}</Label>
              <Input
                type="number"
                value={tempHeight}
                onChange={(e) => setTempHeight(parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
          </div>

          {/* Presets */}
          <div>
            <Label className="text-xs text-muted-foreground">{t('workArea.presets')}</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {PRESETS.map((p) => (
                <Button
                  key={p.name}
                  variant={tempWidth === p.width && tempHeight === p.height ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setTempWidth(p.width)
                    setTempHeight(p.height)
                  }}
                >
                  {p.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Origin selector */}
          <div>
            <Label className="text-xs text-muted-foreground">{t('workArea.origin')}</Label>
            <div className="grid grid-cols-3 gap-1 mt-1 max-w-[180px]">
              {ORIGINS.map((o) => (
                <Button
                  key={o.id}
                  variant={tempOrigin === o.id ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setTempOrigin(o.id)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeModal}>
            {tc('cancel')}
          </Button>
          <Button onClick={handleApply}>{tc('apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
