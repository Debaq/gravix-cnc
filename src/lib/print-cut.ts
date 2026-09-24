// Print & cut: se imprime el diseño con una impresora comun y despues la
// cortadora recorta el borde. Cada elemento dice si va a la impresora, a la
// cortadora o a las dos (`CanvasElement.output`).

import type { CanvasElement, ElementOutput } from './types'

export const OUTPUT_LABELS: Record<ElementOutput, string> = {
  cut: 'Cortar',
  print: 'Imprimir',
  both: 'Imprimir y cortar',
}

export function elementOutput(el: Pick<CanvasElement, 'output' | 'type'> | undefined): ElementOutput {
  // Una imagen no tiene trazos: solo puede imprimirse
  if (el?.type === 'image') return 'print'
  return el?.output ?? 'cut'
}

/** Genera trayectorias (CAM, G-code, Silhouette). */
export function isCutElement(el: Pick<CanvasElement, 'output' | 'type'> | undefined): boolean {
  return elementOutput(el) !== 'print'
}

/** Sale en la hoja impresa. */
export function isPrintElement(el: Pick<CanvasElement, 'output' | 'type'> | undefined): boolean {
  return elementOutput(el) !== 'cut'
}
