import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useLicense } from '@/hooks/useLicense'
import { getTrialDaysLeft, isTrialActive } from '@/lib/trial'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { KeyRound, ExternalLink } from 'lucide-react'

export function LicenseModal() {
  const { t } = useTranslation('license')
  const { activeModal, closeModal } = useAppStore()
  const { status, activate } = useLicense()
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const isOpen = activeModal === 'license'
  const daysLeft = getTrialDaysLeft()
  const trialActive = isTrialActive()

  const handleActivate = async () => {
    if (!token.trim()) return
    setLoading(true)
    setError(null)
    setSuccess(false)

    const result = await activate(token.trim())
    setLoading(false)

    if (result.is_valid) {
      setSuccess(true)
      setToken('')
      setTimeout(() => closeModal(), 1500)
    } else {
      setError(result.error || t('invalidKey'))
    }
  }

  const handleBuy = () => {
    window.open('https://gravix.app/buy', '_blank')
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {status?.is_valid
              ? t('licensedTo', { email: status.email })
              : trialActive
                ? t('trialActive', { days: daysLeft })
                : t('trialEnded')}
          </DialogDescription>
        </DialogHeader>

        {!status?.is_valid && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('enterKey')}</label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('placeholder')}
                className="font-mono text-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            {success && (
              <p className="text-sm text-green-500">{t('success')}</p>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleActivate}
                disabled={loading || !token.trim()}
                className="flex-1"
              >
                {loading ? t('activating') : t('activate')}
              </Button>
              <Button
                variant="outline"
                onClick={handleBuy}
                className="flex-1 gap-1"
              >
                <ExternalLink className="h-4 w-4" />
                {t('buy')} — $49 USD
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
