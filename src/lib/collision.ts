// ============================================
// Colisiones de herramienta y portaherramientas
// ============================================
//
// El chequeo que ya existia miraba solo el eje de la fresa contra la huella de
// la mordaza en planta. Eso deja pasar el caso tipico de taller: el recorrido
// pasa al lado del clamp, la punta no lo toca, pero la tuerca del portapinzas
// —que es mucho mas gorda y va mas arriba— lo barre.
//
// El modelo es de tres cilindros apilados sobre la punta:
//
//   holderOffset ┤   ███████   portaherramientas (holderDiameter)
//                │     ███     mango (shankDiameter)
//   fluteLength  ┤     ███
//                │      █      filo (diameter)
//          punta ┴
//
// Para cada tramo se compara el rango de alturas de cada cilindro contra la
// altura de la mordaza, y su radio contra la distancia del segmento al rect.

import type { Point2D, ClampRect } from './types'
import type { Tool } from './types'

export interface ToolProfile {
  /** Radio del filo (mm). */
  fluteRadius: number
  /** Largo del filo desde la punta (mm). */
  fluteLength: number
  /** Radio del mango (mm). */
  shankRadius: number
  /** Radio del portaherramientas (mm). */
  holderRadius: number
  /** Altura desde la punta a la que empieza el portaherramientas (mm). */
  holderOffset: number
}

/**
 * Perfil de la herramienta con defaults sensatos cuando la libreria no tiene
 * los datos: un mango del mismo diametro y un portapinzas ER11 tipico.
 */
export function toolProfileFrom(tool: Tool | null | undefined, fallbackDiameter: number): ToolProfile {
  const diameter = tool?.diameter ?? fallbackDiameter
  const fluteRadius = Math.max(0.1, diameter / 2)
  const fluteLength = tool?.fluteLength ?? Math.max(diameter * 3, 10)
  const shankRadius = (tool?.shankDiameter ?? diameter) / 2
  const holderRadius = (tool?.holderDiameter ?? 20) / 2
  const holderOffset = tool?.holderOffset ?? fluteLength + 15

  return {
    fluteRadius,
    fluteLength,
    shankRadius: Math.max(fluteRadius, shankRadius),
    holderRadius: Math.max(shankRadius, holderRadius),
    holderOffset: Math.max(fluteLength, holderOffset),
  }
}

/** Distancia minima de un punto al rectangulo (0 si esta adentro). */
function pointRectDistance(p: Point2D, r: ClampRect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height))
  return Math.hypot(dx, dy)
}

/** Distancia minima de un segmento al rectangulo (0 si lo cruza). */
export function segmentRectDistance(a: Point2D, b: Point2D, r: ClampRect): number {
  // Muestreo adaptativo: el rectangulo es convexo y los tramos de G-code son
  // cortos, asi que unas pocas muestras dan el minimo con error despreciable
  // frente a los milimetros de margen que se usan en la practica.
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const steps = Math.min(64, Math.max(2, Math.ceil(len / 0.5)))
  let min = Infinity
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    const d = pointRectDistance(p, r)
    if (d < min) min = d
    if (min === 0) return 0
  }
  return min
}

export interface CollisionHit {
  clampLabel: string
  /** Que parte de la herramienta choca. */
  part: 'filo' | 'mango' | 'portaherramientas'
  /** Indice del movimiento dentro de la lista que se paso. */
  moveIndex: number
  /** Cuanto falta para librar, en mm (negativo = interferencia). */
  clearance: number
  z: number
}

export interface Move {
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
}

/**
 * Busca interferencias entre la herramienta y las mordazas a lo largo de los
 * movimientos dados.
 *
 * `clamp.zHeight === 0` significa altura infinita: cualquier parte de la
 * herramienta que pase por encima interfiere.
 */
export function findCollisions(
  moves: Move[],
  clamps: ClampRect[],
  profile: ToolProfile,
  labels: string[] = [],
): CollisionHit[] {
  if (clamps.length === 0 || moves.length === 0) return []

  const parts: { name: CollisionHit['part']; radius: number; bottom: number; top: number }[] = [
    { name: 'filo', radius: profile.fluteRadius, bottom: 0, top: profile.fluteLength },
    { name: 'mango', radius: profile.shankRadius, bottom: profile.fluteLength, top: profile.holderOffset },
    { name: 'portaherramientas', radius: profile.holderRadius, bottom: profile.holderOffset, top: Infinity },
  ]

  const hits: CollisionHit[] = []

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]
    // La punta va a la Z mas baja del tramo: es el caso peor para el filo, y
    // tambien el que mas acerca el portaherramientas a la mordaza.
    const tipZ = Math.min(move.from.z, move.to.z)

    for (let c = 0; c < clamps.length; c++) {
      const clamp = clamps[c]
      const label = labels[c] ?? `Clamp ${c + 1}`
      const clampTop = clamp.zHeight === 0 ? Infinity : clamp.zHeight

      const dist = segmentRectDistance(
        { x: move.from.x, y: move.from.y },
        { x: move.to.x, y: move.to.y },
        clamp,
      )

      for (const part of parts) {
        // Altura absoluta que ocupa esta parte durante el tramo
        const partBottom = tipZ + part.bottom
        const partTop = part.top === Infinity ? Infinity : tipZ + part.top
        // Sin solape vertical con la mordaza no hay nada que mirar
        if (partBottom >= clampTop) continue
        if (partTop <= 0) continue

        const clearance = dist - part.radius
        if (clearance < 0) {
          hits.push({
            clampLabel: label,
            part: part.name,
            moveIndex: i,
            clearance,
            z: partBottom,
          })
          // Una parte que ya choca alcanza para reportar el tramo: seguir
          // con las de arriba solo repetiria el mismo aviso.
          break
        }
      }
    }
  }

  return hits
}

/** Resume los choques en una linea por mordaza y parte, con el peor caso. */
export function summarizeCollisions(hits: CollisionHit[]): string[] {
  const worst = new Map<string, CollisionHit>()
  for (const hit of hits) {
    const key = `${hit.clampLabel}|${hit.part}`
    const prev = worst.get(key)
    if (!prev || hit.clearance < prev.clearance) worst.set(key, hit)
  }

  return [...worst.values()].map((hit) =>
    `${hit.part} contra "${hit.clampLabel}": interfiere ${Math.abs(hit.clearance).toFixed(1)} mm` +
    ` (Z ${hit.z.toFixed(1)} mm)`,
  )
}
