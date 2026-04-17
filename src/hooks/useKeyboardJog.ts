import { useEffect } from 'react'
import { useSerialStore } from '@/stores/useSerialStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSerial } from './useSerial'

/**
 * Keyboard jog: arrow keys move XY, PgUp/PgDn move Z.
 * Modifiers: Shift = 10x distance (fast), Ctrl = 0.1x (slow).
 * Escape = emergency stop (!).
 * Only active in control workspace when connected.
 */
export function useKeyboardJog() {
  const serial = useSerial()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when typing in inputs
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
        return
      }

      const { currentWorkspace } = useAppStore.getState()
      if (currentWorkspace !== 'cnc') return

      const { connected, jogDistance, jogSpeed } = useSerialStore.getState()
      if (!connected) return

      // Escape = emergency stop
      if (e.key === 'Escape') {
        e.preventDefault()
        serial.stop()
        return
      }

      // Distance multiplier: Shift = fast (10x), Ctrl = slow (0.1x)
      let dist = jogDistance
      if (e.shiftKey) dist = jogDistance * 10
      else if (e.ctrlKey || e.metaKey) dist = jogDistance * 0.1

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          serial.jogXY(0, dist, jogSpeed)
          break
        case 'ArrowDown':
          e.preventDefault()
          serial.jogXY(0, -dist, jogSpeed)
          break
        case 'ArrowLeft':
          e.preventDefault()
          serial.jogXY(-dist, 0, jogSpeed)
          break
        case 'ArrowRight':
          e.preventDefault()
          serial.jogXY(dist, 0, jogSpeed)
          break
        case 'PageUp':
          e.preventDefault()
          serial.jogZ(dist, jogSpeed)
          break
        case 'PageDown':
          e.preventDefault()
          serial.jogZ(-dist, jogSpeed)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [serial])
}
