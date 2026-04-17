import { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useJobStore, type Job } from '@/stores/useJobStore'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { getClientRole } from '@/lib/client-role'
import { tauriInvoke, isRemote, isTauri } from '@/lib/tauri'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Plus,
  Trash2,
  Check,
  X,
  Play,
  Clock,
  User,
} from 'lucide-react'

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-yellow-500/20 text-yellow-500',
  approved: 'bg-blue-500/20 text-blue-500',
  running: 'bg-green-500/20 text-green-500',
  completed: 'bg-green-700/20 text-green-700',
  cancelled: 'bg-gray-500/20 text-gray-500',
}

function statusLabel(status: Job['status']): string {
  if (typeof status === 'string') return status
  return `error: ${status.error}`
}

function statusColor(status: Job['status']): string {
  if (typeof status === 'string') return STATUS_COLORS[status] || ''
  return 'bg-red-500/20 text-red-500'
}

export function JobQueuePanel() {
  const { t } = useTranslation('gcode')
  const { jobs, setJobs, addJob, removeJob, updateJob } = useJobStore()
  const gcode = useGCodeStore((s) => s.gcode)
  const projectName = useCanvasStore((s) => s.workArea)
  const role = getClientRole()

  // Cargar jobs al montar
  const loadJobs = useCallback(async () => {
    if (!isTauri() && !isRemote()) return
    try {
      const result = await tauriInvoke<Job[]>('get_jobs')
      setJobs(result)
    } catch {
      // Endpoint puede no existir si se usa Tauri sin web server
    }
  }, [setJobs])

  useEffect(() => {
    loadJobs()
    const interval = setInterval(loadJobs, 5000)
    return () => clearInterval(interval)
  }, [loadJobs])

  const handleSendToQueue = useCallback(async () => {
    if (!gcode) return
    try {
      const job = await tauriInvoke<Job>('create_job', {
        id: '',
        name: `Trabajo ${new Date().toLocaleString()}`,
        gcode,
        status: 'queued',
        created_by: role === 'local' ? 'local' : window.location.hostname,
        created_at: new Date().toISOString(),
      })
      addJob(job)
    } catch (err) {
      console.error('Error creando trabajo:', err)
    }
  }, [gcode, role, addJob])

  const handleApprove = useCallback(async (id: string) => {
    try {
      await tauriInvoke('approve_job', { id })
      updateJob(id, { status: 'approved' })
    } catch (err) {
      console.error('Error aprobando:', err)
    }
  }, [updateJob])

  const handleCancel = useCallback(async (id: string) => {
    try {
      await tauriInvoke('cancel_job', { id })
      updateJob(id, { status: 'cancelled' })
    } catch (err) {
      console.error('Error cancelando:', err)
    }
  }, [updateJob])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await tauriInvoke('delete_job', { id })
      removeJob(id)
    } catch (err) {
      console.error('Error eliminando:', err)
    }
  }, [removeJob])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold">Cola de trabajos</h3>
        {gcode && (
          <Button size="sm" variant="outline" className="gap-1" onClick={handleSendToQueue}>
            <Plus className="h-3 w-3" />
            Enviar a cola
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {jobs.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No hay trabajos en la cola
            </p>
          )}

          {jobs.map((job) => (
            <div
              key={job.id}
              className="border rounded-lg p-3 space-y-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium truncate">{job.name}</span>
                <Badge className={`text-xs ${statusColor(job.status)}`}>
                  {statusLabel(job.status)}
                </Badge>
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {job.created_by}
                </span>
                {job.estimated_time && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {job.estimated_time}
                  </span>
                )}
              </div>

              {job.notes && (
                <p className="text-xs text-muted-foreground">{job.notes}</p>
              )}

              <div className="flex items-center gap-1 pt-1">
                {role === 'local' && job.status === 'queued' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => handleApprove(job.id)}
                  >
                    <Check className="h-3 w-3" />
                    Aprobar
                  </Button>
                )}
                {role === 'local' && (job.status === 'queued' || job.status === 'approved') && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => handleCancel(job.id)}
                  >
                    <X className="h-3 w-3" />
                    Cancelar
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs text-destructive ml-auto"
                  onClick={() => handleDelete(job.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
