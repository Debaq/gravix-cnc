import { useEffect, useRef } from 'react'
import { useSerialStore } from '@/stores/useSerialStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerial } from './useSerial'

const JOG_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']

// Intervalo mínimo entre jogs mientras se mantiene la tecla. El autorepeat del
// sistema dispara ~30 eventos por segundo; encolar un `$J=` por cada uno llena
// la cola de jog del firmware y la máquina sigue moviéndose segundos después de
// soltar, además de rebotar los comandos siguientes con error.
const REPEAT_THROTTLE_MS = 120

/**
 * Keyboard jog: arrow keys move XY, PgUp/PgDn move Z.
 * Modifiers: Shift = 10x distance (fast), Ctrl = 0.1x (slow).
 * Escape = emergency stop (!).
 * Only active in control workspace when connected.
 *
 * Un toque = un incremento completo de `jogDistance`. Mantener la tecla encadena
 * incrementos a ritmo controlado y, al soltar, se manda jog-cancel (0x85) para
 * frenar con deceleración en lugar de ejecutar todo lo encolado.
 */
export function useKeyboardJog() {
  const serial = useSerial()
  // Teclas que se mantuvieron apretadas (hubo autorepeat). Solo esas necesitan
  // cancelación al soltar: un toque simple debe completar su incremento.
  const heldKeys = useRef(new Set<string>())
  const lastJogAt = useRef(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when typing in inputs
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
        return
      }

      const { currentWorkspace } = useAppStore.getState()
      if (currentWorkspace !== 'cnc') return

      const { connected, jogDistance, jogSpeed, sending } = useSerialStore.getState()
      if (!connected) return

      // Escape = emergency stop
      if (e.key === 'Escape') {
        e.preventDefault()
        serial.stop()
        return
      }

      if (!JOG_KEYS.includes(e.key)) return
      e.preventDefault()
      // Jog durante un job mezcla movimiento manual con el programa en curso.
      if (sending) return

      if (e.repeat) {
        heldKeys.current.add(e.key)
        if (Date.now() - lastJogAt.current < REPEAT_THROTTLE_MS) return
      }
      lastJogAt.current = Date.now()

      // Distance multiplier: Shift = fast (10x), Ctrl = slow (0.1x)
      let dist = jogDistance
      if (e.shiftKey) dist = jogDistance * 10
      else if (e.ctrlKey || e.metaKey) dist = jogDistance * 0.1

      switch (e.key) {
        case 'ArrowUp':
          serial.jogXY(0, dist, jogSpeed)
          break
        case 'ArrowDown':
          serial.jogXY(0, -dist, jogSpeed)
          break
        case 'ArrowLeft':
          serial.jogXY(-dist, 0, jogSpeed)
          break
        case 'ArrowRight':
          serial.jogXY(dist, 0, jogSpeed)
          break
        case 'PageUp':
          serial.jogZ(dist, jogSpeed)
          break
        case 'PageDown':
          serial.jogZ(-dist, jogSpeed)
          break
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!heldKeys.current.delete(e.key)) return
      if (!useSerialStore.getState().connected) return
      serial.jogCancel()
    }

    // Si la ventana pierde el foco no llega el keyup: se frena igual.
    const handleBlur = () => {
      if (heldKeys.current.size === 0) return
      heldKeys.current.clear()
      if (useSerialStore.getState().connected) serial.jogCancel()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [serial])
}
