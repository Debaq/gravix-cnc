import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
  Settings,
  Wrench,
  Layers,
  Move,
  HelpCircle,
  Languages,
  Wifi,
  WifiOff,
} from 'lucide-react'
import type { Workspace } from '@/lib/types'

export function Header() {
  const { t } = useTranslation('header')
  const { t: tc } = useTranslation('common')
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

  const { connected } = useSerialStore()

  const workspaceButtons: { id: Workspace; icon: React.ReactNode; label: string }[] = [
    { id: 'design', icon: <Pencil className="h-4 w-4" />, label: t('design') },
    { id: 'preview', icon: <Eye className="h-4 w-4" />, label: t('preview') },
    { id: 'control', icon: <Gamepad2 className="h-4 w-4" />, label: t('control') },
  ]

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang)
    // i18next will handle the language change through the store
    import('@/i18n/index').then((i18nModule) => {
      i18nModule.default.changeLanguage(lang)
    })
  }

  return (
    <header className="flex items-center justify-between h-12 px-3 bg-primary text-primary-foreground border-b">
      {/* Left: Project actions */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary/80" title={t('newProject')}>
          <FilePlus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary/80" title={t('openProject')}>
          <FolderOpen className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary/80" title={t('saveProject')}>
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
          onClick={() => openModal('globalConfig')}
        >
          <Settings className="h-4 w-4" />
          <span className="hidden lg:inline">{t('globalConfig')}</span>
        </Button>
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
        <Button
          variant="ghost"
          size="icon"
          className="text-primary-foreground hover:bg-primary/80"
          onClick={() => openModal('workArea')}
          title={t('workArea')}
        >
          <Move className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-6 bg-primary-foreground/30 mx-1" />

        {/* Connection status */}
        <Badge variant={connected ? 'success' : 'destructive'} className="gap-1 cursor-pointer">
          {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {connected ? ts('connected') : ts('disconnected')}
        </Badge>

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
      </div>
    </header>
  )
}
