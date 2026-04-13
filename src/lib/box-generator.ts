// ============================================
// Generador de cajas con finger joints y puzzle joints
// ============================================

export interface BoxParams {
  width: number       // ancho exterior (mm)
  height: number      // alto exterior (mm)
  depth: number       // profundidad exterior (mm)
  thickness: number   // grosor del material (mm)
  fingerWidth: number // ancho aproximado de cada diente (mm)
  openTop: boolean    // sin tapa superior
  jointType: 'finger' | 'puzzle'
}

export interface PanelResult {
  name: string
  width: number   // mm
  height: number  // mm
  pathD: string   // SVG path d (mm)
}

export interface BoxResult {
  panels: PanelResult[]
  totalWidth: number
  totalHeight: number
}

interface Pt { x: number; y: number }

// ---- Helpers ----

function computeFingers(length: number, targetWidth: number): { count: number; width: number } {
  let count = Math.max(3, Math.round(length / targetWidth))
  if (count % 2 === 0) count++
  return { count, width: length / count }
}

function pointsToPathD(pts: Pt[]): string {
  if (pts.length === 0) return ''
  let d = `M ${r(pts[0].x)} ${r(pts[0].y)}`
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${r(pts[i].x)} ${r(pts[i].y)}`
  }
  return d + ' Z'
}

function r(n: number): string {
  return (Math.round(n * 1000) / 1000).toString()
}

// ---- Finger joint edge ----

function fingerEdgePts(
  sx: number, sy: number, ex: number, ey: number,
  t: number, targetFW: number, isTab: boolean,
  ms: number, me: number,
): Pt[] {
  const len = Math.hypot(ex - sx, ey - sy)
  const dx = (ex - sx) / len
  const dy = (ey - sy) / len
  // Outward normal for clockwise winding in SVG (y-down)
  const nx = dy, ny = -dx

  const jointLen = len - ms - me
  if (jointLen < targetFW * 2) return [{ x: ex, y: ey }]

  const { count, width: fw } = computeFingers(jointLen, targetFW)
  const pts: Pt[] = []
  let x = sx, y = sy

  if (ms > 0) {
    x += dx * ms; y += dy * ms
    pts.push({ x, y })
  }

  for (let i = 0; i < count; i++) {
    const feat = isTab ? (i % 2 === 0) : (i % 2 === 1)
    if (feat) {
      const s = isTab ? 1 : -1
      pts.push({ x: x + nx * t * s, y: y + ny * t * s })
      x += dx * fw; y += dy * fw
      pts.push({ x: x + nx * t * s, y: y + ny * t * s })
      pts.push({ x, y })
    } else {
      x += dx * fw; y += dy * fw
      pts.push({ x, y })
    }
  }

  if (me > 0) {
    x += dx * me; y += dy * me
    pts.push({ x, y })
  }

  return pts
}

// ---- Puzzle joint edge ----

function puzzleEdgePts(
  sx: number, sy: number, ex: number, ey: number,
  t: number, targetFW: number, isTab: boolean,
  ms: number, me: number,
): Pt[] {
  const len = Math.hypot(ex - sx, ey - sy)
  const dx = (ex - sx) / len
  const dy = (ey - sy) / len
  const nx = dy, ny = -dx

  const jointLen = len - ms - me
  if (jointLen < targetFW * 2) return [{ x: ex, y: ey }]

  const { count, width: fw } = computeFingers(jointLen, targetFW)

  // Puzzle knob proportions
  const halfNeck = Math.min(fw * 0.1, t * 0.25)
  const Rmax = (t * t + halfNeck * halfNeck) / (2 * t)
  const R = Rmax * 0.85

  if (R <= halfNeck * 1.1) {
    return fingerEdgePts(sx, sy, ex, ey, t, targetFW, isTab, ms, me)
  }

  const delta = Math.sqrt(R * R - halfNeck * halfNeck)
  const neckH = Math.max(t - delta - R, t * 0.05)
  const circCy = neckH + delta

  // Arc sweep angles
  const angleLeft = Math.atan2(-delta, -halfNeck)
  const angleRight = Math.atan2(-delta, halfNeck)
  const shortArc = angleRight - angleLeft
  const longArcCW = 2 * Math.PI - shortArc
  const numArcPts = 12

  const pts: Pt[] = []
  let x = sx, y = sy

  if (ms > 0) {
    x += dx * ms; y += dy * ms
    pts.push({ x, y })
  }

  // Start of joint zone
  const jx = x, jy = y

  for (let i = 0; i < count; i++) {
    const feat = isTab ? (i % 2 === 0) : (i % 2 === 1)
    const fsx = jx + dx * fw * i
    const fsy = jy + dy * fw * i
    const fex = jx + dx * fw * (i + 1)
    const fey = jy + dy * fw * (i + 1)
    const fcx = (fsx + fex) / 2
    const fcy = (fsy + fey) / 2

    if (feat) {
      const s = isTab ? 1 : -1
      const vX = nx * s, vY = ny * s

      // Flat before knob
      pts.push({ x: fcx - halfNeck * dx, y: fcy - halfNeck * dy })

      // Neck left edge to neckH
      pts.push({
        x: fcx - halfNeck * dx + vX * neckH,
        y: fcy - halfNeck * dy + vY * neckH,
      })

      // Arc through bulge
      for (let j = 0; j <= numArcPts; j++) {
        const a = angleLeft - longArcCW * (j / numArcPts)
        const lx = R * Math.cos(a)
        const ly = circCy + R * Math.sin(a)
        pts.push({
          x: fcx + lx * dx + ly * vX,
          y: fcy + lx * dy + ly * vY,
        })
      }

      // Neck right neckH to edge
      pts.push({
        x: fcx + halfNeck * dx + vX * neckH,
        y: fcy + halfNeck * dy + vY * neckH,
      })
      pts.push({ x: fcx + halfNeck * dx, y: fcy + halfNeck * dy })

      // Flat after knob
      pts.push({ x: fex, y: fey })
    } else {
      pts.push({ x: fex, y: fey })
    }
  }

  if (me > 0) {
    const endX = jx + dx * count * fw + dx * me
    const endY = jy + dy * count * fw + dy * me
    pts.push({ x: endX, y: endY })
  }

  return pts
}

// ---- Unified edge tracer ----

function traceEdge(
  sx: number, sy: number, ex: number, ey: number,
  t: number, fw: number,
  hasJoint: boolean, isTab: boolean,
  ms: number, me: number,
  jt: 'finger' | 'puzzle',
): Pt[] {
  if (!hasJoint) return [{ x: ex, y: ey }]
  return jt === 'finger'
    ? fingerEdgePts(sx, sy, ex, ey, t, fw, isTab, ms, me)
    : puzzleEdgePts(sx, sy, ex, ey, t, fw, isTab, ms, me)
}

// ---- Panel outline generator ----

interface EdgeCfg {
  hasJoint: boolean
  isTab: boolean
  ms: number
  me: number
}

function generatePanelOutline(
  w: number, h: number,
  top: EdgeCfg, right: EdgeCfg, bottom: EdgeCfg, left: EdgeCfg,
  t: number, fw: number, jt: 'finger' | 'puzzle',
): Pt[] {
  const pts: Pt[] = [{ x: 0, y: 0 }]

  // Top: (0,0) -> (w,0)
  pts.push(...traceEdge(0, 0, w, 0, t, fw, top.hasJoint, top.isTab, top.ms, top.me, jt))
  // Right: (w,0) -> (w,h)
  pts.push(...traceEdge(w, 0, w, h, t, fw, right.hasJoint, right.isTab, right.ms, right.me, jt))
  // Bottom: (w,h) -> (0,h)
  pts.push(...traceEdge(w, h, 0, h, t, fw, bottom.hasJoint, bottom.isTab, bottom.ms, bottom.me, jt))
  // Left: (0,h) -> (0,0)
  pts.push(...traceEdge(0, h, 0, 0, t, fw, left.hasJoint, left.isTab, left.ms, left.me, jt))

  return pts
}

// ---- Main generator ----

const GAP_MM = 5

export function generateBox(p: BoxParams): BoxResult {
  const { width: W, height: H, depth: D, thickness: t, fingerWidth: fw, openTop, jointType: jt } = p

  // Panel dimensions
  //  Front/Back: W x H (full width, overlaps sides at corners)
  //  Left/Right: (D-2t) x H (sits between front and back)
  //  Bottom/Top: (W-2t) x (D-2t) (sits inside all 4 walls)
  const sideW = D - 2 * t
  const btmW = W - 2 * t
  const btmH = D - 2 * t

  const e = (hasJoint: boolean, isTab: boolean, ms = 0, me = 0): EdgeCfg =>
    ({ hasJoint, isTab, ms, me })

  // Front panel (W x H)
  // Slots on left/right (receives side panel tabs), slots on top/bottom (receives bottom/top tabs)
  // Top/bottom have margin t at each end for the side panel overlap
  const frontPts = generatePanelOutline(W, H,
    e(!openTop, false, t, t),  // top: slots with margin (or straight if open)
    e(true, false, 0, 0),      // right: slots
    e(true, false, t, t),      // bottom: slots with margin
    e(true, false, 0, 0),      // left: slots
    t, fw, jt,
  )

  // Back panel (W x H) - same as front
  const backPts = generatePanelOutline(W, H,
    e(!openTop, false, t, t),
    e(true, false, 0, 0),
    e(true, false, t, t),
    e(true, false, 0, 0),
    t, fw, jt,
  )

  // Left panel ((D-2t) x H)
  // Tabs on left/right (into front/back slots), slots on top/bottom (receives bottom/top tabs)
  const leftPts = generatePanelOutline(sideW, H,
    e(!openTop, false, 0, 0),  // top: slots (or straight)
    e(true, true, 0, 0),       // right: tabs (into back)
    e(true, false, 0, 0),      // bottom: slots
    e(true, true, 0, 0),       // left: tabs (into front)
    t, fw, jt,
  )

  // Right panel ((D-2t) x H) - same as left
  const rightPts = generatePanelOutline(sideW, H,
    e(!openTop, false, 0, 0),
    e(true, true, 0, 0),
    e(true, false, 0, 0),
    e(true, true, 0, 0),
    t, fw, jt,
  )

  // Bottom panel ((W-2t) x (D-2t))
  // Tabs on all edges
  const bottomPts = generatePanelOutline(btmW, btmH,
    e(true, true, 0, 0),  // top (front-facing): tabs
    e(true, true, 0, 0),  // right: tabs
    e(true, true, 0, 0),  // bottom (back-facing): tabs
    e(true, true, 0, 0),  // left: tabs
    t, fw, jt,
  )

  const panels: PanelResult[] = [
    { name: 'front', width: W, height: H, pathD: pointsToPathD(frontPts) },
    { name: 'back', width: W, height: H, pathD: pointsToPathD(backPts) },
    { name: 'left', width: sideW, height: H, pathD: pointsToPathD(leftPts) },
    { name: 'right', width: sideW, height: H, pathD: pointsToPathD(rightPts) },
    { name: 'bottom', width: btmW, height: btmH, pathD: pointsToPathD(bottomPts) },
  ]

  // Top panel (optional)
  if (!openTop) {
    const topPts = generatePanelOutline(btmW, btmH,
      e(true, true, 0, 0),
      e(true, true, 0, 0),
      e(true, true, 0, 0),
      e(true, true, 0, 0),
      t, fw, jt,
    )
    panels.push({ name: 'top', width: btmW, height: btmH, pathD: pointsToPathD(topPts) })
  }

  // Calculate layout dimensions
  const row1W = W + GAP_MM + W + GAP_MM + sideW + GAP_MM + sideW
  const row2W = btmW + (openTop ? 0 : GAP_MM + btmW)
  const totalWidth = Math.max(row1W, row2W)
  const totalHeight = H + GAP_MM + btmH

  return { panels, totalWidth, totalHeight }
}

// ---- SVG output ----

export function generateBoxSvg(result: BoxResult, params: BoxParams, scale = 1): string {
  const { panels, totalWidth, totalHeight } = result
  const { width: W, height: H, depth: D, thickness: t } = params
  const sideW = D - 2 * t
  const btmW = W - 2 * t
  const btmH = D - 2 * t

  const s = scale
  const sw = (0.5 / s).toFixed(3) // stroke-width inversely scaled

  // Panel positions (in mm, then scaled)
  const positions: Record<string, { x: number; y: number }> = {
    front: { x: 0, y: 0 },
    back: { x: W + GAP_MM, y: 0 },
    left: { x: 2 * W + 2 * GAP_MM, y: 0 },
    right: { x: 2 * W + sideW + 3 * GAP_MM, y: 0 },
    bottom: { x: 0, y: H + GAP_MM },
    top: { x: btmW + GAP_MM, y: H + GAP_MM },
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(totalWidth * s)} ${r(totalHeight * s)}">\n`

  for (const panel of panels) {
    const pos = positions[panel.name]
    if (!pos) continue

    // Scale and translate the path
    const pathD = scaleAndTranslatePath(panel.pathD, pos.x * s, pos.y * s, s)

    svg += `  <path d="${pathD}" fill="none" stroke="#333333" stroke-width="${sw}"/>\n`
  }

  svg += '</svg>'
  return svg
}

function scaleAndTranslatePath(d: string, tx: number, ty: number, s: number): string {
  return d.replace(/([ML])\s*([-\d.]+)\s+([-\d.]+)/g, (_match, cmd, xStr, yStr) => {
    const x = parseFloat(xStr) * s + tx
    const y = parseFloat(yStr) * s + ty
    return `${cmd} ${r(x)} ${r(y)}`
  })
}
