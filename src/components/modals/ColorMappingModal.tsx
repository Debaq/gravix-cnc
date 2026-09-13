import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'
import type { ColorMapping, LaserMode } from '@/lib/types'

const MODES: LaserMode[] = ['cut', 'engrave', 'fill']

export function ColorMappingModal() {
  const { t } = useTranslation('settings')
  const { activeModal, closeModal } = useAppStore()
  const colorMappings = useCanvasStore((s) => s.colorMappings)
  const setColorMappings = useCanvasStore((s) => s.setColorMappings)

  const isOpen = activeModal === 'colorMapping'

  const update = (index: number, patch: Partial<ColorMapping>) => {
    setColorMappings(
      colorMappings.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    )
  }

  const add = () => {
    setColorMappings([
      ...colorMappings,
      {
        color: '#ff00ff',
        name: t('colorMapping.newLayer'),
        mode: 'cut',
        power: 60,
        speed: 600,
        passes: 1,
        enabled: true,
      },
    ])
  }

  const remove = (index: number) => {
    setColorMappings(colorMappings.filter((_, i) => i !== index))
  }

  return (
    <Dialog open={isOpen} onOpenChange={closeModal}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{t('colorMapping.title')}</DialogTitle>
          <DialogDescription>{t('colorMapping.description')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[420px]">
          <div className="space-y-2 pr-3">
            {/* Cabecera de columnas */}
            <div className="grid grid-cols-[28px_36px_1fr_88px_64px_72px_52px_28px] items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span />
              <span />
              <span>{t('colorMapping.name')}</span>
              <span>{t('colorMapping.mode')}</span>
              <span>{t('colorMapping.power')}</span>
              <span>{t('colorMapping.speed')}</span>
              <span>{t('colorMapping.passes')}</span>
              <span />
            </div>

            {colorMappings.map((m, i) => (
              <div
                key={i}
                className="grid grid-cols-[28px_36px_1fr_88px_64px_72px_52px_28px] items-center gap-2 rounded-md border px-1 py-1.5"
              >
                <Switch
                  checked={m.enabled}
                  onCheckedChange={(enabled) => update(i, { enabled })}
                />
                <Input
                  type="color"
                  className="h-7 w-9 cursor-pointer p-0.5"
                  value={m.color}
                  onChange={(e) => update(i, { color: e.target.value })}
                />
                <Input
                  className="h-7 text-xs"
                  value={m.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <Select
                  value={m.mode}
                  onValueChange={(mode) => update(i, { mode: mode as LaserMode })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`laserModes.${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  className="h-7 text-xs"
                  min="0"
                  max="100"
                  value={m.power}
                  onChange={(e) => update(i, { power: parseFloat(e.target.value) || 0 })}
                />
                <Input
                  type="number"
                  className="h-7 text-xs"
                  min="1"
                  value={m.speed}
                  onChange={(e) => update(i, { speed: parseFloat(e.target.value) || 1 })}
                />
                <Input
                  type="number"
                  className="h-7 text-xs"
                  min="1"
                  value={m.passes}
                  onChange={(e) =>
                    update(i, { passes: Math.max(1, parseInt(e.target.value) || 1) })
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

            {colorMappings.length === 0 && (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                {t('colorMapping.empty')}
              </p>
            )}
          </div>
        </ScrollArea>

        <p className="text-[10px] text-muted-foreground">{t('colorMapping.hint')}</p>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" size="sm" className="gap-1" onClick={add}>
            <Plus className="h-3.5 w-3.5" />
            {t('colorMapping.add')}
          </Button>
          <Button onClick={closeModal}>{t('colorMapping.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
