import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSerialStore } from '@/stores/useSerialStore'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerial } from '@/hooks/useSerial'
import { useKeyboardJog } from '@/hooks/useKeyboardJog'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { getSharedCanvas } from '@/hooks/useCanvasManager'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
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
  Send,
  Wifi,
  WifiOff,
  RefreshCw,
  Frame,
  Settings2,
  TestTube,
} from 'lucide-react'

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

export function ControlPanel() {
  const { t } = useTranslation('serial')
  const serial = useSerial()
  useKeyboardJog()

  const {
    connected,
    machineState,
    position,
    posMode,
    baudRate,
    feedOverride,
    spindleOverride,
    jogDistance,
    jogSpeed,
    togglePosMode,
    setJogDistance,
    setJogSpeed,
    setBaudRate,
    activeWorkspace,
    setActiveWorkspace,
  } = useSerialStore()

  const { consoleLines, addConsoleLine } = useAppStore()
  const { simulating, simulatedPos, simulatedFeed, simulatedSpindle } = useWorkflowStore()

  const [ports, setPorts] = useState<{ name: string; port_type: string }[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [commandInput, setCommandInput] = useState('')
  const [loadingPorts, setLoadingPorts] = useState(false)
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const consoleEndRef = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ behavior: 'smooth' })
  }, [consoleLines.length])

  const refreshPorts = useCallback(async () => {
    setLoadingPorts(true)
    const result = await serial.listPorts()
    setPorts(result)
    if (result.length > 0 && !selectedPort) {
      setSelectedPort(result[0].name)
    }
    setLoadingPorts(false)
  }, [serial, selectedPort])

  useEffect(() => {
    refreshPorts()
  }, [])

  const handleConnect = async () => {
    if (connected) {
      await serial.disconnect()
    } else if (selectedPort) {
      await serial.connect(selectedPort, baudRate)
    } else {
      addConsoleLine('Selecciona un puerto primero')
    }
  }

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

  const handleLaserFrame = () => {
    if (!connected) return

    // Get design bounding box from Fabric canvas objects
    const canvas = getSharedCanvas()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let hasObjects = false

    if (canvas) {
      const objects = canvas.getObjects().filter((o: any) => !o.excludeFromExport && o.visible !== false)
      for (const obj of objects) {
        const br = obj.getBoundingRect()
        if (!br) continue
        hasObjects = true
        if (br.left < minX) minX = br.left
        if (br.top < minY) minY = br.top
        if (br.left + br.width > maxX) maxX = br.left + br.width
        if (br.top + br.height > maxY) maxY = br.top + br.height
      }
    }

    if (!hasObjects) {
      // Fallback: use work area
      const wa = useCanvasStore.getState().workArea
      minX = 0; minY = 0; maxX = wa.width; maxY = wa.height
      addConsoleLine('Frame: sin objetos, usando área de trabajo completa')
    }

    // Convert canvas coords to mm (canvas Y is inverted)
    const wa = useCanvasStore.getState().workArea
    const x1 = Math.max(0, minX).toFixed(3)
    const y1 = Math.max(0, wa.height - maxY).toFixed(3)
    const x2 = Math.min(wa.width, maxX).toFixed(3)
    const y2 = Math.min(wa.height, wa.height - minY).toFixed(3)

    const feedRate = 1000
    const framePower = 'S10' // Very low power for visibility

    const gcode = [
      '; Laser Frame - Bounding box preview',
      'G90 G21',
      'M5 S0',
      `G0 X${x1} Y${y1}`,
      `M4 ${framePower}`,
      `G1 X${x2} Y${y1} F${feedRate}`,
      `G1 X${x2} Y${y2} F${feedRate}`,
      `G1 X${x1} Y${y2} F${feedRate}`,
      `G1 X${x1} Y${y1} F${feedRate}`,
      'M5 S0',
      'G0 X0 Y0',
    ].join('\n')

    serial.sendGCode(gcode)
    addConsoleLine(`Frame: (${x1},${y1}) → (${x2},${y2})`)
  }

  const handleTestCut = () => {
    if (!connected) return
    const cfg = useCanvasStore.getState().globalConfig
    const size = 10 // 10mm square
    const lines: string[] = ['G90 G21', '; Test cut/draw - 10mm square at current position']

    if (cfg.operationType === 'laser') {
      const power = Math.round((cfg.laserPower / 100) * 1000)
      const cmd = cfg.laserDynamic ? 'M4' : 'M3'
      lines.push('M5 S0', `G0 X0 Y0`, `${cmd} S${power}`,
        `G1 X${size} Y0 F${cfg.feedRate}`, `G1 X${size} Y${size} F${cfg.feedRate}`,
        `G1 X0 Y${size} F${cfg.feedRate}`, `G1 X0 Y0 F${cfg.feedRate}`,
        'M5 S0')
    } else if (cfg.operationType === 'plotter' || cfg.operationType === 'pencil') {
      const penZ = cfg.pressureZ || -1
      lines.push(`G0 Z5`, `G0 X0 Y0`, `G1 Z${penZ} F${cfg.speed || 1000}`,
        `G1 X${size} Y0 F${cfg.speed || 1000}`, `G1 X${size} Y${size} F${cfg.speed || 1000}`,
        `G1 X0 Y${size} F${cfg.speed || 1000}`, `G1 X0 Y0 F${cfg.speed || 1000}`,
        'G0 Z5')
    } else {
      // CNC
      const depth = -Math.min(Math.abs(cfg.depthStep), 1)
      lines.push(`M3 S${cfg.spindleRPM}`, 'G4 P2', `G0 X0 Y0`, `G0 Z5`,
        `G1 Z${depth} F${cfg.plungeRate}`,
        `G1 X${size} Y0 F${cfg.feedRate}`, `G1 X${size} Y${size} F${cfg.feedRate}`,
        `G1 X0 Y${size} F${cfg.feedRate}`, `G1 X0 Y0 F${cfg.feedRate}`,
        'G0 Z5', 'M5')
    }

    lines.push('G0 X0 Y0')
    serial.sendGCode(lines.join('\n'))
    addConsoleLine(`Test ${cfg.operationType}: 10mm square`)
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* ═══ COL 1: Macros + Workflow ═══ */}
      <ResizablePanel defaultSize={15} minSize={8} maxSize={25}>
        <MacrosWorkflowPanel />
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* ═══ COL 2: Conexion + Estado + Controles + Jog ═══ */}
      <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
        <div className="flex flex-col h-full min-h-0 pl-2">
          <ScrollArea className="flex-1">
            <div className="space-y-3 pr-2">
              {/* Conexion */}
              <div className="bg-background border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant={connected ? 'success' : 'destructive'} className="gap-1">
                    {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                    {connected ? t('connected') : t('disconnected')}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={refreshPorts}
                    disabled={loadingPorts}
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingPorts ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">{t('port')}</label>
                    <Select value={selectedPort} onValueChange={setSelectedPort} disabled={connected}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder={t('selectPort')} />
                      </SelectTrigger>
                      <SelectContent>
                        {ports.map((p) => (
                          <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                        ))}
                        {ports.length === 0 && (
                          <SelectItem value="_none" disabled>{t('selectPort')}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">{t('baudRate')}</label>
                    <Select value={baudRate.toString()} onValueChange={(v) => setBaudRate(parseInt(v))} disabled={connected}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[9600, 19200, 38400, 57600, 115200].map((b) => (
                          <SelectItem key={b} value={b.toString()}>{b}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    className="flex-1"
                    variant={connected ? 'destructive' : 'default'}
                    size="sm"
                    onClick={handleConnect}
                  >
                    {connected ? t('disconnect') : t('connect')}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => useAppStore.getState().openModal('grblSettings')}
                    disabled={!connected}
                    title="GRBL Settings ($$)"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

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
                        if (connected) serial.sendCommand(e.target.value)
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px]"
                      onClick={() => serial.setZero()}
                      disabled={!connected}
                    >
                      <Target className="h-3 w-3 mr-1" />
                      {t('setZero')}
                    </Button>
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
                      {simulating ? `${simulatedFeed}` : `${feedOverride}%`}
                    </span>
                  </div>
                  <div className={`rounded-md px-2 py-1.5 text-center ${simulating ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-muted'}`}>
                    <span className="text-[10px] text-muted-foreground block">Spindle</span>
                    <span className={`text-sm font-semibold font-mono ${simulating ? 'text-cyan-300' : ''}`}>
                      {simulating ? `${simulatedSpindle}` : `${spindleOverride}%`}
                    </span>
                  </div>
                </div>
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
                  <Button variant="destructive" size="sm" className="text-xs gap-1 overflow-hidden" onClick={serial.stop} disabled={!connected} title={t('stop')}>
                    <OctagonX className="h-3 w-3 shrink-0" /> <span className="truncate">{t('stop')}</span>
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={serial.resume} disabled={!connected}>
                    <Play className="h-3 w-3 shrink-0" /> <span className="truncate">{t('resume')}</span>
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={handleLaserFrame} disabled={!connected} title="Laser Frame - Recorrer perímetro del diseño">
                    <Frame className="h-3 w-3 shrink-0" /> <span className="truncate">Frame</span>
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs gap-1 overflow-hidden" onClick={handleTestCut} disabled={!connected} title="Test Cut/Draw - Cuadrado 10mm con config actual">
                    <TestTube className="h-3 w-3 shrink-0" /> <span className="truncate">Test</span>
                  </Button>
                </div>
              </div>

              {/* ── Jog ── */}
              <div className="bg-background border rounded-lg p-3 space-y-2">
                <h3 className="text-xs font-semibold">{t('jog')}</h3>
                <div className="grid grid-cols-3 gap-1 max-w-[140px] mx-auto">
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

                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-blue-500 font-bold">Z</span>
                  <Button variant="outline" size="sm" className="h-7" onClick={() => serial.jogZ(jogDistance, jogSpeed)} disabled={!connected}>
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7" onClick={() => serial.jogZ(-jogDistance, jogSpeed)} disabled={!connected}>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">{t('jogDistance')} (mm)</label>
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
                    <label className="text-[10px] text-muted-foreground">{t('jogSpeed')}</label>
                    <Input
                      type="number"
                      value={jogSpeed}
                      onChange={(e) => setJogSpeed(parseInt(e.target.value) || 1000)}
                      className="h-7 text-xs"
                    />
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
