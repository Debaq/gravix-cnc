import type { GCodePath, Point2D } from './types'

export interface TilingConfig {
  tileWidth: number      // mm
  tileHeight: number     // mm
  overlap: number        // mm overlap between tiles
  margin: number         // mm margin around design
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
 * Check if a point is inside a rectangular region (with margin).
 */
function pointInRect(pt: Point2D, x: number, y: number, w: number, h: number): boolean {
  return pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h
}

/**
 * Split paths into tiles. Paths that cross tile boundaries are included
 * in both tiles (with overlap ensuring continuity).
 */
export function generateTiles(paths: GCodePath[], config: TilingConfig): Tile[] {
  const bbox = pathsBBox(paths)
  const totalW = bbox.maxX - bbox.minX + config.margin * 2
  const totalH = bbox.maxY - bbox.minY + config.margin * 2
  const startX = bbox.minX - config.margin
  const startY = bbox.minY - config.margin

  const effectiveW = config.tileWidth - config.overlap
  const effectiveH = config.tileHeight - config.overlap
  const cols = Math.max(1, Math.ceil(totalW / effectiveW))
  const rows = Math.max(1, Math.ceil(totalH / effectiveH))

  const tiles: Tile[] = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileX = startX + col * effectiveW
      const tileY = startY + row * effectiveH
      const tileW = config.tileWidth
      const tileH = config.tileHeight

      // Filter paths that have any point in this tile
      const tilePaths: GCodePath[] = []
      for (const path of paths) {
        const hasPointInTile = path.points.some(pt =>
          pointInRect(pt, tileX, tileY, tileW, tileH)
        )
        if (hasPointInTile) {
          // Offset paths to tile-local coordinates
          const offsetPoints = path.points.map(pt => ({
            x: pt.x - tileX,
            y: pt.y - tileY,
          }))
          tilePaths.push({
            points: offsetPoints,
            closed: path.closed,
            strokeColor: path.strokeColor,
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
export function tileHeader(tile: Tile, totalTiles: number): string[] {
  return [
    `; ====================================`,
    `; TILE ${tile.row * 1000 + tile.col + 1}/${totalTiles} (row ${tile.row + 1}, col ${tile.col + 1})`,
    `; Origin: X${tile.x.toFixed(1)} Y${tile.y.toFixed(1)}`,
    `; Size: ${tile.width}x${tile.height}mm`,
    `; ====================================`,
    `; Position material so tile origin aligns with machine zero`,
    `; Then run this tile's G-code`,
    '',
  ]
}
