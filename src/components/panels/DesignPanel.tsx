import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  Upload,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
  ChevronRight,
  Square,
  Circle,
  Minus,
  Hexagon,
  Star,
} from 'lucide-react'
import type { CanvasElement } from '@/lib/types'

function createShapeElement(
  type: CanvasElement['type'],
  name: string,
  makerType?: string,
  makerParams?: Record<string, number | string | number[]>
): CanvasElement {
  return {
    id: crypto.randomUUID(),
    type,
    name,
    visible: true,
    locked: false,
    config: null,
    children: [],
    makerType,
    makerParams,
  }
}

export function DesignPanel() {
  const { t } = useTranslation('canvas')
  const { elements, selectedElementId, selectElement, addElement, removeElement, updateElement } = useCanvasStore()
  const { addConsoleLine } = useAppStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleLoadSVG = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const svgData = ev.target?.result as string
      if (!svgData) return

      const el = createShapeElement('svg', file.name.replace('.svg', ''))
      el.svgData = svgData
      addElement(el)
      addConsoleLine(`SVG cargado: ${file.name}`)
    }
    reader.readAsText(file)

    // Reset para permitir cargar el mismo archivo de nuevo
    e.target.value = ''
  }

  const handleAddShape = (type: CanvasElement['type'], name: string, makerType?: string, makerParams?: Record<string, number | string | number[]>) => {
    const el = createShapeElement(type, name, makerType, makerParams)
    addElement(el)
    selectElement(el.id)
    addConsoleLine(`Elemento creado: ${name}`)
  }

  const handleCopyElement = (el: CanvasElement) => {
    const copy = createShapeElement(el.type, `${el.name} (copia)`, el.makerType, el.makerParams)
    copy.config = el.config ? { ...el.config } : null
    copy.svgData = el.svgData
    copy.children = el.children.map((child) => ({
      ...child,
      id: crypto.randomUUID(),
      parent: copy.id,
    }))
    addElement(copy)
    addConsoleLine(`Copiado: ${el.name}`)
  }

  return (
    <div className="space-y-3">
      {/* Hidden file input for SVG loading */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Add element controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('elements')}</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="gap-1" onClick={handleLoadSVG}>
            <Upload className="h-3 w-3" />
            {t('loadSVG')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => handleAddShape('rect', t('addRect'))}>
                <Square className="h-4 w-4 mr-2" />
                {t('addRect')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleAddShape('circle', t('addCircle'))}>
                <Circle className="h-4 w-4 mr-2" />
                {t('addCircle')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleAddShape('line', t('addLine'))}>
                <Minus className="h-4 w-4 mr-2" />
                {t('addLine')}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Hexagon className="h-4 w-4 mr-2" />
                  {t('makerModels')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('rectangle'), 'Rectangle', { width: 50, height: 30 })}>
                    {t('rectangle')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('square'), 'Square', { side: 40 })}>
                    {t('square')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('roundRect'), 'RoundRectangle', { width: 50, height: 30, corner: 5 })}>
                    {t('roundRect')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('oval'), 'Oval', { width: 50, height: 30 })}>
                    {t('oval')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('ellipse'), 'Ellipse', { radiusX: 30, radiusY: 20 })}>
                    {t('ellipse')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('ring'), 'Ring', { outerRadius: 30, innerRadius: 20 })}>
                    {t('ring')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('polygon'), 'Polygon', { sides: 6, radius: 25 })}>
                    <Hexagon className="h-3 w-3 mr-2" />
                    {t('polygon')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('star'), 'Star', { points: 5, outerRadius: 30, innerRadius: 15 })}>
                    <Star className="h-3 w-3 mr-2" />
                    {t('star')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('slot'), 'Slot', { width: 50, height: 20 })}>
                    {t('slot')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('dome'), 'Dome', { width: 40, height: 25 })}>
                    {t('dome')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('boltCircle'), 'BoltCircle', { boltCount: 6, radius: 30, boltRadius: 3 })}>
                    {t('boltCircle')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('maker', t('boltRect'), 'BoltRectangle', { width: 60, height: 40, boltRadius: 3 })}>
                    {t('boltRect')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Separator />

      {/* Elements list */}
      <div className="space-y-1">
        {elements.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {t('loadSVG')}
          </p>
        ) : (
          elements.map((el) => (
            <div
              key={el.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors ${
                selectedElementId === el.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted'
              }`}
              onClick={() => selectElement(el.id)}
            >
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="flex-1 truncate">{el.name}</span>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation()
                    updateElement(el.id, { visible: !el.visible })
                  }}
                >
                  {el.visible ? (
                    <Eye className="h-3 w-3" />
                  ) : (
                    <EyeOff className="h-3 w-3 text-muted-foreground" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation()
                    updateElement(el.id, { locked: !el.locked })
                  }}
                >
                  {el.locked ? (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <Unlock className="h-3 w-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopyElement(el)
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeElement(el.id)
                    addConsoleLine(`Eliminado: ${el.name}`)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
