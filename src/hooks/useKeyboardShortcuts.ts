import { useEffect, useRef } from 'react'
import { useCanvasManager, getSharedCanvas, ELEMENT_ID_KEY, getCustomProp } from './useCanvasManager'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAppStore } from '@/stores/useAppStore'

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

      // Con un modal abierto los atajos del lienzo no aplican
      if (useAppStore.getState().activeModal) return

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

      // Ctrl+X - Cut
      if (isCtrl && e.key === 'x') {
        e.preventDefault()
        cmRef.current.copySelected()
        cmRef.current.deleteSelected()
        return
      }

      // Ctrl+0 - Ajustar vista / Ctrl+Shift+0 - Zoom a la seleccion
      if (isCtrl && e.key === '0') {
        e.preventDefault()
        if (isShift) cmRef.current.fitSelection()
        else cmRef.current.fitView()
        return
      }

      // Zoom con +/- (con o sin Ctrl, como en cualquier editor)
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        cmRef.current.zoomIn()
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        cmRef.current.zoomOut()
        return
      }

      // ---- Atajos de herramienta (sin modificadores) ----
      if (!isCtrl && !e.altKey && !isShift) {
        const store = useCanvasStore.getState()
        // No pisar el dibujo en curso ni la edicion de nodos
        const busy = !!store.nodeEditingElementId

        switch (e.key.toLowerCase()) {
          case 'l':
            e.preventDefault()
            store.setDrawingMode(store.drawingMode === 'line' ? null : 'line')
            return
          case 'a':
            e.preventDefault()
            store.setDrawingMode(store.drawingMode === 'arc' ? null : 'arc')
            return
          case 'b':
            e.preventDefault()
            store.setDrawingMode(store.drawingMode === 'bezier' ? null : 'bezier')
            return
          case 'd':
            e.preventDefault()
            store.setDrawingMode(store.drawingMode === 'cota' ? null : 'cota')
            return
          case 'r':
            if (busy) return
            e.preventDefault()
            store.setDrawingMode(store.drawingMode === 'rect' ? null : 'rect')
            return
          case 'c':
            if (busy) return
            e.preventDefault()
            store.setDrawingMode(store.drawingMode === 'circle' ? null : 'circle')
            return
          case 'e':
            if (busy) return
            e.preventDefault()
            store.setDrawingMode(store.drawingMode === 'ellipse' ? null : 'ellipse')
            return
          case 'm':
            e.preventDefault()
            store.setMeasuringMode(store.measuringMode === 'distance' ? false : 'distance')
            return
          case 'n': {
            e.preventDefault()
            if (store.nodeEditingElementId) {
              window.dispatchEvent(new CustomEvent('node-edit:exit'))
              return
            }
            const canvas = getSharedCanvas()
            const active = canvas?.getActiveObject()
            if (active && typeof getCustomProp(active, ELEMENT_ID_KEY) === 'string') {
              window.dispatchEvent(new CustomEvent('node-edit:enter'))
            }
            return
          }
          case 'o':
            e.preventDefault()
            store.toggleOrtho()
            return
          case 'g':
            e.preventDefault()
            store.toggleSnapToGrid()
            return
          case 's':
            e.preventDefault()
            store.toggleSnapGeometry()
            return
        }

        // F8: ortho, como en los CAD clasicos
        if (e.key === 'F8') {
          e.preventDefault()
          store.toggleOrtho()
          return
        }
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
