import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Settings2, Plus, Trash2, Hexagon } from 'lucide-react'
import type { GlobalConfig, OperationType, WorkType, LaserMode } from '@/lib/types'

// Maker shapes own their dimensions via params (not Fabric scale).
// This avoids uniform scaling that distorts sub-parts (e.g. bolt holes).
const MAKER_PARAM_DEFS: Record<string, { key: string; step?: number; min?: number; max?: number; integer?: boolean }[]> = {
  roundRect: [
    { key: 'width', step: 1, min: 1 },
    { key: 'height', step: 1, min: 1 },
    { key: 'cornerRadius', step: 1, min: 0 },
  ],
  ellipse: [
    { key: 'rx', step: 0.5, min: 0.5 },
    { key: 'ry', step: 0.5, min: 0.5 },
  ],
  ring: [
    { key: 'outerRadius', step: 0.5, min: 1 },
    { key: 'innerRadius', step: 0.5, min: 0.5 },
  ],
  polygon: [
    { key: 'sides', step: 1, min: 3, integer: true },
    { key: 'radius', step: 0.5, min: 1 },
  ],
  star: [
    { key: 'points', step: 1, min: 3, integer: true },
    { key: 'outerRadius', step: 0.5, min: 1 },
    { key: 'innerRadius', step: 0.5, min: 0.5 },
  ],
  slot: [
    { key: 'width', step: 1, min: 2 },
    { key: 'height', step: 1, min: 2 },
  ],
  dome: [
    { key: 'radius', step: 0.5, min: 1 },
  ],
  boltCircle: [
    { key: 'radius', step: 0.5, min: 1 },
    { key: 'boltRadius', step: 0.5, min: 0.5 },
    { key: 'boltCount', step: 1, min: 2, integer: true },
  ],
  boltRect: [
    { key: 'width', step: 1, min: 2 },
    { key: 'height', step: 1, min: 2 },
    { key: 'boltRadius', step: 0.5, min: 0.5 },
    { key: 'boltCount', step: 1, min: 1, max: 9, integer: true },
    { key: 'inset', step: 1, min: 1 },
  ],
}

export function PropertiesPanel() {
  const { t } = useTranslation('canvas')
  const { t: ts } = useTranslation('settings')
  const {
    selectedElementId,
    selectedObjectProps,
    globalConfig,
    findElementById,
    getElementConfig,
    updateElement,
  } = useCanvasStore()
  const { getFilteredTools } = useLibraryStore()
  const { applyObjectProps, updateMakerParams } = useCanvasManager()

  if (!selectedElementId) return null

  const element = findElementById(selectedElementId)
  if (!element) return null

  const props = selectedObjectProps
  const isMaker = !!element.makerType
  const hasCustomConfig = element.config !== null
  const config = getElementConfig(element)
  const tools = getFilteredTools(config.operationType)

  const toggleCustomConfig = (enabled: boolean) => {
    updateElement(element.id, { config: enabled ? { ...globalConfig } : null })
  }

  const updateConfig = (updates: Partial<GlobalConfig>) => {
    const current = element.config ?? { ...globalConfig }
    updateElement(element.id, { config: { ...current, ...updates } })
  }

  return (
    <div className="absolute top-2 right-2 z-20 w-72 max-w-[calc(100%-1rem)] bg-background border rounded-lg shadow-lg max-h-[calc(100%-3.5rem)] flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b shrink-0">
        <span className="text-sm font-semibold truncate">{element.name}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 space-y-4">
          {/* ========== POSITION & ROTATION ========== */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t('position')}
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground">X (mm)</label>
                <Input
                  type="number"
                  value={props?.x ?? 0}
                  onChange={(e) => applyObjectProps('x', parseFloat(e.target.value) || 0)}
                  className="h-8"
                  step="0.1"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Y (mm)</label>
                <Input
                  type="number"
                  value={props?.y ?? 0}
                  onChange={(e) => applyObjectProps('y', parseFloat(e.target.value) || 0)}
                  className="h-8"
                  step="0.1"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">{t('rotation')}</label>
                <Input
                  type="number"
                  value={props?.angle ?? 0}
                  onChange={(e) => applyObjectProps('angle', parseFloat(e.target.value) || 0)}
                  className="h-8"
                  step="1"
                />
              </div>
            </div>
          </section>

          {/* ========== MAKER SHAPE PARAMS ========== */}
          {element.makerType && MAKER_PARAM_DEFS[element.makerType] && (
            <>
              <Separator />
              <section className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Hexagon className="h-3.5 w-3.5" />
                  {t('shapeParams')}
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {MAKER_PARAM_DEFS[element.makerType].map((def) => (
                    <div key={def.key}>
                      <label className="text-[11px] text-muted-foreground">
                        {t(`param_${def.key}`)} {def.key !== 'sides' && def.key !== 'points' && def.key !== 'boltCount' ? '(mm)' : ''}
                      </label>
                      <Input
                        type="number"
                        value={Number(element.makerParams?.[def.key] ?? 0)}
                        onChange={(e) => {
                          const raw = def.integer
                            ? parseInt(e.target.value) || (def.min ?? 0)
                            : parseFloat(e.target.value) || (def.min ?? 0)
                          let val = def.min !== undefined ? Math.max(def.min, raw) : raw
                          if (def.max !== undefined) val = Math.min(def.max, val)
                          updateMakerParams(element.id, { [def.key]: val })
                        }}
                        className="h-8"
                        step={def.step ?? 0.5}
                        min={def.min}
                        max={def.max}
                      />
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          <Separator />

          {/* ========== TOOLPATH CONFIG ========== */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Settings2 className="h-3.5 w-3.5" />
                {t('customConfig')}
              </Label>
              <Switch
                checked={hasCustomConfig}
                onCheckedChange={toggleCustomConfig}
              />
            </div>

            {!hasCustomConfig && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                {t('useGlobal')}
              </p>
            )}

            {hasCustomConfig && (
              <div className="space-y-3">
                {/* Operation type */}
                <div>
                  <label className="text-[11px] text-muted-foreground">{ts('globalConfig.operationType')}</label>
                  <Select
                    value={config.operationType}
                    onValueChange={(v) => updateConfig({ operationType: v as OperationType })}
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

                {/* Tool */}
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('toolLabel')}</label>
                  <Select
                    value={config.tool || 'none'}
                    onValueChange={(v) => updateConfig({ tool: v === 'none' ? '' : v })}
                  >
                    <SelectTrigger className="h-8 mt-0.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('noTool')}</SelectItem>
                      {tools.map((tool) => (
                        <SelectItem key={tool.id} value={tool.id}>
                          {tool.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* ---- CNC Settings ---- */}
                {config.operationType === 'cnc' && (
                  <>
                    <div>
                      <label className="text-[11px] text-muted-foreground">{ts('globalConfig.workType')}</label>
                      <Select
                        value={config.workType}
                        onValueChange={(v) => updateConfig({ workType: v as WorkType })}
                      >
                        <SelectTrigger className="h-8 mt-0.5">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="outline">{ts('workTypes.outline')}</SelectItem>
                          <SelectItem value="inside">{ts('workTypes.inside')}</SelectItem>
                          <SelectItem value="outside">{ts('workTypes.outside')}</SelectItem>
                          <SelectItem value="pocket">{ts('workTypes.pocket')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.depth')}</label>
                        <Input
                          type="number"
                          value={config.depth}
                          onChange={(e) => updateConfig({ depth: parseFloat(e.target.value) || 0 })}
                          className="h-8"
                          step="0.1"
                          min="0.1"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.depthStep')}</label>
                        <Input
                          type="number"
                          value={config.depthStep}
                          onChange={(e) => updateConfig({ depthStep: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
                          className="h-8"
                          step="0.1"
                          min="0.1"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.feedRate')}</label>
                        <Input
                          type="number"
                          value={config.feedRate}
                          onChange={(e) => updateConfig({ feedRate: parseInt(e.target.value) || 0 })}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.plungeRate')}</label>
                        <Input
                          type="number"
                          value={config.plungeRate}
                          onChange={(e) => updateConfig({ plungeRate: parseInt(e.target.value) || 0 })}
                          className="h-8"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.toolDiameter')}</label>
                        <Input
                          type="number"
                          value={config.toolDiameter}
                          onChange={(e) => updateConfig({ toolDiameter: parseFloat(e.target.value) || 0 })}
                          className="h-8"
                          step="0.001"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.spindleRPM')}</label>
                        <Input
                          type="number"
                          value={config.spindleRPM}
                          onChange={(e) => updateConfig({ spindleRPM: parseInt(e.target.value) || 0 })}
                          className="h-8"
                        />
                      </div>
                    </div>

                    {config.workType === 'pocket' && (
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.stepover')}</label>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Input
                            type="range"
                            min={10}
                            max={90}
                            step={5}
                            value={Math.round((config.stepover ?? 0.5) * 100)}
                            onChange={(e) => updateConfig({ stepover: parseInt(e.target.value) / 100 })}
                            className="flex-1 h-8"
                          />
                          <span className="text-xs font-mono w-10 text-right">
                            {Math.round((config.stepover ?? 0.5) * 100)}%
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Tabs (bridges) - only for contour cuts, not pocket */}
                    {config.workType !== 'pocket' && (
                      <div className="space-y-2 border-t pt-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] text-muted-foreground font-medium">
                            {ts('globalConfig.tabsEnabled')}
                          </label>
                          <Switch
                            checked={config.tabsEnabled ?? false}
                            onCheckedChange={(checked) => updateConfig({ tabsEnabled: checked })}
                          />
                        </div>
                        {config.tabsEnabled && (
                          <div className="grid grid-cols-3 gap-1.5">
                            <div>
                              <label className="text-[10px] text-muted-foreground">{ts('globalConfig.tabCount')}</label>
                              <Input
                                type="number"
                                value={config.tabCount ?? 4}
                                onChange={(e) => updateConfig({ tabCount: Math.max(1, parseInt(e.target.value) || 1) })}
                                className="h-7 text-xs"
                                min={1}
                                max={20}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-muted-foreground">{ts('globalConfig.tabWidth')}</label>
                              <Input
                                type="number"
                                value={config.tabWidth ?? 5}
                                onChange={(e) => updateConfig({ tabWidth: parseFloat(e.target.value) || 1 })}
                                className="h-7 text-xs"
                                step="0.5"
                                min={1}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-muted-foreground">{ts('globalConfig.tabHeight')}</label>
                              <Input
                                type="number"
                                value={config.tabHeight ?? 1}
                                onChange={(e) => updateConfig({ tabHeight: parseFloat(e.target.value) || 0.5 })}
                                className="h-7 text-xs"
                                step="0.25"
                                min={0.25}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* ---- Laser Settings ---- */}
                {config.operationType === 'laser' && (
                  <>
                    <div>
                      <label className="text-[11px] text-muted-foreground">{ts('globalConfig.laserMode')}</label>
                      <Select
                        value={config.laserMode || 'cut'}
                        onValueChange={(v) => updateConfig({ laserMode: v as LaserMode })}
                      >
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
                          onChange={(e) => updateConfig({ laserPower: parseInt(e.target.value) || 0 })}
                          className="flex-1 h-8"
                        />
                        <span className="text-xs font-mono w-10 text-right">
                          {config.laserPower}%
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.feedRate')}</label>
                        <Input
                          type="number"
                          value={config.feedRate}
                          onChange={(e) => updateConfig({ feedRate: parseInt(e.target.value) || 0 })}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.passes')}</label>
                        <Input
                          type="number"
                          value={config.passes}
                          onChange={(e) => updateConfig({ passes: parseInt(e.target.value) || 1 })}
                          className="h-8"
                          min={1}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-[11px] text-muted-foreground">{ts('globalConfig.laserDynamic')}</label>
                        <p className="text-[10px] text-muted-foreground">
                          {config.laserDynamic ? 'M4' : 'M3'}
                        </p>
                      </div>
                      <Switch
                        checked={config.laserDynamic ?? false}
                        onCheckedChange={(checked) => updateConfig({ laserDynamic: checked })}
                      />
                    </div>

                    {config.laserMode === 'fill' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] text-muted-foreground">{ts('globalConfig.fillAngle')}</label>
                          <Input
                            type="number"
                            value={config.fillAngle ?? 0}
                            onChange={(e) => updateConfig({ fillAngle: parseInt(e.target.value) || 0 })}
                            className="h-8"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-muted-foreground">{ts('globalConfig.fillSpacing')}</label>
                          <Input
                            type="number"
                            value={config.fillSpacing ?? 0.5}
                            onChange={(e) => updateConfig({ fillSpacing: parseFloat(e.target.value) || 0.1 })}
                            className="h-8"
                            step={0.05}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ---- Plotter/Pencil Settings ---- */}
                {(config.operationType === 'plotter' || config.operationType === 'pencil') && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-muted-foreground">{ts('globalConfig.speed')}</label>
                      <Input
                        type="number"
                        value={config.speed}
                        onChange={(e) => updateConfig({ speed: parseInt(e.target.value) || 0 })}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">
                        {config.operationType === 'plotter' ? ts('globalConfig.pressure') : ts('globalConfig.pressureZ')}
                      </label>
                      <Input
                        type="number"
                        value={config.operationType === 'plotter' ? config.pressure : config.pressureZ}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0
                          updateConfig(config.operationType === 'plotter' ? { pressure: val } : { pressureZ: val })
                        }}
                        className="h-8"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ========== MULTIPLE OPERATIONS ========== */}
          {hasCustomConfig && (
            <>
              <Separator />
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t('operations')}
                  </Label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] gap-1 px-2"
                    onClick={() => {
                      const ops = element.operations ?? []
                      const newOp: GlobalConfig = { ...globalConfig, workType: 'pocket' }
                      if (ops.length === 0) {
                        // First time: current config becomes op 1, new one is op 2
                        updateElement(element.id, {
                          operations: [{ ...config }, newOp],
                        })
                      } else {
                        updateElement(element.id, {
                          operations: [...ops, newOp],
                        })
                      }
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    {t('addOperation')}
                  </Button>
                </div>

                {(element.operations ?? []).length > 0 && (
                  <div className="space-y-2">
                    {element.operations!.map((op, idx) => (
                      <div
                        key={idx}
                        className="border rounded-md p-2 space-y-2 bg-muted/30"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">
                            {t('operation')} {idx + 1}:
                            <span className="ml-1 text-muted-foreground">
                              {op.operationType === 'cnc'
                                ? ts(`workTypes.${op.workType}`)
                                : ts(`operationTypes.${op.operationType}`)}
                            </span>
                          </span>
                          {element.operations!.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={() => {
                                const ops = [...element.operations!]
                                ops.splice(idx, 1)
                                updateElement(element.id, {
                                  operations: ops.length > 0 ? ops : undefined,
                                  config: ops.length === 1 ? ops[0] : element.config,
                                })
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>

                        {/* Quick config for this operation */}
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="text-[10px] text-muted-foreground">{ts('globalConfig.workType')}</label>
                            <Select
                              value={op.workType}
                              onValueChange={(v) => {
                                const ops = [...element.operations!]
                                ops[idx] = { ...ops[idx], workType: v as WorkType }
                                updateElement(element.id, { operations: ops })
                              }}
                            >
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="outline">{ts('workTypes.outline')}</SelectItem>
                                <SelectItem value="inside">{ts('workTypes.inside')}</SelectItem>
                                <SelectItem value="outside">{ts('workTypes.outside')}</SelectItem>
                                <SelectItem value="pocket">{ts('workTypes.pocket')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground">{ts('globalConfig.depth')}</label>
                            <Input
                              type="number"
                              value={op.depth}
                              onChange={(e) => {
                                const ops = [...element.operations!]
                                ops[idx] = { ...ops[idx], depth: parseFloat(e.target.value) || 0 }
                                updateElement(element.id, { operations: ops })
                              }}
                              className="h-7 text-xs"
                            />
                          </div>
                        </div>

                        {/* Tabs toggle for contour ops */}
                        {op.operationType === 'cnc' && op.workType !== 'pocket' && (
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-muted-foreground">
                              {ts('globalConfig.tabsEnabled')}
                            </label>
                            <Switch
                              checked={op.tabsEnabled ?? false}
                              onCheckedChange={(checked) => {
                                const ops = [...element.operations!]
                                ops[idx] = { ...ops[idx], tabsEnabled: checked }
                                updateElement(element.id, { operations: ops })
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
