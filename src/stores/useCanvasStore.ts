import { create } from 'zustand'
import type { CanvasElement, WorkArea, GlobalConfig } from '@/lib/types'

interface CanvasState {
  // Elements
  elements: CanvasElement[]
  selectedElementId: string | null
  selectedElements: CanvasElement[]
  isGroupSelection: boolean
  showPropertiesPanel: boolean

  // Work area
  workArea: WorkArea

  // Grid
  gridSize: number
  showGrid: boolean

  // SVG info
  svgX: number
  svgY: number
  svgWidth: number
  svgHeight: number
  proportionalScale: boolean

  // Config status
  configStatus: 'unified' | 'multiple' | 'none'

  // Global config
  globalConfig: GlobalConfig

  // Actions
  addElement: (element: CanvasElement) => void
  removeElement: (id: string) => void
  updateElement: (id: string, updates: Partial<CanvasElement>) => void
  setElements: (elements: CanvasElement[]) => void
  selectElement: (id: string | null) => void
  setSelectedElements: (elements: CanvasElement[]) => void
  setIsGroupSelection: (is: boolean) => void
  setShowPropertiesPanel: (show: boolean) => void
  setWorkArea: (wa: WorkArea) => void
  setGridSize: (size: number) => void
  toggleGrid: () => void
  setSvgDimensions: (dims: { x?: number; y?: number; width?: number; height?: number }) => void
  toggleProportionalScale: () => void
  setGlobalConfig: (config: Partial<GlobalConfig>) => void
  updateConfigStatus: () => void
  findElementById: (id: string) => CanvasElement | undefined
  getElementConfig: (element: CanvasElement) => GlobalConfig
}

const defaultGlobalConfig: GlobalConfig = {
  operationType: 'cnc',
  tool: '',
  material: '',
  workType: 'outline',
  feedRate: 800,
  plungeRate: 400,
  spindleRPM: 10000,
  laserPower: 80,
  passes: 1,
  depth: -3,
  depthStep: 1,
  toolDiameter: 3.175,
  compensation: 'center',
  pressure: 15,
  speed: 100,
  pressureZ: -1,
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // Elements
  elements: [],
  selectedElementId: null,
  selectedElements: [],
  isGroupSelection: false,
  showPropertiesPanel: false,

  // Work area
  workArea: { width: 400, height: 400, origin: 'bottom-left' },

  // Grid
  gridSize: 20,
  showGrid: true,

  // SVG info
  svgX: 0,
  svgY: 0,
  svgWidth: 0,
  svgHeight: 0,
  proportionalScale: true,

  // Config status
  configStatus: 'unified',

  // Global config
  globalConfig: { ...defaultGlobalConfig },

  // Actions
  addElement: (element) =>
    set((state) => ({ elements: [...state.elements, element] })),

  removeElement: (id) =>
    set((state) => ({
      elements: state.elements.filter((e) => e.id !== id),
    })),

  updateElement: (id, updates) =>
    set((state) => ({
      elements: state.elements.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    })),

  setElements: (elements) => set({ elements }),

  selectElement: (id) => set({ selectedElementId: id }),

  setSelectedElements: (elements) => set({ selectedElements: elements }),

  setIsGroupSelection: (is) => set({ isGroupSelection: is }),

  setShowPropertiesPanel: (show) => set({ showPropertiesPanel: show }),

  setWorkArea: (wa) => set({ workArea: wa }),

  setGridSize: (size) => set({ gridSize: size }),

  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),

  setSvgDimensions: (dims) =>
    set((state) => ({
      svgX: dims.x ?? state.svgX,
      svgY: dims.y ?? state.svgY,
      svgWidth: dims.width ?? state.svgWidth,
      svgHeight: dims.height ?? state.svgHeight,
    })),

  toggleProportionalScale: () =>
    set((state) => ({ proportionalScale: !state.proportionalScale })),

  setGlobalConfig: (config) =>
    set((state) => ({
      globalConfig: { ...state.globalConfig, ...config },
    })),

  updateConfigStatus: () => {
    const { elements } = get()
    const hasCustomConfig = elements.some((el) => {
      if (el.config) return true
      if (el.children) {
        return el.children.some((c) => c.config)
      }
      return false
    })
    set({ configStatus: hasCustomConfig ? 'multiple' : 'unified' })
  },

  findElementById: (id) => {
    const { elements } = get()
    for (const el of elements) {
      if (el.id === id) return el
      if (el.children) {
        const child = el.children.find((c) => c.id === id)
        if (child) return child
      }
    }
    return undefined
  },

  getElementConfig: (element) => {
    const { elements, globalConfig } = get()
    if (element.config) return element.config
    if (element.parent) {
      const parent = elements.find((e) => e.id === element.parent)
      if (parent?.config) return parent.config
    }
    return globalConfig
  },
}))
