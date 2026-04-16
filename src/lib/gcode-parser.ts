// ============================================
// G-code Parser para visualización 3D
// ============================================

export interface GCodePoint {
  x: number
  y: number
  z: number
}

export type SegmentType = 'rapid' | 'cut'

export interface GCodeSegment {
  from: GCodePoint
  to: GCodePoint
  type: SegmentType
  lineNumber: number
  color?: string  // hex color from plotter color groups or laser color mapping
}

export interface GCodeParseResult {
  segments: GCodeSegment[]
  stats: {
    totalDistance: number
    maxDepth: number
    estimatedTime: number // seconds
    rapidDistance: number
    cutDistance: number
  }
}

function distance3D(a: GCodePoint, b: GCodePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Estimate time for a segment considering trapezoidal acceleration profile.
 * GRBL default acceleration ~500 mm/s². For short segments, machine never
 * reaches full speed so time is longer than distance/feedrate.
 * @param dist - distance in mm
 * @param feedRate - target feed rate in mm/min
 * @returns time in seconds
 */
function estimateSegmentTime(dist: number, feedRate: number): number {
  const accel = 500 // mm/s² — GRBL default ($120/$121/$122)
  const vMax = feedRate / 60 // mm/s
  // Distance needed to accelerate to vMax: d = v²/(2a)
  const accelDist = (vMax * vMax) / (2 * accel)

  if (dist <= 0.001) return 0

  if (dist >= 2 * accelDist) {
    // Trapezoid: accel + cruise + decel
    const accelTime = vMax / accel
    const cruiseDist = dist - 2 * accelDist
    return 2 * accelTime + cruiseDist / vMax
  } else {
    // Triangle: never reaches full speed
    // Peak speed = sqrt(2 * accel * dist/2) = sqrt(accel * dist)
    return 2 * Math.sqrt(dist / accel)
  }
}

/**
 * Parse a G-code string into renderable segments with statistics.
 * Handles G0 (rapid), G1 (cut), M3 (laser on), M5 (laser off).
 * Coordinates are kept in G-code space (X, Y, Z).
 * The caller is responsible for mapping to 3D scene coordinates.
 */
export function parseGCode(gcodeStr: string): GCodeParseResult {
  const segments: GCodeSegment[] = []
  let totalDistance = 0
  let rapidDistance = 0
  let cutDistance = 0
  let maxDepth = 0
  let estimatedTime = 0

  // Current position
  let cx = 0
  let cy = 0
  let cz = 0

  // Current state
  let currentMode: 'G0' | 'G1' = 'G0'
  let laserOn = false
  let currentFeedRate = 1000 // mm/min default
  const rapidFeedRate = 5000 // mm/min assumed for G0
  let currentColor: string | undefined

  const lines = gcodeStr.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]

    // Parse color from comments: "; --- Color group: #rrggbb ..." or "; --- #rrggbb ..."
    const colorMatch = raw.match(/;\s*---.*?(#[0-9a-fA-F]{6})/)
    if (colorMatch) {
      currentColor = colorMatch[1]
    }

    // Strip comments (everything after ;)
    const line = raw.split(';')[0].trim()
    if (line.length === 0) continue

    // Parse M commands - check M3 with S parameter first
    const m3Match = line.match(/^M3\s+S(\d+)/i)
    if (m3Match) {
      const power = parseInt(m3Match[1], 10)
      laserOn = power > 0
      continue
    }
    if (/^M3\b/i.test(line)) {
      laserOn = true
      continue
    }
    if (/^M5\b/i.test(line)) {
      laserOn = false
      continue
    }

    // Detect G command
    const gMatch = line.match(/^G([0-3])\b/i)
    if (gMatch) {
      const gNum = parseInt(gMatch[1], 10)
      if (gNum === 0) currentMode = 'G0'
      else if (gNum === 1) currentMode = 'G1'
      // G2/G3 arcs: treat as cut moves (linearized approximation - just endpoint)
    }

    // Extract coordinates
    const xMatch = line.match(/X([+-]?\d*\.?\d+)/i)
    const yMatch = line.match(/Y([+-]?\d*\.?\d+)/i)
    const zMatch = line.match(/Z([+-]?\d*\.?\d+)/i)
    const fMatch = line.match(/F([+-]?\d*\.?\d+)/i)

    if (fMatch) {
      currentFeedRate = parseFloat(fMatch[1])
    }

    // Skip lines without any coordinate movement
    if (!xMatch && !yMatch && !zMatch) continue

    const nx = xMatch ? parseFloat(xMatch[1]) : cx
    const ny = yMatch ? parseFloat(yMatch[1]) : cy
    const nz = zMatch ? parseFloat(zMatch[1]) : cz

    // Only add segment if there's actual movement
    if (nx !== cx || ny !== cy || nz !== cz) {
      const from: GCodePoint = { x: cx, y: cy, z: cz }
      const to: GCodePoint = { x: nx, y: ny, z: nz }

      // Determine segment type
      let segType: SegmentType
      if (currentMode === 'G0' && !laserOn) {
        segType = 'rapid'
      } else {
        segType = 'cut'
      }

      segments.push({ from, to, type: segType, lineNumber: i + 1, color: currentColor })

      const dist = distance3D(from, to)
      totalDistance += dist

      if (segType === 'rapid') {
        rapidDistance += dist
        estimatedTime += estimateSegmentTime(dist, rapidFeedRate)
      } else {
        cutDistance += dist
        estimatedTime += estimateSegmentTime(dist, currentFeedRate || 1000)
      }

      // Track max depth (most negative Z)
      if (nz < -maxDepth) maxDepth = -nz
      if (cz < -maxDepth) maxDepth = -cz
    }

    cx = nx
    cy = ny
    cz = nz
  }

  return {
    segments,
    stats: {
      totalDistance,
      maxDepth,
      estimatedTime,
      rapidDistance,
      cutDistance,
    },
  }
}

/**
 * Format seconds into a human-readable time string
 */
export function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}m ${secs}s`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}
