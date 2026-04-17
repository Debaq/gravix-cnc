import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GravixLogo } from '@/components/brand/GravixLogo'
import { FolderOpen, ChevronRight, Languages, Minus, Square, X } from 'lucide-react'
import { isTauri } from '@/lib/tauri'

export function WorkspaceSelector() {
  const { t } = useTranslation('projects')
  const { pick, setPath, recentWorkspaces } = useWorkspaceStore()
  const { language, setLanguage } = useAppStore()

  const [appWindow, setAppWindow] = useState<{
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
  } | null>(null)

  useEffect(() => {
    if (isTauri()) {
      import('@tauri-apps/api/window').then((m) => setAppWindow(m.getCurrentWindow()))
    }
  }, [])

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang)
    import('@/i18n/index').then((i18nModule) => {
      i18nModule.default.changeLanguage(lang)
    })
  }

  const folderName = (path: string) => {
    const parts = path.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || path
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Title bar */}
      <div
        className="flex items-center justify-end h-10 px-4 shrink-0 select-none"
        {...(isTauri() ? { 'data-tauri-drag-region': true } : {})}
      >
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

      {/* Center content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-8 max-w-sm px-6">
          <GravixLogo markSize={48} wordmarkSize={32} variant="light" />

          <div className="text-center space-y-2">
            <h1 className="text-[18px] font-medium text-foreground">{t('welcomeTitle')}</h1>
            <p className="text-[12px] text-muted-foreground leading-relaxed">{t('welcomeDesc')}</p>
          </div>

          <Button onClick={() => pick()} className="gap-2 h-10 px-6 text-[14px] font-medium">
            <FolderOpen className="h-4 w-4" />
            {t('pickFolder')}
          </Button>

          {recentWorkspaces.length > 0 && (
            <div className="w-full space-y-2">
              <p className="text-[12px] text-muted-foreground">{t('recentWorkspaces')}</p>
              <div className="space-y-0.5">
                {recentWorkspaces.map((ws) => (
                  <button
                    key={ws}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-[10px] hover:bg-card text-left transition-colors group"
                    onClick={() => setPath(ws)}
                  >
                    <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium truncate">{folderName(ws)}</p>
                      <p className="text-[11px] font-mono text-muted-foreground truncate">{ws}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
