import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useUpdateStore } from '@/stores/useUpdateStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RotateCw,
} from 'lucide-react'

export function UpdateModal() {
  const { t } = useTranslation('updater')
  const { activeModal, closeModal } = useAppStore()
  const { sending } = useSerialStore()
  const { status, info, progress, error, check, install, relaunch, dismiss, reset } =
    useUpdateStore()

  // Solo a pedido, o mientras hay una instalación en curso que el usuario ya
  // arrancó. El aviso de "hay versión nueva" lo da un toast, no este modal.
  const requested = activeModal === 'updater'
  const isOpen = requested || status === 'downloading' || status === 'ready'

  const handleClose = () => {
    if (status === 'downloading') return
    if (status === 'available') dismiss()
    else if (status === 'upToDate' || status === 'error') reset()
    if (requested) closeModal()
  }

  const title =
    status === 'ready'
      ? t('readyTitle')
      : status === 'upToDate'
        ? t('titleUpToDate')
        : status === 'error'
          ? t('titleError')
          : t('title')

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {status === 'ready' ? (
              <CheckCircle2 className="h-4 w-4 text-[oklch(0.55_0.13_160)]" />
            ) : status === 'error' ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : status === 'checking' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription>
            {status === 'checking' && t('checking')}
            {status === 'upToDate' && t('upToDate', { version: __APP_VERSION__ })}
            {status === 'error' && error}
            {(status === 'available' || status === 'downloading') &&
              info &&
              t('currentVersion', { version: info.currentVersion })}
            {status === 'ready' && info && t('readyBody', { version: info.version })}
          </DialogDescription>
        </DialogHeader>

        {/* Versión + notas */}
        {info && status !== 'ready' && (
          <div className="space-y-3">
            <p className="text-[15px] font-medium">
              {t('newVersion', { version: info.version })}
            </p>

            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">{t('releaseNotes')}</p>
              <ScrollArea className="max-h-40 rounded-[6px] border p-3">
                <p className="text-[12px] whitespace-pre-wrap text-muted-foreground">
                  {info.notes?.trim() || t('noNotes')}
                </p>
              </ScrollArea>
            </div>
          </div>
        )}

        {/* Progreso de descarga */}
        {status === 'downloading' && (
          <div className="space-y-1.5" role="status" aria-live="polite">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{progress < 0 ? t('downloadingUnknownSize') : t('downloading')}</span>
              {progress >= 0 && (
                <span className="font-mono">{Math.round(progress * 100)}%</span>
              )}
            </div>
            <Progress
              value={progress < 0 ? 100 : progress * 100}
              className={progress < 0 ? 'h-1.5 animate-pulse' : 'h-1.5'}
            />
          </div>
        )}

        {/* Reiniciar con un job en vuelo corta el envío a la máquina. */}
        {status === 'ready' && sending && (
          <div className="flex gap-2 rounded-[6px] border border-[oklch(0.75_0.15_80)]/40 bg-[oklch(0.75_0.15_80)]/10 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[oklch(0.55_0.13_80)]" />
            <p className="text-[12px]">{t('machineBusyWarning')}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {status === 'available' && (
            <>
              <Button variant="ghost" size="sm" onClick={handleClose}>
                {t('later')}
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => install()}>
                <Download className="h-4 w-4" />
                {t('install')}
              </Button>
            </>
          )}

          {status === 'ready' && (
            <>
              <Button variant="ghost" size="sm" onClick={handleClose}>
                {t('later')}
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => relaunch()}>
                <RotateCw className="h-4 w-4" />
                {t('relaunch')}
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <Button variant="ghost" size="sm" onClick={handleClose}>
                {t('close')}
              </Button>
              <Button size="sm" onClick={() => check()}>
                {t('retry')}
              </Button>
            </>
          )}

          {(status === 'upToDate' || status === 'checking') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={status === 'checking'}
            >
              {t('close')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
