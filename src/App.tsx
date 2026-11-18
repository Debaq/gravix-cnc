import { useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'
import { useMachineStore } from '@/stores/useMachineStore'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import { WorkspaceSelector } from '@/components/projects/WorkspaceSelector'
import { ProjectsScreen } from '@/components/projects/ProjectsScreen'
import { Header } from '@/components/layout/Header'
import { WorkspaceLayout } from '@/components/layout/WorkspaceLayout'
import { DesignCanvas } from '@/components/canvas/DesignCanvas'
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar'
import { CanvasFooter } from '@/components/canvas/CanvasFooter'
import { SheetTabs } from '@/components/canvas/SheetTabs'
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
import { TraceImageModal } from '@/components/modals/TraceImageModal'
import { TextToPathModal } from '@/components/modals/TextToPathModal'
import { BoxGeneratorModal } from '@/components/modals/BoxGeneratorModal'
import { ArrayModal } from '@/components/modals/ArrayModal'
import { NestingModal } from '@/components/modals/NestingModal'
import { SetupWizardModal } from '@/components/modals/SetupWizardModal'
import { NetworkServerModal } from '@/components/modals/NetworkServerModal'
import { LicenseModal } from '@/components/modals/LicenseModal'
import { GrblSettingsModal } from '@/components/modals/GrblSettingsModal'
import { MachinesModal } from '@/components/modals/MachinesModal'
import { UpdateModal } from '@/components/modals/UpdateModal'
import { VectorDiagnosticsModal } from '@/components/modals/VectorDiagnosticsModal'
import { ColorMappingModal } from '@/components/modals/ColorMappingModal'
import { TilingModal } from '@/components/modals/TilingModal'
import { JobSheetModal } from '@/components/modals/JobSheetModal'
import { SilhouetteModal } from '@/components/modals/SilhouetteModal'
import { PrintCutModal } from '@/components/modals/PrintCutModal'
import { PrintSheetModal } from '@/components/modals/PrintSheetModal'
import { VariableTextModal } from '@/components/modals/VariableTextModal'
import { useLicense } from '@/hooks/useLicense'
import { usePreventAppZoom } from '@/hooks/usePreventAppZoom'
import { useUpdateStore } from '@/stores/useUpdateStore'
import { startAutosave, stopAutosave, flushAutosave } from '@/lib/autosave'
import { isTauri, tauriInvoke } from '@/lib/tauri'
import { toast, errorDetail } from '@/lib/toast'
import i18n from '@/i18n'
import type { Tool, Material } from '@/lib/types'

async function loadFromStatic(): Promise<{ tools: Tool[]; materials: Material[] }> {
  const [tools, materials] = await Promise.all([
    fetch('/data/tools.json').then((r) => r.json()),
    fetch('/data/materials.json').then((r) => r.json()),
  ])
  return { tools, materials }
}

// Ids de la libreria por defecto que ya se le ofrecieron al usuario. Sirve
// para sumar las herramientas y materiales que traiga una version nueva sin
// revivir los que el usuario borro a proposito.
const SEEN_DEFAULTS_KEY = 'gravix_library_defaults_seen'

function readSeenDefaults(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_DEFAULTS_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}

function writeSeenDefaults(defaults: { tools: Tool[]; materials: Material[] }) {
  try {
    const ids = [...defaults.tools.map((t) => `tool:${t.id}`), ...defaults.materials.map((m) => `mat:${m.id}`)]
    localStorage.setItem(SEEN_DEFAULTS_KEY, JSON.stringify(ids))
  } catch {
    // Sin almacenamiento, la proxima vez se vuelven a ofrecer: no es grave
  }
}

/** Suma a la libreria del usuario lo nuevo de la libreria por defecto. */
async function mergeNewDefaults(tools: Tool[], materials: Material[]): Promise<{ tools: Tool[]; materials: Material[] }> {
  let defaults: { tools: Tool[]; materials: Material[] }
  try {
    defaults = await loadFromStatic()
  } catch {
    return { tools, materials }
  }
  const seen = readSeenDefaults() ?? new Set<string>()
  const newTools = defaults.tools.filter((t) => !seen.has(`tool:${t.id}`) && !tools.some((u) => u.id === t.id))
  const newMaterials = defaults.materials.filter(
    (m) => !seen.has(`mat:${m.id}`) && !materials.some((u) => u.id === m.id),
  )
  const saved = await Promise.allSettled([
    ...newTools.map((tool) => tauriInvoke('save_tool', { tool })),
    ...newMaterials.map((material) => tauriInvoke('save_material', { material })),
  ])
  // Si algo no se pudo guardar, se reintenta la proxima vez
  if (saved.every((r) => r.status === 'fulfilled')) writeSeenDefaults(defaults)
  return { tools: [...tools, ...newTools], materials: [...materials, ...newMaterials] }
}

async function loadInitialData(): Promise<{ tools: Tool[]; materials: Material[] }> {
  if (isTauri()) {
    try {
      const [tools, materials] = await Promise.all([
        tauriInvoke<Tool[]>('get_tools'),
        tauriInvoke<Material[]>('get_materials'),
      ])
      if (tools.length > 0 || materials.length > 0) {
        return await mergeNewDefaults(tools, materials)
      }
      const defaults = await loadFromStatic()
      const seeded = await Promise.allSettled([
        ...defaults.tools.map((tool) => tauriInvoke('save_tool', { tool })),
        ...defaults.materials.map((material) => tauriInvoke('save_material', { material })),
      ])
      const failed = seeded.find((r) => r.status === 'rejected')
      if (!failed) writeSeenDefaults(defaults)
      if (failed) {
        toast.warning(i18n.t('toastDefaultsFailed'), {
          detail: i18n.t('toastDefaultsFailedDetail'),
        })
        console.error('Error guardando librerias por defecto:', (failed as PromiseRejectedResult).reason)
      }
      return defaults
    } catch {
      // Fallback
    }
  }
  return loadFromStatic()
}

function App() {
  // El pellizco del touchpad llega como Ctrl+wheel: sin esto agranda toda la
  // interfaz en vez de hacer zoom en el dibujo
  usePreventAppZoom()

  const { currentView, currentWorkspace, controlOnly } = useAppStore()
  const { setTools, setMaterials } = useLibraryStore()
  const { applyInitialDefaults } = useCanvasStore()
  const { path: workspacePath, isLoading: wsLoading, init: initWorkspace } = useWorkspaceStore()
  const { load: loadMachines } = useMachineStore()
  const activeMachineId = useMachineStore((s) => s.activeMachineId)
  const { setWorkArea } = useCanvasStore()
  const { check: checkLicense } = useLicense()
  const checkUpdate = useUpdateStore((s) => s.check)
  const activeProjectPath = useAppStore((s) => s.activeProjectPath)

  // Sincroniza workArea del canvas con la máquina activa.
  // La hoja es del proyecto. Sin proyecto abierto, la maquina activa da el
  // tamano por defecto; con uno abierto, cambiar de maquina no la toca (antes
  // la pisaba sin aviso) y solo avisa si el proyecto no entra o si el origen
  // de la maquina es otro.
  useEffect(() => {
    if (!activeMachineId) return
    const active = useMachineStore.getState().getActive()
    if (!active) return
    const { currentView: view } = useAppStore.getState()
    if (view !== 'workspace') {
      setWorkArea(active.workArea)
      return
    }
    const sheet = useCanvasStore.getState().workArea
    const m = active.workArea
    if (sheet.width > m.width + 0.01 || sheet.height > m.height + 0.01) {
      toast.warning(`La hoja del proyecto no entra en "${active.name}"`, {
        detail: `Hoja ${sheet.width}x${sheet.height} mm, maquina ${m.width}x${m.height} mm. Ajusta la hoja o divide el trabajo en tiles.`,
      })
    }
    if (sheet.origin !== m.origin) {
      toast.warning(`El origen del proyecto (${sheet.origin}) no es el de "${active.name}" (${m.origin})`, {
        detail: 'Cambialo en Area de trabajo si la pieza se va a cortar en esta maquina.',
      })
    }
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
        tauriInvoke('close_splashscreen').catch((err) => {
          console.error('Error cerrando splashscreen:', errorDetail(err))
        })
      }
    })
  }, [])

  // Chequeo de updates al arrancar. Va aparte del Promise.all de carga para no
  // retrasar el cierre del splashscreen, y en modo silencioso: sin red el
  // arranque no debe mostrar un error que el usuario no pidio.
  useEffect(() => {
    if (!isTauri()) return
    const timer = setTimeout(() => void checkUpdate(true), 4000)
    return () => clearTimeout(timer)
  }, [checkUpdate])

  // Autosave: vive mientras haya un .gravix abierto en el editor. Al volver al
  // listado se vacia lo pendiente antes de cortar, o el ultimo cambio se pierde.
  useEffect(() => {
    if (!isTauri()) return
    if (currentView !== 'workspace' || !activeProjectPath) return

    startAutosave()
    return () => {
      void flushAutosave()
    }
  }, [currentView, activeProjectPath])

  // Cerrar la ventana con cambios pendientes no debe tirarlos. `beforeunload`
  // no espera promesas, pero alcanza para disparar la escritura.
  useEffect(() => {
    if (!isTauri()) return
    const onUnload = () => {
      void flushAutosave()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      stopAutosave()
    }
  }, [])

  // Loading
  if (wsLoading) return null

  // No workspace configured → onboarding
  if (!workspacePath) {
    return (
      <TooltipProvider>
        <WorkspaceSelector />
        <HelpModal />
        <Toaster />
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
        <UpdateModal />
        <Toaster />
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
              <SheetTabs />
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
        <TraceImageModal />
        <TextToPathModal />
        <BoxGeneratorModal />
        <ArrayModal />
        <NestingModal />
        <SetupWizardModal />
        <NetworkServerModal />
        <GrblSettingsModal />
        <MachinesModal />
        <LicenseModal />
        <UpdateModal />
        <VectorDiagnosticsModal />
        <ColorMappingModal />
        <TilingModal />
        <JobSheetModal />
        <SilhouetteModal />
        <PrintCutModal />
        <PrintSheetModal />
        <VariableTextModal />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}

export default App
