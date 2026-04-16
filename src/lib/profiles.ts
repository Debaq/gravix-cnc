import type { GlobalConfig, WorkArea } from './types'

// ============================================
// Machine Profiles
// ============================================

export interface MachineProfile {
  id: string
  name: string
  type: 'cnc' | 'laser' | 'plotter' | 'multi'
  workArea: WorkArea
  firmware: 'grbl' | 'grbl-hal' | 'marlin'
  baudRate: number
  maxTravel: { x: number; y: number; z: number }
  maxFeedRate: { x: number; y: number; z: number }
  homingEnabled: boolean
  laserMode: boolean
  notes?: string
}

const PROFILES_KEY = 'gravix_machine_profiles'
const ACTIVE_PROFILE_KEY = 'gravix_active_profile'

export function loadMachineProfiles(): MachineProfile[] {
  try {
    const data = localStorage.getItem(PROFILES_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}

export function saveMachineProfiles(profiles: MachineProfile[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
}

export function getActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_KEY)
}

export function setActiveProfileId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_PROFILE_KEY, id)
  else localStorage.removeItem(ACTIVE_PROFILE_KEY)
}

export function exportProfiles(profiles: MachineProfile[]): void {
  const json = JSON.stringify(profiles, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'machine-profiles.json'; a.click()
  URL.revokeObjectURL(url)
}

export async function importProfiles(): Promise<MachineProfile[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) { resolve(null); return }
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        resolve(Array.isArray(data) ? data : null)
      } catch { resolve(null) }
    }
    input.click()
  })
}

// ============================================
// Toolpath Templates
// ============================================

export interface ToolpathTemplate {
  id: string
  name: string
  operationType: string
  config: Partial<GlobalConfig>
  createdAt: string
}

const TEMPLATES_KEY = 'gravix_toolpath_templates'

export function loadToolpathTemplates(): ToolpathTemplate[] {
  try {
    const data = localStorage.getItem(TEMPLATES_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}

export function saveToolpathTemplates(templates: ToolpathTemplate[]): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates))
}

export function createTemplate(name: string, config: GlobalConfig): ToolpathTemplate {
  return {
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    operationType: config.operationType,
    config: { ...config },
    createdAt: new Date().toISOString(),
  }
}

export function exportTemplates(templates: ToolpathTemplate[]): void {
  const json = JSON.stringify(templates, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'toolpath-templates.json'; a.click()
  URL.revokeObjectURL(url)
}
