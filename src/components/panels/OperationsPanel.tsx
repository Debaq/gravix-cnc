import { useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCAMStore, type CAMOperation, type CAMMarker } from '@/stores/useCAMStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { useAppStore } from '@/stores/useAppStore'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useSerial } from '@/hooks/useSerial'
import { useProject } from '@/hooks/useProject'
import { GCodeGenerator } from '@/lib/gcode-generator'
import { withGenerating } from '@/lib/gcode-run'
import { validateToolVsPaths } from '@/lib/geometry'
import { generateBoundaryGCode, computeBBox } from '@/components/modals/SetupWizardModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  Eye,
  EyeOff,
  Focus,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Cog,
  Loader2,
  Copy,
  Download,
  Square,
  ListPlus,
  Scan,
  GripVertical,
  Box,
  ChevronDown,
  ChevronRight,
  Shield,
  Layers,
  CircleDot,
  PenTool,
  Zap,
  Pencil,
  Pause,
  ArrowDownToLine,
  MessageSquare,
  Wrench,
  Plus,
  Trash2,
} from 'lucide-react'

const WORK_TYPE_ICONS: Record<string, typeof Box> = {
  outline: Box,
  inside: Box,
  outside: Box,
  pocket: Layers,
  drill: CircleDot,
  vcarve: PenTool,
  chamfer: Box,
}

const OP_TYPE_ICONS: Record<string, typeof Box> = {
  cnc: Cog,
  laser: Zap,
  plotter: PenTool,
  pencil: Pencil,
}

function getOpIcon(config: CAMOperation['config']) {
  if (config.operationType === 'cnc') {
    return WORK_TYPE_ICONS[config.workType] ?? Box
  }
  return OP_TYPE_ICONS[config.operationType] ?? Box
}

function getOpLabel(config: CAMOperation['config'], ts: (k: string) => string) {
  if (config.operationType === 'cnc') {
    return ts(`workTypes.${config.workType}`)
  }
  if (config.operationType === 'laser') {
    return ts(`laserModes.${config.laserMode}`)
  }
  return ts(`operationTypes.${config.operationType}`)
}

function StatusIcon({ status }: { status: CAMOperation['status'] }) {
  switch (status) {
    case 'valid':
      return <CheckCircle2 className="h-3 w-3 text-emerald-500" />
    case 'warning':
      return <AlertTriangle className="h-3 w-3 text-amber-500" />
    case 'error':
      return <AlertCircle className="h-3 w-3 text-red-500" />
  }
}

function OperationRow({ op, isSelected, onSelect }: {
  op: CAMOperation
  isSelected: boolean
  onSelect: () => void
}) {
  const { t: ts } = useTranslation('settings')
  const { toggleOperationEnabled, soloOperation, soloOperationId } = useCAMStore()
  const { tools } = useLibraryStore()

  const Icon = getOpIcon(op.config)
  const label = getOpLabel(op.config, ts)
  const tool = op.config.tool ? tools.find((t) => t.id === op.config.tool) : null
  const isSolo = soloOperationId === op.id

  const depthLabel = op.config.operationType === 'cnc'
    ? `${Math.abs(op.config.depth)}mm`
    : op.config.operationType === 'laser'
      ? `${op.config.laserPower}%`
      : ''

  return (
    <div
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isSelected
          ? 'bg-primary/15 border border-primary/30'
          : 'hover:bg-muted/80 border border-transparent'
      }`}
      onClick={onSelect}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0 cursor-grab" />

      <StatusIcon status={op.status} />

      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium truncate">{op.elementName}</span>
          {op.operationIndex >= 0 && (
            <Badge variant="secondary" className="text-[9px] h-3.5 px-1 shrink-0">
              #{op.operationIndex + 1}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-muted-foreground">{label}</span>
          {depthLabel && (
            <span className="text-[10px] text-muted-foreground/70">{depthLabel}</span>
          )}
          {tool && (
            <span className="text-[10px] text-muted-foreground/70 truncate">{tool.name}</span>
          )}
        </div>
      </div>

      {/* Solo button */}
      <Button
        variant="ghost"
        size="icon"
        className={`h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 ${isSolo ? 'opacity-100 text-primary' : ''}`}
        onClick={(e) => { e.stopPropagation(); soloOperation(op.id) }}
        title="Solo"
      >
        <Focus className="h-3 w-3" />
      </Button>

      {/* Visibility toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
        onClick={(e) => { e.stopPropagation(); toggleOperationEnabled(op.id) }}
      >
        {op.enabled ? (
          <Eye className="h-3 w-3" />
        ) : (
          <EyeOff className="h-3 w-3 text-muted-foreground" />
        )}
      </Button>
    </div>
  )
}

const MARKER_ICONS: Record<string, typeof Pause> = {
  'pause': Pause,
  'tool-change': Wrench,
  'message': MessageSquare,
}

const MARKER_COLORS: Record<string, string> = {
  'pause': 'bg-amber-100 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800',
  'tool-change': 'bg-blue-100 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800',
  'message': 'bg-purple-100 dark:bg-purple-950/40 border-purple-300 dark:border-purple-800',
}

const MARKER_LABELS: Record<string, string> = {
  'pause': 'Pausa',
  'tool-change': 'Cambio herramienta',
  'message': 'Mensaje',
}

function MarkerRow({ marker }: { marker: CAMMarker }) {
  const { removeMarker, updateMarker, selectMarker, selectedMarkerId } = useCAMStore()
  const Icon = MARKER_ICONS[marker.type] ?? Pause
  const isSelected = selectedMarkerId === marker.id

  return (
    <div
      className={`group flex items-center gap-1.5 px-2 py-1 rounded border mx-1 cursor-pointer ${MARKER_COLORS[marker.type]} ${isSelected ? 'ring-1 ring-primary' : ''}`}
      onClick={() => selectMarker(isSelected ? null : marker.id)}
    >
      <ArrowDownToLine className="h-3 w-3 text-muted-foreground/50 shrink-0" />
      <Icon className="h-3 w-3 shrink-0" />
      <input
        className="flex-1 min-w-0 text-[11px] bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
        value={marker.message}
        onChange={(e) => { e.stopPropagation(); updateMarker(marker.id, { message: e.target.value }) }}
        onClick={(e) => e.stopPropagation()}
        placeholder={MARKER_LABELS[marker.type]}
      />
      <span className="text-[9px] text-muted-foreground/60 shrink-0">{Math.round(marker.progress)}%</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100"
        onClick={(e) => { e.stopPropagation(); removeMarker(marker.id) }}
      >
        <Trash2 className="h-2.5 w-2.5" />
      </Button>
    </div>
  )
}

function AddMarkerButton({ opIndex, totalOps }: { opIndex: number; totalOps: number }) {
  const { addTimelineMarker } = useCAMStore()
  // Estimate progress: this op ends roughly at (opIndex+1)/totalOps * 100
  const estimatedProgress = totalOps > 0 ? ((opIndex + 1) / totalOps) * 100 : 50

  return (
    <div className="flex items-center gap-0.5 px-2 opacity-0 group-hover/list:opacity-100 hover:!opacity-100 transition-opacity">
      <div className="flex-1 h-px bg-border" />
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4"
        onClick={() => addTimelineMarker(estimatedProgress, 'pause')}
        title="Agregar pausa"
      >
        <Pause className="h-2.5 w-2.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4"
        onClick={() => addTimelineMarker(estimatedProgress, 'tool-change')}
        title="Cambio de herramienta"
      >
        <Wrench className="h-2.5 w-2.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4"
        onClick={() => addTimelineMarker(estimatedProgress, 'message')}
        title="Agregar mensaje"
      >
        <MessageSquare className="h-2.5 w-2.5" />
      </Button>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function OperationsList() {
  const { operations, markers, operationOrder, selectedOperationId, selectOperation } = useCAMStore()

  if (operations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Box className="h-10 w-10 text-muted-foreground/50 mb-2" />
        <p className="text-xs text-muted-foreground">Sin operaciones</p>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          Agrega elementos en CAD para generar operaciones
        </p>
      </div>
    )
  }

  // Build interleaved list: operations in order, markers sorted by progress inserted between
  const orderedOps = operationOrder
    .map((id) => operations.find((o) => o.id === id))
    .filter(Boolean) as CAMOperation[]

  const totalOps = orderedOps.length
  const sortedMarkers = [...markers].sort((a, b) => a.progress - b.progress)

  // Each op covers a range: op[i] covers [i/total, (i+1)/total] * 100
  const items: ({ kind: 'op'; op: CAMOperation; idx: number } | { kind: 'marker'; marker: CAMMarker })[] = []
  let markerIdx = 0

  for (let i = 0; i < orderedOps.length; i++) {
    const opEnd = ((i + 1) / totalOps) * 100
    items.push({ kind: 'op', op: orderedOps[i], idx: i })
    // Insert markers that fall before next op
    while (markerIdx < sortedMarkers.length && sortedMarkers[markerIdx].progress <= opEnd) {
      items.push({ kind: 'marker', marker: sortedMarkers[markerIdx] })
      markerIdx++
    }
  }
  // Remaining markers
  while (markerIdx < sortedMarkers.length) {
    items.push({ kind: 'marker', marker: sortedMarkers[markerIdx++] })
  }

  return (
    <div className="space-y-0.5 group/list">
      {items.map((item) => {
        if (item.kind === 'marker') {
          return <MarkerRow key={item.marker.id} marker={item.marker} />
        }
        return (
          <div key={item.op.id}>
            <OperationRow
              op={item.op}
              isSelected={selectedOperationId === item.op.id}
              onSelect={() => selectOperation(selectedOperationId === item.op.id ? null : item.op.id)}
            />
            <AddMarkerButton opIndex={item.idx} totalOps={totalOps} />
          </div>
        )
      })}
    </div>
  )
}

function OperationsSummary() {
  const { operations } = useCAMStore()
  const validCount = operations.filter((o) => o.status === 'valid').length
  const warnCount = operations.filter((o) => o.status === 'warning').length
  const errCount = operations.filter((o) => o.status === 'error').length

  // Unique tools
  const toolIds = new Set(operations.map((o) => o.config.tool).filter(Boolean))

  return (
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground px-1">
      <span>{operations.length} ops</span>
      <span>&middot;</span>
      <span>{toolIds.size} herramientas</span>
      {warnCount > 0 && (
        <>
          <span>&middot;</span>
          <span className="text-amber-500">{warnCount} warn</span>
        </>
      )}
      {errCount > 0 && (
        <>
          <span>&middot;</span>
          <span className="text-red-500">{errCount} error</span>
        </>
      )}
    </div>
  )
}

function GenerateActions() {
  const { t } = useTranslation('gcode')
  const {
    gcode,
    gcodeGenerated,
    gcodeLines,
    gcodeNeedsRegeneration,
    estimates,
    estimatedTime,
    totalDistance,
    maxDepth,
  } = useGCodeStore()
  const { globalConfig, rasterData } = useCanvasStore()
  const { addConsoleLine, setWorkspace } = useAppStore()
  const { setGCode, setEstimates } = useGCodeStore()
  const generating = useGCodeStore((s) => s.generating)
  const { connected, sending, sendProgress } = useSerialStore()
  const { addStep } = useWorkflowStore()
  const serial = useSerial()
  const project = useProject()
  const { getJobsForGCode } = useCanvasManager()

  const camOps = useCAMStore((s) => s.operations)
  const hasErrors = camOps.some((o) => o.status === 'error')

  const handleGenerate = useCallback(async () => {
    // Block if CAM operations have errors
    const { operations } = useCAMStore.getState()
    const errors = operations.filter((o) => o.status === 'error')
    if (errors.length > 0) {
      for (const err of errors) {
        addConsoleLine(`ERROR: ${err.elementName} — ${err.warnings.join(', ')}`)
      }
      addConsoleLine('Corrige los errores antes de generar G-code')
      return
    }

    const jobs = getJobsForGCode()
    const isRaster = globalConfig.operationType === 'laser' && globalConfig.laserMode === 'raster'

    if (jobs.length === 0 && !isRaster) {
      addConsoleLine('No se encontraron elementos validos en el canvas')
      return
    }
    if (isRaster && !rasterData) {
      addConsoleLine('No hay imagen raster cargada')
      return
    }

    // Build markers from CAM store timeline markers
    const { markers: camMarkers } = useCAMStore.getState()
    const gcodeMarkers: import('@/lib/types').GCodeMarker[] = []

    if (camMarkers.length > 0 && jobs.length > 0) {
      for (const marker of camMarkers) {
        // Map progress % to job index
        const jobIdx = Math.min(
          Math.floor((marker.progress / 100) * jobs.length),
          jobs.length - 1,
        )
        gcodeMarkers.push({
          type: marker.type,
          message: marker.message,
          afterJobIndex: jobIdx,
          parkPosition: marker.parkPosition,
        })
      }
    }

    // Check clamp collisions with cut paths
    const { setup } = useCAMStore.getState()
    const clamps = setup.clamps
    if (clamps.length > 0) {
      for (const job of jobs) {
        for (const path of job.paths) {
          for (let i = 0; i < path.points.length - 1; i++) {
            const a = path.points[i]
            const b = path.points[i + 1]
            for (const clamp of clamps) {
              // Liang-Barsky line-rect intersection
              const dx = b.x - a.x, dy = b.y - a.y
              const p = [-dx, dx, -dy, dy]
              const q = [a.x - clamp.x, clamp.x + clamp.width - a.x, a.y - clamp.y, clamp.y + clamp.height - a.y]
              let u1 = 0, u2 = 1, collision = true
              for (let k = 0; k < 4; k++) {
                if (p[k] === 0) { if (q[k] < 0) { collision = false; break } }
                else { const t = q[k] / p[k]; if (p[k] < 0) { if (t > u2) { collision = false; break }; if (t > u1) u1 = t } else { if (t < u1) { collision = false; break }; if (t < u2) u2 = t } }
              }
              if (collision && u1 <= u2) {
                addConsoleLine(`ERROR: "${job.elementName}" colisiona con clamp "${clamp.label}" — mueve el clamp o el elemento`)
                return
              }
            }
          }
        }
      }
    }

    // Pass clamps to generator for rapid avoidance
    const clampRects = clamps.map((c) => ({ x: c.x, y: c.y, width: c.width, height: c.height, zHeight: c.zHeight }))

    // Validate tool diameter vs path geometry for CNC operations
    let hasToolGeometryError = false
    for (const job of jobs) {
      if (job.config.operationType !== 'cnc') continue
      const toolDiam = parseFloat(String(job.config.toolDiameter))
      if (!toolDiam || toolDiam <= 0) continue

      const pathData = job.paths.map(p => ({ points: p.points, closed: p.closed }))
      const validation = validateToolVsPaths(pathData, toolDiam, job.config.workType)

      for (const err of validation.errors) {
        addConsoleLine(`ERROR: "${job.elementName}" — ${err}`)
        hasToolGeometryError = true
      }
      for (const warn of validation.warnings) {
        addConsoleLine(`WARN: "${job.elementName}" — ${warn}`)
      }
    }

    if (hasToolGeometryError) {
      addConsoleLine('Generacion bloqueada: herramienta demasiado grande para la geometria. Usa una herramienta mas pequena o cambia la estrategia.')
      return
    }

    addConsoleLine('Generando G-code...')
    const { result, est } = await withGenerating(async () => {
      const generator = new GCodeGenerator()
      const out = await generator.generateFromJobs(jobs, rasterData, gcodeMarkers, clampRects)
      return { result: out, est: generator.getEstimates() }
    })

    setGCode(result)
    setEstimates({
      time: est.time > 60 ? `${(est.time / 60).toFixed(1)} min` : `${est.time.toFixed(0)} seg`,
      distance: est.distance > 1000 ? `${(est.distance / 1000).toFixed(2)} m` : `${est.distance.toFixed(1)} mm`,
    })

    const lineCount = result.split('\n').length
    const uniqueTools = new Set(jobs.map((j) => j.config.tool).filter(Boolean)).size
    addConsoleLine(`G-code generado: ${lineCount} lineas, ${jobs.length} elementos, ${uniqueTools} herramientas`)
  }, [getJobsForGCode, globalConfig, rasterData, addConsoleLine, setGCode, setEstimates])

  const handleDownload = () => {
    if (!gcodeGenerated) return
    project.downloadGCode(gcode, 'output.gcode')
  }

  const handleCopy = () => {
    if (!gcodeGenerated) return
    navigator.clipboard.writeText(gcode)
    addConsoleLine('G-code copiado al portapapeles')
  }

  const handleDryRun = () => {
    if (!connected || sending) return
    const jobs = getJobsForGCode()
    const elementBBox = computeBBox(jobs)
    const { workArea } = useCanvasStore.getState()
    const bbox = elementBBox ?? { minX: 0, minY: 0, maxX: workArea.width, maxY: workArea.height }
    const isLaser = globalConfig.operationType === 'laser'
    const dryGCode = generateBoundaryGCode(bbox, isLaser ? 'laser' : 'cnc', 5, 10)
    serial.sendGCode(dryGCode)
    addConsoleLine(elementBBox ? t('dryRunStarted') : t('dryRunWorkArea'))
  }

  const handleSendToWorkflow = () => {
    if (!gcodeGenerated) return
    addStep({
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'gcode',
      name: `G-Code (${gcodeLines} ${t('lines')})`,
      data: gcode,
      status: 'pending',
    })
    addConsoleLine(t('sentToWorkflow'))
    setWorkspace('cnc')
  }

  return (
    <div className="space-y-2">
      {/* Error banner */}
      {hasErrors && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
          <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
          <span className="text-[11px] text-red-700 dark:text-red-400">
            Corrige los errores antes de generar
          </span>
        </div>
      )}

      {/* Generate + actions */}
      <div className="flex items-center gap-1">
        <Button
          variant={hasErrors ? 'outline' : gcodeNeedsRegeneration ? 'destructive' : 'default'}
          size="sm"
          className="flex-1 min-w-0 gap-1 truncate"
          onClick={handleGenerate}
          disabled={hasErrors || generating}
          aria-busy={generating}
        >
          {generating ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : hasErrors ? (
            <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />
          ) : gcodeNeedsRegeneration ? (
            <AlertTriangle className="h-3 w-3 shrink-0" />
          ) : (
            <Cog className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{generating ? t('generating') : t('generate')}</span>
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleCopy} disabled={!gcodeGenerated} title={t('copy')}>
          <Copy className="h-3 w-3" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleDownload} disabled={!gcodeGenerated} title={t('download')}>
          <Download className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        {sending ? (
          <Button variant="destructive" size="sm" className="flex-1 min-w-0 gap-1 truncate" onClick={() => serial.cancelSend()}>
            <Square className="h-3 w-3 shrink-0" />
            <span className="truncate">{t('stop')}</span>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="flex-1 min-w-0 gap-1 truncate" onClick={handleSendToWorkflow} disabled={!gcodeGenerated}>
            <ListPlus className="h-3 w-3 shrink-0" />
            <span className="truncate">{t('sendToWorkflow')}</span>
          </Button>
        )}
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleDryRun} disabled={!connected || sending} title={t('dryRun')}>
          <Scan className="h-3 w-3" />
        </Button>
      </div>

      {/* Send progress */}
      {sending && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">{t('sendToGRBL')}...</span>
            <span className="text-xs font-mono">{Math.round(sendProgress)}%</span>
          </div>
          <Progress value={sendProgress} />
        </div>
      )}

      {/* Stats */}
      {gcodeGenerated && (
        <div className="grid grid-cols-4 gap-1.5">
          <div className="bg-muted/60 rounded px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">{t('time')}</p>
            <p className="text-xs font-medium">{estimatedTime || estimates.time}</p>
          </div>
          <div className="bg-muted/60 rounded px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">{t('distance')}</p>
            <p className="text-xs font-medium">{totalDistance || estimates.distance}</p>
          </div>
          <div className="bg-muted/60 rounded px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">{t('depth')}</p>
            <p className="text-xs font-medium">{maxDepth || '-'}</p>
          </div>
          <div className="bg-muted/60 rounded px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">{t('lines')}</p>
            <p className="text-xs font-medium">{gcodeLines}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function CAMSetupSection() {
  const [expanded, setExpanded] = useState(false)
  const { setup, updateSetup, addClamp, updateClamp, removeClamp } = useCAMStore()

  return (
    <div className="space-y-1.5">
      <button
        className="flex items-center gap-1.5 w-full text-left px-1 py-0.5 rounded hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Shield className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Setup maquina
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 px-1 pb-1">
          {/* Safe Z */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground w-14 shrink-0">Safe Z</label>
            <Input
              type="number"
              className="h-6 text-[10px] flex-1"
              value={setup.safeZ}
              onChange={(e) => updateSetup({ safeZ: parseFloat(e.target.value) || 5 })}
              step={1}
              min={1}
            />
            <span className="text-[10px] text-muted-foreground">mm</span>
          </div>

          {/* Tool change position/area */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-muted-foreground font-medium">Cambio herramienta</label>
              <button
                className="text-[9px] text-primary hover:underline"
                onClick={() => {
                  const isArea = setup.toolChangeSize.width > 0
                  updateSetup({
                    toolChangeSize: isArea ? { width: 0, height: 0 } : { width: 40, height: 30 },
                  })
                }}
              >
                {setup.toolChangeSize.width > 0 ? 'Punto' : 'Area'}
              </button>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground/60 w-3">X</span>
              <Input
                type="number"
                className="h-6 text-[10px] flex-1"
                value={setup.toolChangePosition.x}
                onChange={(e) => updateSetup({ toolChangePosition: { ...setup.toolChangePosition, x: parseFloat(e.target.value) || 0 } })}
              />
              <span className="text-[9px] text-muted-foreground/60 w-3">Y</span>
              <Input
                type="number"
                className="h-6 text-[10px] flex-1"
                value={setup.toolChangePosition.y}
                onChange={(e) => updateSetup({ toolChangePosition: { ...setup.toolChangePosition, y: parseFloat(e.target.value) || 0 } })}
              />
              <span className="text-[9px] text-muted-foreground/60 w-3">Z</span>
              <Input
                type="number"
                className="h-6 text-[10px] flex-1"
                value={setup.toolChangePosition.z}
                onChange={(e) => updateSetup({ toolChangePosition: { ...setup.toolChangePosition, z: parseFloat(e.target.value) || 0 } })}
              />
            </div>
            {setup.toolChangeSize.width > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground/60 w-7">Ancho</span>
                <Input
                  type="number"
                  className="h-6 text-[10px] flex-1"
                  value={setup.toolChangeSize.width}
                  onChange={(e) => updateSetup({ toolChangeSize: { ...setup.toolChangeSize, width: parseFloat(e.target.value) || 10 } })}
                />
                <span className="text-[9px] text-muted-foreground/60 w-7">Alto</span>
                <Input
                  type="number"
                  className="h-6 text-[10px] flex-1"
                  value={setup.toolChangeSize.height}
                  onChange={(e) => updateSetup({ toolChangeSize: { ...setup.toolChangeSize, height: parseFloat(e.target.value) || 10 } })}
                />
              </div>
            )}
            <p className="text-[9px] text-muted-foreground/50 italic">Arrastra en 3D para mover</p>
          </div>

          {/* Clamps */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-muted-foreground font-medium">Clamps</label>
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 gap-0.5" onClick={addClamp}>
                <Plus className="h-2.5 w-2.5" />
                Agregar
              </Button>
            </div>
            {setup.clamps.map((clamp) => (
              <div key={clamp.id} className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-1.5 py-1 space-y-1">
                <div className="flex items-center gap-1">
                  <input
                    className="text-[10px] bg-transparent border-none outline-none flex-1 min-w-0 font-medium"
                    value={clamp.label}
                    onChange={(e) => updateClamp(clamp.id, { label: e.target.value })}
                  />
                  <span className="text-[9px] text-muted-foreground/50">
                    {clamp.zHeight === 0 ? 'Z∞' : `Z${clamp.zHeight}`}
                  </span>
                  <Button variant="ghost" size="icon" className="h-4 w-4 shrink-0" onClick={() => removeClamp(clamp.id)}>
                    <Trash2 className="h-2.5 w-2.5 text-red-500" />
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-muted-foreground/50 w-3">X</span>
                  <Input type="number" className="h-5 text-[9px] flex-1 px-0.5" value={clamp.x}
                    onChange={(e) => updateClamp(clamp.id, { x: parseFloat(e.target.value) || 0 })} />
                  <span className="text-[8px] text-muted-foreground/50 w-3">Y</span>
                  <Input type="number" className="h-5 text-[9px] flex-1 px-0.5" value={clamp.y}
                    onChange={(e) => updateClamp(clamp.id, { y: parseFloat(e.target.value) || 0 })} />
                  <span className="text-[8px] text-muted-foreground/50 w-3">W</span>
                  <Input type="number" className="h-5 text-[9px] flex-1 px-0.5" value={clamp.width}
                    onChange={(e) => updateClamp(clamp.id, { width: parseFloat(e.target.value) || 10 })} />
                  <span className="text-[8px] text-muted-foreground/50 w-3">D</span>
                  <Input type="number" className="h-5 text-[9px] flex-1 px-0.5" value={clamp.height}
                    onChange={(e) => updateClamp(clamp.id, { height: parseFloat(e.target.value) || 10 })} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-muted-foreground/50">Altura Z</span>
                  <Input type="number" className="h-5 text-[9px] w-14 px-0.5" value={clamp.zHeight}
                    onChange={(e) => updateClamp(clamp.id, { zHeight: Math.max(0, parseFloat(e.target.value) || 0) })}
                    step={1} min={0} />
                  <span className="text-[8px] text-muted-foreground/40">{clamp.zHeight === 0 ? '(infinita)' : 'mm'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function OperationsPanel() {
  const { syncFromCanvas, operations } = useCAMStore()
  const elements = useCanvasStore((s) => s.elements)
  const globalConfig = useCanvasStore((s) => s.globalConfig)

  // Sync operations when entering CAM or when elements/config change
  useEffect(() => {
    syncFromCanvas()
  }, [elements, globalConfig, syncFromCanvas])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Operations header */}
      <div className="px-1 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Operaciones
          </span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
            {operations.length}
          </Badge>
        </div>
        <OperationsSummary />
      </div>

      <Separator />

      {/* CAM Setup */}
      <div className="px-1 py-1.5">
        <CAMSetupSection />
      </div>

      <Separator />

      {/* Operations list */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1.5">
        <OperationsList />
      </div>

      <Separator />

      {/* Generate / export actions */}
      <div className="pt-2 px-1">
        <GenerateActions />
      </div>
    </div>
  )
}
