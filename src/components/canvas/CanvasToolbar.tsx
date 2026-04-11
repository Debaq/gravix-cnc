import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  FlipHorizontal2,
  FlipVertical2,
} from 'lucide-react'

export function CanvasToolbar() {
  const { t } = useTranslation('canvas')

  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-background/90 backdrop-blur-sm border rounded-lg p-1 shadow-sm">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ZoomIn className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('zoomIn')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ZoomOut className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('zoomOut')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Maximize className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('fitView')}</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <FlipHorizontal2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('flipH')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <FlipVertical2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('flipV')}</TooltipContent>
      </Tooltip>
    </div>
  )
}
