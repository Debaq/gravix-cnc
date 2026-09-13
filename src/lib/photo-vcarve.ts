/**
 * Photo V-Carve: una foto tallada con fresa en V.
 *
 * La idea es la misma del grabado raster, pero cambiando la potencia por la
 * profundidad: la punta recorre surcos paralelos y baja mas donde la imagen es
 * oscura. Como la fresa es conica, a mas profundidad mas ancho el surco, y la
 * suma de surcos de ancho variable reconstruye los tonos de la foto.
 *
 * El ancho de un surco a profundidad d es 2·d·tan(angulo/2), asi que la
 * separacion entre lineas se calcula sola: la del surco a profundidad maxima.
 * Con eso, las zonas negras se tocan entre si (negro pleno) y las claras dejan
 * material sin tocar entre surco y surco.
 *
 * Todo en milimetros. La funcion es pura: no toca el store ni el canvas.
 */

export interface PhotoVCarveOptions {
  /** Dimensiones de la imagen en pixeles. */
  width: number
  height: number
  /** Tamaño de pixel en mm (lo trae el pipeline raster). */
  pixelMm: number
  /** Angulo total de la fresa en V (grados). */
  angleDeg: number
  /** Profundidad para el negro pleno (mm). */
  maxDepth: number
  /** Por debajo de esta profundidad no se talla (mm). */
  minDepth: number
  /** Separacion entre surcos (mm). 0 = calcularla del angulo y la profundidad. */
  lineSpacing: number
  /** Direccion de los surcos. */
  direction: 'horizontal' | 'vertical'
  /** true: lo claro es lo profundo (para materiales oscuros). */
  invert: boolean
  /** Tallar en zig-zag en vez de volver en vacio. */
  bidirectional: boolean
  feedRate: number
  plungeRate: number
  /** Altura de seguridad para los desplazamientos rapidos (mm). */
  safeZ: number
  /** Paso de muestreo a lo largo del surco (mm). 0 = un pixel. */
  stepMm: number
}

export interface PhotoVCarveResult {
  /** Comentarios con los parametros del tallado. */
  header: string[]
  /** Los surcos en si. */
  body: string[]
  /** Distancia recorrida cortando, en mm. */
  distance: number
  /** Tiempo estimado de corte, en segundos. */
  time: number
  /** Surcos con material que tallar. */
  grooves: number
}

/** Separacion que deja los surcos justo tocandose a profundidad maxima. */
export function autoLineSpacing(angleDeg: number, maxDepth: number): number {
  const halfAngle = (Math.min(179, Math.max(1, angleDeg)) / 2) * (Math.PI / 180)
  return Math.max(0.05, 2 * maxDepth * Math.tan(halfAngle))
}

/**
 * Un tramo del surco: hasta donde llega y a que profundidad. Los tramos
 * consecutivos de igual profundidad se funden en uno, que es lo que evita que
 * el archivo tenga una linea por pixel.
 */
interface Cut {
  end: number
  depth: number
}

export function generatePhotoVCarve(
  pixels: ArrayLike<number>,
  opts: PhotoVCarveOptions,
): PhotoVCarveResult {
  const spacing = opts.lineSpacing > 0
    ? opts.lineSpacing
    : autoLineSpacing(opts.angleDeg, opts.maxDepth)
  const step = opts.stepMm > 0 ? opts.stepMm : opts.pixelMm

  const totalW = opts.width * opts.pixelMm
  const totalH = opts.height * opts.pixelMm
  // El surco corre a lo largo de `u` y las lineas se reparten a lo largo de `v`
  const alongMm = opts.direction === 'horizontal' ? totalW : totalH
  const acrossMm = opts.direction === 'horizontal' ? totalH : totalW

  const lineCount = Math.max(1, Math.floor(acrossMm / spacing) + 1)
  const sampleCount = Math.max(1, Math.floor(alongMm / step))

  const header: string[] = []
  const lines: string[] = []
  let distance = 0
  let grooves = 0

  header.push('; ====================================')
  header.push('; PHOTO V-CARVE')
  header.push(`; Image: ${opts.width}x${opts.height} px (${totalW.toFixed(1)}x${totalH.toFixed(1)} mm)`)
  header.push(`; V-bit: ${opts.angleDeg}deg, max depth ${opts.maxDepth.toFixed(2)}mm`)
  header.push(`; Groove width at max depth: ${autoLineSpacing(opts.angleDeg, opts.maxDepth).toFixed(3)}mm`)
  header.push(`; Line spacing: ${spacing.toFixed(3)}mm (${lineCount} grooves, ${opts.direction})`)
  header.push(`; Sampling: ${step.toFixed(3)}mm along the groove`)
  header.push(`; Tone: ${opts.invert ? 'light = deep' : 'dark = deep'}`)
  header.push('; ====================================')

  for (let i = 0; i < lineCount; i++) {
    const v = i * spacing
    const forward = !opts.bidirectional || i % 2 === 0

    // Profundidad de cada muestra, promediando la banda que cubre el surco:
    // tomar un solo pixel deja el tallado a merced del ruido de la foto
    const cuts: Cut[] = []
    let hasCut = false
    for (let s = 0; s < sampleCount; s++) {
      const u0 = s * step
      const gray = averageBand(pixels, opts, u0, u0 + step, v - spacing / 2, v + spacing / 2)
      const intensity = opts.invert ? gray / 255 : 1 - gray / 255
      let depth = opts.maxDepth * intensity
      if (depth < opts.minDepth) depth = 0
      if (depth > 0) hasCut = true

      const end = Math.min(alongMm, u0 + step)
      const last = cuts[cuts.length - 1]
      if (last && Math.abs(last.depth - depth) < 0.005) {
        last.end = end
      } else {
        cuts.push({ end, depth })
      }
    }

    if (!hasCut) continue
    grooves++

    lines.push('')
    lines.push(`; Groove ${grooves} @ ${v.toFixed(2)}mm`)
    const ordered = forward ? cuts : reverseCuts(cuts, alongMm)
    distance += emitGroove(lines, ordered, v, forward, alongMm, opts)
  }

  const time = opts.feedRate > 0 ? (distance / opts.feedRate) * 60 : 0
  return { header, body: lines, distance, time, grooves }
}

/**
 * Recorre el surco al reves. Los tramos guardan solo su final, asi que hay que
 * reconstruirlos desde el otro extremo para que el zig-zag talle lo mismo.
 */
function reverseCuts(cuts: Cut[], alongMm: number): Cut[] {
  const out: Cut[] = []
  for (let i = cuts.length - 1; i >= 0; i--) {
    const begin = i === 0 ? 0 : cuts[i - 1].end
    out.push({ end: begin, depth: cuts[i].depth })
  }
  return out
}

/** Escribe un surco y devuelve la distancia tallada. */
function emitGroove(
  lines: string[],
  cuts: Cut[],
  v: number,
  forward: boolean,
  alongMm: number,
  opts: PhotoVCarveOptions,
): number {
  const axisU = opts.direction === 'horizontal' ? 'X' : 'Y'
  const at = (u: number) =>
    opts.direction === 'horizontal'
      ? `X${u.toFixed(3)} Y${v.toFixed(3)}`
      : `X${v.toFixed(3)} Y${u.toFixed(3)}`

  let cursor = forward ? 0 : alongMm
  let cutting = false
  let distance = 0

  const liftAndTravel = (to: number) => {
    if (cutting) {
      lines.push(`G0 Z${opts.safeZ.toFixed(3)}`)
      cutting = false
    }
    lines.push(`G0 ${at(to)}`)
  }

  for (const cut of cuts) {
    const from = cursor
    const to = cut.end
    if (Math.abs(to - from) < 1e-6) continue

    if (cut.depth <= 0) {
      // Tramo sin material que sacar: se salta en rapido, no se arrastra la
      // punta por la superficie
      liftAndTravel(to)
      cursor = to
      continue
    }

    if (!cutting) {
      lines.push(`G0 ${at(from)}`)
      lines.push(`G1 Z${(-cut.depth).toFixed(3)} F${opts.plungeRate}`)
      cutting = true
    }
    lines.push(`G1 ${axisU}${to.toFixed(3)} Z${(-cut.depth).toFixed(3)} F${opts.feedRate}`)
    distance += Math.abs(to - from)
    cursor = to
  }

  if (cutting) lines.push(`G0 Z${opts.safeZ.toFixed(3)}`)
  return distance
}

/**
 * Gris promedio de la banda de imagen que cubre un tramo del surco. Los
 * limites vienen en mm sobre los ejes del surco (u a lo largo, v a lo ancho).
 */
function averageBand(
  pixels: ArrayLike<number>,
  opts: PhotoVCarveOptions,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
): number {
  const px = opts.pixelMm
  const horizontal = opts.direction === 'horizontal'

  // De ejes del surco a columnas/filas de la imagen. La fila 0 es la de arriba,
  // y el eje Y de la maquina crece hacia arriba: por eso se invierte
  const [x0, x1] = horizontal ? [u0, u1] : [v0, v1]
  const [y0, y1] = horizontal ? [v0, v1] : [u0, u1]

  const colFrom = clamp(Math.floor(x0 / px), 0, opts.width - 1)
  const colTo = clamp(Math.ceil(x1 / px) - 1, 0, opts.width - 1)
  const rowFrom = clamp(opts.height - 1 - Math.floor(y1 / px), 0, opts.height - 1)
  const rowTo = clamp(opts.height - 1 - Math.ceil(y0 / px), 0, opts.height - 1)

  let sum = 0
  let count = 0
  for (let row = Math.min(rowFrom, rowTo); row <= Math.max(rowFrom, rowTo); row++) {
    const base = row * opts.width
    for (let col = colFrom; col <= colTo; col++) {
      sum += pixels[base + col]
      count++
    }
  }

  // Fuera de la imagen no hay nada que tallar: blanco
  return count === 0 ? 255 : sum / count
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
