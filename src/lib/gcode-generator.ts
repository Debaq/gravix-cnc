import type { Point2D, GCodePath, GlobalConfig } from './types'

export class GCodeGenerator {
  private totalDistance = 0
  private totalTime = 0

  generate(paths: GCodePath[], config: GlobalConfig, operationType: string): string {
    this.totalDistance = 0
    this.totalTime = 0

    const lines: string[] = []

    if (paths.length === 0) {
      lines.push('; ERROR: No paths to process')
    } else {
      if (operationType === 'cnc') {
        lines.push(...this.generateCNCToolpath(paths, config))
      } else if (operationType === 'laser') {
        lines.push(...this.generateLaserToolpath(paths, config))
      }
    }

    return lines.join('\n')
  }

  private generateCNCToolpath(paths: GCodePath[], config: GlobalConfig): string[] {
    const lines: string[] = []
    const depth = parseFloat(String(config.depth))
    const depthStep = parseFloat(String(config.depthStep))
    const toolRadius = parseFloat(String(config.toolDiameter)) / 2
    const feedRate = parseFloat(String(config.feedRate))
    const plungeRate = parseFloat(String(config.plungeRate))
    const compensation = config.compensation

    const numPasses = Math.ceil(Math.abs(depth) / depthStep)

    lines.push(`; CNC TOOLPATH - ${numPasses} passes`)
    lines.push(`; Total depth: ${depth}mm in ${depthStep}mm steps`)
    lines.push(`; Tool diameter: ${config.toolDiameter}mm (radius: ${toolRadius}mm)`)
    lines.push(`; Compensation: ${compensation}`)
    lines.push('')

    for (let pass = 1; pass <= numPasses; pass++) {
      const currentDepth = -Math.min(Math.abs(depth), depthStep * pass)

      lines.push('')
      lines.push('; ====================================')
      lines.push(`; PASS ${pass}/${numPasses} - Depth: ${currentDepth.toFixed(3)}mm`)
      lines.push('; ====================================')
      lines.push('')

      paths.forEach((path, pathIndex) => {
        lines.push(`; Path ${pathIndex + 1} (${path.points.length} points)`)

        let processedPoints = path.points
        if (compensation !== 'center' && toolRadius > 0) {
          processedPoints = this.applyToolCompensation(
            path.points,
            toolRadius,
            compensation === 'outside' ? 1 : -1,
            path.closed
          )
        }

        if (processedPoints.length === 0) {
          lines.push('; Warning: Path has no points after compensation')
          return
        }

        const startPoint = processedPoints[0]
        lines.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} ; Rapid to start`)
        lines.push(`G1 Z${currentDepth.toFixed(3)} F${plungeRate} ; Plunge`)

        for (let i = 1; i < processedPoints.length; i++) {
          const pt = processedPoints[i]
          lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)

          const prevPt = processedPoints[i - 1]
          const dist = this.distance(prevPt, pt)
          this.totalDistance += dist
          this.totalTime += (dist / feedRate) * 60
        }

        lines.push('G0 Z5 ; Retract')
        lines.push('')
      })
    }

    return lines
  }

  private generateLaserToolpath(paths: GCodePath[], config: GlobalConfig): string[] {
    const lines: string[] = []
    const feedRate = parseFloat(String(config.feedRate))
    const laserPower = parseFloat(String(config.laserPower))
    const laserS = Math.round((laserPower / 100) * 1000)

    lines.push('; LASER TOOLPATH')
    lines.push(`; Power: ${laserPower}% (S${laserS})`)
    lines.push(`; Feed rate: ${feedRate} mm/min`)
    lines.push('')

    paths.forEach((path, pathIndex) => {
      lines.push(`; Path ${pathIndex + 1} (${path.points.length} points)`)

      if (path.points.length === 0) {
        lines.push('; Warning: Empty path')
        return
      }

      const startPoint = path.points[0]
      lines.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} ; Rapid to start`)
      lines.push(`M3 S${laserS} ; Laser on at ${laserPower}%`)

      for (let i = 1; i < path.points.length; i++) {
        const pt = path.points[i]
        lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)

        const prevPt = path.points[i - 1]
        const dist = this.distance(prevPt, pt)
        this.totalDistance += dist
        this.totalTime += (dist / feedRate) * 60
      }

      lines.push('M3 S0 ; Laser off')
      lines.push('')
    })

    return lines
  }

  private applyToolCompensation(
    points: Point2D[],
    radius: number,
    direction: number,
    closed: boolean
  ): Point2D[] {
    if (points.length < 2) return points

    const offsetPoints: Point2D[] = []

    for (let i = 0; i < points.length; i++) {
      const prevIndex = i === 0 ? (closed ? points.length - 1 : 0) : i - 1
      const nextIndex = i === points.length - 1 ? (closed ? 0 : i) : i + 1

      const prev = points[prevIndex]
      const current = points[i]
      const next = points[nextIndex]

      let normalX = 0
      let normalY = 0

      if (i === 0 && !closed) {
        const dx = next.x - current.x
        const dy = next.y - current.y
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len > 0) {
          normalX = -dy / len
          normalY = dx / len
        }
      } else if (i === points.length - 1 && !closed) {
        const dx = current.x - prev.x
        const dy = current.y - prev.y
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len > 0) {
          normalX = -dy / len
          normalY = dx / len
        }
      } else {
        const dx1 = current.x - prev.x
        const dy1 = current.y - prev.y
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)

        const dx2 = next.x - current.x
        const dy2 = next.y - current.y
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)

        if (len1 > 0 && len2 > 0) {
          const n1x = -dy1 / len1
          const n1y = dx1 / len1
          const n2x = -dy2 / len2
          const n2y = dx2 / len2

          normalX = (n1x + n2x) / 2
          normalY = (n1y + n2y) / 2

          const normalLen = Math.sqrt(normalX * normalX + normalY * normalY)
          if (normalLen > 0) {
            normalX /= normalLen
            normalY /= normalLen
          }
        }
      }

      const offsetX = current.x + normalX * radius * direction
      const offsetY = current.y + normalY * radius * direction

      offsetPoints.push({
        x: parseFloat(offsetX.toFixed(3)),
        y: parseFloat(offsetY.toFixed(3)),
      })
    }

    return offsetPoints
  }

  private distance(p1: Point2D, p2: Point2D): number {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  getEstimates() {
    return {
      distance: this.totalDistance,
      time: this.totalTime,
    }
  }
}
