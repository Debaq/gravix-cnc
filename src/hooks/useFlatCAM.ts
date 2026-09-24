import { useCAMStore } from '@/stores/useCAMStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import type { OperationType } from '@/lib/types'

/** Plotter y lapiz trabajan sobre la hoja: no hay profundidad que mirar. */
export function isFlatOperation(type: OperationType): boolean {
  return type === 'plotter' || type === 'pencil'
}

/**
 * El CAM se ve en 2D cuando todas las operaciones son de plotter o lapiz.
 * Sin operaciones todavia, decide el tipo del proyecto.
 */
export function useFlatCAM(): boolean {
  const projectType = useCanvasStore((s) => s.globalConfig.operationType)
  return useCAMStore((s) =>
    s.operations.length > 0
      ? s.operations.every((o) => isFlatOperation(o.config.operationType))
      : isFlatOperation(projectType),
  )
}
