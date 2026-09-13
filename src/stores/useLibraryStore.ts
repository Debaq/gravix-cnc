import { create } from 'zustand'
import type { Tool, Material } from '@/lib/types'
import { useMachineStore } from '@/stores/useMachineStore'

interface LibraryState {
  // Data
  tools: Tool[]
  materials: Material[]

  // Auth

  // Status

  // Modal state
  toolsModalTab: string
  materialsModalTab: string
  editingTool: Tool | null
  editingMaterial: Material | null

  // Actions
  setTools: (tools: Tool[]) => void
  setMaterials: (materials: Material[]) => void
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

  // Status

  // Modal state
  toolsModalTab: 'cnc',
  materialsModalTab: 'wood',
  editingTool: null,
  editingMaterial: null,

  // Actions
  setTools: (tools) => set({ tools }),
  setMaterials: (materials) => set({ materials }),
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
      laser: 'laser',
      plotter: 'plotter',
      pencil: 'pencil',
    }
    const category = categoryMap[operationType]
    if (!category) return []
    const byCategory = get().tools.filter((t) => t.category === category)
    // Filtrar por toolIds de máquina activa si está definido (non-empty = whitelist).
    const active = useMachineStore.getState().getActive()
    if (active && active.toolIds.length > 0) {
      const allowed = new Set(active.toolIds)
      return byCategory.filter((t) => allowed.has(t.id))
    }
    return byCategory
  },
}))
