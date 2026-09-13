import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { HelpCircle, Keyboard, Mouse } from 'lucide-react'

export function HelpModal() {
  const { t } = useTranslation('help')
  const { activeModal, closeModal } = useAppStore()

  const isOpen = activeModal === 'help'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[400px]">
          <div className="space-y-4 pr-4">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Mouse className="h-4 w-4" />
                {t('canvasTitle')}
              </h3>
              <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                <li>{t('scrollZoom')}</li>
                <li>{t('clickDrag')}</li>
                <li>{t('middleClickDrag')}</li>
                <li>{t('shiftClickDrag')}</li>
              </ul>
            </div>

            <Separator />

            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Keyboard className="h-4 w-4" />
                {t('shortcutsTitle')}
              </h3>
              <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                <li>{t('scTools')}</li>
                <li>{t('scDraw')}</li>
                <li>{t('scNodes')}</li>
                <li>{t('scSnap')}</li>
                <li>{t('scOrtho')}</li>
                <li>{t('scZoom')}</li>
                <li>{t('scEdit')}</li>
              </ul>
            </div>

            <Separator />

            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Keyboard className="h-4 w-4" />
                {t('workspacesTitle')}
              </h3>
              <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                <li><strong>{t('cad')}:</strong> {t('cadDesc')}</li>
                <li><strong>{t('cam')}:</strong> {t('camDesc')}</li>
                <li><strong>{t('cnc')}:</strong> {t('cncDesc')}</li>
              </ul>
            </div>

            <Separator />

            <div>
              <h3 className="font-semibold text-sm">{t('workflowTitle')}</h3>
              <ol className="text-sm text-muted-foreground mt-1 space-y-1 list-decimal list-inside">
                <li>{t('step1')}</li>
                <li>{t('step2')}</li>
                <li>{t('step3')}</li>
                <li>{t('step4')}</li>
                <li>{t('step5')}</li>
                <li>{t('step6')}</li>
              </ol>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
