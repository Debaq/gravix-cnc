import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '@/stores/useWorkflowStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerial } from '@/hooks/useSerial'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
  SlidersHorizontal,
  Eye,
  ShieldAlert,
  Lock,
} from 'lucide-react'
import { useCanvasStore } from '@/stores/useCanvasStore'
import type { WorkflowStep } from '@/lib/types'

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
    updateStep,
    removeStep,
    moveStep,
    setStepStatus,
    startWorkflow,
    stopWorkflow,
    advanceStep,
    resetWorkflow,
    clearSteps,
    setActiveGCode,
    setActiveGCodeLine,
    clearActiveGCode,
    simulating,
    simPaused,
    setSimulating,
    setSimPaused,
    setSimulatedPos,
    highlightStepId,
    clearHighlight,
  } = useWorkflowStore()
  const { addConsoleLine } = useAppStore()
  const { sending } = useSerialStore()
  const operationType = useCanvasStore((s) => s.globalConfig.operationType)

  // Macros built-in adaptativos segun modo de operacion (no eliminables)
  const builtinMacros = useMemo(() => {
    const probe = { id: 'bi-probe-z', name: 'Probe Z', gcode: 'G38.2 Z-20 F100\nG10 L20 P1 Z0\nG0 Z5', icon: 'probe', builtin: true }
    if (operationType === 'laser') {
      return [
        probe,
        { id: 'bi-laser-on', name: 'Láser ON (50%)', gcode: 'M3 S500', icon: 'zap', builtin: true },
        { id: 'bi-laser-off', name: 'Láser OFF', gcode: 'M5 S0', icon: 'zap-off', builtin: true },
      ]
    }
    return [
      probe,
      { id: 'bi-spindle-on', name: 'Spindle ON', gcode: 'M3 S12000', icon: 'cog', builtin: true },
      { id: 'bi-spindle-off', name: 'Spindle OFF', gcode: 'M5', icon: 'cog', builtin: true },
      { id: 'bi-coolant-on', name: 'Coolant ON', gcode: 'M8', icon: 'droplet', builtin: true },
      { id: 'bi-coolant-off', name: 'Coolant OFF', gcode: 'M9', icon: 'droplet', builtin: true },
    ]
  }, [operationType])

  const allMacros = useMemo(() => [...builtinMacros, ...macros], [builtinMacros, macros])

  // Auto-clear highlight después de animación
  useEffect(() => {
    if (!highlightStepId) return
    const timer = setTimeout(clearHighlight, 2000)
    return () => clearTimeout(timer)
  }, [highlightStepId, clearHighlight])

  // Modal editar/ver paso
  const [editingStep, setEditingStep] = useState<WorkflowStep | null>(null)
  const [editName, setEditName] = useState('')
  const [editData, setEditData] = useState('')
  // Modal nuevo G-Code
  const [showNewGCode, setShowNewGCode] = useState(false)
  const [newGCodeName, setNewGCodeName] = useState('')
  const [newGCodeData, setNewGCodeData] = useState('')
  // Pre-flight check
  const [showPreFlight, setShowPreFlight] = useState(false)
  const [preFlightIssues, setPreFlightIssues] = useState<string[]>([])

  const openStepEditor = (step: WorkflowStep) => {
    setEditingStep(step)
    setEditName(step.name)
    setEditData(step.data)
  }

  const saveStepEdit = () => {
    if (!editingStep) return
    updateStep(editingStep.id, { name: editName, data: editData })
    setEditingStep(null)
  }

  const handleStartWithCheck = () => {
    const { machineState } = useSerialStore.getState()
    const issues: string[] = []
    if (!connected) issues.push('notConnected')
    if (steps.length === 0) issues.push('noSteps')
    if (machineState === 'Alarm') issues.push('alarm')
    else if (machineState === 'Hold') issues.push('hold')
    else if (machineState !== 'Idle') issues.push('notIdle')
    if (issues.length > 0) {
      setPreFlightIssues(issues)
      setShowPreFlight(true)
    } else {
      startWorkflow()
    }
  }

  const handleAddGCode = () => {
    if (!newGCodeData.trim()) return
    const name = newGCodeName.trim() || 'G-Code'
    addWorkflowStep('gcode', name, newGCodeData)
    setNewGCodeName('')
    setNewGCodeData('')
    setShowNewGCode(false)
  }

  // Simular workflow completo con animación
  const simLinesRef = useRef<string[]>([])
  const simIdxRef = useRef(0)
  const simPosRef = useRef({ x: 0, y: 0, z: 0 })
  const simRafRef = useRef(0)
  const simLastTickRef = useRef(0)

  const simTick = () => {
    const store = useWorkflowStore.getState()
    if (!store.simulating) return

    if (store.simPaused) {
      simRafRef.current = requestAnimationFrame(simTick)
      return
    }

    const now = performance.now()
    if (now - simLastTickRef.current < store.simSpeed) {
      simRafRef.current = requestAnimationFrame(simTick)
      return
    }
    simLastTickRef.current = now

    const lines = simLinesRef.current
    if (simIdxRef.current >= lines.length) {
      store.setSimulating(false)
      store.setActiveGCodeLine(lines.length)
      useAppStore.getState().addConsoleLine('── Simulación completada ──')
      return
    }

    const line = lines[simIdxRef.current].trim().toUpperCase()
    simIdxRef.current++
    store.setActiveGCodeLine(simIdxRef.current)

    if (line && !line.startsWith(';') && !line.startsWith('(')) {
      const xM = line.match(/X([-\d.]+)/)
      const yM = line.match(/Y([-\d.]+)/)
      const zM = line.match(/Z([-\d.]+)/)
      const fM = line.match(/F([-\d.]+)/)
      const sM = line.match(/S([-\d.]+)/)
      let changed = false
      if (xM) { simPosRef.current.x = parseFloat(xM[1]); changed = true }
      if (yM) { simPosRef.current.y = parseFloat(yM[1]); changed = true }
      if (zM) { simPosRef.current.z = parseFloat(zM[1]); changed = true }
      if (changed) store.setSimulatedPos({ ...simPosRef.current })
      if (fM) store.setSimulatedFeed(parseFloat(fM[1]))
      if (sM) store.setSimulatedSpindle(parseFloat(sM[1]))
      if (line.match(/\bM5\b/)) store.setSimulatedSpindle(0)
      // Log a consola
      useAppStore.getState().addConsoleLine(`[SIM] ${lines[simIdxRef.current - 1].trim()}`)
    } else if (line.startsWith(';')) {
      useAppStore.getState().addConsoleLine(`[SIM] ${lines[simIdxRef.current - 1].trim()}`)
    }

    simRafRef.current = requestAnimationFrame(simTick)
  }

  const handleSimulateWorkflow = () => {
    const combined = steps.map((step, idx) => {
      const header = `; ── Paso ${idx + 1}: ${step.name} (${step.type}) ──`
      switch (step.type) {
        case 'gcode':
        case 'macro':
          return step.data.trim() ? `${header}\n${step.data.trim()}` : `${header}`
        case 'goto': {
          const parts = step.data.split(',').map(Number)
          const x = parts[0] ?? 0, y = parts[1] ?? 0, z = parts[2] ?? 0
          const isLaser = useCanvasStore.getState().globalConfig.operationType === 'laser'
          if (isLaser) {
            return `${header}\nM5 S0\nG0 X${x} Y${y}`
          }
          return `${header}\nG0 Z5\nG0 X${x} Y${y}\nG0 Z${z}`
        }
        case 'pause':
          return `${header}${step.data ? `\n; ${step.data}` : ''}`
        default:
          return header
      }
    }).join('\n\n')

    simLinesRef.current = combined.split('\n')
    simIdxRef.current = 0
    simPosRef.current = { x: 0, y: 0, z: 0 }
    simLastTickRef.current = 0

    setActiveGCode(`Simulación (${steps.length} pasos)`, combined)
    setSimulating(true)
    setSimulatedPos({ x: 0, y: 0, z: 0 })
    addConsoleLine(`── Simulación iniciada: ${steps.length} pasos, ${simLinesRef.current.length} líneas ──`)

    cancelAnimationFrame(simRafRef.current)
    simRafRef.current = requestAnimationFrame(simTick)
  }

  const handleStopSimulation = () => {
    cancelAnimationFrame(simRafRef.current)
    setSimulating(false)
    addConsoleLine('── Simulación detenida ──')
  }

  const handleRewindSimulation = () => {
    simIdxRef.current = Math.max(0, simIdxRef.current - 50)
    simPosRef.current = { x: 0, y: 0, z: 0 }
    // Recalcular posición hasta línea actual
    for (let i = 0; i < simIdxRef.current; i++) {
      const l = simLinesRef.current[i].trim().toUpperCase()
      const xM = l.match(/X([-\d.]+)/)
      const yM = l.match(/Y([-\d.]+)/)
      const zM = l.match(/Z([-\d.]+)/)
      if (xM) simPosRef.current.x = parseFloat(xM[1])
      if (yM) simPosRef.current.y = parseFloat(yM[1])
      if (zM) simPosRef.current.z = parseFloat(zM[1])
    }
    setSimulatedPos({ ...simPosRef.current })
    useWorkflowStore.getState().setActiveGCodeLine(simIdxRef.current)
  }

  // Escuchar eventos de controles flotantes
  useEffect(() => {
    const onRewind = () => handleRewindSimulation()
    const onStop = () => handleStopSimulation()
    window.addEventListener('sim-rewind', onRewind)
    window.addEventListener('sim-stop', onStop)
    return () => {
      window.removeEventListener('sim-rewind', onRewind)
      window.removeEventListener('sim-stop', onStop)
      cancelAnimationFrame(simRafRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Workflow Execution Engine ───
  const stepInitiatedRef = useRef(-1)
  const prevSendingRef = useRef(false)

  // Detectar cuando sendGCode termina → marcar paso como done y avanzar
  useEffect(() => {
    if (!workflowRunning) {
      prevSendingRef.current = false
      return
    }
    if (prevSendingRef.current && !sending) {
      const step = steps[currentStepIndex]
      if (step && step.status === 'running' && (step.type === 'gcode' || step.type === 'macro')) {
        setStepStatus(step.id, 'done')
        addConsoleLine(`Paso completado: ${step.name}`)
        setTimeout(() => advanceStep(), 300)
      }
    }
    prevSendingRef.current = sending
  }, [sending, workflowRunning, currentStepIndex, steps, setStepStatus, advanceStep, addConsoleLine])

  // Iniciar ejecucion del paso actual
  useEffect(() => {
    if (!workflowRunning || !connected) {
      stepInitiatedRef.current = -1
      return
    }
    if (currentStepIndex < 0 || currentStepIndex >= steps.length) {
      clearActiveGCode()
      return
    }
    const step = steps[currentStepIndex]
    if (stepInitiatedRef.current === currentStepIndex) return
    if (step.status !== 'pending') return

    stepInitiatedRef.current = currentStepIndex
    setStepStatus(step.id, 'running')
    addConsoleLine(`Ejecutando: ${step.name}`)

    switch (step.type) {
      case 'gcode':
      case 'macro':
        setActiveGCode(step.name, step.data)
        serial.sendGCode(step.data)
        break
      case 'goto': {
        const parts = step.data.split(',').map(Number)
        const x = parts[0] ?? 0, y = parts[1] ?? 0, z = parts[2] ?? 0
        const isLaser = useCanvasStore.getState().globalConfig.operationType === 'laser'
        if (isLaser) {
          serial.sendCommand('M5 S0')
          setTimeout(() => {
            serial.sendCommand(`G0 X${x} Y${y}`)
            setStepStatus(step.id, 'done')
            addConsoleLine(`Posicion alcanzada: ${step.name}`)
            setTimeout(() => advanceStep(), 300)
          }, 300)
        } else {
          serial.sendCommand('G0 Z5')
          setTimeout(() => serial.sendCommand(`G0 X${x} Y${y}`), 300)
          setTimeout(() => {
            serial.sendCommand(`G0 Z${z}`)
            setStepStatus(step.id, 'done')
            addConsoleLine(`Posicion alcanzada: ${step.name}`)
            setTimeout(() => advanceStep(), 300)
          }, 600)
        }
        break
      }
      case 'pause':
        addConsoleLine(`Pausado: ${step.data || step.name}`)
        // Aviso sonoro
        try {
          const ctx = new AudioContext()
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.frequency.value = 880
          gain.gain.value = 0.3
          osc.start()
          osc.stop(ctx.currentTime + 0.15)
          setTimeout(() => {
            const osc2 = ctx.createOscillator()
            const gain2 = ctx.createGain()
            osc2.connect(gain2)
            gain2.connect(ctx.destination)
            osc2.frequency.value = 1100
            gain2.gain.value = 0.3
            osc2.start()
            osc2.stop(ctx.currentTime + 0.2)
            setTimeout(() => ctx.close(), 300)
          }, 200)
        } catch { /* audio no disponible */ }
        break
    }
  }, [workflowRunning, currentStepIndex, connected, steps, setStepStatus, advanceStep, addConsoleLine, setActiveGCode, clearActiveGCode, serial])

  // Detener envio si se para el workflow
  useEffect(() => {
    if (!workflowRunning) {
      stepInitiatedRef.current = -1
      if (sending) serial.cancelSend()
    }
  }, [workflowRunning, sending, serial])

  // Detener workflow si se pierde conexion
  useEffect(() => {
    if (workflowRunning && !connected) {
      stopWorkflow()
      addConsoleLine('Workflow detenido: conexion perdida')
    }
  }, [connected, workflowRunning, stopWorkflow, addConsoleLine])

  // Resumir paso de pausa
  const handleResumePause = () => {
    const step = steps[currentStepIndex]
    if (step && step.type === 'pause' && step.status === 'running') {
      setStepStatus(step.id, 'done')
      addConsoleLine(`Reanudado: ${step.name}`)
      advanceStep()
    }
  }

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
    const isLaser = useCanvasStore.getState().globalConfig.operationType === 'laser'
    if (isLaser) {
      serial.sendCommand('M5 S0')
      serial.sendCommand(`G0 X${x} Y${y}`)
    } else {
      serial.sendCommand('G0 Z5')
      serial.sendCommand(`G0 X${x} Y${y}`)
      serial.sendCommand(`G0 Z${z}`)
    }
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
      {/* Botón Preparar Máquina */}
      <div className="px-2 py-1.5 border-b">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs gap-1.5"
          onClick={() => useAppStore.getState().openModal('setupWizard')}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t('setupWizard') || 'Preparar Máquina'}
        </Button>
      </div>

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

            {allMacros.map((macro) => (
              <div key={macro.id} className="flex items-center gap-1 group">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs flex-1 justify-start gap-1.5 font-normal"
                  onClick={() => handleRunMacro(macro.gcode)}
                  disabled={!connected}
                  title={macro.gcode}
                >
                  <Play className={`h-3 w-3 shrink-0 ${macro.builtin ? 'text-blue-400' : 'text-green-500'}`} />
                  <span className="truncate">{macro.name}</span>
                  {macro.builtin && <Lock className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />}
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
                {!macro.builtin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-destructive"
                    onClick={() => removeMacro(macro.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
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
              onClick={() => setShowNewGCode(true)}
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
              onClick={handleStartWithCheck}
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
              onClick={() => { serial.abort(); stopWorkflow() }}
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
          {simulating ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-6 text-xs"
              onClick={handleStopSimulation}
              title="Detener simulación"
            >
              <Square className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              onClick={handleSimulateWorkflow}
              disabled={steps.length === 0}
              title="Simular workflow"
            >
              <Eye className="h-3 w-3" />
            </Button>
          )}
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
                className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs cursor-pointer ${
                  idx === currentStepIndex ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'
                } ${step.id === highlightStepId ? 'animate-workflow-highlight' : ''}`}
                onClick={() => !workflowRunning && openStepEditor(step)}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 cursor-grab" />
                <span className="shrink-0">
                  {step.type === 'gcode' && <FileCode className="h-3 w-3 text-blue-500" />}
                  {step.type === 'macro' && <Zap className="h-3 w-3 text-yellow-500" />}
                  {step.type === 'pause' && <Pause className="h-3 w-3 text-orange-500" />}
                  {step.type === 'goto' && <Navigation className="h-3 w-3 text-green-500" />}
                </span>
                <span className="truncate flex-1">{step.name}</span>
                {step.type === 'pause' && step.status === 'running' && (
                  <Button
                    size="sm"
                    className="h-5 text-[10px] px-1.5 gap-1 shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleResumePause() }}
                  >
                    <Play className="h-2.5 w-2.5" />
                    {t('resume') || 'Reanudar'}
                  </Button>
                )}
                <Badge variant={stepStatusColor(step.status)} className="text-[9px] h-4 px-1">
                  {t(`step${step.status.charAt(0).toUpperCase() + step.status.slice(1)}`)}
                </Badge>
                <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
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
      {/* Modal: Editar paso existente */}
      <Dialog open={!!editingStep} onOpenChange={(open) => !open && setEditingStep(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              {editingStep?.type === 'gcode' && <FileCode className="h-4 w-4 text-blue-500" />}
              {editingStep?.type === 'macro' && <Zap className="h-4 w-4 text-yellow-500" />}
              {editingStep?.type === 'pause' && <Pause className="h-4 w-4 text-orange-500" />}
              {editingStep?.type === 'goto' && <Navigation className="h-4 w-4 text-green-500" />}
              {editingStep?.type === 'pause' ? 'Editar Pausa' : editingStep?.type === 'goto' ? 'Editar Posición' : 'Editar Paso'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nombre</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            {editingStep?.type === 'goto' && (() => {
              const parts = editData.split(',').map(Number)
              const x = parts[0] ?? 0, y = parts[1] ?? 0, z = parts[2] ?? 0
              const isLaser = operationType === 'laser'
              const preview = isLaser
                ? `M5 S0\nG0 X${x} Y${y}`
                : `G0 Z5\nG0 X${x} Y${y}\nG0 Z${z}`
              return (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Coordenadas (X,Y,Z)</label>
                    <Input
                      value={editData}
                      onChange={(e) => setEditData(e.target.value)}
                      placeholder="0,0,0"
                      className="h-8 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">G-Code generado</label>
                    <pre className="w-full text-xs font-mono bg-muted/50 border rounded px-2 py-1.5 text-muted-foreground select-all">
                      {preview}
                    </pre>
                  </div>
                </>
              )
            })()}
            {editingStep?.type !== 'goto' && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contenido</label>
                <textarea
                  value={editData}
                  onChange={(e) => setEditData(e.target.value)}
                  className="w-full h-32 text-xs font-mono bg-background border rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder={editingStep?.type === 'pause'
                    ? 'Mensaje de pausa...'
                    : 'G0 X0 Y0\nG1 Z-1 F300\n...'}
                />
              </div>
            )}
            {/* Preview G-Code que se enviará */}
            {editingStep?.type !== 'goto' && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">G-Code a enviar</label>
                {(editingStep?.type === 'gcode' || editingStep?.type === 'macro') && editData.trim() ? (
                  <pre className="w-full max-h-32 overflow-auto text-xs font-mono bg-muted/50 border rounded px-2 py-1.5 text-muted-foreground select-all whitespace-pre-wrap">
                    {editData.split('\n').filter(l => l.trim()).join('\n')}
                  </pre>
                ) : editingStep?.type === 'pause' ? (
                  <p className="text-xs text-muted-foreground italic px-2 py-1.5 bg-muted/50 border rounded">
                    Sin G-Code — pausa manual, espera confirmación del operador
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic px-2 py-1.5 bg-muted/50 border rounded">
                    Sin contenido
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditingStep(null)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={saveStepEdit}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Nuevo paso G-Code */}
      <Dialog open={showNewGCode} onOpenChange={setShowNewGCode}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileCode className="h-4 w-4 text-blue-500" />
              Agregar G-Code al Workflow
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nombre</label>
              <Input
                value={newGCodeName}
                onChange={(e) => setNewGCodeName(e.target.value)}
                placeholder="G-Code"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">G-Code</label>
              <textarea
                value={newGCodeData}
                onChange={(e) => setNewGCodeData(e.target.value)}
                className="w-full h-32 text-xs font-mono bg-background border rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="G0 X0 Y0&#10;G1 Z-1 F300&#10;..."
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowNewGCode(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleAddGCode} disabled={!newGCodeData.trim()}>
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Pre-flight check */}
      <Dialog open={showPreFlight} onOpenChange={setShowPreFlight}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-yellow-500" />
              {t('preFlightCheck')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {preFlightIssues.map((issue) => (
              <div key={issue} className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs">
                <span>{t(`preflight_${issue}`)}</span>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-1">
            {preFlightIssues.includes('alarm') && (
              <Button size="sm" variant="outline" onClick={() => { serial.unlock(); setShowPreFlight(false) }}>
                {t('unlock')}
              </Button>
            )}
            {preFlightIssues.includes('hold') && (
              <Button size="sm" variant="outline" onClick={() => { serial.resume(); setShowPreFlight(false) }}>
                {t('resume')}
              </Button>
            )}
            {(preFlightIssues.includes('alarm') || preFlightIssues.includes('notIdle')) && (
              <Button size="sm" variant="outline" onClick={() => { serial.home(); setShowPreFlight(false) }}>
                {t('home')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowPreFlight(false)}>
              {t('cancel') || 'Cancelar'}
            </Button>
            <Button size="sm" onClick={() => { setShowPreFlight(false); startWorkflow() }}>
              {t('forceStart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
