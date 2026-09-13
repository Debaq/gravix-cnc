// ============================================
// Hoja de setup del trabajo
// ============================================
//
// Lo que hay que tener a mano en la maquina antes de apretar start: que
// herramientas van, en que orden, a que profundidad, donde va el cero, que
// material y donde estan las mordazas. Se arma como HTML autocontenido para
// poder imprimirlo o guardarlo junto al proyecto.

import type { CAMOperation, CAMSetup, CAMMarker } from '@/stores/useCAMStore'
import type { Tool, Material, WorkArea } from './types'
import { formatTime, type OperationUsage } from './gcode-parser'
import { resolveStock, type BBox } from './cam-jobs'

export interface JobSheetInput {
  projectName: string
  workArea: WorkArea
  setup: CAMSetup
  /** Operaciones ya en orden de ejecucion y sin las apagadas. */
  operations: CAMOperation[]
  markers: CAMMarker[]
  tools: Tool[]
  materials: Material[]
  usage: OperationUsage[]
  totalTime: number
  totalDistance: number
  gcodeLines: number
  /** Bounding box del trabajo, para resolver el stock automatico. */
  bbox: BBox | null
}

const WORK_TYPE_LABELS: Record<string, string> = {
  outline: 'Contorno sobre la linea',
  inside: 'Contorno interior',
  outside: 'Contorno exterior',
  pocket: 'Cajeado',
  drill: 'Taladrado',
  vcarve: 'V-Carve',
  chamfer: 'Bisel',
  photoVcarve: 'Photo V-Carve',
}

const OP_TYPE_LABELS: Record<string, string> = {
  cnc: 'CNC',
  laser: 'Laser',
  plotter: 'Plotter',
  pencil: 'Lapiz',
}

const LASER_MODE_LABELS: Record<string, string> = {
  cut: 'Corte',
  engrave: 'Grabado',
  fill: 'Relleno',
  raster: 'Raster',
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function opLabel(op: CAMOperation): string {
  const cfg = op.config
  if (cfg.operationType === 'cnc') return WORK_TYPE_LABELS[cfg.workType] ?? cfg.workType
  if (cfg.operationType === 'laser') return `Laser — ${LASER_MODE_LABELS[cfg.laserMode] ?? cfg.laserMode}`
  return OP_TYPE_LABELS[cfg.operationType] ?? cfg.operationType
}

/** Los parametros que de verdad hay que verificar antes de cortar. */
function opParams(op: CAMOperation): string[] {
  const cfg = op.config
  const out: string[] = []

  if (cfg.operationType === 'cnc') {
    out.push(`Z -${Math.abs(cfg.depth)} mm en pasos de ${cfg.depthStep} mm`)
    out.push(`F${cfg.feedRate} / plunge F${cfg.plungeRate} / ${cfg.spindleRPM} RPM`)
    if (cfg.workType === 'pocket') {
      const strategy = cfg.pocketStrategy === 'spiral'
        ? 'espiral'
        : cfg.pocketStrategy === 'zigzag'
          ? 'zigzag'
          : cfg.pocketStrategy === 'trochoidal'
            ? 'trocoidal'
            : 'contorno paralelo'
      out.push(`Stepover ${Math.round(cfg.stepover * 100)}% (${strategy})`)
    }
    if (cfg.workType === 'drill') {
      out.push(cfg.drillPeckDepth > 0 ? `G83 peck ${cfg.drillPeckDepth} mm` : 'G81 simple')
    }
    if (cfg.workType === 'vcarve' || cfg.workType === 'chamfer' || cfg.workType === 'photoVcarve') {
      out.push(`V-bit ${cfg.vcarveAngle}°`)
    }
    if (cfg.leadType !== 'none') {
      out.push(`Entrada ${cfg.leadType === 'arc' ? 'en arco' : 'lineal'} ${cfg.leadLength} mm`)
    }
    if (cfg.rampEnabled) out.push(`Rampa ${cfg.rampAngle}°`)
    if (cfg.tabsEnabled) {
      const count = cfg.tabMode === 'manual' ? cfg.tabPositions.length : cfg.tabCount
      out.push(`${count} tabs de ${cfg.tabWidth} x ${cfg.tabHeight} mm`)
    }
    if (cfg.finishPassEnabled && cfg.finishAllowance > 0) {
      out.push(`Sobremedida ${cfg.finishAllowance} mm + acabado`)
    }
    if (cfg.cutterComp !== 'off') out.push(`${cfg.cutterComp.toUpperCase()} D${cfg.cutterCompD}`)
    out.push(cfg.millDirection === 'climb' ? 'Concordancia' : 'Oposicion')
  }

  if (cfg.operationType === 'laser') {
    out.push(`${cfg.laserPower}% a F${cfg.feedRate}`)
    out.push(cfg.laserDynamic ? 'M4 dinamica' : 'M3 constante')
    if (cfg.passes > 1) out.push(`${cfg.passes} pasadas`)
    if (cfg.laserMode === 'fill') out.push(`Relleno ${cfg.fillSpacing} mm a ${cfg.fillAngle}°`)
    if (cfg.laserMode === 'raster') out.push(`${cfg.rasterDpi} DPI, ${cfg.rasterDithering}`)
  }

  if (cfg.operationType === 'plotter' || cfg.operationType === 'pencil') {
    out.push(`Velocidad ${cfg.speed}`)
    out.push(cfg.operationType === 'plotter' ? `Presion ${cfg.pressure}` : `Z ${cfg.pressureZ}`)
  }

  return out
}

function toolLabel(op: CAMOperation, tools: Tool[]): string {
  const tool = op.config.tool ? tools.find((t) => t.id === op.config.tool) : null
  if (!tool) return 'SIN HERRAMIENTA'
  const dia = tool.diameter ? ` ${tool.diameter}mm` : ''
  const ang = tool.angle ? ` ${tool.angle}°` : ''
  return `${tool.name}${dia}${ang}`
}

/**
 * Herramientas en el orden en que hay que montarlas, con las operaciones que
 * cubre cada una. Una herramienta que vuelve mas adelante aparece dos veces:
 * eso es un cambio de herramienta mas, y conviene verlo.
 */
function toolSequence(operations: CAMOperation[], tools: Tool[]): { tool: string; ops: string[] }[] {
  const seq: { tool: string; ops: string[] }[] = []
  for (const op of operations) {
    const label = toolLabel(op, tools)
    const last = seq[seq.length - 1]
    if (last && last.tool === label) {
      last.ops.push(op.elementName)
    } else {
      seq.push({ tool: label, ops: [op.elementName] })
    }
  }
  return seq
}

function usageFor(op: CAMOperation, usage: OperationUsage[]): OperationUsage | null {
  const key = `${op.elementName}:${op.config.workType}`
  return usage.find((u) => u.operationId === key) ?? null
}

/** Arma un HTML autocontenido, listo para imprimir o guardar. */
export function renderJobSheetHTML(input: JobSheetInput): string {
  const {
    projectName, workArea, setup, operations, markers,
    tools, materials, usage, totalTime, totalDistance, gcodeLines, bbox,
  } = input

  const now = new Date()
  const stock = resolveStock(setup.stock, bbox)
  const sequence = toolSequence(operations, tools)

  // Una clave de uso compartida por varias operaciones no se puede repartir:
  // se marca para no dar un numero inventado.
  const keyCount = new Map<string, number>()
  for (const op of operations) {
    const key = `${op.elementName}:${op.config.workType}`
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1)
  }

  const opRows = operations.map((op, i) => {
    const key = `${op.elementName}:${op.config.workType}`
    const shared = (keyCount.get(key) ?? 0) > 1
    const u = usageFor(op, usage)
    const time = u && !shared ? formatTime(u.time) : shared ? 'compartido' : '—'
    const material = op.config.material
      ? materials.find((m) => m.id === op.config.material)?.name ?? '—'
      : '—'

    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>
          <strong>${escapeHtml(op.elementName)}</strong>
          ${op.operationIndex >= 0 ? `<span class="tag">op ${op.operationIndex + 1}</span>` : ''}
          <div class="muted">${escapeHtml(opLabel(op))}</div>
        </td>
        <td>${escapeHtml(toolLabel(op, tools))}</td>
        <td>${escapeHtml(material)}</td>
        <td class="params">${opParams(op).map((p) => `<div>${escapeHtml(p)}</div>`).join('')}</td>
        <td class="num">${time}</td>
      </tr>`
  }).join('')

  const markerRows = markers.length > 0
    ? markers.map((m) => `
      <tr>
        <td class="num">${Math.round(m.progress)}%</td>
        <td>${m.type === 'pause' ? 'Pausa' : m.type === 'tool-change' ? 'Cambio de herramienta' : 'Mensaje'}</td>
        <td>${escapeHtml(m.message || '—')}</td>
        <td class="num">X${m.parkPosition.x} Y${m.parkPosition.y} Z${m.parkPosition.z}</td>
      </tr>`).join('')
    : ''

  const clampRows = setup.clamps.length > 0
    ? setup.clamps.map((c) => `
      <tr>
        <td>${escapeHtml(c.label)}</td>
        <td class="num">X${c.x} Y${c.y}</td>
        <td class="num">${c.width} x ${c.height} mm</td>
        <td class="num">${c.zHeight === 0 ? 'sin limite' : `${c.zHeight} mm`}</td>
      </tr>`).join('')
    : ''

  const warnings = operations.flatMap((op) =>
    op.warnings.map((w) => `${op.elementName}: ${w}`),
  )

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Hoja de setup — ${escapeHtml(projectName)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    font: 11px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #111; background: #fff; margin: 0; padding: 16px;
  }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
       color: #555; margin: 18px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .meta { text-align: right; color: #555; font-size: 10px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .card { border: 1px solid #ddd; border-radius: 4px; padding: 6px 8px; }
  .card .k { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #777; }
  .card .v { font-size: 13px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .05em;
       color: #777; border-bottom: 1px solid #ccc; padding: 4px 6px; }
  td { border-bottom: 1px solid #eee; padding: 5px 6px; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .muted { color: #666; font-size: 10px; }
  .params div { color: #444; font-size: 10px; }
  .tag { font-size: 9px; background: #eee; border-radius: 3px; padding: 0 4px; margin-left: 4px; }
  ol.seq { margin: 4px 0 0; padding-left: 18px; }
  ol.seq li { margin-bottom: 3px; }
  .warn { border: 1px solid #e0b000; background: #fff8e1; border-radius: 4px;
          padding: 6px 8px; margin-top: 8px; }
  .warn li { margin-left: 4px; }
  .checklist { list-style: none; padding: 0; margin: 4px 0 0; }
  .checklist li { padding: 3px 0 3px 20px; position: relative; }
  .checklist li::before { content: ""; position: absolute; left: 0; top: 4px;
    width: 11px; height: 11px; border: 1px solid #888; border-radius: 2px; }
  footer { margin-top: 20px; color: #888; font-size: 9px;
           border-top: 1px solid #eee; padding-top: 6px; }
  @media print { body { padding: 0; } .card, table { break-inside: avoid; } }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${escapeHtml(projectName || 'Proyecto sin nombre')}</h1>
      <div class="muted">Hoja de setup</div>
    </div>
    <div class="meta">
      ${now.toLocaleDateString()} ${now.toLocaleTimeString()}<br>
      ${operations.length} operaciones · ${gcodeLines} lineas de G-code
    </div>
  </div>

  <h2>Resumen</h2>
  <div class="grid">
    <div class="card"><div class="k">Tiempo estimado</div><div class="v">${formatTime(totalTime)}</div></div>
    <div class="card"><div class="k">Recorrido</div><div class="v">${(totalDistance / 1000).toFixed(2)} m</div></div>
    <div class="card"><div class="k">Area de trabajo</div><div class="v">${workArea.width} × ${workArea.height} mm</div></div>
    <div class="card"><div class="k">Cambios de herramienta</div><div class="v">${Math.max(0, sequence.length - 1)}</div></div>
  </div>

  <h2>Montaje</h2>
  <div class="grid">
    <div class="card"><div class="k">Material</div><div class="v">${
      stock.enabled ? `${stock.width.toFixed(0)} × ${stock.height.toFixed(0)} × ${stock.thickness} mm` : 'sin definir'
    }</div></div>
    <div class="card"><div class="k">Cero Z</div><div class="v">${
      stock.enabled ? (stock.zeroAt === 'top' ? 'cara superior' : 'mesa') : '—'
    }</div></div>
    <div class="card"><div class="k">Altura segura</div><div class="v">${setup.safeZ} mm</div></div>
    <div class="card"><div class="k">Cambio de herramienta</div><div class="v">X${setup.toolChangePosition.x} Y${setup.toolChangePosition.y} Z${setup.toolChangePosition.z}</div></div>
  </div>

  ${stock.enabled ? `<div class="muted" style="margin-top:6px">
    Esquina del material en X${stock.x.toFixed(1)} Y${stock.y.toFixed(1)}${stock.auto ? ` (calculado del dibujo + ${stock.margin} mm de margen)` : ''}
  </div>` : ''}

  ${clampRows ? `
  <h2>Mordazas</h2>
  <table>
    <thead><tr><th>Nombre</th><th>Posicion</th><th>Tamaño</th><th>Altura</th></tr></thead>
    <tbody>${clampRows}</tbody>
  </table>` : ''}

  <h2>Secuencia de herramientas</h2>
  <ol class="seq">
    ${sequence.map((s) => `<li><strong>${escapeHtml(s.tool)}</strong> — ${escapeHtml(s.ops.join(', '))}</li>`).join('')}
  </ol>

  <h2>Operaciones</h2>
  <table>
    <thead>
      <tr><th>#</th><th>Elemento</th><th>Herramienta</th><th>Material</th><th>Parametros</th><th>Tiempo</th></tr>
    </thead>
    <tbody>${opRows}</tbody>
  </table>

  ${markerRows ? `
  <h2>Paradas programadas</h2>
  <table>
    <thead><tr><th>Progreso</th><th>Tipo</th><th>Mensaje</th><th>Posicion de parking</th></tr></thead>
    <tbody>${markerRows}</tbody>
  </table>` : ''}

  ${warnings.length > 0 ? `
  <div class="warn">
    <strong>Avisos sin resolver</strong>
    <ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
  </div>` : ''}

  <h2>Antes de arrancar</h2>
  <ul class="checklist">
    <li>Material amurado y apoyado en toda la superficie</li>
    <li>Mordazas fuera del recorrido${setup.clamps.length > 0 ? ` (${setup.clamps.length} definidas)` : ''}</li>
    <li>Cero de pieza puesto en ${stock.enabled && stock.zeroAt === 'bottom' ? 'la mesa' : 'la cara superior del material'}</li>
    <li>Primera herramienta montada: ${escapeHtml(sequence[0]?.tool ?? '—')}</li>
    <li>Aspiracion y refrigeracion segun material</li>
    <li>Recorrido en vacio verificado</li>
  </ul>

  <footer>
    Generado por Gravix. El tiempo es una estimacion con aceleracion de 500 mm/s²:
    la maquina real puede diferir segun sus $120/$121/$122.
  </footer>
</body>
</html>`
}
