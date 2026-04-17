import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { useAppStore } from '@/stores/useAppStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ArrayModal() {
  const { t } = useTranslation('canvas')
  const { activeModal, closeModal } = useAppStore()
  const cm = useCanvasManager()
  const workArea = useCanvasStore((s) => s.workArea)

  // Rectangular state
  const [rows, setRows] = useState(2)
  const [cols, setCols] = useState(3)
  const [spacingX, setSpacingX] = useState(50)
  const [spacingY, setSpacingY] = useState(50)

  // Polar state
  const [count, setCount] = useState(6)
  const [totalAngle, setTotalAngle] = useState(360)
  const [centerX, setCenterX] = useState(workArea.width / 2)
  const [centerY, setCenterY] = useState(workArea.height / 2)

  const isOpen = activeModal === 'array'

  const handleApplyRect = () => {
    cm.arrayRectangular(rows, cols, spacingX, spacingY)
    closeModal()
  }

  const handleApplyPolar = () => {
    cm.arrayPolar(count, totalAngle, centerX, centerY)
    closeModal()
  }

  return (
    <Dialog open={isOpen} onOpenChange={closeModal}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('array.title') || 'Patrón (Array)'}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="rect" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="rect">{t('array.rect') || 'Rectangular'}</TabsTrigger>
            <TabsTrigger value="polar">{t('array.polar') || 'Polar'}</TabsTrigger>
          </TabsList>

          <TabsContent value="rect" className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('array.rows') || 'Filas'}</Label>
                <Input type="number" value={rows} onChange={e => setRows(parseInt(e.target.value) || 1)} min="1" />
              </div>
              <div className="space-y-2">
                <Label>{t('array.cols') || 'Columnas'}</Label>
                <Input type="number" value={cols} onChange={e => setCols(parseInt(e.target.value) || 1)} min="1" />
              </div>
              <div className="space-y-2">
                <Label>{t('array.spacingX') || 'Espaciado X (mm)'}</Label>
                <Input type="number" value={spacingX} onChange={e => setSpacingX(parseFloat(e.target.value) || 0)} step="1" />
              </div>
              <div className="space-y-2">
                <Label>{t('array.spacingY') || 'Espaciado Y (mm)'}</Label>
                <Input type="number" value={spacingY} onChange={e => setSpacingY(parseFloat(e.target.value) || 0)} step="1" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleApplyRect} className="w-full">{t('apply') || 'Aplicar'}</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="polar" className="space-y-4 py-4">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('array.count') || 'Cantidad'}</Label>
                  <Input type="number" value={count} onChange={e => setCount(parseInt(e.target.value) || 2)} min="2" />
                </div>
                <div className="space-y-2">
                  <Label>{t('array.totalAngle') || 'Ángulo total (°)'}</Label>
                  <Input type="number" value={totalAngle} onChange={e => setTotalAngle(parseFloat(e.target.value) || 0)} step="1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 border-t pt-4">
                <div className="space-y-2">
                  <Label>{t('array.centerX') || 'Centro X (mm)'}</Label>
                  <Input type="number" value={centerX} onChange={e => setCenterX(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="space-y-2">
                  <Label>{t('array.centerY') || 'Centro Y (mm)'}</Label>
                  <Input type="number" value={centerY} onChange={e => setCenterY(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground italic text-center">
                {t('array.polarHint') || 'El centro por defecto es el centro del área de trabajo'}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={handleApplyPolar} className="w-full">{t('apply') || 'Aplicar'}</Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
