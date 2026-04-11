import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { X, Lock, Link } from 'lucide-react'

export function PropertiesPanel() {
  const { t } = useTranslation('canvas')
  const {
    showPropertiesPanel,
    selectedElementId,
    svgX,
    svgY,
    svgWidth,
    svgHeight,
    proportionalScale,
    setShowPropertiesPanel,
    setSvgDimensions,
    toggleProportionalScale,
    findElementById,
  } = useCanvasStore()

  if (!showPropertiesPanel || !selectedElementId) return null

  const element = findElementById(selectedElementId)
  if (!element) return null

  return (
    <div className="absolute top-2 left-2 z-20 w-64 bg-background border rounded-lg shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold truncate">{element.name}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setShowPropertiesPanel(false)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Position */}
      <div className="p-3 space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground">{t('position')}</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div>
              <label className="text-xs">X (mm)</label>
              <Input
                type="number"
                value={svgX}
                onChange={(e) => setSvgDimensions({ x: parseFloat(e.target.value) || 0 })}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-xs">Y (mm)</label>
              <Input
                type="number"
                value={svgY}
                onChange={(e) => setSvgDimensions({ y: parseFloat(e.target.value) || 0 })}
                className="h-7 text-xs"
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Size */}
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t('width')} / {t('height')}</Label>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={toggleProportionalScale}
              title={t('proportionalScale')}
            >
              {proportionalScale ? (
                <Link className="h-3 w-3 text-primary" />
              ) : (
                <Lock className="h-3 w-3 text-muted-foreground" />
              )}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div>
              <label className="text-xs">{t('width')} (mm)</label>
              <Input
                type="number"
                value={svgWidth}
                onChange={(e) => setSvgDimensions({ width: parseInt(e.target.value) || 0 })}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-xs">{t('height')} (mm)</label>
              <Input
                type="number"
                value={svgHeight}
                onChange={(e) => setSvgDimensions({ height: parseInt(e.target.value) || 0 })}
                className="h-7 text-xs"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
