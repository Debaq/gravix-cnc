import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { generateBox, generateBoxSvg } from '@/lib/box-generator'
import type { BoxParams } from '@/lib/box-generator'

export function BoxGeneratorModal() {
  const { t } = useTranslation('canvas')
  const { activeModal, closeModal } = useAppStore()
  const { materials } = useLibraryStore()
  const { globalConfig } = useCanvasStore()
  const cm = useCanvasManager()

  const isOpen = activeModal === 'boxGenerator'

  // Default thickness from selected material
  const selectedMaterial = materials.find(m => m.id === globalConfig.material)
  const defaultThickness = selectedMaterial?.thickness ?? 3

  const [width, setWidth] = useState(100)
  const [height, setHeight] = useState(60)
  const [depth, setDepth] = useState(80)
  const [thickness, setThickness] = useState(defaultThickness)
  const [fingerWidth, setFingerWidth] = useState(10)
  const [openTop, setOpenTop] = useState(false)
  const [jointType, setJointType] = useState<'finger' | 'puzzle'>('finger')

  // Update thickness when material changes
  useEffect(() => {
    if (isOpen && selectedMaterial?.thickness) {
      setThickness(selectedMaterial.thickness)
    }
  }, [isOpen, selectedMaterial])

  // Generate box result
  const boxResult = useMemo(() => {
    if (!isOpen) return null
    if (width <= 0 || height <= 0 || depth <= 0 || thickness <= 0 || fingerWidth <= 0) return null
    if (thickness * 2 >= Math.min(width, height, depth)) return null
    try {
      const params: BoxParams = { width, height, depth, thickness, fingerWidth, openTop, jointType }
      const result = generateBox(params)
      return { result, params }
    } catch {
      return null
    }
  }, [isOpen, width, height, depth, thickness, fingerWidth, openTop, jointType])

  // Preview SVG (in mm, scale 1)
  const previewSvg = useMemo(() => {
    if (!boxResult) return ''
    return generateBoxSvg(boxResult.result, boxResult.params, 1)
  }, [boxResult])

  const handleAdd = () => {
    if (!boxResult) return
    // Generate SVG with pixel scale for canvas
    const PX_PER_MM = 3.78
    const svgString = generateBoxSvg(boxResult.result, boxResult.params, PX_PER_MM)
    const blob = new Blob([svgString], { type: 'image/svg+xml' })
    const file = new File(
      [blob],
      `box-${width}x${height}x${depth}-${jointType}.svg`,
      { type: 'image/svg+xml' },
    )
    cm.loadSVG(file)
    closeModal()
  }

  if (!isOpen) return null

  const panelCount = boxResult ? boxResult.result.panels.length : 0
  const isValid = boxResult !== null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('boxGenerator')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Joint type */}
          <div>
            <Label className="text-xs">{t('boxJointType')}</Label>
            <Select value={jointType} onValueChange={(v) => setJointType(v as 'finger' | 'puzzle')}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="finger">{t('boxFingerJoint')}</SelectItem>
                <SelectItem value="puzzle">{t('boxPuzzleJoint')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Dimensions */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">{t('boxWidth')}</Label>
              <Input
                type="number" min={1} step={1}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">{t('boxHeight')}</Label>
              <Input
                type="number" min={1} step={1}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">{t('boxDepth')}</Label>
              <Input
                type="number" min={1} step={1}
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                className="mt-1 font-mono"
              />
            </div>
          </div>

          {/* Material thickness */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('boxThickness')}</Label>
              <span className="text-xs text-muted-foreground font-mono">{thickness} mm</span>
            </div>
            <Slider
              value={[thickness]}
              onValueChange={([v]) => setThickness(v)}
              min={0.5}
              max={25}
              step={0.5}
              className="mt-1"
            />
          </div>

          {/* Finger width */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('boxFingerWidth')}</Label>
              <span className="text-xs text-muted-foreground font-mono">{fingerWidth} mm</span>
            </div>
            <Slider
              value={[fingerWidth]}
              onValueChange={([v]) => setFingerWidth(v)}
              min={2}
              max={Math.min(50, Math.floor(Math.min(width, height, depth) / 3))}
              step={1}
              className="mt-1"
            />
          </div>

          {/* Open top */}
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t('boxOpenTop')}</Label>
            <Switch checked={openTop} onCheckedChange={setOpenTop} />
          </div>

          {/* Preview */}
          <div className="border rounded-md bg-white overflow-hidden p-2">
            {previewSvg ? (
              <div
                className="w-full"
                style={{ maxHeight: 160 }}
                dangerouslySetInnerHTML={{ __html: previewSvg }}
              />
            ) : (
              <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">
                {t('boxInvalidParams')}
              </div>
            )}
          </div>

          {/* Info */}
          {isValid && (
            <p className="text-xs text-muted-foreground">
              {t('boxPanelCount', { count: panelCount })}
            </p>
          )}

          {/* Add button */}
          <Button onClick={handleAdd} disabled={!isValid} className="w-full">
            {t('addToCanvas')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
