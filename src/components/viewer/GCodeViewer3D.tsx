import { useRef, useMemo, useEffect, useCallback, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Grid, Line, GizmoHelper, GizmoViewcube } from '@react-three/drei'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCAMStore } from '@/stores/useCAMStore'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useTranslation } from 'react-i18next'
import { Box, AlertTriangle } from 'lucide-react'
import { parseGCode, formatTime } from '@/lib/gcode-parser'
import type { GCodeSegment } from '@/lib/gcode-parser'
import * as THREE from 'three'

/**
 * G-code X -> Three.js X (derecha)
 * G-code Y -> Three.js -Z (al fondo de pantalla = arriba visto desde arriba)
 * G-code Z -> Three.js Y (arriba)
 */
function gcodeToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y]
}

/**
 * Calcula los limites del area de trabajo en coordenadas G-code
 * segun el origen configurado.
 */
function getWorkAreaBounds(width: number, height: number, origin: string) {
  switch (origin) {
    case 'top-left':      return { minX: 0, minY: -height, maxX: width, maxY: 0 }
    case 'top-center':    return { minX: -width / 2, minY: -height, maxX: width / 2, maxY: 0 }
    case 'top-right':     return { minX: -width, minY: -height, maxX: 0, maxY: 0 }
    case 'center-left':   return { minX: 0, minY: -height / 2, maxX: width, maxY: height / 2 }
    case 'center':        return { minX: -width / 2, minY: -height / 2, maxX: width / 2, maxY: height / 2 }
    case 'center-right':  return { minX: -width, minY: -height / 2, maxX: 0, maxY: height / 2 }
    case 'bottom-left':
    default:              return { minX: 0, minY: 0, maxX: width, maxY: height }
    case 'bottom-center': return { minX: -width / 2, minY: 0, maxX: width / 2, maxY: height }
    case 'bottom-right':  return { minX: -width, minY: 0, maxX: 0, maxY: height }
  }
}

// Global flag to disable OrbitControls during drag
const dragState = { active: false }

/**
 * Convert Three.js position back to G-code coordinates.
 * Inverse of gcodeToThree: Three X → G-code X, Three Y → G-code Z, Three -Z → G-code Y
 */
function threeToGcode(tx: number, ty: number, tz: number): { x: number; y: number; z: number } {
  return { x: tx, y: -tz, z: ty }
}

/**
 * Hook for dragging objects on the XZ plane (Three.js Y=planeY).
 * Attaches pointer listeners to the canvas DOM so drag continues even when pointer leaves mesh.
 */
function useDragOnPlane(
  planeY: number,
  onDrag: (gcodePos: { x: number; y: number; z: number }) => void,
  onDragEnd?: () => void,
) {
  const { gl, camera } = useThree()
  const isDragging = useRef(false)
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), [planeY])
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])

  const projectPointer = useCallback((e: PointerEvent) => {
    const rect = gl.domElement.getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera)
    if (ray.ray.intersectPlane(plane, hit)) {
      onDrag(threeToGcode(hit.x, hit.y, hit.z))
    }
  }, [gl, camera, plane, ray, hit, onDrag])

  const onPointerUp = useCallback(() => {
    if (!isDragging.current) return
    isDragging.current = false
    dragState.active = false
    gl.domElement.removeEventListener('pointermove', projectPointer)
    gl.domElement.removeEventListener('pointerup', onPointerUp)
    gl.domElement.style.cursor = ''
    onDragEnd?.()
  }, [gl, projectPointer, onDragEnd])

  const startDrag = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    isDragging.current = true
    dragState.active = true
    gl.domElement.addEventListener('pointermove', projectPointer)
    gl.domElement.addEventListener('pointerup', onPointerUp)
    gl.domElement.style.cursor = 'grabbing'
  }, [gl, projectPointer, onPointerUp])

  return startDrag
}

function WorkArea({ bounds, width, height }: {
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  width: number
  height: number
}) {
  const { show3DGrid, show3DAxes } = useGCodeStore()

  // Convertir bounds G-code a Three.js (Y gcode -> -Z three)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = -(bounds.minY + bounds.maxY) / 2
  const axisLen = Math.min(width, height) * 0.1

  return (
    <group>
      {/* Borde del area de trabajo */}
      <Line
        points={[
          [bounds.minX, 0, -bounds.minY],
          [bounds.maxX, 0, -bounds.minY],
          [bounds.maxX, 0, -bounds.maxY],
          [bounds.minX, 0, -bounds.maxY],
          [bounds.minX, 0, -bounds.minY],
        ]}
        color="#5B4B9F"
        lineWidth={2}
      />

      {show3DGrid && (
        <Grid
          args={[width, height]}
          cellSize={20}
          cellThickness={0.5}
          cellColor="#B5A8D6"
          sectionSize={100}
          sectionThickness={1}
          sectionColor="#5B4B9F"
          fadeDistance={Math.max(width, height) * 1.5}
          fadeStrength={1}
          followCamera={false}
          position={[centerX, 0, centerZ]}
        />
      )}

      {show3DAxes && (
        <group>
          {/* X axis - rojo */}
          <Line
            points={[[0, 0.2, 0], [axisLen, 0.2, 0]]}
            color="#FF0000"
            lineWidth={3}
          />
          {/* Y axis (G-code) - verde - Three.js -Z */}
          <Line
            points={[[0, 0.2, 0], [0, 0.2, -axisLen]]}
            color="#00FF00"
            lineWidth={3}
          />
          {/* Z axis (G-code) - azul - Three.js Y */}
          <Line
            points={[[0, 0, 0], [0, axisLen, 0]]}
            color="#0066FF"
            lineWidth={3}
          />
          {/* Punto de origen */}
          <mesh position={[0, 0.3, 0]}>
            <sphereGeometry args={[2, 12, 12]} />
            <meshBasicMaterial color="#FFD700" />
          </mesh>
        </group>
      )}
    </group>
  )
}

interface ToolpathProps {
  segments: GCodeSegment[]
}

function Toolpath({ segments }: ToolpathProps) {
  const { animationProgress, viewer3DPlaying } = useGCodeStore()
  const selectedOpId = useCAMStore((s) => s.selectedOperationId)
  const soloOpId = useCAMStore((s) => s.soloOperationId)
  const camOps = useCAMStore((s) => s.operations)

  // Build highlight info
  const { highlightSet, disabledSet } = useMemo(() => {
    const focusId = soloOpId ?? selectedOpId
    let hSet: Set<string> | null = null
    const dSet = new Set<string>()

    if (focusId) {
      const op = camOps.find((o) => o.id === focusId)
      if (op) {
        const cfg = op.config
        const wd = cfg.operationType === 'cnc' ? cfg.workType : (cfg.operationType === 'laser' ? cfg.laserMode : cfg.operationType)
        hSet = new Set([`${op.elementName}:${wd}`])
      }
    }

    for (const o of camOps) {
      if (!o.enabled) {
        const c = o.config
        const wd = c.operationType === 'cnc' ? c.workType : (c.operationType === 'laser' ? c.laserMode : c.operationType)
        dSet.add(`${o.elementName}:${wd}`)
      }
    }

    return { highlightSet: hSet, disabledSet: dSet }
  }, [selectedOpId, soloOpId, camOps])

  const colorMode = useGCodeStore((s) => s.viewerColorMode)

  // Rango de avance y de profundidad, para los modos de color por magnitud
  const ranges = useMemo(() => {
    let minFeed = Infinity, maxFeed = -Infinity, maxDepth = 0
    for (const seg of segments) {
      if (seg.type !== 'cut') continue
      const f = seg.feedRate ?? 0
      if (f > 0) {
        if (f < minFeed) minFeed = f
        if (f > maxFeed) maxFeed = f
      }
      const d = Math.max(-seg.from.z, -seg.to.z)
      if (d > maxDepth) maxDepth = d
    }
    if (!Number.isFinite(minFeed)) { minFeed = 0; maxFeed = 0 }
    return { minFeed, maxFeed, maxDepth }
  }, [segments])

  const { rapidPoints, rapidColors, cutPoints, cutColors, totalSegments } = useMemo(() => {
    const rp: number[] = []
    const rc: number[] = []
    const cp: number[] = []
    const cc: number[] = []

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]

      // Check if disabled
      if (seg.operationId && disabledSet.has(seg.operationId)) continue

      // Determine dim factor
      const isDimmed = highlightSet !== null && seg.operationId && !highlightSet.has(seg.operationId)
      const isHighlighted = highlightSet !== null && seg.operationId && highlightSet.has(seg.operationId)
      const dimFactor = isDimmed ? 0.15 : 1.0

      const [fx, fy, fz] = gcodeToThree(seg.from.x, seg.from.y, seg.from.z)
      const [tx, ty, tz] = gcodeToThree(seg.to.x, seg.to.y, seg.to.z)

      if (seg.type === 'rapid') {
        rp.push(fx, fy, fz, tx, ty, tz)
        rc.push(0.2 * dimFactor, 0.5 * dimFactor, 1.0 * dimFactor, 0.2 * dimFactor, 0.5 * dimFactor, 1.0 * dimFactor)
      } else {
        cp.push(fx, fy, fz, tx, ty, tz)
        let r: number, g: number, b: number
        if (colorMode === 'feed' || colorMode === 'depth') {
          // Gradiente azul (bajo) -> rojo (alto) sobre el rango real del trabajo
          const t = colorMode === 'feed'
            ? (ranges.maxFeed > ranges.minFeed
                ? ((seg.feedRate ?? ranges.minFeed) - ranges.minFeed) / (ranges.maxFeed - ranges.minFeed)
                : 0.5)
            : (ranges.maxDepth > 0
                ? Math.min(1, Math.max(0, Math.max(-seg.from.z, -seg.to.z) / ranges.maxDepth))
                : 0)
          r = t
          g = 0.25 + 0.35 * (1 - Math.abs(t * 2 - 1))
          b = 1 - t
        } else if (seg.color) {
          const hex = seg.color.replace('#', '')
          r = parseInt(hex.slice(0, 2), 16) / 255
          g = parseInt(hex.slice(2, 4), 16) / 255
          b = parseInt(hex.slice(4, 6), 16) / 255
        } else if (isHighlighted) {
          // Highlighted: bright green
          r = 0.2
          g = 1.0
          b = 0.3
        } else {
          const depth = Math.min(Math.abs(fy), 10) / 10
          r = 1.0
          g = 0.15 + (1 - depth) * 0.2
          b = 0.1 + (1 - depth) * 0.15
        }
        cc.push(r * dimFactor, g * dimFactor, b * dimFactor, r * dimFactor, g * dimFactor, b * dimFactor)
      }
    }

    return {
      rapidPoints: new Float32Array(rp),
      rapidColors: new Float32Array(rc),
      cutPoints: new Float32Array(cp),
      cutColors: new Float32Array(cc),
      totalSegments: segments.length,
    }
  }, [segments, highlightSet, disabledSet, colorMode, ranges])

  const rapidRef = useRef<THREE.LineSegments>(null)
  const cutRef = useRef<THREE.LineSegments>(null)

  const rapidSegCount = rapidPoints.length / 6
  const cutSegCount = cutPoints.length / 6

  useFrame(() => {
    if (!viewer3DPlaying && animationProgress >= 100) return

    const progress = animationProgress / 100
    // Count visible segments excluding disabled ones
    let rapidsShown = 0
    let cutsShown = 0
    const visibleCount = Math.floor(progress * totalSegments)
    let counted = 0
    for (let i = 0; i < segments.length && counted < visibleCount; i++) {
      const seg = segments[i]
      if (seg.operationId && disabledSet.has(seg.operationId)) continue
      counted++
      if (seg.type === 'rapid') rapidsShown++
      else cutsShown++
    }

    if (rapidRef.current) {
      rapidRef.current.geometry.setDrawRange(0, rapidsShown * 2)
    }
    if (cutRef.current) {
      cutRef.current.geometry.setDrawRange(0, cutsShown * 2)
    }
  })

  useEffect(() => {
    if (animationProgress >= 100 && !viewer3DPlaying) {
      if (rapidRef.current) {
        rapidRef.current.geometry.setDrawRange(0, Infinity)
      }
      if (cutRef.current) {
        cutRef.current.geometry.setDrawRange(0, Infinity)
      }
    }
  }, [animationProgress, viewer3DPlaying])

  if (segments.length === 0) return null

  return (
    <group>
      {rapidSegCount > 0 && (
        <lineSegments ref={rapidRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[rapidPoints, 3]} />
            <bufferAttribute attach="attributes-color" args={[rapidColors, 3]} />
          </bufferGeometry>
          <lineBasicMaterial vertexColors transparent opacity={0.35} />
        </lineSegments>
      )}
      {cutSegCount > 0 && (
        <lineSegments ref={cutRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[cutPoints, 3]} />
            <bufferAttribute attach="attributes-color" args={[cutColors, 3]} />
          </bufferGeometry>
          <lineBasicMaterial vertexColors linewidth={1} />
        </lineSegments>
      )}
    </group>
  )
}

/**
 * Tool shapes by type:
 *   endmill  → cylinder (flat bottom)
 *   ballnose → cylinder + hemisphere bottom
 *   vbit     → cone (inverted, tip down)
 *   blade    → thin triangle wedge
 *   pen/pencil/marker → thin cone tip
 *   laser    → cone beam (wireframe)
 */
function ToolShape({ toolType, radius, angle, shaftLen }: {
  toolType: string
  radius: number
  angle: number
  shaftLen: number
}) {
  const mat = <meshStandardMaterial color="#FFD700" transparent opacity={0.85} />
  const wireMat = <meshBasicMaterial color="#FF4444" wireframe transparent opacity={0.5} />

  switch (toolType) {
    case 'ballnose':
      return (
        <group>
          {/* Shaft */}
          <mesh position={[0, shaftLen / 2 + radius, 0]}>
            <cylinderGeometry args={[radius, radius, shaftLen, 16]} />
            {mat}
          </mesh>
          {/* Ball tip */}
          <mesh position={[0, radius, 0]}>
            <sphereGeometry args={[radius, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
            {mat}
          </mesh>
        </group>
      )

    case 'vbit': {
      // Cone tip: angle is total included angle
      const halfAngle = ((angle || 60) / 2) * Math.PI / 180
      const coneHeight = radius / Math.tan(halfAngle)
      return (
        <group>
          {/* Shaft */}
          <mesh position={[0, coneHeight + shaftLen / 2, 0]}>
            <cylinderGeometry args={[radius, radius, shaftLen, 16]} />
            {mat}
          </mesh>
          {/* Cone tip (wide top, point bottom) */}
          <mesh position={[0, coneHeight / 2, 0]}>
            <coneGeometry args={[radius, coneHeight, 16]} />
            {mat}
          </mesh>
        </group>
      )
    }

    case 'blade':
      return (
        <group>
          {/* Thin blade wedge - approximate with a flattened cone */}
          <mesh position={[0, shaftLen / 2 + 1, 0]}>
            <cylinderGeometry args={[radius * 0.3, radius * 0.3, shaftLen, 8]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.5, 0]} rotation={[0, 0, 0]}>
            <coneGeometry args={[radius * 0.8, 2, 4]} />
            {mat}
          </mesh>
        </group>
      )

    case 'co2':
    case 'diode':
    case 'fiber':
      // Laser beam cone (wireframe)
      return (
        <mesh position={[0, shaftLen / 2, 0]}>
          <coneGeometry args={[radius * 2, shaftLen, 8]} />
          {wireMat}
        </mesh>
      )

    case 'pen':
    case 'pencil':
    case 'marker':
      return (
        <group>
          {/* Body */}
          <mesh position={[0, shaftLen / 2 + 2, 0]}>
            <cylinderGeometry args={[radius * 0.8, radius * 0.8, shaftLen, 8]} />
            {mat}
          </mesh>
          {/* Tip */}
          <mesh position={[0, 1, 0]}>
            <coneGeometry args={[radius * 0.8, 2, 8]} />
            {mat}
          </mesh>
        </group>
      )

    case 'endmill':
    default:
      // Flat endmill: cylinder
      return (
        <group>
          <mesh position={[0, shaftLen / 2, 0]}>
            <cylinderGeometry args={[radius, radius, shaftLen, 16]} />
            {mat}
          </mesh>
          {/* Flat bottom cap */}
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[radius, 16]} />
            {mat}
          </mesh>
        </group>
      )
  }
}

function ToolIndicator({ segments }: { segments: GCodeSegment[] }) {
  const groupRef = useRef<THREE.Group>(null)
  const { animationProgress, viewer3DPlaying } = useGCodeStore()
  const { globalConfig } = useCanvasStore()
  const { tools } = useLibraryStore()

  // Resolve tool info
  const toolInfo = useMemo(() => {
    const toolId = globalConfig.tool
    const tool = toolId ? tools.find((t) => t.id === toolId) : null
    const diameter = tool?.diameter ?? globalConfig.toolDiameter ?? 3.175
    const radius = diameter / 2
    const type = tool?.type ?? 'endmill'
    const angle = tool?.angle ?? globalConfig.vcarveAngle ?? 60
    return { type, radius, angle }
  }, [globalConfig.tool, globalConfig.toolDiameter, globalConfig.vcarveAngle, tools])

  useFrame(() => {
    if (!groupRef.current || segments.length === 0) return

    const progress = animationProgress / 100
    const segIndex = Math.min(
      Math.floor(progress * segments.length),
      segments.length - 1
    )

    const segProgress = (progress * segments.length) - segIndex
    const seg = segments[segIndex]
    if (!seg) return

    const x = seg.from.x + (seg.to.x - seg.from.x) * Math.min(segProgress, 1)
    const y = seg.from.y + (seg.to.y - seg.from.y) * Math.min(segProgress, 1)
    const z = seg.from.z + (seg.to.z - seg.from.z) * Math.min(segProgress, 1)

    const [tx, ty, tz] = gcodeToThree(x, y, z)
    groupRef.current.position.set(tx, ty, tz)
    groupRef.current.visible = viewer3DPlaying || animationProgress < 100
  })

  if (segments.length === 0) return null

  const shaftLen = Math.max(toolInfo.radius * 6, 10)

  return (
    <group ref={groupRef}>
      <ToolShape
        toolType={toolInfo.type}
        radius={toolInfo.radius}
        angle={toolInfo.angle}
        shaftLen={shaftLen}
      />
    </group>
  )
}

function ThickCutLines({ segments }: { segments: GCodeSegment[] }) {
  const { animationProgress, viewer3DPlaying } = useGCodeStore()

  const cutLinePoints = useMemo(() => {
    const polylines: [number, number, number][][] = []
    let current: [number, number, number][] = []

    for (const seg of segments) {
      if (seg.type === 'cut') {
        if (current.length === 0) {
          current.push(gcodeToThree(seg.from.x, seg.from.y, seg.from.z))
        }
        current.push(gcodeToThree(seg.to.x, seg.to.y, seg.to.z))
      } else {
        if (current.length >= 2) polylines.push(current)
        current = []
      }
    }
    if (current.length >= 2) polylines.push(current)
    return polylines
  }, [segments])

  if (cutLinePoints.length === 0) return null
  if (viewer3DPlaying && animationProgress < 100) return null

  return (
    <group>
      {cutLinePoints.map((points, i) => (
        <Line key={i} points={points} color="#FF3333" lineWidth={2} opacity={0.9} transparent />
      ))}
    </group>
  )
}

/**
 * Single draggable parking marker in 3D.
 */
function DraggableParkMarker({ markerId, color }: { markerId: string; color: string }) {
  const marker = useCAMStore((s) => s.markers.find((m) => m.id === markerId))
  const selectedMarkerId = useCAMStore((s) => s.selectedMarkerId)
  const { updateParkPosition, selectMarker } = useCAMStore()
  const [hovered, setHovered] = useState(false)

  const startDrag = useDragOnPlane(
    marker?.parkPosition.z ?? 30, // drag on plane at marker's Z height
    useCallback((pos) => {
      updateParkPosition(markerId, { x: Math.round(pos.x * 10) / 10, y: Math.round(pos.y * 10) / 10 })
    }, [markerId, updateParkPosition]),
  )

  if (!marker) return null

  const [px, py, pz] = gcodeToThree(marker.parkPosition.x, marker.parkPosition.y, marker.parkPosition.z)
  const isSelected = selectedMarkerId === markerId

  return (
    <group position={[px, py, pz]}>
      <mesh
        onPointerDown={(e) => { selectMarker(markerId); startDrag(e) }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[isSelected ? 4 : hovered ? 3.5 : 2.5, 16, 16]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={isSelected ? 0.9 : hovered ? 0.8 : 0.6}
          emissive={color}
          emissiveIntensity={isSelected ? 0.4 : 0.1}
        />
      </mesh>
      <Line
        points={[[0, -py, 0], [0, 0, 0]]}
        color={color}
        lineWidth={1}
        dashed
        dashSize={3}
        gapSize={2}
      />
      {isSelected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[5, 6, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} side={2} />
        </mesh>
      )}
    </group>
  )
}

function ParkingPositions() {
  const markers = useCAMStore((s) => s.markers)
  if (markers.length === 0) return null

  const colors: Record<string, string> = {
    'pause': '#f59e0b',
    'tool-change': '#3b82f6',
    'message': '#a855f7',
  }

  return (
    <group>
      {markers.map((m) => (
        <DraggableParkMarker key={m.id} markerId={m.id} color={colors[m.type] ?? '#f59e0b'} />
      ))}
    </group>
  )
}


/**
 * Bloque de material. Se dibuja translucido para ver el recorrido adentro.
 * Con `auto` el bloque se ajusta al recorrido de corte mas el margen, que es
 * lo mismo que usa la validacion antes de generar.
 */
function StockBox({ segments }: { segments: GCodeSegment[] }) {
  const stock = useCAMStore((s) => s.setup.stock)
  const showStock = useGCodeStore((s) => s.showStock)

  const resolved = useMemo(() => {
    if (!stock.enabled) return null
    if (!stock.auto) return stock

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const seg of segments) {
      if (seg.type !== 'cut') continue
      minX = Math.min(minX, seg.from.x, seg.to.x)
      maxX = Math.max(maxX, seg.from.x, seg.to.x)
      minY = Math.min(minY, seg.from.y, seg.to.y)
      maxY = Math.max(maxY, seg.from.y, seg.to.y)
    }
    if (!Number.isFinite(minX)) return stock

    const m = Math.max(0, stock.margin)
    return {
      ...stock,
      x: minX - m,
      y: minY - m,
      width: (maxX - minX) + m * 2,
      height: (maxY - minY) + m * 2,
    }
  }, [stock, segments])

  if (!resolved || !showStock || resolved.width <= 0 || resolved.height <= 0) return null

  const thickness = Math.max(0.1, resolved.thickness)
  // zeroAt 'top': el cero de pieza esta en la cara de arriba, el bloque cuelga
  // hacia abajo. 'bottom': el cero esta en la mesa y el bloque sube.
  const top = resolved.zeroAt === 'top' ? 0 : thickness
  const centerY = top - thickness / 2

  const [cx, , cz] = gcodeToThree(
    resolved.x + resolved.width / 2,
    resolved.y + resolved.height / 2,
    0,
  )

  return (
    <group position={[cx, centerY, cz]}>
      <mesh>
        <boxGeometry args={[resolved.width, thickness, resolved.height]} />
        <meshStandardMaterial
          color="#c8a27a"
          transparent
          opacity={0.22}
          roughness={0.9}
          metalness={0}
          depthWrite={false}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(resolved.width, thickness, resolved.height)]} />
        <lineBasicMaterial color="#8a6a45" transparent opacity={0.8} />
      </lineSegments>
    </group>
  )
}

/**
 * CAM Setup visuals: draggable tool change area + draggable clamps.
 */
function CAMSetupVisuals() {
  const setup = useCAMStore((s) => s.setup)
  const { updateSetup, updateClamp } = useCAMStore()
  const tcp = setup.toolChangePosition
  const tcs = setup.toolChangeSize
  const isArea = tcs.width > 0 && tcs.height > 0

  const [tcx, tcy, tcz] = gcodeToThree(tcp.x, tcp.y, tcp.z)
  const [tcHover, setTcHover] = useState(false)

  const startDragTC = useDragOnPlane(
    tcp.z,
    useCallback((pos) => {
      updateSetup({
        toolChangePosition: {
          ...useCAMStore.getState().setup.toolChangePosition,
          x: Math.round(pos.x * 10) / 10,
          y: Math.round(pos.y * 10) / 10,
        },
      })
    }, [updateSetup]),
  )

  return (
    <group>
      {/* Tool change position/area */}
      <group position={[tcx, tcy, tcz]}>
        {isArea ? (
          /* Area mode */
          <mesh
            onPointerDown={startDragTC}
            onPointerOver={() => setTcHover(true)}
            onPointerOut={() => setTcHover(false)}
          >
            <boxGeometry args={[tcs.width, 2, tcs.height]} />
            <meshStandardMaterial
              color="#3b82f6"
              transparent
              opacity={tcHover ? 0.5 : 0.3}
              emissive="#3b82f6"
              emissiveIntensity={0.15}
            />
          </mesh>
        ) : (
          /* Point mode — diamond */
          <mesh
            rotation={[0, Math.PI / 4, 0]}
            onPointerDown={startDragTC}
            onPointerOver={() => setTcHover(true)}
            onPointerOut={() => setTcHover(false)}
          >
            <boxGeometry args={[tcHover ? 5 : 4, tcHover ? 5 : 4, tcHover ? 5 : 4]} />
            <meshStandardMaterial
              color="#3b82f6"
              transparent
              opacity={tcHover ? 0.85 : 0.7}
              emissive="#3b82f6"
              emissiveIntensity={0.2}
            />
          </mesh>
        )}
        {/* Wireframe border for area */}
        {isArea && (
          <mesh>
            <boxGeometry args={[tcs.width, 2, tcs.height]} />
            <meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.6} />
          </mesh>
        )}
        {/* Vertical dashed line to ground */}
        <Line
          points={[[0, -tcy, 0], [0, 0, 0]]}
          color="#3b82f6"
          lineWidth={1}
          dashed
          dashSize={3}
          gapSize={2}
        />
      </group>

      {/* Clamps — draggable red boxes */}
      {setup.clamps.map((clamp) => (
        <DraggableClamp key={clamp.id} clampId={clamp.id} />
      ))}
    </group>
  )
}

/**
 * Clamp shape: T-profile (base bar + top jaw + bolt knob).
 * Looks like a real toggle clamp / hold-down clamp.
 */
function DraggableClamp({ clampId }: { clampId: string }) {
  const clamp = useCAMStore((s) => s.setup.clamps.find((c) => c.id === clampId))
  const { updateClamp } = useCAMStore()
  const [hovered, setHovered] = useState(false)

  const startDrag = useDragOnPlane(
    0,
    useCallback((pos) => {
      const c = useCAMStore.getState().setup.clamps.find((cl) => cl.id === clampId)
      if (!c) return
      updateClamp(clampId, {
        x: Math.round((pos.x - c.width / 2) * 10) / 10,
        y: Math.round((pos.y - c.height / 2) * 10) / 10,
      })
    }, [clampId, updateClamp]),
  )

  if (!clamp) return null

  const [cx, , cz] = gcodeToThree(clamp.x + clamp.width / 2, clamp.y + clamp.height / 2, 0)
  const w = clamp.width
  const d = clamp.height // depth (G-code Y = Three.js Z)
  const isInfinite = clamp.zHeight === 0
  const visH = isInfinite ? 15 : clamp.zHeight // visual height
  const baseH = 3 // base plate
  const jawH = visH - baseH
  const color = hovered ? '#f87171' : '#dc2626'
  const opacity = hovered ? 0.7 : 0.55

  return (
    <group
      position={[cx, 0, cz]}
      onPointerDown={startDrag}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* Base plate — wide flat bar on surface */}
      <mesh position={[0, baseH / 2, 0]}>
        <boxGeometry args={[w, baseH, d]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} metalness={0.4} roughness={0.6} />
      </mesh>

      {/* Jaw / pressure arm — narrower, taller, centered */}
      <mesh position={[0, baseH + jawH / 2, 0]}>
        <boxGeometry args={[w * 0.6, jawH, d * 0.5]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} metalness={0.4} roughness={0.6} />
      </mesh>

      {/* Bolt knob on top */}
      <mesh position={[0, baseH + jawH + 1.5, 0]}>
        <cylinderGeometry args={[w * 0.15, w * 0.2, 3, 8]} />
        <meshStandardMaterial color="#991b1b" transparent opacity={opacity} metalness={0.5} roughness={0.4} />
      </mesh>

      {/* Infinite height indicator — dashed line going up */}
      {isInfinite && (
        <Line
          points={[[0, visH + 3, 0], [0, visH + 20, 0]]}
          color="#ef4444"
          lineWidth={1}
          dashed
          dashSize={2}
          gapSize={2}
        />
      )}

      {/* Wireframe footprint on surface */}
      <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color="#ef4444" wireframe transparent opacity={0.4} side={2} />
      </mesh>
    </group>
  )
}

/**
 * OrbitControls that auto-disables during 3D object dragging.
 */
function OrbitControlsWithDrag({ centerX, centerZ, maxDist }: { centerX: number; centerZ: number; maxDist: number }) {
  const controlsRef = useRef<any>(null)

  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.enabled = !dragState.active
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.1}
      target={[centerX, 0, centerZ]}
      maxPolarAngle={Math.PI}
      minDistance={50}
      maxDistance={maxDist}
    />
  )
}

/**
 * Ajusta la camara para encuadrar el area de trabajo al montar la escena.
 */
function CameraSetup({ bounds }: {
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}) {
  const { camera } = useThree()
  const hasSetup = useRef(false)

  useEffect(() => {
    if (hasSetup.current) return
    hasSetup.current = true

    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerZ = -(bounds.minY + bounds.maxY) / 2
    const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    const dist = extent / (2 * Math.tan((50 / 2) * Math.PI / 180)) * 1.1

    camera.position.set(centerX, dist, centerZ)
    camera.lookAt(centerX, 0, centerZ)
    camera.updateProjectionMatrix()
  }, [bounds, camera])

  return null
}

function Scene() {
  const { gcode, setViewerStats, setAnimationProgress, setCurrentGCodeLine, viewer3DPlaying, animationSpeed } = useGCodeStore()
  const { workArea } = useCanvasStore()

  const bounds = useMemo(
    () => getWorkAreaBounds(workArea.width, workArea.height, workArea.origin),
    [workArea.width, workArea.height, workArea.origin],
  )

  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = -(bounds.minY + bounds.maxY) / 2

  const parseResult = useMemo(() => {
    if (!gcode || gcode.trim().length === 0) return null
    return parseGCode(gcode)
  }, [gcode])

  useEffect(() => {
    if (parseResult) {
      const { stats } = parseResult
      setViewerStats({
        time: formatTime(stats.estimatedTime),
        distance: `${stats.totalDistance.toFixed(1)} mm`,
        depth: stats.maxDepth > 0 ? `${stats.maxDepth.toFixed(2)} mm` : '0 mm',
      })
    }
  }, [parseResult, setViewerStats])

  useFrame((_, delta) => {
    if (!parseResult) return

    const state = useGCodeStore.getState()
    const current = state.animationProgress
    const segs = parseResult.segments

    // Actualizar linea actual de G-code segun progreso
    if (segs.length > 0) {
      const segIndex = Math.min(
        Math.floor((current / 100) * segs.length),
        segs.length - 1,
      )
      const seg = segs[segIndex]
      if (seg && seg.lineNumber !== state.currentGCodeLine) {
        setCurrentGCodeLine(seg.lineNumber)
      }
    }

    if (!viewer3DPlaying) return

    if (current >= 100) {
      state.setViewer3DPlaying(false)
      return
    }

    const increment = delta * animationSpeed * 10
    const next = Math.min(current + increment, 100)
    setAnimationProgress(next)
  })

  const segments = parseResult?.segments ?? []

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[centerX, 400, centerZ]} intensity={0.8} />
      <CameraSetup bounds={bounds} />
      <WorkArea bounds={bounds} width={workArea.width} height={workArea.height} />
      <StockBox segments={segments} />
      {segments.length > 0 && (
        <>
          <Toolpath segments={segments} />
          <ThickCutLines segments={segments} />
          <ToolIndicator segments={segments} />
        </>
      )}
      <ParkingPositions />
      <CAMSetupVisuals />
      <OrbitControlsWithDrag centerX={centerX} centerZ={centerZ} maxDist={Math.max(workArea.width, workArea.height) * 5} />
      <GizmoHelper alignment="top-left" margin={[80, 80]}>
        <GizmoViewcube
          color="#5B4B9F"
          textColor="#ffffff"
          strokeColor="#3d2e7c"
          hoverColor="#7c6bc4"
          opacity={1}
        />
      </GizmoHelper>
    </>
  )
}

export function GCodeViewer3D() {
  const { t } = useTranslation('gcode')
  const containerRef = useRef<HTMLDivElement>(null)
  const { gcodeGenerated, gcodeNeedsRegeneration } = useGCodeStore()

  if (!gcodeGenerated) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-muted/30">
        <Box className="h-16 w-16 text-muted-foreground mb-4" />
        <p className="text-lg font-medium text-muted-foreground">{t('noGCode')}</p>
        <p className="text-sm text-muted-foreground mt-1">{t('generateFirst')}</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="viewer-3d-container w-full h-full relative">
      {gcodeNeedsRegeneration && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-md shadow-lg backdrop-blur-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">{t('designChanged')}</span>
        </div>
      )}
      <Canvas
        camera={{
          fov: 50,
          near: 0.1,
          far: 10000,
        }}
        gl={{ antialias: true }}
      >
        <Scene />
      </Canvas>
    </div>
  )
}
