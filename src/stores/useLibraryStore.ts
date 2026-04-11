import { create } from 'zustand'
import type { Tool, Material } from '@/lib/types'

interface LibraryState {
  // Data
  tools: Tool[]
  materials: Material[]

  // Auth
  authenticated: boolean
  authPassword: string

  // Status
  toolsStatus: { type: string; message: string } | null
  materialsStatus: { type: string; message: string } | null

  // Modal state
  toolsModalTab: string
  materialsModalTab: string
  editingTool: Tool | null
  editingMaterial: Material | null

  // Actions
  setTools: (tools: Tool[]) => void
  setMaterials: (materials: Material[]) => void
  setAuthenticated: (auth: boolean) => void
  setAuthPassword: (pwd: string) => void
  setToolsStatus: (status: { type: string; message: string } | null) => void
  setMaterialsStatus: (status: { type: string; message: string } | null) => void
  setToolsModalTab: (tab: string) => void
  setMaterialsModalTab: (tab: string) => void
  setEditingTool: (tool: Tool | null) => void
  setEditingMaterial: (material: Material | null) => void
  getToolsByCategory: (category: string) => Tool[]
  getMaterialsByCategory: (category: string) => Material[]
  getFilteredTools: (operationType: string) => Tool[]
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  // Data
  tools: [],
  materials: [],

  // Auth
  authenticated: false,
  authPassword: '',

  // Status
  toolsStatus: null,
  materialsStatus: null,

  // Modal state
  toolsModalTab: 'cnc',
  materialsModalTab: 'wood',
  editingTool: null,
  editingMaterial: null,

  // Actions
  setTools: (tools) => set({ tools }),
  setMaterials: (materials) => set({ materials }),
  setAuthenticated: (auth) => set({ authenticated: auth }),
  setAuthPassword: (pwd) => set({ authPassword: pwd }),
  setToolsStatus: (status) => set({ toolsStatus: status }),
  setMaterialsStatus: (status) => set({ materialsStatus: status }),
  setToolsModalTab: (tab) => set({ toolsModalTab: tab }),
  setMaterialsModalTab: (tab) => set({ materialsModalTab: tab }),
  setEditingTool: (tool) => set({ editingTool: tool }),
  setEditingMaterial: (material) => set({ editingMaterial: material }),

  getToolsByCategory: (category) => {
    return get().tools.filter((t) => t.category === category)
  },

  getMaterialsByCategory: (category) => {
    return get().materials.filter((m) => m.category === category)
  },

  getFilteredTools: (operationType) => {
    const categoryMap: Record<string, string> = {
      cnc: 'cnc',
      plotter: 'plotter',
      pencil: 'pencil',
    }
    const category = categoryMap[operationType]
    if (!category) return []
    return get().tools.filter((t) => t.category === category)
  },
}))
