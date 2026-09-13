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
import { Loader2, Check, AlertTriangle } from 'lucide-react'
import { tauriInvoke, isTauri } from '@/lib/tauri'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import type { TraceMode, TraceResult } from '@/lib/types'

// Por encima de esto el resultado se vuelve pesado de editar y de cortar
const HEAVY_POINT_COUNT = 4000

export function TraceImageModal() {
  const { t } = useTranslation('imageWizard')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const { workArea } = useCanvasStore()
  const canvasManager = useCanvasManager()

  const isOpen = activeModal === 'traceImage'

  const [mode, setMode] = useState<TraceMode>('outline')
  const [threshold, setThreshold] = useState(128)
  const [invert, setInvert] = useState(false)
  const [minArea, setMinArea] = useState(16)
  // Un bitmap no trae tamaño fisico: por defecto se ajusta al area util, y de
  // ahi el usuario lo baja al tamaño real de la pieza
  const [outputWidth, setOutputWidth] = useState(workArea.width)
  const [simplify, setSimplify] = useState(1)
  const [smooth, setSmooth] = useState(0.6)

  const [result, setResult] = useState<TraceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  // Igual que en el wizard raster: una corrida a la vez, y la que llega
  // mientras se traza queda pendiente con los valores nuevos
  const runningRef = useRef(false)
  const pendingRef = useRef(false)
  const firstRunRef = useRef(false)
  const doTraceRef = useRef<() => void>(() => {})

  const doTrace = useCallback(async () => {
    const path = sessionStorage.getItem('traceImagePath')
    if (!path || !isTauri()) return

    if (runningRef.current) {
      pendingRef.current = true
      return
    }
    runningRef.current = true
    setProcessing(true)
    try {
      const traced = await tauriInvoke<TraceResult>('trace_image_to_svg', {
        path,
        widthMm: Math.min(outputWidth, workArea.width),
        heightMm: workArea.height,
        options: {
          mode,
          threshold,
          invert,
          minArea,
          simplify,
          smooth,
          maxResolution: 1200,
        },
      })
      setResult(traced)
      setError(null)
    } catch (err) {
      setResult(null)
      setError(String(err))
    } finally {
      runningRef.current = false
      setProcessing(false)
      if (pendingRef.current) {
        pendingRef.current = false
        doTraceRef.current()
      }
    }
  }, [mode, threshold, invert, minArea, simplify, smooth, outputWidth, workArea.width, workArea.height])

  doTraceRef.current = doTrace

  useEffect(() => {
    if (!isOpen) {
      firstRunRef.current = false
      setResult(null)
      setError(null)
      return
    }
    if (!firstRunRef.current) {
      firstRunRef.current = true
      setOutputWidth(workArea.width)
      doTrace()
      return
    }
    const id = setTimeout(doTrace, 350)
    return () => clearTimeout(id)
  }, [isOpen, doTrace])

  const handleAccept = async () => {
    if (!result) return
    const imagePath = sessionStorage.getItem('traceImagePath') || 'Trazado'
    const name =
      imagePath.split('/').pop()?.split('\\').pop()?.replace(/\.[^.]+$/, '') || 'Trazado'
    await canvasManager.loadSVGString(result.svg, name)
    addConsoleLine(
      `Vectorizado: ${result.path_count} contornos, ${result.hole_count} agujeros, ${result.point_count} nodos`,
    )
    closeModal()
  }

  const heavy = (result?.point_count ?? 0) > HEAVY_POINT_COUNT
  const isCenterline = mode === 'centerline'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('trace.title')}</DialogTitle>
          <DialogDescription>{t('trace.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Preview */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold">{t('preview')}</Label>
            {result && (
              <>
                <div className="relative border rounded p-2 bg-white">
                  <img
                    src={result.preview_base64}
                    alt="Trace preview"
                    className={`w-full h-auto max-h-48 object-contain mx-auto transition-opacity ${processing ? 'opacity-40' : ''}`}
                  />
                  {processing && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground text-center">
                  {t('trace.stats', {
                    paths: result.path_count,
                    holes: result.hole_count,
                    points: result.point_count,
                  })}{' '}
                  — {result.width_mm.toFixed(1)}x{result.height_mm.toFixed(1)} mm
                </p>
                {heavy && (
                  <p className="text-[10px] text-amber-500 flex items-center justify-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {t('trace.heavy')}
                  </p>
                )}
              </>
            )}
            {!result && (
              <div className="flex items-center justify-center py-12 border rounded bg-muted/30 px-3 text-center">
                {processing ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">{t('trace.tracing')}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {error || t('errorNoPreview')}
                  </span>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Settings */}
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('trace.mode')}</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as TraceMode)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outline">{t('trace.modes.outline')}</SelectItem>
                  <SelectItem value="silhouette">{t('trace.modes.silhouette')}</SelectItem>
                  <SelectItem value="centerline">{t('trace.modes.centerline')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t(`trace.modes.${mode}Hint`)}
              </p>
            </div>

            <TraceSlider
              label={t('threshold')}
              value={threshold}
              min={1}
              max={254}
              step={1}
              onChange={setThreshold}
            />
            <TraceSlider
              label={t('trace.simplify')}
              value={simplify}
              min={0}
              max={5}
              step={0.1}
              decimals={1}
              onChange={setSimplify}
            />
            <TraceSlider
              label={t('trace.smooth')}
              value={smooth}
              min={0}
              max={1}
              step={0.05}
              decimals={2}
              onChange={setSmooth}
            />
            <div>
              <Label className="text-xs">{t('trace.outputWidth')}</Label>
              <Input
                type="number"
                value={outputWidth}
                min={1}
                max={workArea.width}
                onChange={(e) =>
                  setOutputWidth(Math.max(1, parseFloat(e.target.value) || 1))
                }
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs">
                {isCenterline ? t('trace.minBranch') : t('trace.minArea')}
              </Label>
              <Input
                type="number"
                value={isCenterline ? Math.round(Math.sqrt(minArea)) : minArea}
                min={0}
                max={100000}
                onChange={(e) => {
                  const v = Math.max(0, parseFloat(e.target.value) || 0)
                  // El backend recibe siempre area; en eje medio la usa como
                  // largo de rama vía su raiz, asi que el control muestra px
                  setMinArea(isCenterline ? Math.round(v * v) : Math.round(v))
                }}
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {isCenterline ? t('trace.minBranchHint') : t('trace.minAreaHint')}
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('invert')}</Label>
              <Switch checked={invert} onCheckedChange={setInvert} />
            </div>
          </div>

          <Separator />

          <Button className="w-full" onClick={handleAccept} disabled={!result || processing}>
            <Check className="w-4 h-4 mr-2" />
            {t('trace.accept')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface TraceSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  onChange: (v: number) => void
}

function TraceSlider({ label, value, min, max, step, decimals = 0, onChange }: TraceSliderProps) {
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
