import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useAppStore } from '@/stores/useAppStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { OperationType, LaserMode, WorkType } from '@/lib/types'

export function GlobalConfigModal() {
  const { t } = useTranslation('settings')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const { globalConfig, setGlobalConfig } = useCanvasStore()
  const { getFilteredTools, materials } = useLibraryStore()

  const isOpen = activeModal === 'globalConfig'
  const filteredTools = getFilteredTools(globalConfig.operationType)

  const handleToolChange = (toolId: string) => {
    if (toolId === 'none') {
      setGlobalConfig({ tool: '' })
      return
    }
    const tool = filteredTools.find((t) => t.id === toolId) as Record<string, unknown> | undefined
    const updates: Partial<typeof globalConfig> = { tool: toolId }
    if (tool) {
      if (tool.diameter) updates.toolDiameter = tool.diameter as number
      if (tool.feedRate) updates.feedRate = tool.feedRate as number
      if (tool.plungeRate) updates.plungeRate = tool.plungeRate as number
      if (tool.rpm) updates.spindleRPM = tool.rpm as number
      if (tool.pressure) updates.pressure = tool.pressure as number
      if (tool.speed) updates.speed = tool.speed as number
    }
    setGlobalConfig(updates)
  }

  const handleMaterialChange = (matId: string) => {
    if (matId === 'none') {
      setGlobalConfig({ material: '' })
      return
    }
    const mat = materials.find((m) => m.id === matId) as Record<string, unknown> | undefined
    const updates: Partial<typeof globalConfig> = { material: matId }
    if (mat) {
      const opType = globalConfig.operationType
      const matConfig = (mat as Record<string, unknown>)[opType] as Record<string, unknown> | undefined
      if (matConfig) {
        if (matConfig.feedRate) updates.feedRate = matConfig.feedRate as number
        if (matConfig.plungeRate) updates.plungeRate = matConfig.plungeRate as number
        if (matConfig.rpm) updates.spindleRPM = matConfig.rpm as number
        if (matConfig.depthPerPass) updates.depthStep = matConfig.depthPerPass as number
        if (matConfig.cutPower) updates.laserPower = matConfig.cutPower as number
        if (matConfig.cutSpeed) updates.feedRate = matConfig.cutSpeed as number
      }
    }
    setGlobalConfig(updates)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('globalConfig.title')}</DialogTitle>
          <DialogDescription>{t('globalConfig.operationType')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Operation type */}
          <div>
            <Label>{t('globalConfig.operationType')}</Label>
            <Select
              value={globalConfig.operationType}
              onValueChange={(v) => setGlobalConfig({ operationType: v as OperationType })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cnc">{t('operationTypes.cnc')}</SelectItem>
                <SelectItem value="laser">{t('operationTypes.laser')}</SelectItem>
                <SelectItem value="plotter">{t('operationTypes.plotter')}</SelectItem>
                <SelectItem value="pencil">{t('operationTypes.pencil')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tool */}
          <div>
            <Label>{t('globalConfig.tool')}</Label>
            <Select
              value={globalConfig.tool || 'none'}
              onValueChange={handleToolChange}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t('globalConfig.noTool')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('globalConfig.noTool')}</SelectItem>
                {filteredTools.map((tool) => (
                  <SelectItem key={tool.id} value={tool.id}>
                    {tool.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Material */}
          <div>
            <Label>{t('globalConfig.material')}</Label>
            <Select
              value={globalConfig.material || 'none'}
              onValueChange={handleMaterialChange}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t('globalConfig.noMaterial')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('globalConfig.noMaterial')}</SelectItem>
                {materials.map((mat) => (
                  <SelectItem key={mat.id} value={mat.id}>
                    {mat.name} ({mat.thickness}mm)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* CNC-specific settings */}
          {globalConfig.operationType === 'cnc' && (
            <div className="space-y-3">
              <div>
                <Label>{t('globalConfig.workType')}</Label>
                <Select
                  value={globalConfig.workType}
                  onValueChange={(v) => setGlobalConfig({ workType: v as WorkType })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outline">{t('workTypes.outline')}</SelectItem>
                    <SelectItem value="inside">{t('workTypes.inside')}</SelectItem>
                    <SelectItem value="outside">{t('workTypes.outside')}</SelectItem>
                    <SelectItem value="pocket">{t('workTypes.pocket')}</SelectItem>
                    <SelectItem value="vcarve">{t('workTypes.vcarve')}</SelectItem>
                    <SelectItem value="drill">{t('workTypes.drill')}</SelectItem>
                    <SelectItem value="chamfer">{t('workTypes.chamfer')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {globalConfig.workType === 'pocket' && (
                <>
                  <div>
                    <Label className="text-xs">{t('globalConfig.stepover')}</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        type="range"
                        min={10}
                        max={90}
                        step={5}
                        value={Math.round((globalConfig.stepover ?? 0.5) * 100)}
                        onChange={(e) => setGlobalConfig({ stepover: parseInt(e.target.value) / 100 })}
                        className="flex-1 h-8"
                      />
                      <span className="text-xs font-mono w-10 text-right">
                        {Math.round((globalConfig.stepover ?? 0.5) * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2 border-t pt-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">{t('globalConfig.restMachining')}</Label>
                      <Switch
                        checked={globalConfig.restMachiningEnabled ?? false}
                        onCheckedChange={(checked) => setGlobalConfig({ restMachiningEnabled: checked })}
                      />
                    </div>
                    {globalConfig.restMachiningEnabled && (
                      <div>
                        <Label className="text-[11px]">{t('globalConfig.restToolDiameter')}</Label>
                        <Input
                          type="number"
                          value={globalConfig.restToolDiameter ?? 1}
                          onChange={(e) => setGlobalConfig({ restToolDiameter: parseFloat(e.target.value) || 1 })}
                          className="mt-1"
                          min={0.1}
                          step={0.1}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* V-Carve settings */}
              {globalConfig.workType === 'vcarve' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">{t('globalConfig.vcarveAngle')}</Label>
                    <Input
                      type="number"
                      value={globalConfig.vcarveAngle ?? 90}
                      onChange={(e) => setGlobalConfig({ vcarveAngle: parseFloat(e.target.value) || 90 })}
                      className="mt-1"
                      min={10}
                      max={180}
                      step={5}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('globalConfig.vcarveMaxDepth')}</Label>
                    <Input
                      type="number"
                      value={globalConfig.vcarveMaxDepth ?? 5}
                      onChange={(e) => setGlobalConfig({ vcarveMaxDepth: parseFloat(e.target.value) || 5 })}
                      className="mt-1"
                      min={0.1}
                      step={0.5}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('globalConfig.vcarveStepSize')}</Label>
                    <Input
                      type="number"
                      value={globalConfig.vcarveStepSize ?? 0.2}
                      onChange={(e) => setGlobalConfig({ vcarveStepSize: parseFloat(e.target.value) || 0.2 })}
                      className="mt-1"
                      min={0.05}
                      step={0.05}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('globalConfig.vcarveFlatDepth')}</Label>
                    <Input
                      type="number"
                      value={globalConfig.vcarveFlatDepth ?? 0}
                      onChange={(e) => setGlobalConfig({ vcarveFlatDepth: parseFloat(e.target.value) || 0 })}
                      className="mt-1"
                      min={0}
                      step={0.5}
                      placeholder="0 = standard"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('globalConfig.depth')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.depth}
                    onChange={(e) => setGlobalConfig({ depth: parseFloat(e.target.value) || 0 })}
                    className="mt-1"
                    step="0.1"
                    min="0.1"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('globalConfig.depthStep')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.depthStep}
                    onChange={(e) => setGlobalConfig({ depthStep: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
                    className="mt-1"
                    step="0.1"
                    min="0.1"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('globalConfig.toolDiameter')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.toolDiameter}
                    onChange={(e) => setGlobalConfig({ toolDiameter: parseFloat(e.target.value) || 0 })}
                    className="mt-1"
                    step="0.001"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('globalConfig.spindleRPM')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.spindleRPM}
                    onChange={(e) => setGlobalConfig({ spindleRPM: parseInt(e.target.value) || 0 })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('globalConfig.feedRate')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.feedRate}
                    onChange={(e) => setGlobalConfig({ feedRate: parseInt(e.target.value) || 0 })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('globalConfig.plungeRate')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.plungeRate}
                    onChange={(e) => setGlobalConfig({ plungeRate: parseInt(e.target.value) || 0 })}
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Tabs (bridges) for contour cuts */}
              {globalConfig.workType !== 'pocket' && (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('globalConfig.tabsEnabled')}</Label>
                    <Switch
                      checked={globalConfig.tabsEnabled ?? false}
                      onCheckedChange={(checked) => setGlobalConfig({ tabsEnabled: checked })}
                    />
                  </div>
                  {globalConfig.tabsEnabled && (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[11px]">{t('globalConfig.tabCount')}</Label>
                        <Input
                          type="number"
                          value={globalConfig.tabCount ?? 4}
                          onChange={(e) => setGlobalConfig({ tabCount: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="mt-1"
                          min={1}
                          max={20}
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">{t('globalConfig.tabWidth')}</Label>
                        <Input
                          type="number"
                          value={globalConfig.tabWidth ?? 5}
                          onChange={(e) => setGlobalConfig({ tabWidth: parseFloat(e.target.value) || 1 })}
                          className="mt-1"
                          step="0.5"
                          min={1}
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">{t('globalConfig.tabHeight')}</Label>
                        <Input
                          type="number"
                          value={globalConfig.tabHeight ?? 1}
                          onChange={(e) => setGlobalConfig({ tabHeight: parseFloat(e.target.value) || 0.5 })}
                          className="mt-1"
                          step="0.25"
                          min={0.25}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Ramp entry */}
              {globalConfig.workType !== 'pocket' && (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('globalConfig.rampEnabled')}</Label>
                    <Switch
                      checked={globalConfig.rampEnabled ?? false}
                      onCheckedChange={(checked) => setGlobalConfig({ rampEnabled: checked })}
                    />
                  </div>
                  {globalConfig.rampEnabled && (
                    <div>
                      <Label className="text-[11px]">{t('globalConfig.rampAngle')}</Label>
                      <Input
                        type="number"
                        value={globalConfig.rampAngle ?? 3}
                        onChange={(e) => setGlobalConfig({ rampAngle: Math.max(0.5, Math.min(45, parseFloat(e.target.value) || 3)) })}
                        className="mt-1"
                        min={0.5}
                        max={45}
                        step={0.5}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Laser-specific settings */}
          {globalConfig.operationType === 'laser' && (
            <div className="space-y-3">
              {/* Modo láser */}
              <div>
                <Label>{t('globalConfig.laserMode')}</Label>
                <Select
                  value={globalConfig.laserMode || 'cut'}
                  onValueChange={(v) => setGlobalConfig({ laserMode: v as LaserMode })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cut">{t('laserModes.cut')}</SelectItem>
                    <SelectItem value="engrave">{t('laserModes.engrave')}</SelectItem>
                    <SelectItem value="fill">{t('laserModes.fill')}</SelectItem>
                    <SelectItem value="raster">{t('laserModes.raster')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* M3/M4 dinámico */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">{t('globalConfig.laserDynamic')}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {globalConfig.laserDynamic ? 'M4' : 'M3'} — {t(`globalConfig.laserDynamicDesc.${globalConfig.laserDynamic ? 'on' : 'off'}`)}
                  </p>
                </div>
                <Switch
                  checked={globalConfig.laserDynamic ?? false}
                  onCheckedChange={(checked) => setGlobalConfig({ laserDynamic: checked })}
                />
              </div>

              {/* Potencia, velocidad, pasadas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('globalConfig.laserPower')}</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={globalConfig.laserPower}
                      onChange={(e) => setGlobalConfig({ laserPower: parseInt(e.target.value) || 0 })}
                      className="flex-1 h-8"
                    />
                    <span className="text-xs font-mono w-10 text-right">
                      {globalConfig.laserPower}%
                    </span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">{t('globalConfig.feedRate')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.feedRate}
                    onChange={(e) => setGlobalConfig({ feedRate: parseInt(e.target.value) || 0 })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('globalConfig.passes')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.passes}
                    onChange={(e) => setGlobalConfig({ passes: parseInt(e.target.value) || 1 })}
                    className="mt-1"
                    min={1}
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('globalConfig.overscan')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.overscan ?? 2}
                    onChange={(e) => setGlobalConfig({ overscan: parseFloat(e.target.value) || 0 })}
                    className="mt-1"
                    min={0}
                    step={0.5}
                  />
                </div>
                {globalConfig.laserMode === 'cut' && (
                  <div>
                    <Label className="text-xs">{t('globalConfig.laserLeadIn')}</Label>
                    <Input
                      type="number"
                      value={globalConfig.laserLeadIn ?? 0}
                      onChange={(e) => setGlobalConfig({ laserLeadIn: parseFloat(e.target.value) || 0 })}
                      className="mt-1"
                      min={0}
                      step={0.5}
                      placeholder="0.0"
                    />
                  </div>
                )}
                {(globalConfig.laserMode === 'cut' || globalConfig.laserMode === 'engrave') && (
                  <div>
                    <Label className="text-xs">{t('globalConfig.laserKerf')}</Label>
                    <Input
                      type="number"
                      value={globalConfig.laserKerf ?? 0}
                      onChange={(e) => setGlobalConfig({ laserKerf: parseFloat(e.target.value) || 0 })}
                      className="mt-1"
                      min={0}
                      step={0.05}
                      placeholder="0.0"
                    />
                  </div>
                )}
              </div>

              {/* Opciones de relleno (solo modo fill) */}
              {globalConfig.laserMode === 'fill' && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <Label className="text-xs font-semibold">{t('globalConfig.fillSettings')}</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">{t('globalConfig.fillAngle')}</Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            type="range"
                            min={0}
                            max={360}
                            step={5}
                            value={globalConfig.fillAngle ?? 0}
                            onChange={(e) => setGlobalConfig({ fillAngle: parseInt(e.target.value) || 0 })}
                            className="flex-1 h-8"
                          />
                          <span className="text-xs font-mono w-10 text-right">
                            {globalConfig.fillAngle ?? 0}°
                          </span>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">{t('globalConfig.fillSpacing')}</Label>
                        <Input
                          type="number"
                          value={globalConfig.fillSpacing ?? 0.5}
                          onChange={(e) => setGlobalConfig({ fillSpacing: parseFloat(e.target.value) || 0.1 })}
                          className="mt-1"
                          min={0.05}
                          step={0.05}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">{t('globalConfig.fillBidirectional')}</Label>
                      <Switch
                        checked={globalConfig.fillBidirectional !== false}
                        onCheckedChange={(checked) => setGlobalConfig({ fillBidirectional: checked })}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Modo raster: indicar que se configura desde el wizard */}
              {globalConfig.laserMode === 'raster' && (
                <p className="text-xs text-muted-foreground">
                  {t('raster.wizardHint')}
                </p>
              )}
            </div>
          )}

          {/* Plotter-specific settings */}
          {globalConfig.operationType === 'plotter' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('globalConfig.pressure')}</Label>
                <Input
                  type="number"
                  value={globalConfig.pressure}
                  onChange={(e) => setGlobalConfig({ pressure: parseInt(e.target.value) || 0 })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">{t('globalConfig.speed')}</Label>
                <Input
                  type="number"
                  value={globalConfig.speed}
                  onChange={(e) => setGlobalConfig({ speed: parseInt(e.target.value) || 0 })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">{t('globalConfig.pressureZ')}</Label>
                <Input
                  type="number"
                  value={globalConfig.pressureZ}
                  onChange={(e) => setGlobalConfig({ pressureZ: parseFloat(e.target.value) || -1 })}
                  className="mt-1"
                  step={0.1}
                />
              </div>
              <div>
                <Label className="text-xs">{t('globalConfig.passes')}</Label>
                <Input
                  type="number"
                  value={globalConfig.passes}
                  onChange={(e) => setGlobalConfig({ passes: parseInt(e.target.value) || 1 })}
                  className="mt-1"
                  min={1}
                />
              </div>
              <div>
                <Label className="text-xs">{t('globalConfig.bladeOffset')}</Label>
                <Input
                  type="number"
                  value={globalConfig.bladeOffset ?? 0}
                  onChange={(e) => setGlobalConfig({ bladeOffset: parseFloat(e.target.value) || 0 })}
                  className="mt-1"
                  min={0}
                  step={0.05}
                  placeholder="0.0"
                />
              </div>
            </div>
          )}

          {/* Pencil-specific settings */}
          {globalConfig.operationType === 'pencil' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('globalConfig.speed')}</Label>
                <Input
                  type="number"
                  value={globalConfig.speed}
                  onChange={(e) => setGlobalConfig({ speed: parseInt(e.target.value) || 0 })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">{t('globalConfig.pressureZ')}</Label>
                <Input
                  type="number"
                  value={globalConfig.pressureZ}
                  onChange={(e) => setGlobalConfig({ pressureZ: parseFloat(e.target.value) || 0 })}
                  className="mt-1"
                  step="0.1"
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
