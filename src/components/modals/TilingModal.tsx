import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import { useProject } from '@/hooks/useProject'
import { GCodeGenerator } from '@/lib/gcode-generator'
import { computeTileGrid, generateTiles, tileHeader } from '@/lib/tiling'
import type { Tile, TilingConfig } from '@/lib/tiling'
import type { GCodeJob } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TileBucket {
  key: string
  tile: Tile
  jobs: GCodeJob[]
  pathCount: number
}

export function TilingModal() {
  const { t } = useTranslation('canvas')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const workArea = useCanvasStore((s) => s.workArea)
  const { getJobsForGCode } = useCanvasManager()
  const project = useProject()

  const isOpen = activeModal === 'tiling'

  const [tileWidth, setTileWidth] = useState(workArea.width)
  const [tileHeight, setTileHeight] = useState(workArea.height)
  const [overlap, setOverlap] = useState(5)
  const [margin, setMargin] = useState(0)
  const [exporting, setExporting] = useState(false)

  const config: TilingConfig = useMemo(
    () => ({ tileWidth, tileHeight, overlap, margin }),
    [tileWidth, tileHeight, overlap, margin],
  )

  /**
   * Cada job se tilea contra la MISMA grilla global; si cada uno calculara
   * su propio bbox, las piezas de tiles distintos no encajarían.
   */
  const buckets = useMemo<TileBucket[]>(() => {
    if (!isOpen) return []
    if (tileWidth <= overlap || tileHeight <= overlap) return []

    const jobs = getJobsForGCode()
    const allPaths = jobs.flatMap((j) => j.paths)
    if (allPaths.length === 0) return []

    const grid = computeTileGrid(allPaths, config)
    const byKey = new Map<string, TileBucket>()

    for (const job of jobs) {
      for (const tile of generateTiles(job.paths, { ...config, grid })) {
        const key = `r${tile.row}c${tile.col}`
        let bucket = byKey.get(key)
        if (!bucket) {
          bucket = { key, tile, jobs: [], pathCount: 0 }
          byKey.set(key, bucket)
        }
        bucket.jobs.push({ ...job, paths: tile.paths })
        bucket.pathCount += tile.paths.length
      }
    }

    return [...byKey.values()].sort(
      (a, b) => a.tile.row - b.tile.row || a.tile.col - b.tile.col,
    )
  }, [isOpen, config, tileWidth, overlap, tileHeight, getJobsForGCode])

  const handleExport = async () => {
    if (buckets.length === 0) return
    setExporting(true)
    try {
      for (let i = 0; i < buckets.length; i++) {
        const bucket = buckets[i]
        const generator = new GCodeGenerator()
        const body = await generator.generateFromJobs(bucket.jobs)
        const gcode = [...tileHeader(bucket.tile, buckets.length, i), body].join('\n')
        const name = `tile_r${bucket.tile.row + 1}c${bucket.tile.col + 1}.gcode`
        await project.downloadGCode(gcode, name)
      }
      addConsoleLine(`Tiling: ${buckets.length} archivo(s) exportado(s)`)
      closeModal()
    } finally {
      setExporting(false)
    }
  }

  if (!isOpen) return null

  const tooSmall = tileWidth <= overlap || tileHeight <= overlap

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-[460px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('tiling.title') || 'Dividir en tiles'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">
            {t('tiling.hint') ||
              'Parte un trabajo más grande que el área de la máquina en varios G-code, uno por tile. Cada archivo usa coordenadas locales: reposiciona el material en el origen del tile antes de correrlo.'}
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('tiling.tileWidth') || 'Ancho del tile (mm)'}</Label>
              <Input
                type="number"
                value={tileWidth}
                onChange={(e) => setTileWidth(parseFloat(e.target.value) || 0)}
                min="1"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('tiling.tileHeight') || 'Alto del tile (mm)'}</Label>
              <Input
                type="number"
                value={tileHeight}
                onChange={(e) => setTileHeight(parseFloat(e.target.value) || 0)}
                min="1"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('tiling.overlap') || 'Solape (mm)'}</Label>
              <Input
                type="number"
                value={overlap}
                onChange={(e) => setOverlap(parseFloat(e.target.value) || 0)}
                min="0"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('tiling.margin') || 'Margen (mm)'}</Label>
              <Input
                type="number"
                value={margin}
                onChange={(e) => setMargin(parseFloat(e.target.value) || 0)}
                min="0"
              />
            </div>
          </div>

          <div className="border rounded-md p-3 text-xs space-y-1 max-h-48 overflow-y-auto">
            {tooSmall ? (
              <p className="text-destructive">
                {t('tiling.overlapTooBig') || 'El solape debe ser menor que el tamaño del tile'}
              </p>
            ) : buckets.length === 0 ? (
              <p className="text-muted-foreground">
                {t('tiling.noPaths') || 'No hay elementos válidos en el lienzo'}
              </p>
            ) : (
              <>
                <p className="font-medium">
                  {buckets.length} {t('tiling.tiles') || 'tiles'}
                </p>
                {buckets.map((b) => (
                  <p key={b.key} className="font-mono text-muted-foreground">
                    r{b.tile.row + 1}c{b.tile.col + 1} · X{b.tile.x.toFixed(1)} Y{b.tile.y.toFixed(1)} ·{' '}
                    {b.pathCount} paths
                  </p>
                ))}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleExport}
            disabled={buckets.length === 0 || tooSmall || exporting}
            className="w-full"
          >
            {exporting
              ? t('tiling.exporting') || 'Exportando...'
              : `${t('tiling.export') || 'Exportar'} ${buckets.length || ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
