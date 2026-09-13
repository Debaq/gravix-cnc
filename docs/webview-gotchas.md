# Trampas del webview de escritorio

Guía reusable para apps de escritorio hechas con webview (Tauri, Electron, wails).
Tres cosas que se comportan distinto de lo que uno espera de una pagina web, con
el sintoma, la causa y como verificar el arreglo. Salieron de bugs reales de este
proyecto pero no tienen nada de especifico a el.

Estado de cada una, para no perder tiempo: la **1 sigue sin resolverse** (esta
documentado hasta donde llegue y que probar despues); la **2** y la **3** estan
resueltas y verificadas.

- [1. El pellizco del touchpad agranda toda la app](#1-el-pellizco-del-touchpad-agranda-toda-la-app) — ⚠️ sin resolver
- [2. El lienzo abre descentrado o fuera de escala](#2-el-lienzo-abre-descentrado-o-fuera-de-escala)
- [3. Una clave de traduccion faltante no se nota](#3-una-clave-de-traduccion-faltante-no-se-nota)
- [4. Como verificar todo esto en Linux/Wayland](#4-como-verificar-todo-esto-en-linuxwayland)

---

## 1. El pellizco del touchpad agranda toda la app

> **⚠️ SIN RESOLVER en este proyecto (2026-09-13).** Lo de abajo tapa dos
> caminos reales y los dos estan implementados y verificados, pero **el
> pellizco de verdad sigue agrandando la app**. O sea: el gesto entra por un
> tercer camino que todavia no identifique. Al final de la seccion estan las
> hipotesis en orden de que probar primero. No des por hecho que copiando esto
> se arregla.

**Sintoma**: pellizcas en cualquier parte y se agranda la interfaz entera —
paneles, tipografia, barras— en vez de hacer zoom en el contenido.

Hay **dos caminos distintos** que producen el mismo sintoma, y tapar uno solo
deja el bug vivo. Esto es lo que mas cuesta: se arregla el del DOM, se prueba en
el navegador, funciona, y en la app empaquetada sigue pasando.

### Camino A — el DOM: pellizco = `wheel` con Ctrl

En un touchpad el pellizco **no llega como gesto**: el sistema lo traduce a un
evento `wheel` con `ctrlKey: true`, que es exactamente la combinacion que el
navegador usa para su zoom de pagina. Si tu canvas cancela el evento pero el
resto de la app no, pellizcar sobre un panel hace zoom de la ventana.

```ts
// Cancelarlo a nivel ventana, no solo sobre el canvas
const onWheel = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault() }

// passive:false es lo que lo hace cancelable. Sin eso el navegador
// ignora el preventDefault y hace zoom igual
window.addEventListener('wheel', onWheel, { passive: false })
```

Conviene cubrir tambien los gestos de WebKit (`gesturestart`, `gesturechange`,
`gestureend`) y el zoom por teclado (Ctrl con `+`, `-`, `0`). Implementacion
completa: [`src/hooks/usePreventAppZoom.ts`](../src/hooks/usePreventAppZoom.ts).

### Camino B — el webview se lo come antes del DOM

En **Linux / WebKitGTK** el pellizco lo atiende el propio widget: cambia su
propiedad `zoom-level` y el evento **nunca pasa por el DOM**. Cancelarlo desde
JavaScript es imposible, no porque falte el `preventDefault` sino porque no hay
evento que cancelar.

Se arregla del lado nativo: escuchar el cambio de zoom y volver a 1.

```rust
#[cfg(target_os = "linux")]
fn lock_webview_zoom(window: &tauri::WebviewWindow) {
    use webkit2gtk::WebViewExt;

    let _ = window.with_webview(|webview| {
        let wv = webview.inner();
        wv.set_zoom_level(1.0);
        wv.connect_zoom_level_notify(|wv| {
            // La comparacion evita la recursion: volver a poner 1 dispara
            // la señal de nuevo
            if (wv.zoom_level() - 1.0).abs() > f64::EPSILON {
                wv.set_zoom_level(1.0);
            }
        });
    });
}
```

Necesita `webkit2gtk` como dependencia solo-Linux, en la version que ya usa wry
(mirar `Cargo.lock` antes de elegirla, asi no se baja una segunda copia):

```toml
[target.'cfg(target_os = "linux")'.dependencies]
webkit2gtk = "2.0"
```

Equivalentes por plataforma, si haces esto en otra app:

| Plataforma | Motor | Donde se apaga |
|---|---|---|
| Linux | WebKitGTK | `zoom-level` del `WebView` (arriba) |
| Windows | WebView2 | `CoreWebView2Settings.IsZoomControlEnabled = false` |
| macOS | WKWebView | `allowsMagnification = false` |

En Tauri, ademas, `zoomHotkeysEnabled` (config de ventana) cubre **solo** el zoom
por teclado, no el gesto. No alcanza.

### Y el zoom que si queres: el del contenido

Si tu lienzo hace zoom con la rueda, el pellizco entra por el mismo handler pero
con deltas chicos y continuos. Con escalones fijos se siente a los saltos:

```ts
const factor = evt.ctrlKey
  ? Math.exp(-evt.deltaY * 0.01)   // pellizco: proporcional al delta
  : evt.deltaY > 0 ? 1 / 1.05 : 1.05  // rueda: escalon fijo
```

### Como verificar sin tener que pellizcar — y por que no alcanza

Este atajo es el que me hizo cantar victoria antes de tiempo, asi que va con la
advertencia puesta: **mover `zoom-level` a mano prueba que el candado cierra esa
puerta, no que el gesto pase por ahi.** Si despues del arreglo el pellizco sigue
funcionando, es que entra por otro lado (ver mas abajo).

1. Agregar temporalmente al arranque: `window.set_zoom(1.6)` a los 2 segundos,
   y una variable de entorno que saltee el candado.
2. Correr **dos veces con la misma ventana** (tamaño fijo, no maximizada, para
   poder distinguirla de otras instancias abiertas) y capturar cada una.
3. Con candado: la interfaz se ve normal. Sin candado: se ve 1.6x.
4. Sacar la instrumentacion.

### Si despues de todo eso el pellizco sigue agrandando la app

Que es exactamente lo que pasa aca. Por orden de costo, lo que sigue:

1. **Descartar el compositor antes que nada.** Pellizca sobre otra ventana
   cualquiera —una terminal, el navegador—. Si tambien hace zoom, no es tu app:
   es el escritorio. En KDE es el efecto *Zoom* de KWin (Preferencias del
   sistema → Efectos de escritorio) y en GNOME el zoom de accesibilidad; los dos
   se pueden atar a gestos del touchpad. Ninguna app puede evitarlo, y tampoco
   deberia.
2. **Mirar si `zoom-level` se mueve.** Loguear el valor en el
   `connect_zoom_level_notify` mientras pellizcas. Si nunca imprime, WebKitGTK
   esta escalando por otra via (page scale / viewport) y el candado sobre
   `zoom-level` nunca se iba a enterar.
3. **Interceptar el gesto en GTK.** WebKitGTK arma su propio `GtkGestureZoom`
   sobre el widget. Agregar uno propio en fase *capture* que reclame la
   secuencia (`gtk_gesture_set_state(CLAIMED)`) le saca el gesto de las manos
   antes de que lo procese.
4. **Revisar la version de WebKitGTK.** El manejo del pinch cambio entre
   versiones; lo que aplica a 2.4x puede no aplicar a la que tenes instalada.

Lo que **si** quedo resuelto de la seccion: Ctrl+rueda con mouse, el zoom por
teclado, y cualquier cambio programatico de `zoom-level`.

---

## 2. El lienzo abre descentrado o fuera de escala

**Sintoma**: el area de dibujo abre gigante, corrida, o directamente no se ve.
Despues de tocar zoom manualmente se acomoda.

**Causa**: el encuadre inicial se calcula una sola vez, al montar, contra el
tamaño que tenga el contenedor **en ese instante** — y ese no es el tamaño final.
En Tauri es la combinacion tipica de config:

```json
{ "width": 1280, "height": 800, "maximized": true, "visible": false }
```

La ventana se crea de 1280x800 y oculta; el front monta y mide; **despues** el
gestor de ventanas la maximiza y la muestra. Todo lo que se calculo con la medida
vieja queda mal para siempre. Lo mismo pasa con un splash que tapa el arranque, o
con un panel lateral que se abre despues.

Tres reglas que lo cierran:

1. **No encuadrar contra cero.** Si el contenedor mide 0 (ventana oculta), el
   zoom da 0 y la matriz de transformacion queda degenerada: no se ve nada y
   toda la matematica de puntero pasa a dar `NaN`. Devolver `false` y dejarlo
   pendiente.

2. **Reencuadrar cuando llega el tamaño de verdad.** Un `ResizeObserver` que solo
   ajusta el tamaño del canvas no alcanza: hay que recalcular la vista.

3. **No pisarle el zoom al usuario.** Una vez que hizo zoom o paneo, el resize no
   debe reencuadrar: solo corregir el centro moviendo el viewport la mitad del
   cambio de tamaño, asi lo que estaba en el medio sigue en el medio.

```ts
const observer = new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect
  if (width <= 0 || height <= 0) return

  const prevW = canvas.getWidth(), prevH = canvas.getHeight()
  canvas.setDimensions({ width, height })

  if (needsFit || !isViewTouched(canvas)) {
    needsFit = !fitToContent(canvas)          // todavia es la vista automatica
  } else {
    const vpt = canvas.viewportTransform      // el usuario ya la acomodo
    vpt[4] += (width - prevW) / 2
    vpt[5] += (height - prevH) / 2
    canvas.setViewportTransform(vpt)
  }
})
```

Detalles que se pasan por alto:

- **Overlays que tapan borde**: reglas, toolbars flotantes. Centrar contra el
  lienzo entero deja el dibujo corrido; hay que descontar ese margen del calculo.
- **Atajo de "ajustar vista"**: conviene que devuelva la vista al modo automatico,
  asi sigue encuadrada si despues cambia el tamaño de la ventana.

Implementacion: `fitWorkAreaToCanvas()` y el `ResizeObserver` en
[`src/components/canvas/DesignCanvas.tsx`](../src/components/canvas/DesignCanvas.tsx),
mas `markViewTouched`/`isViewTouched` en `useCanvasManager.ts`.

### Paneo: Alt+arrastre no sirve en Linux

KDE y GNOME se quedan con **Alt+arrastre** para mover la ventana: el evento nunca
llega a la app. Si esa es tu unica forma de panear ademas del boton del medio del
mouse (que muchos touchpads no tienen), el usuario no puede panear.

La que siempre funciona es **barra espaciadora + arrastre**. Acordate de resetear
el estado en el `blur` de la ventana, o el modo queda pegado si el foco se va con
la barra apretada.

---

## 3. Una clave de traduccion faltante no se nota

**Sintoma**: en la interfaz aparece `LAYERS.TITLE` en vez del texto.

**Causa**: i18next devuelve **la clave** cuando no encuentra la traduccion, y una
clave es un string no vacio. Entonces esto nunca cae al fallback:

```tsx
{t('layers.title') || 'Layers'}   // devuelve 'layers.title', que es truthy
```

El fallback da falsa sensacion de red de seguridad. Si lo queres de verdad:

```tsx
{t('layers.title', { defaultValue: 'Layers' })}
```

Mejor todavia: un barrido que compare las claves usadas contra los archivos de
cada namespace. Dos trampas al escribirlo:

- Un mismo archivo puede tener **varios `useTranslation` con alias distintos**
  (`const { t: ts } = useTranslation('settings')`). Si asumis un solo namespace
  por archivo, marca como faltantes claves que estan perfectas en otro.
- Comparar tambien **idioma contra idioma**: que es y en tengan exactamente el
  mismo juego de claves, no solo que existan las que se usan.

```python
# claves usadas por archivo, respetando el alias de cada useTranslation
binds = re.findall(r"\{\s*t(?:\s*:\s*(\w+))?\s*\}\s*=\s*useTranslation\(\s*'(\w+)'", src)
for alias, ns in binds:
    fn = alias or 't'
    for key in re.findall(rf"\b{fn}\(\s*'([a-zA-Z][\w.]*)'", src):
        ...  # buscar key (con puntos) dentro de locales/<lang>/<ns>.json
```

---

## 4. Como verificar todo esto en Linux/Wayland

El problema practico: para confirmar un arreglo visual hace falta **ver** la
ventana, y en Wayland las herramientas de X no capturan.

**Capturar pantalla**

| Entorno | Comando |
|---|---|
| KDE | `spectacle -b -n -f -o out.png` (pantalla), `-a` (ventana activa) |
| wlroots | `grim out.png` |
| X11 | `import -window root out.png`, `scrot`, `maim` |

`import` de ImageMagick **no sirve bajo Wayland** aunque el binario exista: falla
con un error que no dice nada util (`missing an image filename`).

Si hay **varias instancias de la app abiertas**, la captura de "ventana activa" no
alcanza para saber cual es cual. Lanzar la de prueba con tamaño distinto y
decoraciones, por config, la vuelve identificable de un vistazo:

```bash
npm run tauri dev -- --config '{"app":{"windows":[{"label":"main",
  "title":"App PRUEBA","width":900,"height":650,"maximized":false,
  "decorations":true,"visible":true}]}}'
```

**Depurar el front sin la app**

Casi todo lo visual (layout, viewport, i18n) se reproduce sirviendo el front en
un navegador comun: `npx vite --port 5199`. Ahi tenes devtools de verdad. Ojo con
lo que **no** se reproduce: los gestos que atrapa el webview nativo, los dialogos
de archivo y todo lo que pase por IPC.

Si la app ya esta corriendo con el puerto de dev ocupado por otro proyecto,
apuntar el webview al puerto libre sin tocar la config del repo:

```bash
npm run tauri dev -- --config '{"build":{"devUrl":"http://localhost:5199"}}'
```

**Llegar a un objeto que no esta expuesto en `window`**

Para inspeccionar una instancia que vive en un ref de React (un canvas de Fabric,
por ejemplo), se puede caminar el fiber desde el elemento del DOM:

```js
const el = document.querySelector('canvas')
const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
let fiber = el[fk], found = null
while (fiber && !found) {
  let hook = fiber.memoizedState
  while (hook) {
    const s = hook.memoizedState
    if (s?.current?.viewportTransform) { found = s.current; break }  // el ref que busco
    hook = hook.next
  }
  fiber = fiber.return
}
```

**Cuidado con la pestaña en segundo plano**: si la ventana del navegador no esta
al frente, Chrome suspende el ciclo de render y el `ResizeObserver` **no
dispara**. Se ve como si el observer estuviera roto. Forzar un cuadro (una
captura, por ejemplo) lo destraba; `document.visibilityState` dice si estas en
ese caso.
