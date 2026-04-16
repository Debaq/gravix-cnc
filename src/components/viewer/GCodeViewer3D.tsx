import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, Line, GizmoHelper, GizmoViewcube } from '@react-three/drei'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
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

  const { rapidPoints, rapidColors, cutPoints, cutColors, totalSegments } = useMemo(() => {
    const rp: number[] = []
    const rc: number[] = []
    const cp: number[] = []
    const cc: number[] = []

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const [fx, fy, fz] = gcodeToThree(seg.from.x, seg.from.y, seg.from.z)
      const [tx, ty, tz] = gcodeToThree(seg.to.x, seg.to.y, seg.to.z)

      if (seg.type === 'rapid') {
        rp.push(fx, fy, fz, tx, ty, tz)
        rc.push(0.2, 0.5, 1.0, 0.2, 0.5, 1.0)
      } else {
        cp.push(fx, fy, fz, tx, ty, tz)
        let r: number, g: number, b: number
        if (seg.color) {
          // Use path color from plotter/laser color mapping
          const hex = seg.color.replace('#', '')
          r = parseInt(hex.slice(0, 2), 16) / 255
          g = parseInt(hex.slice(2, 4), 16) / 255
          b = parseInt(hex.slice(4, 6), 16) / 255
        } else {
          const depth = Math.min(Math.abs(fy), 10) / 10
          r = 1.0
          g = 0.15 + (1 - depth) * 0.2
          b = 0.1 + (1 - depth) * 0.15
        }
        cc.push(r, g, b, r, g, b)
      }
    }

    return {
      rapidPoints: new Float32Array(rp),
      rapidColors: new Float32Array(rc),
      cutPoints: new Float32Array(cp),
      cutColors: new Float32Array(cc),
      totalSegments: segments.length,
    }
  }, [segments])

  const rapidRef = useRef<THREE.LineSegments>(null)
  const cutRef = useRef<THREE.LineSegments>(null)

  const rapidSegCount = rapidPoints.length / 6
  const cutSegCount = cutPoints.length / 6

  useFrame(() => {
    if (!viewer3DPlaying && animationProgress >= 100) return

    const progress = animationProgress / 100
    const visibleSegments = Math.floor(progress * totalSegments)

    let rapidsShown = 0
    let cutsShown = 0
    for (let i = 0; i < Math.min(visibleSegments, segments.length); i++) {
      if (segments[i].type === 'rapid') rapidsShown++
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

function ToolIndicator({ segments }: { segments: GCodeSegment[] }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const { animationProgress, viewer3DPlaying } = useGCodeStore()

  useFrame(() => {
    if (!meshRef.current || segments.length === 0) return

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
    meshRef.current.position.set(tx, ty, tz)
    meshRef.current.visible = viewer3DPlaying || animationProgress < 100
  })

  if (segments.length === 0) return null

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[2, 16, 16]} />
      <meshBasicMaterial color="#FFD700" />
    </mesh>
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
      {segments.length > 0 && (
        <>
          <Toolpath segments={segments} />
          <ThickCutLines segments={segments} />
          <ToolIndicator segments={segments} />
        </>
      )}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        target={[centerX, 0, centerZ]}
        maxPolarAngle={Math.PI}
        minDistance={50}
        maxDistance={Math.max(workArea.width, workArea.height) * 5}
      />
      <GizmoHelper alignment="top-right" margin={[80, 80]}>
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
