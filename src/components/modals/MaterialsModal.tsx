import { useTranslation } from 'react-i18next'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useAppStore } from '@/stores/useAppStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Layers, Edit, Trash2 } from 'lucide-react'

export function MaterialsModal() {
  const { t } = useTranslation('materials')
  const { activeModal, closeModal } = useAppStore()
  const {
    materialsModalTab,
    setMaterialsModalTab,
    getMaterialsByCategory,
  } = useLibraryStore()

  const isOpen = activeModal === 'materials'
  const materials = getMaterialsByCategory(materialsModalTab)

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

        <Tabs value={materialsModalTab} onValueChange={setMaterialsModalTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="wood">{t('wood')}</TabsTrigger>
            <TabsTrigger value="plastic">{t('plastic')}</TabsTrigger>
            <TabsTrigger value="metal">{t('metal')}</TabsTrigger>
          </TabsList>

          <TabsContent value={materialsModalTab}>
            <ScrollArea className="h-[400px]">
              {materials.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{t('noMaterials')}</p>
              ) : (
                <div className="space-y-2">
                  {materials.map((mat) => (
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
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
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
          <Button variant="outline" size="sm">
            {t('addMaterial')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
