import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'

export function CanvasFooter() {
  const { t } = useTranslation('canvas')
  const { svgX, svgY, svgWidth, svgHeight, workArea } = useCanvasStore()

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-1 bg-background/90 backdrop-blur-sm border-t text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <span>
          {t('x')}: {svgX.toFixed(1)} mm | {t('y')}: {svgY.toFixed(1)} mm
        </span>
        <span>
          {t('width')}: {svgWidth} mm x {t('height')}: {svgHeight} mm
        </span>
      </div>
      <span>
        {t('area')}: {workArea.width} x {workArea.height} mm
      </span>
    </div>
  )
}
