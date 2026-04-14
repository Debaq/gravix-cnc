import { useEffect, useRef } from 'react'
import { useCanvasManager, getSharedCanvas } from './useCanvasManager'
import { useCanvasStore } from '@/stores/useCanvasStore'

export function useKeyboardShortcuts() {
  const cm = useCanvasManager()
  const cmRef = useRef(cm)
  cmRef.current = cm

  // Track if we're nudging so we push history only on keyup
  const isNudging = useRef(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      const isCtrl = e.ctrlKey || e.metaKey
      const isShift = e.shiftKey

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        // In node editing mode, delete selected node
        if (useCanvasStore.getState().nodeEditingElementId) {
          // Dispatch custom event — handled by DesignCanvas
          window.dispatchEvent(new CustomEvent('node-edit:delete'))
          return
        }
        cmRef.current.deleteSelected()
        return
      }

      // Ctrl+Z - Undo
      if (isCtrl && !isShift && e.key === 'z') {
        e.preventDefault()
        cmRef.current.undo()
        return
      }

      // Ctrl+Shift+Z or Ctrl+Y - Redo
      if (
        (isCtrl && isShift && e.key.toLowerCase() === 'z') ||
        (isCtrl && !isShift && e.key === 'y')
      ) {
        e.preventDefault()
        cmRef.current.redo()
        return
      }

      // Ctrl+C - Copy
      if (isCtrl && e.key === 'c') {
        e.preventDefault()
        cmRef.current.copySelected()
        return
      }

      // Ctrl+V - Paste
      if (isCtrl && e.key === 'v') {
        e.preventDefault()
        cmRef.current.paste()
        return
      }

      // Ctrl+D - Duplicate
      if (isCtrl && e.key === 'd') {
        e.preventDefault()
        cmRef.current.duplicateSelected()
        return
      }

      // Ctrl+A - Select all
      if (isCtrl && e.key === 'a') {
        e.preventDefault()
        cmRef.current.selectAll()
        return
      }

      // Escape - Exit node editing / trim / extend / Deselect
      if (e.key === 'Escape') {
        if (useCanvasStore.getState().nodeEditingElementId) {
          window.dispatchEvent(new CustomEvent('node-edit:exit'))
          return
        }
        if (useCanvasStore.getState().drawingMode) return
        if (useCanvasStore.getState().trimMode) {
          useCanvasStore.getState().setTrimMode(false)
          return
        }
        if (useCanvasStore.getState().extendMode) {
          useCanvasStore.getState().setExtendMode(false)
          return
        }
        cmRef.current.deselectAll()
        return
      }

      // Ctrl+G - Group
      if (isCtrl && !isShift && e.key === 'g') {
        e.preventDefault()
        cmRef.current.groupSelected()
        return
      }

      // Ctrl+Shift+G - Ungroup
      if (isCtrl && isShift && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        cmRef.current.ungroupSelected()
        return
      }

      // Arrow keys - Nudge (1px normal, 10px with Shift)
      const nudgeAmount = isShift ? 10 : 1
      let nudged = false
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          cmRef.current.nudge(0, -nudgeAmount)
          nudged = true
          break
        case 'ArrowDown':
          e.preventDefault()
          cmRef.current.nudge(0, nudgeAmount)
          nudged = true
          break
        case 'ArrowLeft':
          e.preventDefault()
          cmRef.current.nudge(-nudgeAmount, 0)
          nudged = true
          break
        case 'ArrowRight':
          e.preventDefault()
          cmRef.current.nudge(nudgeAmount, 0)
          nudged = true
          break
      }
      if (nudged) {
        isNudging.current = true
        return
      }

      // Ctrl+] - Bring forward
      if (isCtrl && !isShift && e.key === ']') {
        e.preventDefault()
        cmRef.current.bringForward()
        return
      }

      // Ctrl+[ - Send backward
      if (isCtrl && !isShift && e.key === '[') {
        e.preventDefault()
        cmRef.current.sendBackward()
        return
      }

      // Ctrl+Shift+] - Bring to front
      if (isCtrl && isShift && e.key === ']') {
        e.preventDefault()
        cmRef.current.bringToFront()
        return
      }

      // Ctrl+Shift+[ - Send to back
      if (isCtrl && isShift && e.key === '[') {
        e.preventDefault()
        cmRef.current.sendToBack()
        return
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // Commit nudge to history when arrow key is released
      if (
        isNudging.current &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        isNudging.current = false
        cmRef.current.commitNudge()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])
}
