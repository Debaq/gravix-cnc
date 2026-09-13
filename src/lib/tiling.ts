import type { GCodePath, Point2D } from './types'

export interface TilingConfig {
  tileWidth: number      // mm
  tileHeight: number     // mm
  overlap: number        // mm overlap between tiles
  margin: number         // mm margin around design
  /** Grilla fija precalculada. Necesaria para tilear varios jobs con
   *  orígenes distintos contra la MISMA grilla (si no, cada job calcula
   *  su propio bbox y las piezas no encajan entre sí). */
  grid?: TileGrid
}

export interface TileGrid {
  startX: number
  startY: number
  rows: number
  cols: number
}

export interface Tile {
  row: number
  col: number
  x: number              // tile origin X
  y: number              // tile origin Y
  width: number
  height: number
  paths: GCodePath[]     // paths clipped to this tile
}

/**
 * Compute bounding box of all paths.
 */
function pathsBBox(paths: GCodePath[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const path of paths) {
    for (const pt of path.points) {
      if (pt.x < minX) minX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.x > maxX) maxX = pt.x
      if (pt.y > maxY) maxY = pt.y
    }
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Calcula la grilla de tiles que cubre todos los paths dados.
 * Se calcula una sola vez y se reutiliza para cada job, de modo que
 * todos los jobs se corten contra los mismos límites.
 */
export function computeTileGrid(paths: GCodePath[], config: TilingConfig): TileGrid {
  const bbox = pathsBBox(paths)
  if (!isFinite(bbox.minX)) {
    return { startX: 0, startY: 0, rows: 1, cols: 1 }
  }

  const totalW = bbox.maxX - bbox.minX + config.margin * 2
  const totalH = bbox.maxY - bbox.minY + config.margin * 2
  const effectiveW = Math.max(0.001, config.tileWidth - config.overlap)
  const effectiveH = Math.max(0.001, config.tileHeight - config.overlap)

  return {
    startX: bbox.minX - config.margin,
    startY: bbox.minY - config.margin,
    cols: Math.max(1, Math.ceil(totalW / effectiveW)),
    rows: Math.max(1, Math.ceil(totalH / effectiveH)),
  }
}

/**
 * Check if a point is inside a rectangular region (with margin).
 */
function pointInRect(pt: Point2D, x: number, y: number, w: number, h: number): boolean {
  return pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h
}

/**
 * Recorta un segmento contra un rectángulo (Liang-Barsky).
 * Devuelve el tramo visible o null si queda entero fuera.
 */
function clipSegment(
  a: Point2D, b: Point2D,
  x: number, y: number, w: number, h: number,
): [Point2D, Point2D] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1

  const edges: [number, number][] = [
    [-dx, a.x - x],
    [dx, x + w - a.x],
    [-dy, a.y - y],
    [dy, y + h - a.y],
  ]

  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null   // paralelo y fuera
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }

  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ]
}

/**
 * Recorta un path al rectángulo del tile.
 *
 * - Si el path entra completo, se devuelve tal cual (conserva `closed`).
 * - Si lo cruza, se devuelven los tramos interiores como paths abiertos;
 *   el resto lo corta el tile vecino. Sin esto, un path más ancho que el
 *   tile se emitiría entero en cada tile y la máquina saldría de recorrido.
 */
function clipPathToRect(
  path: GCodePath,
  x: number, y: number, w: number, h: number,
): GCodePath[] {
  const pts = path.points
  if (pts.length === 0) return []
  if (pts.length === 1) {
    return pointInRect(pts[0], x, y, w, h) ? [path] : []
  }

  if (pts.every(pt => pointInRect(pt, x, y, w, h))) return [path]

  // Segmentos a recorrer: los del path más el de cierre si es cerrado
  const segments: [Point2D, Point2D][] = []
  for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1]])
  if (path.closed && pts.length > 2) segments.push([pts[pts.length - 1], pts[0]])

  const EPS = 1e-6
  const fragments: GCodePath[] = []
  let current: Point2D[] = []

  for (const [a, b] of segments) {
    const clipped = clipSegment(a, b, x, y, w, h)
    if (!clipped) {
      if (current.length >= 2) fragments.push({ points: current, closed: false, strokeColor: path.strokeColor })
      current = []
      continue
    }

    const [s, e] = clipped
    const last = current[current.length - 1]
    if (last && Math.abs(last.x - s.x) < EPS && Math.abs(last.y - s.y) < EPS) {
      current.push(e)
    } else {
      if (current.length >= 2) fragments.push({ points: current, closed: false, strokeColor: path.strokeColor })
      current = [s, e]
    }
  }

  if (current.length >= 2) fragments.push({ points: current, closed: false, strokeColor: path.strokeColor })

  return fragments
}

/**
 * Split paths into tiles. Los paths que cruzan un borde se recortan y cada
 * tile recibe sólo su tramo; el solape asegura la continuidad en el empalme.
 */
export function generateTiles(paths: GCodePath[], config: TilingConfig): Tile[] {
  const { startX, startY, rows, cols } = config.grid ?? computeTileGrid(paths, config)
  const effectiveW = Math.max(0.001, config.tileWidth - config.overlap)
  const effectiveH = Math.max(0.001, config.tileHeight - config.overlap)

  const tiles: Tile[] = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileX = startX + col * effectiveW
      const tileY = startY + row * effectiveH
      const tileW = config.tileWidth
      const tileH = config.tileHeight

      const tilePaths: GCodePath[] = []
      for (const path of paths) {
        for (const fragment of clipPathToRect(path, tileX, tileY, tileW, tileH)) {
          // Coordenadas locales al tile: cada archivo se corre con el
          // material reposicionado en el origen del tile
          tilePaths.push({
            points: fragment.points.map(pt => ({ x: pt.x - tileX, y: pt.y - tileY })),
            closed: fragment.closed,
            strokeColor: fragment.strokeColor,
          })
        }
      }

      tiles.push({
        row, col,
        x: tileX, y: tileY,
        width: tileW, height: tileH,
        paths: tilePaths,
      })
    }
  }

  return tiles.filter(t => t.paths.length > 0)
}

/**
 * Generate G-code header comment for a tile.
 */
export function tileHeader(tile: Tile, totalTiles: number, index: number = 0): string[] {
  return [
    `; ====================================`,
    `; TILE ${index + 1}/${totalTiles} (row ${tile.row + 1}, col ${tile.col + 1})`,
    `; Origin: X${tile.x.toFixed(1)} Y${tile.y.toFixed(1)}`,
    `; Size: ${tile.width}x${tile.height}mm`,
    `; ====================================`,
    `; Position material so tile origin aligns with machine zero`,
    `; Then run this tile's G-code`,
    '',
  ]
}
