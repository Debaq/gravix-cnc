import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCAMStore } from '@/stores/useCAMStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  loadToolpathTemplates,
  saveToolpathTemplates,
  createTemplate,
  type ToolpathTemplate,
} from '@/lib/profiles'
import { calculateFeeds, classifyMaterial, MATERIAL_CLASSES, type MaterialClass } from '@/lib/feeds-speeds'
import {
  X,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Focus,
  ChevronDown,
  ChevronRight,
  Copy,
  Plus,
  Trash2,
  CopyCheck,
  Calculator,
  Bookmark,
  Save,
} from 'lucide-react'
import type {
  GlobalConfig,
  OperationType,
  WorkType,
  LaserMode,
  PocketStrategy,
  DitheringMode,
  LeadType,
  MillDirection,
  CutterComp,
} from '@/lib/types'

// ============================================
// Bloques reutilizables
// ============================================

function Section({
  title,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border rounded-md">
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-muted/50 transition-colors rounded-md"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex-1">
          {title}
        </span>
        {badge && (
          <Badge variant="secondary" className="text-[9px] h-4 px-1">{badge}</Badge>
        )}
      </button>
      {open && <div className="px-2 pb-2 pt-0.5 space-y-2">{children}</div>}
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  unit,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  unit?: string
}) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">
        {label}{unit ? ` (${unit})` : ''}
      </label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const raw = parseFloat(e.target.value)
          const parsed = Number.isFinite(raw) ? raw : 0
          const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))
          onChange(clamped)
        }}
        className="h-8"
        step={step}
        min={min}
        max={max}
      />
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <label className="text-[11px] text-muted-foreground font-medium">{label}</label>
        {hint && <p className="text-[10px] text-muted-foreground/70 truncate">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  format: (v: number) => string
}) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2 mt-0.5">
        <Input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 h-8"
        />
        <span className="text-xs font-mono w-12 text-right">{format(value)}</span>
      </div>
    </div>
  )
}

function StatusBadge({ status, warnings }: { status: string; warnings: string[] }) {
  if (status === 'valid') {
    return (
      <Badge variant="outline" className="text-[10px] h-4 gap-1 text-emerald-600 border-emerald-200 bg-emerald-50">
        <CheckCircle2 className="h-2.5 w-2.5" />
        OK
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge variant="outline" className="text-[10px] h-4 gap-1 text-red-600 border-red-200 bg-red-50">
        <AlertCircle className="h-2.5 w-2.5" />
        Error
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-[10px] h-4 gap-1 text-amber-600 border-amber-200 bg-amber-50">
      <AlertTriangle className="h-2.5 w-2.5" />
      {warnings.length}
    </Badge>
  )
}

// ============================================
// Calculadora de feeds & speeds
// ============================================

function FeedsCalculator({
  config,
  update,
}: {
  config: GlobalConfig
  update: (u: Partial<GlobalConfig>) => void
}) {
  const { materials } = useLibraryStore()
  const material = config.material ? materials.find((m) => m.id === config.material) : null

  const [open, setOpen] = useState(false)
  const [materialClass, setMaterialClass] = useState<MaterialClass>(() => classifyMaterial(material))
  const [aggressiveness, setAggressiveness] = useState(1)

  const result = useMemo(() => calculateFeeds({
    materialClass,
    diameter: config.toolDiameter || 3.175,
    flutes: config.toolFlutes || 2,
    aggressiveness,
  }), [materialClass, config.toolDiameter, config.toolFlutes, aggressiveness])

  return (
    <div className="border rounded-md bg-muted/30">
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-muted/60 rounded-md"
        onClick={() => setOpen(!open)}
      >
        <Calculator className="h-3 w-3 shrink-0 text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex-1">
          Calcular feeds &amp; speeds
        </span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-2">
          <div>
            <label className="text-[11px] text-muted-foreground">Material</label>
            <Select value={materialClass} onValueChange={(v) => setMaterialClass(v as MaterialClass)}>
              <SelectTrigger className="h-8 mt-0.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MATERIAL_CLASSES).map(([key, entry]) => (
                  <SelectItem key={key} value={key}>{entry.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <NumField
            label="Filos de la fresa"
            value={config.toolFlutes ?? 2}
            onChange={(v) => update({ toolFlutes: Math.max(1, Math.round(v)) })}
            step={1}
            min={1}
            max={8}
          />

          <SliderRow
            label="Agresividad"
            value={aggressiveness}
            onChange={setAggressiveness}
            min={0.5}
            max={1.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}x`}
          />

          <div className="rounded bg-background border p-1.5 space-y-0.5">
            <div className="grid grid-cols-2 gap-x-2 text-[10px]">
              <span className="text-muted-foreground">RPM</span>
              <span className="font-mono text-right">{result.rpm}</span>
              <span className="text-muted-foreground">Avance</span>
              <span className="font-mono text-right">{result.feedRate} mm/min</span>
              <span className="text-muted-foreground">Plunge</span>
              <span className="font-mono text-right">{result.plungeRate} mm/min</span>
              <span className="text-muted-foreground">Paso Z</span>
              <span className="font-mono text-right">{result.depthPerPass} mm</span>
              <span className="text-muted-foreground">Viruta/diente</span>
              <span className="font-mono text-right">{result.chipload} mm</span>
              <span className="text-muted-foreground">Remocion</span>
              <span className="font-mono text-right">{result.mrr} cm³/min</span>
            </div>
            {result.notes.map((n, i) => (
              <p key={i} className="text-[9px] text-amber-600 flex items-start gap-1 pt-0.5">
                <AlertTriangle className="h-2.5 w-2.5 shrink-0 mt-px" />
                {n}
              </p>
            ))}
          </div>

          <Button
            size="sm"
            className="w-full h-7 text-[11px] gap-1"
            onClick={() => update({
              spindleRPM: result.rpm,
              feedRate: result.feedRate,
              plungeRate: result.plungeRate,
              depthStep: result.depthPerPass,
              stepover: result.stepover,
            })}
          >
            <CopyCheck className="h-3 w-3" />
            Aplicar a la operacion
          </Button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Plantillas de operacion
// ============================================

function TemplatesRow({
  config,
  update,
}: {
  config: GlobalConfig
  update: (u: Partial<GlobalConfig>) => void
}) {
  const { addConsoleLine } = useAppStore()
  const [templates, setTemplates] = useState<ToolpathTemplate[]>(() => loadToolpathTemplates())
  const compatible = templates.filter((t) => t.operationType === config.operationType)

  const handleSave = () => {
    const name = window.prompt('Nombre de la plantilla')
    if (!name) return
    const next = [...templates, createTemplate(name, config)]
    saveToolpathTemplates(next)
    setTemplates(next)
    addConsoleLine(`Plantilla "${name}" guardada`)
  }

  const handleApply = (id: string) => {
    const tpl = templates.find((t) => t.id === id)
    if (!tpl) return
    // El tipo de operacion y la geometria no se tocan: la plantilla trae
    // parametros de corte, no cambia que es la pieza.
    const { operationType: _op, tool: _tool, material: _mat, ...rest } = tpl.config
    update(rest)
    addConsoleLine(`Plantilla "${tpl.name}" aplicada`)
  }

  return (
    <div className="flex items-center gap-1">
      <Select value="" onValueChange={handleApply}>
        <SelectTrigger className="h-8 flex-1 text-[11px] gap-1">
          <Bookmark className="h-3 w-3 shrink-0 text-muted-foreground" />
          <SelectValue placeholder={compatible.length > 0 ? 'Aplicar plantilla' : 'Sin plantillas'} />
        </SelectTrigger>
        <SelectContent>
          {compatible.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleSave} title="Guardar config actual como plantilla">
        <Save className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ============================================
// Editor
// ============================================

export function OperationEditor() {
  const { t: ts } = useTranslation('settings')
  const { t: tc } = useTranslation('canvas')
  const {
    operations,
    selectedOperationId,
    selectOperation,
    updateOperationConfig,
    soloOperation,
    soloOperationId,
    addOperation,
    duplicateOperation,
    removeOperation,
    applyConfigToAll,
  } = useCAMStore()
  const { tools, materials } = useLibraryStore()
  const { addConsoleLine } = useAppStore()

  const op = operations.find((o) => o.id === selectedOperationId)
  if (!op) return null

  const config = op.config
  const filteredTools = tools.filter((t) => t.category === config.operationType)
  const isSolo = soloOperationId === op.id

  const update = (updates: Partial<GlobalConfig>) => {
    updateOperationConfig(op.id, updates)
  }

  const handleRemove = () => {
    if (!removeOperation(op.id)) {
      addConsoleLine('Es la unica operacion del elemento: apagala con el ojo o cambia su tipo')
    }
  }

  const handleApplyAll = () => {
    const n = applyConfigToAll(op.id)
    addConsoleLine(n > 0
      ? `Config copiada a ${n} operacion(es) de tipo ${config.operationType}`
      : 'No hay otras operaciones del mismo tipo')
  }

  const isCNC = config.operationType === 'cnc'
  const isLaser = config.operationType === 'laser'
  const isContour = isCNC && (config.workType === 'outline' || config.workType === 'inside' || config.workType === 'outside')

  return (
    <div className="absolute top-2 right-2 z-20 w-80 max-w-[calc(100%-1rem)] bg-background border rounded-lg shadow-lg max-h-[calc(100%-3.5rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{op.elementName}</span>
          {op.operationIndex >= 0 && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              Op #{op.operationIndex + 1}
            </Badge>
          )}
          <StatusBadge status={op.status} warnings={op.warnings} />
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant={isSolo ? 'default' : 'ghost'}
            size="icon"
            className="h-6 w-6"
            onClick={() => soloOperation(op.id)}
            title="Solo preview"
          >
            <Focus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => selectOperation(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Acciones sobre la operacion */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b shrink-0">
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1" onClick={() => addOperation(op.id)} title="Agregar otra operacion a este elemento">
          <Plus className="h-3 w-3" />
          Op
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1" onClick={() => duplicateOperation(op.id)} title="Duplicar esta operacion">
          <Copy className="h-3 w-3" />
          Duplicar
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1" onClick={handleApplyAll} title="Copiar esta config a las demas operaciones del mismo tipo">
          <CopyCheck className="h-3 w-3" />
          A todas
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRemove} title="Eliminar operacion">
          <Trash2 className="h-3 w-3 text-red-500" />
        </Button>
      </div>

      {/* Warnings */}
      {op.warnings.length > 0 && (
        <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 border-b">
          {op.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-2 space-y-2">

          {/* ---------- Tipo, herramienta, material ---------- */}
          <div className="space-y-2">
            <div>
              <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Tipo de operacion
              </Label>
              <Select
                value={config.operationType}
                onValueChange={(v) => update({ operationType: v as OperationType })}
              >
                <SelectTrigger className="h-8 mt-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cnc">{ts('operationTypes.cnc')}</SelectItem>
                  <SelectItem value="laser">{ts('operationTypes.laser')}</SelectItem>
                  <SelectItem value="plotter">{ts('operationTypes.plotter')}</SelectItem>
                  <SelectItem value="pencil">{ts('operationTypes.pencil')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground">Herramienta</label>
                <Select
                  value={config.tool || 'none'}
                  onValueChange={(v) => update({ tool: v === 'none' ? '' : v })}
                >
                  <SelectTrigger className="h-8 mt-0.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tc('noTool')}</SelectItem>
                    {filteredTools.map((tool) => (
                      <SelectItem key={tool.id} value={tool.id}>
                        {tool.name} {tool.diameter ? `(${tool.diameter}mm)` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Material</label>
                <Select
                  value={config.material || 'none'}
                  onValueChange={(v) => update({ material: v === 'none' ? '' : v })}
                >
                  <SelectTrigger className="h-8 mt-0.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin material</SelectItem>
                    {materials.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({m.thickness}mm)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <TemplatesRow config={config} update={update} />
          </div>

          <Separator />

          {/* ========== CNC ========== */}
          {isCNC && (
            <>
              <div>
                <label className="text-[11px] text-muted-foreground">{ts('globalConfig.workType')}</label>
                <Select value={config.workType} onValueChange={(v) => update({ workType: v as WorkType })}>
                  <SelectTrigger className="h-8 mt-0.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outline">{ts('workTypes.outline')}</SelectItem>
                    <SelectItem value="inside">{ts('workTypes.inside')}</SelectItem>
                    <SelectItem value="outside">{ts('workTypes.outside')}</SelectItem>
                    <SelectItem value="pocket">{ts('workTypes.pocket')}</SelectItem>
                    <SelectItem value="drill">{ts('workTypes.drill') ?? 'Drill'}</SelectItem>
                    <SelectItem value="vcarve">{ts('workTypes.vcarve') ?? 'V-Carve'}</SelectItem>
                    <SelectItem value="photoVcarve">{ts('workTypes.photoVcarve') ?? 'Photo V-Carve'}</SelectItem>
                    <SelectItem value="chamfer">{ts('workTypes.chamfer') ?? 'Chamfer'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Section title="Profundidad y avances" defaultOpen>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label={ts('globalConfig.depth')} value={config.depth} onChange={(v) => update({ depth: v })} step={0.1} unit="mm" />
                  <NumField label={ts('globalConfig.depthStep')} value={config.depthStep} onChange={(v) => update({ depthStep: Math.max(0.05, v) })} step={0.1} min={0.05} unit="mm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label={ts('globalConfig.feedRate')} value={config.feedRate} onChange={(v) => update({ feedRate: v })} step={10} min={0} />
                  <NumField label={ts('globalConfig.plungeRate')} value={config.plungeRate} onChange={(v) => update({ plungeRate: v })} step={10} min={0} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label={ts('globalConfig.toolDiameter')} value={config.toolDiameter} onChange={(v) => update({ toolDiameter: v })} step={0.001} min={0} unit="mm" />
                  <NumField label={ts('globalConfig.spindleRPM')} value={config.spindleRPM} onChange={(v) => update({ spindleRPM: v })} step={500} min={0} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Filos" value={config.toolFlutes ?? 2} onChange={(v) => update({ toolFlutes: Math.max(1, Math.round(v)) })} step={1} min={1} max={8} />
                  <NumField label="Offset Z herram." value={config.toolLengthOffset ?? 0} onChange={(v) => update({ toolLengthOffset: v })} step={0.1} unit="mm" />
                </div>
                <FeedsCalculator config={config} update={update} />
              </Section>

              {/* Pocket */}
              {config.workType === 'pocket' && (
                <Section title="Cajeado" defaultOpen>
                  <SliderRow
                    label={ts('globalConfig.stepover')}
                    value={Math.round((config.stepover ?? 0.5) * 100)}
                    onChange={(v) => update({ stepover: v / 100 })}
                    min={10}
                    max={90}
                    step={5}
                    format={(v) => `${Math.round(v)}%`}
                  />
                  <div>
                    <label className="text-[11px] text-muted-foreground">Estrategia</label>
                    <Select value={config.pocketStrategy} onValueChange={(v) => update({ pocketStrategy: v as PocketStrategy })}>
                      <SelectTrigger className="h-8 mt-0.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contour-parallel">Contorno paralelo</SelectItem>
                        <SelectItem value="zigzag">Zigzag</SelectItem>
                        <SelectItem value="spiral">Espiral continua</SelectItem>
                        <SelectItem value="trochoidal">Trocoidal</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[9px] text-muted-foreground/70 mt-0.5">
                      {config.pocketStrategy === 'spiral'
                        ? 'Un solo recorrido de adentro hacia afuera, sin levantar la fresa'
                        : config.pocketStrategy === 'zigzag'
                          ? 'Barrido a 45° mas contorno de acabado'
                          : config.pocketStrategy === 'trochoidal'
                            ? 'Bucles que muerden poco por vuelta: recorrido mas largo, fresa mas fria'
                            : 'Anillos concentricos desde el borde'}
                    </p>
                  </div>
                  {config.pocketStrategy === 'trochoidal' && (
                    <NumField
                      label="Radio del bucle (0 = auto)"
                      value={config.trochoidalRadius ?? 0}
                      onChange={(v) => update({ trochoidalRadius: Math.max(0, v) })}
                      step={0.5}
                      min={0}
                      unit="mm"
                    />
                  )}
                  <ToggleRow
                    label="Rest machining"
                    checked={config.restMachiningEnabled ?? false}
                    onChange={(v) => update({ restMachiningEnabled: v })}
                    hint="Segunda pasada con fresa chica en las esquinas"
                  />
                  {config.restMachiningEnabled && (
                    <NumField label="Diametro fresa acabado" value={config.restToolDiameter ?? 1} onChange={(v) => update({ restToolDiameter: Math.max(0.1, v) })} step={0.1} min={0.1} unit="mm" />
                  )}
                </Section>
              )}

              {/* Drill */}
              {config.workType === 'drill' && (
                <Section title="Taladrado" defaultOpen>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Peck (0 = G81)" value={config.drillPeckDepth} onChange={(v) => update({ drillPeckDepth: Math.max(0, v) })} step={0.5} min={0} unit="mm" />
                    <NumField label="Retract" value={config.drillRetract} onChange={(v) => update({ drillRetract: v })} step={0.5} unit="mm" />
                  </div>
                  <p className="text-[9px] text-muted-foreground/70">
                    {config.drillPeckDepth > 0 ? 'Ciclo G83 con picotazos' : 'Ciclo G81 de una pasada'}
                  </p>
                </Section>
              )}

              {/* V-Carve */}
              {config.workType === 'vcarve' && (
                <Section title="V-Carve" defaultOpen>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Angulo V-bit" value={config.vcarveAngle} onChange={(v) => update({ vcarveAngle: v })} step={5} min={1} max={180} unit="°" />
                    <NumField label="Prof. maxima" value={config.vcarveMaxDepth} onChange={(v) => update({ vcarveMaxDepth: v })} step={0.5} min={0} unit="mm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Resolucion" value={config.vcarveStepSize} onChange={(v) => update({ vcarveStepSize: Math.max(0.02, v) })} step={0.05} min={0.02} unit="mm" />
                    <NumField label="Fondo plano" value={config.vcarveFlatDepth} onChange={(v) => update({ vcarveFlatDepth: Math.max(0, v) })} step={0.5} min={0} unit="mm" />
                  </div>
                  <p className="text-[9px] text-muted-foreground/70">
                    {config.vcarveFlatDepth > 0
                      ? 'Fondo plano: la V talla los bordes y deja el fondo a esa altura'
                      : 'V-carve estandar: la profundidad sigue el ancho del trazo'}
                  </p>
                </Section>
              )}

              {/* Chamfer */}
              {config.workType === 'chamfer' && (
                <Section title="Bisel (chamfer)" defaultOpen>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Angulo V-bit" value={config.vcarveAngle} onChange={(v) => update({ vcarveAngle: v })} step={5} min={1} max={180} unit="°" />
                    <NumField label="Prof. del bisel" value={config.depth} onChange={(v) => update({ depth: v })} step={0.1} unit="mm" />
                  </div>
                  <p className="text-[9px] text-muted-foreground/70">
                    Ancho del bisel: {(Math.abs(config.depth) * Math.tan(((config.vcarveAngle || 90) / 2) * Math.PI / 180)).toFixed(2)} mm
                  </p>
                </Section>
              )}

              {/* Photo V-Carve */}
              {config.workType === 'photoVcarve' && (
                <Section title="Photo V-Carve" defaultOpen>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Prof. maxima" value={config.photoMaxDepth} onChange={(v) => update({ photoMaxDepth: Math.max(0.1, v) })} step={0.1} min={0.1} unit="mm" />
                    <NumField label="Prof. minima" value={config.photoMinDepth} onChange={(v) => update({ photoMinDepth: Math.max(0, v) })} step={0.01} min={0} unit="mm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Separacion surcos" value={config.photoLineSpacing} onChange={(v) => update({ photoLineSpacing: Math.max(0, v) })} step={0.05} min={0} unit="mm" />
                    <NumField label="Paso de muestreo" value={config.photoStepMm} onChange={(v) => update({ photoStepMm: Math.max(0, v) })} step={0.05} min={0} unit="mm" />
                  </div>
                  <p className="text-[9px] text-muted-foreground/70">
                    0 en separacion = se calcula con el angulo del V-bit y la profundidad
                  </p>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Direccion de los surcos</label>
                    <Select
                      value={config.photoDirection}
                      onValueChange={(v) => update({ photoDirection: v as 'horizontal' | 'vertical' })}
                    >
                      <SelectTrigger className="h-8 mt-0.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="horizontal">Horizontal</SelectItem>
                        <SelectItem value="vertical">Vertical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ToggleRow label="Invertir" checked={config.photoInvert ?? false} onChange={(v) => update({ photoInvert: v })} hint="Lo claro pasa a ser lo profundo" />
                  <ToggleRow label="Bidireccional" checked={config.photoBidirectional ?? true} onChange={(v) => update({ photoBidirectional: v })} hint="Tallar en zig-zag (mas rapido)" />
                  <NumField label="Angulo V-bit" value={config.vcarveAngle} onChange={(v) => update({ vcarveAngle: v })} step={5} min={1} max={180} unit="°" />
                </Section>
              )}

              {/* Entrada / salida */}
              <Section title="Entrada y salida" badge={config.leadType !== 'none' ? config.leadType : config.rampEnabled ? 'rampa' : undefined}>
                <ToggleRow
                  label="Rampa de entrada"
                  checked={config.rampEnabled ?? false}
                  onChange={(v) => update({ rampEnabled: v })}
                  hint="Baja avanzando en vez de hundirse en vertical"
                />
                {config.rampEnabled && (
                  <NumField label="Angulo de rampa" value={config.rampAngle ?? 15} onChange={(v) => update({ rampAngle: v })} step={1} min={0} max={45} unit="°" />
                )}

                <Separator />

                <div>
                  <label className="text-[11px] text-muted-foreground">Entrada tangente</label>
                  <Select value={config.leadType ?? 'none'} onValueChange={(v) => update({ leadType: v as LeadType })}>
                    <SelectTrigger className="h-8 mt-0.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin entrada</SelectItem>
                      <SelectItem value="line">Linea perpendicular</SelectItem>
                      <SelectItem value="arc">Arco tangente</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[9px] text-muted-foreground/70 mt-0.5">
                    La fresa baja fuera del contorno y entra cortando: no deja marca de entrada
                  </p>
                </div>
                {config.leadType !== 'none' && (
                  <>
                    <NumField
                      label={config.leadType === 'arc' ? 'Radio del arco' : 'Largo de entrada'}
                      value={config.leadLength ?? 2}
                      onChange={(v) => update({ leadLength: Math.max(0, v) })}
                      step={0.5}
                      min={0}
                      unit="mm"
                    />
                    <ToggleRow label="Salida tangente" checked={config.leadOutEnabled ?? false} onChange={(v) => update({ leadOutEnabled: v })} />
                  </>
                )}
              </Section>

              {/* Contorno: sentido, compensacion, acabado */}
              {isContour && (
                <Section title="Contorno" badge={config.cutterComp !== 'off' ? config.cutterComp?.toUpperCase() : undefined}>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Sentido de fresado</label>
                    <Select value={config.millDirection ?? 'climb'} onValueChange={(v) => update({ millDirection: v as MillDirection })}>
                      <SelectTrigger className="h-8 mt-0.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="climb">Concordancia (climb)</SelectItem>
                        <SelectItem value="conventional">Oposicion (conventional)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[9px] text-muted-foreground/70 mt-0.5">
                      {config.millDirection === 'conventional'
                        ? 'Mas tolerante con juego en los husillos, peor terminacion'
                        : 'Mejor terminacion; pide maquina sin juego'}
                    </p>
                  </div>

                  <div>
                    <label className="text-[11px] text-muted-foreground">Compensacion de radio</label>
                    <Select value={config.cutterComp ?? 'off'} onValueChange={(v) => update({ cutterComp: v as CutterComp })}>
                      <SelectTrigger className="h-8 mt-0.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Geometrica (recomendado)</SelectItem>
                        <SelectItem value="g41">G41 — izquierda</SelectItem>
                        <SelectItem value="g42">G42 — derecha</SelectItem>
                      </SelectContent>
                    </Select>
                    {config.cutterComp !== 'off' && (
                      <>
                        <p className="text-[9px] text-amber-600 mt-0.5 flex items-start gap-1">
                          <AlertTriangle className="h-2.5 w-2.5 shrink-0 mt-px" />
                          GRBL no implementa G41/G42. Solo para controles que lo soporten
                        </p>
                        <div className="mt-1">
                          <NumField label="Numero de offset D" value={config.cutterCompD ?? 1} onChange={(v) => update({ cutterCompD: Math.max(1, Math.round(v)) })} step={1} min={1} />
                        </div>
                      </>
                    )}
                  </div>

                  <Separator />

                  <NumField
                    label="Sobremedida de desbaste"
                    value={config.finishAllowance ?? 0}
                    onChange={(v) => update({ finishAllowance: Math.max(0, v) })}
                    step={0.05}
                    min={0}
                    unit="mm"
                  />
                  <ToggleRow
                    label="Pasada de acabado"
                    checked={config.finishPassEnabled ?? false}
                    onChange={(v) => update({ finishPassEnabled: v })}
                    hint="Ultima pasada a medida exacta, a profundidad total"
                  />
                </Section>
              )}

              {/* Tabs */}
              {config.workType !== 'pocket' && config.workType !== 'drill' && (
                <Section title="Tabs / soportes" badge={config.tabsEnabled ? (config.tabMode === 'manual' ? 'manual' : 'auto') : undefined}>
                  <ToggleRow label={ts('globalConfig.tabsEnabled')} checked={config.tabsEnabled ?? false} onChange={(v) => update({ tabsEnabled: v })} />
                  {config.tabsEnabled && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <NumField label="Ancho" value={config.tabWidth ?? 5} onChange={(v) => update({ tabWidth: Math.max(0.5, v) })} step={0.5} min={0.5} unit="mm" />
                        <NumField label="Alto" value={config.tabHeight ?? 1} onChange={(v) => update({ tabHeight: Math.max(0.1, v) })} step={0.25} min={0.1} unit="mm" />
                      </div>

                      <div>
                        <label className="text-[11px] text-muted-foreground">Colocacion</label>
                        <Select
                          value={config.tabMode ?? 'auto'}
                          onValueChange={(v) => update({ tabMode: v as 'auto' | 'manual' })}
                        >
                          <SelectTrigger className="h-8 mt-0.5">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Repartidos parejo</SelectItem>
                            <SelectItem value="manual">Posiciones manuales</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {(config.tabMode ?? 'auto') === 'auto' ? (
                        <NumField label="Cantidad" value={config.tabCount ?? 4} onChange={(v) => update({ tabCount: Math.max(1, Math.round(v)) })} step={1} min={1} max={20} />
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-muted-foreground">
                              Posiciones sobre el perimetro
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 text-[10px] px-1.5 gap-0.5"
                              onClick={() => update({ tabPositions: [...(config.tabPositions ?? []), 0.5] })}
                            >
                              <Plus className="h-2.5 w-2.5" />
                              Tab
                            </Button>
                          </div>
                          <p className="text-[9px] text-muted-foreground/70">
                            Tambien se ponen con click sobre el recorrido en el visor 3D
                          </p>
                          {(config.tabPositions ?? []).length === 0 && (
                            <p className="text-[9px] text-amber-600">Sin posiciones: no se va a generar ningun tab</p>
                          )}
                          {(config.tabPositions ?? []).map((pos, i) => (
                            <div key={i} className="flex items-center gap-1">
                              <Input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={Math.round(pos * 100)}
                                onChange={(e) => {
                                  const next = [...(config.tabPositions ?? [])]
                                  next[i] = parseInt(e.target.value) / 100
                                  update({ tabPositions: next })
                                }}
                                className="flex-1 h-7"
                              />
                              <span className="text-[10px] font-mono w-9 text-right">{Math.round(pos * 100)}%</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 shrink-0"
                                onClick={() => update({ tabPositions: (config.tabPositions ?? []).filter((_, j) => j !== i) })}
                              >
                                <Trash2 className="h-2.5 w-2.5 text-red-500" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </Section>
              )}
            </>
          )}

          {/* ========== LASER ========== */}
          {isLaser && (
            <>
              <div>
                <label className="text-[11px] text-muted-foreground">{ts('globalConfig.laserMode')}</label>
                <Select value={config.laserMode || 'cut'} onValueChange={(v) => update({ laserMode: v as LaserMode })}>
                  <SelectTrigger className="h-8 mt-0.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cut">{ts('laserModes.cut')}</SelectItem>
                    <SelectItem value="engrave">{ts('laserModes.engrave')}</SelectItem>
                    <SelectItem value="fill">{ts('laserModes.fill')}</SelectItem>
                    <SelectItem value="raster">Raster (imagen)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Section title="Potencia y velocidad" defaultOpen>
                <SliderRow
                  label={ts('globalConfig.laserPower')}
                  value={config.laserPower}
                  onChange={(v) => update({ laserPower: Math.round(v) })}
                  min={0}
                  max={100}
                  step={1}
                  format={(v) => `${Math.round(v)}%`}
                />
                <div className="grid grid-cols-2 gap-2">
                  <NumField label={ts('globalConfig.feedRate')} value={config.feedRate} onChange={(v) => update({ feedRate: v })} step={50} min={0} />
                  <NumField label={ts('globalConfig.passes')} value={config.passes} onChange={(v) => update({ passes: Math.max(1, Math.round(v)) })} step={1} min={1} />
                </div>
                <ToggleRow
                  label={ts('globalConfig.laserDynamic')}
                  checked={config.laserDynamic ?? false}
                  onChange={(v) => update({ laserDynamic: v })}
                  hint={config.laserDynamic ? 'M4 (potencia dinamica)' : 'M3 (potencia constante)'}
                />
                <NumField label="Z de foco" value={config.laserFocusZ ?? 0} onChange={(v) => update({ laserFocusZ: v })} step={0.5} unit="mm" />
              </Section>

              {config.laserMode === 'fill' && (
                <Section title="Relleno" defaultOpen>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label={ts('globalConfig.fillAngle')} value={config.fillAngle ?? 0} onChange={(v) => update({ fillAngle: v })} step={5} min={0} max={360} unit="°" />
                    <NumField label={ts('globalConfig.fillSpacing')} value={config.fillSpacing ?? 0.5} onChange={(v) => update({ fillSpacing: Math.max(0.01, v) })} step={0.05} min={0.01} unit="mm" />
                  </div>
                  <ToggleRow label="Bidireccional" checked={config.fillBidirectional ?? false} onChange={(v) => update({ fillBidirectional: v })} />
                  <NumField label="Overscan" value={config.overscan ?? 0} onChange={(v) => update({ overscan: Math.max(0, v) })} step={0.5} min={0} unit="mm" />
                </Section>
              )}

              {config.laserMode === 'raster' && (
                <Section title="Raster" defaultOpen>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="DPI" value={config.rasterDpi ?? 254} onChange={(v) => update({ rasterDpi: Math.max(25, Math.round(v)) })} step={10} min={25} />
                    <NumField label="Umbral" value={config.rasterThreshold ?? 128} onChange={(v) => update({ rasterThreshold: v })} step={1} min={0} max={255} />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Dithering</label>
                    <Select
                      value={config.rasterDithering ?? 'floydSteinberg'}
                      onValueChange={(v) => update({ rasterDithering: v as DitheringMode })}
                    >
                      <SelectTrigger className="h-8 mt-0.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="threshold">Umbral simple</SelectItem>
                        <SelectItem value="floydSteinberg">Floyd-Steinberg</SelectItem>
                        <SelectItem value="ordered">Ordenado (Bayer)</SelectItem>
                        <SelectItem value="atkinson">Atkinson</SelectItem>
                        <SelectItem value="jarvis">Jarvis</SelectItem>
                        <SelectItem value="stucki">Stucki</SelectItem>
                        <SelectItem value="burkes">Burkes</SelectItem>
                        <SelectItem value="sierra">Sierra</SelectItem>
                        <SelectItem value="grayscale">Escala de grises (potencia variable)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ToggleRow label="Invertir" checked={config.rasterInvert ?? false} onChange={(v) => update({ rasterInvert: v })} hint="Para materiales oscuros" />
                  <ToggleRow label="Bidireccional" checked={config.rasterBidirectional ?? true} onChange={(v) => update({ rasterBidirectional: v })} />
                  <NumField label="Overscan" value={config.overscan ?? 0} onChange={(v) => update({ overscan: Math.max(0, v) })} step={0.5} min={0} unit="mm" />

                  <Separator />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase">Filtros de imagen</span>
                  <SliderRow label="Brillo" value={config.rasterBrightness ?? 0} onChange={(v) => update({ rasterBrightness: v })} min={-100} max={100} step={1} format={(v) => `${v}`} />
                  <SliderRow label="Contraste" value={config.rasterContrast ?? 0} onChange={(v) => update({ rasterContrast: v })} min={-100} max={100} step={1} format={(v) => `${v}`} />
                  <SliderRow label="Gamma" value={config.rasterGamma ?? 1} onChange={(v) => update({ rasterGamma: v })} min={0.1} max={3} step={0.05} format={(v) => v.toFixed(2)} />
                  <SliderRow label="Enfoque" value={config.rasterSharpen ?? 0} onChange={(v) => update({ rasterSharpen: v })} min={0} max={100} step={1} format={(v) => `${v}`} />
                </Section>
              )}

              <Section title="Kerf y entrada">
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Kerf" value={config.laserKerf ?? 0} onChange={(v) => update({ laserKerf: v })} step={0.01} unit="mm" />
                  <NumField label="Lead-in" value={config.laserLeadIn ?? 0} onChange={(v) => update({ laserLeadIn: Math.max(0, v) })} step={0.5} min={0} unit="mm" />
                </div>
              </Section>
            </>
          )}

          {/* ========== PLOTTER / LAPIZ ========== */}
          {(config.operationType === 'plotter' || config.operationType === 'pencil') && (
            <Section title={`Parametros ${config.operationType === 'plotter' ? 'plotter' : 'lapiz'}`} defaultOpen>
              <div className="grid grid-cols-2 gap-2">
                <NumField label={ts('globalConfig.speed')} value={config.speed} onChange={(v) => update({ speed: v })} step={10} min={0} />
                <NumField
                  label={config.operationType === 'plotter' ? ts('globalConfig.pressure') : 'Z abajo'}
                  value={config.operationType === 'plotter' ? config.pressure : config.pressureZ}
                  onChange={(v) => update(config.operationType === 'plotter' ? { pressure: v } : { pressureZ: v })}
                  step={0.5}
                />
              </div>
              {config.operationType === 'plotter' && (
                <NumField label="Blade offset" value={config.bladeOffset ?? 0} onChange={(v) => update({ bladeOffset: v })} step={0.01} unit="mm" />
              )}
            </Section>
          )}

          {/* ========== Pasadas (todos) ========== */}
          <Separator />
          <NumField label={ts('globalConfig.passes')} value={config.passes} onChange={(v) => update({ passes: Math.max(1, Math.round(v)) })} step={1} min={1} />
        </div>
      </div>
    </div>
  )
}
