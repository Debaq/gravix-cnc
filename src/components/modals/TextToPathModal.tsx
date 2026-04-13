import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import type { Font } from '@/lib/text-to-path'

// Lazy imports to avoid loading opentype.js until needed
let textToPathModule: typeof import('@/lib/text-to-path') | null = null

async function getModule() {
  if (!textToPathModule) {
    textToPathModule = await import('@/lib/text-to-path')
  }
  return textToPathModule
}

export function TextToPathModal() {
  const { t } = useTranslation('canvas')
  const { activeModal, closeModal } = useAppStore()
  const cm = useCanvasManager()

  const isOpen = activeModal === 'textToPath'

  const [text, setText] = useState('CNC')
  const [fontUrl, setFontUrl] = useState('/fonts/Roboto.ttf')
  const [fontSize, setFontSize] = useState(15)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [fonts, setFonts] = useState<{ name: string; url: string }[]>([])
  const [loadedFont, setLoadedFont] = useState<Font | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewSvg, setPreviewSvg] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Load available fonts on open
  useEffect(() => {
    if (!isOpen) return
    getModule().then(mod => {
      setFonts(mod.getAvailableFonts())
    })
  }, [isOpen])

  // Load selected font
  useEffect(() => {
    if (!isOpen || !fontUrl) return
    setLoading(true)
    getModule().then(mod =>
      mod.loadFont(fontUrl).then(font => {
        setLoadedFont(font)
        setLoading(false)
      }).catch(() => setLoading(false))
    )
  }, [isOpen, fontUrl])

  // Update preview when params change
  useEffect(() => {
    if (!loadedFont || !text.trim()) {
      setPreviewSvg('')
      return
    }
    getModule().then(mod => {
      const d = mod.textToSvgPath(text, loadedFont, fontSize, letterSpacing)
      setPreviewSvg(d)
    })
  }, [loadedFont, text, fontSize, letterSpacing])

  // Render preview to canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !previewSvg) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const path = new Path2D(previewSvg)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Fit to canvas
    ctx.save()
    // Measure by drawing off-screen — use a simple scale approach
    const scale = Math.min(canvas.width / (fontSize * 3.78 * Math.max(text.length, 1) * 0.7), canvas.height / (fontSize * 3.78 * 1.4), 1)
    const offsetX = 10
    const offsetY = canvas.height / 2
    ctx.translate(offsetX, offsetY)
    ctx.scale(scale, scale)
    ctx.fillStyle = '#333'
    ctx.fill(path)
    ctx.restore()
  }, [previewSvg, text, fontSize])

  const handleAdd = () => {
    if (!previewSvg || !text.trim()) return
    cm.addTextPath(previewSvg, text, fontUrl, fontSize, letterSpacing)
    closeModal()
  }

  if (!isOpen) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('textToPath')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Text input */}
          <div>
            <Label className="text-xs">{t('textInput')}</Label>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ABC 123"
              className="mt-1 font-mono"
              autoFocus
            />
          </div>

          {/* Font selector */}
          <div>
            <Label className="text-xs">{t('fontSelect')}</Label>
            <Select value={fontUrl} onValueChange={setFontUrl}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fonts.map(f => (
                  <SelectItem key={f.url} value={f.url}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Font size */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('textSize')}</Label>
              <span className="text-xs text-muted-foreground font-mono">{fontSize} mm</span>
            </div>
            <Slider
              value={[fontSize]}
              onValueChange={([v]) => setFontSize(v)}
              min={2}
              max={100}
              step={1}
              className="mt-1"
            />
          </div>

          {/* Letter spacing */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('letterSpacing')}</Label>
              <span className="text-xs text-muted-foreground font-mono">{letterSpacing.toFixed(1)} mm</span>
            </div>
            <Slider
              value={[letterSpacing]}
              onValueChange={([v]) => setLetterSpacing(v)}
              min={-2}
              max={10}
              step={0.1}
              className="mt-1"
            />
          </div>

          {/* Preview */}
          <div className="border rounded-md bg-white overflow-hidden">
            <canvas
              ref={canvasRef}
              width={440}
              height={80}
              className="w-full"
            />
          </div>

          {loading && (
            <p className="text-xs text-muted-foreground">{t('loadingFont')}</p>
          )}

          {/* Add button */}
          <Button
            onClick={handleAdd}
            disabled={!previewSvg || !text.trim() || loading}
            className="w-full"
          >
            {t('addToCanvas')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
