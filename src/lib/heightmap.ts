// ============================================
// Simulacion de remocion de material (heightmap)
// ============================================
//
// El bloque de material se representa como una grilla de alturas: una celda
// por cada cuadradito del plano XY, guardando hasta que Z quedo bajado. Barrer
// la herramienta por el recorrido es, para cada celda que toca, bajar esa
// altura a la del fondo de la fresa en ese punto.
//
// Es un modelo 2.5D: no representa socavados, que una fresadora de 3 ejes
// tampoco puede hacer. A cambio es barato — una resta y un minimo por celda —
// y permite ver la pieza terminada y lo que quedo sin cortar.

export type ToolShape = 'endmill' | 'ballnose' | 'vbit'

export interface HeightmapStock {
  x: number
  y: number
  width: number
  height: number
  thickness: number
  /** Donde esta el cero de pieza. */
  zeroAt: 'top' | 'bottom'
}

export interface SimTool {
  shape: ToolShape
  radius: number
  /** Angulo total del V-bit en grados (solo para 'vbit'). */
  angle: number
}

/**
 * Movimientos empaquetados: 7 floats por tramo
 * `[fromX, fromY, fromZ, toX, toY, toZ, corta]`.
 *
 * Van asi y no como objetos porque cruzan al worker en cada recalculo: clonar
 * quince mil objetos por mensaje cuesta mas que la simulacion misma.
 */
export type PackedMoves = Float32Array

export const MOVE_STRIDE = 7

export interface HeightmapResult {
  cols: number
  rows: number
  cellSize: number
  /** Esquina inferior izquierda de la grilla, en coordenadas de maquina. */
  originX: number
  originY: number
  /** Z de la cara superior del material. */
  topZ: number
  /** Z de la mesa. */
  bottomZ: number
  /** Altura resultante por celda, fila mayor. */
  heights: Float32Array
  /** Volumen removido en cm3. */
  removedVolume: number
  /** Fraccion de celdas que llegaron hasta la mesa (0..1). */
  cutThroughRatio: number
}

/** Lado de celda que mantiene la grilla en un tamano manejable. */
export function pickCellSize(width: number, height: number, maxCells = 420): number {
  const maxDim = Math.max(width, height, 1)
  return Math.max(0.15, maxDim / maxCells)
}

/**
 * Fondo de la herramienta a distancia `d` del eje, relativo a la punta.
 *
 * Devuelve `Infinity` fuera del radio: esa celda no la toca.
 */
function toolBottomOffset(tool: SimTool, d: number): number {
  if (d > tool.radius) return Infinity

  switch (tool.shape) {
    case 'ballnose': {
      // Casquete esferico: la punta es el polo sur de la esfera
      const r = tool.radius
      return r - Math.sqrt(Math.max(0, r * r - d * d))
    }
    case 'vbit': {
      // Cono: sube segun la tangente del semiangulo
      const half = Math.max(1, Math.min(179, tool.angle)) / 2
      const tan = Math.tan((half * Math.PI) / 180)
      return tan > 0 ? d / tan : 0
    }
    default:
      // Fresa plana: el fondo es plano dentro del radio
      return 0
  }
}

export interface SimulateInput {
  stock: HeightmapStock
  tool: SimTool
  moves: PackedMoves
  /** Simular solo los primeros N movimientos (para seguir la animacion). */
  upTo?: number
  cellSize?: number
  /**
   * Estado de partida para seguir tallando sobre lo ya simulado. Tallar es
   * monotono (solo baja material), asi que avanzar en la linea de tiempo no
   * obliga a rehacer todo desde el bloque entero.
   */
  initialHeights?: Float32Array
  /** Primer movimiento a tallar cuando se parte de `initialHeights`. */
  fromMove?: number
}

/**
 * Barre el recorrido sobre la grilla y devuelve el material que queda.
 *
 * Cada tramo se recorre en pasos de media celda para que no queden huecos
 * entre posiciones consecutivas de la herramienta.
 */
export function simulateRemoval(input: SimulateInput): HeightmapResult {
  const { stock, tool } = input
  const cellSize = input.cellSize ?? pickCellSize(stock.width, stock.height)

  const cols = Math.max(1, Math.ceil(stock.width / cellSize))
  const rows = Math.max(1, Math.ceil(stock.height / cellSize))

  const topZ = stock.zeroAt === 'top' ? 0 : stock.thickness
  const bottomZ = topZ - stock.thickness

  let heights: Float32Array
  if (input.initialHeights && input.initialHeights.length === cols * rows) {
    heights = input.initialHeights
  } else {
    heights = new Float32Array(cols * rows)
    heights.fill(topZ)
  }

  const moveCount = Math.floor(input.moves.length / MOVE_STRIDE)
  const limit = Math.min(input.upTo ?? moveCount, moveCount)
  const start = input.initialHeights ? Math.max(0, input.fromMove ?? 0) : 0
  const radius = Math.max(0.01, tool.radius)
  const radiusSq = radius * radius
  // La fresa plana tiene el fondo a la misma altura en todo el radio: se evita
  // una raiz cuadrada por celda, que en millones de celdas se nota.
  const isFlat = tool.shape === 'endmill'

  for (let m = start; m < limit; m++) {
    const o = m * MOVE_STRIDE
    if (input.moves[o + 6] === 0) continue

    const fx = input.moves[o]
    const fy = input.moves[o + 1]
    const fz = input.moves[o + 2]
    const tx = input.moves[o + 3]
    const ty = input.moves[o + 4]
    const tz = input.moves[o + 5]

    // Nada que sacar si todo el tramo va por encima del material
    if (fz >= topZ && tz >= topZ) continue

    const dx = tx - fx
    const dy = ty - fy
    const dz = tz - fz
    const lenSq = dx * dx + dy * dy

    // Se rasteriza la capsula que barre la herramienta: para cada celda de su
    // bounding box se mide la distancia al segmento. Estampar un disco cada
    // media celda daria lo mismo pero visitando dos ordenes de magnitud mas
    // de celdas, casi todas repetidas.
    const minX = Math.min(fx, tx) - radius
    const maxX = Math.max(fx, tx) + radius
    const minY = Math.min(fy, ty) - radius
    const maxY = Math.max(fy, ty) + radius

    const c0 = Math.max(0, Math.floor((minX - stock.x) / cellSize))
    const c1 = Math.min(cols - 1, Math.floor((maxX - stock.x) / cellSize))
    const r0 = Math.max(0, Math.floor((minY - stock.y) / cellSize))
    const r1 = Math.min(rows - 1, Math.floor((maxY - stock.y) / cellSize))
    if (c1 < c0 || r1 < r0) continue

    for (let r = r0; r <= r1; r++) {
      const cy = stock.y + (r + 0.5) * cellSize
      const rowBase = r * cols

      for (let c = c0; c <= c1; c++) {
        const cx = stock.x + (c + 0.5) * cellSize

        // Proyeccion de la celda sobre el segmento, acotada a sus extremos
        let t = 0
        if (lenSq > 1e-12) {
          t = ((cx - fx) * dx + (cy - fy) * dy) / lenSq
          t = t < 0 ? 0 : t > 1 ? 1 : t
        }
        const px = fx + dx * t
        const py = fy + dy * t
        const ddx = cx - px
        const ddy = cy - py
        const dSq = ddx * ddx + ddy * ddy
        if (dSq > radiusSq) continue

        const tipZ = fz + dz * t
        if (tipZ >= topZ) continue

        const offset = isFlat ? 0 : toolBottomOffset(tool, Math.sqrt(dSq))
        if (!Number.isFinite(offset)) continue

        const z = tipZ + offset
        const idx = rowBase + c
        if (z < heights[idx]) {
          // La fresa no atraviesa la mesa por mas que el G-code lo pida
          heights[idx] = z < bottomZ ? bottomZ : z
        }
      }
    }
  }

  // Volumen removido: la diferencia contra el bloque entero
  let removedMm3 = 0
  let through = 0
  const cellArea = cellSize * cellSize
  for (let i = 0; i < heights.length; i++) {
    removedMm3 += (topZ - heights[i]) * cellArea
    if (heights[i] <= bottomZ + 1e-6) through++
  }

  return {
    cols,
    rows,
    cellSize,
    originX: stock.x,
    originY: stock.y,
    topZ,
    bottomZ,
    heights,
    removedVolume: removedMm3 / 1000,
    cutThroughRatio: heights.length > 0 ? through / heights.length : 0,
  }
}

/**
 * Convierte los segmentos parseados del G-code en movimientos de simulacion.
 *
 * Un rapido no corta aunque baje: si el G-code hunde la fresa en G0 es un
 * error del post, no material removido a proposito.
 */
export function movesFromSegments(
  segments: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; type: string }[],
): PackedMoves {
  const packed = new Float32Array(segments.length * MOVE_STRIDE)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const o = i * MOVE_STRIDE
    packed[o] = seg.from.x
    packed[o + 1] = seg.from.y
    packed[o + 2] = seg.from.z
    packed[o + 3] = seg.to.x
    packed[o + 4] = seg.to.y
    packed[o + 5] = seg.to.z
    packed[o + 6] = seg.type !== 'rapid' ? 1 : 0
  }
  return packed
}

// ============================================
// Malla para el visor
// ============================================

export interface HeightmapMesh {
  /** Posiciones en coordenadas de Three (X maquina, Y altura, Z = -Y maquina). */
  positions: Float32Array
  indices: Uint32Array
}

/**
 * Arma la malla del bloque ya mecanizado: la superficie de arriba con las
 * alturas de la grilla, las cuatro paredes hasta la mesa y el fondo.
 *
 * Los vertices van en las esquinas de celda y toman la altura MAYOR de las
 * celdas que tocan. Con el minimo, el borde de un cajeado se comeria media
 * celda de pared y las paredes saldrian biseladas.
 */
export function buildHeightmapMesh(result: HeightmapResult): HeightmapMesh {
  const { cols, rows, cellSize, originX, originY, heights, bottomZ } = result

  const vx = cols + 1
  const vy = rows + 1

  const at = (c: number, r: number): number => {
    const cc = Math.min(cols - 1, Math.max(0, c))
    const rr = Math.min(rows - 1, Math.max(0, r))
    return heights[rr * cols + cc]
  }

  const cornerHeight = (i: number, j: number): number =>
    Math.max(at(i - 1, j - 1), at(i, j - 1), at(i - 1, j), at(i, j))

  // Superficie + fondo + 4 paredes
  const topCount = vx * vy
  const positions = new Float32Array((topCount + 4 + vx * 2 + vy * 2) * 3)
  const indices: number[] = []

  let p = 0
  for (let j = 0; j < vy; j++) {
    for (let i = 0; i < vx; i++) {
      positions[p++] = originX + i * cellSize
      positions[p++] = cornerHeight(i, j)
      // La Y de maquina va al -Z de Three
      positions[p++] = -(originY + j * cellSize)
    }
  }

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * vx + i
      const b = a + 1
      const c = a + vx
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  // Fondo: cuatro esquinas a la altura de la mesa
  const bottomStart = topCount
  const x0 = originX
  const x1 = originX + cols * cellSize
  const z0 = -originY
  const z1 = -(originY + rows * cellSize)
  const bottomCorners: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
  for (const [bx, bz] of bottomCorners) {
    positions[p++] = bx
    positions[p++] = bottomZ
    positions[p++] = bz
  }
  indices.push(bottomStart, bottomStart + 1, bottomStart + 2)
  indices.push(bottomStart, bottomStart + 2, bottomStart + 3)

  // Paredes: por cada borde de la superficie, un quad hasta la mesa
  let skirt = bottomStart + 4
  const addSkirt = (
    count: number,
    topIndex: (k: number) => number,
    pos: (k: number) => [number, number],
  ) => {
    const base = skirt
    for (let k = 0; k < count; k++) {
      const [sx, sz] = pos(k)
      positions[p++] = sx
      positions[p++] = bottomZ
      positions[p++] = sz
    }
    skirt += count
    for (let k = 0; k < count - 1; k++) {
      const t0 = topIndex(k)
      const t1 = topIndex(k + 1)
      indices.push(t0, base + k, t1, t1, base + k, base + k + 1)
    }
  }

  // Borde Y = originY (j = 0) y el opuesto
  addSkirt(vx, (i) => i, (i) => [originX + i * cellSize, z0])
  addSkirt(vx, (i) => (vy - 1) * vx + i, (i) => [originX + i * cellSize, z1])
  // Bordes en X
  addSkirt(vy, (j) => j * vx, (j) => [x0, -(originY + j * cellSize)])
  addSkirt(vy, (j) => j * vx + (vx - 1), (j) => [x1, -(originY + j * cellSize)])

  return { positions, indices: new Uint32Array(indices) }
}
