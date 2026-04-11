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
import type { OperationType } from '@/lib/types'

export function GlobalConfigModal() {
  const { t } = useTranslation('settings')
  const { activeModal, closeModal } = useAppStore()
  const { globalConfig, setGlobalConfig } = useCanvasStore()
  const { getFilteredTools, materials } = useLibraryStore()

  const isOpen = activeModal === 'globalConfig'
  const filteredTools = getFilteredTools(globalConfig.operationType)

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
              onValueChange={(v) => setGlobalConfig({ tool: v === 'none' ? '' : v })}
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
              onValueChange={(v) => setGlobalConfig({ material: v === 'none' ? '' : v })}
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
                  onValueChange={(v) => setGlobalConfig({ workType: v as 'outline' | 'inside' | 'outside' | 'pocket' })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outline">{t('workTypes.outline')}</SelectItem>
                    <SelectItem value="inside">{t('workTypes.inside')}</SelectItem>
                    <SelectItem value="outside">{t('workTypes.outside')}</SelectItem>
                    <SelectItem value="pocket">{t('workTypes.pocket')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t('globalConfig.compensation')}</Label>
                <Select
                  value={globalConfig.compensation}
                  onValueChange={(v) => setGlobalConfig({ compensation: v as 'center' | 'inside' | 'outside' })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="center">{t('compensation.center')}</SelectItem>
                    <SelectItem value="inside">{t('compensation.inside')}</SelectItem>
                    <SelectItem value="outside">{t('compensation.outside')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('globalConfig.depth')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.depth}
                    onChange={(e) => setGlobalConfig({ depth: parseFloat(e.target.value) || 0 })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('globalConfig.depthStep')}</Label>
                  <Input
                    type="number"
                    value={globalConfig.depthStep}
                    onChange={(e) => setGlobalConfig({ depthStep: parseFloat(e.target.value) || 0 })}
                    className="mt-1"
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
            </div>
          )}

          {/* Laser-specific settings */}
          {globalConfig.operationType === 'laser' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('globalConfig.laserPower')}</Label>
                <Input
                  type="number"
                  value={globalConfig.laserPower}
                  onChange={(e) => setGlobalConfig({ laserPower: parseInt(e.target.value) || 0 })}
                  className="mt-1"
                  min={0}
                  max={100}
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
                <Label className="text-xs">{t('globalConfig.passes')}</Label>
                <Input
                  type="number"
                  value={globalConfig.passes}
                  onChange={(e) => setGlobalConfig({ passes: parseInt(e.target.value) || 1 })}
                  className="mt-1"
                  min={1}
                />
              </div>
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
