import { useTranslation } from 'react-i18next'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  ArrowUp,
  Maximize,
  ArrowRight,
  Box,
} from 'lucide-react'

export function PreviewPanel() {
  const { t } = useTranslation('gcode')

  const {
    gcodeGenerated,
    gcodeLines,
    estimates,
    estimatedTime,
    totalDistance,
    maxDepth,
    viewer3DPlaying,
    animationSpeed,
    animationProgress,
    setAnimationSpeed,
    setViewer3DPlaying,
    setAnimationProgress,
  } = useGCodeStore()

  if (!gcodeGenerated) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Box className="h-12 w-12 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">{t('noGCode')}</p>
        <p className="text-xs text-muted-foreground mt-1">{t('generateFirst')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('estimates')}</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted rounded-md p-2">
            <p className="text-xs text-muted-foreground">{t('time')}</p>
            <p className="text-sm font-medium">{estimatedTime || estimates.time}</p>
          </div>
          <div className="bg-muted rounded-md p-2">
            <p className="text-xs text-muted-foreground">{t('distance')}</p>
            <p className="text-sm font-medium">{totalDistance || estimates.distance}</p>
          </div>
          <div className="bg-muted rounded-md p-2">
            <p className="text-xs text-muted-foreground">{t('depth')}</p>
            <p className="text-sm font-medium">{maxDepth || '-'}</p>
          </div>
          <div className="bg-muted rounded-md p-2">
            <p className="text-xs text-muted-foreground">{t('lines')}</p>
            <p className="text-sm font-medium">{gcodeLines}</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Playback controls */}
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setViewer3DPlaying(false)
              setAnimationProgress(0)
            }}
          >
            <Square className="h-4 w-4" />
          </Button>
          <Button
            variant={viewer3DPlaying ? 'outline' : 'default'}
            size="icon"
            onClick={() => setViewer3DPlaying(!viewer3DPlaying)}
          >
            {viewer3DPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>{animationProgress}%</span>
            <span>100%</span>
          </div>
          <Slider
            value={[animationProgress]}
            onValueChange={([val]) => setAnimationProgress(val)}
            max={100}
            step={1}
          />
        </div>

        {/* Speed control */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{t('speed')}</span>
            <span className="font-medium">{animationSpeed}x</span>
          </div>
          <Slider
            value={[animationSpeed]}
            onValueChange={([val]) => setAnimationSpeed(val)}
            min={0.1}
            max={5}
            step={0.1}
          />
        </div>
      </div>

      <Separator />

      {/* Camera views */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('resetCamera')}</h3>
        <div className="grid grid-cols-2 gap-1">
          <Button variant="outline" size="sm" className="text-xs">
            <ArrowUp className="h-3 w-3 mr-1" />
            {t('topView')}
          </Button>
          <Button variant="outline" size="sm" className="text-xs">
            <Maximize className="h-3 w-3 mr-1" />
            {t('frontView')}
          </Button>
          <Button variant="outline" size="sm" className="text-xs">
            <ArrowRight className="h-3 w-3 mr-1" />
            {t('sideView')}
          </Button>
          <Button variant="outline" size="sm" className="text-xs">
            <RotateCcw className="h-3 w-3 mr-1" />
            {t('perspectiveView')}
          </Button>
        </div>
      </div>
    </div>
  )
}
