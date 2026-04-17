import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { isTauri, tauriInvoke } from '@/lib/tauri'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Globe,
  Play,
  Square,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Copy,
  RefreshCw,
  Loader2,
  Shield,
  Wifi,
} from 'lucide-react'

interface ServerStatus {
  running: boolean
  port: number
  ips: string[]
}

export function NetworkServerModal() {
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const isOpen = activeModal === 'networkServer'

  const [port, setPort] = useState(3333)
  const [status, setStatus] = useState<ServerStatus>({ running: false, port: 0, ips: [] })
  const [portAvailable, setPortAvailable] = useState<boolean | null>(null)
  const [firewallTips, setFirewallTips] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)

  const refreshStatus = useCallback(async () => {
    if (!isTauri()) return
    try {
      const s = await tauriInvoke<ServerStatus>('get_server_status')
      setStatus(s)
      if (s.running && s.port) {
        setPort(s.port)
      }
    } catch {
      // Puede no existir aún
    }
  }, [])

  const checkPort = useCallback(async () => {
    if (!isTauri()) return
    setChecking(true)
    try {
      const available = await tauriInvoke<boolean>('check_port', { port })
      setPortAvailable(available)
    } catch {
      setPortAvailable(null)
    }
    setChecking(false)
  }, [port])

  const checkFirewall = useCallback(async () => {
    if (!isTauri()) return
    try {
      const tips = await tauriInvoke<string[]>('check_firewall', { port })
      setFirewallTips(tips)
    } catch {
      setFirewallTips(['No se pudo verificar el firewall'])
    }
  }, [port])

  useEffect(() => {
    if (isOpen) {
      refreshStatus()
      checkPort()
      checkFirewall()
    }
  }, [isOpen, refreshStatus, checkPort, checkFirewall])

  // Polling de estado mientras está abierto
  useEffect(() => {
    if (!isOpen || !status.running) return
    const interval = setInterval(refreshStatus, 3000)
    return () => clearInterval(interval)
  }, [isOpen, status.running, refreshStatus])

  // Re-check puerto cuando cambia
  useEffect(() => {
    if (isOpen && !status.running) {
      const timer = setTimeout(checkPort, 300)
      return () => clearTimeout(timer)
    }
  }, [port, isOpen, status.running, checkPort])

  const handleStart = async () => {
    setLoading(true)
    try {
      await tauriInvoke('start_web_server', { port })
      addConsoleLine(`Servidor de red iniciado en puerto ${port}`)
      await refreshStatus()
      await checkFirewall()
    } catch (err) {
      addConsoleLine(`Error iniciando servidor: ${err}`)
    }
    setLoading(false)
  }

  const handleStop = async () => {
    setLoading(true)
    try {
      await tauriInvoke('stop_web_server')
      addConsoleLine('Servidor de red detenido')
      // Esperar a que se detenga
      setTimeout(refreshStatus, 500)
    } catch (err) {
      addConsoleLine(`Error deteniendo servidor: ${err}`)
    }
    setLoading(false)
  }

  const copyUrl = (ip: string) => {
    const url = `http://${ip}:${status.port}`
    navigator.clipboard.writeText(url)
    addConsoleLine(`URL copiada: ${url}`)
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Servidor de Red
          </DialogTitle>
          <DialogDescription>
            Permite acceder al diseño y cola de trabajos desde otros equipos en la red local.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Estado actual */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
            <div className="flex items-center gap-2">
              {status.running ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="font-medium">
                {status.running ? 'Activo' : 'Detenido'}
              </span>
            </div>
            {status.running && (
              <Badge variant="outline" className="text-green-600 border-green-600/30">
                Puerto {status.port}
              </Badge>
            )}
          </div>

          {/* Puerto */}
          {!status.running && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Puerto</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value) || 3333)}
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={checkPort} disabled={checking}>
                  {checking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {portAvailable !== null && (
                <div className={`flex items-center gap-1 text-xs ${portAvailable ? 'text-green-600' : 'text-red-500'}`}>
                  {portAvailable ? (
                    <>
                      <CheckCircle className="h-3 w-3" />
                      Puerto {port} disponible
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3" />
                      Puerto {port} ocupado — elige otro
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Botón Start/Stop */}
          <Button
            className="w-full gap-2"
            variant={status.running ? 'destructive' : 'default'}
            onClick={status.running ? handleStop : handleStart}
            disabled={loading || (!status.running && portAvailable === false)}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : status.running ? (
              <Square className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {loading
              ? status.running ? 'Deteniendo...' : 'Iniciando...'
              : status.running ? 'Detener servidor' : 'Iniciar servidor'}
          </Button>

          {/* URLs de acceso */}
          {status.running && status.ips.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Wifi className="h-4 w-4" />
                Acceder desde otro equipo
              </label>
              <div className="space-y-1">
                {status.ips.map((ip) => (
                  <div
                    key={ip}
                    className="flex items-center justify-between p-2 rounded bg-muted text-sm font-mono"
                  >
                    <span>http://{ip}:{status.port}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => copyUrl(ip)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Firewall */}
          {firewallTips.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Shield className="h-4 w-4" />
                Firewall
              </label>
              <div className="space-y-1">
                {firewallTips.map((tip, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 text-xs p-2 rounded ${
                      tip.includes('OK') || tip.includes('permitido') || tip.includes('inactivo')
                        ? 'bg-green-500/10 text-green-600'
                        : tip.includes('Ejecutar') || tip.includes('Agregar')
                          ? 'bg-yellow-500/10 text-yellow-600'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {tip.includes('OK') || tip.includes('permitido') || tip.includes('inactivo') ? (
                      <CheckCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    ) : tip.includes('Ejecutar') || tip.includes('Agregar') ? (
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    ) : null}
                    <span className="break-all">{tip}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info de seguridad */}
          <p className="text-xs text-muted-foreground">
            Los equipos remotos pueden diseñar y crear trabajos. El control de la
            máquina (jog, corte, emergencia) solo funciona en este equipo.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
