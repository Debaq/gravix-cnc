import { create } from 'zustand'
import type { MachiningEstimates } from '@/lib/types'

interface GCodeState {
  // G-code
  gcode: string
  gcodeGenerated: boolean
  gcodeNeedsRegeneration: boolean
  gcodeLines: number

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
  viewer3DPlaying: boolean
  viewer3DCurrentPass: number

  // Actions
  setGCode: (gcode: string) => void
  setGCodeGenerated: (generated: boolean) => void
  setGCodeNeedsRegeneration: (needs: boolean) => void
  setEstimates: (estimates: MachiningEstimates) => void
  setAnimationSpeed: (speed: number) => void
  setAnimationProgress: (progress: number) => void
  toggle3DGrid: () => void
  toggle3DAxes: () => void
  setViewer3DPlaying: (playing: boolean) => void
  setViewer3DCurrentPass: (pass: number) => void
  setViewerStats: (stats: { time?: string | null; distance?: string | null; depth?: string | null }) => void
  clearGCode: () => void
}

export const useGCodeStore = create<GCodeState>((set) => ({
  // G-code
  gcode: '',
  gcodeGenerated: false,
  gcodeNeedsRegeneration: false,
  gcodeLines: 0,

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
  viewer3DPlaying: false,
  viewer3DCurrentPass: 0,

  // Actions
  setGCode: (gcode) =>
    set({
      gcode,
      gcodeLines: gcode.split('\n').length,
      gcodeGenerated: gcode.length > 0,
      gcodeNeedsRegeneration: false,
    }),

  setGCodeGenerated: (generated) => set({ gcodeGenerated: generated }),

  setGCodeNeedsRegeneration: (needs) => set({ gcodeNeedsRegeneration: needs }),

  setEstimates: (estimates) => set({ estimates }),

  setAnimationSpeed: (speed) => set({ animationSpeed: speed }),

  setAnimationProgress: (progress) => set({ animationProgress: progress }),

  toggle3DGrid: () => set((state) => ({ show3DGrid: !state.show3DGrid })),

  toggle3DAxes: () => set((state) => ({ show3DAxes: !state.show3DAxes })),

  setViewer3DPlaying: (playing) => set({ viewer3DPlaying: playing }),

  setViewer3DCurrentPass: (pass) => set({ viewer3DCurrentPass: pass }),

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
      estimates: { time: '-', distance: '-' },
      estimatedTime: null,
      totalDistance: null,
      maxDepth: null,
    }),
}))
