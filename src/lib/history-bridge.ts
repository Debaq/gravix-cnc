// ============================================
// Puente al historial de undo/redo
// ============================================
//
// El historial vive en `useCanvasManager` porque necesita el canvas de Fabric.
// Los stores no pueden importar ese modulo sin arrastrar Fabric entero y armar
// un ciclo de imports, asi que el manager registra su `pushToHistory` aca y
// quien mute estado lo llama por este puente.

type PushFn = (coalesceKey?: string) => void

let pushFn: PushFn | null = null

/** La registra `useCanvasManager` al cargarse el modulo. */
export function registerHistoryPush(fn: PushFn): void {
  pushFn = fn
}

/**
 * Toma un snapshot si hay historial disponible; si no, no hace nada.
 *
 * `coalesceKey` fusiona cambios seguidos del mismo control (un slider que se
 * arrastra) en una sola entrada del historial.
 */
export function pushHistory(coalesceKey?: string): void {
  pushFn?.(coalesceKey)
}
