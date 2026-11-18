import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSerialStore } from '@/stores/useSerialStore'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerial } from '@/hooks/useSerial'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { perimeterProgram, setupSafeZ } from '@/lib/perimeter'
import { JobQueuePanel } from '@/components/panels/JobQueuePanel'
import { useCAMStore } from '@/stores/useCAMStore'
import { buildResumeProgram, normalizeGCode, suggestResumeLine } from '@/lib/resume-job'
import { cancelReconnect, RECONNECT_MAX_ATTEMPTS } from '@/lib/serial-reconnect'
import { useKeyboardJog } from '@/hooks/useKeyboardJog'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { MacrosWorkflowPanel } from '@/components/panels/control/MacrosWorkflowPanel'
import { GCodePreviewPanel } from '@/components/panels/control/GCodePreviewPanel'
import {
  Home,
  Unlock,
  RotateCcw,
  OctagonX,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Target,
  Play,
  Pause,
  Send,
  Wifi,
  WifiOff,
  Frame,
  Settings2,
  Loader2,
  TestTube,
  ZapOff,
  ShieldAlert,
} from 'lucide-react'

const GRBL_ERRORS: Record<string, { es: string; en: string; recovery: ('reset' | 'unlock' | 'home' | 'resume')[] }> = {
  'error:1':  { es: 'Comando G-code no reconocido', en: 'Unrecognized G-code command', recovery: [] },
  'error:2':  { es: 'Formato numerico invalido', en: 'Bad number format', recovery: [] },
  'error:3':  { es: 'Valor $ invalido', en: 'Invalid $ statement', recovery: [] },
  'error:5':  { es: 'Homing no habilitado en configuracion', en: 'Homing cycle not enabled', recovery: ['reset'] },
  'error:8':  { es: 'Comando requiere estado Idle (no en movimiento/alarma)', en: 'Command requires Idle state', recovery: ['reset', 'unlock'] },
  'error:9':  { es: 'Comandos G-code bloqueados durante alarma o jog', en: 'G-code locked during alarm or jog', recovery: ['reset', 'unlock'] },
  'error:14': { es: 'Linea de inicio excede limite', en: 'Startup line exceeds limit', recovery: [] },
  'error:15': { es: 'Jog excede limites de viaje', en: 'Jog target exceeds machine travel', recovery: [] },
  'error:17': { es: 'Modo laser requiere salida PWM', en: 'Laser mode requires PWM output', recovery: [] },
  'error:22': { es: 'Feed rate no definido', en: 'Feed rate not set', recovery: [] },
  'error:24': { es: 'Valor de coordenada G-code invalido', en: 'Invalid G-code coordinate value', recovery: [] },
  'ALARM:1':  { es: 'Limite duro activado. Posicion perdida.', en: 'Hard limit triggered. Position lost.', recovery: ['unlock', 'home'] },
  'ALARM:2':  { es: 'Limite suave. Movimiento fuera de rango.', en: 'Soft limit. Motion out of range.', recovery: ['unlock', 'home'] },
  'ALARM:3':  { es: 'Reset durante movimiento. Posicion perdida.', en: 'Reset while in motion. Position lost.', recovery: ['unlock', 'home'] },
  'ALARM:4':  { es: 'Sonda no contacto dentro del rango.', en: 'Probe fail. No contact.', recovery: ['unlock'] },
  'ALARM:5':  { es: 'Sonda activa antes de iniciar ciclo.', en: 'Probe already triggered.', recovery: ['unlock'] },
  'ALARM:6':  { es: 'Fallo homing. Limite no encontrado.', en: 'Homing fail. Switch not found.', recovery: ['unlock'] },
  'ALARM:7':  { es: 'Fallo homing. Limite no se despejo.', en: 'Homing fail. Switch not cleared.', recovery: ['unlock'] },
  'ALARM:8':  { es: 'Fallo homing. Pull-off insuficiente.', en: 'Homing fail. Pull-off failed.', recovery: ['unlock'] },
  'ALARM:9':  { es: 'Homing requerido. Bloqueado por seguridad.', en: 'Homing required. Locked.', recovery: ['home'] },
  'ALARM:10': { es: 'Limites suaves requieren homing. Ejecuta $H.', en: 'Soft limits need homing. Run $H.', recovery: ['home'] },
}

const STATE_COLORS: Record<string, string> = {
  Idle: 'bg-emerald-500',
  Run: 'bg-blue-500 animate-pulse',
  Hold: 'bg-yellow-500',
  Alarm: 'bg-red-500 animate-pulse',
  Check: 'bg-purple-500',
  Home: 'bg-cyan-500 animate-pulse',
  Sleep: 'bg-gray-500',
  Jog: 'bg-indigo-500',
}


/**
 * Ofrece retomar un trabajo que se corto (error, alarma, parada, cable).
 * Propone una linea de reinicio algo antes de la ultima acusada, sobre un
 * movimiento rapido, y deja corregirla a mano.
 */
function ResumeJobBar() {
  const serial = useSerial()
  const lastJob = useSerialStore((s) => s.lastJob)
  const result = useSerialStore((s) => s.lastSendResult)
  const sending = useSerialStore((s) => s.sending)
  const connected = useSerialStore((s) => s.connected)
  const [line, setLine] = useState<number | null>(null)

  const lines = useMemo(() => (lastJob ? normalizeGCode(lastJob.gcode) : []), [lastJob])
  const suggested = useMemo(
    () => (lastJob ? suggestResumeLine(lines, lastJob.line) : 0),
    [lastJob, lines],
  )

  if (!lastJob || sending || result === null || result === 'done' || lastJob.line <= 0) return null
  const from = line ?? suggested

  const handleResume = () => {
    const { program, position } = buildResumeProgram(lastJob.gcode, from, useCAMStore.getState().setup.safeZ)
    const pos = `X${position.x ?? '?'} Y${position.y ?? '?'} Z${position.z ?? '?'}`
    useAppStore.getState().addConsoleLine(`Reanudando desde la linea ${from + 1}: vuelve a ${pos}`)
    setLine(null)
    serial.sendGCode(program)
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-1.5">
      <p className="text-[11px] text-amber-200">
        Trabajo interrumpido en la linea {lastJob.line} de {lastJob.total} ({result}).
        Verifica que el origen de pieza no se haya perdido antes de retomar.
      </p>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">Desde linea</span>
        <Input
          type="number"
          min={1}
          max={lastJob.total}
          value={from + 1}
          onChange={(e) => setLine(Math.max(0, Math.min(lastJob.total - 1, (parseInt(e.target.value) || 1) - 1)))}
          className="h-6 w-20 text-xs"
        />
        <Button size="sm" className="h-6 text-xs flex-1" onClick={handleResume} disabled={!connected}>
          Reanudar trabajo
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => useSerialStore.getState().setLastJob(null)}>
          Descartar
        </Button>
      </div>
      <p className="truncate font-mono text-[10px] text-muted-foreground">{lines[from]}</p>
    </div>
  )
}

export function ControlPanel() {
  const { t } = useTranslation('serial')
  const serial = useSerial()
  useKeyboardJog()

  const {
    connected,
    reconnecting,
    reconnectAttempt,
    machineState,
    position,
    posMode,
    baudRate,
    diagnostics,
    parserState,
    jogDistance,
    jogSpeed,
    togglePosMode,
    setJogDistance,
    setJogSpeed,
    activeWorkspace,
    setActiveWorkspace,
    laserPower,
    setLaserPower,
    laserTestDuration,
    lastError,
    clearLastError,
    sending,
    port,
  } = useSerialStore()

  const { consoleLines, addConsoleLine, language } = useAppStore()
  const { simulating, simulatedPos, simulatedFeed, simulatedSpindle } = useWorkflowStore()
  const operationType = useCanvasStore((s) => s.globalConfig.operationType)
  const isLaser = operationType === 'laser'

  const [commandInput, setCommandInput] = useState('')
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const consoleEndRef = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ behavior: 'smooth' })
  }, [consoleLines.length])

  const handleSendCommand = () => {
    if (!commandInput.trim()) return
    const cmd = commandInput.trim()
    serial.sendCommand(cmd)
    setCommandHistory(prev => {
      const filtered = prev.filter(c => c !== cmd)
      return [cmd, ...filtered].slice(0, 50)
    })
    setHistoryIndex(-1)
    setCommandInput('')
  }

  const handleConsoleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (commandHistory.length > 0) {
        const next = Math.min(historyIndex + 1, commandHistory.length - 1)
        setHistoryIndex(next)
        setCommandInput(commandHistory[next])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex > 0) {
        const next = historyIndex - 1
        setHistoryIndex(next)
        setCommandInput(commandHistory[next])
      } else {
        setHistoryIndex(-1)
        setCommandInput('')
      }
    }
  }

  // Recorre la caja del diseno sin cortar, a la altura segura del setup
  const { getJobsForGCode } = useCanvasManager()
  const handlePerimeter = () => {
    if (!connected || sending) return
    const { gcode, bbox, usedWorkArea } = perimeterProgram(getJobsForGCode())
    serial.sendGCode(gcode)
    const f = (n: number) => n.toFixed(1)
    addConsoleLine(
      `Recorrido de perimetro${usedWorkArea ? ' (hoja completa, no hay piezas)' : ''}: ` +
      `X${f(bbox.minX)}..${f(bbox.maxX)} Y${f(bbox.minY)}..${f(bbox.maxY)}`,
    )
  }

  const handleTestCut = () => {
    if (!connected) return
    const cfg = useCanvasStore.getState().globalConfig
    const size = 10 // 10mm square
    const safeZ = setupSafeZ()
    const lines: string[] = ['G90', 'G21', '; Test cut/draw - 10mm square at work origin']

    if (cfg.operationType === 'laser') {
      const power = Math.round((cfg.laserPower / 100) * 1000)
      const cmd = cfg.laserDynamic ? 'M4' : 'M3'
      lines.push('M5 S0', `G0 X0 Y0`, `${cmd} S${power}`,
        `G1 X${size} Y0 F${cfg.feedRate}`, `G1 X${size} Y${size} F${cfg.feedRate}`,
        `G1 X0 Y${size} F${cfg.feedRate}`, `G1 X0 Y0 F${cfg.feedRate}`,
        'M5 S0')
    } else if (cfg.operationType === 'plotter' || cfg.operationType === 'pencil') {
      const penZ = cfg.pressureZ ?? -1
      lines.push(`G0 Z${safeZ}`, `G0 X0 Y0`, `G1 Z${penZ} F${cfg.speed || 1000}`,
        `G1 X${size} Y0 F${cfg.speed || 1000}`, `G1 X${size} Y${size} F${cfg.speed || 1000}`,
        `G1 X0 Y${size} F${cfg.speed || 1000}`, `G1 X0 Y0 F${cfg.speed || 1000}`,
        `G0 Z${safeZ}`)
    } else {
      // CNC
      const depth = -Math.min(Math.abs(cfg.depthStep), 1)
      // Primero sube: el rapido en XY a la Z actual podia arrastrar la fresa
      // por la pieza o una mordaza.
      lines.push(`G0 Z${safeZ}`, `M3 S${cfg.spindleRPM}`, 'G4 P2', `G0 X0 Y0`,
        `G1 Z${depth} F${cfg.plungeRate}`,
        `G1 X${size} Y0 F${cfg.feedRate}`, `G1 X${size} Y${size} F${cfg.feedRate}`,
        `G1 X0 Y${size} F${cfg.feedRate}`, `G1 X0 Y0 F${cfg.feedRate}`,
        `G0 Z${safeZ}`, 'M5')
    }

    serial.sendGCode(lines.join('\n'))
    addConsoleLine(`Test ${cfg.operationType}: 10mm square`)
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* ═══ COL 1: Macros + Workflow ═══ */}
      <ResizablePanel defaultSize={15} minSize={8} maxSize={25}>
        <div className="flex h-full flex-col min-h-0">
          <div className="flex-1 min-h-0">
            <MacrosWorkflowPanel />
          </div>
          {/* Trabajos que llegan desde otros equipos de la red */}
          <JobQueuePanel />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* ═══ COL 2: Conexion + Estado + Controles + Jog ═══ */}
      <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
        <div className="flex flex-col h-full min-h-0 pl-2">
          <ScrollArea className="flex-1">
            <div className="space-y-3 pr-2">
              {/* Conexion: compacta cuando esta conectado */}
              {connected ? (
                <div className="bg-background border rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                  <Wifi className="h-3 w-3 text-green-500 shrink-0" />
                  <span className="text-[11px] font-mono truncate flex-1" title={port}>
                    {port.replace(/^\/dev\//, '')} @ {baudRate}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px] shrink-0"
                    onClick={() => useAppStore.getState().openModal('grblSettings')}
                    title="GRBL Settings ($$)"
                  >
                    <Settings2 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 px-2 text-[10px] shrink-0"
                    onClick={() => serial.disconnect()}
                  >
                    {t('disconnect')}
                  </Button>
                </div>
              ) : reconnecting ? (
                // Reintento en curso: se oculta el formulario para que el
                // operador no abra el puerto a mano mientras el reconector lo
                // está intentando y terminen peleándose por el descriptor.
                <div className="bg-background border rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-warning-fg" strokeWidth={1.5} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] truncate">{t('reconnecting')}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {t('reconnectAttemptOf', { attempt: reconnectAttempt, max: RECONNECT_MAX_ATTEMPTS })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px] shrink-0"
                    onClick={cancelReconnect}
                  >
                    {t('reconnectCancel')}
                  </Button>
                </div>
              ) : (
                // La conexion se hace en un solo lugar: la barra superior,
                // visible desde cualquier pestana.
                <div className="bg-background border rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                  <WifiOff className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-[11px] text-muted-foreground flex-1">{t('disconnected') || 'Sin conexion'}</span>
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[10px] shrink-0"
                    onClick={() => useAppStore.getState().setConnectPopoverOpen(true)}
                  >
                    {t('connect')}
                  </Button>
                </div>
              )}

              {/* ── Error/Alarm Banner ── */}
              {lastError && (() => {
                const key = lastError.split(' ')[0].trim()
                const info = GRBL_ERRORS[key]
                const desc = info ? (language === 'en' ? info.en : info.es) : lastError
                return (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        {key}
                      </span>
                      <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={clearLastError}>
                        X
                      </Button>
                    </div>
                    <p className="text-xs text-red-300">{desc}</p>
                    {info && info.recovery.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {info.recovery.includes('reset') && (
                          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { serial.reset(); clearLastError() }}>
                            <RotateCcw className="h-3 w-3 mr-1" /> {t('reset')}
                          </Button>
                        )}
                        {info.recovery.includes('unlock') && (
                          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { serial.unlock(); clearLastError() }}>
                            <Unlock className="h-3 w-3 mr-1" /> {t('unlock')}
                          </Button>
                        )}
                        {info.recovery.includes('home') && (
                          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { serial.home(); clearLastError() }}>
                            <Home className="h-3 w-3 mr-1" /> {t('home')}
                          </Button>
                        )}
                        {info.recovery.includes('resume') && (
                          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { serial.resume(); clearLastError() }}>
                            <Play className="h-3 w-3 mr-1" /> {t('resume')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── Estado de Máquina ── */}
              <div className="bg-background border rounded-lg p-3 space-y-3">
                {/* Estado */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${simulating ? 'bg-cyan-500 animate-pulse' : (STATE_COLORS[machineState] || 'bg-gray-400')}`} />
                    <span className={`text-sm font-semibold ${simulating ? 'text-cyan-400' : ''}`}>
                      {simulating ? 'Simulación' : machineState}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <select
                      className="text-[10px] text-muted-foreground font-mono cursor-pointer px-1 py-0.5 rounded bg-transparent hover:bg-muted border-none outline-none"
                      value={activeWorkspace}
                      onChange={(e) => {
                        setActiveWorkspace(e.target.value)
                        if (connected) {
                          serial.sendCommand(e.target.value)
                          // Refresca el parser state para que el diagnostico no
                          // siga mostrando el sistema de coordenadas anterior.
                          serial.sendCommand('$G')
                        }
                      }}
                      disabled={!connected}
                    >
                      {['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(ws => (
                        <option key={ws} value={ws}>{ws}</option>
                      ))}
                    </select>
                    <button
                      className="text-[10px] text-muted-foreground hover:text-foreground font-mono cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                      onClick={togglePosMode}
                    >
                      {posMode}
                    </button>
                  </div>
                </div>

                {/* Ejes */}
                {[
                  { axis: 'X', value: position.x, simValue: simulatedPos.x, color: 'text-red-500', bg: 'bg-red-500/10', key: 'x' as const },
                  { axis: 'Y', value: position.y, simValue: simulatedPos.y, color: 'text-green-500', bg: 'bg-green-500/10', key: 'y' as const },
                  { axis: 'Z', value: position.z, simValue: simulatedPos.z, color: 'text-blue-500', bg: 'bg-blue-500/10', key: 'z' as const },
                ].map(({ axis, value, simValue, color, bg, key }) => (
                  <div key={axis} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 ${simulating ? 'bg-cyan-500/10 border border-cyan-500/20' : bg}`}>
                    <span className={`text-xs font-bold w-3 ${simulating ? 'text-cyan-400' : color}`}>{axis}</span>
                    <span className={`flex-1 text-right font-mono text-base font-semibold tabular-nums ${simulating ? 'text-cyan-300' : ''}`}>
                      {simulating ? simValue.toFixed(3) : value}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-9 text-[10px] text-muted-foreground"
                      onClick={() => serial.setZero(key)}
                      disabled={!connected || simulating}
                    >
                      =0
                    </Button>
                  </div>
                ))}

                {/* Overrides */}
                <div className="grid grid-cols-2 gap-2">
                  <div className={`rounded-md px-2 py-1.5 text-center ${simulating ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-muted'}`}>
                    <span className="text-[10px] text-muted-foreground block">Feed</span>
                    <span className={`text-sm font-semibold font-mono ${simulating ? 'text-cyan-300' : ''}`}>
                      {simulating ? `${simulatedFeed}` : `${diagnostics.feedOverride}%`}
                    </span>
                    {connected && !simulating && (
                      <div className="mt-1 flex justify-center gap-1">
                        <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" title="Avance -10%" onClick={() => serial.override('feed', 'down')}>-10</Button>
                        <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" title="Avance al 100%" onClick={() => serial.override('feed', 'reset')}>100</Button>
                        <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" title="Avance +10%" onClick={() => serial.override('feed', 'up')}>+10</Button>
                      </div>
                    )}
                  </div>
                  <div className={`rounded-md px-2 py-1.5 text-center ${simulating ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-muted'}`}>
                    <span className="text-[10px] text-muted-foreground block">Spindle</span>
                    <span className={`text-sm font-semibold font-mono ${simulating ? 'text-cyan-300' : ''}`}>
                      {simulating ? `${simulatedSpindle}` : `${diagnostics.spindleOverride}%`}
                    </span>
                    {connected && !simulating && (
                      <div className="mt-1 flex justify-center gap-1">
                        <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" title="Husillo/laser -10%" onClick={() => serial.override('spindle', 'down')}>-10</Button>
                        <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" title="Husillo/laser al 100%" onClick={() => serial.override('spindle', 'reset')}>100</Button>
                        <Button variant="outline" size="sm" className="h-5 px-1.5 text-[10px]" title="Husillo/laser +10%" onClick={() => serial.override('spindle', 'up')}>+10</Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Diagnostico I/O: pines, buffers y feed/spindle reales que
                    GRBL reporta en el status extendido. */}
                {connected && !simulating && (
                  <div className="space-y-1.5 border-t pt-2">
                    <div className="flex flex-wrap gap-1">
                      {[
                        { label: 'X', on: diagnostics.limitX },
                        { label: 'Y', on: diagnostics.limitY },
                        { label: 'Z', on: diagnostics.limitZ },
                        { label: 'P', on: diagnostics.probe },
                        { label: 'D', on: diagnostics.door },
                        { label: 'H', on: diagnostics.hold },
                      ].map(({ label, on }) => (
                        <span
                          key={label}
                          title={`Pin ${label}`}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold ${
                            on
                              ? 'bg-amber-500/20 text-amber-500'
                              : 'bg-muted text-muted-foreground/60'
                          }`}
                        >
                          {label}
                        </span>
                      ))}
                      {(diagnostics.floodCoolant || diagnostics.mistCoolant) && (
                        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-sky-400">
                          {diagnostics.floodCoolant ? 'M8' : 'M7'}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <div className="rounded bg-muted px-1 py-1">
                        <span className="block text-[9px] text-muted-foreground">Buf</span>
                        <span className="font-mono text-[11px] tabular-nums">
                          {diagnostics.plannerBuffer}/{diagnostics.rxBuffer}
                        </span>
                      </div>
                      <div className="rounded bg-muted px-1 py-1">
                        <span className="block text-[9px] text-muted-foreground">F real</span>
                        <span className="font-mono text-[11px] tabular-nums">
                          {diagnostics.currentFeed}
                        </span>
                      </div>
                      <div className="rounded bg-muted px-1 py-1">
                        <span className="block text-[9px] text-muted-foreground">Rapid</span>
                        <button
                          type="button"
                          className="font-mono text-[11px] tabular-nums underline decoration-dotted"
                          title="Rapidos: clic para alternar 100% / 50% / 25%"
                          onClick={() =>
                            serial.override(
                              'rapid',
                              diagnostics.rapidOverride >= 100 ? 'half' : diagnostics.rapidOverride >= 50 ? 'quarter' : 'reset',
                            )
                          }
                        >
                          {diagnostics.rapidOverride}%
                        </button>
                      </div>
                    </div>
                    {parserState && (
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {parserState.motionMode} {parserState.coordSystem} {parserState.plane}{' '}
                        {parserState.units} {parserState.distanceMode} {parserState.spindleState}{' '}
                        {parserState.coolantState} T{parserState.toolNumber}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Controles rápidos ── */}
              <div className="bg-background border rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-4 gap-1">
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={serial.home} disabled={!connected} title={t('home')}>
                    <Home className="h-3 w-3 shrink-0" /> <span className="truncate">{t('home')}</span>
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={serial.unlock} disabled={!connected} title={t('unlock')}>
                    <Unlock className="h-3 w-3 shrink-0" /> <span className="truncate">{t('unlock')}</span>
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={serial.reset} disabled={!connected} title={t('reset')}>
                    <RotateCcw className="h-3 w-3 shrink-0" /> <span className="truncate">{t('reset')}</span>
                  </Button>
                  <Button variant="destructive" size="sm" className="text-xs gap-1 overflow-hidden" onClick={serial.abort} disabled={!connected} title={t('stop')}>
                    <OctagonX className="h-3 w-3 shrink-0" /> <span className="truncate">{t('stop')}</span>
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={serial.pause} disabled={!connected || !sending} title="Pausa: detiene el avance y apaga el husillo. Reanudar lo vuelve a encender.">
                    <Pause className="h-3 w-3 shrink-0" /> <span className="truncate">Pausa</span>
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={serial.resume} disabled={!connected} title="Reanuda tras una pausa (enciende el husillo y espera antes de seguir)">
                    <Play className="h-3 w-3 shrink-0" /> <span className="truncate">{t('resume')}</span>
                  </Button>
                </div>
                <ResumeJobBar />
                <div className="grid grid-cols-3 gap-1">
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={() => serial.setZero()} disabled={!connected} title={t('setZero') || 'Fijar origen actual (G10 L20 P1 X0 Y0 Z0)'}>
                    <Target className="h-3 w-3 shrink-0" /> <span className="truncate">{t('setZero') || 'Set Zero'}</span>
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={handlePerimeter} disabled={!connected || sending} title="Recorre la caja del diseno sin cortar, a la altura segura del setup">
                    <Frame className="h-3 w-3 shrink-0" /> <span className="truncate">Perimetro</span>
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={handleTestCut} disabled={!connected} title="Test Cut/Draw - Cuadrado 10mm con config actual">
                    <TestTube className="h-3 w-3 shrink-0" /> <span className="truncate">Test</span>
                  </Button>
                </div>
              </div>

              {/* ── Laser / Spindle Power Control ── */}
              {(() => {
                const max = isLaser ? 1000 : 24000
                const presets: { label: string; value: number }[] = isLaser
                  ? [
                      { label: t('laserPresetLow') || 'Suave', value: 200 },
                      { label: t('laserPresetMid') || 'Medio', value: 500 },
                      { label: t('laserPresetHigh') || 'Fuerte', value: 900 },
                    ]
                  : [
                      { label: t('spindlePresetLow') || 'Lento', value: 6000 },
                      { label: t('spindlePresetMid') || 'Medio', value: 12000 },
                      { label: t('spindlePresetHigh') || 'Rápido', value: 20000 },
                    ]
                const offCmd = isLaser ? serial.laserOff : () => serial.sendCommand('M5')
                // Encendido, espera y apagado van en un solo programa: el apagado
                // ya esta en el buffer del control. Con un timer de JS, si la
                // ventana se cerraba o se caia la conexion el laser quedaba
                // encendido quemando un punto.
                const testCmd = () => {
                  if (useSerialStore.getState().sending) return
                  const secs = Math.max(0.01, laserTestDuration / 1000).toFixed(2)
                  serial.sendGCode([`M3 S${laserPower}`, `G4 P${secs}`, isLaser ? 'M5 S0' : 'M5'].join('\n'))
                }
                return (
                  <div className={`bg-background border rounded-lg p-3 space-y-2 ${isLaser ? 'border-orange-500/30' : 'border-blue-500/30'}`}>
                    <div className="flex items-center justify-between">
                      <h3 className={`text-xs font-semibold ${isLaser ? 'text-orange-500' : 'text-blue-400'}`}>
                        {isLaser ? t('laserPower') : (t('spindleSpeed') || 'Velocidad husillo (RPM)')}
                      </h3>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {isLaser ? `${(laserPower / 10).toFixed(1)}%` : `${laserPower} RPM`}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={max}
                      step={isLaser ? 10 : 100}
                      value={[laserPower]}
                      onValueChange={([v]) => setLaserPower(v)}
                    />
                    <div className="grid grid-cols-3 gap-1">
                      {presets.map((p) => (
                        <Button
                          key={p.value}
                          variant={laserPower === p.value ? 'default' : 'outline'}
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => setLaserPower(p.value)}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => serial.sendCommand(`S${laserPower}`)}
                        disabled={!connected}
                      >
                        {t('laserSetPower')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1"
                        onClick={testCmd}
                        disabled={!connected}
                      >
                        <TestTube className="h-3 w-3" />
                        {t('laserTestPulse')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="text-xs gap-1 font-semibold"
                        onClick={offCmd}
                        disabled={!connected}
                        title={isLaser ? t('laserOff') : (t('spindleOff') || 'Husillo OFF (M5)')}
                      >
                        <ZapOff className="h-3 w-3" />
                        OFF
                      </Button>
                    </div>
                  </div>
                )
              })()}

              {/* ── Jog ── */}
              <div className="bg-background border rounded-lg p-3 space-y-2">
                <h3 className="text-xs font-semibold">{t('jog')}</h3>
                <div className="flex items-center justify-center gap-3">
                  <div className="flex flex-col gap-1.5 w-24 shrink-0">
                    <div>
                      <label className="text-[10px] text-muted-foreground block leading-tight">{t('jogDistance')} (mm)</label>
                      <Select value={jogDistance.toString()} onValueChange={(v) => setJogDistance(parseFloat(v))}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[0.1, 0.5, 1, 5, 10, 50].map((d) => (
                            <SelectItem key={d} value={d.toString()}>{d}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground block leading-tight">{t('jogSpeed')}</label>
                      <Input
                        type="number"
                        value={jogSpeed}
                        onChange={(e) => setJogSpeed(parseInt(e.target.value) || 1000)}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <div />
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => serial.jogXY(0, jogDistance, jogSpeed)} disabled={!connected}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <div />
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => serial.jogXY(-jogDistance, 0, jogSpeed)} disabled={!connected}>
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={serial.home} disabled={!connected}>
                      <Home className="h-3 w-3" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => serial.jogXY(jogDistance, 0, jogSpeed)} disabled={!connected}>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                    <div />
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => serial.jogXY(0, -jogDistance, jogSpeed)} disabled={!connected}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <div />
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => serial.jogZ(jogDistance, jogSpeed)} disabled={!connected} title="Z+">
                      <ChevronUp className="h-4 w-4 text-blue-500" />
                    </Button>
                    <span className="text-[10px] text-blue-500 font-bold leading-none">Z</span>
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => serial.jogZ(-jogDistance, jogSpeed)} disabled={!connected} title="Z-">
                      <ChevronDown className="h-4 w-4 text-blue-500" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* ═══ COL 3: Consola ═══ */}
      <ResizablePanel defaultSize={20} minSize={8} maxSize={35}>
        <div className="bg-background border rounded-lg flex flex-col h-full min-h-0 mx-2">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-sm font-semibold">{t('console')}</span>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => useAppStore.getState().clearConsole()}>
              {t('clearConsole')}
            </Button>
          </div>
          <ScrollArea className="flex-1 min-h-0 p-2">
            <div className="space-y-0.5">
              {consoleLines.map((line, i) => {
                const isSim = line.startsWith('[SIM]')
                const isError = /error|alarm|ALARM/i.test(line)
                const isOk = line.includes('] ok')
                const isCmd = line.includes('] > ')
                const isGrblSetting = /\$\d+=/.test(line)
                const cls = isSim ? 'text-cyan-400'
                  : isError ? 'text-red-400 font-semibold'
                  : isOk ? 'text-emerald-500'
                  : isCmd ? 'text-blue-400'
                  : isGrblSetting ? 'text-amber-400'
                  : 'text-muted-foreground'
                return (
                  <p key={i} className={`text-xs font-mono whitespace-pre-wrap ${cls}`}>
                    {line}
                  </p>
                )
              })}
              <div ref={consoleEndRef} />
            </div>
          </ScrollArea>
          <div className="flex items-center gap-1 p-2 border-t">
            <Input
              placeholder={t('command')}
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleConsoleKeyDown}
              className="h-7 text-xs font-mono"
              disabled={!connected}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleSendCommand}
              disabled={!connected || !commandInput.trim()}
            >
              <Send className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* ═══ COL 4: GCode activo + Preview + Timeline ═══ */}
      <ResizablePanel defaultSize={35} minSize={12} maxSize={45}>
        <div className="pl-2 h-full">
          <GCodePreviewPanel />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
