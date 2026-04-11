import { useTranslation } from 'react-i18next'
import { useSerialStore } from '@/stores/useSerialStore'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
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
} from 'lucide-react'

export function ControlPanel() {
  const { t } = useTranslation('serial')

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

  const { addConsoleLine } = useAppStore()

  return (
    <div className="space-y-4">
      {/* Connection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Badge variant={connected ? 'success' : 'destructive'} className="gap-1">
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? t('connected') : t('disconnected')}
          </Badge>
          <Select value={baudRate.toString()} onValueChange={(v) => setBaudRate(parseInt(v))}>
            <SelectTrigger className="w-28 h-8">
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
        <Button
          className="w-full"
          variant={connected ? 'destructive' : 'default'}
          size="sm"
          onClick={() => addConsoleLine(connected ? 'Desconectando...' : 'Conectando...')}
        >
          {connected ? t('disconnect') : t('connect')}
        </Button>
      </div>

      <Separator />

      {/* Machine state & Position */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('machineState')}</span>
          <Badge variant="outline">{machineState}</Badge>
        </div>
        <div className="bg-muted rounded-md p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium cursor-pointer" onClick={togglePosMode}>
              {posMode}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <span className="text-xs text-red-500 font-bold">X</span>
              <p className="text-sm font-mono">{position.x}</p>
            </div>
            <div>
              <span className="text-xs text-green-500 font-bold">Y</span>
              <p className="text-sm font-mono">{position.y}</p>
            </div>
            <div>
              <span className="text-xs text-blue-500 font-bold">Z</span>
              <p className="text-sm font-mono">{position.z}</p>
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Quick controls */}
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-1">
          <Button variant="outline" size="sm" className="text-xs" title={t('home')}>
            <Home className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="sm" className="text-xs" title={t('unlock')}>
            <Unlock className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="sm" className="text-xs" title={t('reset')}>
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button variant="destructive" size="sm" className="text-xs" title={t('emergencyStop')}>
            <OctagonX className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <Separator />

      {/* Jog controls */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('jog')}</h3>
        <div className="grid grid-cols-3 gap-1 max-w-[160px] mx-auto">
          <div />
          <Button variant="outline" size="icon" className="h-10 w-10">
            <ArrowUp className="h-4 w-4" />
          </Button>
          <div />
          <Button variant="outline" size="icon" className="h-10 w-10">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-10 w-10">
            <Home className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="icon" className="h-10 w-10">
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div />
          <Button variant="outline" size="icon" className="h-10 w-10">
            <ArrowDown className="h-4 w-4" />
          </Button>
          <div />
        </div>
        {/* Z axis */}
        <div className="flex items-center justify-center gap-2">
          <span className="text-xs text-blue-500 font-bold">Z</span>
          <Button variant="outline" size="sm" className="h-8">
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="sm" className="h-8">
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
  )
}
