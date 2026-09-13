import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'

export function CanvasFooter() {
  const { t } = useTranslation('canvas')
  const {
    workArea, selectedObjectProps, drawingMode, selectedElementId, elements,
    nodeEditingElementId, measuringMode, trimMode, cursorMm, zoomLevel,
  } = useCanvasStore()

  const selectedElement = selectedElementId
    ? elements.find((e) => e.id === selectedElementId)
    : null
  const nodeEditElement = nodeEditingElementId
    ? elements.find((e) => e.id === nodeEditingElementId)
    : null

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-1 bg-background/90 backdrop-blur-sm border-t text-xs h-7">
      {/* Left: contextual info */}
      <div className="flex items-center gap-3 text-muted-foreground min-w-0">
        {nodeEditingElementId ? (
          <span className="text-amber-500 font-medium truncate">
            {t('nodeEditHint', { name: nodeEditElement?.name ?? '' })}
          </span>
        ) : measuringMode === 'distance' ? (
          <span className="text-emerald-500 font-medium truncate">
            {t('measuringHint')}
          </span>
        ) : measuringMode === 'angle' ? (
          <span className="text-violet-500 font-medium truncate">
            {t('measuringAngleHint')}
          </span>
        ) : trimMode ? (
          <span className="text-red-500 font-medium truncate">
            {t('trim')}
          </span>
        ) : drawingMode ? (
          <span className="text-sky-500 font-medium truncate">
            {drawingMode === 'rect' || drawingMode === 'circle' || drawingMode === 'ellipse'
              ? t('drawShapeHint')
              : t(`draw${drawingMode.charAt(0).toUpperCase() + drawingMode.slice(1)}Hint`)}
          </span>
        ) : selectedObjectProps && selectedElement ? (
          <span className="truncate">
            <span className="font-medium text-foreground">{selectedElement.name}</span>
            <span className="text-muted-foreground/60 mx-1.5">|</span>
            X: {selectedObjectProps.x.toFixed(1)}  Y: {selectedObjectProps.y.toFixed(1)}
            <span className="text-muted-foreground/60 mx-1.5">|</span>
            {selectedObjectProps.width.toFixed(1)} x {selectedObjectProps.height.toFixed(1)} mm
            {selectedObjectProps.angle !== 0 && (
              <span>
                <span className="text-muted-foreground/60 mx-1.5">|</span>
                {selectedObjectProps.angle.toFixed(1)}°
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground/60">
            {elements.length > 0
              ? `${elements.length} ${t('elements').toLowerCase()}`
              : t('loadSVG')}
          </span>
        )}
      </div>

      {/* Right: cursor, zoom y area de trabajo */}
      <div className="flex items-center gap-3 shrink-0 ml-3 text-muted-foreground/80">
        <span className="font-mono tabular-nums w-[9.5rem] text-right">
          {cursorMm
            ? `X ${cursorMm.x.toFixed(2)}  Y ${cursorMm.y.toFixed(2)}`
            : '—'}
        </span>
        <span className="text-muted-foreground/60">|</span>
        <span className="font-mono tabular-nums w-12 text-right">
          {Math.round(zoomLevel * 100)}%
        </span>
        <span className="text-muted-foreground/60">|</span>
        <span className="text-muted-foreground/60">
          {workArea.width} x {workArea.height} mm
        </span>
      </div>
    </div>
  )
}
