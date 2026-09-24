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

// ============================================
// Hoja con marcas de registro
// ============================================
//
// La cortadora busca tres marcas impresas: un cuadrado relleno arriba a la
// izquierda y dos escuadras (arriba a la derecha y abajo a la izquierda).
// Con ellas corrige el corrimiento y el giro del papel. Todo va en mm desde
// la esquina superior izquierda de la hoja, que es como mide la cortadora.

export type PaperId = 'letter' | 'a4' | 'legal' | 'tabloid' | 'a3'

export const PAPERS: Record<PaperId, { label: string; width: number; height: number }> = {
  letter: { label: 'Carta (216 x 279 mm)', width: 215.9, height: 279.4 },
  a4: { label: 'A4 (210 x 297 mm)', width: 210, height: 297 },
  legal: { label: 'Oficio / Legal (216 x 356 mm)', width: 215.9, height: 355.6 },
  tabloid: { label: 'Tabloide (279 x 432 mm)', width: 279.4, height: 431.8 },
  a3: { label: 'A3 (297 x 420 mm)', width: 297, height: 420 },
}

/** Medidas de las marcas del tipo Cameo/Portrait (las que busca el sensor). */
export const REGMARK = {
  /** Lado del cuadrado relleno. */
  square: 5,
  /** Largo de cada brazo de las escuadras. */
  arm: 20,
  /** Grosor del trazo de las escuadras. */
  line: 0.5,
  /** Lado de la zona prohibida alrededor de cada marca. */
  keepOut: 20,
}

export interface PrintCutSetup {
  enabled: boolean
  paper: PaperId
  /** Distancia del borde izquierdo de la hoja a las marcas (mm). */
  marginX: number
  /** Distancia del borde superior de la hoja a las marcas (mm). */
  marginY: number
}

export const DEFAULT_PRINT_CUT: PrintCutSetup = {
  enabled: false,
  paper: 'letter',
  marginX: 10,
  marginY: 10,
}

export interface RegmarkLayout {
  paper: { width: number; height: number }
  /** Esquina exterior de la marca superior izquierda. */
  origin: { x: number; y: number }
  /** Distancia entre los bordes exteriores de las marcas. */
  width: number
  length: number
  square: { x: number; y: number; size: number }
  /** Escuadras: esquina exterior y hacia donde van los brazos (+1/-1). */
  corners: { x: number; y: number; dx: 1 | -1; dy: 1 | -1 }[]
  /** Zonas donde no puede haber diseño: los cuadros de cada marca. */
  keepOut: { x: number; y: number; w: number; h: number }[]
}

export function regmarkLayout(setup: PrintCutSetup): RegmarkLayout {
  const paper = PAPERS[setup.paper]
  const ox = setup.marginX
  const oy = setup.marginY
  const width = paper.width - 2 * ox
  const length = paper.height - 2 * oy
  const k = REGMARK.keepOut
  return {
    paper: { width: paper.width, height: paper.height },
    origin: { x: ox, y: oy },
    width,
    length,
    square: { x: ox, y: oy, size: REGMARK.square },
    corners: [
      { x: ox + width, y: oy, dx: -1, dy: 1 },
      { x: ox, y: oy + length, dx: 1, dy: -1 },
    ],
    keepOut: [
      { x: ox, y: oy, w: k, h: k },
      { x: ox + width - k, y: oy, w: k, h: k },
      { x: ox, y: oy + length - k, w: k, h: k },
    ],
  }
}

export interface BoundsMm {
  id: string
  name: string
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Elementos que invaden las marcas o quedan fuera del area entre ellas. El
 * sensor se confunde con cualquier cosa impresa cerca de una marca, y lo que
 * queda fuera del area no se puede ubicar con precision.
 */
export function checkSafeArea(layout: RegmarkLayout, items: BoundsMm[]): { id: string; name: string; problem: string }[] {
  const issues: { id: string; name: string; problem: string }[] = []
  const { origin, width, length } = layout
  for (const b of items) {
    if (b.minX < origin.x || b.minY < origin.y || b.maxX > origin.x + width || b.maxY > origin.y + length) {
      issues.push({ id: b.id, name: b.name, problem: 'queda fuera del area entre las marcas' })
      continue
    }
    const hit = layout.keepOut.some(
      (z) => b.minX < z.x + z.w && b.maxX > z.x && b.minY < z.y + z.h && b.maxY > z.y,
    )
    if (hit) issues.push({ id: b.id, name: b.name, problem: 'invade la zona de una marca' })
  }
  return issues
}
