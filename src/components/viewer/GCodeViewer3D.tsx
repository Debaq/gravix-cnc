import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useTranslation } from 'react-i18next'
import { Box } from 'lucide-react'

function WorkArea() {
  return (
    <group>
      {/* Work area grid floor */}
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
      {/* Origin axes */}
      <group>
        {/* X axis - red */}
        <mesh position={[15, 0.1, 0]}>
          <boxGeometry args={[30, 0.5, 0.5]} />
          <meshBasicMaterial color="#FF0000" />
        </mesh>
        {/* Y axis - green (Z in 3D = Y in CNC) */}
        <mesh position={[0, 0.1, 15]}>
          <boxGeometry args={[0.5, 0.5, 30]} />
          <meshBasicMaterial color="#00FF00" />
        </mesh>
        {/* Z axis - blue */}
        <mesh position={[0, 15, 0]}>
          <boxGeometry args={[0.5, 30, 0.5]} />
          <meshBasicMaterial color="#0066FF" />
        </mesh>
      </group>
    </group>
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
        <ambientLight intensity={0.6} />
        <directionalLight position={[200, 400, 200]} intensity={0.8} />
        <WorkArea />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          target={[200, 0, 200]}
        />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.8} />
        </GizmoHelper>
      </Canvas>
    </div>
  )
}
