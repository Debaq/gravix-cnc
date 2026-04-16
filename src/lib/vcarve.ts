import type { Point2D } from './types'

/**
 * V-Carve toolpath generation.
 *
 * Strategy: sample the boundary at high resolution, then for each pair of
 * boundary segments that are "across" from each other, compute the centerline
 * point and its depth based on V-bit angle.
 *
 * Simplified approach: offset-based medial axis approximation.
 * Progressive inward offsets at small steps, each offset contour becomes
 * a toolpath at the corresponding depth.
 */

export interface VCarveParams {
  vbitAngle: number      // Full V-bit angle in degrees (e.g., 60, 90)
  maxDepth: number       // Maximum depth limit (mm)
  stepSize: number       // Offset step size (mm) — resolution of the carve
  flatDepth?: number     // Flat-bottom depth (mm, 0 = standard V-carve)
}

export interface VCarvePass {
  points: Point2D[]
  depth: number          // Negative Z value
  closed: boolean
}

/**
 * Generate V-carve passes using progressive inward offsets.
 *
 * Each offset level represents the centerline at that distance from the
 * boundary. The depth at each level = offset / tan(halfAngle).
 *
 * For a 90° V-bit: depth = offset (tan(45°) = 1)
 * For a 60° V-bit: depth = offset / tan(30°) ≈ offset * 1.732
 */
export async function generateVCarveToolpath(
  boundary: Point2D[],
  params: VCarveParams,
): Promise<VCarvePass[]> {
  const { offsetPolygon } = await import('./geometry')

  const halfAngle = (params.vbitAngle / 2) * (Math.PI / 180)
  const tanHalf = Math.tan(halfAngle)
  const passes: VCarvePass[] = []

  let offset = params.stepSize
  let iteration = 0
  const maxIterations = 500 // Safety limit

  while (iteration < maxIterations) {
    const depth = offset / tanHalf
    if (depth > params.maxDepth) break

    const contours = await offsetPolygon(boundary, -offset, true, 'round')
    if (contours.length === 0) break

    for (const contour of contours) {
      if (contour.length < 2) continue
      passes.push({
        points: contour,
        depth: -depth,
        closed: true,
      })
    }

    offset += params.stepSize
    iteration++
  }

  // If flat-bottom specified, add the deepest offset as a flat pass
  if (params.flatDepth && params.flatDepth > 0) {
    const flatOffset = params.flatDepth * tanHalf
    const contours = await offsetPolygon(boundary, -flatOffset, true, 'round')
    for (const contour of contours) {
      if (contour.length < 2) continue
      passes.push({
        points: contour,
        depth: -params.flatDepth,
        closed: true,
      })
    }
  }

  return passes
}

/**
 * Generate G-code lines for V-carve passes.
 */
export function emitVCarveGCode(
  passes: VCarvePass[],
  feedRate: number,
  plungeRate: number,
  safeZ: number = 5,
): string[] {
  const lines: string[] = []

  // Sort passes by depth (shallowest first = roughing to finishing)
  const sorted = [...passes].sort((a, b) => b.depth - a.depth) // less negative first

  for (const pass of sorted) {
    if (pass.points.length === 0) continue
    const start = pass.points[0]

    lines.push(`G0 Z${safeZ}`)
    lines.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`)
    lines.push(`G1 Z${pass.depth.toFixed(3)} F${plungeRate}`)

    for (let i = 1; i < pass.points.length; i++) {
      const pt = pass.points[i]
      lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)
    }

    if (pass.closed && pass.points.length > 2) {
      lines.push(`G1 X${start.x.toFixed(3)} Y${start.y.toFixed(3)} F${feedRate}`)
    }

    lines.push(`G0 Z${safeZ}`)
  }

  return lines
}
