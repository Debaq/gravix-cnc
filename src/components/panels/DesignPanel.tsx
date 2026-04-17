import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
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
  Square,
  Circle,
  Hexagon,
  Star,
  Settings2,
  Pencil,
  Grid3X3,
  Minus,
  Spline,
  Undo2,
  Type,
  RectangleHorizontal,
  CircleDot,
  Pill,
  Cone,
  CircleDashed,
  SquareDashed,
  BoxSelect,
} from 'lucide-react'

export function DesignPanel() {
  const { t } = useTranslation('canvas')
  const { t: ts } = useTranslation('settings')
  const { elements, selectedElementId, selectElement, globalConfig, workArea, setDrawingMode } = useCanvasStore()
  const { tools, materials } = useLibraryStore()
  const { addConsoleLine, openModal } = useAppStore()
  const handleTextToPath = () => openModal('textToPath')
  const handleBoxGenerator = () => openModal('boxGenerator')
  const canvasManager = useCanvasManager()
  const svgInputRef = useRef<HTMLInputElement>(null)
  const dxfInputRef = useRef<HTMLInputElement>(null)

  // Resolve display names
  const toolName = tools.find((t) => t.id === globalConfig.tool)?.name
  const materialName = materials.find((m) => m.id === globalConfig.material)?.name

  const handleLoadSVG = () => {
    svgInputRef.current?.click()
  }

  const handleSVGChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    canvasManager.loadSVG(file)
    addConsoleLine(`SVG cargado: ${file.name}`)
    e.target.value = ''
  }

  const handleLoadDXF = () => {
    dxfInputRef.current?.click()
  }

  const handleDXFChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    canvasManager.loadDXF(file)
    addConsoleLine(`DXF cargado: ${file.name}`)
    e.target.value = ''
  }

  const handleLoadImage = () => {
    canvasManager.loadImage()
  }

  const handleAddShape = (type: string) => {
    canvasManager.addShape(type)
    addConsoleLine(`Elemento creado: ${type}`)
  }

  const handleCopyElement = (elId: string) => {
    const el = elements.find((e) => e.id === elId)
    if (!el) return
    if (el.type === 'svg' && el.svgData) {
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
    <input
      ref={svgInputRef}
      type="file"
      accept=".svg"
      className="hidden"
      onChange={handleSVGChange}
    />
    <input
      ref={dxfInputRef}
      type="file"
      accept=".dxf"
      className="hidden"
      onChange={handleDXFChange}
    />

    {/* Work Area Summary */}
    <button
      className="w-full text-left rounded-md border bg-muted/30 px-3 py-2 hover:bg-muted/60 transition-colors"
      onClick={() => openModal('workArea')}
    >        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Grid3X3 className="h-3 w-3" />
            {ts('workArea.title')}
          </span>
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span>{workArea.width} x {workArea.height} mm</span>
          <span className="text-muted-foreground">
            {ts(`workArea.origin`)}: {workArea.origin}
          </span>
        </div>
      </button>

      {/* Global Config Summary */}
      <button
        className="w-full text-left rounded-md border bg-muted/30 px-3 py-2 hover:bg-muted/60 transition-colors"
        onClick={() => openModal('globalConfig')}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Settings2 className="h-3 w-3" />
            {ts('globalConfig.title')}
          </span>
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          <span>
            <span className="text-muted-foreground">{ts('globalConfig.operationType')}: </span>
            {ts(`operationTypes.${globalConfig.operationType}`)}
          </span>
          <span>
            <span className="text-muted-foreground">{ts('globalConfig.workType')}: </span>
            {globalConfig.operationType === 'cnc'
              ? ts(`workTypes.${globalConfig.workType}`)
              : globalConfig.operationType === 'laser'
                ? ts(`laserModes.${globalConfig.laserMode}`)
                : '-'}
          </span>
          <span className="truncate">
            <span className="text-muted-foreground">{ts('globalConfig.tool')}: </span>
            {toolName || <span className="text-amber-500">{ts('globalConfig.noTool')}</span>}
          </span>
          <span className="truncate">
            <span className="text-muted-foreground">{ts('globalConfig.material')}: </span>
            {materialName || <span className="text-muted-foreground">{ts('globalConfig.noMaterial')}</span>}
          </span>
        </div>
      </button>

      <Separator />

      {/* Add element controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('elements')}</h3>
        <div className="flex gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Upload className="h-3 w-3" />
                {t('load')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleLoadSVG}>
                {t('loadSVG')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleLoadDXF}>
                {t('loadDXF') || 'Cargar DXF'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleLoadImage}>
                {t('loadImage')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
              <DropdownMenuItem onSelect={() => setDrawingMode('line')}>
                <Minus className="h-4 w-4 mr-2" />
                {t('drawLine')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDrawingMode('arc')}>
                <Undo2 className="h-4 w-4 mr-2" />
                {t('drawArc')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDrawingMode('bezier')}>
                <Spline className="h-4 w-4 mr-2" />
                {t('drawCurve')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleTextToPath}>
                <Type className="h-4 w-4 mr-2" />
                {t('textToPath')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleBoxGenerator}>
                <BoxSelect className="h-4 w-4 mr-2" />
                {t('boxGenerator')}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Hexagon className="h-4 w-4 mr-2" />
                  {t('makerModels')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => handleAddShape('roundRect')}>
                    <RectangleHorizontal className="h-3 w-3 mr-2" />{t('roundRect')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('ellipse')}>
                    <Circle className="h-3 w-3 mr-2" />{t('ellipse')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('ring')}>
                    <CircleDot className="h-3 w-3 mr-2" />{t('ring')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('polygon')}>
                    <Hexagon className="h-3 w-3 mr-2" />{t('polygon')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('star')}>
                    <Star className="h-3 w-3 mr-2" />{t('star')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('slot')}>
                    <Pill className="h-3 w-3 mr-2" />{t('slot')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('dome')}>
                    <Cone className="h-3 w-3 mr-2" />{t('dome')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('boltCircle')}>
                    <CircleDashed className="h-3 w-3 mr-2" />{t('boltCircle')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAddShape('boltRect')}>
                    <SquareDashed className="h-3 w-3 mr-2" />{t('boltRect')}
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
        {elements.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            {t('loadSVG')}
          </p>
        )}
        {elements.map((el) => (
          <div
            key={el.id}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors ${
              selectedElementId === el.id
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted'
            }`}
            onClick={() => selectElement(el.id)}
          >
            <span className="flex-1 truncate text-xs">{el.name}</span>

            {el.config !== null && (
              <Settings2 className="h-3 w-3 text-orange-400 shrink-0" />
            )}

            <div className="flex items-center shrink-0">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); canvasManager.toggleVisibility(el.id) }}>
                {el.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); canvasManager.toggleLock(el.id) }}>
                {el.locked ? <Lock className="h-3 w-3 text-muted-foreground" /> : <Unlock className="h-3 w-3" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleCopyElement(el.id) }}>
                <Copy className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={(e) => { e.stopPropagation(); canvasManager.removeObject(el.id); addConsoleLine(`Eliminado: ${el.name}`) }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
