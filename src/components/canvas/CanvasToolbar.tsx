import { useTranslation } from 'react-i18next'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useAppStore } from '@/stores/useAppStore'
import { GCodeGenerator } from '@/lib/gcode-generator'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  FlipHorizontal2,
  FlipVertical2,
  Undo2,
  Redo2,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Cog,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Magnet,
  Grid3x3,
  Group,
  Ungroup,
} from 'lucide-react'

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  shortcut,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
  shortcut?: string
  active?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size="icon"
          className="h-8 w-8"
          onClick={onClick}
          disabled={disabled}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {shortcut ? ` (${shortcut})` : ''}
      </TooltipContent>
    </Tooltip>
  )
}

function AlignButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClick}
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export function CanvasToolbar() {
  const { t } = useTranslation('canvas')
  const { t: tg } = useTranslation('gcode')
  const {
    selectedElementId,
    rasterData,
    globalConfig,
    isGroupSelection,
    selectedElements,
    snapToGrid,
    snapToObjects,
    toggleSnapToGrid,
    toggleSnapToObjects,
  } = useCanvasStore()
  const { setGCode, setEstimates } = useGCodeStore()
  const { addConsoleLine, setWorkspace } = useAppStore()
  const cm = useCanvasManager()
  const hasSelection = !!selectedElementId
  const hasMultipleSelection = isGroupSelection || selectedElements.length > 1

  const handleGenerate = async () => {
    const jobs = cm.getJobsForGCode()
    const isRaster = globalConfig.operationType === 'laser' && globalConfig.laserMode === 'raster'

    if (jobs.length === 0 && !isRaster) {
      addConsoleLine('No se encontraron elementos validos en el canvas')
      return
    }

    addConsoleLine('Generando G-code...')
    const generator = new GCodeGenerator()
    const result = await generator.generateFromJobs(jobs, rasterData)
    const est = generator.getEstimates()

    setGCode(result)
    setEstimates({
      time: est.time > 60 ? `${(est.time / 60).toFixed(1)} min` : `${est.time.toFixed(0)} seg`,
      distance: est.distance > 1000 ? `${(est.distance / 1000).toFixed(2)} m` : `${est.distance.toFixed(1)} mm`,
    })

    const lineCount = result.split('\n').length
    addConsoleLine(`G-code generado: ${lineCount} lineas, ${jobs.length} elementos`)
    setWorkspace('preview')
  }

  return (
    <div className="absolute top-2 left-2 z-10 flex flex-col items-center gap-1 bg-background/90 backdrop-blur-sm border rounded-lg p-1 shadow-sm">
      {/* Undo / Redo */}
      <ToolbarButton icon={Undo2} label={t('undo')} onClick={cm.undo} shortcut="Ctrl+Z" />
      <ToolbarButton icon={Redo2} label={t('redo')} onClick={cm.redo} shortcut="Ctrl+Shift+Z" />

      <Separator className="w-5" />

      {/* Zoom */}
      <ToolbarButton icon={ZoomIn} label={t('zoomIn')} onClick={cm.zoomIn} />
      <ToolbarButton icon={ZoomOut} label={t('zoomOut')} onClick={cm.zoomOut} />
      <ToolbarButton icon={Maximize} label={t('fitView')} onClick={cm.fitView} />

      <Separator className="w-5" />

      {/* Transform */}
      <ToolbarButton icon={FlipHorizontal2} label={t('flipH')} onClick={cm.flipH} disabled={!hasSelection} />
      <ToolbarButton icon={FlipVertical2} label={t('flipV')} onClick={cm.flipV} disabled={!hasSelection} />

      <Separator className="w-5" />

      {/* Align & Distribute */}
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!hasSelection}
              >
                <AlignCenterVertical className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{t('align')}</TooltipContent>
        </Tooltip>
        <PopoverContent side="right" className="w-auto p-2" align="start">
          <div className="flex flex-col gap-2">
            {/* Align to work area */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1 px-1">{t('alignToWorkArea')}</p>
              <div className="flex gap-0.5">
                <AlignButton icon={AlignStartVertical} label={t('alignLeft')} onClick={() => cm.alignToWorkArea('left')} />
                <AlignButton icon={AlignCenterVertical} label={t('alignCenterH')} onClick={() => cm.alignToWorkArea('centerH')} />
                <AlignButton icon={AlignEndVertical} label={t('alignRight')} onClick={() => cm.alignToWorkArea('right')} />
                <AlignButton icon={AlignStartHorizontal} label={t('alignTop')} onClick={() => cm.alignToWorkArea('top')} />
                <AlignButton icon={AlignCenterHorizontal} label={t('alignCenterV')} onClick={() => cm.alignToWorkArea('centerV')} />
                <AlignButton icon={AlignEndHorizontal} label={t('alignBottom')} onClick={() => cm.alignToWorkArea('bottom')} />
              </div>
            </div>

            {/* Align to first selected */}
            {hasMultipleSelection && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 px-1">{t('alignToFirst')}</p>
                <div className="flex gap-0.5">
                  <AlignButton icon={AlignStartVertical} label={t('alignLeft')} onClick={() => cm.alignToFirst('left')} />
                  <AlignButton icon={AlignCenterVertical} label={t('alignCenterH')} onClick={() => cm.alignToFirst('centerH')} />
                  <AlignButton icon={AlignEndVertical} label={t('alignRight')} onClick={() => cm.alignToFirst('right')} />
                  <AlignButton icon={AlignStartHorizontal} label={t('alignTop')} onClick={() => cm.alignToFirst('top')} />
                  <AlignButton icon={AlignCenterHorizontal} label={t('alignCenterV')} onClick={() => cm.alignToFirst('centerV')} />
                  <AlignButton icon={AlignEndHorizontal} label={t('alignBottom')} onClick={() => cm.alignToFirst('bottom')} />
                </div>
              </div>
            )}

            {/* Distribute */}
            {hasMultipleSelection && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 px-1">{t('distribute')}</p>
                <div className="flex gap-0.5">
                  <AlignButton icon={AlignHorizontalSpaceAround} label={t('distributeH')} onClick={() => cm.distribute('horizontal')} />
                  <AlignButton icon={AlignVerticalSpaceAround} label={t('distributeV')} onClick={() => cm.distribute('vertical')} />
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Separator className="w-5" />

      {/* Snap */}
      <ToolbarButton icon={Grid3x3} label={t('snapToGrid')} onClick={toggleSnapToGrid} active={snapToGrid} />
      <ToolbarButton icon={Magnet} label={t('snapToObjects')} onClick={toggleSnapToObjects} active={snapToObjects} />

      <Separator className="w-5" />

      {/* Group / Ungroup */}
      <ToolbarButton icon={Group} label={t('group')} onClick={cm.groupSelected} disabled={!hasMultipleSelection} shortcut="Ctrl+G" />
      <ToolbarButton icon={Ungroup} label={t('ungroup')} onClick={cm.ungroupSelected} disabled={!hasSelection} shortcut="Ctrl+Shift+G" />

      <Separator className="w-5" />

      {/* Edit */}
      <ToolbarButton icon={Copy} label={t('duplicate')} onClick={cm.duplicateSelected} disabled={!hasSelection} shortcut="Ctrl+D" />
      <ToolbarButton icon={Trash2} label={t('delete')} onClick={cm.deleteSelected} disabled={!hasSelection} shortcut="Supr" />

      <Separator className="w-5" />

      {/* Z-Order */}
      <ToolbarButton icon={ChevronUp} label={t('bringForward')} onClick={cm.bringForward} disabled={!hasSelection} shortcut="Ctrl+]" />
      <ToolbarButton icon={ChevronDown} label={t('sendBackward')} onClick={cm.sendBackward} disabled={!hasSelection} shortcut="Ctrl+[" />

      <Separator className="w-5" />

      {/* Generate G-code */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="default"
            size="icon"
            className="h-8 w-8"
            onClick={handleGenerate}
          >
            <Cog className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{tg('generate')}</TooltipContent>
      </Tooltip>
    </div>
  )
}
