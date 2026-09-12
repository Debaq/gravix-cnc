import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useToastStore, type ToastVariant } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

const ICON: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

// Tokens semánticos de index.css — nunca colores hardcodeados.
const STYLE: Record<ToastVariant, string> = {
  success: 'bg-success-bg text-success-fg',
  error: 'bg-error-bg text-error-fg',
  warning: 'bg-warning-bg text-warning-fg',
  info: 'bg-info-bg text-info-fg',
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div
      // Por encima de dialogs y tooltips (z-50): un error de guardado tiene que
      // verse aunque el modal que lo disparó siga abierto.
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-32px)] pointer-events-none"
      role="region"
      aria-label="Notificaciones"
    >
      {toasts.map((t) => {
        const Icon = ICON[t.variant]
        return (
          <div
            key={t.id}
            role={t.variant === 'error' ? 'alert' : 'status'}
            aria-live={t.variant === 'error' ? 'assertive' : 'polite'}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-[10px] border-[0.5px] px-3 py-2.5 animate-toast-in',
              STYLE[t.variant],
            )}
          >
            <Icon className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium leading-snug">{t.message}</p>
              {t.detail && (
                <p className="text-[12px] opacity-80 mt-0.5 break-words font-mono leading-snug">
                  {t.detail}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar notificacion"
              className="shrink-0 rounded-[4px] p-0.5 opacity-60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring transition-opacity"
            >
              <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
