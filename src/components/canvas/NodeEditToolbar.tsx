import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { toggleConstraint, type NodeConstraint } from '@/lib/constraints'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import {
  X,
  Trash2,
  Spline,
  Scissors,
  Link,
  CornerUpRight,
  Square,
  Dog,
} from 'lucide-react'

export function NodeEditToolbar() {
  const { t } = useTranslation('canvas')
  const nodeEditingElementId = useCanvasStore((s) => s.nodeEditingElementId)
  const selectedNode = useCanvasStore((s) => s.nodeEditSelectedNode)
  const [radius, setRadius] = useState(5)

  if (!nodeEditingElementId) return null

  const hasSelectedNode = selectedNode >= 0

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-background/95 backdrop-blur-sm border rounded-lg px-2 py-1 shadow-lg">
      <span className="text-xs font-medium text-amber-600 px-1 whitespace-nowrap">
        {t('editNodes')}
      </span>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Radius Input */}
      <div className="flex items-center gap-1 px-1">
        <Input 
          type="number" 
          value={radius} 
          onChange={(e) => setRadius(parseFloat(e.target.value) || 0)}
          className="h-7 w-14 text-xs px-1"
          step="0.5"
          min="0"
        />
        <span className="text-[10px] text-muted-foreground mr-1">mm</span>
      </div>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Fillet node */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!hasSelectedNode}
            onClick={() => window.dispatchEvent(new CustomEvent('node-edit:fillet', { detail: { radius } }))}
          >
            <CornerUpRight className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('nodeFillet')}</TooltipContent>
      </Tooltip>

      {/* Chamfer node */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!hasSelectedNode}
            onClick={() => window.dispatchEvent(new CustomEvent('node-edit:chamfer', { detail: { distance: radius } }))}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('nodeChamfer')}</TooltipContent>
      </Tooltip>

      {/* Dog-bone fillet (CNC) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!hasSelectedNode}
            onClick={() => window.dispatchEvent(new CustomEvent('node-edit:dogbone', { detail: { radius } }))}
          >
            <Dog className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('nodeDogbone')}</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Delete node */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!hasSelectedNode}
            onClick={() => window.dispatchEvent(new CustomEvent('node-edit:delete'))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('nodeDeleteNode')} (Supr)</TooltipContent>
      </Tooltip>

      {/* Toggle smooth/corner */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!hasSelectedNode}
            onClick={() => window.dispatchEvent(new CustomEvent('node-edit:toggle-smooth'))}
          >
            <Spline className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('nodeToggleSmooth')}</TooltipContent>
      </Tooltip>

      {/* Split path at node */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!hasSelectedNode}
            onClick={() => window.dispatchEvent(new CustomEvent('node-edit:split'))}
          >
            <Scissors className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('nodeSplitPath')}</TooltipContent>
      </Tooltip>

      {/* Toggle open/close */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => window.dispatchEvent(new CustomEvent('node-edit:toggle-closed'))}
          >
            <Link className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('nodeToggleClosed')}</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Constraints */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 font-bold text-[10px]"
            disabled={!hasSelectedNode}
            onClick={() => {
              const state = useCanvasStore.getState()
              state.setNodeConstraints(
                toggleConstraint(state.nodeConstraints as NodeConstraint[], state.nodeEditSelectedNode, 'horizontal')
              )
            }}
          >
            H
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('constraintH')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 font-bold text-[10px]"
            disabled={!hasSelectedNode}
            onClick={() => {
              const state = useCanvasStore.getState()
              state.setNodeConstraints(
                toggleConstraint(state.nodeConstraints as NodeConstraint[], state.nodeEditSelectedNode, 'vertical')
              )
            }}
          >
            V
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('constraintV')}</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Exit */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => window.dispatchEvent(new CustomEvent('node-edit:exit'))}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('nodeExit')} (Esc)</TooltipContent>
      </Tooltip>
    </div>
  )
}
