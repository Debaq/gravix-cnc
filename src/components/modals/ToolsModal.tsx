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
import { Wrench, Edit, Trash2 } from 'lucide-react'

export function ToolsModal() {
  const { t } = useTranslation('tools')
  const { activeModal, closeModal } = useAppStore()
  const {
    toolsModalTab,
    setToolsModalTab,
    getToolsByCategory,
  } = useLibraryStore()

  const isOpen = activeModal === 'tools'
  const tools = getToolsByCategory(toolsModalTab)

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

        <Tabs value={toolsModalTab} onValueChange={setToolsModalTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="cnc">{t('cnc')}</TabsTrigger>
            <TabsTrigger value="plotter">{t('plotter')}</TabsTrigger>
            <TabsTrigger value="pencil">{t('pencil')}</TabsTrigger>
          </TabsList>

          <TabsContent value={toolsModalTab}>
            <ScrollArea className="h-[400px]">
              {tools.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{t('noTools')}</p>
              ) : (
                <div className="space-y-2">
                  {tools.map((tool) => (
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
            {t('addTool')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
