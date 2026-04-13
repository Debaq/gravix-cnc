import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useSerial } from '@/hooks/useSerial'
import { useProject } from '@/hooks/useProject'
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
  Pencil,
  Eye,
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
} from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Workspace } from '@/lib/types'

export function Header() {
  const { t } = useTranslation('header')
  const { t: ts } = useTranslation('serial')

  const {
    currentWorkspace,
    setWorkspace,
    projectName,
    projectModified,
    openModal,
    language,
    setLanguage,
  } = useAppStore()

  const { connected, baudRate, setBaudRate } = useSerialStore()
  const serial = useSerial()
  const project = useProject()

  const [ports, setPorts] = useState<{ name: string; port_type: string }[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [popoverOpen, setPopoverOpen] = useState(false)
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
    { id: 'design', icon: <Pencil className="h-4 w-4" />, label: t('design') },
    { id: 'preview', icon: <Eye className="h-4 w-4" />, label: t('preview') },
    { id: 'control', icon: <Gamepad2 className="h-4 w-4" />, label: t('control') },
  ]

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang)
    import('@/i18n/index').then((i18nModule) => {
      i18nModule.default.changeLanguage(lang)
    })
  }

  const appWindow = getCurrentWindow()

  return (
    <header className="flex items-center justify-between h-12 px-3 bg-primary text-primary-foreground border-b select-none" data-tauri-drag-region>
      {/* Left: Project actions */}
      <div className="flex items-center gap-1">
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
          title={t('saveProject')}
          onClick={project.saveProject}
        >
          <Save className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-6 bg-primary-foreground/30 mx-1" />

        <span className="text-sm font-medium truncate max-w-[180px]">
          {projectName}
          {projectModified && <span className="ml-1 text-yellow-300">*</span>}
        </span>
      </div>

      {/* Center: Workspace tabs */}
      <div className="flex items-center gap-1 bg-primary/60 rounded-lg p-0.5">
        {workspaceButtons.map((ws) => (
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
        ))}
      </div>

      {/* Right: Config + Connection + Language */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-primary-foreground hover:bg-primary/80"
          onClick={() => openModal('tools')}
        >
          <Wrench className="h-4 w-4" />
          <span className="hidden lg:inline">{t('tools')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-primary-foreground hover:bg-primary/80"
          onClick={() => openModal('materials')}
        >
          <Layers className="h-4 w-4" />
          <span className="hidden lg:inline">{t('materials')}</span>
        </Button>

        <Separator orientation="vertical" className="h-6 bg-primary-foreground/30 mx-1" />

        {/* Connection status with popover */}
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Badge variant={connected ? 'success' : 'destructive'} className="gap-1 cursor-pointer">
              {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {connected ? ts('connected') : ts('disconnected')}
            </Badge>
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

        <Button
          variant="ghost"
          size="icon"
          className="text-primary-foreground hover:bg-primary/80"
          onClick={() => openModal('help')}
          title={t('help')}
        >
          <HelpCircle className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-6 bg-primary-foreground/30 mx-1" />

        {/* Window controls */}
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
          onClick={() => appWindow.close()}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
