// ============================================
// Desbaste adaptativo (engagement constante)
// ============================================
//
// El cajeado clasico va por contornos offset: la fresa lleva un stepover fijo
// y en cada rincon el arco de contacto se dispara sin que nadie lo mire. Ahi
// es donde salta el tiron, se rompe la fresa o se pierden pasos.
//
// El adaptativo da vuelta el problema: en vez de fijar el stepover y sufrir el
// engagement, se fija el engagement y se deduce por donde tiene que ir la
// fresa. No hay offsets — hay un marchador que avanza de a pasos cortos y en
// cada paso busca la curvatura que deja el arco de contacto en el objetivo.
//
//   material ████████████        objetivo 60°
//   ░░░░░░░░╱ ← curva a la izquierda: agarra mas
//   ░░░░░░─── ← derecho: agarra lo mismo
//   ░░░░░░░╲  ← curva a la derecha: se escapa
//
// Dos frenos sobre esa busqueda:
//
//   - radio minimo de curvatura: el recorrido nunca gira mas cerrado que eso,
//     que es lo que hace que la maquina lo pueda seguir a avance parejo. Es el
//     motivo por el que un adaptativo se ve todo redondeado.
//   - limites: el centro de la fresa no puede salir de la region permitida,
//     que es el bolsillo erosionado por el radio.
//
// Lo que queda sin cortar lo sabe el campo de material (`engagement.ts`), que
// se va comiendo el barrido paso a paso. Este modulo es 2D y sincronico: la Z
// y el G-code los pone quien lo llama.
//
// Limite conocido: el marchador es libre, no propaga un frente ordenado. Al
// reenganchar despues de un enlace puede dejar una pared de material entre lo
// que corta y una zona ya vaciada, y romperla sale a casi ranurado. Se esquiva
// lo que se puede (ver `split` en `tryCurvature`), pero queda un resto —del
// orden del 5% de los pasos— por encima del objetivo. Por eso cada punto sale
// con su arco de contacto: el post baja el avance ahi. Sacarlo del todo pide
// propagar el frente como offset de la zona vaciada, que es otro diseno.

import type { MillDirection, Point2D } from './types'
import {
  MaterialField,
  createEngagementProbe,
  measureEngagement,
  measureSweepEngagement,
  angleFromRadialWidth,
  normalizeAngle,
  type EngagementProbe,
} from './engagement'

export interface AdaptiveOptions {
  /** Radio del filo, en mm. */
  toolRadius: number
  /** Ancho radial de corte buscado, en mm (el "stepover" del adaptativo). */
  targetRadialWidth: number
  /**
   * Region donde el centro de la fresa puede pararse. Si no se pasa, sale de
   * erosionar el material inicial por el radio de la herramienta.
   */
  limits?: MaterialField
  /**
   * Material que el desbaste deja contra la pared para la pasada de acabado,
   * en mm. El adaptativo no persigue la pared: la deja pareja y se va.
   */
  stockToLeave?: number
  /** Radio minimo de curvatura del recorrido, en mm. Por defecto 0.5·radio. */
  minRadius?: number
  /** Largo de cada paso del marchador, en mm. Por defecto 0.25·radio. */
  stepLength?: number
  /** Concordante (climb) deja el material a la derecha del avance. */
  direction?: MillDirection
  /** Radio maximo del circulo de entrada en helice, en mm. */
  maxHelixRadius?: number
  /** Regiones de material mas chicas que esto se ignoran, en mm2. */
  minRegionArea?: number
  /** Tope duro de pasos para que un caso patologico no cuelgue el worker. */
  maxSteps?: number
  /** Muestras del circulo de corte; mas muestras = mas resolucion angular. */
  probeSamples?: number
}

/** Como llega la fresa al arranque de una pasada. */
export type AdaptiveEntry =
  /** Baja en helice dentro del material: hay que rampar en Z sobre el circulo. */
  | { kind: 'helix'; center: Point2D; radius: number; path: Point2D[] }
  /** Cae derecho: no habia lugar para una helice. */
  | { kind: 'plunge'; at: Point2D }
  /** Viene de la pasada anterior por material ya sacado, sin levantar. */
  | { kind: 'link'; path: Point2D[] }
  /** Hay que levantar y reposicionar: el camino directo pasa por material. */
  | { kind: 'retract'; to: Point2D }

/** Por que termino una pasada. Sirve para diagnosticar un recorrido raro. */
export type AdaptivePassEnd =
  /** No queda material al alcance: es el final sano. */
  | 'idle'
  /** Los limites no dejan avanzar para ningun lado. */
  | 'blocked'
  /** Se acabo el presupuesto de pasos. */
  | 'budget'

export interface AdaptivePass {
  entry: AdaptiveEntry
  end: AdaptivePassEnd
  /** Recorrido de corte, un punto por paso del marchador. */
  points: Point2D[]
  /** Arco de contacto en cada punto, en radianes. Mismo largo que `points`. */
  engagement: Float32Array
  /** Largo del recorrido, en mm. */
  length: number
}

export interface AdaptiveResult {
  passes: AdaptivePass[]
  /** Material que quedo sin sacar, en mm2. */
  leftoverArea: number
  warnings: string[]
  stats: {
    steps: number
    pathLength: number
    /** Arco de contacto promedio y maximo, en radianes. */
    meanEngagement: number
    peakEngagement: number
    /**
     * Pasos que no pudieron bajar del objetivo ni girando todo lo permitido.
     *
     * No son un error: son los rincones y cuellos donde la geometria no deja
     * otra. Lo que corresponde es bajarles el avance, con el arco de contacto
     * que viene punto por punto en cada pasada.
     */
    overloadedSteps: number
  }
}

/** Curvaturas que se prueban en el barrido grueso de cada paso. */
const COARSE_CANDIDATES = 9
/** Bisecciones de refinamiento sobre el par que encierra al objetivo. */
const REFINE_STEPS = 4
/** Por debajo de esta fraccion del objetivo se da la pasada por terminada. */
const IDLE_FRACTION = 0.04
/** Multiplo del objetivo a partir del cual un paso cuenta como tiron. */
const OVERLOAD_CEILING = 1.5
/** Pasos que se miran adelante buscando cuellos de material. */
const AHEAD_STEPS = 2
/** Techo para esos pasos; mas flojo porque van sobrestimados. */
const AHEAD_CEILING = 1.8
/** Pasos seguidos en el aire que se toleran antes de cortar la pasada. */
const MAX_IDLE_STEPS = 24

/**
 * Genera el recorrido adaptativo de una capa.
 *
 * `material` se consume: al volver representa lo que quedo sin cortar. Quien
 * llama y lo necesite entero despues que le pase un `clone()`.
 */
export function generateAdaptivePath(
  material: MaterialField,
  opts: AdaptiveOptions,
): AdaptiveResult {
  const toolRadius = Math.max(1e-3, opts.toolRadius)
  const limits = opts.limits ?? material.erode(toolRadius + Math.max(0, opts.stockToLeave ?? 0))
  const probe = createEngagementProbe(toolRadius, material.cellSize, opts.probeSamples ?? 72)

  const targetAngle = angleFromRadialWidth(
    Math.max(material.cellSize, Math.min(opts.targetRadialWidth, toolRadius * 2)),
    toolRadius,
  )
  const idleAngle = targetAngle * IDLE_FRACTION
  const minRadius = Math.max(material.cellSize, opts.minRadius ?? toolRadius * 0.5)
  const stepLength = Math.max(material.cellSize, opts.stepLength ?? toolRadius * 0.25)
  const maxCurvature = 1 / minRadius
  const maxSteps = opts.maxSteps ?? 400_000
  const minRegionArea = opts.minRegionArea ?? Math.PI * toolRadius * toolRadius * 0.25

  // Concordante deja la pared a la derecha del avance (ver
  // `millingCounterClockwise` en geometry.ts). El signo dice hacia donde hay
  // que girar para agarrar mas material.
  const materialSide = (opts.direction ?? 'climb') === 'climb' ? -1 : 1

  const passes: AdaptivePass[] = []
  const warnings: string[] = []
  const limitDistances = limits.distanceField()

  let steps = 0
  let pathLength = 0
  let engagementSum = 0
  let engagementCount = 0
  let peakEngagement = 0
  let overloaded = 0
  let cursor: Point2D | null = null

  while (steps < maxSteps) {
    // Solo cuenta el material sobre el que la fresa se puede parar. Lo que
    // queda contra la pared no lo saca el desbaste: para llegar habria que
    // manejar el centro justo sobre el borde de la zona permitida, un pasillo
    // de ancho cero, y sale una lluvia de picotazos con levante cada uno. Esa
    // franja es la demasia de acabado y la limpia la pasada de contorno.
    const workable = material.intersect(limits)
    if (workable.solidArea() < minRegionArea) break
    const workableDistances = workable.distanceToSolid()

    const start = findStart(material, limits, limitDistances, workableDistances, probe, {
      toolRadius, targetAngle, materialSide, minRegionArea,
      maxHelixRadius: opts.maxHelixRadius ?? toolRadius * 4,
      minRadius, stepLength, maxCurvature,
      from: cursor,
    })
    if (!start) {
      const left = material.solidArea()
      if (left >= minRegionArea) {
        warnings.push(
          `Quedaron ${left.toFixed(1)} mm2 sin desbastar: no hay por donde entrar con esta fresa`,
        )
      }
      break
    }

    const pass = march(material, limits, probe, {
      start: start.point,
      heading: start.heading,
      entry: start.entry,
      toolRadius, targetAngle, idleAngle, stepLength, maxCurvature, materialSide,
      budget: maxSteps - steps,
    })

    if (pass.points.length < 2) {
      // Entro pero no pudo avanzar: sacar el disco evita volver a elegir el
      // mismo arranque y quedarse en el lugar
      material.cutDisc(start.point.x, start.point.y, toolRadius)
      cursor = start.point
      steps++
      continue
    }

    steps += pass.points.length
    pathLength += pass.length
    engagementSum += pass.engagementSum
    engagementCount += pass.points.length
    if (pass.peak > peakEngagement) peakEngagement = pass.peak
    overloaded += pass.overloaded
    cursor = pass.points[pass.points.length - 1]

    passes.push({
      entry: pass.entry,
      end: pass.end,
      points: pass.points,
      engagement: pass.engagement,
      length: pass.length,
    })
  }

  if (steps >= maxSteps) {
    warnings.push('Se corto el adaptativo por tope de pasos: proba un paso mas largo')
  }

  return {
    passes,
    leftoverArea: material.solidArea(),
    warnings,
    stats: {
      steps,
      pathLength,
      meanEngagement: engagementCount > 0 ? engagementSum / engagementCount : 0,
      peakEngagement,
      overloadedSteps: overloaded,
    },
  }
}

// ============================================
// MARCHADOR
// ============================================

interface MarchOptions {
  start: Point2D
  heading: number
  entry: AdaptiveEntry
  toolRadius: number
  targetAngle: number
  idleAngle: number
  stepLength: number
  maxCurvature: number
  materialSide: number
  budget: number
}

interface MarchResult {
  entry: AdaptiveEntry
  end: AdaptivePassEnd
  points: Point2D[]
  engagement: Float32Array
  length: number
  engagementSum: number
  peak: number
  overloaded: number
}

/**
 * Avanza desde el arranque manteniendo el arco de contacto en el objetivo,
 * hasta que se acaba el material alcanzable o se agota el presupuesto.
 */
function march(
  material: MaterialField,
  limits: MaterialField,
  probe: EngagementProbe,
  opts: MarchOptions,
): MarchResult {
  const { stepLength, maxCurvature, materialSide, targetAngle, idleAngle } = opts

  // Por encima de este arco un paso se considera un tiron, no una viruta
  const ceiling = targetAngle * OVERLOAD_CEILING
  const aheadCeiling = targetAngle * AHEAD_CEILING

  const points: Point2D[] = [opts.start]
  const angles: number[] = [0]

  let position = opts.start
  let heading = opts.heading
  let length = 0
  let engagementSum = 0
  let peak = 0
  let overloaded = 0
  let idleRun = 0
  let end: AdaptivePassEnd = 'budget'

  // `u` es "cuanto giro hacia el material": positivo agarra mas, sin importar
  // de que lado quedo la pared. La curvatura real sale al multiplicar por el
  // lado, y asi la busqueda es monotona creciente en todos los casos.
  const params: StepParams = { stepLength, maxCurvature, materialSide, targetAngle }

  for (let step = 0; step < opts.budget; step++) {
    let bestU = Number.NaN
    let bestAngle = -1
    let anyValid = false
    // El par que encierra al objetivo: `lo` se queda corto, `hi` se pasa
    let loU = Number.NaN, loAngle = -1
    let hiU = Number.NaN, hiAngle = -1
    let maxAngle = -1
    // Candidato de emergencia cuando ninguno entra en el techo de carga
    let safestU = Number.NaN, safestPeak = Infinity, safestAngle = 0

    for (let i = 0; i < COARSE_CANDIDATES; i++) {
      const u = maxCurvature * (1 - (2 * i) / (COARSE_CANDIDATES - 1))
      const probed = tryCurvature(material, limits, probe, position, heading, u, params)
      if (!probed) continue

      anyValid = true
      if (probed.end > maxAngle) maxAngle = probed.end
      if (probed.peak < safestPeak) { safestPeak = probed.peak; safestU = u; safestAngle = probed.end }

      // El pico manda como freno: un paso que en el medio atraviesa un cuello
      // de material no sirve por mas que termine rozando. Y el paso siguiente
      // frena antes de entrar donde despues no se puede salir
      if (probed.peak > ceiling) continue
      if (probed.ahead > aheadCeiling) continue
      if (probed.split) continue

      if (probed.end <= targetAngle) {
        // De los que no se pasan, el que mas agarra
        if (probed.end > loAngle) { loAngle = probed.end; loU = u }
      } else if (hiAngle < 0 || probed.end < hiAngle) {
        hiAngle = probed.end; hiU = u
      }
    }

    if (!anyValid) { end = 'blocked'; break } // los limites no dejan avanzar

    if (loAngle >= 0 && hiAngle >= 0) {
      // Biseccion entre el que se queda corto y el que se pasa
      let a = loU, b = hiU
      let aAngle = loAngle
      for (let r = 0; r < REFINE_STEPS; r++) {
        const mid = (a + b) / 2
        const probed = tryCurvature(material, limits, probe, position, heading, mid, params)
        if (!probed || probed.peak > ceiling || probed.ahead > aheadCeiling || probed.split) { b = mid; continue }
        if (probed.end <= targetAngle) { a = mid; aAngle = probed.end }
        else { b = mid }
      }
      bestU = a
      bestAngle = aAngle
    } else if (loAngle >= 0) {
      // Ninguno llega al objetivo: se gira lo que se pueda hacia el material.
      // Es el caso normal al salir de un rincon, donde la pared se aleja
      bestU = loU
      bestAngle = loAngle
    } else if (hiAngle >= 0) {
      // Todos se pasan: se toma el que menos agarra
      bestU = hiU
      bestAngle = hiAngle
      overloaded++
    } else {
      // Ninguno entra en el techo de carga: la fresa quedo metida en material
      // por los dos lados. Se sale por el menos cargado y se cuenta, porque
      // ahi el avance lo tiene que bajar el post
      bestU = safestU
      bestAngle = safestAngle
      overloaded++
    }

    if (maxAngle < idleAngle) { end = 'idle'; break } // no queda material al alcance

    const next = advance(position, heading, bestU * materialSide, stepLength)
    material.cutSweep(position, next.point, opts.toolRadius)

    length += stepLength
    points.push(next.point)
    angles.push(bestAngle)
    engagementSum += bestAngle
    if (bestAngle > peak) peak = bestAngle

    position = next.point
    heading = next.heading

    // Dar vueltas en el aire no saca material y no termina nunca
    idleRun = bestAngle < idleAngle ? idleRun + 1 : 0
    if (idleRun > MAX_IDLE_STEPS) {
      points.length -= idleRun
      angles.length -= idleRun
      length -= idleRun * stepLength
      end = 'idle'
      break
    }
  }

  return {
    entry: opts.entry,
    end,
    points,
    engagement: Float32Array.from(angles),
    length,
    engagementSum,
    peak,
    overloaded,
  }
}

interface Advanced {
  point: Point2D
  heading: number
}

/**
 * Un paso de largo `stepLength` sobre el arco de curvatura `curvature`.
 *
 * Con curvatura cero es una recta; si no, se gira alrededor del centro del
 * arco. El recorrido se guarda como la cuerda de cada paso: con pasos de una
 * fraccion del radio de la fresa la flecha queda por debajo del tamano de
 * celda, asi que no cambia lo que se corta.
 */
function advance(from: Point2D, heading: number, curvature: number, stepLength: number): Advanced {
  if (Math.abs(curvature) < 1e-9) {
    return {
      point: { x: from.x + Math.cos(heading) * stepLength, y: from.y + Math.sin(heading) * stepLength },
      heading,
    }
  }

  const radius = 1 / curvature
  const cx = from.x - Math.sin(heading) * radius
  const cy = from.y + Math.cos(heading) * radius
  const next = heading + curvature * stepLength

  return {
    point: { x: cx + Math.sin(next) * radius, y: cy - Math.cos(next) * radius },
    heading: normalizeAngle(next),
  }
}

interface Probed {
  /** Engagement al terminar el paso: es la senal que dirige. */
  end: number
  /** Peor engagement del paso sin contar el arranque: es la que frena. */
  peak: number
  /**
   * Engagement un paso mas adelante con la misma curvatura, sin cortar.
   *
   * Es lo que avisa del cuello de material antes de meterse: un rib entre la
   * pasada de ahora y una zona ya vaciada se ve como un salto a 180° recien
   * cuando la fresa ya esta adentro y no hay giro que la saque.
   */
  ahead: number
  /**
   * El paso agarra material por los dos lados a la vez.
   *
   * Es la firma de un cuello: una pared de material entre lo que se esta
   * cortando y una zona ya vaciada. Mirar el angulo no alcanza para verlo
   * venir — el cuello cae dentro del barrido que el propio paso descuenta — y
   * cuando se nota ya es una ranura a 180°.
   */
  split: boolean
  point: Point2D
  heading: number
}

/** Parametros del paso, compartidos por el marchador y la busqueda de arranque. */
interface StepParams {
  stepLength: number
  maxCurvature: number
  materialSide: number
  targetAngle: number
}

/**
 * Pasos que se miran hacia adelante para dar un paso por bueno.
 *
 * Sin esto el controlador se clava contra la pared: para sacar el ancho
 * objetivo de una franja mas fina que el objetivo gira todo lo que puede hacia
 * el material, y dos o tres pasos despues no le queda giro para salir.
 */
const ESCAPE_STEPS = 4

/**
 * Evalua un paso sin cometerlo.
 *
 * Devuelve null si el paso se sale de la zona permitida o si, una vez dado, la
 * fresa ya no puede escapar: se prueba la salida mas cerrada en contra del
 * material y tiene que quedar adentro. Un paso del que no se vuelve termina la
 * pasada y obliga a levantar, que es justo lo que el adaptativo tiene que
 * evitar.
 */
function tryCurvature(
  material: MaterialField,
  limits: MaterialField,
  probe: EngagementProbe,
  from: Point2D,
  heading: number,
  turn: number,
  params: StepParams,
): Probed | null {
  const curvature = turn * params.materialSide
  const next = advance(from, heading, curvature, params.stepLength)
  if (!limits.isSolid(next.point.x, next.point.y)) return null

  const escape = -params.maxCurvature * params.materialSide
  let x = next.point
  let h = next.heading
  for (let i = 0; i < ESCAPE_STEPS; i++) {
    const step = advance(x, h, escape, params.stepLength)
    if (!limits.isSolid(step.point.x, step.point.y)) return null
    x = step.point
    h = step.heading
  }

  const sweep = measureSweepEngagement(material, probe, from, next.point, params.stepLength / 2)
  // Se mira varios pasos adelante porque a un paso el cuello ya se comio a la
  // fresa: cuando el arco salta a 180° no hay giro que la saque. Cada mirada
  // descuenta lo que van a sacar los pasos anteriores, que todavia esta en el
  // campo; si no, el marchador esquiva su propia viruta
  const swept: Point2D[] = [from, next.point]
  let look = next
  let ahead = 0
  for (let i = 0; i < AHEAD_STEPS; i++) {
    look = advance(look.point, look.heading, curvature, params.stepLength)
    const a = measureEngagement(material, probe, look.point.x, look.point.y, swept).angle
    if (a > ahead) ahead = a
    swept.push(look.point)
  }

  return {
    end: sweep.end.angle,
    peak: sweep.peak.angle,
    split: sweep.peak.split && sweep.peak.angle > params.targetAngle,
    // Va sobrestimado: no descuenta lo que saca este mismo paso. Con pasos de
    // una fraccion del radio la diferencia es chica y erra para el lado seguro
    ahead,
    point: next.point,
    heading: next.heading,
  }
}

// ============================================
// ARRANQUE DE PASADA
// ============================================

interface StartOptions {
  toolRadius: number
  targetAngle: number
  materialSide: number
  minRegionArea: number
  maxHelixRadius: number
  minRadius: number
  stepLength: number
  maxCurvature: number
  /** Donde quedo la fresa al terminar la pasada anterior. */
  from: Point2D | null
}

/** Tope de candidatos a los que se les mide el engagement por reenganche. */
const MAX_REENTRY_TRIES = 400

interface StartPoint {
  point: Point2D
  heading: number
  entry: AdaptiveEntry
}

/**
 * Elige por donde empezar la proxima pasada.
 *
 * Primero busca reenganchar: una posicion en material ya sacado desde la que
 * la fresa ya agarra el ancho objetivo. Eso evita el bajar-subir-bajar que es
 * la mitad del tiempo perdido de un cajeado, porque el enlace va a profundidad
 * por donde ya no hay material.
 *
 * Si no hay de donde agarrar — arranque de la capa, o una isla de material que
 * quedo aislada — entonces si hay que bajar en helice.
 */
function findStart(
  material: MaterialField,
  limits: MaterialField,
  limitDistances: Float32Array,
  workableDistances: Float32Array,
  probe: EngagementProbe,
  opts: StartOptions,
): StartPoint | null {
  const reentry = findReentry(material, limits, limitDistances, workableDistances, probe, opts)
  if (reentry) return reentry
  return findHelixEntry(material, limitDistances, workableDistances, probe, opts)
}

/** Posicion en zona vaciada desde la que la fresa ya corta al ancho objetivo. */
function findReentry(
  material: MaterialField,
  limits: MaterialField,
  limitDistances: Float32Array,
  workableDistances: Float32Array,
  probe: EngagementProbe,
  opts: StartOptions,
): StartPoint | null {
  const { cols, rows, cells, cellSize } = material

  // El centro tiene que quedar a esta distancia de la pared para que el arco
  // de contacto de justo el objetivo
  const wanted = Math.max(0, opts.toolRadius * Math.cos(opts.targetAngle / 2))
  const band = cellSize * 1.5
  const airDist = material.distanceToSolid()

  // Arrancar pegado al limite no sirve: la fresa no tiene lugar para girar y
  // la pasada muere a los dos pasos contra la pared. Ese sobrante lo saca la
  // pasada de acabado, no el desbaste
  const room = opts.minRadius

  const candidates: { idx: number; score: number }[] = []

  for (let row = 0; row < rows; row++) {
    const base = row * cols
    for (let col = 0; col < cols; col++) {
      const idx = base + col
      if (cells[idx] === 1) continue                        // hay material: no se puede parar aca
      if (Math.abs(airDist[idx] - wanted) > band) continue   // fuera de la banda util
      if (limits.cells[idx] === 0) continue                  // fuera de la zona permitida
      if (limitDistances[idx] < room) continue               // sin lugar para maniobrar
      if (workableDistances[idx] > opts.toolRadius) continue  // solo llega a la demasia de acabado

      const x = material.cellCenterX(col)
      const y = material.cellCenterY(row)
      // A igualdad de carga, el reenganche mas cerca de donde quedo la fresa
      const score = opts.from ? Math.hypot(x - opts.from.x, y - opts.from.y) : 0
      candidates.push({ idx, score })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.score - b.score)

  const minAngle = opts.targetAngle * 0.6
  const maxAngle = opts.targetAngle * 1.05
  const tries = Math.min(candidates.length, MAX_REENTRY_TRIES)

  for (let i = 0; i < tries; i++) {
    const idx = candidates[i].idx
    const row = Math.floor(idx / cols)
    const col = idx - row * cols
    const point = { x: material.cellCenterX(col), y: material.cellCenterY(row) }

    const sample = measureEngagement(material, probe, point.x, point.y)
    if (sample.angle < minAngle || sample.angle > maxAngle) continue
    if (!Number.isFinite(sample.bisector)) continue

    // La pared queda a un lado del avance; el rumbo sale perpendicular a la
    // bisectriz del arco de contacto
    const heading = normalizeAngle(sample.bisector - opts.materialSide * (Math.PI / 2))
    if (!canMarch(material, limits, probe, point, heading, opts)) continue

    const entry = linkTo(material, limits, airDist, probe, opts, point)
    return { point, heading, entry }
  }

  return null
}

/**
 * Arma el enlace hasta el arranque elegido.
 *
 * Si hay camino por zona vaciada la fresa se queda abajo y el tramo se corta
 * del campo, porque ir a profundidad tambien saca lo poco que roce. Si el
 * camino obliga a pasar por material, no queda otra que levantar.
 */
function linkTo(
  material: MaterialField,
  limits: MaterialField,
  airDist: Float32Array,
  probe: EngagementProbe,
  opts: StartOptions,
  to: Point2D,
): AdaptiveEntry {
  if (!opts.from) return { kind: 'retract', to }

  const path = findLinkPath(material, limits, airDist, opts.from, to, opts.toolRadius)
  if (!path) return { kind: 'retract', to }

  // Un enlace que en el medio se come media fresa no es un enlace
  const ceiling = opts.targetAngle * LINK_CEILING
  for (let i = 1; i < path.length; i++) {
    const sweep = measureSweepEngagement(material, probe, path[i - 1], path[i], material.cellSize * 2)
    if (sweep.peak.angle > ceiling) return { kind: 'retract', to }
  }

  for (let i = 1; i < path.length; i++) {
    material.cutSweep(path[i - 1], path[i], opts.toolRadius)
  }

  return { kind: 'link', path }
}

/**
 * True si desde aca se puede arrancar a marchar de verdad.
 *
 * Mide el primer paso en todo el abanico de curvaturas: tiene que haber por
 * donde salir sin pasarse de carga. Filtra los arranques que apuntan contra la
 * pared, que son los que dejan una pasada de dos pasos y un levante al pedo.
 */
function canMarch(
  material: MaterialField,
  limits: MaterialField,
  probe: EngagementProbe,
  point: Point2D,
  heading: number,
  opts: StartOptions,
): boolean {
  let valid = 0
  let lowest = Infinity

  for (let i = 0; i < COARSE_CANDIDATES; i++) {
    const u = opts.maxCurvature * (1 - (2 * i) / (COARSE_CANDIDATES - 1))
    const probed = tryCurvature(material, limits, probe, point, heading, u, {
      stepLength: opts.stepLength,
      maxCurvature: opts.maxCurvature,
      materialSide: opts.materialSide,
      targetAngle: opts.targetAngle,
    })
    if (!probed) continue
    valid++
    if (probed.end < lowest) lowest = probed.end
  }

  return valid >= 2 && lowest <= opts.targetAngle * 1.15
}

/** Baja en helice en el hueco mas ancho que quede con material. */
function findHelixEntry(
  material: MaterialField,
  limitDistances: Float32Array,
  workableDistances: Float32Array,
  probe: EngagementProbe,
  opts: StartOptions,
): StartPoint | null {
  const { cols, cells } = material

  // Donde el centro tiene mas lugar para hacer el circulo sin tocar la pared.
  // Se pide ademas un cacho de material de verdad debajo: bajar en una lasca
  // de medio milimetro contra la pared es puro aire y un levante perdido
  const solidDistances = material.distanceField()
  const minBlob = opts.toolRadius * 0.5

  let bestIdx = -1
  let bestRoom = 0
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === 0) continue        // solo tiene sentido bajar donde hay material
    if (solidDistances[i] < minBlob) continue
    if (workableDistances[i] > 0) continue   // la franja de acabado no se ataca
    const room = limitDistances[i]
    if (room > bestRoom) { bestRoom = room; bestIdx = i }
  }
  if (bestIdx < 0 || bestRoom <= 0) return null

  const row = Math.floor(bestIdx / cols)
  const col = bestIdx - row * cols
  const center: Point2D = { x: material.cellCenterX(col), y: material.cellCenterY(row) }

  // El circulo de la helice tiene que caber dentro de la zona permitida
  const radius = Math.min(opts.maxHelixRadius, bestRoom - material.cellSize)

  if (radius < opts.toolRadius * 0.15) {
    // No hay lugar ni para un circulito: se cae derecho. Es ranurado puro, el
    // post tiene que bajarle el avance
    material.cutDisc(center.x, center.y, opts.toolRadius)
    const sample = measureEngagement(material, probe, center.x, center.y)
    const heading = Number.isFinite(sample.bisector)
      ? normalizeAngle(sample.bisector - opts.materialSide * (Math.PI / 2))
      : 0
    return { point: center, heading, entry: { kind: 'plunge', at: center } }
  }

  // La pared queda por fuera del circulo, asi que el sentido de giro sale del
  // lado del material igual que en cualquier contorno
  const turn = opts.materialSide === -1 ? 1 : -1
  const segments = Math.max(24, Math.ceil((2 * Math.PI * radius) / Math.max(0.2, material.cellSize * 2)))
  const path: Point2D[] = []
  for (let i = 0; i <= segments; i++) {
    const a = turn * (i / segments) * Math.PI * 2
    path.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius })
  }

  for (let i = 1; i < path.length; i++) {
    material.cutSweep(path[i - 1], path[i], opts.toolRadius)
  }
  // La helice baja en espiral: el disco del medio lo saca la ultima vuelta
  material.cutDisc(center.x, center.y, opts.toolRadius + radius)

  const startPoint = path[path.length - 1]
  const heading = normalizeAngle(turn * (Math.PI / 2))

  return { point: startPoint, heading, entry: { kind: 'helix', center, radius, path } }
}

// ============================================
// ENLACE A PROFUNDIDAD
// ============================================

/** Cuanto encarece pasar raspando material frente a ir por el medio del hueco. */
const CROWD_PENALTY = 6
/** Tope de celdas exploradas por enlace, para que un caso raro no cuelgue. */
const MAX_LINK_NODES = 250_000
/** Arco maximo que se tolera durante un enlace, como multiplo del objetivo. */
const LINK_CEILING = 1.5

/**
 * Busca como ir de un punto al otro sin levantar la fresa.
 *
 * Es un Dijkstra sobre la grilla: las celdas con material o fuera de la zona
 * permitida no se pisan, y las que quedan cerca de una pared cuestan mas, asi
 * el enlace sale por el medio del hueco en vez de ir raspando.
 *
 * Sin esto cada reenganche obliga a subir, ir en rapido y volver a bajar. Con
 * un desbaste que reengancha cientos de veces, eso es la mitad del tiempo de
 * la operacion tirado en levantes.
 */
function findLinkPath(
  material: MaterialField,
  limits: MaterialField,
  airDist: Float32Array,
  from: Point2D,
  to: Point2D,
  toolRadius: number,
): Point2D[] | null {
  const { cols, rows, cells, cellSize } = material

  const fromCol = material.colAt(from.x), fromRow = material.rowAt(from.y)
  const toCol = material.colAt(to.x), toRow = material.rowAt(to.y)
  if (fromCol < 0 || fromCol >= cols || fromRow < 0 || fromRow >= rows) return null
  if (toCol < 0 || toCol >= cols || toRow < 0 || toRow >= rows) return null

  const startIdx = fromRow * cols + fromCol
  const goalIdx = toRow * cols + toCol
  if (startIdx === goalIdx) return [from, to]

  const blocked = (idx: number) => cells[idx] === 1 || limits.cells[idx] === 0
  // Los extremos estan contra el material por definicion — es de donde viene y
  // adonde va la fresa cortando — asi que no se los exige libres
  if (limits.cells[startIdx] === 0 || limits.cells[goalIdx] === 0) return null

  const dist = new Float32Array(cells.length).fill(Infinity)
  const prev = new Int32Array(cells.length).fill(-1)
  const done = new Uint8Array(cells.length)
  const heap = new MinHeap(1024)

  dist[startIdx] = 0
  heap.push(0, startIdx)

  let expanded = 0
  let found = false

  while (heap.size > 0) {
    const idx = heap.pop()
    if (done[idx] === 1) continue
    done[idx] = 1
    if (idx === goalIdx) { found = true; break }
    if (++expanded > MAX_LINK_NODES) break

    const row = (idx / cols) | 0
    const col = idx - row * cols

    for (let dr = -1; dr <= 1; dr++) {
      const nr = row + dr
      if (nr < 0 || nr >= rows) continue
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const nc = col + dc
        if (nc < 0 || nc >= cols) continue

        const n = nr * cols + nc
        if (done[n] === 1) continue
        if (n !== goalIdx && blocked(n)) continue

        // Raspar la pared cuesta caro pero no esta prohibido: cerca de los
        // extremos no hay otra
        const crowd = Math.max(0, (toolRadius - airDist[n]) / toolRadius)
        const stepCost = (dr === 0 || dc === 0 ? cellSize : cellSize * Math.SQRT2)
          * (1 + CROWD_PENALTY * crowd * crowd)

        const nd = dist[idx] + stepCost
        if (nd < dist[n]) {
          dist[n] = nd
          prev[n] = idx
          heap.push(nd, n)
        }
      }
    }
  }

  if (!found) return null

  const cellPath: number[] = []
  for (let idx = goalIdx; idx !== -1; idx = prev[idx]) cellPath.push(idx)
  cellPath.reverse()

  const points: Point2D[] = cellPath.map((idx) => {
    const row = (idx / cols) | 0
    return { x: material.cellCenterX(idx - row * cols), y: material.cellCenterY(row) }
  })
  points[0] = from
  points[points.length - 1] = to

  return simplifyLink(material, limits, points)
}

/**
 * Deja solo los vertices que hacen falta.
 *
 * El camino sale celda por celda y en escalerita; se va tirando vertices
 * mientras el atajo siga sin pisar material, que en un hueco grande deja el
 * enlace en dos o tres tramos.
 */
function simplifyLink(material: MaterialField, limits: MaterialField, points: Point2D[]): Point2D[] {
  if (points.length <= 2) return points

  const out: Point2D[] = [points[0]]
  let anchor = 0

  while (anchor < points.length - 1) {
    let best = anchor + 1
    for (let i = points.length - 1; i > anchor + 1; i--) {
      if (segmentClear(material, limits, points[anchor], points[i])) { best = i; break }
    }
    out.push(points[best])
    anchor = best
  }

  return out
}

/** True si el eje de la fresa puede ir derecho entre los dos puntos. */
function segmentClear(material: MaterialField, limits: MaterialField, a: Point2D, b: Point2D): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / material.cellSize))

  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const x = a.x + dx * t
    const y = a.y + dy * t
    if (!limits.isSolid(x, y)) return false
    if (material.isSolid(x, y)) return false
  }

  return true
}

/** Monticulo binario de costos sobre indices de celda. */
class MinHeap {
  private costs: Float64Array
  private items: Int32Array
  size = 0

  constructor(capacity: number) {
    this.costs = new Float64Array(capacity)
    this.items = new Int32Array(capacity)
  }

  push(cost: number, item: number): void {
    if (this.size === this.costs.length) this.grow()
    let i = this.size++
    this.costs[i] = cost
    this.items[i] = item
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.costs[parent] <= this.costs[i]) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const top = this.items[0]
    this.size--
    if (this.size > 0) {
      this.costs[0] = this.costs[this.size]
      this.items[0] = this.items[this.size]
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let small = i
        if (l < this.size && this.costs[l] < this.costs[small]) small = l
        if (r < this.size && this.costs[r] < this.costs[small]) small = r
        if (small === i) break
        this.swap(i, small)
        i = small
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const c = this.costs[a]; this.costs[a] = this.costs[b]; this.costs[b] = c
    const it = this.items[a]; this.items[a] = this.items[b]; this.items[b] = it
  }

  private grow(): void {
    const costs = new Float64Array(this.costs.length * 2)
    costs.set(this.costs)
    const items = new Int32Array(this.items.length * 2)
    items.set(this.items)
    this.costs = costs
    this.items = items
  }
}
