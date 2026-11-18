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

// ============================================
// Tiling sobre el G-code ya generado
// ============================================
//
// Recortar la geometria y generar despues no sirve: un contorno partido por
// el borde del tile queda abierto, y un path abierto no se compensa por el
// radio de la fresa ni se cajea. Aca se genera el programa completo una sola
// vez y se recorta la TRAYECTORIA, que ya trae offset, cajeado, tabs y rampas.

export interface GCodeTile {
  row: number
  col: number
  x: number
  y: number
  width: number
  height: number
  gcode: string
}

export interface GCodeTilingOptions {
  /** Altura de retraccion para entrar y salir del tile a mitad de un corte. */
  safeZ: number
  /** El programa corta bajando en Z (CNC, plotter). */
  useZ: boolean
  /** El programa corta con haz (laser): al salir del tile hay que apagarlo. */
  useBeam: boolean
}

const WORD = /([A-Z])\s*(-?\d*\.?\d+)/gi

function splitLine(line: string): { code: string; comment: string } {
  const semi = line.indexOf(';')
  return semi >= 0
    ? { code: line.slice(0, semi), comment: line.slice(semi) }
    : { code: line, comment: '' }
}

function parseWords(code: string): Map<string, number[]> {
  const words = new Map<string, number[]>()
  for (const m of code.matchAll(WORD)) {
    const k = m[1].toUpperCase()
    words.set(k, [...(words.get(k) ?? []), parseFloat(m[2])])
  }
  return words
}

/** Caja de todos los movimientos de corte (no rapidos) del programa. */
function cuttingBBox(lines: string[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let x = 0, y = 0, motion = 0
  const add = (px: number, py: number) => {
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
  }
  for (const line of lines) {
    const w = parseWords(splitLine(line).code)
    for (const g of w.get('G') ?? []) if (g <= 3 || (g >= 81 && g <= 83)) motion = g
    const nx = w.get('X')?.[0]
    const ny = w.get('Y')?.[0]
    if (nx === undefined && ny === undefined) continue
    const px = nx ?? x
    const py = ny ?? y
    if (motion !== 0) {
      add(x, y)
      add(px, py)
    }
    x = px
    y = py
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

/**
 * Parte un programa completo en un G-code por tile.
 *
 * Cada tile recibe los tramos de corte que caen dentro de su rectangulo, en
 * coordenadas locales. Cuando un corte entra o sale por el borde, la
 * herramienta sube (o el haz se apaga), viaja y vuelve a bajar a la Z que el
 * programa tenia en ese punto.
 */
export function tileGCode(program: string, config: TilingConfig, opts: GCodeTilingOptions): GCodeTile[] {
  const lines = program.split('\n')
  const bbox = cuttingBBox(lines)
  if (!bbox) return []

  const effW = Math.max(0.001, config.tileWidth - config.overlap)
  const effH = Math.max(0.001, config.tileHeight - config.overlap)
  const startX = bbox.minX - config.margin
  const startY = bbox.minY - config.margin
  const cols = Math.max(1, Math.ceil((bbox.maxX - bbox.minX + config.margin * 2) / effW))
  const rows = Math.max(1, Math.ceil((bbox.maxY - bbox.minY + config.margin * 2) / effH))

  const tiles: GCodeTile[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tx = startX + col * effW
      const ty = startY + row * effH
      const gcode = clipProgramToTile(lines, tx, ty, config.tileWidth, config.tileHeight, opts)
      if (gcode) {
        tiles.push({ row, col, x: tx, y: ty, width: config.tileWidth, height: config.tileHeight, gcode })
      }
    }
  }
  return tiles
}

function clipProgramToTile(
  lines: string[],
  tx: number, ty: number, tw: number, th: number,
  opts: GCodeTilingOptions,
): string | null {
  const out: string[] = []
  const f3 = (n: number) => n.toFixed(3)
  const EPS = 1e-6
  const inside = (px: number, py: number) =>
    px >= tx - EPS && px <= tx + tw + EPS && py >= ty - EPS && py <= ty + th + EPS

  // Posicion del programa original
  let px = 0, py = 0
  let pz: number | null = null
  let motion = 0
  let feed = 0
  let plungeFeed = 0
  // Posicion real de la herramienta en este tile
  let synced = true        // XY real == XY del programa
  let realZ: number | null = null
  // Herramienta/haz
  let toolOnLine: string | null = null   // ultimo M3/M4 del programa
  let toolIsOn = false                   // encendido en el tile
  let deferredOn: string | null = null   // encendido pendiente de reubicarse
  let deferredDwell: string | null = null
  // Ciclos de taladrado
  let cycleHead: string | null = null    // "G83 Z.. R.. Q.. F.." sin XY
  let cycleEmitted = false
  let cuts = 0

  const retract = () => {
    if (opts.useZ && (realZ === null || realZ < opts.safeZ)) {
      out.push(`G0 Z${f3(opts.safeZ)}`)
      realZ = opts.safeZ
    }
  }
  const beamOff = () => {
    if (opts.useBeam && toolIsOn) {
      out.push('M5 S0')
      toolIsOn = false
      deferredOn = toolOnLine
    }
  }
  const flushDeferredOn = () => {
    if (!deferredOn) return
    out.push(deferredOn)
    if (deferredDwell) out.push(deferredDwell)
    else if (opts.useZ && !opts.useBeam) out.push('G4 P2 ; Dwell for spindle startup')
    toolIsOn = true
    deferredOn = null
    deferredDwell = null
  }
  /** Lleva la herramienta a (x,y) del programa y la deja a la Z `z`. */
  const enterAt = (x: number, y: number, z: number | null) => {
    beamOff()
    retract()
    out.push(`G0 X${f3(x - tx)} Y${f3(y - ty)}`)
    flushDeferredOn()
    if (opts.useZ && z !== null && realZ !== z) {
      out.push(`G1 Z${f3(z)} F${plungeFeed || feed || 100}`)
      realZ = z
    }
  }

  for (const line of lines) {
    const { code, comment } = splitLine(line)
    const trimmed = code.trim()
    if (!trimmed) {
      out.push(line)
      continue
    }
    const w = parseWords(trimmed)
    const gs = w.get('G') ?? []
    const ms = w.get('M') ?? []
    const X = w.get('X')?.[0]
    const Y = w.get('Y')?.[0]
    const Z = w.get('Z')?.[0]
    const F = w.get('F')?.[0]
    if (F !== undefined) feed = F

    // --- Encendido / apagado de husillo o laser
    if (ms.includes(3) || ms.includes(4)) {
      toolOnLine = line
      if (synced) {
        out.push(line)
        toolIsOn = true
        deferredOn = null
      } else {
        // Encender fuera de posicion quema un punto (laser): se difiere
        deferredOn = line
        deferredDwell = null
      }
      continue
    }
    if (ms.includes(5)) {
      out.push(line)
      toolIsOn = false
      deferredOn = null
      deferredDwell = null
      continue
    }

    for (const g of gs) {
      if (g <= 3) { motion = g; cycleHead = null }
      else if (g >= 81 && g <= 83) {
        motion = g
        cycleHead = trimmed.replace(/[XY]\s*-?\d*\.?\d+\s*/gi, '').trim()
        cycleEmitted = false
      } else if (g === 80) { cycleHead = null; motion = 0 }
    }

    if (gs.includes(4)) {
      if (deferredOn) deferredDwell = line
      else out.push(line)
      continue
    }

    const hasXY = X !== undefined || Y !== undefined
    const isMotion = hasXY || Z !== undefined

    // Todo lo que no mueve (G90, G21, M0, comentarios con codigo, G80...)
    if (!isMotion || gs.some((g) => g === 10 || g === 28 || g === 30 || g === 53 || g === 92)) {
      out.push(line)
      continue
    }

    // --- Ciclos de taladrado: un agujero por linea
    if (motion >= 81 && motion <= 83) {
      const hx = X ?? px
      const hy = Y ?? py
      px = hx
      py = hy
      if (inside(hx, hy) && cycleHead) {
        if (!cycleEmitted) {
          out.push(`${cycleHead.replace(/^(G8[123])/i, `$1 X${f3(hx - tx)} Y${f3(hy - ty)}`)}`)
          cycleEmitted = true
        } else {
          out.push(`X${f3(hx - tx)} Y${f3(hy - ty)}`)
        }
        cuts++
      }
      synced = false
      continue
    }

    const nx = X ?? px
    const ny = Y ?? py
    const nz: number | null = Z ?? pz

    // --- Solo Z
    if (!hasXY) {
      const goingUp = realZ === null || (nz !== null && nz >= realZ)
      // El avance de penetracion se recuerda aunque la bajada no se emita:
      // hace falta para volver a bajar al reentrar al tile.
      if (motion === 1 && F !== undefined) plungeFeed = F
      if (synced || goingUp) {
        out.push(line)
        realZ = nz
      }
      pz = nz
      continue
    }

    // --- Rapido en XY
    if (motion === 0) {
      // El retorno a origen del pie no aplica: cada tile termina donde esta
      if (inside(nx, ny) && !/return to origin/i.test(comment)) {
        if (!synced) { beamOff(); retract() }
        out.push(`G0 X${f3(nx - tx)} Y${f3(ny - ty)}${Z !== undefined ? ` Z${f3(Z)}` : ''}${comment ? ' ' + comment : ''}`)
        if (Z !== undefined) realZ = Z
        synced = true
        flushDeferredOn()
      } else {
        if (synced) beamOff()
        synced = false
      }
      px = nx; py = ny; pz = nz
      continue
    }

    // --- Arcos: solo si entran enteros (el generador los usa en entradas cortas)
    if (motion === 2 || motion === 3) {
      if (synced && inside(px, py) && inside(nx, ny)) {
        out.push(trimmed
          .replace(/X\s*-?\d*\.?\d+/i, `X${f3(nx - tx)}`)
          .replace(/Y\s*-?\d*\.?\d+/i, `Y${f3(ny - ty)}`) + (comment ? ' ' + comment : ''))
        cuts++
      } else {
        if (synced) { beamOff(); retract() }
        synced = false
      }
      px = nx; py = ny; pz = nz
      continue
    }

    // --- Corte recto: se recorta contra el tile
    const clipped = clipSegment({ x: px, y: py }, { x: nx, y: ny }, tx, ty, tw, th)
    const segLen = Math.hypot(nx - px, ny - py)
    if (!clipped || (segLen > EPS && Math.hypot(clipped[1].x - clipped[0].x, clipped[1].y - clipped[0].y) < EPS)) {
      if (synced) { beamOff(); retract() }
      synced = false
      px = nx; py = ny; pz = nz
      continue
    }
    const [s, e] = clipped
    const tAt = (p: Point2D) => (segLen > EPS ? Math.hypot(p.x - px, p.y - py) / segLen : 1)
    const zAt = (t: number) => (pz === null || nz === null ? nz : pz + (nz - pz) * t)
    const startsHere = Math.abs(s.x - px) < EPS && Math.abs(s.y - py) < EPS
    const endsHere = Math.abs(e.x - nx) < EPS && Math.abs(e.y - ny) < EPS

    if (!synced || !startsHere) {
      enterAt(s.x, s.y, zAt(tAt(s)))
    } else {
      flushDeferredOn()
      const z0 = pz
      if (opts.useZ && z0 !== null && realZ !== z0) {
        out.push(`G1 Z${f3(z0)} F${plungeFeed || feed || 100}`)
        realZ = z0
      }
    }
    const ze = zAt(tAt(e))
    const zWord = Z !== undefined && ze !== null ? ` Z${f3(ze)}` : ''
    out.push(`G1 X${f3(e.x - tx)} Y${f3(e.y - ty)}${zWord} F${feed || 100}`)
    if (Z !== undefined && ze !== null) realZ = ze
    cuts++

    if (endsHere) {
      synced = true
    } else {
      beamOff()
      retract()
      synced = false
    }
    px = nx; py = ny; pz = nz
  }

  return cuts > 0 ? out.join('\n') : null
}
