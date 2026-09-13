import { useTranslation } from 'react-i18next'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { useCanvasStore, GEOMETRIC_SNAP_KINDS } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useAppStore } from '@/stores/useAppStore'
import { GCodeGenerator } from '@/lib/gcode-generator'
import { withGenerating } from '@/lib/gcode-run'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Ruler,
  ArrowLeftRight,
  Scissors,
  FlipHorizontal,
  FlipVertical,
  FlipHorizontal2,
  FlipVertical2,
  Undo2,
  Redo2,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Cog,
  Loader2,
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
  LayoutGrid,
  Stethoscope,
  Scaling,
  Combine,
  MinusSquare,
  SquaresIntersect,
  SquareAsterisk,
  PlusSquare,
  SquareSlash,
  Group,
  Ungroup,
  ArrowRightToLine,
  Columns2,
  Columns3,
  GripVertical,
  Crosshair,
  Spline,
  Grid2x2,
  Focus,
  Shapes,
} from 'lucide-react'

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  shortcut,
  active,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
  shortcut?: string
  active?: boolean
  compact?: boolean
}) {
  const size = compact ? 'h-7 w-7' : 'h-8 w-8'
  const iconSize = compact ? 'h-3.5 w-3.5' : 'h-4 w-4'

  const button = (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="icon"
      className={size}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className={iconSize} />
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span className="inline-flex" tabIndex={0}>
            {button}
          </span>
        ) : (
          button
        )}
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="col-span-full text-[9px] font-medium text-muted-foreground uppercase tracking-wider px-0.5 pt-1.5 pb-0">
      {children}
    </p>
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
    snapGeometry,
    snapKinds,
    toggleSnapGeometry,
    setSnapKind,
    orthoMode,
    orthoAngleDeg,
    toggleOrtho,
    setOrthoAngle,
    showGrid,
    gridSpacingMm,
    gridAdaptive,
    showRulers,
    setGridSpacing,
    toggleGridAdaptive,
    toggleRulers,
    showGuides,
    guides,
    toggleGuides,
    clearGuides,
    drawingMode,
    setDrawingMode,
    measuringMode,
    setMeasuringMode,
    trimMode,
    setTrimMode,
    extendMode,
    setExtendMode,
    toolbarColumns,
    cycleToolbarColumns,
  } = useCanvasStore()
  const { setGCode, setEstimates } = useGCodeStore()
  const generating = useGCodeStore((s) => s.generating)
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
    const { result, est } = await withGenerating(async () => {
      const generator = new GCodeGenerator()
      const out = await generator.generateFromJobs(jobs, rasterData)
      return { result: out, est: generator.getEstimates() }
    })

    setGCode(result)
    setEstimates({
      time: est.time > 60 ? `${(est.time / 60).toFixed(1)} min` : `${est.time.toFixed(0)} seg`,
      distance: est.distance > 1000 ? `${(est.distance / 1000).toFixed(2)} m` : `${est.distance.toFixed(1)} mm`,
    })

    const lineCount = result.split('\n').length
    addConsoleLine(`G-code generado: ${lineCount} lineas, ${jobs.length} elementos`)
    setWorkspace('cam')
  }

  const cols = toolbarColumns
  const compact = cols === 1
  const showTitles = cols === 3
  const columnsIcon = cols === 1 ? GripVertical : cols === 2 ? Columns2 : Columns3

  const sep = showTitles ? null : (
    <Separator className="col-span-full w-4/5 mx-auto" />
  )

  const alignPopover = (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {hasSelection ? (
              <Button variant="ghost" size="icon" className={compact ? 'h-7 w-7' : 'h-8 w-8'}>
                <AlignCenterVertical className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              </Button>
            ) : (
              <span className="inline-flex" tabIndex={0}>
                <Button variant="ghost" size="icon" className={compact ? 'h-7 w-7' : 'h-8 w-8'} disabled>
                  <AlignCenterVertical className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                </Button>
              </span>
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t('align')}</TooltipContent>
      </Tooltip>
      <PopoverContent side="right" className="w-auto p-2" align="start">
        <div className="flex flex-col gap-2">
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
  )

  const offsetPopover = (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {hasSelection ? (
              <Button variant="ghost" size="icon" className={compact ? 'h-7 w-7' : 'h-8 w-8'}>
                <Scaling className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              </Button>
            ) : (
              <span className="inline-flex" tabIndex={0}>
                <Button variant="ghost" size="icon" className={compact ? 'h-7 w-7' : 'h-8 w-8'} disabled>
                  <Scaling className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                </Button>
              </span>
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t('offset')}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-48 p-3" side="right" align="start">
        <div className="space-y-2">
          <label className="text-xs font-medium">{t('offset')} (mm)</label>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.1"
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              defaultValue="2.0"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseFloat((e.target as HTMLInputElement).value)
                  if (!isNaN(val)) cm.offsetSelected(val)
                }
              }}
            />
            <Button size="sm" className="h-8 px-2" onClick={(e) => {
              const input = e.currentTarget.previousElementSibling as HTMLInputElement
              const val = parseFloat(input.value)
              if (!isNaN(val)) cm.offsetSelected(val)
            }}>
              OK
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            {t('offsetHint')}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )

  // Grilla y reglas
  const gridPopover = (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={showGrid ? 'secondary' : 'ghost'}
              size="icon"
              className={compact ? 'h-7 w-7' : 'h-8 w-8'}
            >
              <Grid2x2 className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t('gridSettings')}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-56 p-3" side="right" align="start">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={() => useCanvasStore.setState({ showGrid: !showGrid })}
              className="h-3.5 w-3.5"
            />
            {t('showGrid')}
          </label>
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={showRulers}
              onChange={toggleRulers}
              className="h-3.5 w-3.5"
            />
            {t('showRulers')}
          </label>
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={showGuides}
              onChange={toggleGuides}
              className="h-3.5 w-3.5"
            />
            {t('showGuides')}
          </label>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full text-[11px]"
            disabled={guides.length === 0}
            onClick={clearGuides}
          >
            {t('clearGuides')} ({guides.length})
          </Button>
          <Separator />
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={gridAdaptive}
              onChange={toggleGridAdaptive}
              className="h-3.5 w-3.5"
            />
            {t('gridAdaptive')}
          </label>
          <div className={gridAdaptive ? 'opacity-50' : ''}>
            <label className="text-xs font-medium">{t('gridSpacing')}</label>
            <div className="flex gap-1 mt-1">
              {[1, 5, 10, 25].map((mm) => (
                <Button
                  key={mm}
                  size="sm"
                  variant={gridSpacingMm === mm ? 'secondary' : 'outline'}
                  className="h-7 flex-1 px-1 text-[11px]"
                  disabled={gridAdaptive}
                  onClick={() => setGridSpacing(mm)}
                >
                  {mm}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground italic">{t('gridAdaptiveHint')}</p>
          <p className="text-[10px] text-muted-foreground italic">{t('guidesHint')}</p>
        </div>
      </PopoverContent>
    </Popover>
  )

  // Snap geometrico: toggle maestro en el boton, tipos en el popover
  const snapGeometryPopover = (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={snapGeometry ? 'secondary' : 'ghost'}
              size="icon"
              className={compact ? 'h-7 w-7' : 'h-8 w-8'}
            >
              <Crosshair className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t('snapGeometry')}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-56 p-3" side="right" align="start">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={snapGeometry}
              onChange={toggleSnapGeometry}
              className="h-3.5 w-3.5"
            />
            {t('snapGeometry')}
          </label>
          <Separator />
          <div className="space-y-1.5">
            {GEOMETRIC_SNAP_KINDS.map((kind) => (
              <label
                key={kind}
                className={`flex items-center gap-2 text-xs cursor-pointer ${snapGeometry ? '' : 'opacity-50'}`}
              >
                <input
                  type="checkbox"
                  checked={snapKinds[kind]}
                  disabled={!snapGeometry}
                  onChange={(e) => setSnapKind(kind, e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                {t(`snapKind.${kind}`)}
              </label>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground italic">{t('snapGeometryHint')}</p>
        </div>
      </PopoverContent>
    </Popover>
  )

  // Ortho / polar: toggle maestro + paso angular
  const orthoPopover = (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={orthoMode ? 'secondary' : 'ghost'}
              size="icon"
              className={compact ? 'h-7 w-7' : 'h-8 w-8'}
            >
              <Spline className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t('ortho')}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-56 p-3" side="right" align="start">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={orthoMode}
              onChange={toggleOrtho}
              className="h-3.5 w-3.5"
            />
            {t('ortho')}
          </label>
          <Separator />
          <label className="text-xs font-medium">{t('orthoAngle')}</label>
          <div className="flex gap-1">
            {[90, 45, 30, 15].map((deg) => (
              <Button
                key={deg}
                size="sm"
                variant={orthoAngleDeg === deg ? 'secondary' : 'outline'}
                className="h-7 flex-1 px-1 text-[11px]"
                onClick={() => setOrthoAngle(deg)}
              >
                {deg}°
              </Button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground italic">{t('orthoHint')}</p>
        </div>
      </PopoverContent>
    </Popover>
  )

  const colWidth = compact ? '1.75rem' : '2rem'

  return (
    <div
      className={`absolute z-10 bg-background/90 backdrop-blur-sm border rounded-lg p-1 shadow-sm max-h-[calc(100%-3rem)] overflow-y-auto ${
        showRulers ? 'top-6 left-6' : 'top-2 left-2'
      }`}
    >
      {/* Column toggle */}
      <div className="flex justify-center">
        <ToolbarButton
          icon={columnsIcon}
          label={`${cols} ${cols === 1 ? 'columna' : 'columnas'}`}
          onClick={cycleToolbarColumns}
          compact={compact}
        />
      </div>

      {!compact && <Separator className="w-full my-0.5" />}

      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${colWidth})`,
          justifyItems: 'center',
          gap: compact ? '1px' : '0.25rem',
        }}
      >
        {/* ── Undo / Redo ── */}
        {showTitles && <SectionTitle>{t('sectionHistory')}</SectionTitle>}
        <ToolbarButton icon={Undo2} label={t('undo')} onClick={cm.undo} shortcut="Ctrl+Z" compact={compact} />
        <ToolbarButton icon={Redo2} label={t('redo')} onClick={cm.redo} shortcut="Ctrl+Shift+Z" compact={compact} />

        {sep}

        {/* ── Zoom ── */}
        {showTitles && <SectionTitle>{t('sectionZoom')}</SectionTitle>}
        <ToolbarButton icon={ZoomIn} label={t('zoomIn')} onClick={cm.zoomIn} compact={compact} />
        <ToolbarButton icon={ZoomOut} label={t('zoomOut')} onClick={cm.zoomOut} compact={compact} />
        <ToolbarButton icon={Maximize} label={t('fitView')} onClick={cm.fitView} compact={compact} />
        <ToolbarButton icon={Focus} label={t('fitSelection')} onClick={cm.fitSelection} compact={compact} />

        {sep}

        {/* ── Measurement & Edit Tools ── */}
        {showTitles && <SectionTitle>{t('sectionMeasure')}</SectionTitle>}
        <ToolbarButton
          icon={Ruler}
          label={t('measure')}
          onClick={() => setMeasuringMode(measuringMode === 'distance' ? false : 'distance')}
          active={measuringMode === 'distance'}
          compact={compact}
        />
        <ToolbarButton
          icon={Scaling}
          label={t('measureAngle')}
          onClick={() => setMeasuringMode(measuringMode === 'angle' ? false : 'angle')}
          active={measuringMode === 'angle'}
          compact={compact}
        />
        <ToolbarButton
          icon={ArrowLeftRight}
          label={t('addCota') || 'Agregar Cota'}
          onClick={() => setDrawingMode(drawingMode === 'cota' ? null : 'cota')}
          active={drawingMode === 'cota'}
          compact={compact}
        />
        <ToolbarButton
          icon={Scissors}
          label={t('trim') || 'Recortar (Trim)'}
          onClick={() => setTrimMode(!trimMode)}
          active={trimMode}
          compact={compact}
        />
        <ToolbarButton
          icon={ArrowRightToLine}
          label={t('extend') || 'Extender hasta interseccion'}
          onClick={() => setExtendMode(!extendMode)}
          active={extendMode}
          compact={compact}
        />

        {sep}

        {/* ── Transform ── */}
        {showTitles && <SectionTitle>{t('sectionTransform')}</SectionTitle>}
        <ToolbarButton icon={FlipHorizontal2} label={t('flipH')} onClick={cm.flipH} disabled={!hasSelection} compact={compact} />
        <ToolbarButton icon={FlipVertical2} label={t('flipV')} onClick={cm.flipV} disabled={!hasSelection} compact={compact} />

        {sep}

        {/* ── Mirror ── */}
        {showTitles && <SectionTitle>{t('sectionMirror')}</SectionTitle>}
        <ToolbarButton icon={FlipHorizontal} label={t('mirrorH')} onClick={() => cm.mirrorSelected('h')} disabled={!hasSelection} compact={compact} />
        <ToolbarButton icon={FlipVertical} label={t('mirrorV')} onClick={() => cm.mirrorSelected('v')} disabled={!hasSelection} compact={compact} />

        {sep}

        {/* ── Align ── */}
        {showTitles && <SectionTitle>{t('align')}</SectionTitle>}
        {alignPopover}

        {sep}

        {/* ── Snap ── */}
        {showTitles && <SectionTitle>{t('sectionSnap')}</SectionTitle>}
        <ToolbarButton icon={Grid3x3} label={t('snapToGrid')} onClick={toggleSnapToGrid} active={snapToGrid} compact={compact} />
        <ToolbarButton icon={Magnet} label={t('snapToObjects')} onClick={toggleSnapToObjects} active={snapToObjects} compact={compact} />
        {snapGeometryPopover}
        {orthoPopover}
        {gridPopover}

        {sep}

        {/* ── Group / Ungroup ── */}
        {showTitles && <SectionTitle>{t('sectionGroup')}</SectionTitle>}
        <ToolbarButton icon={Group} label={t('group')} onClick={cm.groupSelected} disabled={!hasMultipleSelection} shortcut="Ctrl+G" compact={compact} />
        <ToolbarButton icon={Ungroup} label={t('ungroup')} onClick={cm.ungroupSelected} disabled={!hasSelection} shortcut="Ctrl+Shift+G" compact={compact} />

        {sep}

        {/* ── Boolean Operations ── */}
        {showTitles && <SectionTitle>{t('sectionBoolean')}</SectionTitle>}
        <ToolbarButton icon={PlusSquare} label={t('boolUnion')} onClick={() => cm.booleanOperationSelected('union')} disabled={!hasMultipleSelection} compact={compact} />
        <ToolbarButton icon={MinusSquare} label={t('boolDifference')} onClick={() => cm.booleanOperationSelected('difference')} disabled={!hasMultipleSelection} compact={compact} />
        <ToolbarButton icon={SquareSlash} label={t('boolIntersection')} onClick={() => cm.booleanOperationSelected('intersection')} disabled={!hasMultipleSelection} compact={compact} />
        <ToolbarButton icon={SquareAsterisk} label={t('boolXor')} onClick={() => cm.booleanOperationSelected('xor')} disabled={!hasMultipleSelection} compact={compact} />

        {sep}

        {/* ── Offset ── */}
        {offsetPopover}

        {sep}

        {/* ── Pattern / Array ── */}
        <ToolbarButton
          icon={LayoutGrid}
          label={t('array.title') || 'Patron (Array)'}
          onClick={() => useAppStore.getState().openModal('array')}
          disabled={!hasSelection}
          compact={compact}
        />

        {/* ── Nesting / auto-layout ── */}
        <ToolbarButton
          icon={Shapes}
          label={t('nesting.title')}
          onClick={() => useAppStore.getState().openModal('nesting')}
          compact={compact}
        />

        {sep}

        {/* ── Diagnostico de vectores ── */}
        <ToolbarButton
          icon={Stethoscope}
          label={t('vectorDiagnostics') || 'Diagnostico de vectores'}
          onClick={() => useAppStore.getState().openModal('vectorDiagnostics')}
          compact={compact}
        />

        {sep}

        {/* ── Edit ── */}
        {showTitles && <SectionTitle>{t('sectionEdit')}</SectionTitle>}
        <ToolbarButton icon={Copy} label={t('duplicate')} onClick={cm.duplicateSelected} disabled={!hasSelection} shortcut="Ctrl+D" compact={compact} />
        <ToolbarButton icon={Trash2} label={t('delete')} onClick={cm.deleteSelected} disabled={!hasSelection} shortcut="Supr" compact={compact} />

        {sep}

        {/* ── Z-Order ── */}
        {showTitles && <SectionTitle>{t('sectionZOrder')}</SectionTitle>}
        <ToolbarButton icon={ChevronUp} label={t('bringForward')} onClick={cm.bringForward} disabled={!hasSelection} shortcut="Ctrl+]" compact={compact} />
        <ToolbarButton icon={ChevronDown} label={t('sendBackward')} onClick={cm.sendBackward} disabled={!hasSelection} shortcut="Ctrl+[" compact={compact} />

        {sep}

        {/* ── Generate G-code ── */}
        <div className="col-span-full flex justify-center pt-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="icon"
                className={compact ? 'h-7 w-7' : 'h-8 w-8'}
                onClick={handleGenerate}
                disabled={generating}
                aria-busy={generating}
              >
                {generating ? (
                  <Loader2 className={`animate-spin ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
                ) : (
                  <Cog className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {generating ? tg('generating') : tg('generate')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
