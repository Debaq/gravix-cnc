import { useMemo, useState, useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useMachineStore } from '@/stores/useMachineStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Copy, Check, Trash2, Cpu } from 'lucide-react'
import type {
  MachineProfile,
  Firmware,
  MachineType,
  OriginPosition,
} from '@/lib/profiles'
import { FIRMWARES, FIRMWARE_LABELS } from '@/lib/firmware'

const TYPES: { id: MachineType; label: string }[] = [
  { id: 'cnc', label: 'CNC' },
  { id: 'laser', label: 'Láser' },
  { id: 'plotter', label: 'Plotter' },
  { id: 'multi', label: 'Multi' },
]

const ORIGINS: { id: OriginPosition; label: string }[] = [
  { id: 'top-left', label: 'TL' },
  { id: 'top-center', label: 'TC' },
  { id: 'top-right', label: 'TR' },
  { id: 'center-left', label: 'CL' },
  { id: 'center', label: 'C' },
  { id: 'center-right', label: 'CR' },
  { id: 'bottom-left', label: 'BL' },
  { id: 'bottom-center', label: 'BC' },
  { id: 'bottom-right', label: 'BR' },
]

export function MachinesModal() {
  const { activeModal, closeModal, addConsoleLine } = useAppStore()
  const {
    machines,
    activeMachineId,
    setActive,
    updateMachine,
    deleteMachine,
    cloneFromPreset,
  } = useMachineStore()

  const isOpen = activeModal === 'machines'

  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Al abrir: selecciona la máquina activa por defecto.
  useEffect(() => {
    if (isOpen) setSelectedId(activeMachineId)
  }, [isOpen, activeMachineId])

  const selected = useMemo(
    () => machines.find((m) => m.id === selectedId) ?? null,
    [machines, selectedId],
  )

  const presets = machines.filter((m) => m.isBuiltin)
  const userMachines = machines.filter((m) => !m.isBuiltin)

  const handleClone = async (presetId: string) => {
    const clone = await cloneFromPreset(presetId)
    if (clone) {
      setSelectedId(clone.id)
      addConsoleLine(`Máquina creada desde preset: ${clone.name}`)
    }
  }

  const handleActivate = async () => {
    if (!selected) return
    await setActive(selected.id)
    addConsoleLine(`Máquina activa: ${selected.name}`)
  }

  const handleDelete = async () => {
    if (!selected || selected.isBuiltin) return
    await deleteMachine(selected.id)
    setSelectedId(null)
    addConsoleLine(`Máquina eliminada: ${selected.name}`)
  }

  const patch = (p: Partial<MachineProfile>) => {
    if (!selected || selected.isBuiltin) return
    updateMachine(selected.id, p)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className="max-w-4xl max-h-[85vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg font-medium">
            <Cpu className="h-5 w-5" />
            Máquinas
          </DialogTitle>
          <DialogDescription>
            Configurá perfiles de máquinas: firmware, protocolo, área y capacidades.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[260px_1fr] h-[520px]">
          {/* Lista */}
          <div className="border-r flex flex-col">
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground px-1">
                    Presets built-in
                  </Label>
                  <div className="mt-1 space-y-1">
                    {presets.map((m) => (
                      <MachineItem
                        key={m.id}
                        machine={m}
                        isActive={m.id === activeMachineId}
                        isSelected={m.id === selectedId}
                        onSelect={() => setSelectedId(m.id)}
                        onClone={() => handleClone(m.id)}
                      />
                    ))}
                  </div>
                </div>
                <Separator />
                <div>
                  <Label className="text-xs text-muted-foreground px-1">
                    Mis máquinas ({userMachines.length})
                  </Label>
                  {userMachines.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 mt-2">
                      Cloná un preset para crear tu máquina.
                    </p>
                  ) : (
                    <div className="mt-1 space-y-1">
                      {userMachines.map((m) => (
                        <MachineItem
                          key={m.id}
                          machine={m}
                          isActive={m.id === activeMachineId}
                          isSelected={m.id === selectedId}
                          onSelect={() => setSelectedId(m.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </div>

          {/* Detalle/Editor */}
          <div className="flex flex-col overflow-hidden">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Seleccioná una máquina
              </div>
            ) : (
              <MachineDetail
                machine={selected}
                isActive={selected.id === activeMachineId}
                onPatch={patch}
                onActivate={handleActivate}
                onDelete={handleDelete}
                onClone={() => handleClone(selected.id)}
              />
            )}
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t">
          <Button variant="outline" onClick={closeModal}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// Lista: item
// ============================================

function MachineItem({
  machine,
  isActive,
  isSelected,
  onSelect,
  onClone,
}: {
  machine: MachineProfile
  isActive: boolean
  isSelected: boolean
  onSelect: () => void
  onClone?: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer text-sm ${
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{machine.name}</span>
          {isActive && <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {machine.firmware}
        </div>
      </div>
      {onClone && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onClone()
          }}
          title="Clonar para editar"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

// ============================================
// Detalle / Editor
// ============================================

function MachineDetail({
  machine,
  isActive,
  onPatch,
  onActivate,
  onDelete,
  onClone,
}: {
  machine: MachineProfile
  isActive: boolean
  onPatch: (p: Partial<MachineProfile>) => void
  onActivate: () => void
  onDelete: () => void
  onClone: () => void
}) {
  const readonly = !!machine.isBuiltin

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar detalle */}
      <div className="px-5 py-3 border-b flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-medium truncate">{machine.name}</h3>
            {readonly && (
              <Badge variant="secondary" className="text-[11px]">
                Built-in
              </Badge>
            )}
            {isActive && (
              <Badge className="text-[11px] bg-green-600 hover:bg-green-600">
                Activa
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {machine.firmware} · {machine.type} · {machine.kinematics}
          </p>
        </div>
        {readonly ? (
          <Button size="sm" onClick={onClone}>
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Clonar
          </Button>
        ) : (
          <>
            {!isActive && (
              <Button size="sm" onClick={onActivate}>
                Activar
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Eliminar
            </Button>
          </>
        )}
      </div>

      {/* Contenido */}
      <Tabs defaultValue="general" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-5 mt-3 w-fit">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="protocol">Protocolo</TabsTrigger>
          <TabsTrigger value="homing">Homing</TabsTrigger>
          <TabsTrigger value="area">Área</TabsTrigger>
          <TabsTrigger value="caps">Capacidades</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 px-5 pb-5">
          <TabsContent value="general" className="mt-4 space-y-4">
            <Field label="Nombre">
              <Input
                value={machine.name}
                disabled={readonly}
                onChange={(e) => onPatch({ name: e.target.value })}
              />
            </Field>
            <Field label="Firmware">
              <Select
                value={machine.firmware}
                disabled={readonly}
                onValueChange={(v: Firmware) => onPatch({ firmware: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIRMWARES.map((fw) => (
                    <SelectItem key={fw} value={fw}>
                      {FIRMWARE_LABELS[fw]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tipo">
              <Select
                value={machine.type}
                disabled={readonly}
                onValueChange={(v: MachineType) => onPatch({ type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notas">
              <Input
                value={machine.notes ?? ''}
                disabled={readonly}
                onChange={(e) => onPatch({ notes: e.target.value })}
                placeholder="Observaciones, limitaciones..."
              />
            </Field>
          </TabsContent>

          <TabsContent value="protocol" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Baud rate">
                <Input
                  type="number"
                  value={machine.protocol.baudRate}
                  disabled={readonly}
                  onChange={(e) =>
                    onPatch({
                      protocol: {
                        ...machine.protocol,
                        baudRate: parseInt(e.target.value) || 115200,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Status poll (ms)">
                <Input
                  type="number"
                  value={machine.protocol.statusPollMs}
                  disabled={readonly}
                  onChange={(e) =>
                    onPatch({
                      protocol: {
                        ...machine.protocol,
                        statusPollMs: parseInt(e.target.value) || 250,
                      },
                    })
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status command">
                <Input
                  value={machine.protocol.statusCommand}
                  disabled={readonly}
                  onChange={(e) =>
                    onPatch({
                      protocol: { ...machine.protocol, statusCommand: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Identify command">
                <Input
                  value={machine.protocol.identifyCommand}
                  disabled={readonly}
                  onChange={(e) =>
                    onPatch({
                      protocol: { ...machine.protocol, identifyCommand: e.target.value },
                    })
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Error prefix">
                <Input
                  value={machine.protocol.errorPrefix}
                  disabled={readonly}
                  onChange={(e) =>
                    onPatch({
                      protocol: { ...machine.protocol, errorPrefix: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Alarm prefix">
                <Input
                  value={machine.protocol.alarmPrefix}
                  disabled={readonly}
                  onChange={(e) =>
                    onPatch({
                      protocol: { ...machine.protocol, alarmPrefix: e.target.value },
                    })
                  }
                />
              </Field>
            </div>
          </TabsContent>

          <TabsContent value="homing" className="mt-4 space-y-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Homing habilitado</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Si está deshabilitado, el botón Home queda bloqueado.
                </p>
              </div>
              <Switch
                checked={machine.homing.enabled}
                disabled={readonly}
                onCheckedChange={(v) =>
                  onPatch({ homing: { ...machine.homing, enabled: v } })
                }
              />
            </div>
            <Field label="Comando de homing">
              <Input
                value={machine.homing.command}
                disabled={readonly || !machine.homing.enabled}
                onChange={(e) =>
                  onPatch({ homing: { ...machine.homing, command: e.target.value } })
                }
                placeholder="$H (GRBL) · G28 (Marlin)"
              />
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Requerir home antes de jog</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Bloquea jog hasta que la máquina esté homed.
                </p>
              </div>
              <Switch
                checked={machine.homing.requireBeforeJog}
                disabled={readonly}
                onCheckedChange={(v) =>
                  onPatch({ homing: { ...machine.homing, requireBeforeJog: v } })
                }
              />
            </div>
          </TabsContent>

          <TabsContent value="area" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ancho (mm)">
                <Input
                  type="number"
                  value={machine.workArea.width}
                  disabled={readonly}
                  onChange={(e) =>
                    onPatch({
                      workArea: {
                        ...machine.workArea,
                        width: parseInt(e.target.value) || 0,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Alto (mm)">
                <Input
                  type="number"
                  value={machine.workArea.height}
                  disabled={readonly}
                  onChange={(e) =>
                    onPatch({
                      workArea: {
                        ...machine.workArea,
                        height: parseInt(e.target.value) || 0,
                      },
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Origen">
              <div className="grid grid-cols-3 gap-1 max-w-[200px]">
                {ORIGINS.map((o) => (
                  <Button
                    key={o.id}
                    variant={machine.workArea.origin === o.id ? 'default' : 'outline'}
                    size="sm"
                    disabled={readonly}
                    onClick={() =>
                      onPatch({ workArea: { ...machine.workArea, origin: o.id } })
                    }
                    className="h-8 text-xs"
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            </Field>
            <Separator />
            <Label className="text-xs text-muted-foreground">Máximo recorrido</Label>
            <div className="grid grid-cols-3 gap-3">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <Field key={axis} label={`Max ${axis.toUpperCase()} (mm)`}>
                  <Input
                    type="number"
                    value={machine.motion.maxTravel[axis]}
                    disabled={readonly}
                    onChange={(e) =>
                      onPatch({
                        motion: {
                          ...machine.motion,
                          maxTravel: {
                            ...machine.motion.maxTravel,
                            [axis]: parseInt(e.target.value) || 0,
                          },
                        },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="caps" className="mt-4 space-y-2">
            <p className="text-xs text-muted-foreground mb-3">
              Funciones que soporta esta máquina. Desactivar omite la generación
              de los comandos correspondientes en el G-code.
            </p>
            {(
              [
                ['spindle', 'Husillo (M3/M5)'],
                ['laser', 'Láser (M3/M4 con potencia S)'],
                ['plotter', 'Plotter (pluma/servo)'],
                ['probe', 'Sonda Z (G38.x)'],
                ['homing', 'Homing soportado'],
                ['softLimits', 'Soft limits'],
                ['tlo', 'Tool length offset (G43/G43.1)'],
                ['coolant', 'Refrigerante (M7/M8/M9)'],
                ['arcs', 'Arcos G2/G3'],
                ['toolChanger', 'Cambio de herramienta automático'],
              ] as const
            ).map(([key, label]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-md border p-2.5"
              >
                <Label className="text-sm font-normal">{label}</Label>
                <Switch
                  checked={machine.capabilities[key]}
                  disabled={readonly}
                  onCheckedChange={(v) =>
                    onPatch({
                      capabilities: { ...machine.capabilities, [key]: v },
                    })
                  }
                />
              </div>
            ))}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  )
}
