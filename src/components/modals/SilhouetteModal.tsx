import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useCAMStore } from '@/stores/useCAMStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { applyCAMPlan } from '@/lib/cam-jobs'
import { tauriInvoke, tauriListen } from '@/lib/tauri'
import { saveTextFile } from '@/lib/save-file'
import { toast } from '@/lib/toast'
import {
  buildGpgl,
  cuttingArea,
  toMediaCoords,
  DEFAULT_SILHOUETTE_SETTINGS,
  SILHOUETTE_MATS,
  type SilhouetteCutSettings,
  type SilhouetteMat,
  type SilhouetteTool,
} from '@/lib/gpgl'
import type { SilhouetteDevice } from '@/lib/generated/SilhouetteDevice'
import type { SilhouetteTarget } from '@/lib/generated/SilhouetteTarget'
import type { SilhouetteStatus } from '@/lib/generated/SilhouetteStatus'
import type { SilhouetteBleCutter } from '@/lib/generated/SilhouetteBleCutter'
import type { SilhouetteProgress } from '@/lib/generated/SilhouetteProgress'
import type { SilhouetteResult } from '@/lib/generated/SilhouetteResult'
import type { GCodePath } from '@/lib/types'
import { regmarkLayout } from '@/lib/print-cut'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Bluetooth, Download, Loader2, RefreshCw, Scissors, Square, Usb, AlertCircle, AlertTriangle } from 'lucide-react'

type ConnKind = SilhouetteTarget['kind']

const SETTINGS_KEY = 'gravix_silhouette_settings'
const TARGET_KEY = 'gravix_silhouette_target'

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Sin almacenamiento solo se pierde la preferencia
  }
}

const PHASES: Record<string, string> = {
  connecting: 'Conectando',
  'waiting-media': 'Carga el material en la cortadora',
  sending: 'Cortando',
  registering: 'Buscando las marcas de registro',
  finishing: 'Terminando',
}

const STATES: Record<SilhouetteStatus['state'], string> = {
  ready: 'Lista',
  moving: 'En movimiento',
  unloaded: 'Sin material',
  unknown: 'Estado desconocido',
}

function sameTarget(a: SilhouetteTarget | null, b: SilhouetteTarget | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function SilhouetteModal() {
  const { activeModal, closeModal, addConsoleLine, projectName } = useAppStore()
  const workArea = useCanvasStore((s) => s.workArea)
  const printCut = useCanvasStore((s) => s.printCut)
  const { getJobsForGCode } = useCanvasManager()
  const isOpen = activeModal === 'silhouette'

  const [settings, setSettings] = useState<SilhouetteCutSettings>(() =>
    loadJSON(SETTINGS_KEY, DEFAULT_SILHOUETTE_SETTINGS),
  )
  const [kind, setKind] = useState<ConnKind>(() => loadJSON<{ kind: ConnKind }>(TARGET_KEY, { kind: 'usb' }).kind)
  const [target, setTarget] = useState<SilhouetteTarget | null>(null)

  const [usbDevices, setUsbDevices] = useState<SilhouetteDevice[]>([])
  const [serialPorts, setSerialPorts] = useState<string[]>([])
  const [serialPort, setSerialPort] = useState('')
  const [bleCutters, setBleCutters] = useState<SilhouetteBleCutter[]>([])
  const [scanning, setScanning] = useState(false)

  const [status, setStatus] = useState<SilhouetteStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState<SilhouetteProgress | null>(null)

  const update = (patch: Partial<SilhouetteCutSettings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch }
      saveJSON(SETTINGS_KEY, next)
      return next
    })

  // El modelo: por USB se sabe sin abrir el equipo; por Bluetooth hay que
  // preguntarle la version
  const device: SilhouetteDevice | null = useMemo(() => {
    if (status && sameTarget(status.device.target, target)) return status.device
    if (target?.kind === 'usb') {
      return usbDevices.find((d) => sameTarget(d.target, target)) ?? null
    }
    return null
  }, [status, target, usbDevices])

  // --- Eventos del envio (el modal vive montado aunque este cerrado) ---
  useEffect(() => {
    const unl: Promise<() => void>[] = [
      tauriListen<SilhouetteProgress>('silhouette:progress', (p) => {
        setSending(true)
        setProgress(p)
      }),
      tauriListen<SilhouetteResult>('silhouette:complete', (r) => {
        setSending(false)
        setProgress(null)
        addConsoleLine(`Silhouette: ${r.message}`)
        if (r.success) toast.success(r.message)
        else if (r.cancelled) toast.warning(r.message)
        else toast.error('La cortadora fallo', { detail: r.message })
      }),
    ]
    return () => {
      unl.forEach((p) => p.then((fn) => fn()))
    }
  }, [addConsoleLine])

  // --- Descubrimiento ---
  const refreshUsb = useCallback(async () => {
    try {
      const list = await tauriInvoke<SilhouetteDevice[]>('silhouette_list_usb')
      setUsbDevices(list)
      setTarget((cur) => {
        if (cur?.kind === 'usb' && list.some((d) => sameTarget(d.target, cur))) return cur
        return list[0]?.target ?? null
      })
    } catch (e) {
      toast.error('No se pudo listar USB', { detail: String(e) })
    }
  }, [])

  const refreshSerial = useCallback(async () => {
    try {
      const ports = await tauriInvoke<string[]>('silhouette_list_serial')
      setSerialPorts(ports)
      const saved = loadJSON<{ port?: string }>(TARGET_KEY, {}).port
      const port = saved && ports.includes(saved) ? saved : ports[0] ?? ''
      setSerialPort((cur) => cur || port)
    } catch (e) {
      toast.error('No se pudo listar puertos', { detail: String(e) })
    }
  }, [])

  const scanBle = useCallback(async () => {
    setScanning(true)
    try {
      const list = await tauriInvoke<SilhouetteBleCutter[]>('silhouette_scan_ble', { seconds: 5 })
      setBleCutters(list)
      if (list.length === 0) toast.warning('No se encontraron cortadoras por Bluetooth LE')
      setTarget((cur) => {
        if (cur?.kind === 'ble' && list.some((c) => c.id === cur.id)) return cur
        return list[0] ? { kind: 'ble', id: list[0].id } : null
      })
    } catch (e) {
      toast.error('No se pudo escanear Bluetooth', { detail: String(e) })
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    if (kind === 'usb') refreshUsb()
    else if (kind === 'serial') refreshSerial()
    else setTarget((cur) => (cur?.kind === 'ble' ? cur : null))
  }, [isOpen, kind, refreshUsb, refreshSerial])

  useEffect(() => {
    if (kind === 'serial') setTarget(serialPort ? { kind: 'serial', port: serialPort } : null)
  }, [kind, serialPort])

  useEffect(() => {
    if (target) saveJSON(TARGET_KEY, { kind: target.kind, ...(target.kind === 'serial' ? { port: target.port } : {}) })
  }, [target])

  const checkStatus = async () => {
    if (!target) return
    setChecking(true)
    try {
      const st = await tauriInvoke<SilhouetteStatus>('silhouette_status', { target })
      setStatus(st)
      addConsoleLine(`Silhouette: ${st.device.name}${st.firmware ? ` (${st.firmware})` : ''} — ${STATES[st.state]}`)
    } catch (e) {
      setStatus(null)
      toast.error('No se pudo hablar con la cortadora', { detail: String(e) })
    } finally {
      setChecking(false)
    }
  }

  // --- Trabajo ---
  const { paths, source } = useMemo(() => {
    if (!isOpen) return { paths: [] as GCodePath[], source: '' }
    const cam = useCAMStore.getState()
    const jobs = applyCAMPlan(getJobsForGCode(), {
      order: cam.operationOrder,
      disabled: new Set(cam.operations.filter((o) => !o.enabled).map((o) => o.id)),
      soloId: cam.soloOperationId,
      optimize: cam.setup.optimizeOrder,
    })
    const cutJobs = jobs.filter((j) => j.config.operationType === 'plotter' || j.config.operationType === 'pencil')
    const used = cutJobs.length > 0 ? cutJobs : jobs.filter((j) => !(j.config.operationType === 'laser' && j.config.laserMode === 'raster'))
    return {
      paths: toMediaCoords(used.flatMap((j) => j.paths), workArea),
      source: cutJobs.length > 0
        ? `${cutJobs.length} operaciones de plotter`
        : `${used.length} elementos (no hay operaciones de plotter: se cortan los contornos)`,
    }
  }, [isOpen, getJobsForGCode, workArea])

  // Si todo el trabajo es de lapiz, arrancar con pluma
  useEffect(() => {
    if (!isOpen) return
    const ops = useCAMStore.getState().operations.filter((o) => o.enabled)
    if (ops.length > 0 && ops.every((o) => o.config.operationType === 'pencil') && settings.tool !== 'pen') {
      update({ tool: 'pen' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const media = { width: workArea.width, height: workArea.height }
  // Con print & cut la cortadora busca las marcas y mide desde ellas
  const registration = printCut.enabled ? regmarkLayout(printCut) : undefined
  const program = useMemo(
    () => (device ? buildGpgl(paths, device, settings, media, registration) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device, paths, settings, workArea.width, workArea.height, printCut],
  )
  const area = device ? cuttingArea(device, settings, media) : null

  const canSend = !!target && !!device && !!program && program.errors.length === 0 && program.commands.length > 0 && !sending

  const handleSend = async () => {
    if (!canSend || !program || !target) return
    try {
      setSending(true)
      await tauriInvoke('silhouette_send', { target, steps: program.steps })
      addConsoleLine(`Silhouette: enviando ${program.commands.length} comandos (${(program.cutLengthMm / 1000).toFixed(2)} m de corte)`)
    } catch (e) {
      setSending(false)
      toast.error('No se pudo enviar a la cortadora', { detail: String(e) })
    }
  }

  const handleCancel = () => {
    tauriInvoke('silhouette_cancel').catch(() => {})
  }

  const handleSaveProgram = async () => {
    if (!program) return
    const saved = await saveTextFile(program.commands.join('\n'), `${projectName || 'proyecto'}.gpgl`, {
      name: 'Programa GPGL',
      extensions: ['gpgl', 'txt'],
    })
    if (saved) addConsoleLine(`Programa GPGL guardado: ${saved}`)
  }

  const pen = settings.tool === 'pen'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" />
            Enviar a Silhouette
          </DialogTitle>
          <DialogDescription>{source || 'Sin trazos'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Conexion */}
          <div className="space-y-2">
            <Tabs value={kind} onValueChange={(v) => { setKind(v as ConnKind); setStatus(null) }}>
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="usb" className="gap-1 text-xs"><Usb className="h-3 w-3" />USB</TabsTrigger>
                <TabsTrigger value="serial" className="gap-1 text-xs"><Bluetooth className="h-3 w-3" />Bluetooth</TabsTrigger>
                <TabsTrigger value="ble" className="gap-1 text-xs"><Bluetooth className="h-3 w-3" />Bluetooth LE</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-1">
              {kind === 'usb' && (
                <Select
                  value={target?.kind === 'usb' ? JSON.stringify(target) : ''}
                  onValueChange={(v) => { setTarget(JSON.parse(v)); setStatus(null) }}
                >
                  <SelectTrigger className="flex-1"><SelectValue placeholder="No hay cortadoras por USB" /></SelectTrigger>
                  <SelectContent>
                    {usbDevices.map((d) => (
                      <SelectItem key={JSON.stringify(d.target)} value={JSON.stringify(d.target)}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {kind === 'serial' && (
                <>
                  <Input
                    list="silhouette-serial-ports"
                    value={serialPort}
                    onChange={(e) => { setSerialPort(e.target.value); setStatus(null) }}
                    placeholder={navigator.userAgent.includes('Windows') ? 'COM5' : '/dev/rfcomm0'}
                    className="flex-1"
                  />
                  <datalist id="silhouette-serial-ports">
                    {serialPorts.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </>
              )}
              {kind === 'ble' && (
                <Select
                  value={target?.kind === 'ble' ? target.id : ''}
                  onValueChange={(id) => { setTarget({ kind: 'ble', id }); setStatus(null) }}
                >
                  <SelectTrigger className="flex-1"><SelectValue placeholder={scanning ? 'Buscando...' : 'Busca la cortadora'} /></SelectTrigger>
                  <SelectContent>
                    {bleCutters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                title={kind === 'ble' ? 'Buscar' : 'Actualizar'}
                disabled={scanning || sending}
                onClick={() => (kind === 'usb' ? refreshUsb() : kind === 'serial' ? refreshSerial() : scanBle())}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="outline" size="sm" className="shrink-0" disabled={!target || checking || sending} onClick={checkStatus}>
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Probar'}
              </Button>
            </div>

            {kind === 'serial' && (
              <p className="text-[11px] text-muted-foreground">
                Bluetooth clasico: empareja la cortadora en el sistema y usa el puerto que crea
                (COMx en Windows, /dev/cu.* en macOS; en Linux: <code>sudo rfcomm bind 0 &lt;MAC&gt; 1</code>).
              </p>
            )}
            {kind === 'ble' && (
              <p className="text-[11px] text-muted-foreground">No hace falta emparejar: enciende la cortadora y busca.</p>
            )}

            <div className="text-xs rounded-md bg-muted/60 px-2 py-1.5">
              {device ? (
                <span>
                  <strong>{device.name}</strong>
                  {status && sameTarget(status.device.target, target) && (
                    <> · {STATES[status.state]}{status.firmware ? ` · ${status.firmware}` : ''}</>
                  )}
                  {area && <> · area {area.width.toFixed(0)} x {area.height.toFixed(0)} mm</>}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {kind === 'usb' ? 'Conecta la cortadora por USB' : 'Pulsa Probar para identificar el modelo'}
                </span>
              )}
            </div>
          </div>

          {/* Herramienta */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Herramienta</Label>
              <Select value={settings.tool} onValueChange={(v) => update({ tool: v as SilhouetteTool })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="blade">Cuchilla</SelectItem>
                  <SelectItem value="autoblade">AutoBlade</SelectItem>
                  <SelectItem value="pen">Pluma / lapiz</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tapete</Label>
              <Select value={settings.mat} onValueChange={(v) => update({ mat: v as SilhouetteMat })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SILHOUETTE_MATS).map(([id, m]) => (
                    <SelectItem key={id} value={id}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {device?.twoTools && (
              <div>
                <Label className="text-xs">Portaherramientas</Label>
                <Select value={String(settings.toolholder)} onValueChange={(v) => update({ toolholder: Number(v) as 1 | 2 })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 (izquierdo)</SelectItem>
                    <SelectItem value="2">2 (derecho)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <NumberField
              label={`Fuerza (1-${device?.maxPressure ?? 33})`}
              value={settings.pressure}
              min={1}
              max={device?.maxPressure ?? 33}
              onChange={(v) => update({ pressure: v })}
            />
            <NumberField
              label={`Velocidad (1-${device?.maxSpeed ?? 10})`}
              value={settings.speed}
              min={1}
              max={device?.maxSpeed ?? 30}
              onChange={(v) => update({ speed: v })}
            />
            <NumberField label="Pasadas" value={settings.passes} min={1} max={10} onChange={(v) => update({ passes: v })} />
            {!pen && (
              <NumberField
                label="Offset cuchilla (mm)"
                value={settings.bladeOffset}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => update({ bladeOffset: v })}
              />
            )}
            {!pen && (
              <NumberField
                label="Sobrecorte (mm)"
                value={settings.overcut}
                min={0}
                max={5}
                step={0.1}
                onChange={(v) => update({ overcut: v })}
              />
            )}
            {settings.tool === 'autoblade' && (
              <NumberField label="Profundidad (0-10)" value={settings.depth} min={0} max={10} onChange={(v) => update({ depth: v })} />
            )}
            <div>
              <Label className="text-xs">Al terminar</Label>
              <Select value={settings.endPosition} onValueChange={(v) => update({ endPosition: v as 'start' | 'below' })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="start">Volver al inicio</SelectItem>
                  <SelectItem value="below">Avanzar bajo el corte</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">Mejorar traccion (el rodillo marca la huella antes de cortar)</Label>
            <Switch checked={settings.trackEnhancing} onCheckedChange={(v) => update({ trackEnhancing: v })} />
          </div>

          {registration && (
            <div className="text-[11px] rounded-md border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30 px-2 py-1.5">
              Print & cut: antes de cortar, la cortadora busca las marcas de registro de la hoja impresa. Carga la hoja
              en la esquina superior izquierda del tapete, con las marcas arriba.
            </div>
          )}

          {/* Resumen del trabajo */}
          {program && (
            <div className="space-y-1">
              {program.bbox && (
                <p className="text-xs text-muted-foreground">
                  Diseño: {(program.bbox.maxX - program.bbox.minX).toFixed(1)} x {(program.bbox.maxY - program.bbox.minY).toFixed(1)} mm
                  {' · '}corte {(program.cutLengthMm / 1000).toFixed(2)} m · {program.commands.length} comandos
                </p>
              )}
              {program.errors.map((e) => (
                <div key={e} className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />{e}
                </div>
              ))}
              {program.warnings.map((w) => (
                <div key={w} className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{w}
                </div>
              ))}
            </div>
          )}

          {sending && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{PHASES[progress?.phase ?? 'connecting'] ?? 'Enviando'}...</span>
                <span className="text-xs font-mono">{Math.round(progress?.percent ?? 0)}%</span>
              </div>
              <Progress value={progress?.percent ?? 0} />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="gap-1.5" disabled={!program || program.commands.length === 0} onClick={handleSaveProgram}>
            <Download className="h-4 w-4" />
            Guardar GPGL
          </Button>
          {sending ? (
            <Button variant="destructive" className="gap-1.5" onClick={handleCancel}>
              <Square className="h-4 w-4" />
              Detener
            </Button>
          ) : (
            <Button className="gap-1.5" disabled={!canSend} onClick={handleSend}>
              <Scissors className="h-4 w-4" />
              Cortar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        className="mt-1"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
      />
    </div>
  )
}
