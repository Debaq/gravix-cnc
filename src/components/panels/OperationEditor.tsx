import { useTranslation } from 'react-i18next'
import { useCAMStore } from '@/stores/useCAMStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  X,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Focus,
} from 'lucide-react'
import type { GlobalConfig, OperationType, WorkType, LaserMode, PocketStrategy } from '@/lib/types'

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
  } = useCAMStore()
  const { tools } = useLibraryStore()

  const op = operations.find((o) => o.id === selectedOperationId)
  if (!op) return null

  const config = op.config
  const filteredTools = tools.filter((t) => t.category === config.operationType)
  const isSolo = soloOperationId === op.id

  const update = (updates: Partial<GlobalConfig>) => {
    updateOperationConfig(op.id, updates)
  }

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
        <div className="p-3 space-y-3">

          {/* Operation type */}
          <section className="space-y-2">
            <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Tipo de operacion
            </Label>
            <Select
              value={config.operationType}
              onValueChange={(v) => update({ operationType: v as OperationType })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cnc">{ts('operationTypes.cnc')}</SelectItem>
                <SelectItem value="laser">{ts('operationTypes.laser')}</SelectItem>
                <SelectItem value="plotter">{ts('operationTypes.plotter')}</SelectItem>
                <SelectItem value="pencil">{ts('operationTypes.pencil')}</SelectItem>
              </SelectContent>
            </Select>
          </section>

          {/* Tool selection */}
          <section className="space-y-2">
            <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Herramienta
            </Label>
            <Select
              value={config.tool || 'none'}
              onValueChange={(v) => update({ tool: v === 'none' ? '' : v })}
            >
              <SelectTrigger className="h-8">
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
          </section>

          <Separator />

          {/* ========== CNC CONFIG ========== */}
          {config.operationType === 'cnc' && (
            <section className="space-y-3">
              <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Parametros CNC
              </Label>

              {/* Work type */}
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
                    <SelectItem value="chamfer">{ts('workTypes.chamfer') ?? 'Chamfer'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Depth settings */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.depth')}</label>
                  <Input
                    type="number"
                    value={config.depth}
                    onChange={(e) => update({ depth: parseFloat(e.target.value) || 0 })}
                    className="h-8"
                    step="0.1"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.depthStep')}</label>
                  <Input
                    type="number"
                    value={config.depthStep}
                    onChange={(e) => update({ depthStep: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
                    className="h-8"
                    step="0.1"
                    min={0.1}
                  />
                </div>
              </div>

              {/* Feed rates */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.feedRate')}</label>
                  <Input
                    type="number"
                    value={config.feedRate}
                    onChange={(e) => update({ feedRate: parseInt(e.target.value) || 0 })}
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.plungeRate')}</label>
                  <Input
                    type="number"
                    value={config.plungeRate}
                    onChange={(e) => update({ plungeRate: parseInt(e.target.value) || 0 })}
                    className="h-8"
                  />
                </div>
              </div>

              {/* Tool diameter & RPM */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.toolDiameter')}</label>
                  <Input
                    type="number"
                    value={config.toolDiameter}
                    onChange={(e) => update({ toolDiameter: parseFloat(e.target.value) || 0 })}
                    className="h-8"
                    step="0.001"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.spindleRPM')}</label>
                  <Input
                    type="number"
                    value={config.spindleRPM}
                    onChange={(e) => update({ spindleRPM: parseInt(e.target.value) || 0 })}
                    className="h-8"
                  />
                </div>
              </div>

              {/* Pocket-specific */}
              {config.workType === 'pocket' && (
                <>
                  <div>
                    <label className="text-[11px] text-muted-foreground">{ts('globalConfig.stepover')}</label>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Input
                        type="range"
                        min={10}
                        max={90}
                        step={5}
                        value={Math.round((config.stepover ?? 0.5) * 100)}
                        onChange={(e) => update({ stepover: parseInt(e.target.value) / 100 })}
                        className="flex-1 h-8"
                      />
                      <span className="text-xs font-mono w-10 text-right">
                        {Math.round((config.stepover ?? 0.5) * 100)}%
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Estrategia</label>
                    <Select value={config.pocketStrategy} onValueChange={(v) => update({ pocketStrategy: v as PocketStrategy })}>
                      <SelectTrigger className="h-8 mt-0.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contour-parallel">Contorno paralelo</SelectItem>
                        <SelectItem value="zigzag">Zigzag</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {/* Drill-specific */}
              {config.workType === 'drill' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Peck depth</label>
                    <Input
                      type="number"
                      value={config.drillPeckDepth}
                      onChange={(e) => update({ drillPeckDepth: parseFloat(e.target.value) || 0 })}
                      className="h-8"
                      step="0.5"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Retract</label>
                    <Input
                      type="number"
                      value={config.drillRetract}
                      onChange={(e) => update({ drillRetract: parseFloat(e.target.value) || 2 })}
                      className="h-8"
                      step="0.5"
                    />
                  </div>
                </div>
              )}

              {/* V-Carve specific */}
              {config.workType === 'vcarve' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Angulo V-bit</label>
                    <Input
                      type="number"
                      value={config.vcarveAngle}
                      onChange={(e) => update({ vcarveAngle: parseFloat(e.target.value) || 60 })}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Prof. max</label>
                    <Input
                      type="number"
                      value={config.vcarveMaxDepth}
                      onChange={(e) => update({ vcarveMaxDepth: parseFloat(e.target.value) || 3 })}
                      className="h-8"
                      step="0.5"
                    />
                  </div>
                </div>
              )}

              <Separator />

              {/* Ramping */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-muted-foreground font-medium">Rampa de entrada</label>
                  <Switch
                    checked={config.rampEnabled ?? false}
                    onCheckedChange={(checked) => update({ rampEnabled: checked })}
                  />
                </div>
                {config.rampEnabled && (
                  <div>
                    <label className="text-[10px] text-muted-foreground">Angulo (0-45°)</label>
                    <Input
                      type="number"
                      value={config.rampAngle ?? 15}
                      onChange={(e) => update({ rampAngle: Math.min(45, Math.max(0, parseFloat(e.target.value) || 0)) })}
                      className="h-7 text-xs"
                      min={0}
                      max={45}
                    />
                  </div>
                )}
              </div>

              {/* Tabs */}
              {config.workType !== 'pocket' && config.workType !== 'drill' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-muted-foreground font-medium">
                      {ts('globalConfig.tabsEnabled')}
                    </label>
                    <Switch
                      checked={config.tabsEnabled ?? false}
                      onCheckedChange={(checked) => update({ tabsEnabled: checked })}
                    />
                  </div>
                  {config.tabsEnabled && (
                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Cantidad</label>
                        <Input
                          type="number"
                          value={config.tabCount ?? 4}
                          onChange={(e) => update({ tabCount: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="h-7 text-xs"
                          min={1}
                          max={20}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Ancho</label>
                        <Input
                          type="number"
                          value={config.tabWidth ?? 5}
                          onChange={(e) => update({ tabWidth: parseFloat(e.target.value) || 1 })}
                          className="h-7 text-xs"
                          step="0.5"
                          min={1}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Alto</label>
                        <Input
                          type="number"
                          value={config.tabHeight ?? 1}
                          onChange={(e) => update({ tabHeight: parseFloat(e.target.value) || 0.5 })}
                          className="h-7 text-xs"
                          step="0.25"
                          min={0.25}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Rest machining */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-muted-foreground font-medium">Rest machining</label>
                  <Switch
                    checked={config.restMachiningEnabled ?? false}
                    onCheckedChange={(checked) => update({ restMachiningEnabled: checked })}
                  />
                </div>
                {config.restMachiningEnabled && (
                  <div>
                    <label className="text-[10px] text-muted-foreground">Diametro fresa acabado (mm)</label>
                    <Input
                      type="number"
                      value={config.restToolDiameter ?? 1}
                      onChange={(e) => update({ restToolDiameter: parseFloat(e.target.value) || 1 })}
                      className="h-7 text-xs"
                      step="0.1"
                      min={0.1}
                    />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ========== LASER CONFIG ========== */}
          {config.operationType === 'laser' && (
            <section className="space-y-3">
              <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Parametros Laser
              </Label>

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
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground">{ts('globalConfig.laserPower')}</label>
                <div className="flex items-center gap-2 mt-0.5">
                  <Input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={config.laserPower}
                    onChange={(e) => update({ laserPower: parseInt(e.target.value) || 0 })}
                    className="flex-1 h-8"
                  />
                  <span className="text-xs font-mono w-10 text-right">{config.laserPower}%</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.feedRate')}</label>
                  <Input
                    type="number"
                    value={config.feedRate}
                    onChange={(e) => update({ feedRate: parseInt(e.target.value) || 0 })}
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.passes')}</label>
                  <Input
                    type="number"
                    value={config.passes}
                    onChange={(e) => update({ passes: parseInt(e.target.value) || 1 })}
                    className="h-8"
                    min={1}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.laserDynamic')}</label>
                  <p className="text-[10px] text-muted-foreground">{config.laserDynamic ? 'M4 (dinamica)' : 'M3 (constante)'}</p>
                </div>
                <Switch
                  checked={config.laserDynamic ?? false}
                  onCheckedChange={(checked) => update({ laserDynamic: checked })}
                />
              </div>

              {config.laserMode === 'fill' && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-muted-foreground">{ts('globalConfig.fillAngle')}</label>
                      <Input
                        type="number"
                        value={config.fillAngle ?? 0}
                        onChange={(e) => update({ fillAngle: parseInt(e.target.value) || 0 })}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">{ts('globalConfig.fillSpacing')}</label>
                      <Input
                        type="number"
                        value={config.fillSpacing ?? 0.5}
                        onChange={(e) => update({ fillSpacing: parseFloat(e.target.value) || 0.1 })}
                        className="h-8"
                        step={0.05}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-muted-foreground">Bidireccional</label>
                    <Switch
                      checked={config.fillBidirectional ?? false}
                      onCheckedChange={(checked) => update({ fillBidirectional: checked })}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Overscan (mm)</label>
                    <Input
                      type="number"
                      value={config.overscan ?? 0}
                      onChange={(e) => update({ overscan: parseFloat(e.target.value) || 0 })}
                      className="h-8"
                      step={0.5}
                    />
                  </div>
                </>
              )}

              <Separator />

              {/* Kerf & Lead-in */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">Kerf (mm)</label>
                  <Input
                    type="number"
                    value={config.laserKerf ?? 0}
                    onChange={(e) => update({ laserKerf: parseFloat(e.target.value) || 0 })}
                    className="h-8"
                    step={0.01}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Lead-in (mm)</label>
                  <Input
                    type="number"
                    value={config.laserLeadIn ?? 0}
                    onChange={(e) => update({ laserLeadIn: parseFloat(e.target.value) || 0 })}
                    className="h-8"
                    step={0.5}
                  />
                </div>
              </div>
            </section>
          )}

          {/* ========== PLOTTER/PENCIL CONFIG ========== */}
          {(config.operationType === 'plotter' || config.operationType === 'pencil') && (
            <section className="space-y-3">
              <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Parametros {config.operationType === 'plotter' ? 'Plotter' : 'Lapiz'}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.speed')}</label>
                  <Input
                    type="number"
                    value={config.speed}
                    onChange={(e) => update({ speed: parseInt(e.target.value) || 0 })}
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">
                    {config.operationType === 'plotter' ? ts('globalConfig.pressure') : 'Z down'}
                  </label>
                  <Input
                    type="number"
                    value={config.operationType === 'plotter' ? config.pressure : config.pressureZ}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0
                      update(config.operationType === 'plotter' ? { pressure: val } : { pressureZ: val })
                    }}
                    className="h-8"
                  />
                </div>
              </div>
              {config.operationType === 'plotter' && (
                <div>
                  <label className="text-[11px] text-muted-foreground">Blade offset (mm)</label>
                  <Input
                    type="number"
                    value={config.bladeOffset ?? 0}
                    onChange={(e) => update({ bladeOffset: parseFloat(e.target.value) || 0 })}
                    className="h-8"
                    step={0.01}
                  />
                </div>
              )}
            </section>
          )}

          {/* ========== PASSES (all types) ========== */}
          <Separator />
          <div>
            <label className="text-[11px] text-muted-foreground">{ts('globalConfig.passes')}</label>
            <Input
              type="number"
              value={config.passes}
              onChange={(e) => update({ passes: Math.max(1, parseInt(e.target.value) || 1) })}
              className="h-8"
              min={1}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
