import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useSerial } from '@/hooks/useSerial'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  Play,
  Plus,
  Trash2,
  MapPin,
  Zap,
  ChevronUp,
  ChevronDown,
  Square,
  RotateCcw,
  Pause,
  Navigation,
  FileCode,
  GripVertical,
} from 'lucide-react'

export function MacrosWorkflowPanel() {
  const { t } = useTranslation('serial')
  const serial = useSerial()
  const { connected } = useSerialStore()
  const position = useSerialStore((s) => s.position)

  const {
    macros,
    positions,
    addMacro,
    removeMacro,
    addPosition,
    removePosition,
    steps,
    currentStepIndex,
    workflowRunning,
    addStep,
    removeStep,
    moveStep,
    startWorkflow,
    stopWorkflow,
    resetWorkflow,
    clearSteps,
  } = useWorkflowStore()

  const [showNewMacro, setShowNewMacro] = useState(false)
  const [newMacroName, setNewMacroName] = useState('')
  const [newMacroGcode, setNewMacroGcode] = useState('')
  const [newPosName, setNewPosName] = useState('')

  const handleAddMacro = () => {
    if (!newMacroName.trim() || !newMacroGcode.trim()) return
    addMacro({
      id: `macro-${Date.now()}`,
      name: newMacroName,
      gcode: newMacroGcode,
    })
    setNewMacroName('')
    setNewMacroGcode('')
    setShowNewMacro(false)
  }

  const handleSavePosition = () => {
    const name = newPosName.trim() || `Pos ${positions.length + 1}`
    addPosition({
      id: `pos-${Date.now()}`,
      name,
      x: parseFloat(position.x),
      y: parseFloat(position.y),
      z: parseFloat(position.z),
    })
    setNewPosName('')
  }

  const handleRunMacro = (gcode: string) => {
    if (!connected) return
    gcode.split('\n').forEach((line) => {
      const trimmed = line.trim()
      if (trimmed) serial.sendCommand(trimmed)
    })
  }

  const handleGoToPosition = (x: number, y: number, z: number) => {
    if (!connected) return
    serial.sendCommand(`G0 Z5`)
    serial.sendCommand(`G0 X${x} Y${y}`)
    serial.sendCommand(`G0 Z${z}`)
  }

  const addWorkflowStep = (type: 'gcode' | 'macro' | 'pause' | 'goto', name: string, data: string) => {
    addStep({
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      name,
      data,
      status: 'pending',
    })
  }

  const stepStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'default'
      case 'done': return 'success'
      case 'error': return 'destructive'
      default: return 'secondary'
    }
  }

  return (
    <div className="flex flex-col h-full bg-background border rounded-lg">
      {/* Macros & Posiciones — mitad superior */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            {t('macros')}
          </span>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowNewMacro(!showNewMacro)}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-1">
            {showNewMacro && (
              <div className="border rounded p-2 space-y-1.5 bg-muted/50">
                <Input
                  placeholder={t('macroName')}
                  value={newMacroName}
                  onChange={(e) => setNewMacroName(e.target.value)}
                  className="h-7 text-xs"
                />
                <textarea
                  placeholder={t('macroGcode')}
                  value={newMacroGcode}
                  onChange={(e) => setNewMacroGcode(e.target.value)}
                  className="w-full h-14 text-xs font-mono bg-background border rounded px-2 py-1 resize-none"
                />
                <div className="flex gap-1">
                  <Button size="sm" className="h-6 text-xs flex-1" onClick={handleAddMacro}>OK</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowNewMacro(false)}>X</Button>
                </div>
              </div>
            )}

            {macros.map((macro) => (
              <div key={macro.id} className="flex items-center gap-1 group">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs flex-1 justify-start gap-1.5 font-normal"
                  onClick={() => handleRunMacro(macro.gcode)}
                  disabled={!connected}
                  title={macro.gcode}
                >
                  <Play className="h-3 w-3 text-green-500 shrink-0" />
                  <span className="truncate">{macro.name}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                  onClick={() => addWorkflowStep('macro', macro.name, macro.gcode)}
                  title="Agregar al workflow"
                >
                  <Plus className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-destructive"
                  onClick={() => removeMacro(macro.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}

            {macros.length === 0 && !showNewMacro && (
              <p className="text-xs text-muted-foreground text-center py-2">{t('noMacros')}</p>
            )}
          </div>

          <Separator />

          {/* Posiciones */}
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-semibold flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {t('positions')}
            </span>
          </div>
          <div className="px-2 pb-2 space-y-1">
            <div className="flex gap-1">
              <Input
                placeholder={t('positionName')}
                value={newPosName}
                onChange={(e) => setNewPosName(e.target.value)}
                className="h-7 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs shrink-0"
                onClick={handleSavePosition}
                disabled={!connected}
              >
                {t('saveCurrent')}
              </Button>
            </div>

            {positions.map((pos) => (
              <div key={pos.id} className="flex items-center gap-1 group">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs flex-1 justify-start gap-1.5 font-normal"
                  onClick={() => handleGoToPosition(pos.x, pos.y, pos.z)}
                  disabled={!connected}
                >
                  <Navigation className="h-3 w-3 text-blue-500 shrink-0" />
                  <span className="truncate">{pos.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                    {pos.x},{pos.y},{pos.z}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                  onClick={() => addWorkflowStep('goto', pos.name, `${pos.x},${pos.y},${pos.z}`)}
                  title="Agregar al workflow"
                >
                  <Plus className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-destructive"
                  onClick={() => removePosition(pos.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}

            {positions.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">{t('noPositions')}</p>
            )}
          </div>
        </ScrollArea>
      </div>

      <Separator />

      {/* Workflow — mitad inferior */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="text-sm font-semibold">{t('workflow')}</span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => addWorkflowStep('pause', 'Pausa', '')}
            >
              <Pause className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => addWorkflowStep('gcode', 'G-Code', '')}
            >
              <FileCode className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Workflow controls */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b">
          {!workflowRunning ? (
            <Button
              size="sm"
              className="h-6 text-xs flex-1 gap-1"
              onClick={startWorkflow}
              disabled={!connected || steps.length === 0}
            >
              <Play className="h-3 w-3" />
              {t('startWorkflow')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              className="h-6 text-xs flex-1 gap-1"
              onClick={stopWorkflow}
            >
              <Square className="h-3 w-3" />
              {t('stopWorkflow')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            onClick={resetWorkflow}
            disabled={workflowRunning}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            onClick={clearSteps}
            disabled={workflowRunning}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-1">
            {steps.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">{t('emptyWorkflow')}</p>
            )}
            {steps.map((step, idx) => (
              <div
                key={step.id}
                className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs ${
                  idx === currentStepIndex ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'
                }`}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 cursor-grab" />
                <span className="shrink-0">
                  {step.type === 'gcode' && <FileCode className="h-3 w-3 text-blue-500" />}
                  {step.type === 'macro' && <Zap className="h-3 w-3 text-yellow-500" />}
                  {step.type === 'pause' && <Pause className="h-3 w-3 text-orange-500" />}
                  {step.type === 'goto' && <Navigation className="h-3 w-3 text-green-500" />}
                </span>
                <span className="truncate flex-1">{step.name}</span>
                <Badge variant={stepStatusColor(step.status)} className="text-[9px] h-4 px-1">
                  {t(`step${step.status.charAt(0).toUpperCase() + step.status.slice(1)}`)}
                </Badge>
                <div className="flex gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
                    onClick={() => idx > 0 && moveStep(idx, idx - 1)}
                    disabled={idx === 0 || workflowRunning}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
                    onClick={() => idx < steps.length - 1 && moveStep(idx, idx + 1)}
                    disabled={idx === steps.length - 1 || workflowRunning}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-destructive"
                    onClick={() => removeStep(step.id)}
                    disabled={workflowRunning}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
