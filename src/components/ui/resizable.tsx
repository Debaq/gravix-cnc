import { useCallback, useRef, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface ResizablePanelGroupProps {
  direction: 'horizontal' | 'vertical'
  className?: string
  children: React.ReactNode
  /** Key para persistir tamaños en localStorage */
  storageKey?: string
}

interface ResizablePanelProps {
  defaultSize: number
  minSize?: number
  maxSize?: number
  className?: string
  children: React.ReactNode
}

interface ResizableHandleProps {
  withHandle?: boolean
  className?: string
}

/**
 * Panel resizable simple que funciona con WebKitGTK (Tauri en Linux).
 * Los tamaños son porcentajes del contenedor padre.
 */
export function ResizablePanelGroup({ direction, className, children, storageKey }: ResizablePanelGroupProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isHorizontal = direction === 'horizontal'

  // Extraer paneles y handles de los children
  const childArray = Array.isArray(children) ? children.flat() : [children]
  const panels: { defaultSize: number; minSize: number; maxSize: number }[] = []
  const handleIndices: number[] = []

  childArray.forEach((child: any, i: number) => {
    if (!child?.type) return
    if (child.type === ResizablePanel) {
      panels.push({
        defaultSize: child.props.defaultSize ?? 25,
        minSize: child.props.minSize ?? 5,
        maxSize: child.props.maxSize ?? 90,
      })
    } else if (child.type === ResizableHandle) {
      handleIndices.push(i)
    }
  })

  // Cargar tamaños guardados o usar defaults
  const loadSizes = () => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(`resizable:${storageKey}`)
        if (saved) {
          const parsed = JSON.parse(saved) as number[]
          if (parsed.length === panels.length) return parsed
        }
      } catch {}
    }
    return panels.map((p) => p.defaultSize)
  }

  const [sizes, setSizes] = useState<number[]>(loadSizes)
  const sizesRef = useRef(sizes)
  sizesRef.current = sizes

  // Persistir
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(`resizable:${storageKey}`, JSON.stringify(sizes))
    }
  }, [sizes, storageKey])

  // Drag handler
  const startDrag = useCallback((handleIndex: number, e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const totalSize = isHorizontal ? rect.width : rect.height
    const startPos = isHorizontal ? e.clientX : e.clientY
    const startSizes = [...sizesRef.current]

    // Panel a la izquierda/arriba y derecha/abajo del handle
    const leftIdx = handleIndex
    const rightIdx = handleIndex + 1

    const onMove = (ev: MouseEvent) => {
      const currentPos = isHorizontal ? ev.clientX : ev.clientY
      const delta = ((currentPos - startPos) / totalSize) * 100

      let newLeft = startSizes[leftIdx] + delta
      let newRight = startSizes[rightIdx] - delta

      // Clamp
      const minL = panels[leftIdx].minSize
      const maxL = panels[leftIdx].maxSize
      const minR = panels[rightIdx].minSize
      const maxR = panels[rightIdx].maxSize

      if (newLeft < minL) { newRight += newLeft - minL; newLeft = minL }
      if (newLeft > maxL) { newRight += newLeft - maxL; newLeft = maxL }
      if (newRight < minR) { newLeft += newRight - minR; newRight = minR }
      if (newRight > maxR) { newLeft += newRight - maxR; newRight = maxR }

      const next = [...startSizes]
      next[leftIdx] = newLeft
      next[rightIdx] = newRight
      setSizes(next)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [isHorizontal, panels])

  // Renderizar children con tamaños
  let panelIdx = 0
  let handleIdx = 0

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-full w-full',
        isHorizontal ? 'flex-row' : 'flex-col',
        className
      )}
    >
      {childArray.map((child: any, i: number) => {
        if (!child?.type) return null

        if (child.type === ResizablePanel) {
          const idx = panelIdx++
          const size = sizes[idx] ?? 25
          const style = isHorizontal
            ? { width: `${size}%`, minWidth: 0 }
            : { height: `${size}%`, minHeight: 0 }
          return (
            <div key={`panel-${idx}`} style={style} className={cn('overflow-hidden', child.props.className)}>
              {child.props.children}
            </div>
          )
        }

        if (child.type === ResizableHandle) {
          const idx = handleIdx++
          return (
            <div
              key={`handle-${idx}`}
              className={cn(
                'flex items-center justify-center shrink-0 select-none',
                isHorizontal
                  ? 'w-2 cursor-col-resize hover:bg-primary/20 active:bg-primary/30'
                  : 'h-2 cursor-row-resize hover:bg-primary/20 active:bg-primary/30',
                child.props.className
              )}
              onMouseDown={(e) => startDrag(idx, e)}
            >
              {child.props.withHandle && (
                <div className={cn(
                  'rounded-sm bg-border',
                  isHorizontal ? 'w-0.5 h-6' : 'h-0.5 w-6'
                )} />
              )}
            </div>
          )
        }

        return child
      })}
    </div>
  )
}

export function ResizablePanel({ children, className }: ResizablePanelProps) {
  // Renderizado controlado por ResizablePanelGroup
  return <>{children}</>
}

export function ResizableHandle(_props: ResizableHandleProps) {
  // Renderizado controlado por ResizablePanelGroup
  return null
}
