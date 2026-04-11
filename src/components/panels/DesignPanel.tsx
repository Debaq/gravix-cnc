import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
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

export function DesignPanel() {
  const { t } = useTranslation('canvas')
  const { elements, selectedElementId, selectElement } = useCanvasStore()
  const { addConsoleLine } = useAppStore()
  const canvasManager = useCanvasManager()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleLoadSVG = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    canvasManager.loadSVG(file)
    addConsoleLine(`SVG cargado: ${file.name}`)

    // Reset para permitir cargar el mismo archivo de nuevo
    e.target.value = ''
  }

  const handleAddShape = (type: string) => {
    canvasManager.addShape(type)
    addConsoleLine(`Elemento creado: ${type}`)
  }

  const handleCopyElement = (elId: string) => {
    // For now, copy creates a duplicate in the same position
    const el = elements.find((e) => e.id === elId)
    if (!el) return
    // Re-add the same shape type to canvas
    if (el.type === 'svg' && el.svgData) {
      // Recreate SVG from stored data
      const blob = new Blob([el.svgData], { type: 'image/svg+xml' })
      const file = new File([blob], `${el.name} (copia).svg`, { type: 'image/svg+xml' })
      canvasManager.loadSVG(file)
    } else {
      canvasManager.addShape(el.type)
    }
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
              <DropdownMenuItem onSelect={() => handleAddShape('rect')}>
                <Square className="h-4 w-4 mr-2" />
                {t('addRect')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleAddShape('circle')}>
                <Circle className="h-4 w-4 mr-2" />
                {t('addCircle')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleAddShape('line')}>
                <Minus className="h-4 w-4 mr-2" />
                {t('addLine')}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Hexagon className="h-4 w-4 mr-2" />
                  {t('makerModels')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => handleAddShape('rect')}>
                    {t('rectangle')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('rect')}>
                    {t('square')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('rect')}>
                    {t('roundRect')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('circle')}>
                    {t('oval')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('circle')}>
                    {t('ellipse')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('circle')}>
                    {t('ring')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('rect')}>
                    <Hexagon className="h-3 w-3 mr-2" />
                    {t('polygon')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('rect')}>
                    <Star className="h-3 w-3 mr-2" />
                    {t('star')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('rect')}>
                    {t('slot')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('circle')}>
                    {t('dome')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('circle')}>
                    {t('boltCircle')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('rect')}>
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
                    canvasManager.toggleVisibility(el.id)
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
                    canvasManager.toggleLock(el.id)
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
                    handleCopyElement(el.id)
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
                    canvasManager.removeObject(el.id)
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
