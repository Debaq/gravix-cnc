import { useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { isTauri, tauriInvoke } from '@/lib/tauri'
import { getSharedCanvas, ELEMENT_ID_KEY, NON_INTERACTIVE_KEY } from '@/hooks/useCanvasManager'
import type { ProjectData } from '@/lib/types'

/**
 * Intenta importar el plugin dialog de Tauri dinamicamente.
 * Usa un nombre de modulo indirecto para evitar que Rollup falle al resolver.
 * Retorna null si no esta disponible.
 */
async function getDialogPlugin(): Promise<{
  save: (options: Record<string, unknown>) => Promise<string | null>
  open: (options: Record<string, unknown>) => Promise<string | string[] | null>
} | null> {
  try {
    const moduleName = ['@tauri-apps', 'plugin-dialog'].join('/')
    const mod = await import(/* @vite-ignore */ moduleName)
    return mod
  } catch {
    return null
  }
}

export function useProject() {
  const {
    projectName,
    setProjectName,
    markSaved,
    addConsoleLine,
  } = useAppStore()

  const { elements, globalConfig, workArea, sheets, activeSheetId } = useCanvasStore()
  const { gcode, gcodeGenerated, gcodeLines } = useGCodeStore()

  const newProject = useCallback(() => {
    const { clearGCode } = useGCodeStore.getState()
    const { setElements, setSheets, clearGuides } = useCanvasStore.getState()
    setProjectName('Untitled Project')
    setElements([])
    setSheets([])
    clearGuides()
    clearGCode()
    addConsoleLine('Nuevo proyecto creado')
  }, [setProjectName, addConsoleLine])

  const serializeProject = useCallback((): ProjectData => {
    const now = new Date().toISOString()
    return {
      version: '5.0',
      metadata: {
        created: now,
        modified: now,
        appVersion: __APP_VERSION__,
        projectName,
      },
      workArea,
      elements: elements.map((el) => ({
        id: el.id,
        type: el.type,
        name: el.name,
        visible: el.visible,
        locked: el.locked,
        layerId: el.layerId,
        sheetId: el.sheetId,
        config: el.config,
        operations: el.operations,
        makerType: el.makerType,
        makerParams: el.makerParams,
        svgData: el.svgData,
        children: el.children.map((child) => ({
          id: child.id,
          type: child.type,
          name: child.name,
          visible: child.visible,
          locked: child.locked,
          layerId: child.layerId,
          sheetId: child.sheetId,
          config: child.config,
          operations: child.operations,
          makerType: child.makerType,
          makerParams: child.makerParams,
          svgData: child.svgData,
          children: [],
        })),
      })),
      globalConfig,
      gcode: {
        generated: gcodeGenerated,
        code: gcode,
        lines: gcodeLines,
      },
      selectedTool: globalConfig.tool,
      selectedMaterial: globalConfig.material,
      // El lienzo tambien viaja en el export JSON: sin esto el proyecto
      // importado traia la lista de elementos y el canvas vacio
      extensions: {
        sheets,
        activeSheetId,
        canvas: getSharedCanvas()
          ? (getSharedCanvas() as unknown as { toObject(props: string[]): object }).toObject([
              ELEMENT_ID_KEY,
              NON_INTERACTIVE_KEY,
            ])
          : undefined,
      },
    }
  }, [projectName, workArea, elements, globalConfig, gcode, gcodeGenerated, gcodeLines, sheets, activeSheetId])

  const saveProject = useCallback(async () => {
    const data = serializeProject()

    if (isTauri()) {
      try {
        const dialog = await getDialogPlugin()
        if (dialog) {
          const path = await dialog.save({
            defaultPath: `${projectName}.json`,
            filters: [{ name: 'Proyecto CNC', extensions: ['json'] }],
          })
          if (!path) return
          await tauriInvoke('save_project', { path, data: JSON.stringify(data) })
          markSaved()
          addConsoleLine(`Proyecto guardado: ${path}`)
          return
        }
      } catch {
        // Fallback
      }
    }

    // Fallback web
    downloadAsFile(data, `${projectName}.json`)
    markSaved()
    addConsoleLine('Proyecto guardado (descarga)')
  }, [serializeProject, projectName, markSaved, addConsoleLine])

  const loadProject = useCallback(async () => {
    if (isTauri()) {
      try {
        const dialog = await getDialogPlugin()
        if (dialog) {
          const result = await dialog.open({
            filters: [{ name: 'Proyecto CNC', extensions: ['json'] }],
            multiple: false,
          })
          const path = Array.isArray(result) ? result[0] : result
          if (!path) return
          const rawData = await tauriInvoke<string>('load_project', { path })
          const data: ProjectData = JSON.parse(rawData)
          restoreProject(data)
          addConsoleLine(`Proyecto cargado: ${path}`)
          return
        }
      } catch {
        // Fallback
      }
    }

    // Fallback: input file web
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      try {
        const data: ProjectData = JSON.parse(text)
        restoreProject(data)
        addConsoleLine(`Proyecto cargado: ${file.name}`)
      } catch {
        addConsoleLine('Error: archivo de proyecto invalido')
      }
    }
    input.click()
  }, [addConsoleLine])

  const restoreProject = useCallback((data: ProjectData) => {
    const { setElements, setWorkArea, setGlobalConfig, setSheets, setPendingCanvasJSON } =
      useCanvasStore.getState()
    const { setGCode } = useGCodeStore.getState()

    setProjectName(data.metadata.projectName)
    setWorkArea(data.workArea)
    setGlobalConfig(data.globalConfig)

    // Las hojas viajan en extensions para no romper archivos viejos
    const ext = data.extensions as {
      sheets?: { id: string; name: string }[]
      activeSheetId?: string
      canvas?: unknown
    } | undefined
    setSheets(ext?.sheets ?? [], ext?.activeSheetId)

    setElements(data.elements as ReturnType<typeof useCanvasStore.getState>['elements'])

    // La geometria la levanta DesignCanvas cuando ve el snapshot pendiente
    setPendingCanvasJSON(ext?.canvas ?? null)

    if (data.gcode.generated && data.gcode.code) {
      setGCode(data.gcode.code)
    }

    markSaved()
  }, [setProjectName, markSaved])

  const downloadGCode = useCallback(async (gcodeContent: string, filename = 'output.gcode') => {
    if (isTauri()) {
      try {
        const dialog = await getDialogPlugin()
        if (dialog) {
          const path = await dialog.save({
            defaultPath: filename,
            filters: [{ name: 'G-code', extensions: ['gcode', 'nc', 'ngc'] }],
          })
          if (!path) return
          await tauriInvoke('save_project', { path, data: gcodeContent })
          addConsoleLine(`G-code guardado: ${path}`)
          return
        }
      } catch {
        // Fallback
      }
    }

    // Fallback web
    const blob = new Blob([gcodeContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    addConsoleLine('G-code descargado')
  }, [addConsoleLine])

  return {
    newProject,
    saveProject,
    loadProject,
    downloadGCode,
  }
}

function downloadAsFile(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
