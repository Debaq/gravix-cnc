import {
  ClipType,
  PolyFillType,
} from 'js-angusj-clipper/web'
import { PolyType } from 'js-angusj-clipper/web/enums'
import type { Point2D } from './types'
import { getClipper, toClipperPath, fromClipperPath } from './geometry'

/**
 * Realiza operaciones booleanas entre dos conjuntos de caminos (paths).
 * @param subjectPaths Caminos base (sujeto)
 * @param clipPaths Caminos que operan sobre el sujeto (clip)
 * @param op Tipo de operación ('union' | 'difference' | 'intersection' | 'xor')
 * @returns Resultado de la operación como Point2D[][]
 */
export async function booleanOperation(
  subjectPaths: Point2D[][],
  clipPaths: Point2D[][],
  op: 'union' | 'difference' | 'intersection' | 'xor'
): Promise<Point2D[][]> {
  const clipper = await getClipper()
  
  const clipType = {
    union: ClipType.Union,
    difference: ClipType.Difference,
    intersection: ClipType.Intersection,
    xor: ClipType.Xor,
  }[op]

  // Configurar entradas para Clipper
  // Usamos EvenOdd fill type como estándar en la mayoría de editores vectoriales
  const result = clipper.clipToPaths({
    clipType,
    subjectFillType: PolyFillType.EvenOdd,
    clipFillType: PolyFillType.EvenOdd,
    subjectInputs: subjectPaths.map(p => ({ 
      data: toClipperPath(p), 
      polyType: PolyType.Subject, 
      closed: true 
    })),
    clipInputs: clipPaths.map(p => ({ 
      data: toClipperPath(p), 
      polyType: PolyType.Clip, 
      closed: true 
    })),
  })

  // Convertir de vuelta a Point2D[][]
  return result ? result.map(fromClipperPath) : []
}
