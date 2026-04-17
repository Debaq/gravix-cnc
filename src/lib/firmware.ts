import type { Firmware } from '@/lib/profiles'
import type { Dialect } from '@/lib/generated/Dialect'

// GRBL 1.1, GRBLHAL y FluidNC comparten el mismo parser serial. Marlin es distinto.
export function firmwareToDialect(fw: Firmware): Dialect {
  return fw === 'marlin' ? 'marlin' : 'grbl'
}

export const FIRMWARES: readonly Firmware[] = ['grbl', 'grblhal', 'fluidnc', 'marlin'] as const

export const FIRMWARE_LABELS: Record<Firmware, string> = {
  grbl: 'GRBL 1.1',
  grblhal: 'GRBLHAL',
  fluidnc: 'FluidNC',
  marlin: 'Marlin 2.x',
}

export const DIALECT_LABELS: Record<Dialect, string> = {
  grbl: 'GRBL-family',
  marlin: 'Marlin',
}
