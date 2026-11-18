import { useAppStore } from '@/stores/useAppStore'
import { useCAMStore } from '@/stores/useCAMStore'
import { useState } from 'react'
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
import { Settings2, Plus, Trash2, Hexagon, Lock, Unlock, Printer, Scissors } from 'lucide-react'
import { toast } from '@/lib/toast'
import type { GlobalConfig, OperationType, WorkType, LaserMode } from '@/lib/types'
import { elementOutput, OUTPUT_LABELS } from '@/lib/print-cut'
import type { ElementOutput } from '@/lib/types'

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
    showRulers,
  } = useCanvasStore()
  const { getFilteredTools } = useLibraryStore()
  const { applyObjectProps, resizeSelected, updateMakerParams, addCutOutline } = useCanvasManager()
  const [lockAspect, setLockAspect] = useState(true)
  const [outlineMargin, setOutlineMargin] = useState(1.5)
  const [outlineBusy, setOutlineBusy] = useState(false)

  if (!selectedElementId) return null

  const element = findElementById(selectedElementId)
  if (!element) return null

  const props = selectedObjectProps
  const isMaker = !!element.makerType
  const hasCustomConfig = element.config !== null
  const config = getElementConfig(element)
  const tools = getFilteredTools(config.operationType)
  const output = elementOutput(element)
  const cuts = output !== 'print'

  const toggleCustomConfig = (enabled: boolean) => {
    updateElement(element.id, { config: enabled ? { ...globalConfig } : null })
  }

  const updateConfig = (updates: Partial<GlobalConfig>) => {
    const current = element.config ?? { ...globalConfig }
    updateElement(element.id, { config: { ...current, ...updates } })
  }

  return (
    <div
      className={`absolute right-2 z-20 w-72 max-w-[calc(100%-1rem)] bg-background border rounded-lg shadow-lg max-h-[calc(100%-3.5rem)] flex flex-col ${
        showRulers ? 'top-6' : 'top-2'
      }`}
    >
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

            {/* Tamano con candado de proporcion */}
            <div className="grid grid-cols-3 gap-2 items-end">
              <div>
                <label className="text-[11px] text-muted-foreground">{t('widthMm')}</label>
                <Input
                  type="number"
                  value={props?.width ?? 0}
                  onChange={(e) => resizeSelected('width', parseFloat(e.target.value) || 0, lockAspect)}
                  className="h-8"
                  step="0.1"
                  min="0"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">{t('heightMm')}</label>
                <Input
                  type="number"
                  value={props?.height ?? 0}
                  onChange={(e) => resizeSelected('height', parseFloat(e.target.value) || 0, lockAspect)}
                  className="h-8"
                  step="0.1"
                  min="0"
                />
              </div>
              <button
                type="button"
                onClick={() => setLockAspect((v) => !v)}
                title={t('lockAspect')}
                className={`h-8 flex items-center justify-center gap-1 rounded-md border text-[11px] ${
                  lockAspect ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
                }`}
              >
                {lockAspect ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                {t('ratio')}
              </button>
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

          {/* ========== SALIDA (print & cut) ========== */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Printer className="h-3.5 w-3.5" />
              Salida
            </Label>
            {element.type === 'image' ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Imagen: solo se imprime. Para recortarla, crea su contorno de corte.
                </p>
                <div className="flex items-end gap-2">
                  <div className="w-24">
                    <label className="text-[11px] text-muted-foreground">Margen (mm)</label>
                    <Input
                      type="number"
                      className="h-8"
                      min={0}
                      max={10}
                      step={0.5}
                      value={outlineMargin}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        if (Number.isFinite(v)) setOutlineMargin(Math.min(10, Math.max(0, v)))
                      }}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-8 gap-1"
                    disabled={outlineBusy}
                    onClick={async () => {
                      setOutlineBusy(true)
                      try {
                        await addCutOutline(element.id, outlineMargin)
                      } catch (e) {
                        toast.error('No se pudo crear el contorno', { detail: e instanceof Error ? e.message : String(e) })
                      } finally {
                        setOutlineBusy(false)
                      }
                    }}
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    {outlineBusy ? 'Calculando...' : 'Crear contorno de corte'}
                  </Button>
                </div>
              </div>
            ) : (
              <Select
                value={output}
                onValueChange={(v) => updateElement(element.id, { output: v as ElementOutput })}
              >
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(OUTPUT_LABELS) as ElementOutput[]).map((o) => (
                    <SelectItem key={o} value={o}>{OUTPUT_LABELS[o]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </section>

          {cuts && (<>
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

                  </>
                )}

              </div>
            )}

            {/* Avances, profundidades, tabs y pasadas viven en un solo lugar:
                el editor de operacion de CAM. Aca solo se decide que es la
                pieza (tipo de operacion y de trabajo). */}
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => {
                const cam = useCAMStore.getState()
                cam.syncFromCanvas()
                const op = useCAMStore.getState().operations.find((o) => o.id.startsWith(`${element.id}:`))
                if (op) cam.selectOperation(op.id)
                useAppStore.getState().setWorkspace('cam')
              }}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Parametros de corte en CAM
            </Button>
          </section>

          </>)}
        </div>
      </div>
    </div>
  )
}
