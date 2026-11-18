// ============================================
// Camino unico de generacion de G-code
// ============================================
//
// Todos los botones "Generar" pasan por aca. Antes cada pantalla armaba su
// propio generador: solo el arbol de CAM aplicaba el plan (operaciones
// apagadas, orden, solo), la altura segura del setup, los marcadores y las
// mordazas, asi que el mismo proyecto daba un programa distinto segun desde
// donde se generara.

import type { GCodeJob, GCodeMarker, ClampRect, RasterData } from './types'
import { GCodeGenerator } from './gcode-generator'
import { applyCAMPlan, jobsBBox, resolveStock, checkStockCoverage } from './cam-jobs'
import { findCollisions, summarizeCollisions, toolProfileFrom } from './collision'
import { parseGCode } from './gcode-parser'
import { validateToolVsPaths } from './geometry'
import { withGenerating } from './gcode-run'
import { toast } from './toast'
import { useCAMStore, opRunsInGCode } from '@/stores/useCAMStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useAppStore } from '@/stores/useAppStore'
import { isFlatOperation } from '@/hooks/useFlatCAM'

export interface PreparedProgram {
  jobs: GCodeJob[]
  rasterData: RasterData | null
  markers: GCodeMarker[]
  clamps: ClampRect[]
  clampLabels: string[]
  safeZ: number
  /** Corrimiento de Z cuando el cero de pieza esta en la mesa. */
  zShift: number
  flat: boolean
}

function isFlat(): boolean {
  const ops = useCAMStore.getState().operations
  return ops.length > 0
    ? ops.every((o) => isFlatOperation(o.config.operationType))
    : isFlatOperation(useCanvasStore.getState().globalConfig.operationType)
}

/** Segmento contra rectangulo (Liang-Barsky). */
function segmentHitsRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  r: { x: number; y: number; width: number; height: number },
): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - r.x, r.x + r.width - a.x, a.y - r.y, r.y + r.height - a.y]
  let u1 = 0
  let u2 = 1
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k] < 0) return false
    } else {
      const t = q[k] / p[k]
      if (p[k] < 0) {
        if (t > u2) return false
        if (t > u1) u1 = t
      } else {
        if (t < u1) return false
        if (t < u2) u2 = t
      }
    }
  }
  return u1 <= u2
}

/**
 * Numeros que no pueden salir al G-code. Un campo vacio se guarda como 0 y un
 * `F0` o `S NaN` llega a la maquina sin que nadie lo vea: esto bloquea.
 */
function hardErrors(job: GCodeJob): string[] {
  const c = job.config
  const errs: string[] = []
  const num = (v: unknown) => parseFloat(String(v))
  const positive = (v: unknown, label: string) => {
    const n = num(v)
    if (!Number.isFinite(n) || n <= 0) errs.push(`${label} debe ser mayor que 0`)
  }
  const finite = (v: unknown, label: string) => {
    if (!Number.isFinite(num(v))) errs.push(`${label} no es un numero valido`)
  }

  if (c.operationType === 'cnc') {
    if (c.workType === 'photoVcarve') return errs
    positive(c.feedRate, 'Avance')
    positive(c.plungeRate, 'Avance de penetracion')
    positive(c.depthStep, 'Paso de profundidad')
    positive(c.toolDiameter, 'Diametro de herramienta')
    finite(c.spindleRPM, 'RPM')
    const depth = Math.abs(num(c.depth))
    if (!Number.isFinite(depth) || depth === 0) errs.push('Profundidad debe ser distinta de 0')
    if (c.workType === 'pocket') positive(c.stepover, 'Stepover')
  } else if (c.operationType === 'laser') {
    if (c.laserMode !== 'raster') positive(c.speed || c.feedRate, 'Velocidad')
  } else {
    positive(c.speed || c.feedRate, 'Velocidad')
  }

  for (const path of job.paths) {
    if (path.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      errs.push('Tiene coordenadas invalidas (NaN)')
      break
    }
  }
  return errs
}

/** Aplica el plan del arbol de CAM sin validar ni avisar (para vistas previas). */
export function plannedJobs(rawJobs: GCodeJob[]): GCodeJob[] {
  const cam = useCAMStore.getState()
  return applyCAMPlan(rawJobs, {
    order: cam.operationOrder,
    disabled: new Set(cam.operations.filter((o) => !o.enabled).map((o) => o.id)),
    soloId: cam.soloOperationId,
    optimize: cam.setup.optimizeOrder,
  })
}

/** Altura segura y corrimiento de Z segun el setup de CAM actual. */
export function setupGeneratorParams(): Pick<PreparedProgram, 'safeZ' | 'zShift'> {
  const { setup } = useCAMStore.getState()
  const stock = setup.stock
  return {
    safeZ: setup.safeZ,
    zShift:
      !isFlat() && stock.enabled && stock.zeroAt === 'bottom' && stock.thickness > 0
        ? stock.thickness
        : 0,
  }
}

/**
 * Valida y arma todo lo que el generador necesita. Devuelve null (y avisa)
 * si algo bloquea la generacion.
 */
export function prepareProgram(rawJobs: GCodeJob[]): PreparedProgram | null {
  const log = useAppStore.getState().addConsoleLine
  const cam = useCAMStore.getState()
  // El arbol puede no estar montado (se genera desde Diseno): se sincroniza
  // para que el plan y sus errores correspondan al lienzo actual.
  cam.syncFromCanvas()
  const camState = useCAMStore.getState()
  const { globalConfig, rasterData } = useCanvasStore.getState()
  const flat = isFlat()

  const errors = camState.operations.filter(
    (o) => o.status === 'error' && opRunsInGCode(o, camState.soloOperationId),
  )
  if (errors.length > 0) {
    for (const err of errors) log(`ERROR: ${err.elementName} — ${err.warnings.join(', ')}`)
    log('Corrige los errores antes de generar G-code')
    toast.error('G-code bloqueado por errores en el arbol', {
      detail: errors.map((e) => `${e.elementName}: ${e.warnings.join(', ')}`).join(' | '),
    })
    return null
  }

  // El arbol de CAM manda: apagar, reordenar o aislar una operacion ahi
  // tiene que verse en el G-code.
  const jobs = applyCAMPlan(rawJobs, {
    order: camState.operationOrder,
    disabled: new Set(camState.operations.filter((o) => !o.enabled).map((o) => o.id)),
    soloId: camState.soloOperationId,
    optimize: camState.setup.optimizeOrder,
  })

  if (rawJobs.length > 0 && jobs.length === 0) {
    log('Todas las operaciones estan apagadas')
    toast.warning('Todas las operaciones estan apagadas')
    return null
  }
  if (camState.setup.optimizeOrder) log('Orden optimizado por cercania entre operaciones')

  // Los dos modos que salen de la imagen y no de la geometria
  const fromImage =
    (globalConfig.operationType === 'laser' && globalConfig.laserMode === 'raster') ||
    (globalConfig.operationType === 'cnc' && globalConfig.workType === 'photoVcarve')

  if (jobs.length === 0 && !fromImage) {
    log('No se encontraron elementos validos en el canvas')
    toast.warning('No hay elementos validos en el canvas')
    return null
  }
  if (fromImage && !rasterData) {
    log('No hay imagen cargada - importa una imagen primero')
    toast.warning('No hay imagen cargada')
    return null
  }

  // Validacion dura de numeros
  let blocked = false
  for (const job of jobs) {
    for (const err of hardErrors(job)) {
      log(`ERROR: "${job.elementName}" — ${err}`)
      blocked = true
    }
  }
  if (blocked) {
    toast.error('G-code bloqueado: hay parametros invalidos', {
      detail: 'Revisa avance, profundidad y herramienta en la consola',
    })
    return null
  }

  const { setup } = camState
  const stock = setup.stock
  if (stock.enabled && !flat) {
    const bbox = jobsBBox(jobs)
    const resolved = resolveStock(stock, bbox)
    for (const warn of checkStockCoverage(resolved, bbox)) log(`WARN: ${warn}`)
  }

  // Marcadores de la linea de tiempo -> despues de que job van
  const markers: GCodeMarker[] = []
  if (camState.markers.length > 0 && jobs.length > 0) {
    for (const marker of camState.markers) {
      markers.push({
        type: marker.type,
        message: marker.message,
        afterJobIndex: Math.min(
          Math.floor((marker.progress / 100) * jobs.length),
          jobs.length - 1,
        ),
        parkPosition: marker.parkPosition,
      })
    }
  }

  // Mordazas: un corte que las atraviesa bloquea
  const camClamps = flat ? [] : setup.clamps
  for (const job of jobs) {
    for (const path of job.paths) {
      const n = path.points.length
      const last = path.closed ? n : n - 1
      for (let i = 0; i < last; i++) {
        const a = path.points[i]
        const b = path.points[(i + 1) % n]
        for (const clamp of camClamps) {
          if (segmentHitsRect(a, b, clamp)) {
            log(`ERROR: "${job.elementName}" colisiona con clamp "${clamp.label}" — mueve el clamp o el elemento`)
            toast.error('G-code bloqueado: colision con un clamp', {
              detail: `"${job.elementName}" pasa por "${clamp.label}"`,
            })
            return null
          }
        }
      }
    }
  }

  // Herramienta contra geometria
  let toolError = false
  for (const job of jobs) {
    if (job.config.operationType !== 'cnc') continue
    const toolDiam = parseFloat(String(job.config.toolDiameter))
    if (!toolDiam || toolDiam <= 0) continue
    const validation = validateToolVsPaths(
      job.paths.map((p) => ({ points: p.points, closed: p.closed })),
      toolDiam,
      job.config.workType,
    )
    for (const err of validation.errors) {
      log(`ERROR: "${job.elementName}" — ${err}`)
      toolError = true
    }
    for (const warn of validation.warnings) log(`WARN: "${job.elementName}" — ${warn}`)
  }
  if (toolError) {
    log('Generacion bloqueada: herramienta demasiado grande para la geometria. Usa una herramienta mas pequena o cambia la estrategia.')
    toast.error('G-code bloqueado: herramienta demasiado grande para la geometria')
    return null
  }

  // Cero en la mesa: todo el programa sube el grosor del material
  const { zShift } = setupGeneratorParams()
  if (zShift > 0) log(`Cero de pieza en la mesa: Z desplazada +${zShift}mm`)

  return {
    jobs,
    rasterData,
    markers,
    clamps: camClamps.map((c) => ({ x: c.x, y: c.y, width: c.width, height: c.height, zHeight: c.zHeight })),
    clampLabels: camClamps.map((c) => c.label),
    safeZ: setup.safeZ,
    zShift,
    flat,
  }
}

/** Generador ya configurado con el setup de CAM. */
export function createGenerator(prep: Pick<PreparedProgram, 'safeZ' | 'zShift'>): GCodeGenerator {
  const generator = new GCodeGenerator()
  generator.setSafeZ(prep.safeZ)
  generator.setZShift(prep.zShift)
  generator.setRasterPlacement(useCanvasStore.getState().workArea)
  return generator
}

/**
 * Valida, genera y deja el programa en el store. Devuelve true si genero.
 */
export async function buildProgram(rawJobs: GCodeJob[]): Promise<boolean> {
  const log = useAppStore.getState().addConsoleLine
  const prep = prepareProgram(rawJobs)
  if (!prep) return false

  log('Generando G-code...')
  const { result, est } = await withGenerating(async () => {
    const generator = createGenerator(prep)
    const out = await generator.generateFromJobs(prep.jobs, prep.rasterData, prep.markers, prep.clamps)
    return { result: out, est: generator.getEstimates() }
  })

  const { setGCode, setEstimates } = useGCodeStore.getState()
  setGCode(result)
  setEstimates({
    time: est.time > 60 ? `${(est.time / 60).toFixed(1)} min` : `${est.time.toFixed(0)} seg`,
    distance: est.distance > 1000 ? `${(est.distance / 1000).toFixed(2)} m` : `${est.distance.toFixed(1)} mm`,
  })

  const lineCount = result.split('\n').length
  const uniqueTools = new Set(prep.jobs.map((j) => j.config.tool).filter(Boolean)).size
  log(`G-code generado: ${lineCount} lineas, ${prep.jobs.length} elementos, ${uniqueTools} herramientas`)

  // Colision de herramienta y portaherramientas contra las mordazas. El
  // chequeo previo mira solo el eje de la fresa en planta; este mira el
  // volumen real a cada altura, que es donde pega la tuerca del portapinzas.
  if (prep.clamps.length > 0) {
    const { tools } = useLibraryStore.getState()
    const cncJob = prep.jobs.find((j) => j.config.operationType === 'cnc')
    if (cncJob) {
      const tool = cncJob.config.tool ? tools.find((t) => t.id === cncJob.config.tool) : null
      const profile = toolProfileFrom(tool, cncJob.config.toolDiameter)
      const moves = parseGCode(result).segments.map((seg) => ({ from: seg.from, to: seg.to }))
      const hits = findCollisions(moves, prep.clamps, profile, prep.clampLabels)
      for (const line of summarizeCollisions(hits)) log(`WARN: ${line}`)
      if (hits.length > 0) {
        log('Revisa las medidas del portaherramientas en la libreria si el aviso no corresponde')
      }
    }
  }
  return true
}
