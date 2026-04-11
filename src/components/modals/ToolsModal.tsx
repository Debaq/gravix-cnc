import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useAppStore } from '@/stores/useAppStore'
import { isTauri, tauriInvoke } from '@/lib/tauri'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Wrench, Edit, Trash2, Plus, X } from 'lucide-react'
import type { Tool, ToolFormData } from '@/lib/types'

const TOOL_TYPES: Record<string, string[]> = {
  cnc: ['endmill', 'vbit', 'ballnose'],
  plotter: ['blade'],
  pencil: ['marker', 'pen', 'pencilType'],
}

function generateId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function ToolsModal() {
  const { t } = useTranslation('tools')
  const { t: tc } = useTranslation('common')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const {
    tools,
    setTools,
    toolsModalTab,
    setToolsModalTab,
    getToolsByCategory,
    editingTool,
    setEditingTool,
  } = useLibraryStore()

  const [showForm, setShowForm] = useState(false)

  const isOpen = activeModal === 'tools'
  const categoryTools = getToolsByCategory(toolsModalTab)

  const { register, handleSubmit, reset, setValue, watch } = useForm<ToolFormData>({
    defaultValues: {
      name: '',
      type: '',
      diameter: 3.175,
      angle: 0,
      feedRate: 1000,
      plungeRate: 300,
      rpm: 10000,
      pressure: 0,
      speed: 0,
      thickness: 0,
      color: '#000000',
      notes: '',
    },
  })

  const openCreateForm = useCallback(() => {
    setEditingTool(null)
    const types = TOOL_TYPES[toolsModalTab] ?? []
    reset({
      name: '',
      type: types[0] ?? '',
      diameter: 3.175,
      angle: 0,
      feedRate: 1000,
      plungeRate: 300,
      rpm: 10000,
      pressure: 0,
      speed: 0,
      thickness: 0,
      color: '#000000',
      notes: '',
    })
    setShowForm(true)
  }, [toolsModalTab, reset, setEditingTool])

  const openEditForm = useCallback((tool: Tool) => {
    setEditingTool(tool)
    reset({
      name: tool.name,
      type: tool.type,
      diameter: tool.diameter ?? 0,
      angle: tool.angle ?? 0,
      feedRate: tool.feedRate ?? 0,
      plungeRate: tool.plungeRate ?? 0,
      rpm: tool.rpm ?? 0,
      pressure: tool.pressure ?? 0,
      speed: tool.speed ?? 0,
      thickness: tool.thickness ?? 0,
      color: tool.color ?? '#000000',
      notes: tool.notes ?? '',
    })
    setShowForm(true)
  }, [reset, setEditingTool])

  const onSubmit = async (data: ToolFormData) => {
    const tool: Tool = {
      id: editingTool?.id ?? generateId(),
      category: toolsModalTab as Tool['category'],
      name: data.name,
      type: data.type,
      diameter: data.diameter || undefined,
      angle: data.angle || undefined,
      feedRate: data.feedRate || undefined,
      plungeRate: data.plungeRate || undefined,
      rpm: data.rpm || undefined,
      pressure: data.pressure || undefined,
      speed: data.speed || undefined,
      thickness: data.thickness || undefined,
      color: data.color || undefined,
      notes: data.notes || undefined,
    }

    try {
      if (isTauri()) {
        const saved = await tauriInvoke<Tool>('save_tool', { tool })
        // Actualizar lista local
        const updated = editingTool
          ? tools.map((t) => (t.id === saved.id ? saved : t))
          : [...tools, saved]
        setTools(updated)
      } else {
        // Sin Tauri: solo actualizar estado local
        const updated = editingTool
          ? tools.map((t) => (t.id === tool.id ? tool : t))
          : [...tools, tool]
        setTools(updated)
      }
      addConsoleLine(editingTool ? `Herramienta actualizada: ${tool.name}` : `Herramienta creada: ${tool.name}`)
    } catch (err) {
      addConsoleLine(`Error guardando herramienta: ${err}`)
    }

    setShowForm(false)
    setEditingTool(null)
  }

  const handleDelete = async (tool: Tool) => {
    try {
      if (isTauri()) {
        await tauriInvoke('delete_tool', { id: tool.id })
      }
      setTools(tools.filter((t) => t.id !== tool.id))
      addConsoleLine(`Herramienta eliminada: ${tool.name}`)
    } catch (err) {
      addConsoleLine(`Error eliminando herramienta: ${err}`)
    }
  }

  const isCNC = toolsModalTab === 'cnc'
  const isPlotter = toolsModalTab === 'plotter'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('cnc')} / {t('plotter')} / {t('pencil')}</DialogDescription>
        </DialogHeader>

        {showForm ? (
          /* Formulario de edicion/creacion */
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {editingTool ? t('editTool') : t('addTool')}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => { setShowForm(false); setEditingTool(null) }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">{t('name')}</Label>
                <Input {...register('name', { required: true })} className="h-8" />
              </div>

              <div>
                <Label className="text-xs">{t('type')}</Label>
                <Select
                  value={watch('type')}
                  onValueChange={(v) => setValue('type', v)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(TOOL_TYPES[toolsModalTab] ?? []).map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isCNC && (
                <>
                  <div>
                    <Label className="text-xs">{t('diameter')} (mm)</Label>
                    <Input type="number" step="0.001" {...register('diameter', { valueAsNumber: true })} className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">{t('angle')}</Label>
                    <Input type="number" {...register('angle', { valueAsNumber: true })} className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">{t('feedRate')}</Label>
                    <Input type="number" {...register('feedRate', { valueAsNumber: true })} className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">{t('plungeRate')}</Label>
                    <Input type="number" {...register('plungeRate', { valueAsNumber: true })} className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">{t('rpm')}</Label>
                    <Input type="number" {...register('rpm', { valueAsNumber: true })} className="h-8" />
                  </div>
                </>
              )}

              {isPlotter && (
                <>
                  <div>
                    <Label className="text-xs">{t('pressure')}</Label>
                    <Input type="number" {...register('pressure', { valueAsNumber: true })} className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">{t('speed')}</Label>
                    <Input type="number" {...register('speed', { valueAsNumber: true })} className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">{t('thickness')} (mm)</Label>
                    <Input type="number" step="0.01" {...register('thickness', { valueAsNumber: true })} className="h-8" />
                  </div>
                </>
              )}

              {!isCNC && (
                <div>
                  <Label className="text-xs">{t('color')}</Label>
                  <Input type="color" {...register('color')} className="h-8 w-full" />
                </div>
              )}

              <div className="col-span-2">
                <Label className="text-xs">{t('notes')}</Label>
                <Input {...register('notes')} className="h-8" />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setEditingTool(null) }}>
                {tc('cancel')}
              </Button>
              <Button type="submit" size="sm">
                {tc('save')}
              </Button>
            </div>
          </form>
        ) : (
          /* Lista de herramientas */
          <>
            <Tabs value={toolsModalTab} onValueChange={setToolsModalTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="cnc">{t('cnc')}</TabsTrigger>
                <TabsTrigger value="plotter">{t('plotter')}</TabsTrigger>
                <TabsTrigger value="pencil">{t('pencil')}</TabsTrigger>
              </TabsList>

              <TabsContent value={toolsModalTab}>
                <ScrollArea className="h-[400px]">
                  {categoryTools.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">{t('noTools')}</p>
                  ) : (
                    <div className="space-y-2">
                      {categoryTools.map((tool) => (
                        <div
                          key={tool.id}
                          className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{tool.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {tool.type}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              {tool.diameter && <span>{t('diameter')}: {tool.diameter}mm</span>}
                              {tool.feedRate && <span>{t('feedRate')}: {tool.feedRate}</span>}
                              {tool.rpm && <span>{t('rpm')}: {tool.rpm}</span>}
                              {tool.pressure && <span>{t('pressure')}: {tool.pressure}</span>}
                              {tool.thickness && <span>{t('thickness')}: {tool.thickness}mm</span>}
                            </div>
                            {tool.notes && (
                              <p className="text-xs text-muted-foreground mt-1">{tool.notes}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditForm(tool)}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDelete(tool)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={openCreateForm} className="gap-1">
                <Plus className="h-3 w-3" />
                {t('addTool')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
