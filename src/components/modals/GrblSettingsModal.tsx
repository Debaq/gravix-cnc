import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useSerial } from '@/hooks/useSerial'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Save, Upload } from 'lucide-react'

// GRBL setting definitions with human-readable descriptions
const GRBL_SETTINGS: Record<string, { name: string; unit: string; group: string }> = {
  '$0': { name: 'Step pulse time', unit: 'µs', group: 'general' },
  '$1': { name: 'Step idle delay', unit: 'ms', group: 'general' },
  '$2': { name: 'Step port invert mask', unit: 'mask', group: 'general' },
  '$3': { name: 'Direction port invert mask', unit: 'mask', group: 'general' },
  '$4': { name: 'Step enable invert', unit: 'bool', group: 'general' },
  '$5': { name: 'Limit pins invert', unit: 'bool', group: 'general' },
  '$6': { name: 'Probe pin invert', unit: 'bool', group: 'general' },
  '$10': { name: 'Status report options', unit: 'mask', group: 'general' },
  '$11': { name: 'Junction deviation', unit: 'mm', group: 'general' },
  '$12': { name: 'Arc tolerance', unit: 'mm', group: 'general' },
  '$13': { name: 'Report in inches', unit: 'bool', group: 'general' },
  '$20': { name: 'Soft limits enable', unit: 'bool', group: 'limits' },
  '$21': { name: 'Hard limits enable', unit: 'bool', group: 'limits' },
  '$22': { name: 'Homing cycle enable', unit: 'bool', group: 'homing' },
  '$23': { name: 'Homing direction invert mask', unit: 'mask', group: 'homing' },
  '$24': { name: 'Homing locate feed rate', unit: 'mm/min', group: 'homing' },
  '$25': { name: 'Homing search seek rate', unit: 'mm/min', group: 'homing' },
  '$26': { name: 'Homing switch debounce', unit: 'ms', group: 'homing' },
  '$27': { name: 'Homing switch pull-off', unit: 'mm', group: 'homing' },
  '$30': { name: 'Max spindle speed', unit: 'RPM', group: 'spindle' },
  '$31': { name: 'Min spindle speed', unit: 'RPM', group: 'spindle' },
  '$32': { name: 'Laser mode enable', unit: 'bool', group: 'spindle' },
  '$100': { name: 'X steps/mm', unit: 'steps/mm', group: 'axes' },
  '$101': { name: 'Y steps/mm', unit: 'steps/mm', group: 'axes' },
  '$102': { name: 'Z steps/mm', unit: 'steps/mm', group: 'axes' },
  '$110': { name: 'X max rate', unit: 'mm/min', group: 'axes' },
  '$111': { name: 'Y max rate', unit: 'mm/min', group: 'axes' },
  '$112': { name: 'Z max rate', unit: 'mm/min', group: 'axes' },
  '$120': { name: 'X acceleration', unit: 'mm/s²', group: 'axes' },
  '$121': { name: 'Y acceleration', unit: 'mm/s²', group: 'axes' },
  '$122': { name: 'Z acceleration', unit: 'mm/s²', group: 'axes' },
  '$130': { name: 'X max travel', unit: 'mm', group: 'limits' },
  '$131': { name: 'Y max travel', unit: 'mm', group: 'limits' },
  '$132': { name: 'Z max travel', unit: 'mm', group: 'limits' },
}

const GROUP_LABELS: Record<string, string> = {
  axes: 'Ejes (Steps, Velocidad, Aceleración)',
  limits: 'Límites y Recorrido',
  homing: 'Homing',
  spindle: 'Spindle / Láser',
  general: 'General',
}

const GROUP_ORDER = ['axes', 'limits', 'homing', 'spindle', 'general']

interface SettingEntry {
  key: string
  value: string
  original: string
}

export function GrblSettingsModal() {
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const { connected } = useSerialStore()
  const serial = useSerial()
  const isOpen = activeModal === 'grblSettings'

  const [settings, setSettings] = useState<SettingEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)

  const readSettings = useCallback(async () => {
    if (!connected) {
      addConsoleLine('GRBL Settings: no conectado')
      return
    }
    setLoading(true)

    // Send $$ and collect responses via console listener
    // We'll parse console lines for settings format: $N=V
    const collected: SettingEntry[] = []
    const timeout = setTimeout(() => {
      setSettings(collected)
      setLoading(false)
      setDirty(false)
    }, 1500)

    // Temporary listener for $$ response
    const originalLines = useAppStore.getState().consoleLines.length
    await serial.sendCommand('$$')

    // Poll for response (settings come as serial:data events)
    const pollInterval = setInterval(() => {
      const lines = useAppStore.getState().consoleLines
      const newLines = lines.slice(originalLines)
      let foundSettings = false

      for (const line of newLines) {
        // Strip timestamp prefix: [HH:MM:SS] $N=V
        const match = line.match(/\$(\d+)=([0-9.]+)/)
        if (match) {
          foundSettings = true
          const key = `$${match[1]}`
          const val = match[2]
          // Avoid duplicates
          if (!collected.find(s => s.key === key)) {
            collected.push({ key, value: val, original: val })
          }
        }
      }

      // If we found settings and got 'ok', we're done
      if (foundSettings && newLines.some(l => l.includes('ok'))) {
        clearInterval(pollInterval)
        clearTimeout(timeout)
        // Sort by setting number
        collected.sort((a, b) => {
          const na = parseInt(a.key.slice(1))
          const nb = parseInt(b.key.slice(1))
          return na - nb
        })
        setSettings(collected)
        setLoading(false)
        setDirty(false)

        // Sync machine limits to serial store
        const getVal = (k: string) => {
          const s = collected.find(e => e.key === k)
          return s ? parseFloat(s.value) : undefined
        }
        const x = getVal('$130'), y = getVal('$131'), z = getVal('$132')
        if (x !== undefined && y !== undefined && z !== undefined) {
          useSerialStore.getState().setMaxTravel({ x, y, z })
        }
        const sl = getVal('$20')
        if (sl !== undefined) {
          useSerialStore.getState().setSoftLimitsEnabled(sl === 1)
        }
      }
    }, 200)

    // Cleanup after timeout
    setTimeout(() => clearInterval(pollInterval), 2000)
  }, [connected, serial, addConsoleLine])

  useEffect(() => {
    if (isOpen && connected) {
      readSettings()
    }
  }, [isOpen, connected])

  const handleChange = (key: string, newValue: string) => {
    setSettings(prev => prev.map(s =>
      s.key === key ? { ...s, value: newValue } : s
    ))
    setDirty(true)
  }

  const handleSave = async () => {
    const changed = settings.filter(s => s.value !== s.original)
    if (changed.length === 0) return

    for (const s of changed) {
      await serial.sendCommand(`${s.key}=${s.value}`)
      addConsoleLine(`GRBL: ${s.key}=${s.value}`)
      // Small delay between settings
      await new Promise(r => setTimeout(r, 100))
    }

    addConsoleLine(`GRBL: ${changed.length} ajustes guardados`)
    // Re-read to confirm
    setTimeout(() => readSettings(), 500)
  }

  const modifiedCount = settings.filter(s => s.value !== s.original).length

  // Group settings
  const grouped = new Map<string, SettingEntry[]>()
  for (const s of settings) {
    const def = GRBL_SETTINGS[s.key]
    const group = def?.group || 'general'
    const arr = grouped.get(group) || []
    arr.push(s)
    grouped.set(group, arr)
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            GRBL Settings ($$)
            {!connected && <Badge variant="destructive">Desconectado</Badge>}
          </DialogTitle>
          <DialogDescription>
            Configuración del firmware GRBL. Los cambios se escriben directamente en EEPROM.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={readSettings}
            disabled={!connected || loading}
            className="gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Leer
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={!connected || !dirty || modifiedCount === 0}
            className="gap-1"
          >
            <Save className="h-3 w-3" />
            Guardar ({modifiedCount})
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          {settings.length === 0 && !loading && (
            <div className="text-center text-muted-foreground py-8 text-sm">
              {connected ? 'Presiona "Leer" para obtener configuración' : 'Conecta la máquina primero'}
            </div>
          )}

          {loading && (
            <div className="text-center text-muted-foreground py-8 text-sm">
              Leyendo configuración GRBL...
            </div>
          )}

          {GROUP_ORDER.map(group => {
            const items = grouped.get(group)
            if (!items || items.length === 0) return null
            return (
              <div key={group} className="mb-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                  {GROUP_LABELS[group] || group}
                </h4>
                <div className="space-y-1">
                  {items.map(s => {
                    const def = GRBL_SETTINGS[s.key]
                    const modified = s.value !== s.original
                    return (
                      <div
                        key={s.key}
                        className={`flex items-center gap-2 rounded px-2 py-1 ${modified ? 'bg-yellow-500/10 border border-yellow-500/30' : 'hover:bg-muted/50'}`}
                      >
                        <span className="text-xs font-mono font-bold w-8 shrink-0 text-muted-foreground">
                          {s.key}
                        </span>
                        <span className="text-xs flex-1 truncate" title={def?.name}>
                          {def?.name || 'Unknown'}
                        </span>
                        <Input
                          type="text"
                          value={s.value}
                          onChange={e => handleChange(s.key, e.target.value)}
                          className="h-6 w-24 text-xs font-mono text-right"
                        />
                        <span className="text-[10px] text-muted-foreground w-14 truncate">
                          {def?.unit || ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
