import { useMemo, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { extractVariables, parseCSV, previewMerge } from '@/lib/variable-text'
import type { MergeRecord } from '@/lib/variable-text'
import type { Font } from '@/lib/text-to-path'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Upload } from 'lucide-react'

// Carga diferida: opentype.js pesa, no se trae hasta abrir el modal
let textToPathModule: typeof import('@/lib/text-to-path') | null = null
async function getModule() {
  if (!textToPathModule) textToPathModule = await import('@/lib/text-to-path')
  return textToPathModule
}

export function VariableTextModal() {
  const { t } = useTranslation('canvas')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const cm = useCanvasManager()
  const csvInputRef = useRef<HTMLInputElement>(null)

  const isOpen = activeModal === 'variableText'

  const [template, setTemplate] = useState('{{name}} - {{index}}')
  const [csvText, setCsvText] = useState('')
  const [csvName, setCsvName] = useState('')
  const [fontUrl, setFontUrl] = useState('/fonts/Roboto.ttf')
  const [fontSize, setFontSize] = useState(10)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [fonts, setFonts] = useState<{ name: string; url: string }[]>([])
  const [loadedFont, setLoadedFont] = useState<Font | null>(null)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    getModule().then((mod) => setFonts(mod.getAvailableFonts()))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !fontUrl) return
    setLoading(true)
    getModule().then((mod) =>
      mod
        .loadFont(fontUrl)
        .then((font) => {
          setLoadedFont(font)
          setLoading(false)
        })
        .catch(() => setLoading(false)),
    )
  }, [isOpen, fontUrl])

  const records: MergeRecord[] = useMemo(() => (csvText ? parseCSV(csvText) : []), [csvText])

  const templateVars = useMemo(() => extractVariables(template), [template])

  // Variables que el CSV no aporta (index/date/time las resuelve mergeText)
  const missingVars = useMemo(() => {
    const builtin = new Set(['index', 'date', 'time'])
    const available = new Set(records.length > 0 ? Object.keys(records[0]) : [])
    return templateVars.filter((v) => !builtin.has(v.toLowerCase()) && !available.has(v))
  }, [templateVars, records])

  const merged = useMemo(
    () => (records.length > 0 ? previewMerge(template, records) : []),
    [template, records],
  )

  const handlePickCSV = () => csvInputRef.current?.click()

  const handleCSVChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvText(await file.text())
    setCsvName(file.name)
    e.target.value = ''
  }

  const handleAdd = async () => {
    if (!loadedFont || merged.length === 0) return
    setAdding(true)
    try {
      const mod = await getModule()
      let added = 0
      for (const text of merged) {
        if (!text.trim()) continue
        const d = mod.textToSvgPath(text, loadedFont, fontSize, letterSpacing)
        if (!d) continue
        cm.addTextPath(d, text, fontUrl, fontSize, letterSpacing)
        added++
      }
      addConsoleLine(`Texto variable: ${added} elemento(s) agregado(s) desde ${csvName || 'CSV'}`)
      closeModal()
    } finally {
      setAdding(false)
    }
  }

  if (!isOpen) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('variableText.title') || 'Texto variable (CSV)'}</DialogTitle>
        </DialogHeader>

        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleCSVChange}
        />

        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">
            {t('variableText.hint') ||
              'Genera una copia del texto por cada fila del CSV. Usa {{columna}} en la plantilla; {{index}}, {{date}} y {{time}} son automáticas.'}
          </p>

          <div>
            <Label className="text-xs">{t('variableText.template') || 'Plantilla'}</Label>
            <Input
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="mt-1 font-mono"
              placeholder="{{name}} - {{serial}}"
            />
          </div>

          <div>
            <Label className="text-xs">CSV</Label>
            <div className="flex items-center gap-2 mt-1">
              <Button variant="outline" size="sm" onClick={handlePickCSV}>
                <Upload className="h-4 w-4 mr-2" />
                {t('variableText.loadCsv') || 'Cargar CSV'}
              </Button>
              <span className="text-xs text-muted-foreground truncate">
                {csvName
                  ? `${csvName} · ${records.length} ${t('variableText.rows') || 'filas'}`
                  : t('variableText.noCsv') || 'Sin archivo'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">{t('fontSelect')}</Label>
              <Select value={fontUrl} onValueChange={setFontUrl}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fonts.map((f) => (
                    <SelectItem key={f.url} value={f.url}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                className="mt-3"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('letterSpacing')}</Label>
              <span className="text-xs text-muted-foreground font-mono">
                {letterSpacing.toFixed(1)} mm
              </span>
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

          {missingVars.length > 0 && (
            <p className="text-xs text-destructive">
              {t('variableText.missingVars') || 'Sin columna en el CSV:'} {missingVars.join(', ')}
            </p>
          )}

          <div className="border rounded-md p-3 text-xs space-y-1 max-h-40 overflow-y-auto">
            {merged.length === 0 ? (
              <p className="text-muted-foreground">
                {t('variableText.previewEmpty') || 'Carga un CSV para ver la vista previa'}
              </p>
            ) : (
              merged.slice(0, 20).map((line, i) => (
                <p key={i} className="font-mono truncate">
                  {i + 1}. {line}
                </p>
              ))
            )}
            {merged.length > 20 && (
              <p className="text-muted-foreground italic">
                +{merged.length - 20} {t('variableText.more') || 'más'}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleAdd}
            disabled={merged.length === 0 || !loadedFont || loading || adding}
            className="w-full"
          >
            {adding
              ? t('variableText.adding') || 'Agregando...'
              : `${t('addToCanvas')} (${merged.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
