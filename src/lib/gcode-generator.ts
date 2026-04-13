import type { Point2D, GCodePath, GCodeJob, GlobalConfig, RasterData } from './types'
import { offsetPolygon, generatePocketContours, orderPaths, generateHatchLines } from './geometry'

const SAFE_Z = 5
const FINAL_RETRACT_Z = 10

export class GCodeGenerator {
  private totalDistance = 0
  private totalTime = 0

  /**
   * Generate G-code from per-element jobs (new API with tool changes)
   */
  async generateFromJobs(jobs: GCodeJob[], rasterData?: RasterData | null): Promise<string> {
    this.totalDistance = 0
    this.totalTime = 0

    if (jobs.length === 0 && !rasterData) {
      return '; ERROR: No elements to process'
    }

    const lines: string[] = []

    // Check for raster-only mode (special case)
    const rasterJob = jobs.find(j => j.config.operationType === 'laser' && j.config.laserMode === 'raster')
    if (rasterJob && rasterData) {
      lines.push(...await this.generateLaserRaster(rasterData, rasterJob.config))
      return lines.join('\n')
    }

    // Filter out jobs with no paths
    const validJobs = jobs.filter(j => j.paths.length > 0)
    if (validJobs.length === 0) {
      return '; ERROR: No valid paths to process'
    }

    // Group jobs by tool (maintaining order of first appearance)
    const toolGroups: { toolId: string; jobs: GCodeJob[] }[] = []
    const toolGroupMap = new Map<string, GCodeJob[]>()

    for (const job of validJobs) {
      const toolId = job.config.tool || '__none__'
      if (!toolGroupMap.has(toolId)) {
        const group: GCodeJob[] = []
        toolGroupMap.set(toolId, group)
        toolGroups.push({ toolId, jobs: group })
      }
      toolGroupMap.get(toolId)!.push(job)
    }

    const uniqueTools = toolGroups.filter(g => g.toolId !== '__none__').length

    // Program header
    lines.push('; ====================================')
    lines.push(`; G-CODE PROGRAM`)
    lines.push(`; Elements: ${validJobs.length}`)
    lines.push(`; Tool groups: ${toolGroups.length}`)
    lines.push('; ====================================')
    lines.push('')
    lines.push('G90 ; Absolute positioning')
    lines.push('G21 ; Millimeters')
    lines.push('')

    let toolNumber = 0
    let isFirstGroup = true

    for (const group of toolGroups) {
      toolNumber++
      const firstJob = group.jobs[0]
      const isCNC = firstJob.config.operationType === 'cnc'
      const isLaser = firstJob.config.operationType === 'laser'

      // Tool change header (skip for first tool or no-tool)
      if (!isFirstGroup || (uniqueTools > 0 && group.toolId !== '__none__')) {
        if (!isFirstGroup) {
          // Stop current tool before changing
          if (isCNC) {
            lines.push('M5 ; Spindle OFF')
          } else if (isLaser) {
            lines.push('M5 S0 ; Laser OFF')
          }
          lines.push(`G0 Z${SAFE_Z} ; Safe height`)
          lines.push('')
        }

        if (group.toolId !== '__none__') {
          lines.push('; ====================================')
          lines.push(`; TOOL ${toolNumber}: ${this.getToolComment(firstJob.config)}`)
          lines.push('; ====================================')
          lines.push(`M6 T${toolNumber} ; Tool change`)
          lines.push('')
        }
      }

      // Tool setup
      if (isCNC) {
        const rpm = parseFloat(String(firstJob.config.spindleRPM))
        lines.push(`M3 S${rpm} ; Spindle ON`)
        lines.push('G4 P2 ; Dwell for spindle startup')
        lines.push(`G0 Z${SAFE_Z} ; Safe height`)
        lines.push('')
      }

      // Process each job in this tool group
      for (const job of group.jobs) {
        const cfg = job.config
        const opType = cfg.operationType
        const workDesc = opType === 'cnc' ? cfg.workType : (opType === 'laser' ? cfg.laserMode : opType)

        lines.push('; ------------------------------------')
        lines.push(`; Element: ${job.elementName} (${workDesc})`)
        lines.push('; ------------------------------------')

        if (opType === 'cnc') {
          lines.push(...await this.emitCNCBody(job.paths, cfg))
        } else if (opType === 'laser') {
          lines.push(...this.emitLaserBody(job.paths, cfg))
        } else if (opType === 'plotter' || opType === 'pencil') {
          lines.push(...this.emitPlotterBody(job.paths, cfg))
        }

        lines.push('')
      }

      isFirstGroup = false
    }

    // Program footer
    lines.push('; ====================================')
    lines.push(`G0 Z${FINAL_RETRACT_Z} ; Final retract`)
    lines.push('M5 ; All OFF')
    lines.push('G0 X0 Y0 ; Return to origin')
    lines.push('M2 ; Program end')

    return lines.join('\n')
  }

  /**
   * Legacy: generate from flat paths with single global config
   */
  async generate(
    paths: GCodePath[],
    config: GlobalConfig,
    operationType: string,
    rasterData?: RasterData | null,
  ): Promise<string> {
    // Wrap in a single job and delegate
    const job: GCodeJob = {
      elementId: '__legacy__',
      elementName: 'Design',
      config: { ...config, operationType: operationType as GlobalConfig['operationType'] },
      paths,
    }
    return this.generateFromJobs([job], rasterData)
  }

  // ============================================
  // CNC Body (no header/footer, just passes)
  // ============================================

  private async emitCNCBody(paths: GCodePath[], config: GlobalConfig): Promise<string[]> {
    const lines: string[] = []
    const depth = Math.abs(parseFloat(String(config.depth)))
    const depthStep = parseFloat(String(config.depthStep))
    const toolRadius = parseFloat(String(config.toolDiameter)) / 2
    const toolDiameter = parseFloat(String(config.toolDiameter))
    const feedRate = parseFloat(String(config.feedRate))
    const plungeRate = parseFloat(String(config.plungeRate))
    const workType = config.workType
    const stepover = config.stepover ?? 0.5

    const numPasses = Math.ceil(depth / depthStep)

    lines.push(`; Tool: ${toolDiameter}mm | Depth: -${depth}mm (${depthStep}mm steps, ${numPasses} passes)`)
    lines.push(`; Feed: ${feedRate} | Plunge: ${plungeRate}`)
    if (workType === 'pocket') {
      lines.push(`; Stepover: ${Math.round(stepover * 100)}% (${(toolDiameter * stepover).toFixed(2)}mm)`)
    }

    if (workType === 'pocket') {
      await this.generatePocketGCode(paths, lines, {
        depth, depthStep, numPasses, toolRadius, stepover, feedRate, plungeRate,
      })
    } else {
      await this.generateContourGCode(paths, lines, {
        workType, depth, depthStep, numPasses, toolRadius, feedRate, plungeRate,
        tabsEnabled: config.tabsEnabled,
        tabWidth: config.tabWidth,
        tabHeight: config.tabHeight,
        tabCount: config.tabCount,
      })
    }

    return lines
  }

  private async generateContourGCode(
    paths: GCodePath[],
    lines: string[],
    opts: {
      workType: string
      depth: number
      depthStep: number
      numPasses: number
      toolRadius: number
      feedRate: number
      plungeRate: number
      tabsEnabled?: boolean
      tabWidth?: number
      tabHeight?: number
      tabCount?: number
    }
  ) {
    const processedPaths: { points: Point2D[]; closed: boolean }[] = []

    for (const path of paths) {
      if (opts.workType === 'outline' || !path.closed) {
        processedPaths.push({ points: path.points, closed: path.closed })
      } else if (opts.workType === 'inside') {
        const offset = -opts.toolRadius
        const result = await offsetPolygon(path.points, offset, true, 'round')
        if (result.length === 0) {
          lines.push(`; WARNING: Shape too small for tool (inside offset failed)`)
          continue
        }
        for (const contour of result) {
          processedPaths.push({ points: contour, closed: true })
        }
      } else if (opts.workType === 'outside') {
        const offset = opts.toolRadius
        const result = await offsetPolygon(path.points, offset, true, 'round')
        for (const contour of result) {
          processedPaths.push({ points: contour, closed: true })
        }
      }
    }

    const orderedPoints = orderPaths(processedPaths.map(p => p.points))
    const orderedPaths = orderedPoints.map((pts, i) => ({
      points: pts,
      closed: processedPaths[i]?.closed ?? false,
    }))

    const useTabs = opts.tabsEnabled && (opts.tabCount ?? 0) > 0

    if (useTabs) {
      lines.push(`; Tabs: ${opts.tabCount} x ${opts.tabWidth}mm (height: ${opts.tabHeight}mm)`)
    }

    for (let pass = 1; pass <= opts.numPasses; pass++) {
      const currentDepth = -Math.min(opts.depth, opts.depthStep * pass)
      const isLastPass = pass === opts.numPasses

      lines.push(`; Pass ${pass}/${opts.numPasses} Z${currentDepth.toFixed(3)}${isLastPass && useTabs ? ' (with tabs)' : ''}`)

      for (let idx = 0; idx < orderedPaths.length; idx++) {
        const path = orderedPaths[idx]
        if (path.points.length === 0) continue

        if (useTabs && isLastPass && path.closed) {
          this.emitPathGCodeWithTabs(
            lines, path.points, currentDepth, opts.feedRate, opts.plungeRate,
            opts.tabHeight ?? 1, opts.tabWidth ?? 5, opts.tabCount ?? 4,
          )
        } else {
          this.emitPathGCode(lines, path.points, path.closed, currentDepth, opts.feedRate, opts.plungeRate)
        }
      }
    }
  }

  private async generatePocketGCode(
    paths: GCodePath[],
    lines: string[],
    opts: {
      depth: number
      depthStep: number
      numPasses: number
      toolRadius: number
      stepover: number
      feedRate: number
      plungeRate: number
    }
  ) {
    const pocketData: {
      roughing: Point2D[][]
      finishing: Point2D[]
      originalIdx: number
    }[] = []

    let openPathCount = 0

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]

      if (!path.closed) {
        openPathCount++
        continue
      }

      if (path.points.length < 3) continue

      const pocket = await generatePocketContours(path.points, opts.toolRadius, opts.stepover)

      if (pocket.roughing.length === 0 && pocket.finishing.length === 0) {
        lines.push(`; WARNING: Shape ${i + 1} too small for pocket with tool radius ${opts.toolRadius}mm`)
        continue
      }

      pocketData.push({ ...pocket, originalIdx: i })
    }

    if (openPathCount > 0) {
      lines.push(`; NOTE: ${openPathCount} open path(s) skipped (pocket only applies to closed shapes)`)
    }

    if (pocketData.length === 0) {
      lines.push('; WARNING: No valid pocket shapes found')
      return
    }

    for (let pass = 1; pass <= opts.numPasses; pass++) {
      const currentDepth = -Math.min(opts.depth, opts.depthStep * pass)

      lines.push(`; Pass ${pass}/${opts.numPasses} Z${currentDepth.toFixed(3)}`)

      for (const pocket of pocketData) {
        if (pocket.roughing.length > 0) {
          const orderedRoughing = orderPaths(pocket.roughing)
          for (const contour of orderedRoughing) {
            if (contour.length === 0) continue
            this.emitPathGCode(lines, contour, true, currentDepth, opts.feedRate, opts.plungeRate)
          }
        }

        if (pocket.finishing.length > 0) {
          lines.push('; Finishing pass')
          this.emitPathGCode(lines, pocket.finishing, true, currentDepth, opts.feedRate, opts.plungeRate)
        }
      }
    }
  }

  private emitPathGCode(
    lines: string[],
    points: Point2D[],
    closed: boolean,
    depth: number,
    feedRate: number,
    plungeRate: number,
  ) {
    if (points.length === 0) return

    const start = points[0]
    lines.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`)
    lines.push(`G1 Z${depth.toFixed(3)} F${plungeRate}`)

    for (let i = 1; i < points.length; i++) {
      const pt = points[i]
      lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)

      const prev = points[i - 1]
      const dist = this.distance(prev, pt)
      this.totalDistance += dist
      this.totalTime += (dist / feedRate) * 60
    }

    if (closed && points.length > 2) {
      lines.push(`G1 X${start.x.toFixed(3)} Y${start.y.toFixed(3)} F${feedRate}`)
      const last = points[points.length - 1]
      const dist = this.distance(last, start)
      this.totalDistance += dist
      this.totalTime += (dist / feedRate) * 60
    }

    lines.push(`G0 Z${SAFE_Z}`)
  }

  /**
   * Emit path G-code with tabs (bridges) on the last pass.
   * Tabs are evenly distributed along the perimeter, raising Z to keep material.
   */
  private emitPathGCodeWithTabs(
    lines: string[],
    points: Point2D[],
    depth: number,
    feedRate: number,
    plungeRate: number,
    tabHeight: number,
    tabWidth: number,
    tabCount: number,
  ) {
    if (points.length < 2) return

    // Build closed loop
    const loop = [...points, points[0]]

    // Calculate cumulative distances
    const cumDist: number[] = [0]
    for (let i = 1; i < loop.length; i++) {
      cumDist.push(cumDist[i - 1] + this.distance(loop[i - 1], loop[i]))
    }
    const perimeter = cumDist[cumDist.length - 1]
    if (perimeter === 0) return

    // Tab center positions (evenly spaced)
    const tabSpacing = perimeter / tabCount
    const tabCenters: number[] = []
    for (let i = 0; i < tabCount; i++) {
      tabCenters.push(tabSpacing / 2 + tabSpacing * i)
    }

    // Enrich path: insert interpolated points at tab entry/exit boundaries
    interface EnrichedPt { x: number; y: number; dist: number }
    const enriched: EnrichedPt[] = [{ ...loop[0], dist: 0 }]

    for (let i = 1; i < loop.length; i++) {
      const segStart = cumDist[i - 1]
      const segEnd = cumDist[i]
      const segLen = segEnd - segStart
      if (segLen < 0.001) continue

      // Find tab boundaries within this segment
      const boundaries: number[] = []
      const halfW = tabWidth / 2
      for (const center of tabCenters) {
        for (const b of [center - halfW, center + halfW]) {
          let nb = b
          while (nb < 0) nb += perimeter
          while (nb > perimeter) nb -= perimeter
          if (nb > segStart + 0.01 && nb < segEnd - 0.01) {
            boundaries.push(nb)
          }
        }
      }
      boundaries.sort((a, b) => a - b)

      for (const b of boundaries) {
        const t = (b - segStart) / segLen
        enriched.push({
          x: loop[i - 1].x + (loop[i].x - loop[i - 1].x) * t,
          y: loop[i - 1].y + (loop[i].y - loop[i - 1].y) * t,
          dist: b,
        })
      }

      enriched.push({ ...loop[i], dist: segEnd })
    }

    // Check if a distance is inside a tab
    const tabDepth = depth + tabHeight
    const isInTab = (d: number): boolean => {
      const halfW = tabWidth / 2
      for (const center of tabCenters) {
        if (Math.abs(d - center) < halfW) return true
        if (Math.abs(d - center + perimeter) < halfW) return true
        if (Math.abs(d - center - perimeter) < halfW) return true
      }
      return false
    }

    // Emit G-code with Z transitions at tab boundaries
    const start = enriched[0]
    lines.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`)

    let inTab = isInTab(0)
    let currentZ = inTab ? tabDepth : depth
    lines.push(`G1 Z${currentZ.toFixed(3)} F${plungeRate}`)

    for (let i = 1; i < enriched.length; i++) {
      const pt = enriched[i]
      const midDist = (enriched[i - 1].dist + pt.dist) / 2
      const nowInTab = isInTab(midDist)

      lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)

      if (nowInTab !== inTab) {
        inTab = nowInTab
        currentZ = inTab ? tabDepth : depth
        lines.push(`G1 Z${currentZ.toFixed(3)} F${plungeRate}`)
      }

      const prev = enriched[i - 1]
      const dist = this.distance(prev, pt)
      this.totalDistance += dist
      this.totalTime += (dist / feedRate) * 60
    }

    lines.push(`G0 Z${SAFE_Z}`)
  }

  // ============================================
  // Laser Body
  // ============================================

  private emitLaserBody(paths: GCodePath[], config: GlobalConfig): string[] {
    const lines: string[] = []
    const feedRate = parseFloat(String(config.feedRate))
    const laserPower = parseFloat(String(config.laserPower))
    const laserS = Math.round((laserPower / 100) * 1000)
    const passes = Math.max(1, config.passes || 1)
    const laserMode = config.laserMode || 'cut'
    const dynamic = config.laserDynamic ?? false
    const laserCmd = dynamic ? 'M4' : 'M3'
    const overscan = config.overscan || 0

    lines.push(`; Power: ${laserPower}% (S${laserS}) | ${laserCmd} | Feed: ${feedRate}`)

    for (let pass = 1; pass <= passes; pass++) {
      if (passes > 1) {
        lines.push(`; Pass ${pass}/${passes}`)
      }

      if (laserMode === 'fill') {
        this.generateLaserFill(paths, lines, config, laserS, laserCmd, feedRate, overscan)
      } else {
        this.generateLaserContour(paths, lines, laserS, laserCmd, feedRate)
      }
    }

    lines.push('M5 S0 ; Laser OFF')

    return lines
  }

  private generateLaserContour(
    paths: GCodePath[],
    lines: string[],
    laserS: number,
    laserCmd: string,
    feedRate: number,
  ) {
    paths.forEach((path, pathIndex) => {
      if (path.points.length === 0) return

      const startPoint = path.points[0]
      lines.push('M5 S0')
      lines.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)}`)
      lines.push(`${laserCmd} S${laserS}`)

      for (let i = 1; i < path.points.length; i++) {
        const pt = path.points[i]
        lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)

        const prevPt = path.points[i - 1]
        const dist = this.distance(prevPt, pt)
        this.totalDistance += dist
        this.totalTime += (dist / feedRate) * 60
      }

      if (path.closed && path.points.length > 2) {
        lines.push(`G1 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} F${feedRate}`)
        const last = path.points[path.points.length - 1]
        const dist = this.distance(last, startPoint)
        this.totalDistance += dist
        this.totalTime += (dist / feedRate) * 60
      }

      lines.push('M5 S0')
    })
  }

  private generateLaserFill(
    paths: GCodePath[],
    lines: string[],
    config: GlobalConfig,
    laserS: number,
    laserCmd: string,
    feedRate: number,
    overscan: number,
  ) {
    const fillAngle = config.fillAngle ?? 0
    const fillSpacing = config.fillSpacing ?? 0.5
    const bidirectional = config.fillBidirectional !== false

    paths.forEach((path) => {
      if (!path.closed || path.points.length < 3) return

      const hatchSegments = generateHatchLines(path.points, fillSpacing, fillAngle, bidirectional)
      if (hatchSegments.length === 0) return

      for (const seg of hatchSegments) {
        if (overscan > 0) {
          const dx = seg.end.x - seg.start.x
          const dy = seg.end.y - seg.start.y
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len === 0) continue
          const ux = dx / len
          const uy = dy / len

          const osStartX = seg.start.x - ux * overscan
          const osStartY = seg.start.y - uy * overscan
          const osEndX = seg.end.x + ux * overscan
          const osEndY = seg.end.y + uy * overscan

          lines.push('M5 S0')
          lines.push(`G0 X${osStartX.toFixed(3)} Y${osStartY.toFixed(3)}`)
          lines.push(`G1 X${seg.start.x.toFixed(3)} Y${seg.start.y.toFixed(3)} F${feedRate}`)
          lines.push(`${laserCmd} S${laserS}`)
          lines.push(`G1 X${seg.end.x.toFixed(3)} Y${seg.end.y.toFixed(3)} F${feedRate}`)
          lines.push('M5 S0')
          lines.push(`G1 X${osEndX.toFixed(3)} Y${osEndY.toFixed(3)} F${feedRate}`)

          const dist = this.distance(seg.start, seg.end)
          this.totalDistance += dist + overscan * 2
          this.totalTime += ((dist + overscan * 2) / feedRate) * 60
        } else {
          lines.push('M5 S0')
          lines.push(`G0 X${seg.start.x.toFixed(3)} Y${seg.start.y.toFixed(3)}`)
          lines.push(`${laserCmd} S${laserS}`)
          lines.push(`G1 X${seg.end.x.toFixed(3)} Y${seg.end.y.toFixed(3)} F${feedRate}`)

          const dist = this.distance(seg.start, seg.end)
          this.totalDistance += dist
          this.totalTime += (dist / feedRate) * 60
        }
      }

      lines.push('M5 S0')
    })
  }

  // ============================================
  // Plotter/Pencil Body
  // ============================================

  private emitPlotterBody(paths: GCodePath[], config: GlobalConfig): string[] {
    const lines: string[] = []
    const feedRate = parseFloat(String(config.speed || config.feedRate || 1000))
    const penDown = config.operationType === 'pencil'
      ? parseFloat(String(config.pressureZ || -1))
      : -1

    lines.push(`; Speed: ${feedRate} | Z down: ${penDown}`)

    for (const path of paths) {
      if (path.points.length === 0) continue

      const start = path.points[0]
      lines.push(`G0 Z${SAFE_Z}`)
      lines.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`)
      lines.push(`G1 Z${penDown.toFixed(3)} F${feedRate}`)

      for (let i = 1; i < path.points.length; i++) {
        const pt = path.points[i]
        lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)

        const prev = path.points[i - 1]
        const dist = this.distance(prev, pt)
        this.totalDistance += dist
        this.totalTime += (dist / feedRate) * 60
      }

      if (path.closed && path.points.length > 2) {
        lines.push(`G1 X${start.x.toFixed(3)} Y${start.y.toFixed(3)} F${feedRate}`)
        const last = path.points[path.points.length - 1]
        const dist = this.distance(last, start)
        this.totalDistance += dist
        this.totalTime += (dist / feedRate) * 60
      }

      lines.push(`G0 Z${SAFE_Z}`)
    }

    return lines
  }

  // ============================================
  // Laser Raster (unchanged, self-contained)
  // ============================================

  private async generateLaserRaster(raster: RasterData, config: GlobalConfig): Promise<string[]> {
    const { tauriInvoke } = await import('./tauri')
    const pixels: number[] = await tauriInvoke<number[]>('read_raster_pixels', {
      pixelsPath: raster.pixels_path,
    })

    const lines: string[] = []
    const feedRate = parseFloat(String(config.feedRate))
    const maxPower = parseFloat(String(config.laserPower))
    const maxS = Math.round((maxPower / 100) * 1000)
    const dynamic = config.laserDynamic ?? false
    const laserCmd = dynamic ? 'M4' : 'M3'
    const passes = Math.max(1, config.passes || 1)
    const overscan = config.overscan || 0
    const bidirectional = config.rasterBidirectional !== false
    const pixelMm = raster.pixel_size_mm
    const totalWidthMm = raster.width * pixelMm
    const totalHeightMm = raster.height * pixelMm

    lines.push('; ====================================')
    lines.push('; LASER RASTER ENGRAVE')
    lines.push(`; Image: ${raster.width}x${raster.height} px`)
    lines.push(`; Physical size: ${totalWidthMm.toFixed(1)}x${totalHeightMm.toFixed(1)} mm`)
    lines.push(`; Pixel size: ${pixelMm.toFixed(4)} mm (${(25.4 / pixelMm).toFixed(0)} DPI)`)
    lines.push(`; Max power: ${maxPower}% (S${maxS})`)
    lines.push(`; Feed rate: ${feedRate} mm/min`)
    lines.push(`; Laser command: ${laserCmd} (${dynamic ? 'dynamic' : 'constant'})`)
    lines.push(`; Bidirectional: ${bidirectional ? 'yes' : 'no'}`)
    lines.push(`; Passes: ${passes}`)
    if (overscan > 0) lines.push(`; Overscan: ${overscan}mm`)
    lines.push('; ====================================')
    lines.push('')
    lines.push('G90 ; Absolute positioning')
    lines.push('G21 ; Millimeters')
    lines.push('')

    for (let pass = 1; pass <= passes; pass++) {
      if (passes > 1) {
        lines.push(`; Pass ${pass}/${passes}`)
      }

      for (let row = 0; row < raster.height; row++) {
        const y = (raster.height - 1 - row) * pixelMm
        const leftToRight = !bidirectional || row % 2 === 0

        const rowStart = row * raster.width
        let firstActive = -1
        let lastActive = -1
        for (let col = 0; col < raster.width; col++) {
          if (pixels[rowStart + col] < 255) {
            if (firstActive === -1) firstActive = col
            lastActive = col
          }
        }

        if (firstActive === -1) continue

        if (leftToRight) {
          const startX = firstActive * pixelMm - overscan
          const endX = (lastActive + 1) * pixelMm + overscan

          lines.push('M5 S0')
          lines.push(`G0 X${startX.toFixed(3)} Y${y.toFixed(3)}`)

          if (overscan > 0) {
            lines.push(`G1 X${(firstActive * pixelMm).toFixed(3)} Y${y.toFixed(3)} F${feedRate}`)
          }

          let currentS = -1
          for (let col = firstActive; col <= lastActive; col++) {
            const pixel = pixels[rowStart + col]
            const s = Math.round(((255 - pixel) / 255) * maxS)
            if (s !== currentS) {
              lines.push(`${laserCmd} S${s}`)
              currentS = s
            }
            const x = (col + 1) * pixelMm
            lines.push(`G1 X${x.toFixed(3)} F${feedRate}`)
          }

          lines.push('M5 S0')
          if (overscan > 0) {
            lines.push(`G1 X${endX.toFixed(3)} F${feedRate}`)
          }

          const rowDist = (lastActive - firstActive + 1) * pixelMm + overscan * 2
          this.totalDistance += rowDist
          this.totalTime += (rowDist / feedRate) * 60
        } else {
          const startX = (lastActive + 1) * pixelMm + overscan
          const endX = firstActive * pixelMm - overscan

          lines.push('M5 S0')
          lines.push(`G0 X${startX.toFixed(3)} Y${y.toFixed(3)}`)

          if (overscan > 0) {
            lines.push(`G1 X${((lastActive + 1) * pixelMm).toFixed(3)} Y${y.toFixed(3)} F${feedRate}`)
          }

          let currentS = -1
          for (let col = lastActive; col >= firstActive; col--) {
            const pixel = pixels[rowStart + col]
            const s = Math.round(((255 - pixel) / 255) * maxS)
            if (s !== currentS) {
              lines.push(`${laserCmd} S${s}`)
              currentS = s
            }
            const x = col * pixelMm
            lines.push(`G1 X${x.toFixed(3)} F${feedRate}`)
          }

          lines.push('M5 S0')
          if (overscan > 0) {
            lines.push(`G1 X${endX.toFixed(3)} F${feedRate}`)
          }

          const rowDist = (lastActive - firstActive + 1) * pixelMm + overscan * 2
          this.totalDistance += rowDist
          this.totalTime += (rowDist / feedRate) * 60
        }
      }
    }

    lines.push('')
    lines.push('M5 S0 ; Laser OFF (safety)')
    lines.push('G0 X0 Y0 ; Return to origin')
    lines.push('M2 ; Program end')

    return lines
  }

  // ============================================
  // Helpers
  // ============================================

  private getToolComment(config: GlobalConfig): string {
    const diam = config.toolDiameter ? `${config.toolDiameter}mm` : ''
    if (config.operationType === 'cnc') {
      return diam ? `CNC ${diam}` : 'CNC'
    }
    if (config.operationType === 'laser') {
      return `Laser ${config.laserPower}%`
    }
    return config.operationType
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
