import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCanvasManager, getSharedCanvas } from '@/hooks/useCanvasManager'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Layers, 
  Plus, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  Trash2,
  ChevronUp,
  ChevronDown,
  Palette
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function LayersPanel() {
  const { t } = useTranslation('canvas')
  const { 
    layers, 
    activeLayerId, 
    setActiveLayer, 
    addLayer, 
    removeLayer, 
    updateLayer, 
    reorderLayers, 
    elements 
  } = useCanvasStore()
  const cm = useCanvasManager()

  const handleToggleVisibility = (id: string, visible: boolean) => {
    updateLayer(id, { visible })
    // Sync with fabric objects
    elements.forEach(el => {
      if (el.layerId === id && el.fabricObject) {
        const obj = el.fabricObject as any
        obj.set({ visible })
        // If it's a group, also update children visibility if needed
        // Fabric usually handles this, but setCoords might be needed
      }
    })
    getSharedCanvas()?.requestRenderAll()
  }

  const handleToggleLock = (id: string, locked: boolean) => {
    updateLayer(id, { locked })
    elements.forEach(el => {
      if (el.layerId === id && el.fabricObject) {
        const obj = el.fabricObject as any
        obj.set({
          selectable: !locked,
          evented: !locked,
          lockMovementX: locked,
          lockMovementY: locked,
          lockRotation: locked,
          lockScalingX: locked,
          lockScalingY: locked
        })
      }
    })
    getSharedCanvas()?.requestRenderAll()
  }

  const moveLayer = (id: string, direction: 'up' | 'down') => {
    const sorted = [...layers].sort((a, b) => a.order - b.order)
    const idx = sorted.findIndex(l => l.id === id)
    if (direction === 'up' && idx > 0) {
      [sorted[idx - 1], sorted[idx]] = [sorted[idx], sorted[idx - 1]]
    } else if (direction === 'down' && idx < sorted.length - 1) {
      [sorted[idx], sorted[idx + 1]] = [sorted[idx + 1], sorted[idx]]
    } else {
      return
    }
    // Update orders
    const newLayers = sorted.map((l, i) => ({ ...l, order: i }))
    reorderLayers(newLayers)
  }

  return (
    <div className="flex flex-col h-full border rounded-md overflow-hidden bg-background">
      <div className="flex items-center justify-between p-2 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t('layers.title') || 'Layers'}
          </h3>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-6 w-6" 
          onClick={() => addLayer()}
          title={t('layers.add') || 'Nueva capa'}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1 space-y-1">
          {[...layers].sort((a,b) => a.order - b.order).map((layer) => (
            <div 
              key={layer.id}
              className={cn(
                "group flex items-center gap-1.5 p-1.5 rounded-sm border transition-colors cursor-pointer",
                activeLayerId === layer.id 
                  ? "bg-accent/50 border-accent-foreground/20 ring-1 ring-inset ring-accent-foreground/10" 
                  : "hover:bg-muted/50 border-transparent"
              )}
              onClick={() => setActiveLayer(layer.id)}
            >
              {/* Color dot / selector */}
              <div 
                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm border border-black/10" 
                style={{ backgroundColor: layer.color }} 
              />
              
              <span className={cn(
                "flex-1 text-[11px] truncate font-medium",
                !layer.visible && "text-muted-foreground line-through"
              )}>
                {layer.name}
              </span>

              {/* Layer Actions */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-5 w-5" 
                  onClick={(e) => { e.stopPropagation(); handleToggleVisibility(layer.id, !layer.visible); }}
                >
                  {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-5 w-5"
                  onClick={(e) => { e.stopPropagation(); handleToggleLock(layer.id, !layer.locked); }}
                >
                  {layer.locked ? <Lock className="h-3 w-3 text-amber-600" /> : <Unlock className="h-3 w-3" />}
                </Button>
                
                <div className="flex flex-col">
                  <button 
                    className="hover:text-primary disabled:opacity-30" 
                    onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); }}
                    disabled={layer.order === 0}
                  >
                    <ChevronUp className="h-2.5 w-2.5" />
                  </button>
                  <button 
                    className="hover:text-primary disabled:opacity-30" 
                    onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); }}
                    disabled={layer.order === layers.length - 1}
                  >
                    <ChevronDown className="h-2.5 w-2.5" />
                  </button>
                </div>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-5 w-5 text-destructive hover:bg-destructive/10"
                  onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
                  disabled={layers.length <= 1}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
