import { create } from 'zustand'
import type { MachiningEstimates } from '@/lib/types'

/** Criterio de color del toolpath en el visor 3D. */
export type ViewerColorMode = 'default' | 'feed' | 'depth'

interface GCodeState {
  // G-code
  gcode: string
  gcodeGenerated: boolean
  gcodeNeedsRegeneration: boolean
  gcodeLines: number
  /** Generacion en curso. La generacion de raster y de miles de paths bloquea
   *  el hilo varios segundos; sin esto la UI parece colgada. */
  generating: boolean

  // Estimates
  estimates: MachiningEstimates

  // 3D Viewer
  estimatedTime: string | null
  totalDistance: string | null
  maxDepth: string | null
  animationSpeed: number
  animationProgress: number
  show3DGrid: boolean
  show3DAxes: boolean
  /** Con que se pinta el toolpath en el visor. */
  viewerColorMode: ViewerColorMode
  /** Dibujar el bloque de material. */
  showStock: boolean
  viewer3DPlaying: boolean
  viewer3DCurrentPass: number
  currentGCodeLine: number

  // Actions
  setGCode: (gcode: string) => void
  setGCodeNeedsRegeneration: (needs: boolean) => void
  setGenerating: (generating: boolean) => void
  setEstimates: (estimates: MachiningEstimates) => void
  setAnimationSpeed: (speed: number) => void
  setAnimationProgress: (progress: number) => void
  toggle3DGrid: () => void
  toggle3DAxes: () => void
  setViewerColorMode: (mode: ViewerColorMode) => void
  toggleStock: () => void
  setViewer3DPlaying: (playing: boolean) => void
  setViewer3DCurrentPass: (pass: number) => void
  setCurrentGCodeLine: (line: number) => void
  setViewerStats: (stats: { time?: string | null; distance?: string | null; depth?: string | null }) => void
  clearGCode: () => void
}

export const useGCodeStore = create<GCodeState>((set) => ({
  // G-code
  gcode: '',
  gcodeGenerated: false,
  gcodeNeedsRegeneration: false,
  gcodeLines: 0,
  generating: false,

  // Estimates
  estimates: { time: '-', distance: '-' },

  // 3D Viewer
  estimatedTime: null,
  totalDistance: null,
  maxDepth: null,
  animationSpeed: 1,
  animationProgress: 0,
  show3DGrid: true,
  show3DAxes: true,
  viewerColorMode: 'default',
  showStock: true,
  viewer3DPlaying: false,
  viewer3DCurrentPass: 0,
  currentGCodeLine: 0,

  // Actions
  setGCode: (gcode) =>
    set({
      gcode,
      gcodeLines: gcode.split('\n').length,
      gcodeGenerated: gcode.length > 0,
      gcodeNeedsRegeneration: false,
    }),

  setGCodeNeedsRegeneration: (needs) => set({ gcodeNeedsRegeneration: needs }),

  setGenerating: (generating) => set({ generating }),

  setEstimates: (estimates) => set({ estimates }),

  setAnimationSpeed: (speed) => set({ animationSpeed: speed }),

  setAnimationProgress: (progress) => set({ animationProgress: progress }),

  toggle3DGrid: () => set((state) => ({ show3DGrid: !state.show3DGrid })),

  toggle3DAxes: () => set((state) => ({ show3DAxes: !state.show3DAxes })),

  setViewerColorMode: (mode) => set({ viewerColorMode: mode }),

  toggleStock: () => set((state) => ({ showStock: !state.showStock })),

  setViewer3DPlaying: (playing) => set({ viewer3DPlaying: playing }),

  setViewer3DCurrentPass: (pass) => set({ viewer3DCurrentPass: pass }),

  setCurrentGCodeLine: (line) => set({ currentGCodeLine: line }),

  setViewerStats: (stats) =>
    set((state) => ({
      estimatedTime: stats.time ?? state.estimatedTime,
      totalDistance: stats.distance ?? state.totalDistance,
      maxDepth: stats.depth ?? state.maxDepth,
    })),

  clearGCode: () =>
    set({
      gcode: '',
      gcodeGenerated: false,
      gcodeNeedsRegeneration: false,
      gcodeLines: 0,
      generating: false,
      estimates: { time: '-', distance: '-' },
      estimatedTime: null,
      totalDistance: null,
      maxDepth: null,
    }),
}))
