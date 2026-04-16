import { Path, Circle, Line, Point } from 'fabric'
import type { Point2D } from './types'

// Factor de escala DXF (generalmente mm) a Pixeles del canvas
const PIXELS_PER_MM = 3.78

interface DxfEntity {
  type: string
  x1?: number; y1?: number
  x2?: number; y2?: number
  centerX?: number; centerY?: number
  radius?: number
  startAngle?: number; endAngle?: number
  points?: Point2D[]
  closed?: boolean
  // Ellipse specific
  majorX?: number; majorY?: number  // major axis endpoint (relative)
  minorRatio?: number               // ratio minor/major
  // Spline specific
  degree?: number
  controlPoints?: Point2D[]
  knots?: number[]
  fitPoints?: Point2D[]
  // POLYLINE vertex accumulator
  vertices?: Point2D[]
}

/**
 * Parser minimalista de DXF enfocado en entidades 2D comunes para CNC.
 */
export function parseDxf(content: string): DxfEntity[] {
  const lines = content.split(/\r?\n/).map(l => l.trim())
  const entities: DxfEntity[] = []
  
  let currentEntity: Partial<DxfEntity> | null = null
  let inEntitiesSection = false
  
  for (let i = 0; i < lines.length; i += 2) {
    const code = parseInt(lines[i])
    const value = lines[i+1]
    if (isNaN(code)) continue

    // Detectar sección ENTITIES
    if (code === 2 && value === 'ENTITIES') {
      inEntitiesSection = true
      continue
    }
    if (code === 0 && value === 'ENDSEC') {
      inEntitiesSection = false
      continue
    }

    if (!inEntitiesSection) continue

    // Nueva entidad
    if (code === 0) {
      if (currentEntity && currentEntity.type) {
        entities.push(currentEntity as DxfEntity)
      }
      currentEntity = { type: value }
      continue
    }

    if (!currentEntity) continue

    // Propiedades comunes
    switch (code) {
      case 10: currentEntity.x1 = currentEntity.centerX = parseFloat(value); break
      case 20: currentEntity.y1 = currentEntity.centerY = parseFloat(value); break
      case 11: currentEntity.x2 = parseFloat(value); break
      case 21: currentEntity.y2 = parseFloat(value); break
      case 40: currentEntity.radius = parseFloat(value); break
      case 50: currentEntity.startAngle = parseFloat(value); break
      case 51: currentEntity.endAngle = parseFloat(value); break
      case 70: currentEntity.closed = (parseInt(value) & 1) === 1; break
    }

    // Multi-point entities
    if (currentEntity.type === 'LWPOLYLINE') {
      if (code === 10) {
        if (!currentEntity.points) currentEntity.points = []
        currentEntity.points.push({ x: parseFloat(value), y: 0 })
      } else if (code === 20) {
        if (currentEntity.points && currentEntity.points.length > 0) {
          currentEntity.points[currentEntity.points.length - 1].y = parseFloat(value)
        }
      }
    }

    // ELLIPSE properties
    if (currentEntity.type === 'ELLIPSE') {
      if (code === 11) currentEntity.majorX = parseFloat(value)
      else if (code === 21) currentEntity.majorY = parseFloat(value)
      else if (code === 40) currentEntity.minorRatio = parseFloat(value)
      else if (code === 41) currentEntity.startAngle = parseFloat(value) // radians
      else if (code === 42) currentEntity.endAngle = parseFloat(value)   // radians
    }

    // SPLINE properties
    if (currentEntity.type === 'SPLINE') {
      if (code === 71) currentEntity.degree = parseInt(value)
      else if (code === 40) {
        if (!currentEntity.knots) currentEntity.knots = []
        currentEntity.knots.push(parseFloat(value))
      } else if (code === 10) {
        if (!currentEntity.controlPoints) currentEntity.controlPoints = []
        currentEntity.controlPoints.push({ x: parseFloat(value), y: 0 })
      } else if (code === 20) {
        if (currentEntity.controlPoints && currentEntity.controlPoints.length > 0) {
          currentEntity.controlPoints[currentEntity.controlPoints.length - 1].y = parseFloat(value)
        }
      } else if (code === 11) {
        if (!currentEntity.fitPoints) currentEntity.fitPoints = []
        currentEntity.fitPoints.push({ x: parseFloat(value), y: 0 })
      } else if (code === 21) {
        if (currentEntity.fitPoints && currentEntity.fitPoints.length > 0) {
          currentEntity.fitPoints[currentEntity.fitPoints.length - 1].y = parseFloat(value)
        }
      }
    }

    // VERTEX (part of POLYLINE entity)
    if (currentEntity.type === 'VERTEX') {
      if (code === 10) {
        if (!currentEntity.points) currentEntity.points = []
        currentEntity.points.push({ x: parseFloat(value), y: 0 })
      } else if (code === 20) {
        if (currentEntity.points && currentEntity.points.length > 0) {
          currentEntity.points[currentEntity.points.length - 1].y = parseFloat(value)
        }
      }
    }
  }

  // Añadir la última
  if (currentEntity && currentEntity.type) {
    entities.push(currentEntity as DxfEntity)
  }

  // Post-process: merge POLYLINE + VERTEX sequences
  const merged: DxfEntity[] = []
  let polyline: DxfEntity | null = null
  for (const ent of entities) {
    if (ent.type === 'POLYLINE') {
      polyline = { type: 'POLYLINE', points: [], closed: ent.closed }
    } else if (ent.type === 'VERTEX' && polyline) {
      if (ent.points) {
        if (!polyline.points) polyline.points = []
        polyline.points.push(...ent.points)
      }
    } else if (ent.type === 'SEQEND' && polyline) {
      if (polyline.points && polyline.points.length >= 2) {
        merged.push(polyline)
      }
      polyline = null
    } else {
      if (polyline) {
        // Orphan polyline without SEQEND
        if (polyline.points && polyline.points.length >= 2) merged.push(polyline)
        polyline = null
      }
      merged.push(ent)
    }
  }
  if (polyline && polyline.points && polyline.points.length >= 2) {
    merged.push(polyline)
  }

  return merged
}

/**
 * Convierte entidades DXF a objetos de Fabric.js.
 */
export function dxfToFabricObjects(entities: DxfEntity[]): any[] {
  const objects: any[] = []

  for (const ent of entities) {
    switch (ent.type) {
      case 'LINE':
        objects.push(new Line([
          (ent.x1 || 0) * PIXELS_PER_MM,
          -(ent.y1 || 0) * PIXELS_PER_MM, // DXF Y es arriba, Canvas es abajo
          (ent.x2 || 0) * PIXELS_PER_MM,
          -(ent.y2 || 0) * PIXELS_PER_MM
        ], {
          stroke: '#333',
          strokeWidth: 1
        }))
        break

      case 'CIRCLE':
        const r = (ent.radius || 0) * PIXELS_PER_MM
        objects.push(new Circle({
          left: (ent.centerX || 0) * PIXELS_PER_MM - r,
          top: -(ent.centerY || 0) * PIXELS_PER_MM - r,
          radius: r,
          fill: 'transparent',
          stroke: '#333',
          strokeWidth: 1
        }))
        break

      case 'ARC': {
        const cx = (ent.centerX || 0) * PIXELS_PER_MM
        const cy = -(ent.centerY || 0) * PIXELS_PER_MM
        const radius = (ent.radius || 0) * PIXELS_PER_MM
        const start = (ent.startAngle || 0) * (Math.PI / 180)
        const end = (ent.endAngle || 0) * (Math.PI / 180)
        
        // Aproximación simple: arco circular como Path
        // Para Fabric.js Path, usamos comandos A (Arc) o linearizamos
        // DXF angles son CCW desde el eje X positivo.
        const x1 = cx + radius * Math.cos(start)
        const y1 = cy - radius * Math.sin(start)
        const x2 = cx + radius * Math.cos(end)
        const y2 = cy - radius * Math.sin(end)
        
        const largeArc = (end - start + Math.PI * 2) % (Math.PI * 2) > Math.PI ? 1 : 0
        const pathStr = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 0 ${x2} ${y2}`
        
        objects.push(new Path(pathStr, {
          fill: 'transparent',
          stroke: '#333',
          strokeWidth: 1
        }))
        break
      }

      case 'LWPOLYLINE':
      case 'POLYLINE':
        if (!ent.points || ent.points.length < 2) break
        let pStr = `M ${ent.points[0].x * PIXELS_PER_MM} ${-ent.points[0].y * PIXELS_PER_MM}`
        for (let i = 1; i < ent.points.length; i++) {
          pStr += ` L ${ent.points[i].x * PIXELS_PER_MM} ${-ent.points[i].y * PIXELS_PER_MM}`
        }
        if (ent.closed) pStr += ' Z'

        objects.push(new Path(pStr, {
          fill: 'transparent',
          stroke: '#333',
          strokeWidth: 1
        }))
        break

      case 'ELLIPSE': {
        const ecx = (ent.centerX || 0) * PIXELS_PER_MM
        const ecy = -(ent.centerY || 0) * PIXELS_PER_MM
        const emx = (ent.majorX || 1) * PIXELS_PER_MM
        const emy = -(ent.majorY || 0) * PIXELS_PER_MM
        const ratio = ent.minorRatio || 1
        const majorLen = Math.sqrt(emx * emx + emy * emy)
        const minorLen = majorLen * ratio
        const rot = Math.atan2(emy, emx)
        const eStart = ent.startAngle ?? 0
        const eEnd = ent.endAngle ?? (Math.PI * 2)

        // Linearize ellipse to path
        const steps = 72
        let ePath = ''
        for (let i = 0; i <= steps; i++) {
          const t = eStart + (eEnd - eStart) * (i / steps)
          const ex = majorLen * Math.cos(t)
          const ey = minorLen * Math.sin(t)
          const rx = ex * Math.cos(rot) - ey * Math.sin(rot) + ecx
          const ry = ex * Math.sin(rot) + ey * Math.cos(rot) + ecy
          ePath += i === 0 ? `M ${rx.toFixed(3)} ${ry.toFixed(3)}` : ` L ${rx.toFixed(3)} ${ry.toFixed(3)}`
        }
        if (Math.abs(eEnd - eStart - Math.PI * 2) < 0.01) ePath += ' Z'

        objects.push(new Path(ePath, { fill: 'transparent', stroke: '#333', strokeWidth: 1 }))
        break
      }

      case 'SPLINE': {
        // Use fit points if available, otherwise control points as polyline approximation
        const pts = (ent.fitPoints && ent.fitPoints.length >= 2) ? ent.fitPoints
          : (ent.controlPoints && ent.controlPoints.length >= 2) ? ent.controlPoints
          : null
        if (!pts) break

        let sPath = `M ${pts[0].x * PIXELS_PER_MM} ${-pts[0].y * PIXELS_PER_MM}`

        if (pts.length >= 4 && (!ent.fitPoints || ent.fitPoints.length === 0)) {
          // Approximate B-spline with cubic bezier segments (every 3 control points)
          for (let i = 1; i + 2 < pts.length; i += 3) {
            sPath += ` C ${pts[i].x * PIXELS_PER_MM} ${-pts[i].y * PIXELS_PER_MM}`
            sPath += ` ${pts[i+1].x * PIXELS_PER_MM} ${-pts[i+1].y * PIXELS_PER_MM}`
            sPath += ` ${pts[i+2].x * PIXELS_PER_MM} ${-pts[i+2].y * PIXELS_PER_MM}`
          }
          // Handle remaining points as lines
          const remainder = (pts.length - 1) % 3
          if (remainder > 0) {
            for (let i = pts.length - remainder; i < pts.length; i++) {
              sPath += ` L ${pts[i].x * PIXELS_PER_MM} ${-pts[i].y * PIXELS_PER_MM}`
            }
          }
        } else {
          // Fit points: connect with lines (good enough for most DXF splines)
          for (let i = 1; i < pts.length; i++) {
            sPath += ` L ${pts[i].x * PIXELS_PER_MM} ${-pts[i].y * PIXELS_PER_MM}`
          }
        }

        if (ent.closed) sPath += ' Z'
        objects.push(new Path(sPath, { fill: 'transparent', stroke: '#333', strokeWidth: 1 }))
        break
      }

      case 'POINT':
        // Skip points (not useful for CNC paths)
        break
    }
  }

  return objects
}
