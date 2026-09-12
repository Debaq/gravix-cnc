import { useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { isTauri, tauriInvoke } from '@/lib/tauri'
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

  const { elements, globalConfig, workArea } = useCanvasStore()
  const { gcode, gcodeGenerated, gcodeLines } = useGCodeStore()

  const newProject = useCallback(() => {
    const { clearGCode } = useGCodeStore.getState()
    const { setElements } = useCanvasStore.getState()
    setProjectName('Untitled Project')
    setElements([])
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
      extensions: {},
    }
  }, [projectName, workArea, elements, globalConfig, gcode, gcodeGenerated, gcodeLines])

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
    const { setElements, setWorkArea, setGlobalConfig } = useCanvasStore.getState()
    const { setGCode } = useGCodeStore.getState()

    setProjectName(data.metadata.projectName)
    setWorkArea(data.workArea)
    setGlobalConfig(data.globalConfig)
    setElements(data.elements as ReturnType<typeof useCanvasStore.getState>['elements'])

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
