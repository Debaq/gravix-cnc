import { useEffect } from 'react'

/**
 * Impide que el webview haga zoom de toda la interfaz.
 *
 * En un touchpad, el pellizco no llega como gesto: llega como un `wheel` con
 * `ctrlKey`, que es exactamente lo que el navegador usa para su propio zoom de
 * pagina. Sobre el lienzo el handler de Fabric ya lo cancela, pero en el resto
 * de la app nadie lo hacia y el pellizco agrandaba paneles, tipografia y
 * barras — que en una app de escritorio no es lo que uno quiere: el zoom es
 * del dibujo, no de la ventana.
 *
 * Se cancelan tres caminos:
 *
 *  - `wheel` con Ctrl (pellizco del touchpad y Ctrl+rueda del mouse)
 *  - los gestos `gesturestart/change/end` de WebKit, que en algunas versiones
 *    llegan ademas del wheel
 *  - Ctrl con `+`, `-` y `0`, el zoom por teclado del webview. Ojo: `0`, `+` y
 *    `-` ya son atajos del lienzo, asi que cancelarlos aca tambien evita que
 *    hagan las dos cosas a la vez
 */
export function usePreventAppZoom(): void {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault()
    }

    const onGesture = (e: Event) => e.preventDefault()

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0') {
        e.preventDefault()
      }
    }

    // passive: false es lo que hace cancelable al wheel; sin eso el navegador
    // ignora el preventDefault y hace zoom igual
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('gesturestart', onGesture, { passive: false })
    window.addEventListener('gesturechange', onGesture, { passive: false })
    window.addEventListener('gestureend', onGesture, { passive: false })
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('gesturestart', onGesture)
      window.removeEventListener('gesturechange', onGesture)
      window.removeEventListener('gestureend', onGesture)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
