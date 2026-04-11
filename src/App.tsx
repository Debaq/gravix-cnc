import { useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Header } from '@/components/layout/Header'
import { WorkspaceLayout } from '@/components/layout/WorkspaceLayout'
import { DesignCanvas } from '@/components/canvas/DesignCanvas'
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar'
import { CanvasFooter } from '@/components/canvas/CanvasFooter'
import { GCodeViewer3D } from '@/components/viewer/GCodeViewer3D'
import { PropertiesPanel } from '@/components/panels/PropertiesPanel'
import { GCodePanel } from '@/components/panels/GCodePanel'
import { WorkAreaModal } from '@/components/modals/WorkAreaModal'
import { GlobalConfigModal } from '@/components/modals/GlobalConfigModal'
import { ToolsModal } from '@/components/modals/ToolsModal'
import { MaterialsModal } from '@/components/modals/MaterialsModal'
import { HelpModal } from '@/components/modals/HelpModal'

// Import data directly for now (will be loaded via Tauri commands later)
import toolsData from '../src-tauri/data/tools.json'
import materialsData from '../src-tauri/data/materials.json'

function App() {
  const { currentWorkspace, addConsoleLine } = useAppStore()
  const { setTools, setMaterials } = useLibraryStore()

  // Load initial data
  useEffect(() => {
    setTools(toolsData as ReturnType<typeof useLibraryStore.getState>['tools'])
    setMaterials(materialsData as ReturnType<typeof useLibraryStore.getState>['materials'])
    addConsoleLine('GRBL Web Control Pro v5.0 iniciado')
    addConsoleLine(`Herramientas cargadas: ${toolsData.length}`)
    addConsoleLine(`Materiales cargados: ${materialsData.length}`)
  }, [])

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        <Header />
        <WorkspaceLayout>
          {/* Design workspace */}
          {currentWorkspace === 'design' && (
            <div className="relative w-full h-full">
              <DesignCanvas />
              <CanvasToolbar />
              <CanvasFooter />
              <PropertiesPanel />
              <GCodePanel />
            </div>
          )}

          {/* Preview workspace */}
          {currentWorkspace === 'preview' && (
            <div className="relative w-full h-full">
              <GCodeViewer3D />
            </div>
          )}

          {/* Control workspace */}
          {currentWorkspace === 'control' && (
            <div className="flex flex-col items-center justify-center h-full bg-muted/20">
              <p className="text-lg text-muted-foreground">
                Workspace de Control
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Conecta tu maquina para empezar
              </p>
            </div>
          )}
        </WorkspaceLayout>

        {/* Modals */}
        <WorkAreaModal />
        <GlobalConfigModal />
        <ToolsModal />
        <MaterialsModal />
        <HelpModal />
      </div>
    </TooltipProvider>
  )
}

export default App
