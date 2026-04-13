import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSerialStore } from '@/stores/useSerialStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerial } from '@/hooks/useSerial'
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
  } = useSerialStore()

  const { consoleLines, addConsoleLine } = useAppStore()

  const [ports, setPorts] = useState<{ name: string; port_type: string }[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [commandInput, setCommandInput] = useState('')
  const [loadingPorts, setLoadingPorts] = useState(false)

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
    serial.sendCommand(commandInput.trim())
    setCommandInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSendCommand()
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* ═══ COL 1: Macros + Workflow ═══ */}
      <ResizablePanel defaultSize={15} minSize={10} maxSize={25}>
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
                <Button
                  className="w-full"
                  variant={connected ? 'destructive' : 'default'}
                  size="sm"
                  onClick={handleConnect}
                >
                  {connected ? t('disconnect') : t('connect')}
                </Button>
              </div>

              {/* ── Estado de Máquina ── */}
              <div className="bg-background border rounded-lg p-3 space-y-3">
                {/* Estado */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATE_COLORS[machineState] || 'bg-gray-400'}`} />
                    <span className="text-sm font-semibold">{machineState}</span>
                  </div>
                  <div className="flex items-center gap-1">
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
                  { axis: 'X', value: position.x, color: 'text-red-500', bg: 'bg-red-500/10', key: 'x' as const },
                  { axis: 'Y', value: position.y, color: 'text-green-500', bg: 'bg-green-500/10', key: 'y' as const },
                  { axis: 'Z', value: position.z, color: 'text-blue-500', bg: 'bg-blue-500/10', key: 'z' as const },
                ].map(({ axis, value, color, bg, key }) => (
                  <div key={axis} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 ${bg}`}>
                    <span className={`text-xs font-bold w-3 ${color}`}>{axis}</span>
                    <span className="flex-1 text-right font-mono text-base font-semibold tabular-nums">
                      {value}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-9 text-[10px] text-muted-foreground"
                      onClick={() => serial.setZero(key)}
                      disabled={!connected}
                    >
                      =0
                    </Button>
                  </div>
                ))}

                {/* Overrides */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted rounded-md px-2 py-1.5 text-center">
                    <span className="text-[10px] text-muted-foreground block">Feed</span>
                    <span className="text-sm font-semibold font-mono">{feedOverride}%</span>
                  </div>
                  <div className="bg-muted rounded-md px-2 py-1.5 text-center">
                    <span className="text-[10px] text-muted-foreground block">Spindle</span>
                    <span className="text-sm font-semibold font-mono">{spindleOverride}%</span>
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
                <Button variant="outline" size="sm" className="w-full text-xs gap-1 overflow-hidden" onClick={serial.resume} disabled={!connected}>
                  <Play className="h-3 w-3 shrink-0" /> <span className="truncate">{t('resume')}</span>
                </Button>
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
      <ResizablePanel defaultSize={20} minSize={12} maxSize={35}>
        <div className="bg-background border rounded-lg flex flex-col h-full min-h-0 mx-2">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-sm font-semibold">{t('console')}</span>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => useAppStore.getState().clearConsole()}>
              {t('clearConsole')}
            </Button>
          </div>
          <ScrollArea className="flex-1 min-h-0 p-2">
            <div className="space-y-0.5">
              {consoleLines.map((line, i) => (
                <p key={i} className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">{line}</p>
              ))}
            </div>
          </ScrollArea>
          <div className="flex items-center gap-1 p-2 border-t">
            <Input
              placeholder={t('command')}
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleKeyDown}
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
      <ResizablePanel defaultSize={35} minSize={18} maxSize={45}>
        <div className="pl-2 h-full">
          <GCodePreviewPanel />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
