/**
 * Pixeles del lienzo por milimetro: 96 DPI exactos, que es la escala con la
 * que Fabric (y cualquier navegador) interpreta las unidades de un SVG.
 *
 * Antes se usaba 3.78 redondeado. Las figuras hechas en la app daban la vuelta
 * mm -> px -> mm con la misma constante y salian exactas, pero un SVG en mm lo
 * convertia Fabric con 3.7795 y la app lo media con 3.78: 0.04 mm de error
 * cada 300 mm, que en print & cut y piezas que encastran se nota.
 */
export const PIXELS_PER_MM = 96 / 25.4

/** Escala de los proyectos guardados antes del cambio. */
export const LEGACY_PIXELS_PER_MM = 3.78

/** Margen en pixeles entre el borde del lienzo y el area de trabajo. */
export const WORK_AREA_PADDING = 40

/**
 * Lleva un snapshot Fabric guardado con otra escala a la actual, de modo que
 * cada objeto conserve su posicion y tamano en milimetros. Escala alrededor
 * de la esquina del area de trabajo, que es el punto fijo de la conversion.
 */
export function rescaleCanvasSnapshot<T>(snapshot: T, savedPxPerMm: number | undefined): T {
  const from = savedPxPerMm && savedPxPerMm > 0 ? savedPxPerMm : LEGACY_PIXELS_PER_MM
  const k = PIXELS_PER_MM / from
  if (Math.abs(k - 1) < 1e-9) return snapshot
  const snap = snapshot as { objects?: Array<Record<string, unknown>> } | null
  if (!snap || !Array.isArray(snap.objects)) return snapshot

  const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback)
  return {
    ...snap,
    objects: snap.objects.map((obj) => ({
      ...obj,
      left: WORK_AREA_PADDING + (num(obj.left, 0) - WORK_AREA_PADDING) * k,
      top: WORK_AREA_PADDING + (num(obj.top, 0) - WORK_AREA_PADDING) * k,
      scaleX: num(obj.scaleX, 1) * k,
      scaleY: num(obj.scaleY, 1) * k,
    })),
  } as T
}
