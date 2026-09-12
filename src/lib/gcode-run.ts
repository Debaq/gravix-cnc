import { useGCodeStore } from '@/stores/useGCodeStore'

/**
 * Corre una generacion de G-code marcando `generating` en el store.
 *
 * `generateFromJobs` bloquea el hilo principal —segundos, en raster o en
 * miles de paths—, asi que cede un frame antes de arrancar: si no, React
 * nunca llega a pintar el spinner y la app se ve colgada.
 */
export async function withGenerating<T>(fn: () => Promise<T>): Promise<T> {
  const { setGenerating } = useGCodeStore.getState()
  setGenerating(true)
  await nextPaint()
  try {
    return await fn()
  } finally {
    setGenerating(false)
  }
}

/**
 * Espera a que el navegador pinte. Con la ventana oculta o minimizada
 * `requestAnimationFrame` no se dispara nunca, asi que el timer corre en
 * paralelo: sin eso la generacion quedaria colgada esperando un frame que no
 * llega.
 */
function nextPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(finish)
    setTimeout(finish, 50)
  })
}
