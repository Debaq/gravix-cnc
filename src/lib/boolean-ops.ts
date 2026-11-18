import {
  ClipType,
  PolyFillType,
} from 'js-angusj-clipper/web'
import { PolyType } from 'js-angusj-clipper/web/enums'
import type { Point2D } from './types'
import { getClipper, toClipperPath, fromClipperPath, offsetPolygon } from './geometry'

/**
 * Operacion booleana entre figuras.
 *
 * Cada figura es un conjunto de contornos (exterior + agujeros). Primero se
 * normaliza cada una por separado con EvenOdd, que respeta sus agujeros y deja
 * la orientacion coherente (exterior en un sentido, agujeros en el otro).
 * Recien entonces se operan entre si con NonZero: con EvenOdd directo, la zona
 * donde dos figuras se solapan contaba dos veces y la union dejaba un hueco.
 *
 * @param subjectShapes Figuras base
 * @param clipShapes Figuras que operan sobre las base
 */
export async function booleanOperation(
  subjectShapes: Point2D[][][],
  clipShapes: Point2D[][][],
  op: 'union' | 'difference' | 'intersection' | 'xor'
): Promise<Point2D[][]> {
  const clipper = await getClipper()

  const normalize = (shape: Point2D[][]): Point2D[][] => {
    const valid = shape.filter(p => p.length >= 3)
    if (valid.length === 0) return []
    const r = clipper.clipToPaths({
      clipType: ClipType.Union,
      subjectFillType: PolyFillType.EvenOdd,
      subjectInputs: valid.map(p => ({ data: toClipperPath(p), closed: true })),
    })
    return r ? r.map(fromClipperPath) : []
  }

  const subject = subjectShapes.flatMap(normalize)
  const clip = clipShapes.flatMap(normalize)
  if (subject.length === 0) return []

  const clipType = {
    union: ClipType.Union,
    difference: ClipType.Difference,
    intersection: ClipType.Intersection,
    xor: ClipType.Xor,
  }[op]

  const result = clipper.clipToPaths({
    clipType,
    subjectFillType: PolyFillType.NonZero,
    clipFillType: PolyFillType.NonZero,
    subjectInputs: subject.map(p => ({
      data: toClipperPath(p),
      polyType: PolyType.Subject,
      closed: true
    })),
    clipInputs: clip.map(p => ({
      data: toClipperPath(p),
      polyType: PolyType.Clip,
      closed: true
    })),
  })

  return result ? result.map(fromClipperPath) : []
}

/**
 * Unión/diferencia con relleno NonZero — necesario cuando los polígonos
 * de entrada se solapan entre sí (EvenOdd los cancelaría en vez de unirlos).
 */
async function clipNonZero(
  subjectPaths: Point2D[][],
  clipPaths: Point2D[][],
  op: 'union' | 'difference' | 'intersection'
): Promise<Point2D[][]> {
  if (subjectPaths.length === 0) return []
  const clipper = await getClipper()
  const result = clipper.clipToPaths({
    clipType:
      op === 'union' ? ClipType.Union
      : op === 'intersection' ? ClipType.Intersection
      : ClipType.Difference,
    subjectFillType: PolyFillType.NonZero,
    clipFillType: PolyFillType.NonZero,
    subjectInputs: subjectPaths.map(p => ({
      data: toClipperPath(p),
      polyType: PolyType.Subject,
      closed: true,
    })),
    clipInputs: clipPaths.map(p => ({
      data: toClipperPath(p),
      polyType: PolyType.Clip,
      closed: true,
    })),
  })
  return result ? result.map(fromClipperPath) : []
}

/**
 * Área que una fresa de radio `radius` puede despejar realmente dentro de
 * `boundary`: apertura morfológica (erosión seguida de dilatación). Lo que
 * queda fuera son las esquinas y ranuras donde la fresa no entra.
 */
async function toolClearedArea(boundary: Point2D[], radius: number): Promise<Point2D[][]> {
  const eroded = await offsetPolygon(boundary, -radius, true, 'round')
  if (eroded.length === 0) return []
  const dilated: Point2D[][] = []
  for (const contour of eroded) {
    dilated.push(...await offsetPolygon(contour, radius, true, 'round'))
  }
  return dilated.length > 1 ? clipNonZero(dilated, [], 'union') : dilated
}

/**
 * Área con signo de un polígono (shoelace). Se usa sólo para descartar
 * astillas irrelevantes del residuo.
 */
function polygonArea(points: Point2D[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return Math.abs(area) / 2
}

/**
 * Rest machining: zonas de `boundary` donde la fresa de desbaste
 * (`roughRadius`) no llega — esquinas y ranuras estrechas.
 *
 * Devuelve **regiones de centro de herramienta**, no de material: el
 * residuo de una esquina es más fino que la propia fresa de acabado, así
 * que tratarlo como material y erosionarlo por el radio dejaría la pasada
 * vacía. La región es el barrido válido del centro de la fresa chica:
 * el residuo dilatado por su radio, recortado a donde esa fresa cabe.
 *
 * El cajeado debe consumirlas con `initialInset = 0`.
 *
 * Lista vacía = la fresa de desbaste ya despejó todo el bolsillo y la
 * segunda pasada no aporta nada.
 */
export async function computeRestRegions(
  boundary: Point2D[],
  roughRadius: number,
  finishRadius: number
): Promise<Point2D[][]> {
  if (finishRadius <= 0 || finishRadius >= roughRadius) return []

  // Dónde puede estar el centro de la fresa de acabado
  const finishReach = await offsetPolygon(boundary, -finishRadius, true, 'round')
  if (finishReach.length === 0) return []

  const roughCleared = await toolClearedArea(boundary, roughRadius)
  if (roughCleared.length === 0) return finishReach

  // Material que sigue en pie tras el desbaste
  const uncut = await clipNonZero([boundary], roughCleared, 'difference')
  if (uncut.length === 0) return []

  const regions: Point2D[][] = []
  for (const region of uncut) {
    if (region.length < 3) continue
    // Astillas por debajo del área de la propia fresa: sólo ruido en el G-code
    if (polygonArea(region) < Math.PI * finishRadius * finishRadius * 0.25) continue

    // Centro de la fresa: residuo dilatado por su radio...
    const grown = await offsetPolygon(region, finishRadius, true, 'round')
    if (grown.length === 0) continue
    // ...pero sólo donde esa fresa realmente cabe dentro del bolsillo
    regions.push(...await clipNonZero(grown, finishReach, 'intersection'))
  }

  return regions.filter(r => r.length >= 3)
}
