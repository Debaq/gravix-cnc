// ============================================
// Node Editor — extraer y manipular nodos de Fabric.js Path/Polygon
// ============================================
import { Path, Polygon as FabricPolygon, FabricObject, Point, util } from 'fabric'

// Tipo de comando SVG path
export type PathCommand = 'M' | 'L' | 'C' | 'Q' | 'Z'

// Nodo editable extraído de un path
export interface EditableNode {
  // Posición en coordenadas canvas (ya transformada)
  x: number
  y: number
  // Posición original en coordenadas locales del path
  localX: number
  localY: number
  // Índice del comando en pathData
  cmdIndex: number
  // Tipo de nodo
  type: 'anchor' | 'controlPoint'
  // Para control points: a qué anchor pertenece
  anchorIndex?: number
  // Tipo de comando que genera este punto
  command: PathCommand
  // Es el primer punto (M)?
  isFirst: boolean
  // Es endpoint de curva bezier?
  isCurveEnd: boolean
}

// Handle de control bezier
export interface BezierHandle {
  // Control point 1 (entrante)
  cp1?: { x: number; y: number; nodeIndex: number }
  // Control point 2 (saliente)
  cp2?: { x: number; y: number; nodeIndex: number }
}

// Resultado de extracción de nodos
export interface NodeEditData {
  nodes: EditableNode[]
  handles: Map<number, BezierHandle>  // anchorIndex → handles
  isClosed: boolean
  objectType: 'path' | 'polygon'
}

// Extraer nodos editables de un objeto Fabric
export function extractNodes(obj: FabricObject): NodeEditData | null {
  if (obj instanceof Path) {
    return extractPathNodes(obj)
  }
  if (obj instanceof FabricPolygon) {
    return extractPolygonNodes(obj)
  }
  return null
}

function extractPathNodes(pathObj: Path): NodeEditData {
  const pathData = pathObj.path
  const nodes: EditableNode[] = []
  const handles = new Map<number, BezierHandle>()

  if (!pathData || !Array.isArray(pathData)) {
    return { nodes, handles, isClosed: false, objectType: 'path' }
  }

  const matrix = pathObj.calcTransformMatrix()
  const pOff = pathObj.pathOffset ?? new Point(0, 0)

  const toCanvas = (lx: number, ly: number) => {
    const tp = util.transformPoint(new Point(lx - pOff.x, ly - pOff.y), matrix)
    return { x: tp.x, y: tp.y }
  }

  let anchorCount = 0
  let isClosed = false

  for (let i = 0; i < pathData.length; i++) {
    const cmd = pathData[i] as unknown[]
    const command = cmd[0] as PathCommand
    const n = cmd as unknown as number[] // numeric args start at index 1

    switch (command) {
      case 'M': {
        const pos = toCanvas(n[1], n[2])
        nodes.push({
          x: pos.x, y: pos.y,
          localX: n[1], localY: n[2],
          cmdIndex: i, type: 'anchor', command: 'M',
          isFirst: true, isCurveEnd: false,
        })
        anchorCount++
        break
      }
      case 'L': {
        const pos = toCanvas(n[1], n[2])
        nodes.push({
          x: pos.x, y: pos.y,
          localX: n[1], localY: n[2],
          cmdIndex: i, type: 'anchor', command: 'L',
          isFirst: false, isCurveEnd: false,
        })
        anchorCount++
        break
      }
      case 'C': {
        const anchorIdx = anchorCount
        // Control point 1
        const cp1Pos = toCanvas(n[1], n[2])
        const cp1NodeIdx = nodes.length
        nodes.push({
          x: cp1Pos.x, y: cp1Pos.y,
          localX: n[1], localY: n[2],
          cmdIndex: i, type: 'controlPoint', command: 'C',
          anchorIndex: anchorCount - 1,
          isFirst: false, isCurveEnd: false,
        })
        // Control point 2
        const cp2Pos = toCanvas(n[3], n[4])
        const cp2NodeIdx = nodes.length
        nodes.push({
          x: cp2Pos.x, y: cp2Pos.y,
          localX: n[3], localY: n[4],
          cmdIndex: i, type: 'controlPoint', command: 'C',
          anchorIndex: anchorCount,
          isFirst: false, isCurveEnd: false,
        })
        // End point (anchor)
        const endPos = toCanvas(n[5], n[6])
        nodes.push({
          x: endPos.x, y: endPos.y,
          localX: n[5], localY: n[6],
          cmdIndex: i, type: 'anchor', command: 'C',
          isFirst: false, isCurveEnd: true,
        })

        // Store handle info: cp1 belongs to previous anchor, cp2 to current
        const prevAnchor = anchorCount - 1
        const prevHandle = handles.get(prevAnchor) ?? {}
        prevHandle.cp2 = { x: cp1Pos.x, y: cp1Pos.y, nodeIndex: cp1NodeIdx }
        handles.set(prevAnchor, prevHandle)

        const curHandle = handles.get(anchorIdx) ?? {}
        curHandle.cp1 = { x: cp2Pos.x, y: cp2Pos.y, nodeIndex: cp2NodeIdx }
        handles.set(anchorIdx, curHandle)

        anchorCount++
        break
      }
      case 'Q': {
        // Control point
        const cpPos = toCanvas(n[1], n[2])
        nodes.push({
          x: cpPos.x, y: cpPos.y,
          localX: n[1], localY: n[2],
          cmdIndex: i, type: 'controlPoint', command: 'Q',
          anchorIndex: anchorCount - 1,
          isFirst: false, isCurveEnd: false,
        })
        // End point
        const endPos = toCanvas(n[3], n[4])
        nodes.push({
          x: endPos.x, y: endPos.y,
          localX: n[3], localY: n[4],
          cmdIndex: i, type: 'anchor', command: 'Q',
          isFirst: false, isCurveEnd: true,
        })
        anchorCount++
        break
      }
      case 'Z':
        isClosed = true
        break
    }
  }

  return { nodes, handles, isClosed, objectType: 'path' }
}

function extractPolygonNodes(polyObj: FabricPolygon): NodeEditData {
  const points = polyObj.points
  if (!points || points.length === 0) {
    return { nodes: [], handles: new Map(), isClosed: true, objectType: 'polygon' }
  }

  const matrix = polyObj.calcTransformMatrix()
  const pOff = (polyObj as unknown as { pathOffset: { x: number; y: number } }).pathOffset ?? { x: 0, y: 0 }

  const nodes: EditableNode[] = points.map((p, i) => {
    const tp = util.transformPoint(new Point(p.x - pOff.x, p.y - pOff.y), matrix)
    return {
      x: tp.x, y: tp.y,
      localX: p.x, localY: p.y,
      cmdIndex: i, type: 'anchor' as const, command: (i === 0 ? 'M' : 'L') as PathCommand,
      isFirst: i === 0, isCurveEnd: false,
    }
  })

  return { nodes, handles: new Map(), isClosed: true, objectType: 'polygon' }
}

// Mover un nodo: actualizar pathData del objeto Fabric
export function moveNode(
  obj: FabricObject,
  nodeData: NodeEditData,
  nodeIndex: number,
  canvasX: number,
  canvasY: number,
): void {
  const node = nodeData.nodes[nodeIndex]
  if (!node) return

  const matrix = obj.calcTransformMatrix()
  const invMatrix = util.invertTransform(matrix)

  if (obj instanceof Path) {
    const pOff = obj.pathOffset ?? new Point(0, 0)
    const localPt = util.transformPoint(new Point(canvasX, canvasY), invMatrix)
    const lx = localPt.x + pOff.x
    const ly = localPt.y + pOff.y

    const pathData = obj.path
    if (!pathData) return

    const cmd = pathData[node.cmdIndex]
    if (!cmd) return

    switch (cmd[0]) {
      case 'M':
      case 'L':
        cmd[1] = lx
        cmd[2] = ly
        break
      case 'C':
        if (node.type === 'controlPoint') {
          const cmdNodes = nodeData.nodes.filter(n => n.cmdIndex === node.cmdIndex)
          const cpNodes = cmdNodes.filter(n => n.type === 'controlPoint')
          if (cpNodes[0] === node) {
            cmd[1] = lx; cmd[2] = ly
          } else {
            cmd[3] = lx; cmd[4] = ly
          }
        } else {
          cmd[5] = lx; cmd[6] = ly
        }
        break
      case 'Q':
        if (node.type === 'controlPoint') {
          cmd[1] = lx; cmd[2] = ly
        } else {
          cmd[3] = lx; cmd[4] = ly
        }
        break
    }

    // Invalidar cache sin recalcular pathOffset
    obj.dirty = true
    // Forzar que Fabric vea el path como modificado
    if ((obj as unknown as { _cacheCanvas?: unknown })._cacheCanvas) {
      (obj as unknown as { _cacheCanvas: unknown })._cacheCanvas = null
    }

  } else if (obj instanceof FabricPolygon) {
    const pOff = (obj as unknown as { pathOffset: { x: number; y: number } }).pathOffset ?? { x: 0, y: 0 }
    const localPt = util.transformPoint(new Point(canvasX, canvasY), invMatrix)
    const lx = localPt.x + pOff.x
    const ly = localPt.y + pOff.y

    const points = obj.points
    if (!points || !points[nodeIndex]) return

    points[nodeIndex] = { x: lx, y: ly }

    obj.dirty = true
    if ((obj as unknown as { _cacheCanvas?: unknown })._cacheCanvas) {
      (obj as unknown as { _cacheCanvas: unknown })._cacheCanvas = null
    }
  }

  // Actualizar posición del nodo en nodeData
  node.x = canvasX
  node.y = canvasY
}

// Finalizar movimiento de nodo — recalcular bounding box y coords
// Llamar una vez al soltar el mouse, NO durante cada frame de drag
// Compensa el desplazamiento que produce el cambio de pathOffset
export function finalizeNodeMove(obj: FabricObject): void {
  // Guardar pathOffset antes de recalcular
  const oldPO = (obj instanceof Path)
    ? { x: obj.pathOffset?.x ?? 0, y: obj.pathOffset?.y ?? 0 }
    : { x: ((obj as unknown as { pathOffset?: { x: number; y: number } }).pathOffset?.x ?? 0),
        y: ((obj as unknown as { pathOffset?: { x: number; y: number } }).pathOffset?.y ?? 0) }

  ;(obj as unknown as { setDimensions(): void }).setDimensions()

  // Obtener nuevo pathOffset
  const newPO = (obj instanceof Path)
    ? { x: obj.pathOffset?.x ?? 0, y: obj.pathOffset?.y ?? 0 }
    : { x: ((obj as unknown as { pathOffset?: { x: number; y: number } }).pathOffset?.x ?? 0),
        y: ((obj as unknown as { pathOffset?: { x: number; y: number } }).pathOffset?.y ?? 0) }

  // Compensar: pathOffset cambió, ajustar left/top para que el path no salte
  // Usar la matriz de transformación (rot+scale) para convertir delta local a canvas
  const m = obj.calcTransformMatrix()
  const dx = newPO.x - oldPO.x
  const dy = newPO.y - oldPO.y
  // Aplicar solo rotación+escala (m[0..3]), no traslación (m[4..5])
  obj.set({
    left: (obj.left ?? 0) + m[0] * dx + m[2] * dy,
    top: (obj.top ?? 0) + m[1] * dx + m[3] * dy,
  })

  obj.setCoords()
  obj.dirty = true
}

// Agregar nodo en un segmento (entre dos anchors)
export function addNodeOnSegment(
  obj: FabricObject,
  nodeData: NodeEditData,
  segmentStartAnchorIdx: number,
  t: number = 0.5,
): NodeEditData | null {
  if (!(obj instanceof Path)) return null

  const pathData = obj.path
  if (!pathData) return null

  // Encontrar los anchors
  const anchors = nodeData.nodes.filter(n => n.type === 'anchor')
  const startAnchor = anchors[segmentStartAnchorIdx]
  const endAnchor = anchors[segmentStartAnchorIdx + 1]
  if (!startAnchor || !endAnchor) return null

  // Interpolar posición local
  const midLX = startAnchor.localX + (endAnchor.localX - startAnchor.localX) * t
  const midLY = startAnchor.localY + (endAnchor.localY - startAnchor.localY) * t

  // Insertar comando L después del startAnchor
  const insertIdx = endAnchor.cmdIndex
  pathData.splice(insertIdx, 0, ['L', midLX, midLY])

  // Recalcular
  ;(obj as unknown as { setDimensions(): void }).setDimensions()
  obj.setCoords()
  obj.dirty = true

  // Re-extraer nodos
  return extractNodes(obj)
}

// Eliminar un nodo anchor
export function deleteNode(
  obj: FabricObject,
  nodeData: NodeEditData,
  nodeIndex: number,
): NodeEditData | null {
  const node = nodeData.nodes[nodeIndex]
  if (!node || node.type !== 'anchor') return null

  // No eliminar si quedan menos de 2 anchors
  const anchors = nodeData.nodes.filter(n => n.type === 'anchor')
  if (anchors.length <= 2) return null

  if (obj instanceof Path) {
    const pathData = obj.path
    if (!pathData) return null

    // Si es el primer nodo (M), convertir el siguiente a M
    if (node.isFirst && pathData.length > 1) {
      const next = pathData[1] as unknown as (string | number)[]
      if (next[0] === 'L') {
        next[0] = 'M'
      } else if (next[0] === 'C') {
        // Convertir C a M usando endpoint
        pathData[1] = ['M', next[5], next[6]] as any
      }
    }

    // Eliminar el comando
    if (node.command === 'C') {
      // Para bezier, el anchor es parte de un comando C con control points
      // Reemplazar C por L al siguiente punto
      const cmd = pathData[node.cmdIndex]
      if (cmd && cmd[0] === 'C') {
        pathData[node.cmdIndex] = ['L', cmd[5], cmd[6]]
      }
    } else {
      pathData.splice(node.cmdIndex, 1)
    }

    ;(obj as unknown as { setDimensions(): void }).setDimensions()
    obj.setCoords()
    obj.dirty = true

    return extractNodes(obj)

  } else if (obj instanceof FabricPolygon) {
    const points = obj.points
    if (!points || points.length <= 3) return null  // mínimo triángulo

    points.splice(nodeIndex, 1)

    ;(obj as unknown as { setDimensions(): void }).setDimensions()
    obj.setCoords()
    obj.dirty = true

    return extractNodes(obj)
  }

  return null
}

// Encontrar qué nodo está cerca de una posición canvas
export function hitTestNode(
  nodeData: NodeEditData,
  canvasX: number,
  canvasY: number,
  threshold: number,
  anchorsOnly: boolean = false,
): number {
  let closest = -1
  let closestDist = Infinity

  for (let i = 0; i < nodeData.nodes.length; i++) {
    const node = nodeData.nodes[i]
    if (anchorsOnly && node.type !== 'anchor') continue

    const dx = node.x - canvasX
    const dy = node.y - canvasY
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < threshold && dist < closestDist) {
      closestDist = dist
      closest = i
    }
  }

  return closest
}

// Encontrar qué segmento está cerca de una posición (para agregar nodo)
export function hitTestSegment(
  nodeData: NodeEditData,
  canvasX: number,
  canvasY: number,
  threshold: number,
): { anchorIndex: number; t: number } | null {
  const anchors = nodeData.nodes.filter(n => n.type === 'anchor')

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]
    const b = anchors[i + 1]

    // Distancia punto a segmento
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) continue

    let t = ((canvasX - a.x) * dx + (canvasY - a.y) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))

    const projX = a.x + t * dx
    const projY = a.y + t * dy
    const dist = Math.sqrt((canvasX - projX) ** 2 + (canvasY - projY) ** 2)

    if (dist < threshold) {
      return { anchorIndex: i, t }
    }
  }

  // Check closing segment
  if (nodeData.isClosed && anchors.length >= 2) {
    const a = anchors[anchors.length - 1]
    const b = anchors[0]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq > 0) {
      let t = ((canvasX - a.x) * dx + (canvasY - a.y) * dy) / lenSq
      t = Math.max(0, Math.min(1, t))
      const projX = a.x + t * dx
      const projY = a.y + t * dy
      const dist = Math.sqrt((canvasX - projX) ** 2 + (canvasY - projY) ** 2)
      if (dist < threshold) {
        return { anchorIndex: anchors.length - 1, t }
      }
    }
  }

  return null
}

// Toggle nodo entre suave (curva) y esquina (línea recta)
export function toggleNodeSmooth(
  obj: FabricObject,
  nodeData: NodeEditData,
  nodeIndex: number,
): NodeEditData | null {
  if (!(obj instanceof Path)) return null
  const node = nodeData.nodes[nodeIndex]
  if (!node || node.type !== 'anchor') return null

  const pathData = obj.path
  if (!pathData) return null

  const cmd = pathData[node.cmdIndex]
  if (!cmd) return null

  if (cmd[0] === 'C') {
    // Curva → esquina: convertir C a L usando endpoint
    pathData[node.cmdIndex] = ['L', cmd[5], cmd[6]]
  } else if (cmd[0] === 'L') {
    // Esquina → curva: convertir L a C con control points auto
    const prevCmd = node.cmdIndex > 0 ? pathData[node.cmdIndex - 1] : null
    let prevX: number, prevY: number
    if (prevCmd) {
      if (prevCmd[0] === 'M' || prevCmd[0] === 'L') {
        prevX = prevCmd[1]; prevY = prevCmd[2]
      } else if (prevCmd[0] === 'C') {
        prevX = prevCmd[5]; prevY = prevCmd[6]
      } else if (prevCmd[0] === 'Q') {
        prevX = prevCmd[3]; prevY = prevCmd[4]
      } else {
        return null
      }
    } else {
      return null
    }

    const endX = cmd[1], endY = cmd[2]
    const cp1x = prevX + (endX - prevX) / 3
    const cp1y = prevY + (endY - prevY) / 3
    const cp2x = prevX + 2 * (endX - prevX) / 3
    const cp2y = prevY + 2 * (endY - prevY) / 3

    pathData[node.cmdIndex] = ['C', cp1x, cp1y, cp2x, cp2y, endX, endY]
  } else {
    return null
  }

  ;(obj as unknown as { setDimensions(): void }).setDimensions()
  obj.setCoords()
  obj.dirty = true

  return extractNodes(obj)
}

// Partir path en un nodo anchor — genera 2 pathData separados
export function splitPathAtNode(
  obj: FabricObject,
  nodeData: NodeEditData,
  nodeIndex: number,
): { path1: unknown[][]; path2: unknown[][] } | null {
  if (!(obj instanceof Path)) return null
  const node = nodeData.nodes[nodeIndex]
  if (!node || node.type !== 'anchor' || node.isFirst) return null

  const pathData = obj.path
  if (!pathData || pathData.length < 3) return null

  const splitIdx = node.cmdIndex

  // path1: desde M hasta splitIdx (inclusivo)
  const path1 = pathData.slice(0, splitIdx + 1).map(c => [...c])
  if (path1[path1.length - 1][0] === 'Z') path1.pop()

  // path2: desde splitIdx como nuevo M, luego el resto
  let startX: number, startY: number
  const splitCmd = pathData[splitIdx]
  if (splitCmd[0] === 'L') {
    startX = splitCmd[1]; startY = splitCmd[2]
  } else if (splitCmd[0] === 'C') {
    startX = splitCmd[5]; startY = splitCmd[6]
  } else if (splitCmd[0] === 'Q') {
    startX = splitCmd[3]; startY = splitCmd[4]
  } else {
    return null
  }

  const path2: unknown[][] = [['M', startX, startY]]
  for (let i = splitIdx + 1; i < pathData.length; i++) {
    if (pathData[i][0] !== 'Z') {
      path2.push([...pathData[i]])
    }
  }

  if (path2.length < 2) return null
  return { path1, path2 }
}

// Cerrar/abrir un path (toggle Z)
export function togglePathClosed(
  obj: FabricObject,
  nodeData: NodeEditData,
): NodeEditData | null {
  if (!(obj instanceof Path)) return null
  const pathData = obj.path
  if (!pathData || pathData.length < 2) return null

  if (nodeData.isClosed) {
    if (pathData[pathData.length - 1][0] === 'Z') {
      pathData.pop()
    }
  } else {
    pathData.push(['Z'])
  }

  ;(obj as unknown as { setDimensions(): void }).setDimensions()
  obj.setCoords()
  obj.dirty = true

  return extractNodes(obj)
}

// Buscar comando geometrico anterior/siguiente saltando Z
function findPrevGeomCmd(pathData: unknown[][], idx: number, isClosed: boolean): unknown[] | null {
  if (idx > 0) return pathData[idx - 1]
  if (!isClosed) return null
  for (let i = pathData.length - 1; i >= 0; i--) {
    if (pathData[i][0] !== 'Z') return pathData[i]
  }
  return null
}

function findNextGeomCmd(pathData: unknown[][], idx: number, isClosed: boolean): unknown[] | null {
  if (idx < pathData.length - 1 && pathData[idx + 1][0] !== 'Z') return pathData[idx + 1]
  if (idx < pathData.length - 1) {
    // Siguiente es Z, buscar mas alla
    for (let i = idx + 2; i < pathData.length; i++) {
      if (pathData[i][0] !== 'Z') return pathData[i]
    }
  }
  if (!isClosed) return null
  // Path cerrado: buscar desde el inicio
  for (let i = 0; i < pathData.length; i++) {
    if (pathData[i][0] !== 'Z' && i !== idx) return pathData[i]
  }
  return null
}

/**
 * Redondear esquina (Fillet)
 */
export function filletNode(
  obj: FabricObject,
  nodeData: NodeEditData,
  nodeIndex: number,
  radius: number,
): NodeEditData | null {
  if (!(obj instanceof Path) || radius <= 0) return null
  const node = nodeData.nodes[nodeIndex]
  if (!node || node.type !== 'anchor' || node.command === 'C' || node.command === 'M') return null

  const pathData = obj.path
  if (!pathData) return null

  const prevCmd = findPrevGeomCmd(pathData, node.cmdIndex, nodeData.isClosed)
  const nextCmd = findNextGeomCmd(pathData, node.cmdIndex, nodeData.isClosed)
  if (!prevCmd || !nextCmd) return null

  const getEnd = (cmd: unknown[]) => {
    if (cmd[0] === 'M' || cmd[0] === 'L') return { x: cmd[1] as number, y: cmd[2] as number }
    if (cmd[0] === 'C') return { x: cmd[5] as number, y: cmd[6] as number }
    if (cmd[0] === 'Q') return { x: cmd[3] as number, y: cmd[4] as number }
    return null
  }

  const p1 = getEnd(prevCmd)
  const p2 = { x: node.localX, y: node.localY }
  const p3 = getEnd(nextCmd)
  if (!p1 || !p3) return null

  const v12 = { x: p1.x - p2.x, y: p1.y - p2.y }
  const v32 = { x: p3.x - p2.x, y: p3.y - p2.y }
  const d12 = Math.sqrt(v12.x ** 2 + v12.y ** 2)
  const d32 = Math.sqrt(v32.x ** 2 + v32.y ** 2)

  const actualRadius = Math.min(radius, d12 / 2, d32 / 2)
  const u12 = { x: v12.x / d12, y: v12.y / d12 }
  const u32 = { x: v32.x / d32, y: v32.y / d32 }

  const t1 = { x: p2.x + u12.x * actualRadius, y: p2.y + u12.y * actualRadius }
  const t2 = { x: p2.x + u32.x * actualRadius, y: p2.y + u32.y * actualRadius }

  const kappa = 0.55228474983
  const cp1 = { x: t1.x - u12.x * actualRadius * kappa, y: t1.y - u12.y * actualRadius * kappa }
  const cp2 = { x: t2.x - u32.x * actualRadius * kappa, y: t2.y - u32.y * actualRadius * kappa }

  pathData[node.cmdIndex] = ['L', t1.x, t1.y]
  pathData.splice(node.cmdIndex + 1, 0, ['C', cp1.x, cp1.y, cp2.x, cp2.y, t2.x, t2.y])

  ;(obj as unknown as { setDimensions(): void }).setDimensions()
  obj.setCoords()
  obj.dirty = true
  return extractNodes(obj)
}

/**
 * Biselar esquina (Chamfer)
 */
export function chamferNode(
  obj: FabricObject,
  nodeData: NodeEditData,
  nodeIndex: number,
  distance: number,
): NodeEditData | null {
  if (!(obj instanceof Path) || distance <= 0) return null
  const node = nodeData.nodes[nodeIndex]
  if (!node || node.type !== 'anchor' || node.command === 'C' || node.command === 'M') return null

  const pathData = obj.path
  if (!pathData) return null

  const prevCmd = findPrevGeomCmd(pathData, node.cmdIndex, nodeData.isClosed)
  const nextCmd = findNextGeomCmd(pathData, node.cmdIndex, nodeData.isClosed)
  if (!prevCmd || !nextCmd) return null

  const getEnd = (cmd: unknown[]) => {
    if (cmd[0] === 'M' || cmd[0] === 'L') return { x: cmd[1] as number, y: cmd[2] as number }
    if (cmd[0] === 'C') return { x: cmd[5] as number, y: cmd[6] as number }
    if (cmd[0] === 'Q') return { x: cmd[3] as number, y: cmd[4] as number }
    return null
  }

  const p1 = getEnd(prevCmd)
  const p2 = { x: node.localX, y: node.localY }
  const p3 = getEnd(nextCmd)
  if (!p1 || !p3) return null

  const v12 = { x: p1.x - p2.x, y: p1.y - p2.y }
  const v32 = { x: p3.x - p2.x, y: p3.y - p2.y }
  const d12 = Math.sqrt(v12.x ** 2 + v12.y ** 2)
  const d32 = Math.sqrt(v32.x ** 2 + v32.y ** 2)

  const actualDist = Math.min(distance, d12 / 2, d32 / 2)
  const u12 = { x: v12.x / d12, y: v12.y / d12 }
  const u32 = { x: v32.x / d32, y: v32.y / d32 }

  const t1 = { x: p2.x + u12.x * actualDist, y: p2.y + u12.y * actualDist }
  const t2 = { x: p2.x + u32.x * actualDist, y: p2.y + u32.y * actualDist }

  pathData[node.cmdIndex] = ['L', t1.x, t1.y]
  pathData.splice(node.cmdIndex + 1, 0, ['L', t2.x, t2.y])

  ;(obj as unknown as { setDimensions(): void }).setDimensions()
  obj.setCoords()
  obj.dirty = true
  return extractNodes(obj)
}

/**
 * Dog-bone fillet: círculo en la esquina interior para compensar radio de fresa CNC.
 * En lugar de redondear la esquina (fillet), extiende un arco circular que se adentra
 * en la esquina, permitiendo que la fresa llegue al vértice exacto.
 * @param radius - radio de la fresa (= radio del dog-bone)
 */
export function dogboneNode(
  obj: FabricObject,
  nodeData: NodeEditData,
  nodeIndex: number,
  radius: number,
): NodeEditData | null {
  if (!(obj instanceof Path) || radius <= 0) return null
  const node = nodeData.nodes[nodeIndex]
  if (!node || node.type !== 'anchor' || node.command === 'C' || node.command === 'M') return null

  const pathData = obj.path
  if (!pathData) return null

  const prevCmd = findPrevGeomCmd(pathData, node.cmdIndex, nodeData.isClosed)
  const nextCmd = findNextGeomCmd(pathData, node.cmdIndex, nodeData.isClosed)
  if (!prevCmd || !nextCmd) return null

  const getEnd = (cmd: unknown[]) => {
    if (cmd[0] === 'M' || cmd[0] === 'L') return { x: cmd[1] as number, y: cmd[2] as number }
    if (cmd[0] === 'C') return { x: cmd[5] as number, y: cmd[6] as number }
    if (cmd[0] === 'Q') return { x: cmd[3] as number, y: cmd[4] as number }
    return null
  }

  const p1 = getEnd(prevCmd)
  const p2 = { x: node.localX, y: node.localY }
  const p3 = getEnd(nextCmd)
  if (!p1 || !p3) return null

  // Vectors from corner to adjacent points
  const v12 = { x: p1.x - p2.x, y: p1.y - p2.y }
  const v32 = { x: p3.x - p2.x, y: p3.y - p2.y }
  const d12 = Math.sqrt(v12.x ** 2 + v12.y ** 2)
  const d32 = Math.sqrt(v32.x ** 2 + v32.y ** 2)
  if (d12 < 0.001 || d32 < 0.001) return null

  const u12 = { x: v12.x / d12, y: v12.y / d12 }
  const u32 = { x: v32.x / d32, y: v32.y / d32 }

  // Bisector INTO the corner (opposite of fillet which rounds outward)
  const bisX = -(u12.x + u32.x)
  const bisY = -(u12.y + u32.y)
  const bisLen = Math.sqrt(bisX ** 2 + bisY ** 2)
  if (bisLen < 0.001) return null

  const ubX = bisX / bisLen
  const ubY = bisY / bisLen

  // Tangent points on each edge, small distance from corner
  const tangentDist = radius * 0.3
  const t1 = { x: p2.x + u12.x * tangentDist, y: p2.y + u12.y * tangentDist }
  const t2 = { x: p2.x + u32.x * tangentDist, y: p2.y + u32.y * tangentDist }

  // Control points for cubic bezier going INTO the corner
  const kappa = 0.55228474983
  const cp1 = { x: t1.x + ubX * radius * kappa, y: t1.y + ubY * radius * kappa }
  const cp2 = { x: t2.x + ubX * radius * kappa, y: t2.y + ubY * radius * kappa }

  pathData[node.cmdIndex] = ['L', t1.x, t1.y]
  pathData.splice(node.cmdIndex + 1, 0, ['C', cp1.x, cp1.y, cp2.x, cp2.y, t2.x, t2.y])

  ;(obj as unknown as { setDimensions(): void }).setDimensions()
  obj.setCoords()
  obj.dirty = true
  return extractNodes(obj)
}

// ============================================
// Nodo simetrico: handles alineados y del mismo largo
// ============================================

/**
 * Deja los dos handles bezier de un anchor colineales y de igual longitud,
 * de modo que la curva pase sin quiebre por el nodo. Requiere que el anchor
 * este entre dos curvas C (con una sola curva no hay nada que simetrizar).
 */
export function symmetricNode(
  obj: FabricObject,
  nodeData: NodeEditData,
  nodeIndex: number,
): NodeEditData | null {
  if (!(obj instanceof Path)) return null
  const node = nodeData.nodes[nodeIndex]
  if (!node || node.type !== 'anchor') return null

  const pathData = obj.path as unknown as number[][]
  if (!pathData) return null

  // Indice del anchor dentro de la secuencia de anchors
  let anchorIdx = -1
  for (let i = 0; i <= nodeIndex; i++) {
    if (nodeData.nodes[i].type === 'anchor') anchorIdx++
  }

  const handle = nodeData.handles.get(anchorIdx)
  if (!handle?.cp1 || !handle?.cp2) return null

  const cp1Node = nodeData.nodes[handle.cp1.nodeIndex]
  const cp2Node = nodeData.nodes[handle.cp2.nodeIndex]
  if (!cp1Node || !cp2Node) return null

  const cmd1 = pathData[cp1Node.cmdIndex]
  const cmd2 = pathData[cp2Node.cmdIndex]
  // cp1 es el segundo control de la curva entrante, cp2 el primero de la saliente
  if (!cmd1 || !cmd2 || String(cmd1[0]) !== 'C' || String(cmd2[0]) !== 'C') return null

  const ax = node.localX
  const ay = node.localY

  const inX = cp1Node.localX - ax
  const inY = cp1Node.localY - ay
  const outX = cp2Node.localX - ax
  const outY = cp2Node.localY - ay

  const lenIn = Math.hypot(inX, inY)
  const lenOut = Math.hypot(outX, outY)
  if (lenIn < 1e-6 && lenOut < 1e-6) return null

  // Direccion promedio de la tangente (el handle entrante apunta al reves)
  let dirX = outX - inX
  let dirY = outY - inY
  const dirLen = Math.hypot(dirX, dirY)
  if (dirLen < 1e-6) {
    // Ya son opuestos: basta con igualar longitudes
    dirX = outX
    dirY = outY
    const l = Math.hypot(dirX, dirY)
    if (l < 1e-6) return null
    dirX /= l
    dirY /= l
  } else {
    dirX /= dirLen
    dirY /= dirLen
  }

  const half = (lenIn + lenOut) / 2

  // cp1 (entrante) va hacia atras, cp2 (saliente) hacia adelante
  cmd1[3] = ax - dirX * half
  cmd1[4] = ay - dirY * half
  cmd2[1] = ax + dirX * half
  cmd2[2] = ay + dirY * half

  ;(obj as unknown as { setDimensions(): void }).setDimensions()
  obj.setCoords()
  obj.dirty = true

  return extractNodes(obj)
}

// ============================================
// Romper nodo: cortar el path sin partir el objeto
// ============================================

/** Punto final (absoluto, local al path) de un comando. */
function commandEndPoint(cmd: number[]): { x: number; y: number } | null {
  switch (String(cmd[0])) {
    case 'M':
    case 'L':
      return { x: cmd[1], y: cmd[2] }
    case 'Q':
      return { x: cmd[3], y: cmd[4] }
    case 'C':
      return { x: cmd[5], y: cmd[6] }
    default:
      return null
  }
}

/**
 * Corta el path en el nodo dejando un solo objeto:
 * - path cerrado: lo abre y lo reordena para que empiece y termine en ese nodo
 * - path abierto: inserta un M, con lo que queda un objeto de dos subpaths
 *   cuyos extremos coinciden y se pueden separar arrastrandolos
 */
export function breakNode(
  obj: FabricObject,
  nodeData: NodeEditData,
  nodeIndex: number,
): NodeEditData | null {
  if (!(obj instanceof Path)) return null
  const node = nodeData.nodes[nodeIndex]
  if (!node || node.type !== 'anchor') return null

  const pathData = obj.path as unknown as number[][]
  if (!pathData || pathData.length < 3) return null

  const idx = node.cmdIndex
  const hasZ = String(pathData[pathData.length - 1][0]) === 'Z'

  if (hasZ) {
    if (node.isFirst) {
      // Romper en el nodo inicial es simplemente abrir el contorno
      pathData.pop()
    } else {
      const first = commandEndPoint(pathData[0])
      const at = commandEndPoint(pathData[idx])
      if (!first || !at) return null

      // Cuerpo sin el M inicial ni el Z final
      const body = pathData.slice(1, pathData.length - 1).map(c => [...c])
      const rel = idx - 1
      if (rel < 0 || rel >= body.length) return null

      const rotated: number[][] = [
        ['M', at.x, at.y] as unknown as number[],
        ...body.slice(rel + 1),
        // El tramo que antes cerraba el contorno (la Z) se vuelve explicito
        ['L', first.x, first.y] as unknown as number[],
        ...body.slice(0, rel + 1),
      ]
      obj.path = rotated as unknown as Path['path']
    }
  } else {
    // En un extremo no hay nada que romper
    if (node.isFirst || idx === pathData.length - 1) return null
    const at = commandEndPoint(pathData[idx])
    if (!at) return null

    const next: number[][] = [
      ...pathData.slice(0, idx + 1).map(c => [...c]),
      ['M', at.x, at.y] as unknown as number[],
      ...pathData.slice(idx + 1).map(c => [...c]),
    ]
    obj.path = next as unknown as Path['path']
  }

  ;(obj as unknown as { setDimensions(): void }).setDimensions()
  obj.setCoords()
  obj.dirty = true

  return extractNodes(obj)
}
