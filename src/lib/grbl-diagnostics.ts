/**
 * GRBL Diagnostics: parse extended status reports and $G parser state.
 *
 * GRBL status format: <State|MPos:x,y,z|WPos:x,y,z|Bf:15,128|FS:500,8000|Pn:XYZPDHRS|Ov:100,100,100>
 * $G format: [GC:G0 G54 G17 G21 G90 G94 M0 M5 M9 T0 S0.0 F500.0]
 */

export interface GrblDiagnostics {
  // Pin states from Pn: field
  limitX: boolean
  limitY: boolean
  limitZ: boolean
  probe: boolean
  door: boolean
  hold: boolean
  softReset: boolean
  cycleStart: boolean
  // Buffer state from Bf: field
  plannerBuffer: number
  rxBuffer: number
  // Feed/speed from FS: field
  currentFeed: number
  currentSpindle: number
  // Overrides from Ov: field
  feedOverride: number
  rapidOverride: number
  spindleOverride: number
  // Accessories from A: field
  spindleCW: boolean
  spindleCCW: boolean
  floodCoolant: boolean
  mistCoolant: boolean
}

export interface GrblParserState {
  motionMode: string       // G0, G1, G2, G3, G38.2
  coordSystem: string      // G54-G59
  plane: string            // G17, G18, G19
  units: string            // G20, G21
  distanceMode: string     // G90, G91
  feedRateMode: string     // G93, G94
  programMode: string      // M0, M1, M2
  spindleState: string     // M3, M4, M5
  coolantState: string     // M7, M8, M9
  toolNumber: number
  spindleSpeed: number
  feedRate: number
}

const defaultDiag: GrblDiagnostics = {
  limitX: false, limitY: false, limitZ: false,
  probe: false, door: false, hold: false, softReset: false, cycleStart: false,
  plannerBuffer: 0, rxBuffer: 0,
  currentFeed: 0, currentSpindle: 0,
  feedOverride: 100, rapidOverride: 100, spindleOverride: 100,
  spindleCW: false, spindleCCW: false, floodCoolant: false, mistCoolant: false,
}

/**
 * Parse GRBL real-time status report (response to '?')
 * Format: <Idle|MPos:0.000,0.000,0.000|Bf:15,128|FS:0,0|Pn:XYZ|Ov:100,100,100|A:S>
 */
export function parseStatusReport(line: string): Partial<GrblDiagnostics> {
  const diag: Partial<GrblDiagnostics> = {}

  // Pin states: Pn:XYZPDHRS
  const pnMatch = line.match(/Pn:([A-Za-z]+)/)
  if (pnMatch) {
    const pins = pnMatch[1]
    diag.limitX = pins.includes('X')
    diag.limitY = pins.includes('Y')
    diag.limitZ = pins.includes('Z')
    diag.probe = pins.includes('P')
    diag.door = pins.includes('D')
    diag.hold = pins.includes('H')
    diag.softReset = pins.includes('R')
    diag.cycleStart = pins.includes('S')
  }

  // Buffer: Bf:planner,rx
  const bfMatch = line.match(/Bf:(\d+),(\d+)/)
  if (bfMatch) {
    diag.plannerBuffer = parseInt(bfMatch[1])
    diag.rxBuffer = parseInt(bfMatch[2])
  }

  // Feed/Speed: FS:feed,spindle or F:feed
  const fsMatch = line.match(/FS:([0-9.]+),([0-9.]+)/)
  if (fsMatch) {
    diag.currentFeed = parseFloat(fsMatch[1])
    diag.currentSpindle = parseFloat(fsMatch[2])
  }

  // Overrides: Ov:feed,rapid,spindle
  const ovMatch = line.match(/Ov:(\d+),(\d+),(\d+)/)
  if (ovMatch) {
    diag.feedOverride = parseInt(ovMatch[1])
    diag.rapidOverride = parseInt(ovMatch[2])
    diag.spindleOverride = parseInt(ovMatch[3])
  }

  // Accessories: A:SCF (Spindle CW, CCW, Flood, Mist)
  const aMatch = line.match(/A:([A-Za-z]+)/)
  if (aMatch) {
    const acc = aMatch[1]
    diag.spindleCW = acc.includes('S')
    diag.spindleCCW = acc.includes('C')
    diag.floodCoolant = acc.includes('F')
    diag.mistCoolant = acc.includes('M')
  }

  return diag
}

/**
 * Parse GRBL parser state ($G response)
 * Format: [GC:G0 G54 G17 G21 G90 G94 M0 M5 M9 T0 S0.0 F500.0]
 */
export function parseParserState(line: string): GrblParserState | null {
  const match = line.match(/\[GC:(.+)\]/)
  if (!match) return null

  const tokens = match[1].split(' ')
  const state: GrblParserState = {
    motionMode: 'G0',
    coordSystem: 'G54',
    plane: 'G17',
    units: 'G21',
    distanceMode: 'G90',
    feedRateMode: 'G94',
    programMode: 'M0',
    spindleState: 'M5',
    coolantState: 'M9',
    toolNumber: 0,
    spindleSpeed: 0,
    feedRate: 0,
  }

  for (const token of tokens) {
    if (/^G[0-3]$/.test(token) || token.startsWith('G38')) state.motionMode = token
    else if (/^G5[4-9]$/.test(token)) state.coordSystem = token
    else if (/^G1[789]$/.test(token)) state.plane = token
    else if (/^G2[01]$/.test(token)) state.units = token
    else if (/^G9[01]$/.test(token)) state.distanceMode = token
    else if (/^G9[34]$/.test(token)) state.feedRateMode = token
    else if (/^M[012]$/.test(token)) state.programMode = token
    else if (/^M[345]$/.test(token)) state.spindleState = token
    else if (/^M[789]$/.test(token)) state.coolantState = token
    else if (token.startsWith('T')) state.toolNumber = parseInt(token.slice(1))
    else if (token.startsWith('S')) state.spindleSpeed = parseFloat(token.slice(1))
    else if (token.startsWith('F')) state.feedRate = parseFloat(token.slice(1))
  }

  return state
}
