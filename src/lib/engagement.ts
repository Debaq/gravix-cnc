// ============================================
// Campo de material y medicion de engagement
// ============================================
//
// El desbaste adaptativo no se genera offseteando contornos: se marcha paso a
// paso preguntando "si muevo la fresa aca, cuanto material agarra". Para poder
// preguntarlo hay que llevar la cuenta de lo que queda sin cortar.
//
// El modelo es una grilla booleana de una sola capa Z: cada celda esta llena o
// vacia. Arranca con la region a vaciar y cada tramo de recorrido le resta la
// capsula que barre la fresa, igual que `heightmap.ts` pero sin alturas — a una
// profundidad fija el material es plano y guardar Z por celda no aporta nada.
//
// El engagement se mide muestreando el circulo de corte: la fraccion de la
// circunferencia que cae sobre material lleno es el arco de contacto. Eso es
// exactamente el angulo de engagement del que hablan las tablas de corte.
//
//   angulo chico  ─→  ███░░░░░   la fresa roza el borde
//   ranurado      ─→  ████████   agarra por los dos lados, 180°
//
// No depende de Clipper ni del DOM: corre tal cual dentro de un worker.

import type { Point2D } from './types'

// ============================================
// GRILLA DE MATERIAL
// ============================================

export interface MaterialFieldInit {
  /**
   * Contornos cerrados que delimitan material. Se rellenan con regla
   * par-impar, asi que un anillo adentro de otro queda como isla (hueco) sin
   * importar su orientacion.
   */
  rings: Point2D[][]
  /**
   * Lado de celda en mm. Conviene <= radio/6: el error angular de la medicion
   * es del orden de `cellSize / radio`.
   */
  cellSize?: number
  /** Margen alrededor del bounding box, en mm. */
  margin?: number
}

/** Celdas maximas de la grilla; por encima se agranda la celda. */
const MAX_CELLS = 4_000_000

/**
 * Lado de celda para una fresa dada, acotado para que la grilla no explote en
 * piezas grandes.
 */
export function pickFieldCellSize(width: number, height: number, toolRadius: number): number {
  const wanted = Math.max(0.02, toolRadius / 8)
  const cells = (width / wanted) * (height / wanted)
  if (cells <= MAX_CELLS) return wanted
  return Math.sqrt((width * height) / MAX_CELLS)
}

export interface MaterialRegion {
  /** Celdas llenas de la region. */
  cellCount: number
  /** Area en mm2. */
  area: number
  /** Punto interior mas alejado del aire: sirve de arranque. */
  seed: Point2D
  /** Radio del circulo inscrito en `seed`, en mm. */
  seedRadius: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Material restante en una capa, como grilla de celdas llenas/vacias.
 *
 * Sirve tambien de mascara de zona permitida: el generador arma un segundo
 * campo con la region donde el centro de la fresa puede pararse y consulta
 * `isSolid` antes de aceptar un paso.
 */
export class MaterialField {
  readonly cols: number
  readonly rows: number
  readonly cellSize: number
  /** Esquina inferior izquierda de la grilla, en coordenadas de pieza. */
  readonly originX: number
  readonly originY: number
  /** 1 = material, 0 = aire. Fila mayor. */
  readonly cells: Uint8Array

  private solidCells: number

  private constructor(
    cols: number, rows: number, cellSize: number,
    originX: number, originY: number, cells: Uint8Array, solidCells: number,
  ) {
    this.cols = cols
    this.rows = rows
    this.cellSize = cellSize
    this.originX = originX
    this.originY = originY
    this.cells = cells
    this.solidCells = solidCells
  }

  static fromRings(init: MaterialFieldInit): MaterialField {
    const rings = init.rings.filter((r) => r.length >= 3)
    if (rings.length === 0) {
      return new MaterialField(1, 1, 1, 0, 0, new Uint8Array(1), 0)
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const ring of rings) {
      for (const p of ring) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
    }

    const margin = init.margin ?? 0
    minX -= margin; minY -= margin; maxX += margin; maxY += margin

    const width = Math.max(1e-6, maxX - minX)
    const height = Math.max(1e-6, maxY - minY)
    const cellSize = init.cellSize ?? pickFieldCellSize(width, height, Math.max(width, height) / 40)

    const cols = Math.max(1, Math.ceil(width / cellSize))
    const rows = Math.max(1, Math.ceil(height / cellSize))

    const field = new MaterialField(cols, rows, cellSize, minX, minY, new Uint8Array(cols * rows), 0)
    field.fillRings(rings, 1)
    return field
  }

  /** Copia independiente, para probar una variante sin perder el estado. */
  clone(): MaterialField {
    return new MaterialField(
      this.cols, this.rows, this.cellSize,
      this.originX, this.originY,
      new Uint8Array(this.cells), this.solidCells,
    )
  }

  /** Deja este campo igual a `other` (misma grilla). Evita reasignar memoria. */
  copyFrom(other: MaterialField): void {
    this.cells.set(other.cells)
    this.solidCells = other.solidCells
  }

  /**
   * Material que queda en los dos campos. Cruzar el material con la zona
   * permitida da el material "trabajable": aquel sobre el que la fresa puede
   * pararse. Lo que queda afuera es la franja contra la pared, que es de la
   * pasada de acabado y no del desbaste.
   */
  intersect(other: MaterialField): MaterialField {
    const cells = new Uint8Array(this.cells.length)
    let solid = 0
    const n = Math.min(this.cells.length, other.cells.length)
    for (let i = 0; i < n; i++) {
      if (this.cells[i] === 1 && other.cells[i] === 1) { cells[i] = 1; solid++ }
    }
    return new MaterialField(
      this.cols, this.rows, this.cellSize, this.originX, this.originY, cells, solid,
    )
  }

  /** Quita material dentro de los contornos: lo que ya vacio otra operacion. */
  cutRings(rings: Point2D[][]): void {
    this.fillRings(rings.filter((r) => r.length >= 3), 0)
  }

  colAt(x: number): number {
    return Math.floor((x - this.originX) / this.cellSize)
  }

  rowAt(y: number): number {
    return Math.floor((y - this.originY) / this.cellSize)
  }

  cellCenterX(col: number): number {
    return this.originX + (col + 0.5) * this.cellSize
  }

  cellCenterY(row: number): number {
    return this.originY + (row + 0.5) * this.cellSize
  }

  /** Fuera de la grilla cuenta como aire. */
  isSolid(x: number, y: number): boolean {
    const c = this.colAt(x)
    if (c < 0 || c >= this.cols) return false
    const r = this.rowAt(y)
    if (r < 0 || r >= this.rows) return false
    return this.cells[r * this.cols + c] === 1
  }

  isSolidCell(col: number, row: number): boolean {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false
    return this.cells[row * this.cols + col] === 1
  }

  /** Area de material que queda, en mm2. */
  solidArea(): number {
    return this.solidCells * this.cellSize * this.cellSize
  }

  solidCellCount(): number {
    return this.solidCells
  }

  /**
   * Resta el disco de la fresa. Devuelve el area removida en mm2, que es la
   * viruta real del paso: el marchador la usa para repartir el avance.
   */
  cutDisc(cx: number, cy: number, radius: number): number {
    return this.cutCapsule(cx, cy, cx, cy, radius)
  }

  /** Resta la capsula que barre la fresa al ir de un punto al otro. */
  cutSweep(from: Point2D, to: Point2D, radius: number): number {
    return this.cutCapsule(from.x, from.y, to.x, to.y, radius)
  }

  private cutCapsule(fx: number, fy: number, tx: number, ty: number, radius: number): number {
    const r = Math.max(this.cellSize * 0.5, radius)
    const rSq = r * r

    const c0 = Math.max(0, this.colAt(Math.min(fx, tx) - r))
    const c1 = Math.min(this.cols - 1, this.colAt(Math.max(fx, tx) + r))
    const r0 = Math.max(0, this.rowAt(Math.min(fy, ty) - r))
    const r1 = Math.min(this.rows - 1, this.rowAt(Math.max(fy, ty) + r))
    if (c1 < c0 || r1 < r0) return 0

    const dx = tx - fx
    const dy = ty - fy
    const lenSq = dx * dx + dy * dy

    let removed = 0
    for (let row = r0; row <= r1; row++) {
      const cy = this.cellCenterY(row)
      const base = row * this.cols

      for (let col = c0; col <= c1; col++) {
        const idx = base + col
        if (this.cells[idx] === 0) continue

        const cx = this.cellCenterX(col)

        // Proyeccion de la celda sobre el segmento, acotada a sus extremos
        let t = 0
        if (lenSq > 1e-12) {
          t = ((cx - fx) * dx + (cy - fy) * dy) / lenSq
          t = t < 0 ? 0 : t > 1 ? 1 : t
        }
        const ddx = cx - (fx + dx * t)
        const ddy = cy - (fy + dy * t)
        if (ddx * ddx + ddy * ddy > rSq) continue

        this.cells[idx] = 0
        removed++
      }
    }

    this.solidCells -= removed
    return removed * this.cellSize * this.cellSize
  }

  /**
   * Distancia de cada celda llena al aire mas cercano, en mm (0 en el aire).
   *
   * Sirve para erosionar el bolsillo y para elegir donde entrar en helice.
   */
  distanceField(): Float32Array {
    return chamferDistance(this.cells, this.cols, this.rows, this.cellSize, true)
  }

  /**
   * La inversa: distancia de cada celda vacia al material mas cercano, en mm
   * (0 sobre el material).
   *
   * Con ella se ubica el centro de la fresa a la distancia exacta de la pared
   * que da un ancho radial de corte: es como se busca por donde reenganchar
   * una pasada nueva sin tener que medir el engagement en todo el bolsillo.
   */
  distanceToSolid(): Float32Array {
    return chamferDistance(this.cells, this.cols, this.rows, this.cellSize, false)
  }

  /**
   * Circulo inscrito mas grande que queda. Es donde conviene bajar en helice:
   * es el punto con mas aire alrededor para maniobrar.
   */
  largestInscribedCircle(distances?: Float32Array): { center: Point2D; radius: number } | null {
    const d = distances ?? this.distanceField()
    let bestIdx = -1
    let bestDist = 0
    for (let i = 0; i < d.length; i++) {
      if (d[i] > bestDist) { bestDist = d[i]; bestIdx = i }
    }
    if (bestIdx < 0) return null
    const row = Math.floor(bestIdx / this.cols)
    const col = bestIdx - row * this.cols
    return {
      center: { x: this.cellCenterX(col), y: this.cellCenterY(row) },
      radius: bestDist,
    }
  }

  /**
   * Copia con el material contraido `distance` mm: quedan solo las celdas que
   * estan al menos a esa distancia del aire.
   *
   * Erosionar la region a vaciar por el radio de la fresa da la zona donde el
   * centro puede pararse sin comerse la pared, islas incluidas, y sin pasar
   * por Clipper. El chamfer aproxima la euclidiana con ~2% de error, asi que
   * la pared queda con esa tolerancia: para el desbaste sobra, el acabado va
   * por contorno aparte.
   */
  erode(distance: number, distances?: Float32Array): MaterialField {
    const d = distances ?? this.distanceField()
    const cells = new Uint8Array(d.length)
    let solid = 0
    for (let i = 0; i < d.length; i++) {
      if (d[i] >= distance) { cells[i] = 1; solid++ }
    }
    return new MaterialField(
      this.cols, this.rows, this.cellSize, this.originX, this.originY, cells, solid,
    )
  }

  /**
   * Islas de material conexas. Al avanzar el desbaste una region se parte en
   * dos y hay que terminar una antes de saltar a la otra; esto las separa.
   *
   * `minArea` descarta las pelusas de una o dos celdas que deja el rasterizado.
   */
  regions(minArea = 0): MaterialRegion[] {
    const { cols, rows, cells, cellSize } = this
    const seen = new Uint8Array(cells.length)
    const distances = this.distanceField()
    const cellArea = cellSize * cellSize
    const out: MaterialRegion[] = []
    const stack: number[] = []

    for (let start = 0; start < cells.length; start++) {
      if (cells[start] === 0 || seen[start] === 1) continue

      seen[start] = 1
      stack.push(start)

      let count = 0
      let bestDist = -1
      let bestIdx = start
      let minCol = cols, maxCol = -1, minRow = rows, maxRow = -1

      while (stack.length > 0) {
        const idx = stack.pop()!
        const row = Math.floor(idx / cols)
        const col = idx - row * cols

        count++
        if (distances[idx] > bestDist) { bestDist = distances[idx]; bestIdx = idx }
        if (col < minCol) minCol = col
        if (col > maxCol) maxCol = col
        if (row < minRow) minRow = row
        if (row > maxRow) maxRow = row

        // 4-conexo: dos celdas que solo se tocan en una esquina no dejan pasar
        // la fresa, tratarlas como una sola region seria mentira
        if (col > 0) { const n = idx - 1; if (cells[n] === 1 && seen[n] === 0) { seen[n] = 1; stack.push(n) } }
        if (col < cols - 1) { const n = idx + 1; if (cells[n] === 1 && seen[n] === 0) { seen[n] = 1; stack.push(n) } }
        if (row > 0) { const n = idx - cols; if (cells[n] === 1 && seen[n] === 0) { seen[n] = 1; stack.push(n) } }
        if (row < rows - 1) { const n = idx + cols; if (cells[n] === 1 && seen[n] === 0) { seen[n] = 1; stack.push(n) } }
      }

      const area = count * cellArea
      if (area < minArea) continue

      const seedRow = Math.floor(bestIdx / cols)
      const seedCol = bestIdx - seedRow * cols
      out.push({
        cellCount: count,
        area,
        seed: { x: this.cellCenterX(seedCol), y: this.cellCenterY(seedRow) },
        seedRadius: Math.max(0, bestDist),
        minX: this.originX + minCol * cellSize,
        minY: this.originY + minRow * cellSize,
        maxX: this.originX + (maxCol + 1) * cellSize,
        maxY: this.originY + (maxRow + 1) * cellSize,
      })
    }

    return out.sort((a, b) => b.area - a.area)
  }

  /** Relleno par-impar por scanline. `value` 1 pinta material, 0 lo saca. */
  private fillRings(rings: Point2D[][], value: 0 | 1): void {
    if (rings.length === 0) return
    const xs: number[] = []

    for (let row = 0; row < this.rows; row++) {
      const y = this.cellCenterY(row)
      xs.length = 0

      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]
          const b = ring[(i + 1) % ring.length]
          // Regla semiabierta [y0, y1): un vertice justo en la linea cruza una
          // sola vez y el relleno no se derrama
          if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
            xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
          }
        }
      }

      if (xs.length < 2) continue
      xs.sort((p, q) => p - q)

      const base = row * this.cols
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.max(0, Math.ceil((xs[i] - this.originX) / this.cellSize - 0.5))
        const c1 = Math.min(this.cols - 1, Math.floor((xs[i + 1] - this.originX) / this.cellSize - 0.5))
        if (c1 < c0) continue
        for (let col = c0; col <= c1; col++) {
          const idx = base + col
          if (this.cells[idx] === value) continue
          this.cells[idx] = value
          this.solidCells += value === 1 ? 1 : -1
        }
      }
    }
  }
}

/**
 * Transformada de distancia por chamfer de dos pasadas.
 *
 * `toAir` elige contra que se mide: hacia el aire (semilla en las celdas
 * vacias) o hacia el material. Aproxima la euclidiana con ~2% de error a
 * cambio de dos barridos lineales, que es lo que la hace usable en cada
 * pasada del desbaste.
 *
 * Cuando se mide hacia el aire, el borde de la grilla cuenta como aire: si no,
 * una pieza que toca el borde daria distancias infinitas y la erosion dejaria
 * a la fresa salirse del material.
 */
function chamferDistance(
  cells: Uint8Array, cols: number, rows: number, cellSize: number, toAir: boolean,
): Float32Array {
  const d = new Float32Array(cells.length)
  const ORTHO = cellSize
  const DIAG = cellSize * Math.SQRT2
  const FAR = Number.MAX_VALUE
  const seed = toAir ? 0 : 1

  for (let i = 0; i < d.length; i++) d[i] = cells[i] === seed ? 0 : FAR

  // Barrido hacia adelante: vecinos de arriba-izquierda
  for (let row = 0; row < rows; row++) {
    const base = row * cols
    for (let col = 0; col < cols; col++) {
      const idx = base + col
      if (d[idx] === 0) continue
      let best = d[idx]
      if (col > 0) best = Math.min(best, d[idx - 1] + ORTHO)
      if (row > 0) {
        best = Math.min(best, d[idx - cols] + ORTHO)
        if (col > 0) best = Math.min(best, d[idx - cols - 1] + DIAG)
        if (col < cols - 1) best = Math.min(best, d[idx - cols + 1] + DIAG)
      }
      if (toAir && (col === 0 || col === cols - 1 || row === 0 || row === rows - 1)) {
        best = Math.min(best, cellSize * 0.5)
      }
      d[idx] = best
    }
  }

  // Barrido hacia atras: vecinos de abajo-derecha
  for (let row = rows - 1; row >= 0; row--) {
    const base = row * cols
    for (let col = cols - 1; col >= 0; col--) {
      const idx = base + col
      if (d[idx] === 0) continue
      let best = d[idx]
      if (col < cols - 1) best = Math.min(best, d[idx + 1] + ORTHO)
      if (row < rows - 1) {
        best = Math.min(best, d[idx + cols] + ORTHO)
        if (col < cols - 1) best = Math.min(best, d[idx + cols + 1] + DIAG)
        if (col > 0) best = Math.min(best, d[idx + cols - 1] + DIAG)
      }
      d[idx] = best
    }
  }

  return d
}

// ============================================
// MEDICION DE ENGAGEMENT
// ============================================

export interface EngagementProbe {
  /** Radio del filo, en mm. */
  radius: number
  /** Muestras alrededor del circulo. */
  samples: number
  /** Desplazamientos precalculados de cada muestra, en mm. */
  offsetsX: Float32Array
  offsetsY: Float32Array
  /** Angulo de cada muestra, en radianes. */
  angles: Float32Array
  /** Buffer de trabajo reusado entre mediciones. */
  hits: Uint8Array
}

/**
 * Arma el muestreador del circulo de corte.
 *
 * El anillo se muestrea medio celda adentro del radio: justo en el borde la
 * mitad de las muestras caeria en el aire de afuera y el angulo saldria corto.
 *
 * `samples` fija la resolucion angular (360/samples grados). 72 da 5°, que es
 * mas fino que la tolerancia con la que se elige un stepover.
 */
export function createEngagementProbe(radius: number, cellSize: number, samples = 72): EngagementProbe {
  const n = Math.max(8, Math.floor(samples))
  const probeRadius = Math.max(radius * 0.5, radius - cellSize * 0.5)
  const offsetsX = new Float32Array(n)
  const offsetsY = new Float32Array(n)
  const angles = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    angles[i] = a
    offsetsX[i] = Math.cos(a) * probeRadius
    offsetsY[i] = Math.sin(a) * probeRadius
  }

  return { radius, samples: n, offsetsX, offsetsY, angles, hits: new Uint8Array(n) }
}

export interface EngagementSample {
  /** Arco total en contacto, en radianes (0..2π). Es la carga de la fresa. */
  angle: number
  /** `angle` en grados, para mostrar. */
  degrees: number
  /** Fraccion del circulo en contacto (0..1). */
  fraction: number
  /** Arco contiguo mas largo, en radianes. */
  arcAngle: number
  /**
   * Direccion hacia el centro del arco contiguo mas largo, en radianes.
   * Es hacia donde empuja el material; `NaN` si no toca nada.
   */
  bisector: number
  /**
   * `true` cuando el contacto viene en dos o mas tramos separados: la fresa
   * agarra por los dos lados. Pasa en rincones y en los cuellos que deja el
   * desbaste, y es donde se pega el tiron aunque el angulo total no asuste.
   */
  split: boolean
  /** Ancho radial de corte equivalente, en mm. */
  radialWidth: number
}

const EMPTY_SAMPLE: EngagementSample = {
  angle: 0, degrees: 0, fraction: 0, arcAngle: 0,
  bisector: NaN, split: false, radialWidth: 0,
}

/**
 * Mide el arco de contacto de la fresa parada en (cx, cy).
 *
 * No modifica el campo: es la pregunta que el marchador hace muchas veces por
 * paso mientras busca la curvatura que mantiene la carga.
 *
 * `swept` son posiciones que la fresa va a ocupar antes de llegar aca y que
 * todavia no estan descontadas del campo. Sin eso, mirar dos o tres pasos
 * adelante da siempre de mas — cuenta como material justo lo que esos pasos
 * van a sacar — y el marchador termina esquivando su propia viruta.
 */
export function measureEngagement(
  field: MaterialField,
  probe: EngagementProbe,
  cx: number,
  cy: number,
  swept?: readonly Point2D[],
): EngagementSample {
  const { samples, offsetsX, offsetsY, hits } = probe
  const sweptRadiusSq = probe.radius * probe.radius

  let count = 0
  for (let i = 0; i < samples; i++) {
    const x = cx + offsetsX[i]
    const y = cy + offsetsY[i]
    let hit = field.isSolid(x, y) ? 1 : 0

    if (hit === 1 && swept) {
      for (let k = 0; k < swept.length; k++) {
        const dx = x - swept[k].x
        const dy = y - swept[k].y
        if (dx * dx + dy * dy <= sweptRadiusSq) { hit = 0; break }
      }
    }

    hits[i] = hit
    count += hit
  }

  if (count === 0) return EMPTY_SAMPLE

  const full = Math.PI * 2
  const angle = (count / samples) * full

  if (count === samples) {
    // Rodeada de material: ranurado
    return {
      angle: full,
      degrees: 360,
      fraction: 1,
      arcAngle: full,
      bisector: NaN,
      split: false,
      radialWidth: probe.radius * 2,
    }
  }

  // Arco contiguo mas largo sobre el circulo, arrancando desde un hueco para
  // que la busqueda no corte en dos una racha que da la vuelta por el indice 0
  let gap = 0
  while (hits[gap] === 1) gap++

  let bestLen = 0
  let bestStart = 0
  let runLen = 0
  let runStart = 0
  let runs = 0

  for (let k = 0; k < samples; k++) {
    const i = (gap + k) % samples
    if (hits[i] === 1) {
      if (runLen === 0) { runStart = i; runs++ }
      runLen++
      if (runLen > bestLen) { bestLen = runLen; bestStart = runStart }
    } else {
      runLen = 0
    }
  }

  const arcAngle = (bestLen / samples) * full
  const bisector = normalizeAngle(
    ((bestStart + (bestLen - 1) / 2) / samples) * full,
  )

  return {
    angle,
    degrees: (angle * 180) / Math.PI,
    fraction: count / samples,
    arcAngle,
    bisector,
    split: runs > 1,
    radialWidth: radialWidthFromAngle(angle, probe.radius),
  }
}

export interface SweepEngagement {
  /**
   * Peor engagement del tramo sin contar el arranque. El arranque se saltea a
   * proposito: es la posicion actual de la fresa, igual para todos los pasos
   * que se estan comparando, y si entra en la cuenta tapa las diferencias
   * entre ellos.
   */
  peak: EngagementSample
  /** Engagement al terminar el tramo: es el que dice para donde sigue la cosa. */
  end: EngagementSample
  /** Promedio del arco de contacto, en radianes. */
  meanAngle: number
  /** Posicion donde se dio el pico. */
  peakAt: Point2D
}

/**
 * Mide el engagement a lo largo de un tramo, no solo en la punta.
 *
 * Medir solo el destino deja pasar el caso que rompe fresas: el paso arranca y
 * termina rozando pero en el medio atraviesa un cuello de material.
 */
export function measureSweepEngagement(
  field: MaterialField,
  probe: EngagementProbe,
  from: Point2D,
  to: Point2D,
  stepMm?: number,
): SweepEngagement {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const step = Math.max(field.cellSize, stepMm ?? field.cellSize * 2)
  const steps = Math.max(1, Math.ceil(length / step))

  let peak = EMPTY_SAMPLE
  let peakAt: Point2D = to
  let end = EMPTY_SAMPLE
  let total = 0

  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = from.x + dx * t
    const y = from.y + dy * t
    const s = measureEngagement(field, probe, x, y)
    total += s.angle
    if (s.angle > peak.angle) { peak = s; peakAt = { x, y } }
    if (i === steps) end = s
  }

  return { peak, end, meanAngle: total / steps, peakAt }
}

// ============================================
// CONVERSIONES DE CARGA
// ============================================

/**
 * Ancho radial de corte que corresponde a un arco de contacto.
 *
 *   ae = r · (1 − cos(θ/2))
 *
 * El arco va a los dos lados de la direccion que entra al material, asi que el
 * semiangulo es el que manda: 180° de contacto es medio diametro de corte y
 * 360° es el diametro entero, o sea ranurado.
 */
export function radialWidthFromAngle(angle: number, radius: number): number {
  const clamped = Math.max(0, Math.min(Math.PI * 2, angle))
  return radius * (1 - Math.cos(clamped / 2))
}

/** La inversa: arco de contacto para un ancho radial dado. */
export function angleFromRadialWidth(radialWidth: number, radius: number): number {
  if (radius <= 0) return 0
  const ratio = 1 - radialWidth / radius
  return 2 * Math.acos(Math.max(-1, Math.min(1, ratio)))
}

/**
 * Factor de adelgazamiento de viruta radial.
 *
 *   CTF = D / (2·√(D·ae − ae²))
 *
 * Con stepover chico la viruta sale mas fina que el avance por diente nominal:
 * hay que subir el avance por este factor o la fresa frota en vez de cortar y
 * se recalienta. A 50% del diametro da 1 (no hay correccion), a 10% da 1.67.
 *
 * Se acota arriba porque el factor se dispara al acercarse a cero y ningun
 * taller manda una fresa de 6 mm al triple del avance de tabla.
 */
export function chipThinningFactor(radialWidth: number, diameter: number, maxFactor = 2.5): number {
  if (diameter <= 0 || radialWidth <= 0) return 1
  const ae = Math.min(radialWidth, diameter)
  const denom = 2 * Math.sqrt(Math.max(1e-9, diameter * ae - ae * ae))
  const factor = diameter / denom
  if (!Number.isFinite(factor) || factor < 1) return 1
  return Math.min(maxFactor, factor)
}

/** Lleva un angulo al rango [0, 2π). */
export function normalizeAngle(angle: number): number {
  const full = Math.PI * 2
  const a = angle % full
  return a < 0 ? a + full : a
}
