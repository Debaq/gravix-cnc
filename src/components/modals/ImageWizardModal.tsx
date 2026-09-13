import { useState, useEffect, useRef, useCallback } from 'react'
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
import { Loader2, Check, RefreshCw, RotateCcw } from 'lucide-react'
import { tauriInvoke, isTauri } from '@/lib/tauri'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import type { DitheringMode, RasterData } from '@/lib/types'

const FILTER_DEFAULTS = { brightness: 0, contrast: 0, gamma: 1, sharpen: 0 }

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
  const [brightness, setBrightness] = useState(globalConfig.rasterBrightness ?? FILTER_DEFAULTS.brightness)
  const [contrast, setContrast] = useState(globalConfig.rasterContrast ?? FILTER_DEFAULTS.contrast)
  const [gamma, setGamma] = useState(globalConfig.rasterGamma ?? FILTER_DEFAULTS.gamma)
  const [sharpen, setSharpen] = useState(globalConfig.rasterSharpen ?? FILTER_DEFAULTS.sharpen)

  // Una corrida a la vez: si llega otra mientras procesa, queda pendiente y se
  // dispara al terminar con los valores nuevos (los sliders emiten en rafaga)
  const runningRef = useRef(false)
  const pendingRef = useRef(false)
  const doProcessRef = useRef<() => void>(() => {})

  const doProcess = useCallback(async () => {
    const path = sessionStorage.getItem('rasterImagePath')
    if (!path || !isTauri()) return

    if (runningRef.current) {
      pendingRef.current = true
      return
    }
    runningRef.current = true
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
        filters: { brightness, contrast, gamma, sharpen },
      })
      setRasterData(result)
      setGlobalConfig({
        rasterDpi: dpi,
        rasterDithering: dithering,
        rasterThreshold: threshold,
        rasterInvert: invert,
        rasterBrightness: brightness,
        rasterContrast: contrast,
        rasterGamma: gamma,
        rasterSharpen: sharpen,
      })
      addConsoleLine(`Imagen procesada: ${result.width}x${result.height} px`)
    } catch (err) {
      addConsoleLine(`Error procesando imagen: ${err}`)
    } finally {
      runningRef.current = false
      setProcessing(false)
      if (pendingRef.current) {
        pendingRef.current = false
        doProcessRef.current()
      }
    }
  }, [dpi, dithering, threshold, invert, brightness, contrast, gamma, sharpen, workArea.width, workArea.height])

  doProcessRef.current = doProcess

  // Procesa al abrir y re-procesa solo con los ajustes; los sliders se debouncean
  // para no lanzar un pase de dithering por cada pixel de arrastre
  useEffect(() => {
    if (!isOpen) {
      hasAutoProcessed.current = false
      return
    }
    if (!hasAutoProcessed.current) {
      hasAutoProcessed.current = true
      doProcess()
      return
    }
    const id = setTimeout(doProcess, 350)
    return () => clearTimeout(id)
  }, [isOpen, doProcess])

  const resetFilters = () => {
    setBrightness(FILTER_DEFAULTS.brightness)
    setContrast(FILTER_DEFAULTS.contrast)
    setGamma(FILTER_DEFAULTS.gamma)
    setSharpen(FILTER_DEFAULTS.sharpen)
  }

  const filtersDirty =
    brightness !== FILTER_DEFAULTS.brightness ||
    contrast !== FILTER_DEFAULTS.contrast ||
    gamma !== FILTER_DEFAULTS.gamma ||
    sharpen !== FILTER_DEFAULTS.sharpen

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
            {rasterData && (
              <>
                {/* La imagen previa se queda en pantalla mientras recalcula: con
                    los sliders en vivo, cambiarla por el spinner es un parpadeo */}
                <div className="relative border rounded p-2 bg-muted/30">
                  <img
                    src={rasterData.preview_base64}
                    alt="Preview"
                    className={`w-full h-auto max-h-48 object-contain mx-auto transition-opacity ${processing ? 'opacity-40' : ''}`}
                    style={{ imageRendering: 'pixelated' }}
                  />
                  {processing && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground text-center">
                  {rasterData.width}x{rasterData.height} px — {(rasterData.width * rasterData.pixel_size_mm).toFixed(1)}x{(rasterData.height * rasterData.pixel_size_mm).toFixed(1)} mm
                </p>
              </>
            )}
            {!rasterData && (
              <div className="flex items-center justify-center py-12 border rounded bg-muted/30">
                {processing ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">{t('processing')}</span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">{t('errorNoPreview')}</span>
                )}
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

          {/* Filtros de tono — se aplican antes del dithering */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">{t('filters')}</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={resetFilters}
                disabled={!filtersDirty}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                {t('resetFilters')}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">{t('filtersHint')}</p>

            <FilterSlider
              label={t('brightness')}
              value={brightness}
              min={-100}
              max={100}
              step={1}
              onChange={setBrightness}
            />
            <FilterSlider
              label={t('contrast')}
              value={contrast}
              min={-100}
              max={100}
              step={1}
              onChange={setContrast}
            />
            <FilterSlider
              label={t('gamma')}
              value={gamma}
              min={0.1}
              max={3}
              step={0.05}
              decimals={2}
              onChange={setGamma}
            />
            <FilterSlider
              label={t('sharpen')}
              value={sharpen}
              min={0}
              max={100}
              step={1}
              onChange={setSharpen}
            />
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

interface FilterSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  onChange: (v: number) => void
}

function FilterSlider({ label, value, min, max, step, decimals = 0, onChange }: FilterSliderProps) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2 mt-1">
        <Input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 h-8"
        />
        <span className="text-xs font-mono w-10 text-right">{value.toFixed(decimals)}</span>
      </div>
    </div>
  )
}
