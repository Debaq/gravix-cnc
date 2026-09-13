import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Loader2, Check, RefreshCw } from 'lucide-react'
import { tauriInvoke, isTauri } from '@/lib/tauri'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import type { DitheringMode, RasterData } from '@/lib/types'

export function ImageWizardModal() {
  const { t } = useTranslation('imageWizard')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const { globalConfig, setGlobalConfig, rasterData, setRasterData, workArea } = useCanvasStore()
  const [processing, setProcessing] = useState(false)
  const hasAutoProcessed = useRef(false)

  const isOpen = activeModal === 'imageWizard'

  const [dpi, setDpi] = useState(globalConfig.rasterDpi || 254)
  const [dithering, setDithering] = useState<DitheringMode>(globalConfig.rasterDithering || 'floydSteinberg')
  const [threshold, setThreshold] = useState(globalConfig.rasterThreshold ?? 128)
  const [invert, setInvert] = useState(globalConfig.rasterInvert ?? false)

  const doProcess = async () => {
    const path = sessionStorage.getItem('rasterImagePath')
    if (!path || !isTauri()) return

    setProcessing(true)
    try {
      const result = await tauriInvoke<RasterData>('process_image_for_laser', {
        path,
        widthMm: workArea.width,
        heightMm: workArea.height,
        dpi,
        dithering,
        threshold,
        invert,
      })
      setRasterData(result)
      setGlobalConfig({
        rasterDpi: dpi,
        rasterDithering: dithering,
        rasterThreshold: threshold,
        rasterInvert: invert,
      })
      addConsoleLine(`Imagen procesada: ${result.width}x${result.height} px`)
    } catch (err) {
      addConsoleLine(`Error procesando imagen: ${err}`)
    } finally {
      setProcessing(false)
    }
  }

  // Auto-procesar al abrir el wizard
  useEffect(() => {
    if (isOpen && !hasAutoProcessed.current) {
      hasAutoProcessed.current = true
      doProcess()
    }
    if (!isOpen) {
      hasAutoProcessed.current = false
    }
  }, [isOpen])

  const canvasManager = useCanvasManager()

  const handleAccept = async () => {
    if (rasterData) {
      const imagePath = sessionStorage.getItem('rasterImagePath') || 'Raster'
      const name = imagePath.split('/').pop()?.split('\\').pop()?.replace(/\.[^.]+$/, '') || 'Raster'
      await canvasManager.addRasterToCanvas(rasterData.preview_base64, name)
      addConsoleLine(`Imagen lista: ${rasterData.width}x${rasterData.height} px — genera G-code desde el panel G-Code`)
    }
    closeModal()
  }

  const showThreshold = dithering !== 'ordered' && dithering !== 'grayscale'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Preview */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold">{t('preview')}</Label>
            {processing && (
              <div className="flex items-center justify-center py-12 border rounded bg-muted/30">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">{t('processing')}</span>
                </div>
              </div>
            )}
            {!processing && rasterData && (
              <>
                <div className="border rounded p-2 bg-muted/30">
                  <img
                    src={rasterData.preview_base64}
                    alt="Preview"
                    className="w-full h-auto max-h-48 object-contain mx-auto"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-center">
                  {rasterData.width}x{rasterData.height} px — {(rasterData.width * rasterData.pixel_size_mm).toFixed(1)}x{(rasterData.height * rasterData.pixel_size_mm).toFixed(1)} mm
                </p>
              </>
            )}
            {!processing && !rasterData && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground border rounded">
                {t('errorNoPreview')}
              </div>
            )}
          </div>

          <Separator />

          {/* Settings */}
          <div className="space-y-3">
            <Label className="text-xs font-semibold">{t('settings')}</Label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('dpi')}</Label>
                <Input
                  type="number"
                  value={dpi}
                  onChange={(e) => setDpi(parseInt(e.target.value) || 254)}
                  className="mt-1"
                  min={50}
                  max={600}
                  disabled={processing}
                />
              </div>
              <div>
                <Label className="text-xs">{t('dithering')}</Label>
                <Select
                  value={dithering}
                  onValueChange={(v) => setDithering(v as DitheringMode)}
                  disabled={processing}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="threshold">{t('modes.threshold')}</SelectItem>
                    <SelectItem value="floydSteinberg">{t('modes.floydSteinberg')}</SelectItem>
                    <SelectItem value="ordered">{t('modes.ordered')}</SelectItem>
                    <SelectItem value="atkinson">{t('modes.atkinson')}</SelectItem>
                    <SelectItem value="jarvis">{t('modes.jarvis')}</SelectItem>
                    <SelectItem value="stucki">{t('modes.stucki')}</SelectItem>
                    <SelectItem value="burkes">{t('modes.burkes')}</SelectItem>
                    <SelectItem value="sierra">{t('modes.sierra')}</SelectItem>
                    <SelectItem value="grayscale">{t('modes.grayscale')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {showThreshold && (
              <div>
                <Label className="text-xs">{t('threshold')}</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="range"
                    min={0}
                    max={255}
                    step={1}
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value))}
                    className="flex-1 h-8"
                    disabled={processing}
                  />
                  <span className="text-xs font-mono w-8 text-right">{threshold}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('invert')}</Label>
              <Switch checked={invert} onCheckedChange={setInvert} disabled={processing} />
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={doProcess}
              disabled={processing}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('reprocess')}
            </Button>
            <Button
              className="flex-1"
              onClick={handleAccept}
              disabled={!rasterData || processing}
            >
              <Check className="w-4 h-4 mr-2" />
              {t('accept')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
