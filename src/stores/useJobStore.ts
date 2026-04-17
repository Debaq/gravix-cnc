import { create } from 'zustand'

export interface Job {
  id: string
  name: string
  gcode: string
  status: 'queued' | 'approved' | 'running' | 'completed' | 'cancelled' | { error: string }
  created_by: string
  created_at: string
  tool?: string
  material?: string
  estimated_time?: string
  notes?: string
}

interface JobState {
  jobs: Job[]
  setJobs: (jobs: Job[]) => void
  addJob: (job: Job) => void
  removeJob: (id: string) => void
  updateJob: (id: string, updates: Partial<Job>) => void
}

export const useJobStore = create<JobState>((set) => ({
  jobs: [],
  setJobs: (jobs) => set({ jobs }),
  addJob: (job) => set((s) => ({ jobs: [...s.jobs, job] })),
  removeJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
  updateJob: (id, updates) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...updates } : j)),
    })),
}))
