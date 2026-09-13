import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import type { CanvasElement, GlobalConfig, OperationType } from '@/lib/types'
import type { Sheet } from '@/stores/useCanvasStore'

/**
 * Formato del archivo `.gravix`.
 *
 * Los cinco primeros campos los lee `list_projects` en Rust para armar el
 * listado sin parsear el proyecto entero — no renombrarlos ni sacarlos.
 */
export interface GravixFile {
  name: string
  mode: OperationType
  width: number
  height: number
  version: string
  created_at: number
  updated_at: number
  elements: CanvasElement[]
  operations: unknown[]
  materials: unknown[]
  /** Desde 1.1: config de herramienta/material y G-code generado. */
  globalConfig?: GlobalConfig
  gcode?: { generated: boolean; code: string }
  appVersion?: string
  /** Desde 1.2: hojas del proyecto (cada elemento guarda su `sheetId`). */
  sheets?: Sheet[]
  activeSheetId?: string
}

export const GRAVIX_FILE_VERSION = '1.2.0'

/** Arma el contenido del `.gravix` con el estado actual de los stores. */
export function serializeGravixProject(createdAt?: number): GravixFile {
  const { projectName, projectOperationType } = useAppStore.getState()
  const { elements, workArea, globalConfig, sheets, activeSheetId } = useCanvasStore.getState()
  const { gcode, gcodeGenerated } = useGCodeStore.getState()

  const now = Math.floor(Date.now() / 1000)

  return {
    name: projectName,
    mode: projectOperationType,
    width: workArea.width,
    height: workArea.height,
    version: GRAVIX_FILE_VERSION,
    created_at: createdAt ?? now,
    updated_at: now,
    elements,
    operations: [],
    materials: [],
    globalConfig,
    gcode: { generated: gcodeGenerated, code: gcode },
    appVersion: __APP_VERSION__,
    sheets,
    activeSheetId,
  }
}

/** Huella barata del contenido, para no reescribir el archivo sin cambios. */
export function projectFingerprint(): string {
  const { projectName, projectOperationType } = useAppStore.getState()
  const { elements, workArea, globalConfig, sheets, activeSheetId } = useCanvasStore.getState()
  const { gcode } = useGCodeStore.getState()

  return JSON.stringify([
    projectName,
    projectOperationType,
    workArea,
    globalConfig,
    elements,
    sheets,
    activeSheetId,
    gcode.length,
  ])
}
