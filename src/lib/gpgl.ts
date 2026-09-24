// Programa GPGL para cortadoras Silhouette / Graphtec.
//
// La cortadora no lee G-code: recibe comandos GPGL en unidades de 1/20 mm
// ("SU") con el origen en la esquina superior izquierda del material, X a lo
// ancho del carro e Y en el sentido de avance del rodillo. Los comandos de
// movimiento van con Y primero: `M<y>,<x>` mueve sin cortar, `D<y>,<x>` corta.
//
// Aca solo se arman los comandos (sin el ETX de cierre, lo agrega el
// backend). El envio y la espera entre tandas viven en
// `src-tauri/src/commands/silhouette.rs`.

import type { GCodePath, Point2D, WorkArea } from './types'
import type { SilhouetteDevice } from './generated/SilhouetteDevice'
import type { SilhouetteStep } from './generated/SilhouetteStep'
import { REGMARK, type RegmarkLayout } from './print-cut'

export type SilhouetteTool = 'blade' | 'autoblade' | 'pen'

export type SilhouetteMat =
  | 'none'
  | 'cameo_12x12'
  | 'cameo_12x24'
  | 'portrait_8x12'
  | 'portrait_8_5x12'
  | 'cameo_plus_15x15'
  | 'cameo_pro_24x24'

/** Tapetes: codigo del comando TG y medida en pulgadas (ancho x largo). */
export const SILHOUETTE_MATS: Record<SilhouetteMat, { label: string; code: number; widthIn: number; lengthIn: number }> = {
  none: { label: 'Sin tapete', code: 0, widthIn: 0, lengthIn: 0 },
  cameo_12x12: { label: 'Cameo 12x12"', code: 1, widthIn: 12, lengthIn: 12 },
  cameo_12x24: { label: 'Cameo 12x24"', code: 2, widthIn: 12, lengthIn: 24 },
  portrait_8x12: { label: 'Portrait 8x12"', code: 3, widthIn: 8, lengthIn: 12 },
  portrait_8_5x12: { label: 'Portrait 8.5x12"', code: 11, widthIn: 8.5, lengthIn: 12 },
  cameo_plus_15x15: { label: 'Cameo Plus 15x15"', code: 8, widthIn: 15, lengthIn: 15 },
  cameo_pro_24x24: { label: 'Cameo Pro 24x24"', code: 9, widthIn: 24, lengthIn: 24 },
}

export interface SilhouetteCutSettings {
  tool: SilhouetteTool
  /** Portaherramientas 1 (izquierdo) o 2 (derecho) en los modelos con dos. */
  toolholder: 1 | 2
  /** Fuerza, 1..33 (40 en las Alpha). */
  pressure: number
  /** 1..10 en modelos viejos, 1..30 desde la Cameo 4. */
  speed: number
  /** Distancia de la punta al eje de la cuchilla (mm). La compensa el equipo. */
  bladeOffset: number
  /** Profundidad de la AutoBlade, 0..10. */
  depth: number
  passes: number
  /** Se sigue cortando esta distancia al cerrar una forma, para que no quede unida. */
  overcut: number
  mat: SilhouetteMat
  /** El rodillo pasa varias veces antes de cortar para marcar la huella. */
  trackEnhancing: boolean
  /** Donde queda el material al terminar: donde empezo, o avanzado bajo el corte. */
  endPosition: 'start' | 'below'
}

export const DEFAULT_SILHOUETTE_SETTINGS: SilhouetteCutSettings = {
  tool: 'blade',
  toolholder: 1,
  pressure: 10,
  speed: 5,
  bladeOffset: 0.9,
  depth: 3,
  passes: 1,
  overcut: 0,
  mat: 'cameo_12x12',
  trackEnhancing: false,
  endPosition: 'start',
}

/** Silhouette Units: 20 por mm. */
const SU_PER_MM = 20
const SU_PER_INCH = 508

const su = (mm: number) => Math.round(mm * SU_PER_MM)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)))

/**
 * Pasa los paths del lienzo (mm respecto del origen elegido, Y hacia arriba
 * si el origen esta abajo) a mm desde la esquina superior izquierda del area
 * de trabajo, que es como los entiende la cortadora.
 */
export function toMediaCoords(paths: GCodePath[], workArea: WorkArea): GCodePath[] {
  const { width, height, origin } = workArea
  const ox = origin.endsWith('left') ? 0 : origin.endsWith('right') ? width : width / 2
  const oy = origin.startsWith('top') ? 0 : origin.startsWith('bottom') ? height : height / 2
  const flipY = origin.startsWith('bottom')
  return paths.map((p) => ({
    ...p,
    points: p.points.map((pt) => ({ x: ox + pt.x, y: flipY ? oy - pt.y : oy + pt.y })),
  }))
}

export interface GpglProgram {
  /** Lo que se manda, en tramos (la busqueda de marcas espera respuesta). */
  steps: SilhouetteStep[]
  /** Todos los comandos seguidos, para mostrar o guardar. */
  commands: string[]
  warnings: string[]
  /** Errores que impiden mandar el trabajo (fuera del area del equipo). */
  errors: string[]
  cutLengthMm: number
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null
}

/** Area donde el equipo puede cortar (mm), segun el tapete o el material. */
export function cuttingArea(
  device: SilhouetteDevice,
  settings: SilhouetteCutSettings,
  media: { width: number; height: number },
): { width: number; height: number } {
  const mat = SILHOUETTE_MATS[settings.mat]
  if (mat.code !== 0) {
    return { width: (mat.widthIn * SU_PER_INCH) / SU_PER_MM, height: (mat.lengthIn * SU_PER_INCH) / SU_PER_MM }
  }
  return {
    width: device.widthMm > 0 ? Math.min(device.widthMm, media.width) : media.width,
    height: device.lengthMm > 0 ? Math.min(device.lengthMm, media.height) : media.height,
  }
}

/** Recorre `dist` mm a lo largo del contorno desde su inicio. */
function overcutPoints(points: Point2D[], dist: number): Point2D[] {
  const out: Point2D[] = []
  let left = dist
  for (let i = 1; i < points.length && left > 0; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len <= left) {
      out.push(b)
      left -= len
    } else {
      const t = left / len
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      left = 0
    }
  }
  return out
}

/**
 * Comandos de herramienta. Desde la Cameo 3 llevan el portaherramientas como
 * ultimo argumento; las viejas solo entienden la forma corta.
 */
function toolSetup(device: SilhouetteDevice, s: SilhouetteCutSettings): string[] {
  const pen = s.tool === 'pen'
  const pressure = clamp(s.pressure, 1, device.maxPressure)
  const speed = clamp(s.speed, 1, device.maxSpeed)
  const offset = pen ? 0 : su(s.bladeOffset)
  const h = device.twoTools ? s.toolholder : 1
  const cmds: string[] = []

  if (device.family === 'legacy') {
    cmds.push(`!${speed}`, `FX${pressure}`, `FC${offset}`)
    cmds.push(s.trackEnhancing ? 'FY0' : 'FY1')
    return cmds
  }

  // Esquinas: la cuchilla levanta un poco al girar en angulos cerrados; con
  // pluma no tiene sentido
  const corners = pen ? [`FF0,0,${h}`, `FF0,0,${h}`] : [`FF1,0,${h}`, `FF1,1,${h}`]

  if (device.twoTools) cmds.push(`J${h}`)
  if (device.family === 'cameo4') {
    cmds.push(`FX${pressure},${h}`, 'TJ0', `!${speed},${h}`, `FC0,1,${h}`, `FE0,${h}`, ...corners)
    cmds.push(`FX${pressure},${h}`, 'TJ3', `FC${offset},1,${h}`)
  } else {
    cmds.push(`!${speed},${h}`, `FX${pressure},${h}`, `FE0,${h}`, ...corners, `FC0,1,${h}`)
    if (!pen) cmds.push(`FC${offset},1,${h}`)
  }
  // La profundidad de la AutoBlade solo se puede fijar en el portaherramientas 1
  if (s.tool === 'autoblade' && h === 1) cmds.push(`TF${clamp(s.depth, 0, 10)},1`)
  if (s.trackEnhancing) cmds.push('FY0')
  return cmds
}

/**
 * Configuracion de las marcas (tipo Cameo/Portrait, medidas de `REGMARK`) y
 * busqueda automatica. La cortadora recorre la zona de cada marca con el
 * sensor; responde "0" si las encontro. `top`/`left` dicen donde empezar a
 * buscar: un poco antes de la marca, para que la encuentre aunque el papel
 * este algo corrido.
 */
function registrationSteps(layout: RegmarkLayout): SilhouetteStep[] {
  const { origin, width, length } = layout
  return [
    {
      kind: 'send',
      commands: ['TB50,0', 'TB99', 'TB52,2', `TB51,${su(REGMARK.arm)}`, `TB53,${su(REGMARK.line)}`, 'TB55,1'],
    },
    {
      kind: 'expect',
      command: `TB123,${su(length)},${su(width)},${su(Math.max(origin.y - 10, 0))},${su(Math.max(origin.x - 10, 0))}`,
      expect: '0',
      timeoutMs: 40000,
      error: 'La cortadora no encontro las marcas de registro. Revisa que la hoja este bien cargada, que la impresion sea a escala 100% y que las marcas se vean nitidas',
    },
  ]
}

/**
 * Arma el programa completo. `paths` ya en coordenadas del material
 * (ver `toMediaCoords`). Con `registration` las coordenadas se miden desde
 * la marca superior izquierda y la cortadora busca las marcas antes de
 * cortar.
 */
export function buildGpgl(
  paths: GCodePath[],
  device: SilhouetteDevice,
  settings: SilhouetteCutSettings,
  media: { width: number; height: number },
  registration?: RegmarkLayout,
): GpglProgram {
  const warnings: string[] = []
  const errors: string[] = []
  const area = cuttingArea(device, settings, media)

  // Limites y bbox en mm del material
  let bbox: GpglProgram['bbox'] = null
  for (const p of paths) {
    for (const pt of p.points) {
      if (!bbox) bbox = { minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y }
      else {
        bbox.minX = Math.min(bbox.minX, pt.x)
        bbox.minY = Math.min(bbox.minY, pt.y)
        bbox.maxX = Math.max(bbox.maxX, pt.x)
        bbox.maxY = Math.max(bbox.maxY, pt.y)
      }
    }
  }
  if (!bbox) {
    return { steps: [], commands: [], warnings, errors: ['No hay trazos para cortar'], cutLengthMm: 0, bbox }
  }
  const tol = 0.05
  if (bbox.minX < -tol || bbox.minY < -tol) {
    errors.push('Hay trazos fuera del material (a la izquierda o arriba del origen)')
  }
  if (bbox.maxX > area.width + tol) {
    errors.push(`El diseño mide hasta ${bbox.maxX.toFixed(1)} mm de ancho y el area de corte es de ${area.width.toFixed(1)} mm`)
  }
  if (bbox.maxY > area.height + tol) {
    errors.push(`El diseño llega a ${bbox.maxY.toFixed(1)} mm de largo y el area de corte es de ${area.height.toFixed(1)} mm`)
  }
  if (registration) {
    const { origin, width, length } = registration
    if (bbox.minX < origin.x || bbox.minY < origin.y || bbox.maxX > origin.x + width || bbox.maxY > origin.y + length) {
      errors.push('Con marcas de registro todo el corte tiene que quedar dentro del area entre marcas')
    }
    if (width + origin.x > area.width + tol || length + origin.y > area.height + tol) {
      errors.push('La hoja con marcas no cabe en el area de corte del tapete elegido')
    }
  }
  if (!device.known) {
    warnings.push('Modelo no reconocido: se usan los comandos basicos, que entienden todas las Silhouette')
  }
  if (settings.toolholder === 2 && !device.twoTools) {
    warnings.push('Este modelo tiene un solo portaherramientas; se usa el 1')
  }
  if (settings.tool === 'autoblade' && device.twoTools && settings.toolholder === 2) {
    warnings.push('La AutoBlade solo ajusta profundidad en el portaherramientas 1')
  }

  const cmds: string[] = []

  // Encabezado: orientacion vertical, tapete y limites del area
  const mat = SILHOUETTE_MATS[settings.mat]
  if (device.family !== 'legacy') {
    cmds.push(`TG${mat.code}`)
  }
  cmds.push('FN0', 'TB50,0')
  const bottom = mat.code !== 0 ? mat.lengthIn * SU_PER_INCH : su(area.height)
  const right = mat.code !== 0 ? mat.widthIn * SU_PER_INCH : su(area.width)
  cmds.push('\\0,0', `Z${bottom},${right}`)
  if (device.family === 'legacy') cmds.push('L0', 'FE0,0', 'FF0,0,0')

  cmds.push(...toolSetup(device, settings))

  const steps: SilhouetteStep[] = [{ kind: 'send', commands: cmds }]
  const body: string[] = []

  // Con marcas el cero es la esquina de la marca superior izquierda: la
  // cortadora mide desde ahi despues de encontrarla
  let offX = device.marginLeftMm
  let offY = device.marginTopMm
  if (registration) {
    steps.push(...registrationSteps(registration))
    offX = -registration.origin.x
    offY = -registration.origin.y
  }

  // Cuerpo
  let cutLength = 0
  const passes = Math.max(1, Math.round(settings.passes))
  const overcut = settings.tool === 'pen' ? 0 : Math.max(0, settings.overcut)
  for (let pass = 0; pass < passes; pass++) {
    for (const path of paths) {
      if (path.points.length < 2) continue
      const pts = [...path.points]
      if (path.closed) {
        const first = pts[0]
        const last = pts[pts.length - 1]
        if (first.x !== last.x || first.y !== last.y) pts.push(first)
        if (overcut > 0) pts.push(...overcutPoints(path.points.concat(first), overcut))
      }

      let prev = ''
      pts.forEach((pt, i) => {
        const y = su(pt.y + offY)
        const x = su(pt.x + offX)
        const key = `${y},${x}`
        if (key === prev) return
        body.push(`${i === 0 ? 'M' : 'D'}${key}`)
        prev = key
        if (i > 0) cutLength += Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y)
      })
    }
  }

  // Cierre: levantar la herramienta y dejar el material donde se pidio
  if (settings.endPosition === 'below') {
    body.push(`M${su(bbox.maxY + offY)},0`, 'SO0', 'FN0')
  } else if (device.family === 'legacy') {
    body.push('H')
  } else {
    body.push('L0', '\\0,0', 'M0,0')
    if (device.twoTools) body.push('J0')
    body.push('FN0', 'TB50,0')
  }
  steps.push({ kind: 'send', commands: body })

  const commands = steps.flatMap((st) => (st.kind === 'send' ? st.commands : [st.command]))
  return { steps, commands, warnings, errors, cutLengthMm: cutLength, bbox }
}
