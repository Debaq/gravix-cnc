import type { AxisLimits } from '@/lib/generated/AxisLimits'
import type { Dialect } from '@/lib/generated/Dialect'
import { firmwareToDialect } from '@/lib/firmware'
import type { SerialConfig } from '@/lib/generated/SerialConfig'
import type { MachineProfile } from '@/lib/profiles'
import { useMachineStore } from '@/stores/useMachineStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useSerialStore } from '@/stores/useSerialStore'

// Buffer RX del firmware, en bytes. Es el recurso que el streaming por conteo
// de caracteres administra: mandar de más lo desborda y se pierden líneas.
// GRBL 1.1 y derivados usan 128; GRBLHAL/FluidNC son iguales o mayores, así que
// 128 es la cota segura para toda la familia.
const RX_BUFFER_BYTES = 128

export function buildSerialConfig(machine: MachineProfile | null): SerialConfig {
  const p = machine?.protocol
  return {
    line_ending: p?.lineEnding ?? '\n',
    status_poll_ms: Math.round(p?.statusPollMs ?? 250),
    rx_buffer_size: RX_BUFFER_BYTES,
    flow_control: p?.flowControl === 'simple' ? 'simple' : 'character-counting',
    abort_on_error: true,
  }
}

// Envolvente de trabajo contra la que se valida el G-code antes de enviarlo.
//
// El generador emite coordenadas de trabajo en el rango 0..ancho / 0..alto
// (el origen del área es metadato de canvas, no desplaza el G-code), y sube
// hasta Z+10 para los retracts. Se toma el mínimo entre el área definida y el
// recorrido físico de la máquina: lo que primero limite, manda.
export function buildAxisLimits(machine: MachineProfile | null): AxisLimits | null {
  if (!useSerialStore.getState().softLimitsEnabled) return null
  if (!machine) return null

  const travel = machine.motion.maxTravel
  const area = machine.workArea ?? useCanvasStore.getState().workArea
  if (!travel || travel.x <= 0 || travel.y <= 0) return null

  return {
    min_x: 0,
    max_x: Math.min(travel.x, area?.width || travel.x),
    min_y: 0,
    max_y: Math.min(travel.y, area?.height || travel.y),
    // Z negativo = profundidad de corte, positivo = retract sobre la pieza.
    min_z: -Math.abs(travel.z || 0),
    max_z: Math.abs(travel.z || 0),
  }
}

export function activeMachine(): MachineProfile | null {
  return useMachineStore.getState().getActive()
}

export function activeDialect(): Dialect {
  const m = activeMachine()
  return m ? firmwareToDialect(m.firmware) : 'grbl'
}
