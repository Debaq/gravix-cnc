import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useWorkspaceStore, type ProjectMeta } from '@/stores/useWorkspaceStore'
import { isTauri, tauriInvoke } from '@/lib/tauri'
import { toast, errorDetail } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Plus,
  FolderOpen,
  Drill,
  Zap,
  Scissors,
  PenTool,
  Trash2,
  Languages,
  HelpCircle,
  ChevronRight,
  ChevronDown,
  Minus,
  Square,
  X,
  KeyRound,
  ShieldCheck,
  Globe,
  Wrench,
  Layers,
  Wand2,
  Gamepad2,
  RefreshCw,
} from 'lucide-react'
import { GravixMark, GravixWordmark } from '@/components/brand/GravixLogo'
import { useLicense } from '@/hooks/useLicense'
import { useUpdateStore } from '@/stores/useUpdateStore'
import { getTrialDaysLeft, isTrialActive } from '@/lib/trial'
import type { OperationType } from '@/lib/types'

const MACHINE_TYPES: {
  id: OperationType
  icon: React.ReactNode
  selectedIcon: React.ReactNode
  idle: string
  active: string
}[] = [
  {
    id: 'cnc',
    icon: <Drill className="h-6 w-6" />,
    selectedIcon: <Drill className="h-7 w-7" />,
    idle: 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
    active: 'border-[oklch(0.45_0.12_240)] bg-[oklch(0.95_0.03_240)] text-[oklch(0.38_0.1_240)]',
  },
  {
    id: 'laser',
    icon: <Zap className="h-6 w-6" />,
    selectedIcon: <Zap className="h-7 w-7" />,
    idle: 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
    active: 'border-accent bg-[oklch(0.96_0.04_27)] text-[oklch(0.45_0.18_27)]',
  },
  {
    id: 'plotter',
    icon: <Scissors className="h-6 w-6" />,
    selectedIcon: <Scissors className="h-7 w-7" />,
    idle: 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
    active: 'border-[oklch(0.35_0.1_160)] bg-[oklch(0.95_0.04_160)] text-[oklch(0.35_0.1_160)]',
  },
  {
    id: 'pencil',
    icon: <PenTool className="h-6 w-6" />,
    selectedIcon: <PenTool className="h-7 w-7" />,
    idle: 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
    active: 'border-[oklch(0.45_0.12_60)] bg-[oklch(0.96_0.05_80)] text-[oklch(0.45_0.12_60)]',
  },
]

const WORK_AREA_PRESETS = [
  { label: '200×200', w: 200, h: 200 },
  { label: '300×300', w: 300, h: 300 },
  { label: '300×400', w: 300, h: 400 },
  { label: '400×400', w: 400, h: 400 },
  { label: '500×500', w: 500, h: 500 },
  { label: '600×400', w: 600, h: 400 },
]

const MACHINE_ICON_SMALL: Record<string, React.ReactNode> = {
  cnc: <Drill className="h-4 w-4" />,
  laser: <Zap className="h-4 w-4" />,
  plotter: <Scissors className="h-4 w-4" />,
  pencil: <PenTool className="h-4 w-4" />,
}

const MACHINE_BADGE_STYLE: Record<string, string> = {
  cnc: 'bg-[oklch(0.95_0.03_240)] text-[oklch(0.38_0.1_240)] border-[oklch(0.45_0.12_240)]/30',
  laser: 'bg-[oklch(0.96_0.04_27)] text-[oklch(0.45_0.18_27)] border-accent/30',
  plotter: 'bg-[oklch(0.95_0.04_160)] text-[oklch(0.35_0.1_160)] border-[oklch(0.35_0.1_160)]/30',
  pencil: 'bg-[oklch(0.96_0.05_80)] text-[oklch(0.45_0.12_60)] border-[oklch(0.45_0.12_60)]/30',
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'proyecto'
}

export function ProjectsScreen() {
  const { t, i18n } = useTranslation('projects')
  const { t: tl } = useTranslation('license')
  const { t: tu } = useTranslation('updater')

  const {
    setView,
    setWorkspace,
    setProjectName,
    setProjectOperationType,
    language,
    setLanguage,
    openModal,
    activeModal,
    closeModal,
    setControlOnly,
  } = useAppStore()

  const { setWorkArea, setGlobalConfig, globalConfig } = useCanvasStore()
  const { clearGCode } = useGCodeStore()
  const { tools, materials } = useLibraryStore()
  const { path: workspacePath, projects, pick: pickWorkspace, refresh } = useWorkspaceStore()
  const { status: licenseStatus } = useLicense()
  const checkUpdate = useUpdateStore((s) => s.check)
  const updateStatus = useUpdateStore((s) => s.status)
  const daysLeft = getTrialDaysLeft()
  const trialActive = isTrialActive()
  const isLicensed = licenseStatus?.is_valid ?? false

  const [appWindow, setAppWindow] = useState<{
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
  } | null>(null)

  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<OperationType>('cnc')
  const [newWidth, setNewWidth] = useState(300)
  const [newHeight, setNewHeight] = useState(300)
  const [newTool, setNewTool] = useState('')
  const [newMaterial, setNewMaterial] = useState('')

  useEffect(() => {
    if (isTauri()) {
      import('@tauri-apps/api/window').then((m) => setAppWindow(m.getCurrentWindow()))
    }
  }, [])

  useEffect(() => {
    if (activeModal === 'newProject') {
      setNewName('')
      setNewType('cnc')
      setNewWidth(300)
      setNewHeight(300)
      setNewTool('')
      setNewMaterial('')
      setShowNewDialog(true)
      closeModal()
    }
  }, [activeModal, closeModal])

  const filteredTools = tools.filter((t) => t.category === newType)
  const filteredMaterials = materials

  const handleCreate = useCallback(async () => {
    const name = newName.trim() || t('projectNamePlaceholder')
    const filename = sanitizeFilename(name) + '.gravix'
    const filePath = workspacePath ? `${workspacePath}/${filename}` : filename

    // Limpiar canvas
    const { setElements, setSheets, clearGuides } = useCanvasStore.getState()
    setElements([])
    setSheets([])
    clearGuides()
    clearGCode()

    // Configurar proyecto
    setProjectName(name)
    setProjectOperationType(newType)
    setWorkArea({ width: newWidth, height: newHeight, origin: 'bottom-left' })
    setGlobalConfig({
      ...globalConfig,
      operationType: newType,
      tool: newTool || globalConfig.tool,
      material: newMaterial || globalConfig.material,
    })

    // Guardar archivo .gravix
    const now = Math.floor(Date.now() / 1000)
    const projectData = JSON.stringify({
      name,
      mode: newType,
      width: newWidth,
      height: newHeight,
      version: '1.0.0',
      created_at: now,
      updated_at: now,
      elements: [],
      operations: [],
      materials: [],
    }, null, 2)

    if (isTauri()) {
      try {
        await tauriInvoke('save_gravix_project', { path: filePath, data: projectData })
      } catch (err) {
        // Si el .gravix no se escribió no hay proyecto: quedarse en el listado
        // es menos dañino que abrir un editor sobre un archivo inexistente.
        toast.error(t('projectSaveFailed'), { detail: errorDetail(err) })
        return
      }
      await refresh()
      toast.success(t('projectCreated'), { detail: name })
    }

    // Guardar path activo para saber qué archivo estamos editando
    useAppStore.getState().setActiveProjectPath(filePath, now)
    setShowNewDialog(false)
    setView('workspace')
  }, [newName, newType, newWidth, newHeight, newTool, newMaterial, t, globalConfig, workspacePath, setProjectName, setProjectOperationType, setWorkArea, setGlobalConfig, clearGCode, refresh, setView])

  const handleOpenProject = useCallback(async (proj: ProjectMeta) => {
    let createdAt: number | null = null
    if (isTauri()) {
      try {
        const raw = await tauriInvoke<string>('load_gravix_project', { path: proj.path })
        const data = JSON.parse(raw)

        setProjectName(data.name || proj.name)
        setProjectOperationType(data.mode as OperationType || 'cnc')
        setWorkArea({
          width: data.width || 300,
          height: data.height || 300,
          origin: 'bottom-left',
        })
        // Lo guardado manda sobre el default: si el proyecto trae su config de
        // herramienta y material, restaurarla o el G-code sale con otra.
        setGlobalConfig({
          ...globalConfig,
          ...(data.globalConfig ?? {}),
          operationType: (data.mode as OperationType) || 'cnc',
        })

        // Las hojas van antes que los elementos: cada elemento apunta a una
        const { setElements, setSheets } = useCanvasStore.getState()
        setSheets(data.sheets ?? [], data.activeSheetId)

        if (data.elements?.length) {
          setElements(data.elements)
        }

        if (data.gcode?.code) {
          useGCodeStore.getState().setGCode(data.gcode.code)
        } else {
          clearGCode()
        }

        createdAt = typeof data.created_at === 'number' ? data.created_at : null
      } catch (err) {
        // Fallback — abrir con metadata. Sin aviso, un archivo corrupto se ve
        // igual que un proyecto vacío y el usuario le pasa por encima.
        //
        // El autosave va a sobrescribirlo en segundos, así que primero se
        // guarda una copia: el original puede ser recuperable a mano.
        try {
          const backup = await tauriInvoke<string>('backup_gravix_project', { path: proj.path })
          toast.warning(t('projectLoadFallback'), {
            detail: `${errorDetail(err)} — ${t('projectBackedUp', { path: backup })}`,
          })
        } catch {
          toast.warning(t('projectLoadFallback'), { detail: errorDetail(err) })
        }
        setProjectName(proj.name)
        setProjectOperationType(proj.mode)
        setWorkArea({ width: proj.width || 300, height: proj.height || 300, origin: 'bottom-left' })
        setGlobalConfig({ ...globalConfig, operationType: proj.mode })
      }
    }

    useAppStore.getState().setActiveProjectPath(proj.path, createdAt)
    setView('workspace')
  }, [setProjectName, setProjectOperationType, setWorkArea, setGlobalConfig, globalConfig, setView, t, clearGCode])

  const handleDeleteProject = useCallback(async (proj: ProjectMeta, e: React.MouseEvent) => {
    e.stopPropagation()
    if (isTauri()) {
      try {
        await tauriInvoke('delete_gravix_project', { path: proj.path })
        toast.success(t('projectDeleted'), { detail: proj.name })
      } catch (err) {
        toast.error(t('projectDeleteFailed'), { detail: errorDetail(err) })
      }
      await refresh()
    }
  }, [refresh, t])

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang)
    i18n.changeLanguage(lang)
  }

  const openNewDialog = () => {
    setNewName('')
    setNewType('cnc')
    setNewWidth(300)
    setNewHeight(300)
    setNewTool('')
    setNewMaterial('')
    setShowNewDialog(true)
  }

  const formatDate = (timestamp: number) => {
    if (!timestamp) return ''
    const d = new Date(timestamp * 1000)
    return d.toLocaleDateString(language === 'es' ? 'es-CL' : 'en-US', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const folderName = workspacePath
    ? workspacePath.replace(/\\/g, '/').split('/').pop() || workspacePath
    : ''

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Title bar */}
      <div
        className="flex items-center justify-between h-10 px-4 shrink-0 select-none"
        {...(isTauri() ? { 'data-tauri-drag-region': true } : {})}
      >
        {/* Left — logo + workspace path */}
        <button
          className="flex items-center gap-1.5 px-1.5 py-1 rounded-[6px] hover:bg-card transition-colors"
          onClick={() => pickWorkspace()}
          title={t('changeWorkspace')}
        >
          <GravixMark size={20} />
          <GravixWordmark size={13} variant="light" />
          {workspacePath && (
            <>
              <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[200px] ml-1">{folderName}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </>
          )}
        </button>

        {/* Right — controls */}
        <div className="flex items-center gap-1">
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="h-7 w-20 border-0 bg-transparent text-muted-foreground text-[11px] hover:text-foreground">
              <Languages className="h-4 w-4 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="es">ES</SelectItem>
              <SelectItem value="en">EN</SelectItem>
            </SelectContent>
          </Select>
          {isTauri() && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openModal('networkServer')} title={t('networkServer')}>
              <Globe className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openModal('help')}>
            <HelpCircle className="h-4 w-4" />
          </Button>
          <button
            onClick={() => openModal('license')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
              isLicensed
                ? 'text-green-600 hover:bg-green-500/10'
                : trialActive
                  ? 'text-yellow-600 hover:bg-yellow-500/10'
                  : 'text-red-500 hover:bg-red-500/10'
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

          {appWindow && (
            <>
              <div className="w-px h-4 bg-border mx-1" />
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => appWindow.minimize()}>
                <Minus className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => appWindow.toggleMaximize()}>
                <Square className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => appWindow.close()}>
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto pt-8 pb-8 px-6">
          {/* Actions */}
          <div className="flex items-center gap-3 mb-8">
            <Button onClick={openNewDialog} className="gap-2 h-10 px-5 text-[14px] font-medium">
              <Plus className="h-4 w-4" />
              {t('newProject')}
            </Button>
            <Button
              variant="outline"
              className="gap-2 h-10 px-5 text-[14px] font-medium"
              onClick={() => {
                setControlOnly(true)
                setWorkspace('cnc')
                setView('workspace')
              }}
            >
              <Gamepad2 className="h-4 w-4" />
              {t('controlMachine')}
            </Button>
          </div>

          {/* Projects list */}
          <div>
            <h2 className="text-[12px] font-medium text-muted-foreground mb-3">
              {t('recentProjects')}
            </h2>
            {projects.length === 0 ? (
              <div className="border border-dashed rounded-[10px] py-10 px-6 flex flex-col items-center text-center">
                <FolderOpen
                  className="h-8 w-8 text-muted-foreground/40 mb-3"
                  strokeWidth={1.5}
                />
                <p className="text-[14px] font-medium">{t('noProjects')}</p>
                <p className="text-[12px] text-muted-foreground mt-1 max-w-[340px]">
                  {t('noProjectsDesc')}
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5 max-w-[340px]">
                  {t('noProjectsCta')}
                </p>
                {workspacePath && (
                  <p className="text-[11px] font-mono text-muted-foreground/60 mt-3 truncate max-w-full">
                    {workspacePath}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-4">
                  <Button size="sm" className="gap-1.5" onClick={openNewDialog}>
                    <Plus className="h-4 w-4" />
                    {t('emptyCreate')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => pickWorkspace()}
                  >
                    <FolderOpen className="h-4 w-4" />
                    {t('emptyChangeFolder')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-0.5">
                {projects.map((proj) => (
                  <div
                    key={proj.path}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] hover:bg-card cursor-pointer transition-colors group"
                    onClick={() => handleOpenProject(proj)}
                  >
                    <div className={`flex items-center justify-center h-8 w-8 rounded-[6px] border ${MACHINE_BADGE_STYLE[proj.mode] || MACHINE_BADGE_STYLE.cnc}`}>
                      {MACHINE_ICON_SMALL[proj.mode] || MACHINE_ICON_SMALL.cnc}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium truncate">{proj.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-mono">{proj.width ? `${proj.width}×${proj.height}mm` : ''}</span>
                        {proj.modified_at > 0 && <span className="ml-2">{formatDate(proj.modified_at)}</span>}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={(e) => handleDeleteProject(proj, e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Configuration section */}
          <div className="mt-10">
            <h2 className="text-[12px] font-medium text-muted-foreground mb-3">
              {t('configuration')}
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {isTauri() && (
                <button
                  className="flex items-center gap-3 px-4 py-3 rounded-[10px] border border-border hover:bg-card transition-colors text-left"
                  onClick={() => openModal('networkServer')}
                >
                  <div className="flex items-center justify-center h-8 w-8 rounded-[6px] bg-blue-500/10 text-blue-600 shrink-0">
                    <Globe className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{t('networkServer')}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{t('networkServerDesc')}</p>
                  </div>
                </button>
              )}
              <button
                className="flex items-center gap-3 px-4 py-3 rounded-[10px] border border-border hover:bg-card transition-colors text-left"
                onClick={() => openModal('tools')}
              >
                <div className="flex items-center justify-center h-8 w-8 rounded-[6px] bg-orange-500/10 text-orange-600 shrink-0">
                  <Wrench className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{t('toolsLibrary')}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{t('toolsLibraryDesc')}</p>
                </div>
              </button>
              <button
                className="flex items-center gap-3 px-4 py-3 rounded-[10px] border border-border hover:bg-card transition-colors text-left"
                onClick={() => openModal('materials')}
              >
                <div className="flex items-center justify-center h-8 w-8 rounded-[6px] bg-green-500/10 text-green-600 shrink-0">
                  <Layers className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{t('materialsLibrary')}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{t('materialsLibraryDesc')}</p>
                </div>
              </button>
              <button
                className="flex items-center gap-3 px-4 py-3 rounded-[10px] border border-border hover:bg-card transition-colors text-left"
                onClick={() => openModal('setupWizard')}
              >
                <div className="flex items-center justify-center h-8 w-8 rounded-[6px] bg-purple-500/10 text-purple-600 shrink-0">
                  <Wand2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{t('setupWizard')}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{t('setupWizardDesc')}</p>
                </div>
              </button>
              {isTauri() && (
                <button
                  className="flex items-center gap-3 px-4 py-3 rounded-[10px] border border-border hover:bg-card transition-colors text-left disabled:opacity-60"
                  onClick={() => {
                    openModal('updater')
                    void checkUpdate()
                  }}
                  disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                >
                  <div className="flex items-center justify-center h-8 w-8 rounded-[6px] bg-sky-500/10 text-sky-600 shrink-0">
                    <RefreshCw className={`h-4 w-4 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{tu('checkNow')}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{tu('checkNowDesc')}</p>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New project dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[22px] font-medium">{t('createProject')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-1">
            <div className="space-y-1.5">
              <Label className="text-[12px] text-muted-foreground">{t('projectName')}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('projectNamePlaceholder')}
                className="h-9"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[12px] text-muted-foreground">{t('machineType')}</Label>
              <div className="grid grid-cols-4 gap-2">
                {MACHINE_TYPES.map((mt) => {
                  const selected = newType === mt.id
                  return (
                    <button
                      key={mt.id}
                      className={`flex flex-col items-center gap-2 py-4 px-2 rounded-[10px] border transition-colors ${
                        selected ? mt.active : mt.idle
                      }`}
                      onClick={() => {
                        setNewType(mt.id)
                        setNewTool('')
                        setNewMaterial('')
                      }}
                    >
                      {selected ? mt.selectedIcon : mt.icon}
                      <span className="text-[11px] font-medium">{t(mt.id)}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground pl-0.5">{t(`${newType}Desc`)}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-[12px] text-muted-foreground">{t('workArea')} (mm)</Label>
              <div className="flex items-center gap-2">
                <Input type="number" value={newWidth} onChange={(e) => setNewWidth(Number(e.target.value) || 300)} min={50} max={2000} className="h-9 font-mono" />
                <span className="text-muted-foreground font-mono text-[12px]">×</span>
                <Input type="number" value={newHeight} onChange={(e) => setNewHeight(Number(e.target.value) || 300)} min={50} max={2000} className="h-9 font-mono" />
              </div>
              <div className="flex flex-wrap gap-1">
                {WORK_AREA_PRESETS.map((p) => (
                  <Badge
                    key={p.label}
                    variant={newWidth === p.w && newHeight === p.h ? 'default' : 'outline'}
                    className="cursor-pointer text-[11px] font-mono"
                    onClick={() => { setNewWidth(p.w); setNewHeight(p.h) }}
                  >
                    {p.label}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">{t('tool')}</Label>
                <Select value={newTool} onValueChange={setNewTool}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={t('selectLater')} /></SelectTrigger>
                  <SelectContent>
                    {filteredTools.map((tool) => (
                      <SelectItem key={tool.id} value={tool.id}>{tool.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">{t('material')}</Label>
                <Select value={newMaterial} onValueChange={setNewMaterial}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={t('selectLater')} /></SelectTrigger>
                  <SelectContent>
                    {filteredMaterials.map((mat) => (
                      <SelectItem key={mat.id} value={mat.id}>{mat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="ghost" onClick={() => setShowNewDialog(false)} className="text-[14px]">{t('cancel')}</Button>
              <Button onClick={handleCreate} className="px-5 text-[14px] font-medium">{t('create')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
