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
import { Separator } from '@/components/ui/separator'
import { Layers, Edit, Trash2, Plus, X } from 'lucide-react'
import type { Material, MaterialFormData } from '@/lib/types'

function generateId(): string {
  return `mat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function MaterialsModal() {
  const { t } = useTranslation('materials')
  const { t: tc } = useTranslation('common')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const {
    materials,
    setMaterials,
    materialsModalTab,
    setMaterialsModalTab,
    getMaterialsByCategory,
    editingMaterial,
    setEditingMaterial,
  } = useLibraryStore()

  const [showForm, setShowForm] = useState(false)

  const isOpen = activeModal === 'materials'
  const categoryMaterials = getMaterialsByCategory(materialsModalTab)

  const { register, handleSubmit, reset } = useForm<MaterialFormData>({
    defaultValues: {
      name: '',
      thickness: 3,
      description: '',
      color: '#c4a882',
      cncFeedRate: 1000,
      cncPlungeRate: 300,
      cncRpm: 10000,
      cncDepthPerPass: 1,
      laserCutPower: 100,
      laserCutSpeed: 500,
      laserEngravePower: 30,
      laserEngraveSpeed: 1000,
    },
  })

  const openCreateForm = useCallback(() => {
    setEditingMaterial(null)
    reset({
      name: '',
      thickness: 3,
      description: '',
      color: '#c4a882',
      cncFeedRate: 1000,
      cncPlungeRate: 300,
      cncRpm: 10000,
      cncDepthPerPass: 1,
      laserCutPower: 100,
      laserCutSpeed: 500,
      laserEngravePower: 30,
      laserEngraveSpeed: 1000,
    })
    setShowForm(true)
  }, [reset, setEditingMaterial])

  const openEditForm = useCallback((material: Material) => {
    setEditingMaterial(material)
    reset({
      name: material.name,
      thickness: material.thickness,
      description: material.description ?? '',
      color: material.color,
      cncFeedRate: material.cnc?.feedRate ?? 1000,
      cncPlungeRate: material.cnc?.plungeRate ?? 300,
      cncRpm: material.cnc?.rpm ?? 10000,
      cncDepthPerPass: material.cnc?.depthPerPass ?? 1,
      laserCutPower: material.laser?.cutPower ?? 100,
      laserCutSpeed: material.laser?.cutSpeed ?? 500,
      laserEngravePower: material.laser?.engravePower ?? 30,
      laserEngraveSpeed: material.laser?.engraveSpeed ?? 1000,
    })
    setShowForm(true)
  }, [reset, setEditingMaterial])

  const onSubmit = async (data: MaterialFormData) => {
    const material: Material = {
      id: editingMaterial?.id ?? generateId(),
      name: data.name,
      category: materialsModalTab,
      thickness: data.thickness,
      description: data.description || undefined,
      color: data.color,
      cnc: {
        feedRate: data.cncFeedRate,
        plungeRate: data.cncPlungeRate,
        rpm: data.cncRpm,
        depthPerPass: data.cncDepthPerPass,
      },
      laser: {
        cutPower: data.laserCutPower,
        cutSpeed: data.laserCutSpeed,
        engravePower: data.laserEngravePower,
        engraveSpeed: data.laserEngraveSpeed,
      },
    }

    try {
      if (isTauri()) {
        const saved = await tauriInvoke<Material>('save_material', { material })
        const updated = editingMaterial
          ? materials.map((m) => (m.id === saved.id ? saved : m))
          : [...materials, saved]
        setMaterials(updated)
      } else {
        const updated = editingMaterial
          ? materials.map((m) => (m.id === material.id ? material : m))
          : [...materials, material]
        setMaterials(updated)
      }
      addConsoleLine(editingMaterial ? `Material actualizado: ${material.name}` : `Material creado: ${material.name}`)
    } catch (err) {
      addConsoleLine(`Error guardando material: ${err}`)
    }

    setShowForm(false)
    setEditingMaterial(null)
  }

  const handleDelete = async (material: Material) => {
    try {
      if (isTauri()) {
        await tauriInvoke('delete_material', { id: material.id })
      }
      setMaterials(materials.filter((m) => m.id !== material.id))
      addConsoleLine(`Material eliminado: ${material.name}`)
    } catch (err) {
      addConsoleLine(`Error eliminando material: ${err}`)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('wood')} / {t('plastic')} / {t('metal')}</DialogDescription>
        </DialogHeader>

        {showForm ? (
          /* Formulario de edicion/creacion */
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {editingMaterial ? t('editMaterial') : t('addMaterial')}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => { setShowForm(false); setEditingMaterial(null) }}
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
                <Label className="text-xs">{t('thickness')}</Label>
                <Input type="number" step="0.1" {...register('thickness', { valueAsNumber: true })} className="h-8" />
              </div>
              <div>
                <Label className="text-xs">{t('color')}</Label>
                <Input type="color" {...register('color')} className="h-8 w-full" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">{t('description')}</Label>
                <Input {...register('description')} className="h-8" />
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="text-xs font-semibold mb-2">{t('cncSettings')}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('feedRate')}</Label>
                  <Input type="number" {...register('cncFeedRate', { valueAsNumber: true })} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t('plungeRate')}</Label>
                  <Input type="number" {...register('cncPlungeRate', { valueAsNumber: true })} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t('rpm')}</Label>
                  <Input type="number" {...register('cncRpm', { valueAsNumber: true })} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t('depthPerPass')}</Label>
                  <Input type="number" step="0.1" {...register('cncDepthPerPass', { valueAsNumber: true })} className="h-8" />
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="text-xs font-semibold mb-2">{t('laserSettings')}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('cutPower')}</Label>
                  <Input type="number" {...register('laserCutPower', { valueAsNumber: true })} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t('cutSpeed')}</Label>
                  <Input type="number" {...register('laserCutSpeed', { valueAsNumber: true })} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t('engravePower')}</Label>
                  <Input type="number" {...register('laserEngravePower', { valueAsNumber: true })} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t('engraveSpeed')}</Label>
                  <Input type="number" {...register('laserEngraveSpeed', { valueAsNumber: true })} className="h-8" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setEditingMaterial(null) }}>
                {tc('cancel')}
              </Button>
              <Button type="submit" size="sm">
                {tc('save')}
              </Button>
            </div>
          </form>
        ) : (
          /* Lista de materiales */
          <>
            <Tabs value={materialsModalTab} onValueChange={setMaterialsModalTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="wood">{t('wood')}</TabsTrigger>
                <TabsTrigger value="plastic">{t('plastic')}</TabsTrigger>
                <TabsTrigger value="metal">{t('metal')}</TabsTrigger>
              </TabsList>

              <TabsContent value={materialsModalTab}>
                <ScrollArea className="h-[400px]">
                  {categoryMaterials.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">{t('noMaterials')}</p>
                  ) : (
                    <div className="space-y-2">
                      {categoryMaterials.map((mat) => (
                        <div
                          key={mat.id}
                          className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-4 h-4 rounded-full border"
                                style={{ backgroundColor: mat.color }}
                              />
                              <span className="font-medium text-sm">{mat.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {mat.thickness}mm
                              </Badge>
                            </div>
                            {mat.description && (
                              <p className="text-xs text-muted-foreground mt-1">{mat.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              {mat.cnc && (
                                <span>CNC: F{mat.cnc.feedRate} RPM{mat.cnc.rpm}</span>
                              )}
                              {mat.laser && (
                                <span>Laser: {mat.laser.cutPower}%</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditForm(mat)}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDelete(mat)}
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
                {t('addMaterial')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
