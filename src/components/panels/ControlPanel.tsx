import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSerialStore } from '@/stores/useSerialStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerial } from '@/hooks/useSerial'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  Wifi,
  WifiOff,
  Target,
  Play,
  RefreshCw,
  Send,
} from 'lucide-react'

export function ControlPanel() {
  const { t } = useTranslation('serial')
  const serial = useSerial()

  const {
    connected,
    machineState,
    position,
    posMode,
    baudRate,
    jogDistance,
    jogSpeed,
    feedOverride,
    spindleOverride,
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
  }, []) // Solo al montar

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
    if (e.key === 'Enter') {
      handleSendCommand()
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-4xl mx-auto">
      {/* Columna izquierda: Conexion + Estado + Controles */}
      <div className="space-y-4">
        {/* Connection */}
        <div className="bg-background border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Badge variant={connected ? 'success' : 'destructive'} className="gap-1">
              {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {connected ? t('connected') : t('disconnected')}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={refreshPorts}
              disabled={loadingPorts}
              title={t('selectPort')}
            >
              <RefreshCw className={`h-3 w-3 ${loadingPorts ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">{t('port')}</label>
              <Select value={selectedPort} onValueChange={setSelectedPort} disabled={connected}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={t('selectPort')} />
                </SelectTrigger>
                <SelectContent>
                  {ports.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                  {ports.length === 0 && (
                    <SelectItem value="_none" disabled>
                      {t('selectPort')}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('baudRate')}</label>
              <Select value={baudRate.toString()} onValueChange={(v) => setBaudRate(parseInt(v))} disabled={connected}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9600">9600</SelectItem>
                  <SelectItem value="19200">19200</SelectItem>
                  <SelectItem value="38400">38400</SelectItem>
                  <SelectItem value="57600">57600</SelectItem>
                  <SelectItem value="115200">115200</SelectItem>
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

        {/* Machine state & Position */}
        <div className="bg-background border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('machineState')}</span>
            <Badge variant="outline">{machineState}</Badge>
          </div>
          <div className="bg-muted rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-xs font-medium cursor-pointer hover:underline"
                onClick={togglePosMode}
              >
                {posMode}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => serial.setZero()}
                disabled={!connected}
              >
                <Target className="h-3 w-3 mr-1" />
                {t('setZero')}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <span className="text-xs text-red-500 font-bold">X</span>
                <p className="text-sm font-mono">{position.x}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] w-full"
                  onClick={() => serial.setZero('x')}
                  disabled={!connected}
                >
                  X=0
                </Button>
              </div>
              <div>
                <span className="text-xs text-green-500 font-bold">Y</span>
                <p className="text-sm font-mono">{position.y}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] w-full"
                  onClick={() => serial.setZero('y')}
                  disabled={!connected}
                >
                  Y=0
                </Button>
              </div>
              <div>
                <span className="text-xs text-blue-500 font-bold">Z</span>
                <p className="text-sm font-mono">{position.z}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] w-full"
                  onClick={() => serial.setZero('z')}
                  disabled={!connected}
                >
                  Z=0
                </Button>
              </div>
            </div>
          </div>

          {/* Overrides */}
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <span>{t('feedOverride')}: {feedOverride}%</span>
            <span>{t('spindleOverride')}: {spindleOverride}%</span>
          </div>
        </div>

        {/* Quick controls */}
        <div className="bg-background border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-4 gap-1">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1"
              onClick={serial.home}
              disabled={!connected}
              title={t('home')}
            >
              <Home className="h-3 w-3" />
              {t('home')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1"
              onClick={serial.unlock}
              disabled={!connected}
              title={t('unlock')}
            >
              <Unlock className="h-3 w-3" />
              {t('unlock')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1"
              onClick={serial.reset}
              disabled={!connected}
              title={t('reset')}
            >
              <RotateCcw className="h-3 w-3" />
              {t('reset')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="text-xs gap-1"
              onClick={serial.stop}
              disabled={!connected}
              title={t('emergencyStop')}
            >
              <OctagonX className="h-3 w-3" />
              {t('stop')}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-1"
            onClick={serial.resume}
            disabled={!connected}
          >
            <Play className="h-3 w-3" />
            {t('resume')}
          </Button>
        </div>

        {/* Jog controls */}
        <div className="bg-background border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">{t('jog')}</h3>
          <div className="grid grid-cols-3 gap-1 max-w-[160px] mx-auto">
            <div />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10"
              onClick={() => serial.jogXY(0, jogDistance, jogSpeed)}
              disabled={!connected}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <div />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10"
              onClick={() => serial.jogXY(-jogDistance, 0, jogSpeed)}
              disabled={!connected}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10"
              onClick={serial.home}
              disabled={!connected}
            >
              <Home className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10"
              onClick={() => serial.jogXY(jogDistance, 0, jogSpeed)}
              disabled={!connected}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <div />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10"
              onClick={() => serial.jogXY(0, -jogDistance, jogSpeed)}
              disabled={!connected}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <div />
          </div>
          {/* Z axis */}
          <div className="flex items-center justify-center gap-2">
            <span className="text-xs text-blue-500 font-bold">Z</span>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => serial.jogZ(jogDistance, jogSpeed)}
              disabled={!connected}
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => serial.jogZ(-jogDistance, jogSpeed)}
              disabled={!connected}
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
          </div>

          {/* Distance & Speed */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">{t('jogDistance')} (mm)</label>
              <Select value={jogDistance.toString()} onValueChange={(v) => setJogDistance(parseFloat(v))}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.1">0.1</SelectItem>
                  <SelectItem value="0.5">0.5</SelectItem>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('jogSpeed')}</label>
              <Input
                type="number"
                value={jogSpeed}
                onChange={(e) => setJogSpeed(parseInt(e.target.value) || 1000)}
                className="h-8"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Columna derecha: Consola */}
      <div className="bg-background border rounded-lg flex flex-col h-[calc(100vh-8rem)]">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <span className="text-sm font-semibold">{t('console')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => useAppStore.getState().clearConsole()}
          >
            {t('clearConsole')}
          </Button>
        </div>
        <ScrollArea className="flex-1 p-2">
          <div className="space-y-0.5">
            {consoleLines.map((line, i) => (
              <p key={i} className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                {line}
              </p>
            ))}
          </div>
        </ScrollArea>
        <div className="flex items-center gap-1 p-2 border-t">
          <Input
            placeholder={t('command')}
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 text-xs font-mono"
            disabled={!connected}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSendCommand}
            disabled={!connected || !commandInput.trim()}
          >
            <Send className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
