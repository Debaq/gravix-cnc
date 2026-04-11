import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, Line } from '@react-three/drei'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useTranslation } from 'react-i18next'
import { Box } from 'lucide-react'
import { parseGCode, formatTime } from '@/lib/gcode-parser'
import type { GCodeSegment } from '@/lib/gcode-parser'
import * as THREE from 'three'

/**
 * Map G-code coordinates to Three.js coordinates:
 * G-code X -> Three.js X
 * G-code Y -> Three.js Z
 * G-code Z -> Three.js Y
 */
function gcodeToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y]
}

function WorkArea() {
  const { show3DGrid, show3DAxes } = useGCodeStore()

  return (
    <group>
      {show3DGrid && (
        <Grid
          args={[400, 400]}
          cellSize={20}
          cellThickness={0.5}
          cellColor="#B5A8D6"
          sectionSize={100}
          sectionThickness={1}
          sectionColor="#5B4B9F"
          fadeDistance={500}
          fadeStrength={1}
          followCamera={false}
          position={[200, 0, 200]}
        />
      )}
      {show3DAxes && (
        <group>
          {/* X axis - red */}
          <mesh position={[15, 0.1, 0]}>
            <boxGeometry args={[30, 0.5, 0.5]} />
            <meshBasicMaterial color="#FF0000" />
          </mesh>
          {/* Y axis - green (G-code Y = Three.js Z) */}
          <mesh position={[0, 0.1, 15]}>
            <boxGeometry args={[0.5, 0.5, 30]} />
            <meshBasicMaterial color="#00FF00" />
          </mesh>
          {/* Z axis - blue (G-code Z = Three.js Y) */}
          <mesh position={[0, 15, 0]}>
            <boxGeometry args={[0.5, 30, 0.5]} />
            <meshBasicMaterial color="#0066FF" />
          </mesh>
        </group>
      )}
    </group>
  )
}

interface ToolpathProps {
  segments: GCodeSegment[]
}

/**
 * Renders all G-code toolpath segments using Three.js LineSegments
 * for maximum performance with large G-code files.
 */
function Toolpath({ segments }: ToolpathProps) {
  const { animationProgress, viewer3DPlaying } = useGCodeStore()

  // Separate segments by type for different rendering
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
        // Blue with some transparency effect via lighter shade
        rc.push(0.2, 0.5, 1.0, 0.2, 0.5, 1.0)
      } else {
        cp.push(fx, fy, fz, tx, ty, tz)
        // Red - intensity varies by Z depth for visual depth cue
        const depth = Math.min(Math.abs(fy), 10) / 10 // fy = Three.js Y = G-code Z
        const r = 1.0
        const g = 0.15 + (1 - depth) * 0.2
        const b = 0.1 + (1 - depth) * 0.15
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

  // For animation: control draw range
  const rapidRef = useRef<THREE.LineSegments>(null)
  const cutRef = useRef<THREE.LineSegments>(null)

  // Count segments of each type for animation
  const rapidSegCount = rapidPoints.length / 6
  const cutSegCount = cutPoints.length / 6

  useFrame(() => {
    if (!viewer3DPlaying && animationProgress >= 100) return

    const progress = animationProgress / 100
    const visibleSegments = Math.floor(progress * totalSegments)

    // Determine how many rapid and cut segments to show
    // We need to figure out the order - iterate original segments
    let rapidsShown = 0
    let cutsShown = 0
    for (let i = 0; i < Math.min(visibleSegments, segments.length); i++) {
      if (segments[i].type === 'rapid') rapidsShown++
      else cutsShown++
    }

    if (rapidRef.current) {
      const geom = rapidRef.current.geometry
      geom.setDrawRange(0, rapidsShown * 2) // 2 vertices per segment
    }
    if (cutRef.current) {
      const geom = cutRef.current.geometry
      geom.setDrawRange(0, cutsShown * 2)
    }
  })

  // When not animating (progress = 100), show everything
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
      {/* Rapid movements - dashed blue lines */}
      {rapidSegCount > 0 && (
        <lineSegments ref={rapidRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[rapidPoints, 3]}
            />
            <bufferAttribute
              attach="attributes-color"
              args={[rapidColors, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={0.35}
          />
        </lineSegments>
      )}

      {/* Cut movements - solid red/orange lines */}
      {cutSegCount > 0 && (
        <lineSegments ref={cutRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[cutPoints, 3]}
            />
            <bufferAttribute
              attach="attributes-color"
              args={[cutColors, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            vertexColors
            linewidth={1}
          />
        </lineSegments>
      )}
    </group>
  )
}

/**
 * Tool position indicator - shows a small sphere at the current
 * tool position during animation.
 */
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

    // Interpolation within current segment
    const segProgress = (progress * segments.length) - segIndex
    const seg = segments[segIndex]

    if (!seg) return

    const x = seg.from.x + (seg.to.x - seg.from.x) * Math.min(segProgress, 1)
    const y = seg.from.y + (seg.to.y - seg.from.y) * Math.min(segProgress, 1)
    const z = seg.from.z + (seg.to.z - seg.from.z) * Math.min(segProgress, 1)

    const [tx, ty, tz] = gcodeToThree(x, y, z)
    meshRef.current.position.set(tx, ty, tz)

    // Show only during animation
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

/**
 * Thick cut lines using drei's Line component for better visibility.
 * This is a secondary rendering pass for the cut path with wider lines.
 */
function ThickCutLines({ segments }: { segments: GCodeSegment[] }) {
  const { animationProgress, viewer3DPlaying } = useGCodeStore()

  const cutLinePoints = useMemo(() => {
    // Build continuous polylines from consecutive cut segments
    const polylines: [number, number, number][][] = []
    let current: [number, number, number][] = []

    for (const seg of segments) {
      if (seg.type === 'cut') {
        if (current.length === 0) {
          current.push(gcodeToThree(seg.from.x, seg.from.y, seg.from.z))
        }
        current.push(gcodeToThree(seg.to.x, seg.to.y, seg.to.z))
      } else {
        if (current.length >= 2) {
          polylines.push(current)
        }
        current = []
      }
    }
    if (current.length >= 2) {
      polylines.push(current)
    }

    return polylines
  }, [segments])

  if (cutLinePoints.length === 0) return null

  // During animation, only show if fully progressed
  if (viewer3DPlaying && animationProgress < 100) return null

  return (
    <group>
      {cutLinePoints.map((points, i) => (
        <Line
          key={i}
          points={points}
          color="#FF3333"
          lineWidth={2}
          opacity={0.9}
          transparent
        />
      ))}
    </group>
  )
}

function Scene() {
  const { gcode, setViewerStats, setAnimationProgress, viewer3DPlaying, animationSpeed } = useGCodeStore()

  // Parse G-code into segments
  const parseResult = useMemo(() => {
    if (!gcode || gcode.trim().length === 0) return null
    return parseGCode(gcode)
  }, [gcode])

  // Update stats in store when parse result changes
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

  // Animation progress auto-advance
  useFrame((_, delta) => {
    if (!viewer3DPlaying || !parseResult) return

    const current = useGCodeStore.getState().animationProgress
    if (current >= 100) {
      useGCodeStore.getState().setViewer3DPlaying(false)
      return
    }

    // Speed: at speed=1, full animation takes ~10 seconds
    const increment = (delta * animationSpeed * 10)
    const next = Math.min(current + increment, 100)
    setAnimationProgress(next)
  })

  const segments = parseResult?.segments ?? []

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[200, 400, 200]} intensity={0.8} />
      <WorkArea />
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
        target={[200, 0, 200]}
      />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport labelColor="white" axisHeadScale={0.8} />
      </GizmoHelper>
    </>
  )
}

export function GCodeViewer3D() {
  const { t } = useTranslation('gcode')
  const containerRef = useRef<HTMLDivElement>(null)
  const { gcodeGenerated } = useGCodeStore()

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
    <div ref={containerRef} className="viewer-3d-container w-full h-full">
      <Canvas
        camera={{
          position: [300, 300, 300],
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
