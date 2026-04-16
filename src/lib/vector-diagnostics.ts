import type { Point2D, GCodePath } from './types'

export interface DiagnosticIssue {
  type: 'open_path' | 'duplicate' | 'tiny_span' | 'self_intersect' | 'near_miss'
  severity: 'error' | 'warning' | 'info'
  message: string
  pathIndex: number
  pointIndex?: number
}

const TOLERANCE = 0.01 // mm

/**
 * Run diagnostics on a set of paths, detecting common issues
 * that cause toolpath generation problems.
 */
export function diagnoseVectors(paths: GCodePath[]): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = []

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    const pts = path.points

    if (pts.length === 0) continue

    // 1. Open paths that should be closed (start ≈ end but not flagged closed)
    if (!path.closed && pts.length >= 3) {
      const first = pts[0]
      const last = pts[pts.length - 1]
      const gap = dist(first, last)
      if (gap < TOLERANCE * 10 && gap > 0) {
        issues.push({
          type: 'near_miss',
          severity: 'warning',
          message: `Path ${i + 1}: casi cerrado (gap ${gap.toFixed(3)}mm) — auto-join posible`,
          pathIndex: i,
        })
      } else if (gap > 0) {
        issues.push({
          type: 'open_path',
          severity: 'info',
          message: `Path ${i + 1}: abierto (${pts.length} puntos)`,
          pathIndex: i,
        })
      }
    }

    // 2. Tiny spans (segments shorter than tolerance)
    let tinyCount = 0
    for (let j = 1; j < pts.length; j++) {
      if (dist(pts[j - 1], pts[j]) < TOLERANCE) {
        tinyCount++
      }
    }
    if (tinyCount > 0) {
      issues.push({
        type: 'tiny_span',
        severity: 'warning',
        message: `Path ${i + 1}: ${tinyCount} segmento(s) < ${TOLERANCE}mm`,
        pathIndex: i,
      })
    }

    // 3. Duplicate paths (same start, same point count, similar total length)
    for (let j = i + 1; j < paths.length; j++) {
      const other = paths[j]
      if (other.points.length !== pts.length) continue
      if (other.points.length === 0) continue
      if (dist(pts[0], other.points[0]) > TOLERANCE) continue

      // Check if paths are approximately identical
      let maxDiff = 0
      for (let k = 0; k < pts.length; k++) {
        const d = dist(pts[k], other.points[k])
        if (d > maxDiff) maxDiff = d
      }
      if (maxDiff < TOLERANCE * 5) {
        issues.push({
          type: 'duplicate',
          severity: 'warning',
          message: `Path ${i + 1} y ${j + 1}: posibles duplicados`,
          pathIndex: i,
        })
      }
    }
  }

  return issues
}

/**
 * Auto-fix: join near-miss paths (gap < tolerance)
 */
export function autoJoinPaths(paths: GCodePath[], tolerance: number = 0.1): GCodePath[] {
  return paths.map(path => {
    if (path.closed || path.points.length < 3) return path
    const first = path.points[0]
    const last = path.points[path.points.length - 1]
    if (dist(first, last) < tolerance) {
      return { ...path, closed: true }
    }
    return path
  })
}

/**
 * Auto-fix: remove tiny spans (segments shorter than tolerance)
 */
export function removeTinySpans(paths: GCodePath[], tolerance: number = 0.01): GCodePath[] {
  return paths.map(path => {
    if (path.points.length < 2) return path
    const filtered = [path.points[0]]
    for (let i = 1; i < path.points.length; i++) {
      if (dist(filtered[filtered.length - 1], path.points[i]) >= tolerance) {
        filtered.push(path.points[i])
      }
    }
    return { ...path, points: filtered }
  })
}

/**
 * Auto-fix: remove duplicate paths
 */
export function removeDuplicatePaths(paths: GCodePath[], tolerance: number = 0.05): GCodePath[] {
  const keep: boolean[] = new Array(paths.length).fill(true)

  for (let i = 0; i < paths.length; i++) {
    if (!keep[i]) continue
    for (let j = i + 1; j < paths.length; j++) {
      if (!keep[j]) continue
      if (paths[i].points.length !== paths[j].points.length) continue
      if (paths[i].points.length === 0) continue
      if (dist(paths[i].points[0], paths[j].points[0]) > tolerance) continue

      let maxDiff = 0
      for (let k = 0; k < paths[i].points.length; k++) {
        const d = dist(paths[i].points[k], paths[j].points[k])
        if (d > maxDiff) maxDiff = d
      }
      if (maxDiff < tolerance * 5) {
        keep[j] = false
      }
    }
  }

  return paths.filter((_, i) => keep[i])
}

function dist(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}
