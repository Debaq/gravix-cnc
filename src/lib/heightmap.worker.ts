// ============================================
// Worker de simulacion de remocion
// ============================================
//
// Barrer medio millon de celdas bloquea el hilo principal varios segundos y la
// UI parece colgada, asi que la simulacion corre aca.
//
// Ademas guarda el ultimo estado: seguir la linea de tiempo hacia adelante
// talla solo los movimientos nuevos sobre lo ya simulado, que es la diferencia
// entre reproducir fluido y recalcular todo el bloque en cada cuadro.

import {
  simulateRemoval,
  MOVE_STRIDE,
  type SimulateInput,
  type HeightmapResult,
} from './heightmap'

export interface SimRequest extends Omit<SimulateInput, 'initialHeights' | 'fromMove'> {
  /** Lo devuelve la respuesta para descartar resultados viejos. */
  requestId: number
  /**
   * Identifica el conjunto simulado (G-code + stock + herramienta). Al cambiar
   * se descarta el cache: el estado guardado ya no corresponde.
   */
  datasetKey: string
}

export type SimResponse =
  | { ok: true; requestId: number; result: HeightmapResult }
  | { ok: false; requestId: number; error: string }

interface Cache {
  key: string
  heights: Float32Array
  upTo: number
}

let cache: Cache | null = null

self.onmessage = (event: MessageEvent<SimRequest>) => {
  const { requestId, datasetKey, ...input } = event.data

  try {
    const moveCount = Math.floor(input.moves.length / MOVE_STRIDE)
    const upTo = Math.min(input.upTo ?? moveCount, moveCount)

    // Solo se puede continuar hacia adelante: tallar quita material y no hay
    // como devolverlo sin rehacer la simulacion.
    const reusable = cache && cache.key === datasetKey && upTo >= cache.upTo

    const result = simulateRemoval({
      ...input,
      upTo,
      initialHeights: reusable ? cache!.heights : undefined,
      fromMove: reusable ? cache!.upTo : 0,
    })

    // El cache se queda con una copia: el original se transfiere y quedaria
    // vacio del lado del worker.
    cache = { key: datasetKey, heights: new Float32Array(result.heights), upTo }

    const response: SimResponse = { ok: true, requestId, result }
    ;(self as unknown as Worker).postMessage(response, [result.heights.buffer])
  } catch (err) {
    const response: SimResponse = {
      ok: false,
      requestId,
      error: err instanceof Error ? err.message : String(err),
    }
    ;(self as unknown as Worker).postMessage(response)
  }
}
