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

export function DesignPanel() {
  const { t } = useTranslation('canvas')
  const { elements, selectedElementId, selectElement } = useCanvasStore()
  const { addConsoleLine } = useAppStore()

  return (
    <div className="space-y-3">
      {/* Add element controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('elements')}</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="gap-1">
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
              <DropdownMenuItem>
                <Square className="h-4 w-4 mr-2" />
                {t('addRect')}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Circle className="h-4 w-4 mr-2" />
                {t('addCircle')}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Minus className="h-4 w-4 mr-2" />
                {t('addLine')}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Hexagon className="h-4 w-4 mr-2" />
                  {t('makerModels')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>{t('rectangle')}</DropdownMenuItem>
                  <DropdownMenuItem>{t('square')}</DropdownMenuItem>
                  <DropdownMenuItem>{t('roundRect')}</DropdownMenuItem>
                  <DropdownMenuItem>{t('oval')}</DropdownMenuItem>
                  <DropdownMenuItem>{t('ellipse')}</DropdownMenuItem>
                  <DropdownMenuItem>{t('ring')}</DropdownMenuItem>
                  <DropdownMenuItem>
                    <Hexagon className="h-3 w-3 mr-2" />
                    {t('polygon')}
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Star className="h-3 w-3 mr-2" />
                    {t('star')}
                  </DropdownMenuItem>
                  <DropdownMenuItem>{t('slot')}</DropdownMenuItem>
                  <DropdownMenuItem>{t('dome')}</DropdownMenuItem>
                  <DropdownMenuItem>{t('boltCircle')}</DropdownMenuItem>
                  <DropdownMenuItem>{t('boltRect')}</DropdownMenuItem>
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
                    addConsoleLine(`Toggle visibility: ${el.name}`)
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
                    addConsoleLine(`Toggle lock: ${el.name}`)
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
                    addConsoleLine(`Copy: ${el.name}`)
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
                    addConsoleLine(`Delete: ${el.name}`)
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
