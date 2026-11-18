// ============================================
// Reanudar un trabajo interrumpido
// ============================================
//
// Cuando un job se corta (error, alarma, cable, parada) no alcanza con mandar
// las lineas que faltan: el control perdio el estado modal y la herramienta
// esta en cualquier lado. Se recorre el programa hasta la linea de reinicio
// para saber unidades, modo, avance, husillo y posicion, y se arma un
// preambulo que deja la maquina igual que si hubiera llegado ahi corriendo.

/** Mismas reglas que `normalize_gcode` del backend: los indices coinciden. */
export function normalizeGCode(gcode: string): string[] {
  return gcode
    .split('\n')
    .map((l) => l.replace(/\(.*?\)/g, '').split(';')[0].trim())
    .filter((l) => l !== '' && !l.startsWith('%'))
}

/**
 * Lineas que el control ya acuso pero puede no haber ejecutado: quedaban en el
 * planner cuando se corto. Se retrocede esa cantidad para no saltear corte.
 */
export const RESUME_BACKOFF_LINES = 20

export interface ResumeInfo {
  /** Programa listo para enviar. */
  program: string
  /** Linea (normalizada, base 0) desde la que se retoma. */
  fromLine: number
  /** Posicion a la que vuelve la herramienta antes de seguir. */
  position: { x: number | null; y: number | null; z: number | null }
}

/**
 * Busca hacia atras un buen punto de reinicio: una linea de rapido (G0), que
 * es donde la herramienta esta arriba y no hay corte a medias.
 */
export function suggestResumeLine(lines: string[], ackedLine: number): number {
  let i = Math.max(0, Math.min(lines.length - 1, ackedLine - RESUME_BACKOFF_LINES))
  for (; i > 0; i--) {
    if (/^G0?0\b/i.test(lines[i]) && /[XY]/i.test(lines[i])) return i
  }
  return 0
}

export function buildResumeProgram(gcode: string, fromLine: number, safeZ: number): ResumeInfo {
  const lines = normalizeGCode(gcode)
  const from = Math.max(0, Math.min(lines.length, Math.floor(fromLine)))

  let units = 'G21'
  let distance = 'G90'
  let wcs = ''
  let plane = ''
  let motion = ''
  let feed: number | null = null
  let spindle = null as { cmd: string; s: number | null } | null
  let coolant = ''
  let x: number | null = null
  let y: number | null = null
  let z: number | null = null

  const word = (line: string, letter: string): number | null => {
    const m = new RegExp(`${letter}\\s*(-?\\d*\\.?\\d+)`, 'i').exec(line)
    return m ? parseFloat(m[1]) : null
  }

  for (let i = 0; i < from; i++) {
    const line = lines[i]
    for (const m of line.matchAll(/G\s*(\d+(?:\.\d+)?)/gi)) {
      const g = parseFloat(m[1])
      if (g === 20 || g === 21) units = `G${g}`
      else if (g === 90 || g === 91) distance = `G${g}`
      else if (g >= 54 && g <= 59) wcs = `G${g}`
      else if (g >= 17 && g <= 19) plane = `G${g}`
      else if (g <= 3) motion = `G${g}`
    }
    for (const m of line.matchAll(/M\s*(\d+)/gi)) {
      const code = parseInt(m[1])
      if (code === 3 || code === 4) spindle = { cmd: `M${code}`, s: word(line, 'S') ?? spindle?.s ?? null }
      else if (code === 5) spindle = null
      else if (code === 7 || code === 8) coolant = `M${code}`
      else if (code === 9) coolant = ''
    }
    const s = word(line, 'S')
    if (s !== null && spindle && !/M\s*[345]\b/i.test(line)) spindle = { ...spindle, s }
    const f = word(line, 'F')
    if (f !== null) feed = f
    // Solo se sigue la posicion en absoluto y fuera de lineas que no mueven
    if (distance === 'G90' && !/G\s*(4|10|28|30|53|92)\b/i.test(line)) {
      x = word(line, 'X') ?? x
      y = word(line, 'Y') ?? y
      z = word(line, 'Z') ?? z
    }
  }

  const pre: string[] = [
    `; ---- Reanudado desde la linea ${from + 1} de ${lines.length} ----`,
    units,
    'G90',
  ]
  if (plane) pre.push(plane)
  if (wcs) pre.push(wcs)
  // Subir antes de viajar: la herramienta puede haber quedado en el material
  pre.push(`G0 Z${safeZ}`)
  if (x !== null || y !== null) {
    pre.push(`G0${x !== null ? ` X${x}` : ''}${y !== null ? ` Y${y}` : ''}`)
  }
  if (coolant) pre.push(coolant)
  if (spindle) {
    pre.push(`${spindle.cmd}${spindle.s !== null ? ` S${spindle.s}` : ''}`)
    // Un laser no necesita esperar; un husillo si. Con Z en juego es husillo.
    if (z !== null) pre.push('G4 P2')
  }
  // Volver a la profundidad que tenia, despacio
  if (z !== null && z < safeZ) {
    pre.push(`G1 Z${z} F${feed !== null ? Math.max(1, Math.round(feed / 3)) : 100}`)
  }
  if (feed !== null) pre.push(`G1 F${feed}`)
  // Modo de movimiento vigente: las lineas siguientes pueden venir sin G
  if (motion && motion !== 'G1') pre.push(motion === 'G0' ? 'G0' : `${motion}`)
  if (distance === 'G91') pre.push('G91')

  return {
    program: [...pre.filter((l) => !/^G[23]$/.test(l)), ...lines.slice(from)].join('\n'),
    fromLine: from,
    position: { x, y, z },
  }
}
