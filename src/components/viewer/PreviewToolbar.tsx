import { useTranslation } from 'react-i18next'
import { useGCodeStore } from '@/stores/useGCodeStore'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Play,
  Pause,
  Square,
  SkipBack,
  Gauge,
} from 'lucide-react'

export function PreviewToolbar() {
  const { t } = useTranslation('gcode')

  const {
    gcodeGenerated,
    gcodeLines,
    currentGCodeLine,
    viewer3DPlaying,
    animationSpeed,
    animationProgress,
    setAnimationSpeed,
    setViewer3DPlaying,
    setAnimationProgress,
  } = useGCodeStore()

  if (!gcodeGenerated) return null

  const handlePlayPause = () => setViewer3DPlaying(!viewer3DPlaying)

  const handleStop = () => {
    setViewer3DPlaying(false)
    setAnimationProgress(0)
  }

  const handleRestart = () => {
    setAnimationProgress(0)
    setViewer3DPlaying(true)
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20">
      {/* Progress bar clickable - full width */}
      <div className="px-3">
        <Slider
          value={[animationProgress]}
          onValueChange={([val]) => setAnimationProgress(val)}
          max={100}
          step={0.1}
          className="cursor-pointer"
        />
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-background/80 backdrop-blur-sm border-t">
        {/* Transport controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRestart}
            title={t('stop')}
          >
            <SkipBack className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleStop}
            title={t('stop')}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewer3DPlaying ? 'secondary' : 'default'}
            size="icon"
            className="h-8 w-8"
            onClick={handlePlayPause}
            title={viewer3DPlaying ? t('pause') : t('play')}
          >
            {viewer3DPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Progress info */}
        <div className="flex-1 text-center">
          <span className="text-xs font-mono text-muted-foreground">
            {currentGCodeLine > 0 ? (
              <>
                {t('line')} <span className="text-foreground font-semibold">{currentGCodeLine}</span> / {gcodeLines}
              </>
            ) : (
              <>{Math.round(animationProgress)}%</>
            )}
          </span>
        </div>

        {/* Speed control */}
        <div className="flex items-center gap-1.5 min-w-[120px]">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Slider
            value={[animationSpeed]}
            onValueChange={([val]) => setAnimationSpeed(val)}
            min={0.1}
            max={5}
            step={0.1}
            className="flex-1"
          />
          <span className="text-xs font-mono text-muted-foreground w-8 text-right shrink-0">
            {animationSpeed.toFixed(1)}x
          </span>
        </div>
      </div>
    </div>
  )
}
