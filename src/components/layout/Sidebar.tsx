import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { DesignPanel } from '@/components/panels/DesignPanel'
import { PreviewPanel } from '@/components/panels/PreviewPanel'
import { ControlPanel } from '@/components/panels/ControlPanel'

export function Sidebar() {
  const { t } = useTranslation('header')
  const { currentWorkspace, leftPanelCollapsed, toggleLeftPanel } = useAppStore()

  if (leftPanelCollapsed) {
    return (
      <div className="flex flex-col items-center w-10 bg-card border-r py-2">
        <Button variant="ghost" size="icon" onClick={toggleLeftPanel} className="mb-2" title="Expandir panel">
          <PanelLeft className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-72 bg-card border-r">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold">
          {currentWorkspace === 'design' && t('design')}
          {currentWorkspace === 'preview' && t('preview')}
          {currentWorkspace === 'control' && t('control')}
        </span>
        <Button variant="ghost" size="icon" onClick={toggleLeftPanel}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {currentWorkspace === 'design' && <DesignPanel />}
          {currentWorkspace === 'preview' && <PreviewPanel />}
          {currentWorkspace === 'control' && <ControlPanel />}
        </div>
      </ScrollArea>
    </div>
  )
}
