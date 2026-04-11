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
import { ControlPanel } from '@/components/panels/ControlPanel'
import { WorkAreaModal } from '@/components/modals/WorkAreaModal'
import { GlobalConfigModal } from '@/components/modals/GlobalConfigModal'
import { ToolsModal } from '@/components/modals/ToolsModal'
import { MaterialsModal } from '@/components/modals/MaterialsModal'
import { HelpModal } from '@/components/modals/HelpModal'
import { isTauri, tauriInvoke } from '@/lib/tauri'
import type { Tool, Material } from '@/lib/types'

async function loadInitialData(): Promise<{ tools: Tool[]; materials: Material[] }> {
  if (isTauri()) {
    try {
      const [tools, materials] = await Promise.all([
        tauriInvoke<Tool[]>('get_tools'),
        tauriInvoke<Material[]>('get_materials'),
      ])
      return { tools, materials }
    } catch {
      // Fallback si los comandos Tauri aun no existen
    }
  }
  // Fallback para dev sin Tauri
  const [toolsRes, materialsRes] = await Promise.all([
    fetch('/data/tools.json').then((r) => r.json()),
    fetch('/data/materials.json').then((r) => r.json()),
  ])
  return { tools: toolsRes, materials: materialsRes }
}

function App() {
  const { currentWorkspace, addConsoleLine } = useAppStore()
  const { setTools, setMaterials } = useLibraryStore()

  // Load initial data
  useEffect(() => {
    loadInitialData().then(({ tools, materials }) => {
      setTools(tools)
      setMaterials(materials)
      addConsoleLine('GRBL Web Control Pro v5.0 iniciado')
      addConsoleLine(`Herramientas cargadas: ${tools.length}`)
      addConsoleLine(`Materiales cargados: ${materials.length}`)
    }).catch((err) => {
      addConsoleLine(`Error cargando datos: ${err}`)
    })
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
            <div className="h-full overflow-auto p-4 bg-muted/20">
              <ControlPanel />
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
