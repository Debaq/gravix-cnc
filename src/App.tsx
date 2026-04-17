import { useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import { useMachineStore } from '@/stores/useMachineStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspaceSelector } from '@/components/projects/WorkspaceSelector'
import { ProjectsScreen } from '@/components/projects/ProjectsScreen'
import { Header } from '@/components/layout/Header'
import { WorkspaceLayout } from '@/components/layout/WorkspaceLayout'
import { DesignCanvas } from '@/components/canvas/DesignCanvas'
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar'
import { CanvasFooter } from '@/components/canvas/CanvasFooter'
import { NodeEditToolbar } from '@/components/canvas/NodeEditToolbar'
import { GCodeViewer3D } from '@/components/viewer/GCodeViewer3D'
import { PropertiesPanel } from '@/components/panels/PropertiesPanel'
import { PreviewToolbar } from '@/components/viewer/PreviewToolbar'
import { OperationEditor } from '@/components/panels/OperationEditor'
import { ControlPanel } from '@/components/panels/ControlPanel'
import { WorkAreaModal } from '@/components/modals/WorkAreaModal'
import { GlobalConfigModal } from '@/components/modals/GlobalConfigModal'
import { ToolsModal } from '@/components/modals/ToolsModal'
import { MaterialsModal } from '@/components/modals/MaterialsModal'
import { HelpModal } from '@/components/modals/HelpModal'
import { ImageWizardModal } from '@/components/modals/ImageWizardModal'
import { TextToPathModal } from '@/components/modals/TextToPathModal'
import { BoxGeneratorModal } from '@/components/modals/BoxGeneratorModal'
import { ArrayModal } from '@/components/modals/ArrayModal'
import { SetupWizardModal } from '@/components/modals/SetupWizardModal'
import { NetworkServerModal } from '@/components/modals/NetworkServerModal'
import { LicenseModal } from '@/components/modals/LicenseModal'
import { GrblSettingsModal } from '@/components/modals/GrblSettingsModal'
import { MachinesModal } from '@/components/modals/MachinesModal'
import { useLicense } from '@/hooks/useLicense'
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
      if (tools.length > 0 || materials.length > 0) {
        return { tools, materials }
      }
      const defaults = await loadFromStatic()
      for (const tool of defaults.tools) {
        tauriInvoke('save_tool', { tool }).catch(() => {})
      }
      for (const material of defaults.materials) {
        tauriInvoke('save_material', { material }).catch(() => {})
      }
      return defaults
    } catch {
      // Fallback
    }
  }
  return loadFromStatic()
}

function App() {
  const { currentView, currentWorkspace, controlOnly } = useAppStore()
  const { setTools, setMaterials } = useLibraryStore()
  const { applyInitialDefaults } = useCanvasStore()
  const { path: workspacePath, isLoading: wsLoading, init: initWorkspace } = useWorkspaceStore()
  const { load: loadMachines } = useMachineStore()
  const activeMachineId = useMachineStore((s) => s.activeMachineId)
  const { setWorkArea } = useCanvasStore()
  const { check: checkLicense } = useLicense()

  // Sincroniza workArea del canvas con la máquina activa.
  useEffect(() => {
    if (!activeMachineId) return
    const active = useMachineStore.getState().getActive()
    if (active) setWorkArea(active.workArea)
  }, [activeMachineId, setWorkArea])

  useEffect(() => {
    Promise.all([
      loadInitialData().then(({ tools, materials }) => {
        setTools(tools)
        setMaterials(materials)
        applyInitialDefaults(tools, materials)
      }),
      initWorkspace(),
      isTauri() ? loadMachines() : Promise.resolve(),
      isTauri() ? checkLicense() : Promise.resolve(),
    ]).finally(() => {
      if (isTauri()) {
        tauriInvoke('close_splashscreen').catch(() => {})
      }
    })
  }, [])

  // Loading
  if (wsLoading) return null

  // No workspace configured → onboarding
  if (!workspacePath) {
    return (
      <TooltipProvider>
        <WorkspaceSelector />
        <HelpModal />
      </TooltipProvider>
    )
  }

  // Workspace set, showing projects
  if (currentView === 'projects') {
    return (
      <TooltipProvider>
        <ProjectsScreen />
        <HelpModal />
        <LicenseModal />
        <NetworkServerModal />
        <ToolsModal />
        <MaterialsModal />
        <SetupWizardModal />
        <MachinesModal />
      </TooltipProvider>
    )
  }

  // Inside a project — editor
  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        <Header />

        {controlOnly ? (
          <div className="flex-1 overflow-auto p-4 bg-muted/20">
            <ControlPanel />
          </div>
        ) : (
          <WorkspaceLayout>
            <div
              className="relative w-full h-full"
              style={{ display: currentWorkspace === 'cad' ? 'block' : 'none' }}
            >
              <DesignCanvas />
              <CanvasToolbar />
              <NodeEditToolbar />
              <CanvasFooter />
              <PropertiesPanel />
            </div>

            {currentWorkspace === 'cam' && (
              <div className="relative w-full h-full">
                <GCodeViewer3D />
                <PreviewToolbar />
                <OperationEditor />
              </div>
            )}

            {currentWorkspace === 'cnc' && (
              <div className="h-full overflow-auto p-4 bg-muted/20">
                <ControlPanel />
              </div>
            )}
          </WorkspaceLayout>
        )}

        <WorkAreaModal />
        <GlobalConfigModal />
        <ToolsModal />
        <MaterialsModal />
        <HelpModal />
        <ImageWizardModal />
        <TextToPathModal />
        <BoxGeneratorModal />
        <ArrayModal />
        <SetupWizardModal />
        <NetworkServerModal />
        <GrblSettingsModal />
        <MachinesModal />
        <LicenseModal />
      </div>
    </TooltipProvider>
  )
}

export default App
