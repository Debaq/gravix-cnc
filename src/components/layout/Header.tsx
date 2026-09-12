import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useSerial } from '@/hooks/useSerial'
import { useProject } from '@/hooks/useProject'
import { saveNow } from '@/lib/autosave'
import { useUpdateStore } from '@/stores/useUpdateStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  FilePlus,
  FolderOpen,
  Save,
  Loader2,
  Download,
  Pencil,
  Cog,
  Gamepad2,
  Wrench,
  Layers,
  HelpCircle,
  Languages,
  Wifi,
  WifiOff,
  RefreshCw,
  Minus,
  Square,
  X,
  Globe,
  KeyRound,
  ShieldCheck,
  Play,
  Wand2,
  Cpu,
} from 'lucide-react'
import { useMachineStore } from '@/stores/useMachineStore'
import type { PortInfo } from '@/lib/generated/PortInfo'
import { isTauri } from '@/lib/tauri'
import { getClientRole } from '@/lib/client-role'
import { useLicense } from '@/hooks/useLicense'
import { getTrialDaysLeft, isTrialActive } from '@/lib/trial'
import { GravixMark, GravixWordmark } from '@/components/brand/GravixLogo'
import { computeBBox, generateBoundaryGCode } from '@/components/modals/SetupWizardModal'
import type { Workspace } from '@/lib/types'

export function Header() {
  const { t, i18n } = useTranslation('header')
  const { t: ts } = useTranslation('serial')
  const { t: tl } = useTranslation('license')
  const { t: tp } = useTranslation('projects')
  const { t: tu } = useTranslation('updater')

  const {
    currentWorkspace,
    setWorkspace,
    setView,
    projectName,
    projectModified,
    activeProjectPath,
    saveState,
    lastSavedTime,
    openModal,
    language,
    setLanguage,
    addConsoleLine,
    controlOnly,
    setControlOnly,
  } = useAppStore()

  const { connected, sending, baudRate, setBaudRate } = useSerialStore()
  const updateInfo = useUpdateStore((s) => s.info)
  const updateAvailable = useUpdateStore((s) => s.status === 'available')
  const activeMachine = useMachineStore((s) =>
    s.machines.find((m) => m.id === s.activeMachineId) ?? null,
  )
  const { globalConfig } = useCanvasStore()
  const serial = useSerial()
  const project = useProject()
  const cm = useCanvasManager()

  const handleDryRun = useCallback(() => {
    if (!connected || sending) return
    const jobs = cm.getJobsForGCode()
    const elementBBox = computeBBox(jobs)
    const { workArea } = useCanvasStore.getState()
    const bbox = elementBBox ?? { minX: 0, minY: 0, maxX: workArea.width, maxY: workArea.height }
    const isLaser = globalConfig.operationType === 'laser'
    const gcode = generateBoundaryGCode(bbox, isLaser ? 'laser' : 'cnc', 5, 10)
    serial.sendGCode(gcode)
    addConsoleLine(elementBBox ? 'Prueba de area iniciada' : 'Prueba de area iniciada (area de trabajo completa)')
  }, [connected, sending, cm, globalConfig, serial, addConsoleLine])

  // Guardar: con proyecto activo escribe el .gravix; si no, cae al dialogo.
  const handleSave = useCallback(async () => {
    if (activeProjectPath) {
      await saveNow(true)
      return
    }
    await project.saveProject()
  }, [activeProjectPath, project])

  // Ctrl/Cmd+S. Se registra a nivel documento: el foco suele estar en el canvas.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  // Minuto a minuto para que el "hace N min" no se congele.
  const [savedTick, setSavedTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSavedTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const saveLabel = useMemo(() => {
    void savedTick
    if (!activeProjectPath) return ''
    if (saveState === 'saving') return tp('saving')
    if (saveState === 'error') return tp('saveFailedShort')
    if (!lastSavedTime) return ''
    const minutes = Math.floor((Date.now() - new Date(lastSavedTime).getTime()) / 60_000)
    return minutes < 1 ? tp('savedJustNow') : tp('savedMinutesAgo', { count: minutes })
  }, [activeProjectPath, saveState, lastSavedTime, tp, savedTick])

  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [loadingPorts, setLoadingPorts] = useState(false)
  const [appWindow, setAppWindow] = useState<{ minimize: () => void; toggleMaximize: () => void; close: () => void } | null>(null)
  const role = getClientRole()
  const { status: licenseStatus } = useLicense()
  const daysLeft = getTrialDaysLeft()
  const trialActive = isTrialActive()
  const isLicensed = licenseStatus?.is_valid ?? false

  useEffect(() => {
    if (isTauri()) {
      import('@tauri-apps/api/window').then((m) => setAppWindow(m.getCurrentWindow()))
    }
  }, [])

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
    if (popoverOpen) {
      refreshPorts()
    }
  }, [popoverOpen]) // Solo cuando se abre

  const handleConnect = async () => {
    if (connected) {
      await serial.disconnect()
    } else if (selectedPort) {
      await serial.connect(selectedPort, baudRate)
      setPopoverOpen(false)
    }
  }

  const workspaceButtons: { id: Workspace; icon: React.ReactNode; label: string }[] = [
    { id: 'cad', icon: <Pencil className="h-4 w-4" />, label: t('cad') },
    { id: 'cam', icon: <Cog className="h-4 w-4" />, label: t('cam') },
    { id: 'cnc', icon: <Gamepad2 className="h-4 w-4" />, label: t('cnc') },
  ]

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang)
    i18n.changeLanguage(lang)
  }

  return (
    <header className="flex items-center justify-between h-12 px-3 bg-primary text-primary-foreground border-b select-none overflow-x-auto overflow-y-hidden" {...(isTauri() ? { 'data-tauri-drag-region': true } : {})}>
      {/* Left: Project actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-white/10 transition-colors"
          title={t('backToProjects')}
          onClick={() => { setControlOnly(false); setView('projects') }}
        >
          <GravixMark size={22} />
          <GravixWordmark size={14} variant="dark" />
        </button>

        {!controlOnly && (
          <>
            <Separator orientation="vertical" className="h-6 bg-primary-foreground/30 mx-0.5" />
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary/80"
              title={t('newProject')}
              onClick={project.newProject}
            >
              <FilePlus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary/80"
              title={t('openProject')}
              onClick={project.loadProject}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary/80"
              title={activeProjectPath ? tp('saveNow') : t('saveProject')}
              onClick={handleSave}
              disabled={saveState === 'saving'}
              aria-busy={saveState === 'saving'}
            >
              {saveState === 'saving' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-primary-foreground hover:bg-primary/80"
                  title={t('export') || 'Exportar'}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => cm.exportSVG()}>
                  Exportar SVG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => cm.exportDXF()}>
                  Exportar DXF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Separator orientation="vertical" className="h-6 bg-primary-foreground/30 mx-1" />

            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate max-w-[180px]">
                {projectName}
                {projectModified && <span className="ml-1 text-yellow-300">*</span>}
              </span>
              <span
                className={`text-[10px] truncate max-w-[180px] ${
                  saveState === 'error' ? 'text-red-300' : 'text-primary-foreground/60'
                }`}
                role="status"
                aria-live="polite"
              >
                {saveLabel}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Center: Workspace tabs */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1 bg-primary/60 rounded-lg p-0.5">
          {controlOnly ? (
            <Button variant="secondary" size="sm" className="gap-1.5">
              <Gamepad2 className="h-4 w-4" />
              {t('cnc')}
            </Button>
          ) : (
            workspaceButtons.map((ws) => (
              <Button
                key={ws.id}
                variant={currentWorkspace === ws.id ? 'secondary' : 'ghost'}
                size="sm"
                className={
                  currentWorkspace === ws.id
                    ? 'gap-1.5'
                    : 'gap-1.5 text-primary-foreground hover:bg-primary/80'
                }
                onClick={() => setWorkspace(ws.id)}
              >
                {ws.icon}
                {ws.label}
              </Button>
            ))
          )}
        </div>
        {controlOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-primary-foreground hover:bg-primary/80"
            onClick={() => {
              setControlOnly(false)
              setView('projects')
              openModal('newProject')
            }}
          >
            <FilePlus className="h-4 w-4" />
            {t('newProject')}
          </Button>
        )}
      </div>

      {/* Right: Library + Connection + Language */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Biblioteca: Herramientas + Materiales */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary/80"
              title={t('library')}
            >
              <Layers className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openModal('tools')}>
              <Wrench className="h-4 w-4 mr-2" />
              {t('tools')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openModal('materials')}>
              <Layers className="h-4 w-4 mr-2" />
              {t('materials')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openModal('machines')}>
              <Cpu className="h-4 w-4 mr-2" />
              Máquinas
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Preparar máquina */}
        <Button
          variant="ghost"
          size="icon"
          className="text-primary-foreground hover:bg-primary/80"
          onClick={() => openModal('setupWizard')}
          title={t('setupWizard')}
        >
          <Wand2 className="h-4 w-4" />
        </Button>

        {/* Probar area */}
        <Button
          variant="ghost"
          size="icon"
          className={`hover:bg-primary/80 ${connected ? 'text-primary-foreground' : 'text-primary-foreground/40'}`}
          onClick={handleDryRun}
          disabled={!connected || sending}
          title={t('dryRun')}
        >
          <Play className="h-4 w-4" />
        </Button>

        {/* Red: solo icono */}
        {isTauri() && (
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground hover:bg-primary/80"
            onClick={() => openModal('networkServer')}
            title={t('networkServer')}
          >
            <Globe className="h-4 w-4" />
          </Button>
        )}

        <Separator orientation="vertical" className="h-6 bg-primary-foreground/30 mx-1" />

        {/* Badge máquina activa */}
        <button
          onClick={() => openModal('machines')}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium hover:bg-primary/80 transition-colors max-w-[180px]"
          title={activeMachine ? `${activeMachine.name} · ${activeMachine.firmware}` : 'Configurar máquinas'}
        >
          <Cpu className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {activeMachine?.name ?? 'Sin máquina'}
          </span>
          {activeMachine && (
            <span className="text-[10px] uppercase opacity-70 shrink-0">
              {activeMachine.firmware}
            </span>
          )}
        </button>

        {/* Conexión máquina: solo icono */}
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`${connected ? 'text-green-400' : 'text-red-400'} hover:bg-primary/80`}
              title={connected ? ts('connected') : ts('disconnected')}
            >
              {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{ts('port')}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={refreshPorts}
                  disabled={loadingPorts}
                >
                  <RefreshCw className={`h-3 w-3 ${loadingPorts ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <Select value={selectedPort} onValueChange={setSelectedPort} disabled={connected}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={ts('selectPort')} />
                </SelectTrigger>
                <SelectContent>
                  {ports.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                  {ports.length === 0 && (
                    <SelectItem value="_none" disabled>
                      {ts('selectPort')}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <div>
                <span className="text-xs text-muted-foreground">{ts('baudRate')}</span>
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
              <Button
                className="w-full"
                variant={connected ? 'destructive' : 'default'}
                size="sm"
                onClick={handleConnect}
              >
                {connected ? ts('disconnect') : ts('connect')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Language */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary/80">
              <Languages className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleLanguageChange('es')}>
              {language === 'es' ? '* ' : ''}Espanol
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleLanguageChange('en')}>
              {language === 'en' ? '* ' : ''}English
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Update disponible — solo aparece cuando hay algo que instalar */}
        {updateAvailable && updateInfo && (
          <button
            onClick={() => openModal('updater')}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-sky-200 hover:bg-sky-500/20 transition-colors"
            title={tu('newVersion', { version: updateInfo.version })}
          >
            <Download className="h-3.5 w-3.5" />
            {updateInfo.version}
          </button>
        )}

        {/* License status */}
        <button
          onClick={() => openModal('license')}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
            isLicensed
              ? 'text-green-300 hover:bg-green-500/20'
              : trialActive
                ? 'text-yellow-300 hover:bg-yellow-500/20'
                : 'text-red-300 hover:bg-red-500/20'
          }`}
          title={isLicensed ? tl('licensedTo', { email: licenseStatus?.email }) : tl('trialActive', { days: daysLeft })}
        >
          {isLicensed ? (
            <>
              <ShieldCheck className="h-3.5 w-3.5" />
              Pro
            </>
          ) : (
            <>
              <KeyRound className="h-3.5 w-3.5" />
              {trialActive ? `${daysLeft}d` : tl('activate')}
            </>
          )}
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="text-primary-foreground hover:bg-primary/80"
          onClick={() => openModal('help')}
          title={t('help')}
        >
          <HelpCircle className="h-4 w-4" />
        </Button>

        {appWindow && (
          <>
            <Separator orientation="vertical" className="h-6 bg-primary-foreground/30 mx-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-primary-foreground hover:bg-primary/80"
              onClick={() => appWindow.minimize()}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-primary-foreground hover:bg-primary/80"
              onClick={() => appWindow.toggleMaximize()}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-primary-foreground hover:bg-destructive/80"
              onClick={async () => {
                // El X destruye el webview: `beforeunload` no es confiable aca,
                // asi que lo pendiente se escribe antes de cerrar.
                await saveNow()
                appWindow.close()
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        )}

        {role === 'remote' && (
          <Badge variant="outline" className="ml-1 text-xs text-yellow-300 border-yellow-300/50">
            Remoto
          </Badge>
        )}
      </div>
    </header>
  )
}
