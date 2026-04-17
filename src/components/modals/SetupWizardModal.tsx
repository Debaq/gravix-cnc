import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import { useSerialStore } from '@/stores/useSerialStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useSerial } from '@/hooks/useSerial'
import { useCanvasManager } from '@/hooks/useCanvasManager'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Wifi,
  WifiOff,
  Home,
  Target,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Crosshair,
  Zap,
  ZapOff,
  Play,
  Loader2,
  Scan,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react'
import type { GCodeJob } from '@/lib/types'

// ─── Compact Jog Pad ───

function JogPad({
  axes,
  jogStep,
  onJogStep,
  serial,
  connected,
}: {
  axes: 'xy' | 'z' | 'xyz'
  jogStep: number
  onJogStep: (v: number) => void
  serial: ReturnType<typeof useSerial>
  connected: boolean
}) {
  const { t } = useTranslation('setupWizard')
  const steps = axes === 'z' ? [0.01, 0.1, 0.5, 1] : [0.1, 1, 5, 10]

  return (
    <div className="space-y-2">
      {/* Step selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground shrink-0">{t('jogStep')}:</span>
        {steps.map((s) => (
          <Button
            key={s}
            variant={jogStep === s ? 'default' : 'outline'}
            size="sm"
            className="h-6 text-[10px] px-2 min-w-0"
            onClick={() => onJogStep(s)}
          >
            {s}
          </Button>
        ))}
        <span className="text-[10px] text-muted-foreground">{t('mm')}</span>
      </div>

      <div className="flex items-start gap-4">
        {/* XY pad */}
        {(axes === 'xy' || axes === 'xyz') && (
          <div className="grid grid-cols-3 gap-0.5 w-fit">
            <div />
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => serial.jogXY(0, jogStep, 1000)} disabled={!connected}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <div />
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => serial.jogXY(-jogStep, 0, 1000)} disabled={!connected}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Crosshair className="h-3 w-3 text-muted-foreground" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => serial.jogXY(jogStep, 0, 1000)} disabled={!connected}>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <div />
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => serial.jogXY(0, -jogStep, 1000)} disabled={!connected}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <div />
          </div>
        )}

        {/* Z controls */}
        {(axes === 'z' || axes === 'xyz') && (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] font-bold text-blue-500">Z</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => serial.jogZ(jogStep, 500)} disabled={!connected}>
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => serial.jogZ(-jogStep, 500)} disabled={!connected}>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Position Display ───

function PositionDisplay() {
  const { t } = useTranslation('setupWizard')
  const position = useSerialStore((s) => s.position)

  return (
    <div className="flex items-center gap-3 bg-muted/50 rounded-md px-3 py-1.5">
      <span className="text-[10px] text-muted-foreground">{t('currentPos')}:</span>
      <span className="font-mono text-xs">
        <span className="text-red-500 font-bold">X</span> {position.x}
      </span>
      <span className="font-mono text-xs">
        <span className="text-green-500 font-bold">Y</span> {position.y}
      </span>
      <span className="font-mono text-xs">
        <span className="text-blue-500 font-bold">Z</span> {position.z}
      </span>
    </div>
  )
}

// ─── Bounding box helper ───

export function computeBBox(jobs: GCodeJob[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let has = false
  for (const job of jobs) {
    for (const path of job.paths) {
      for (const pt of path.points) {
        minX = Math.min(minX, pt.x)
        minY = Math.min(minY, pt.y)
        maxX = Math.max(maxX, pt.x)
        maxY = Math.max(maxY, pt.y)
        has = true
      }
    }
  }
  return has ? { minX, minY, maxX, maxY } : null
}

// ─── Dry-run G-code generator ───

export function generateBoundaryGCode(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  mode: 'cnc' | 'laser',
  safeZ: number,
  laserTestPower: number,
): string {
  const { minX, minY, maxX, maxY } = bbox
  const f = (n: number) => n.toFixed(2)
  const lines: string[] = ['G90 G21']

  if (mode === 'laser') {
    lines.push(`G0 X${f(minX)} Y${f(minY)}`)
    lines.push(`M4 S${laserTestPower}`)
    lines.push(`G1 X${f(maxX)} Y${f(minY)} F1000`)
    lines.push(`G1 X${f(maxX)} Y${f(maxY)} F1000`)
    lines.push(`G1 X${f(minX)} Y${f(maxY)} F1000`)
    lines.push(`G1 X${f(minX)} Y${f(minY)} F1000`)
    lines.push('M5')
  } else {
    lines.push(`G0 Z${f(safeZ)}`)
    lines.push(`G0 X${f(minX)} Y${f(minY)}`)
    lines.push(`G0 X${f(maxX)} Y${f(minY)}`)
    lines.push(`G0 X${f(maxX)} Y${f(maxY)}`)
    lines.push(`G0 X${f(minX)} Y${f(maxY)}`)
    lines.push(`G0 X${f(minX)} Y${f(minY)}`)
  }

  lines.push('G0 X0 Y0')
  return lines.join('\n')
}

// ─── Main Wizard ───

export function SetupWizardModal() {
  const { t } = useTranslation('setupWizard')
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const { connected, machineState, sending } = useSerialStore()
  const { globalConfig } = useCanvasStore()
  const serial = useSerial()
  const { getJobsForGCode } = useCanvasManager()

  const isOpen = activeModal === 'setupWizard'
  const isLaser = globalConfig.operationType === 'laser'

  const [step, setStep] = useState(0)
  const [jogStep, setJogStep] = useState(1)
  const [focusLaserOn, setFocusLaserOn] = useState(false)
  const [dryRunning, setDryRunning] = useState(false)
  const [completed, setCompleted] = useState<boolean[]>([])

  const SAFE_Z = 5
  const LASER_TEST_POWER = 10 // ~1% de S1000
  const LASER_FOCUS_POWER = 50 // ~5% de S1000

  const stepKeys = isLaser
    ? ['connect', 'home', 'originXY', 'focusLaser', 'dryRun', 'ready'] as const
    : ['connect', 'home', 'originXY', 'heightZ', 'dryRun', 'ready'] as const

  const totalSteps = stepKeys.length

  // Reset al abrir
  useEffect(() => {
    if (isOpen) {
      setStep(0)
      setJogStep(1)
      setFocusLaserOn(false)
      setDryRunning(false)
      setCompleted(new Array(totalSteps).fill(false))
    }
  }, [isOpen, totalSteps])

  // Marcar step como completado
  const markDone = (idx: number) => {
    setCompleted((prev) => {
      const next = [...prev]
      next[idx] = true
      return next
    })
  }

  // Cleanup al cerrar: apagar laser si quedó encendido
  const handleClose = () => {
    if (focusLaserOn) {
      serial.sendCommand('M5')
      setFocusLaserOn(false)
    }
    closeModal()
  }

  const goNext = () => step < totalSteps - 1 && setStep(step + 1)
  const goBack = () => step > 0 && setStep(step - 1)

  // ─── Step 0: Connection ───
  const renderConnect = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30">
        {connected ? (
          <>
            <Wifi className="h-6 w-6 text-green-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">{t('machineConnected')}</p>
              <p className="text-xs text-muted-foreground">{t('state')}: {machineState}</p>
            </div>
          </>
        ) : (
          <>
            <WifiOff className="h-6 w-6 text-red-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">{t('machineNotConnected')}</p>
              <p className="text-xs text-muted-foreground">{t('connectFirst')}</p>
            </div>
          </>
        )}
      </div>
      {connected && <PositionDisplay />}
    </div>
  )

  // ─── Step 1: Home ───
  const renderHome = () => (
    <div className="space-y-4">
      <PositionDisplay />
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-auto py-3 flex-col gap-1"
          onClick={async () => {
            addConsoleLine('Ejecutando $H...')
            await serial.home()
            markDone(1)
          }}
          disabled={!connected || machineState === 'Home'}
        >
          <Home className="h-5 w-5" />
          <span className="text-xs">{t('runHome')}</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-3 flex-col gap-1"
          onClick={async () => {
            await serial.setZero()
            addConsoleLine(t('homeDone'))
            markDone(1)
          }}
          disabled={!connected}
        >
          <Target className="h-5 w-5" />
          <span className="text-xs">{t('setManualHome')}</span>
        </Button>
      </div>
      {completed[1] && (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {t('homeDone')}
        </Badge>
      )}
    </div>
  )

  // ─── Step 2: Origin XY ───
  const renderOriginXY = () => (
    <div className="space-y-4">
      <PositionDisplay />
      <JogPad axes="xy" jogStep={jogStep} onJogStep={setJogStep} serial={serial} connected={connected} />
      <Button
        className="w-full gap-1.5"
        onClick={async () => {
          await serial.sendCommand('G10 L20 P1 X0 Y0')
          addConsoleLine(t('xyZeroSet'))
          markDone(2)
        }}
        disabled={!connected}
      >
        <Target className="h-4 w-4" />
        {t('setXYZero')}
      </Button>
      {completed[2] && (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {t('xyZeroSet')}
        </Badge>
      )}
    </div>
  )

  // ─── Step 3a: Tool Height Z (CNC) ───
  const renderHeightZ = () => (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/30">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 dark:text-amber-300">{t('zWarning')}</p>
      </div>
      <PositionDisplay />
      <JogPad axes="z" jogStep={jogStep} onJogStep={setJogStep} serial={serial} connected={connected} />
      <div className="grid grid-cols-2 gap-2">
        <Button
          className="gap-1.5"
          onClick={async () => {
            await serial.sendCommand('G10 L20 P1 Z0')
            addConsoleLine(t('zZeroSet'))
            markDone(3)
          }}
          disabled={!connected}
        >
          <Target className="h-4 w-4" />
          {t('setZZero')}
        </Button>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={async () => {
            addConsoleLine('Probe Z: G38.2 Z-20 F100')
            await serial.sendCommand('G38.2 Z-20 F100')
            // El probe establece Z al contacto, luego seteamos a cero y subimos
            setTimeout(async () => {
              await serial.sendCommand('G10 L20 P1 Z0')
              await serial.sendCommand('G0 Z5')
              addConsoleLine(t('zZeroSet'))
              markDone(3)
            }, 3000)
          }}
          disabled={!connected}
        >
          <Scan className="h-4 w-4" />
          {t('probeZ')}
        </Button>
      </div>
      {completed[3] && (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {t('zZeroSet')}
        </Badge>
      )}
    </div>
  )

  // ─── Step 3b: Laser Focus ───
  const renderFocusLaser = () => (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/30">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 dark:text-amber-300">{t('focusWarning')}</p>
      </div>
      <PositionDisplay />

      {/* Toggle laser focus beam */}
      <Button
        variant={focusLaserOn ? 'destructive' : 'default'}
        className="w-full gap-1.5"
        onClick={async () => {
          if (focusLaserOn) {
            await serial.sendCommand('M5')
            setFocusLaserOn(false)
            addConsoleLine(t('laserOff'))
          } else {
            await serial.sendCommand(`M4 S${LASER_FOCUS_POWER}`)
            setFocusLaserOn(true)
            addConsoleLine(t('laserOn'))
          }
        }}
        disabled={!connected}
      >
        {focusLaserOn ? <ZapOff className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
        {focusLaserOn ? t('disableFocusBeam') : t('enableFocusBeam')}
      </Button>

      <p className="text-xs text-muted-foreground text-center">{t('focusInstruction')}</p>

      <JogPad axes="z" jogStep={jogStep} onJogStep={setJogStep} serial={serial} connected={connected} />

      <Button
        variant="outline"
        className="w-full gap-1.5"
        onClick={async () => {
          // Apagar laser antes de setear Z
          if (focusLaserOn) {
            await serial.sendCommand('M5')
            setFocusLaserOn(false)
          }
          await serial.sendCommand('G10 L20 P1 Z0')
          addConsoleLine(t('zZeroSet'))
          markDone(3)
        }}
        disabled={!connected}
      >
        <Target className="h-4 w-4" />
        {t('setZZero')}
      </Button>
      {completed[3] && (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {t('zZeroSet')}
        </Badge>
      )}
    </div>
  )

  // ─── Step 4: Dry Run ───
  const renderDryRun = () => {
    const jobs = getJobsForGCode()
    const elementBBox = computeBBox(jobs)

    // Fallback: usar área de trabajo si no hay elementos
    const { workArea } = useCanvasStore.getState()
    const bbox = elementBBox ?? { minX: 0, minY: 0, maxX: workArea.width, maxY: workArea.height }
    const usingWorkArea = !elementBBox

    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {isLaser ? t('dryRunLaserDesc') : t('dryRunCNCDesc')}
        </p>

        {usingWorkArea && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-blue-500/10 border border-blue-500/30">
            <Scan className="h-4 w-4 text-blue-500 shrink-0" />
            <p className="text-xs text-blue-700 dark:text-blue-300">{t('usingWorkArea')}</p>
          </div>
        )}

        {bbox && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted rounded-md p-2">
                <p className="text-[10px] text-muted-foreground">{t('workArea')}</p>
                <p className="text-sm font-mono font-medium">
                  {(bbox.maxX - bbox.minX).toFixed(1)} x {(bbox.maxY - bbox.minY).toFixed(1)} mm
                </p>
              </div>
              <div className="bg-muted rounded-md p-2">
                <p className="text-[10px] text-muted-foreground">
                  {isLaser ? t('testPower') : t('safeHeight')}
                </p>
                <p className="text-sm font-mono font-medium">
                  {isLaser ? `S${LASER_TEST_POWER} (~1%)` : `Z${SAFE_Z} mm`}
                </p>
              </div>
            </div>

            {/* Mini preview del bounding box */}
            <div className="border rounded-md p-3 bg-muted/30">
              <svg viewBox="-5 -5 110 110" className="w-full h-24">
                <rect x="0" y="0" width="100" height="100" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" strokeDasharray="4 2" opacity="0.3" />
                {(() => {
                  const w = bbox.maxX - bbox.minX || 1
                  const h = bbox.maxY - bbox.minY || 1
                  const scale = 90 / Math.max(w, h)
                  const ox = (100 - w * scale) / 2
                  const oy = (100 - h * scale) / 2
                  return (
                    <rect
                      x={ox} y={oy}
                      width={w * scale} height={h * scale}
                      fill="hsl(var(--primary) / 0.1)"
                      stroke="hsl(var(--primary))"
                      strokeWidth="1.5"
                    />
                  )
                })()}
                <circle cx="0" cy="100" r="2.5" fill="hsl(var(--destructive))" />
                <text x="5" y="98" fontSize="6" fill="hsl(var(--muted-foreground))">0,0</text>
              </svg>
            </div>

            <Button
              className="w-full gap-1.5"
              onClick={async () => {
                const gcode = generateBoundaryGCode(bbox, isLaser ? 'laser' : 'cnc', SAFE_Z, LASER_TEST_POWER)
                setDryRunning(true)
                addConsoleLine('Iniciando prueba de area...')
                try {
                  await serial.sendGCode(gcode)
                } catch {
                  addConsoleLine('Error en prueba de area')
                }
                // El complete event del serial manejará el fin
                // Usamos un timeout como fallback
                setTimeout(() => {
                  setDryRunning(false)
                  markDone(4)
                  addConsoleLine(t('testComplete'))
                }, 1000)
              }}
              disabled={!connected || sending || dryRunning}
            >
              {dryRunning || sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('running')}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  {t('runBoundaryTest')}
                </>
              )}
            </Button>
          </>
        )}

        {completed[4] && (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {t('testComplete')}
          </Badge>
        )}
      </div>
    )
  }

  // ─── Step 5: Ready ───
  const renderReady = () => (
    <div className="space-y-4">
      <div className="flex flex-col items-center py-4">
        <CheckCircle2 className="h-12 w-12 text-green-500 mb-2" />
        <p className="text-sm font-medium">{t('readyDesc')}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase">{t('summary')}</p>
        {[
          { done: completed[1], label: t('homeDone') },
          { done: completed[2], label: t('originSet') },
          { done: completed[3], label: t('heightSet') },
          { done: completed[4], label: t('areaVerified') },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {item.done ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />
            )}
            <span className={item.done ? '' : 'text-muted-foreground'}>{item.label}</span>
          </div>
        ))}
      </div>

      <PositionDisplay />

      <Button className="w-full" onClick={handleClose}>
        {t('startWorking')}
      </Button>
    </div>
  )

  // ─── Step titles and descriptions ───
  const stepInfo: Record<string, { title: string; desc: string }> = {
    connect: { title: t('stepConnect'), desc: t('connectDesc') },
    home: { title: t('stepHome'), desc: t('homeDesc') },
    originXY: { title: t('stepOriginXY'), desc: t('originXYDesc') },
    heightZ: { title: t('stepHeightZ'), desc: t('heightZDesc') },
    focusLaser: { title: t('stepFocusLaser'), desc: t('focusDesc') },
    dryRun: { title: t('stepDryRun'), desc: t('dryRunDesc') },
    ready: { title: t('stepReady'), desc: t('readyDesc') },
  }

  const currentKey = stepKeys[step]
  const info = stepInfo[currentKey]

  // ─── Step content renderer ───
  const renderStep = () => {
    switch (currentKey) {
      case 'connect': return renderConnect()
      case 'home': return renderHome()
      case 'originXY': return renderOriginXY()
      case 'heightZ': return renderHeightZ()
      case 'focusLaser': return renderFocusLaser()
      case 'dryRun': return renderDryRun()
      case 'ready': return renderReady()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base">{t('title')}</DialogTitle>
            <Badge variant="outline" className="text-[10px] font-mono shrink-0">
              {t('step')} {step + 1} {t('of')} {totalSteps}
            </Badge>
          </div>
          <DialogDescription className="text-xs">{info.desc}</DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1">
          {stepKeys.map((key, i) => (
            <button
              key={key}
              className={`flex-1 h-1.5 rounded-full transition-colors cursor-pointer ${
                i === step
                  ? 'bg-primary'
                  : completed[i]
                    ? 'bg-green-500'
                    : i < step
                      ? 'bg-primary/30'
                      : 'bg-muted'
              }`}
              onClick={() => setStep(i)}
              title={stepInfo[key].title}
            />
          ))}
        </div>

        {/* Step title */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{info.title}</span>
          {isLaser && (
            <Badge variant="secondary" className="text-[9px]">Laser</Badge>
          )}
          {!isLaser && globalConfig.operationType === 'cnc' && (
            <Badge variant="secondary" className="text-[9px]">CNC</Badge>
          )}
        </div>

        <Separator />

        {/* Content */}
        {renderStep()}

        <Separator />

        {/* Navigation */}
        {currentKey !== 'ready' && (
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={goBack}
              disabled={step === 0}
              className="gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('back')}
            </Button>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={goNext}
                className="text-muted-foreground"
              >
                {t('skip')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  markDone(step)
                  goNext()
                }}
                disabled={step === 0 && !connected}
                className="gap-1"
              >
                {t('next')}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
