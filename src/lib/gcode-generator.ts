import type { Point2D, GCodePath, GCodeJob, GlobalConfig, RasterData, ColorMapping } from './types'
import { offsetPolygon, generatePocketContours, orderPaths, orderPathsInsideFirst, generateHatchLines } from './geometry'

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
          const isPlotter = firstJob.config.operationType === 'plotter' || firstJob.config.operationType === 'pencil'
          // Stop current tool before changing
          if (isCNC) {
            lines.push('M5 ; Spindle OFF')
          } else if (isLaser) {
            lines.push('M5 S0 ; Laser OFF')
          }
          lines.push(`G0 Z${SAFE_Z} ; Safe height`)
          if (isPlotter) {
            lines.push('M0 ; Pause for pen/tool change')
          }
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
        // Tool length offset (G43)
        const tlo = firstJob.config.toolLengthOffset || 0
        if (tlo !== 0) {
          lines.push(`G43.1 Z${tlo.toFixed(3)} ; Tool length offset`)
        }
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
          lines.push(...await this.emitLaserBody(job.paths, cfg, job.colorMappings))
        } else if (opType === 'plotter' || opType === 'pencil') {
          lines.push(...await this.emitPlotterBody(job.paths, cfg))
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
    const depthStep = Math.max(0.1, parseFloat(String(config.depthStep)))
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

    if (workType === 'drill') {
      // Canned drilling cycles: G81 (simple) or G83 (peck)
      const peck = config.drillPeckDepth || 0
      const retract = config.drillRetract || 2
      const isPeck = peck > 0

      lines.push(`; Drill: ${isPeck ? `G83 peck ${peck}mm` : 'G81 simple'} | Depth: -${depth}mm | Retract: ${retract}mm`)

      // Collect drill points (use first point of each path as hole center)
      const holes = paths.map(p => p.points[0]).filter(Boolean)
      if (holes.length === 0) {
        lines.push('; WARNING: No drill points found')
      } else {
        lines.push(`; ${holes.length} holes`)
        lines.push(`G0 Z${SAFE_Z}`)

        if (isPeck) {
          // G83 peck drill cycle
          const firstHole = holes[0]
          lines.push(`G83 X${firstHole.x.toFixed(3)} Y${firstHole.y.toFixed(3)} Z${(-depth).toFixed(3)} R${retract.toFixed(3)} Q${peck.toFixed(3)} F${plungeRate}`)
          for (let i = 1; i < holes.length; i++) {
            lines.push(`X${holes[i].x.toFixed(3)} Y${holes[i].y.toFixed(3)}`)
          }
        } else {
          // G81 simple drill cycle
          const firstHole = holes[0]
          lines.push(`G81 X${firstHole.x.toFixed(3)} Y${firstHole.y.toFixed(3)} Z${(-depth).toFixed(3)} R${retract.toFixed(3)} F${plungeRate}`)
          for (let i = 1; i < holes.length; i++) {
            lines.push(`X${holes[i].x.toFixed(3)} Y${holes[i].y.toFixed(3)}`)
          }
        }
        lines.push('G80 ; Cancel canned cycle')
      }
    } else if (workType === 'chamfer') {
      // Chamfer: V-bit offset at fixed depth for edge beveling
      const angle = config.vcarveAngle || 90
      const halfAngle = (angle / 2) * (Math.PI / 180)
      const chamferOffset = depth * Math.tan(halfAngle)

      lines.push(`; Chamfer: ${angle}° V-bit | Depth: -${depth}mm | Offset: ${chamferOffset.toFixed(3)}mm`)

      for (const path of paths) {
        if (!path.closed || path.points.length < 3) continue
        const contours = await offsetPolygon(path.points, -chamferOffset, true, 'round')
        for (const contour of contours) {
          this.emitPathGCode(lines, contour, true, -depth, feedRate, plungeRate)
        }
      }
    } else if (workType === 'vcarve') {
      const { generateVCarveToolpath, emitVCarveGCode } = await import('./vcarve')
      const angle = config.vcarveAngle || 90
      const maxD = config.vcarveMaxDepth || depth
      const step = config.vcarveStepSize || 0.2
      const flatD = config.vcarveFlatDepth || 0

      lines.push(`; V-Carve: ${angle}° bit | Max depth: ${maxD}mm | Step: ${step}mm`)
      if (flatD > 0) lines.push(`; Flat-bottom: ${flatD}mm`)

      for (const path of paths) {
        if (!path.closed || path.points.length < 3) {
          lines.push('; WARNING: V-carve requires closed paths, skipping open path')
          continue
        }
        const passes = await generateVCarveToolpath(path.points, {
          vbitAngle: angle,
          maxDepth: maxD,
          stepSize: step,
          flatDepth: flatD,
        })
        lines.push(...emitVCarveGCode(passes, feedRate, plungeRate))
      }
    } else if (workType === 'pocket') {
      await this.generatePocketGCode(paths, lines, {
        depth, depthStep, numPasses, toolRadius, stepover, feedRate, plungeRate,
      })

      // Rest machining: second pocket pass with smaller tool in corners
      if (config.restMachiningEnabled && config.restToolDiameter > 0 && config.restToolDiameter < toolDiameter) {
        const restRadius = config.restToolDiameter / 2
        const restStepover = stepover
        lines.push('')
        lines.push('; ---- REST MACHINING ----')
        lines.push(`; Finishing tool: ${config.restToolDiameter}mm`)
        lines.push('M5 ; Spindle OFF for tool change')
        lines.push(`G0 Z${SAFE_Z}`)
        lines.push('M0 ; Pause for tool change')
        lines.push(`M3 S${parseFloat(String(config.spindleRPM))} ; Spindle ON`)
        lines.push('G4 P2')
        lines.push('')

        await this.generatePocketGCode(paths, lines, {
          depth, depthStep, numPasses, toolRadius: restRadius, stepover: restStepover,
          feedRate: feedRate * 0.8, plungeRate: plungeRate * 0.8,
        })
      }
    } else {
      await this.generateContourGCode(paths, lines, {
        workType, depth, depthStep, numPasses, toolRadius, feedRate, plungeRate,
        tabsEnabled: config.tabsEnabled,
        tabWidth: config.tabWidth,
        tabHeight: config.tabHeight,
        tabCount: config.tabCount,
        rampEnabled: config.rampEnabled,
        rampAngle: config.rampAngle,
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
      rampEnabled?: boolean
      rampAngle?: number
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

    const useRamp = opts.rampEnabled && (opts.rampAngle ?? 0) > 0

    if (useTabs) {
      lines.push(`; Tabs: ${opts.tabCount} x ${opts.tabWidth}mm (height: ${opts.tabHeight}mm)`)
    }
    if (useRamp) {
      lines.push(`; Ramp entry: ${opts.rampAngle}°`)
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
          this.emitPathGCode(lines, path.points, path.closed, currentDepth, opts.feedRate, opts.plungeRate,
            useRamp ? opts.rampAngle : undefined)
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
    rampAngle?: number,
  ) {
    if (points.length === 0) return

    const start = points[0]
    lines.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`)

    // Ramp entry: descend gradually along the first segment(s) instead of plunge
    if (rampAngle && rampAngle > 0 && points.length >= 2) {
      const zDrop = Math.abs(depth) + SAFE_Z  // Total Z to descend (from safe to depth)
      const rampRad = (rampAngle * Math.PI) / 180
      const rampLength = zDrop / Math.tan(rampRad)  // Horizontal distance needed

      // Move to safe Z first, then ramp down along path segments
      lines.push(`G0 Z${SAFE_Z}`)
      let remaining = rampLength
      let currentZ = 0  // Start from Z0 level
      let ptIdx = 0

      while (remaining > 0 && ptIdx < points.length - 1) {
        const from = points[ptIdx]
        const to = points[ptIdx + 1]
        const segLen = this.distance(from, to)

        if (segLen <= 0.001) {
          ptIdx++
          continue
        }

        if (segLen >= remaining) {
          // Partial segment — interpolate end point
          const t = remaining / segLen
          const interpX = from.x + (to.x - from.x) * t
          const interpY = from.y + (to.y - from.y) * t
          currentZ = depth
          lines.push(`G1 X${interpX.toFixed(3)} Y${interpY.toFixed(3)} Z${currentZ.toFixed(3)} F${Math.min(feedRate, plungeRate * 2)}`)
          this.totalDistance += remaining
          this.totalTime += (remaining / feedRate) * 60
          remaining = 0
        } else {
          // Full segment
          const fraction = segLen / rampLength
          currentZ = Math.max(depth, currentZ - fraction * zDrop)
          lines.push(`G1 X${to.x.toFixed(3)} Y${to.y.toFixed(3)} Z${currentZ.toFixed(3)} F${Math.min(feedRate, plungeRate * 2)}`)
          this.totalDistance += segLen
          this.totalTime += (segLen / feedRate) * 60
          remaining -= segLen
          ptIdx++
        }
      }

      // Ensure we're at target depth
      if (currentZ > depth) {
        lines.push(`G1 Z${depth.toFixed(3)} F${plungeRate}`)
      }

      // Continue with remaining points at depth
      for (let i = ptIdx + 1; i < points.length; i++) {
        const pt = points[i]
        lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)
        const prev = points[i - 1]
        const dist = this.distance(prev, pt)
        this.totalDistance += dist
        this.totalTime += (dist / feedRate) * 60
      }
    } else {
      // Standard plunge entry
      lines.push(`G1 Z${depth.toFixed(3)} F${plungeRate}`)

      for (let i = 1; i < points.length; i++) {
        const pt = points[i]
        lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)

        const prev = points[i - 1]
        const dist = this.distance(prev, pt)
        this.totalDistance += dist
        this.totalTime += (dist / feedRate) * 60
      }
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

  private async emitLaserBody(paths: GCodePath[], config: GlobalConfig, colorMappings?: ColorMapping[]): Promise<string[]> {
    const lines: string[] = []
    const feedRate = parseFloat(String(config.feedRate))
    const laserPower = parseFloat(String(config.laserPower))
    const laserS = Math.round((laserPower / 100) * 1000)
    const passes = Math.max(1, config.passes || 1)
    const laserMode = config.laserMode || 'cut'
    const dynamic = config.laserDynamic ?? false
    const laserCmd = dynamic ? 'M4' : 'M3'
    const overscan = config.overscan || 0
    const kerf = config.laserKerf || 0
    const focusZ = config.laserFocusZ || 0

    lines.push(`; Power: ${laserPower}% (S${laserS}) | ${laserCmd} | Feed: ${feedRate}`)
    if (focusZ !== 0) {
      lines.push(`; Focus Z: ${focusZ}mm`)
      lines.push(`G0 Z${focusZ.toFixed(3)} ; Focus height`)
    }

    // Kerf compensation: offset closed paths inward by half kerf width
    let processedPaths = paths
    if (kerf > 0 && laserMode === 'cut') {
      lines.push(`; Kerf compensation: ${kerf}mm (offset: ${(kerf / 2).toFixed(3)}mm)`)
      const compensated: GCodePath[] = []
      for (const path of paths) {
        if (path.closed && path.points.length >= 3) {
          const offset = -(kerf / 2)
          const result = await offsetPolygon(path.points, offset, true, 'round')
          if (result.length > 0) {
            for (const contour of result) {
              compensated.push({ points: contour, closed: true })
            }
          } else {
            lines.push('; WARNING: Shape too small for kerf compensation, using original')
            compensated.push(path)
          }
        } else {
          compensated.push(path)
        }
      }
      processedPaths = compensated
    }

    // Color mapping: group paths by stroke color and apply per-color settings
    const activeMappings = colorMappings?.filter(m => m.enabled) || []
    const hasColorMapping = activeMappings.length > 0 && processedPaths.some(p => p.strokeColor)

    if (hasColorMapping) {
      lines.push('; Color mapping active')
      // Group paths by color
      const colorGroups = new Map<string, GCodePath[]>()
      const unmapped: GCodePath[] = []

      for (const path of processedPaths) {
        const color = path.strokeColor?.toLowerCase()
        const mapping = color ? activeMappings.find(m => m.color.toLowerCase() === color) : undefined
        if (mapping) {
          const arr = colorGroups.get(mapping.color) || []
          arr.push(path)
          colorGroups.set(mapping.color, arr)
        } else {
          unmapped.push(path)
        }
      }

      // Process each color group with its mapping settings
      for (const mapping of activeMappings) {
        const groupPaths = colorGroups.get(mapping.color)
        if (!groupPaths || groupPaths.length === 0) continue

        const mS = Math.round((mapping.power / 100) * 1000)
        const mPasses = Math.max(1, mapping.passes)

        lines.push(`; --- ${mapping.name} (${mapping.color}) P:${mapping.power}% S:${mapping.speed} ---`)

        for (let pass = 1; pass <= mPasses; pass++) {
          if (mPasses > 1) lines.push(`; Pass ${pass}/${mPasses}`)
          if (mapping.mode === 'fill') {
            this.generateLaserFill(groupPaths, lines, { ...config, fillSpacing: config.fillSpacing }, mS, laserCmd, mapping.speed, overscan)
          } else {
            this.generateLaserContour(groupPaths, lines, mS, laserCmd, mapping.speed, true, config.laserLeadIn || 0)
          }
        }
      }

      // Process unmapped paths with default settings
      if (unmapped.length > 0) {
        lines.push('; --- Default (unmapped colors) ---')
        for (let pass = 1; pass <= passes; pass++) {
          if (passes > 1) lines.push(`; Pass ${pass}/${passes}`)
          if (laserMode === 'fill') {
            this.generateLaserFill(unmapped, lines, config, laserS, laserCmd, feedRate, overscan)
          } else {
            this.generateLaserContour(unmapped, lines, laserS, laserCmd, feedRate, true, config.laserLeadIn || 0)
          }
        }
      }
    } else {
      // Standard processing without color mapping
      for (let pass = 1; pass <= passes; pass++) {
        if (passes > 1) {
          lines.push(`; Pass ${pass}/${passes}`)
        }

        if (laserMode === 'fill') {
          this.generateLaserFill(processedPaths, lines, config, laserS, laserCmd, feedRate, overscan)
        } else {
          this.generateLaserContour(processedPaths, lines, laserS, laserCmd, feedRate, true, config.laserLeadIn || 0)
        }
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
    cornerReduction: boolean = true,
    leadInDist: number = 0,
  ) {
    // Inside-first ordering: cut inner shapes before outer contours
    const ordered = orderPathsInsideFirst(paths)

    ordered.forEach((path) => {
      if (path.points.length === 0) return

      const startPoint = path.points[0]

      // Lead-in: for closed paths, approach from outside with a small arc
      if (leadInDist > 0 && path.closed && path.points.length >= 3) {
        // Calculate perpendicular offset at start point for lead-in position
        const nextPt = path.points[1]
        const dx = nextPt.x - startPoint.x
        const dy = nextPt.y - startPoint.y
        const segLen = Math.sqrt(dx * dx + dy * dy)
        if (segLen > 0.001) {
          // Perpendicular direction (outward from path)
          const px = -dy / segLen * leadInDist
          const py = dx / segLen * leadInDist
          const leadX = startPoint.x + px
          const leadY = startPoint.y + py

          lines.push('M5 S0')
          lines.push(`G0 X${leadX.toFixed(3)} Y${leadY.toFixed(3)}`)
          lines.push(`${laserCmd} S${laserS}`)
          // Arc to start point (G2 = CW arc using I,J relative offsets)
          const iOff = startPoint.x - leadX
          const jOff = startPoint.y - leadY
          lines.push(`G2 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} I${(iOff/2).toFixed(3)} J${(jOff/2).toFixed(3)} F${feedRate}`)
        } else {
          lines.push('M5 S0')
          lines.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)}`)
          lines.push(`${laserCmd} S${laserS}`)
        }
      } else {
        lines.push('M5 S0')
        lines.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)}`)
        lines.push(`${laserCmd} S${laserS}`)
      }

      for (let i = 1; i < path.points.length; i++) {
        const pt = path.points[i]
        const prevPt = path.points[i - 1]

        // Corner power reduction: reduce power at sharp angles where machine decelerates
        if (cornerReduction && i >= 2) {
          const pp = path.points[i - 2]
          const angle = this.angleBetween(pp, prevPt, pt)
          if (angle < 150) {
            // Scale power: 180° (straight) = full, 0° (U-turn) = 40%
            const factor = 0.4 + 0.6 * (angle / 180)
            const reducedS = Math.round(laserS * factor)
            lines.push(`${laserCmd} S${reducedS}`)
            lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)
            lines.push(`${laserCmd} S${laserS}`)
          } else {
            lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)
          }
        } else {
          lines.push(`G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${feedRate}`)
        }

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

  private async emitPlotterBody(paths: GCodePath[], config: GlobalConfig): Promise<string[]> {
    const lines: string[] = []
    const feedRate = parseFloat(String(config.speed || config.feedRate || 1000))
    const penDown = parseFloat(String(config.pressureZ || -1))
    const passes = Math.max(1, config.passes || 1)
    const bladeOffset = config.bladeOffset || 0

    lines.push(`; Speed: ${feedRate} | Z down: ${penDown} | Passes: ${passes}`)

    // Blade offset compensation: expand closed paths outward by blade radius
    let processedPaths = paths
    if (bladeOffset > 0) {
      lines.push(`; Blade offset: ${bladeOffset}mm`)
      const compensated: GCodePath[] = []
      for (const path of paths) {
        if (path.closed && path.points.length >= 3) {
          const result = await offsetPolygon(path.points, -bladeOffset, true, 'round')
          if (result.length > 0) {
            for (const contour of result) {
              compensated.push({ points: contour, closed: true })
            }
          } else {
            lines.push('; WARNING: Shape too small for blade offset, using original')
            compensated.push(path)
          }
        } else {
          compensated.push(path)
        }
      }
      processedPaths = compensated
    }

    // Group paths by stroke color for pen sorting (plotter)
    const colorGroups: { color: string; paths: GCodePath[] }[] = []
    const colorMap = new Map<string, GCodePath[]>()
    for (const path of processedPaths) {
      const color = path.strokeColor || '__default__'
      if (!colorMap.has(color)) {
        const arr: GCodePath[] = []
        colorMap.set(color, arr)
        colorGroups.push({ color, paths: arr })
      }
      colorMap.get(color)!.push(path)
    }

    const hasMultipleColors = colorGroups.length > 1
    if (hasMultipleColors) {
      lines.push(`; Color groups: ${colorGroups.length} (M0 pause between groups)`)
    }

    for (let pass = 1; pass <= passes; pass++) {
      if (passes > 1) {
        lines.push(`; Pass ${pass}/${passes}`)
      }

      for (let gi = 0; gi < colorGroups.length; gi++) {
        const group = colorGroups[gi]

        if (hasMultipleColors) {
          lines.push(`; --- Color group: ${group.color === '__default__' ? 'default' : group.color} (${group.paths.length} paths) ---`)
          if (gi > 0) {
            lines.push(`G0 Z${SAFE_Z}`)
            lines.push('M0 ; Pause for pen change')
          }
        }

      for (const path of group.paths) {
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
      } // end color group
    } // end passes

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

  /** Angle in degrees between vectors (p1→p2) and (p2→p3). 180 = straight, 0 = U-turn */
  private angleBetween(p1: Point2D, p2: Point2D, p3: Point2D): number {
    const v1x = p1.x - p2.x, v1y = p1.y - p2.y
    const v2x = p3.x - p2.x, v2y = p3.y - p2.y
    const dot = v1x * v2x + v1y * v2y
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y)
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y)
    if (mag1 < 0.001 || mag2 < 0.001) return 180
    const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)))
    return Math.acos(cos) * (180 / Math.PI)
  }

  getEstimates() {
    return {
      distance: this.totalDistance,
      time: this.totalTime,
    }
  }
}
