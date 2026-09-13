import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGCodeStore, type ViewerColorMode } from '@/stores/useGCodeStore'
import { useCAMStore, type CAMMarker, type ParkPosition } from '@/stores/useCAMStore'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Play,
  Pause,
  Square,
  SkipBack,
  Gauge,
  Wrench,
  MessageSquare,
  X,
  Check,
  Trash2,
  MapPin,
  Palette,
  Box,
  Grid3x3,
  Move3d,
} from 'lucide-react'

const MARKER_STYLES: Record<string, { color: string; label: string }> = {
  'pause': { color: 'bg-amber-500', label: 'Pausa' },
  'tool-change': { color: 'bg-blue-500', label: 'Cambio herramienta' },
  'message': { color: 'bg-purple-500', label: 'Mensaje' },
}

interface MarkerDraft {
  type: CAMMarker['type']
  message: string
  parkPosition: ParkPosition
}

function MarkerEditor({ marker }: { marker: CAMMarker }) {
  const { updateMarker, removeMarker, updateParkPosition, selectMarker } = useCAMStore()
  const barRef = useRef<HTMLDivElement>(null)

  // Track if this is a freshly created marker (just added, never confirmed)
  const [isNew, setIsNew] = useState(() => {
    // Marker is "new" if created less than 500ms ago
    const ts = parseInt(marker.id.split(':')[1]?.split('-')[0] ?? '0')
    return Date.now() - ts < 1000
  })

  // Draft state for dirty tracking
  const [draft, setDraft] = useState<MarkerDraft>({
    type: marker.type,
    message: marker.message,
    parkPosition: { ...marker.parkPosition },
  })

  // Dirty = draft differs from saved marker
  const isDirty = !isNew && (
    draft.type !== marker.type ||
    draft.message !== marker.message ||
    draft.parkPosition.x !== marker.parkPosition.x ||
    draft.parkPosition.y !== marker.parkPosition.y ||
    draft.parkPosition.z !== marker.parkPosition.z
  )

  // Flash state for unsaved warning
  const [flash, setFlash] = useState(false)

  const handleAccept = () => {
    if (isNew) {
      // Confirm new marker with current draft values
      updateMarker(marker.id, {
        type: draft.type,
        message: draft.message,
      })
      updateParkPosition(marker.id, draft.parkPosition)
      setIsNew(false)
    } else if (isDirty) {
      // Save changes
      updateMarker(marker.id, {
        type: draft.type,
        message: draft.message,
      })
      updateParkPosition(marker.id, draft.parkPosition)
    }
    selectMarker(null)
  }

  const handleReject = () => {
    if (isNew) {
      // Delete the marker entirely — it was never confirmed
      removeMarker(marker.id)
    } else if (isDirty) {
      // Revert draft to saved state
      setDraft({
        type: marker.type,
        message: marker.message,
        parkPosition: { ...marker.parkPosition },
      })
    }
    selectMarker(null)
  }

  // Flash warning when user tries to move timeline with unsaved changes
  const flashWarn = useCallback(() => {
    setFlash(true)
    setTimeout(() => setFlash(false), 600)
  }, [])

  // Expose flash trigger for parent
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    bar.dataset.dirty = (isDirty || isNew) ? '1' : '0'
    bar.dataset.flashFn = 'true'
    const handler = () => flashWarn()
    bar.addEventListener('marker-flash', handler)
    return () => bar.removeEventListener('marker-flash', handler)
  }, [isDirty, isNew, flashWarn])

  const borderClass = flash
    ? 'border-amber-400 bg-amber-50/90 dark:bg-amber-950/60'
    : isNew
      ? 'border-primary/50 bg-primary/5'
      : isDirty
        ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/30'
        : 'border-border bg-muted/80'

  return (
    <div
      ref={barRef}
      className={`flex items-center gap-2 px-3 py-1.5 border-t transition-colors duration-300 ${borderClass}`}
    >
      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

      <Select
        value={draft.type}
        onValueChange={(v) => setDraft((d) => ({ ...d, type: v as CAMMarker['type'] }))}
      >
        <SelectTrigger className="h-7 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pause">Pausa</SelectItem>
          <SelectItem value="tool-change">Cambio herramienta</SelectItem>
          <SelectItem value="message">Mensaje</SelectItem>
        </SelectContent>
      </Select>

      <Input
        className="h-7 text-xs flex-1 min-w-0"
        placeholder="Mensaje..."
        value={draft.message}
        onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
        autoFocus={isNew}
      />

      {/* Park position */}
      <div className="flex items-center gap-1 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-blue-500"
              onClick={() => {
                const tcp = useCAMStore.getState().setup.toolChangePosition
                setDraft((d) => ({ ...d, parkPosition: { ...tcp } }))
              }}
              title="Usar posicion de tool change"
            >
              <Wrench className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Usar posicion de cambio</TooltipContent>
        </Tooltip>
        <Input
          type="number"
          className="h-6 w-12 text-[10px] px-1"
          value={draft.parkPosition.x}
          onChange={(e) => setDraft((d) => ({ ...d, parkPosition: { ...d.parkPosition, x: parseFloat(e.target.value) || 0 } }))}
          title="X"
        />
        <Input
          type="number"
          className="h-6 w-12 text-[10px] px-1"
          value={draft.parkPosition.y}
          onChange={(e) => setDraft((d) => ({ ...d, parkPosition: { ...d.parkPosition, y: parseFloat(e.target.value) || 0 } }))}
          title="Y"
        />
        <Input
          type="number"
          className="h-6 w-12 text-[10px] px-1"
          value={draft.parkPosition.z}
          onChange={(e) => setDraft((d) => ({ ...d, parkPosition: { ...d.parkPosition, z: parseFloat(e.target.value) || 0 } }))}
          title="Z"
        />
      </div>

      {/* Accept / Reject — always visible for new; visible when dirty for existing */}
      {(isNew || isDirty) ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100"
            onClick={handleAccept}
            title={isNew ? 'Confirmar' : 'Guardar cambios'}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-red-500 hover:text-red-600 hover:bg-red-100"
            onClick={handleReject}
            title={isNew ? 'Descartar' : 'Revertir'}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        /* Already saved — show delete only */
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 opacity-60 hover:opacity-100"
          onClick={() => { removeMarker(marker.id); selectMarker(null) }}
          title="Eliminar"
        >
          <Trash2 className="h-3 w-3 text-red-500" />
        </Button>
      )}
    </div>
  )
}

export function PreviewToolbar() {
  const { t } = useTranslation('gcode')
  const currentWorkspace = useAppStore((s) => s.currentWorkspace)

  const {
    gcodeGenerated,
    gcodeLines,
    currentGCodeLine,
    viewer3DPlaying,
    animationSpeed,
    animationProgress,
    setAnimationSpeed,
    setViewer3DPlaying,
    setAnimationProgress,
    viewerColorMode,
    setViewerColorMode,
    showStock,
    toggleStock,
    show3DGrid,
    toggle3DGrid,
    show3DAxes,
    toggle3DAxes,
  } = useGCodeStore()

  const {
    markers,
    selectedMarkerId,
    selectMarker,
    addTimelineMarker,
  } = useCAMStore()

  const selectedMarker = selectedMarkerId ? markers.find((m) => m.id === selectedMarkerId) : null
  const isCAM = currentWorkspace === 'cam'

  if (!gcodeGenerated) return null

  const handlePlayPause = () => setViewer3DPlaying(!viewer3DPlaying)

  const handleStop = () => {
    setViewer3DPlaying(false)
    setAnimationProgress(0)
  }

  const handleRestart = () => {
    setAnimationProgress(0)
    setViewer3DPlaying(true)
  }

  const handleAddMarker = (type: CAMMarker['type']) => {
    addTimelineMarker(animationProgress, type)
  }

  // Intercept timeline scrub when marker editor has unsaved changes
  const handleProgressChange = (val: number) => {
    if (selectedMarkerId) {
      // Check if editor has unsaved state
      const editorEl = document.querySelector('[data-dirty="1"]')
      if (editorEl) {
        editorEl.dispatchEvent(new Event('marker-flash'))
        return // Block scrub — user must accept/reject first
      }
    }
    setAnimationProgress(val)
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20">
      {/* Marker editor (when selected) */}
      {selectedMarker && <MarkerEditor key={selectedMarker.id} marker={selectedMarker} />}

      {/* Progress bar with markers */}
      <div className="px-3 relative">
        <Slider
          value={[animationProgress]}
          onValueChange={([val]) => handleProgressChange(val)}
          max={100}
          step={0.1}
          className="cursor-pointer"
        />
        {/* Timeline markers */}
        {markers.map((m) => {
          const style = MARKER_STYLES[m.type]
          const isSelected = selectedMarkerId === m.id
          return (
            <Tooltip key={m.id}>
              <TooltipTrigger asChild>
                <div
                  className={`absolute top-1/2 -translate-y-1/2 rounded-full border-2 cursor-pointer z-10 transition-all ${style.color} ${
                    isSelected
                      ? 'w-3.5 h-3.5 border-white shadow-lg ring-2 ring-primary'
                      : 'w-2.5 h-2.5 border-background shadow'
                  }`}
                  style={{ left: `calc(${m.progress}% + 12px - ${m.progress * 0.24}px)` }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isCAM) {
                      selectMarker(isSelected ? null : m.id)
                    }
                    setAnimationProgress(m.progress)
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <span className="font-medium">{style.label}</span>
                {m.message && <span className="text-muted-foreground ml-1">— {m.message}</span>}
                <br />
                <span className="text-muted-foreground">
                  Park: X{m.parkPosition.x} Y{m.parkPosition.y} Z{m.parkPosition.z}
                </span>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-background/80 backdrop-blur-sm border-t">
        {/* Transport controls */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRestart}>
            <SkipBack className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleStop}>
            <Square className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewer3DPlaying ? 'secondary' : 'default'}
            size="icon"
            className="h-8 w-8"
            onClick={handlePlayPause}
          >
            {viewer3DPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        </div>

        {/* Add marker buttons (CAM only) */}
        {isCAM && (
          <div className="flex items-center gap-0.5 border-l pl-2 ml-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleAddMarker('pause')}>
                  <Pause className="h-3 w-3 text-amber-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Pausa aqui</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleAddMarker('tool-change')}>
                  <Wrench className="h-3 w-3 text-blue-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cambio de herramienta</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleAddMarker('message')}>
                  <MessageSquare className="h-3 w-3 text-purple-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Mensaje</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Progress info */}
        <div className="flex-1 text-center">
          <span className="text-xs font-mono text-muted-foreground">
            {currentGCodeLine > 0 ? (
              <>
                {t('line')} <span className="text-foreground font-semibold">{currentGCodeLine}</span> / {gcodeLines}
              </>
            ) : (
              <>{Math.round(animationProgress)}%</>
            )}
          </span>
        </div>

        {/* Vista: color del recorrido, stock, grilla y ejes */}
        <div className="flex items-center gap-0.5 border-r pr-2 mr-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Select value={viewerColorMode} onValueChange={(v) => setViewerColorMode(v as ViewerColorMode)}>
                  <SelectTrigger className="h-7 w-[104px] text-[11px] gap-1">
                    <Palette className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Operacion</SelectItem>
                    <SelectItem value="feed">Avance</SelectItem>
                    <SelectItem value="depth">Profundidad</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TooltipTrigger>
            <TooltipContent>Con que se pinta el recorrido</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showStock ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={toggleStock}
              >
                <Box className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bloque de material</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={show3DGrid ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={toggle3DGrid}
              >
                <Grid3x3 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Grilla</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={show3DAxes ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={toggle3DAxes}
              >
                <Move3d className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ejes y origen</TooltipContent>
          </Tooltip>
        </div>

        {/* Speed control */}
        <div className="flex items-center gap-1.5 min-w-[80px] max-w-[160px] flex-shrink">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Slider
            value={[animationSpeed]}
            onValueChange={([val]) => setAnimationSpeed(val)}
            min={0.1}
            max={5}
            step={0.1}
            className="flex-1"
          />
          <span className="text-xs font-mono text-muted-foreground w-8 text-right shrink-0">
            {animationSpeed.toFixed(1)}x
          </span>
        </div>
      </div>
    </div>
  )
}
