import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { DesignPanel } from '@/components/panels/DesignPanel'
import { OperationsPanel } from '@/components/panels/OperationsPanel'
import { LayersPanel } from '@/components/panels/LayersPanel'

export function Sidebar() {
  const { t } = useTranslation('header')
  const { currentWorkspace, leftPanelCollapsed, toggleLeftPanel } = useAppStore()

  // El workspace de control usa todo el espacio principal, no necesita sidebar
  if (currentWorkspace === 'cnc') return null

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
    <div className={`flex flex-col min-w-0 bg-card border-r overflow-hidden ${currentWorkspace === 'cam' ? 'w-[340px] max-w-[35vw]' : 'w-72 max-w-[30vw]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold">
          {currentWorkspace === 'cad' && t('cad')}
          {currentWorkspace === 'cam' && t('cam')}
        </span>
        <Button variant="ghost" size="icon" onClick={toggleLeftPanel}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      {currentWorkspace === 'cad' ? (
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-4 min-w-0">
            <DesignPanel />
            <div className="h-64 pt-2">
              <LayersPanel />
            </div>
          </div>
        </ScrollArea>
      ) : currentWorkspace === 'cam' ? (
        <div className="flex-1 min-h-0 p-3">
          <OperationsPanel />
        </div>
      ) : null}
    </div>
  )
}
