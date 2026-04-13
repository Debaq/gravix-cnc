import { useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Header } from '@/components/layout/Header'
import { WorkspaceLayout } from '@/components/layout/WorkspaceLayout'
import { DesignCanvas } from '@/components/canvas/DesignCanvas'
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar'
import { CanvasFooter } from '@/components/canvas/CanvasFooter'
import { GCodeViewer3D } from '@/components/viewer/GCodeViewer3D'
import { PropertiesPanel } from '@/components/panels/PropertiesPanel'
import { PreviewToolbar } from '@/components/viewer/PreviewToolbar'
import { ControlPanel } from '@/components/panels/ControlPanel'
import { WorkAreaModal } from '@/components/modals/WorkAreaModal'
import { GlobalConfigModal } from '@/components/modals/GlobalConfigModal'
import { ToolsModal } from '@/components/modals/ToolsModal'
import { MaterialsModal } from '@/components/modals/MaterialsModal'
import { HelpModal } from '@/components/modals/HelpModal'
import { ImageWizardModal } from '@/components/modals/ImageWizardModal'
import { TextToPathModal } from '@/components/modals/TextToPathModal'
import { BoxGeneratorModal } from '@/components/modals/BoxGeneratorModal'
import { isTauri, tauriInvoke } from '@/lib/tauri'
import type { Tool, Material } from '@/lib/types'

async function loadFromStatic(): Promise<{ tools: Tool[]; materials: Material[] }> {
  const [tools, materials] = await Promise.all([
    fetch('/data/tools.json').then((r) => r.json()),
    fetch('/data/materials.json').then((r) => r.json()),
  ])
  return { tools, materials }
}

async function loadInitialData(): Promise<{ tools: Tool[]; materials: Material[] }> {
  if (isTauri()) {
    try {
      const [tools, materials] = await Promise.all([
        tauriInvoke<Tool[]>('get_tools'),
        tauriInvoke<Material[]>('get_materials'),
      ])
      // Si Tauri devuelve datos vacios, sembrar desde los JSON estaticos
      if (tools.length > 0 || materials.length > 0) {
        return { tools, materials }
      }
      const defaults = await loadFromStatic()
      // Persistir en Tauri para futuras cargas
      for (const tool of defaults.tools) {
        tauriInvoke('save_tool', { tool }).catch(() => {})
      }
      for (const material of defaults.materials) {
        tauriInvoke('save_material', { material }).catch(() => {})
      }
      return defaults
    } catch {
      // Fallback si los comandos Tauri aun no existen
    }
  }
  return loadFromStatic()
}

function App() {
  const { currentWorkspace } = useAppStore()
  const { setTools, setMaterials } = useLibraryStore()
  const { applyInitialDefaults } = useCanvasStore()

  // Load initial data
  useEffect(() => {
    loadInitialData().then(({ tools, materials }) => {
      setTools(tools)
      setMaterials(materials)
      applyInitialDefaults(tools, materials)
    })
  }, [])

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        <Header />
        <WorkspaceLayout>
          {/* Design workspace - siempre montado para preservar el canvas Fabric.js */}
          <div
            className="relative w-full h-full"
            style={{ display: currentWorkspace === 'design' ? 'block' : 'none' }}
          >
            <DesignCanvas />
            <CanvasToolbar />
            <CanvasFooter />
            <PropertiesPanel />
          </div>

          {/* Preview workspace */}
          {currentWorkspace === 'preview' && (
            <div className="relative w-full h-full">
              <GCodeViewer3D />
              <PreviewToolbar />
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
        <ImageWizardModal />
        <TextToPathModal />
        <BoxGeneratorModal />
      </div>
    </TooltipProvider>
  )
}

export default App
