# Roadmap: CAD + CAM CNC

Estado CAD: **COMPLETADO** — incluidos los pendientes de imagen e import (P5).
Estado CAM: **CAM-P0 y CAM-P1/P2 parciales** (2026-09-13). Arbol de operaciones,
editor completo, stock, entrada tangente, acabado, feeds & speeds y optimizacion
de orden. Falta la simulacion de remocion de material (CAM-P3).
El generador cubre contorno, cajeado (3 estrategias), taladro, v-carve, chamfer
y photo v-carve.

---

## P0 — Fundamentos CAD ✅

- Edicion de nodos (mover, agregar, eliminar, suave/esquina, split, cerrar/abrir)
- Operaciones booleanas (union, diferencia, interseccion, XOR)

## P1 — Herramientas de construccion ✅

- Offset de path
- Fillet (redondeo) + Chamfer (bisel) de esquinas
- Sistema de capas con visibilidad/lock/orden
- Import DXF (LINE, CIRCLE, ARC, LWPOLYLINE)

## P2 — Precision y productividad ✅

- Array rectangular y polar
- Cotas persistentes (se guardan en proyecto)
- Constraints geometricas (H/V lock en nodos, aplicadas durante drag)

## P3 — Herramientas de conveniencia ✅

- Trim real (recortar path en interseccion con otro)
- Extend (extender path hasta interseccion)
- Mirror (espejo horizontal/vertical)
- Medicion distancia (2 puntos) + angular (3 puntos)
- Export SVG (via Fabric.js toSVG)
- Export DXF (Rect, Circle, Ellipse, Path, Polygon, Line, Group)

## P4 — Precision y lectura del lienzo ✅ (2026-09-12)

Lo que faltaba para que el lienzo se sienta CAD y no editor vectorial.

- **Motor de snap geometrico** (`src/lib/snap-engine.ts`): extremo, punto medio,
  centro, cuadrante, interseccion, perpendicular, tangente y sobre-el-borde,
  con prioridad por tipo y marcador + etiqueta bajo el cursor. Antes solo habia
  snap de bounding box y grilla, y **el dibujo no snapeaba a nada**
- **Snap durante el dibujo y la edicion de nodos**: linea, arco, curva, cota,
  medicion y arrastre de nodos pasan por el motor (antes usaban el pixel crudo)
- **Ortho / polar**: bloqueo de direccion a multiplos configurables (90/45/30/15),
  con Shift como inversor temporal. Sobre el rayo la longitud se redondea a la
  grilla y los snaps solo fijan distancia, nunca sacan el punto del eje
- **Entrada numerica de angulo** junto a la de longitud (Tab salta entre ambas)
- **Reglas en mm** en los bordes con marcador de cursor, y coordenadas vivas
  del cursor + zoom % en el footer
- **Grilla adaptativa al zoom** (escalones 1/2/5 x 10^k) o paso fijo configurable;
  el snap de grilla usa el mismo paso que se dibuja
- **Formas por arrastre**: rectangulo, circulo y elipse se dibujan arrastrando
  con preview y medidas en vivo (Shift = 1:1). Antes solo se insertaban a 50mm
- **Ancho/Alto en el panel de propiedades** con candado de proporcion
- **Zoom a la seleccion** y atajos de teclado de herramienta (R/C/E/L/A/B/D/M/N,
  G/S/O/F8, +/-, Ctrl+0, Ctrl+Shift+0, Ctrl+X)
- **Guias de usuario**: se arrastran desde las reglas, se mueven, se borran
  soltandolas sobre la regla y participan del snap (cursor y arrastre de objetos)
- **Nodos al 100%**: symmetric node (handles colineales y de igual largo) y
  break node (corta el path sin partir el objeto)
- **Seleccionar similares**: mismo tipo, misma capa o mismo color
- **Hojas multiples**: pestañas tipo planilla; cada elemento guarda su `sheetId`
  y solo la hoja activa se ve, se edita y entra al G-code
- **Nesting**: acomoda las piezas en el area de trabajo (MaxRects + rectangulo de
  area minima + giro 90°). Empaca por rectangulo envolvente, no por contorno real

Archivos: `snap-engine.ts` (nuevo), `DesignCanvas.tsx`, `useCanvasManager.ts`,
`useCanvasStore.ts`, `useKeyboardShortcuts.ts`, `CanvasToolbar.tsx`,
`CanvasFooter.tsx`, `PropertiesPanel.tsx`, `DesignPanel.tsx`, `HelpModal.tsx`, i18n.

## P5 — Imagen, vectorizacion e import ✅ (2026-09-13)

Lo que faltaba para que una idea entre al lienzo sin pasar por otro programa.

- **Filtros de imagen** (`image_processing.rs`): brillo, contraste, gamma y enfoque
  antes del dithering. Los tres primeros en una LUT de 256 entradas; el enfoque es
  un unsharp mask 3x3. Antes una foto plana salia como una mancha y no habia con
  que corregirla
- **Auto-vectorizacion** (`vectorize.rs`): bitmap a contornos por marching squares.
  Tres modos — completo (con agujeros), **silueta** (solo el contorno exterior) y
  **eje medio** (`centerline.rs`, esqueletizacion Zhang-Suen + grafo del esqueleto,
  para line art de un trazo)
- **Import PDF / AI / EPS** (`vector_import.rs`): el formato se decide por contenido.
  PDF por streams, EPS con un interprete de pila que resuelve los atajos de los
  generadores. El texto no se convierte a curvas y se avisa; DWG queda afuera
- **Nesting por contorno real** (`nesting.ts`): rasterizado + bottom-left first-fit
  con giros. Una pieza en U ahora anida otra en la muesca; antes el bbox lo impedia
- **Photo V-Carve** (`photo-vcarve.ts`): la foto se talla con surcos de profundidad
  variable. La separacion sale del angulo de la fresa y la profundidad maxima

Archivos nuevos: `vectorize.rs`, `centerline.rs`, `vector_import.rs`,
`photo-vcarve.ts`, `TraceImageModal.tsx`.

---

# CAM — De visor 3D a CAM real

## Situacion actual

**Lo que ya existe (y funciona bien):**
- GlobalConfig con 60+ parametros (CNC, laser, plotter, pencil)
- 3 niveles de config: per-element > per-layer > global
- Multi-operaciones por elemento (pocket + contorno en mismo objeto)
- GCodeGenerator completo (1213 lineas): contorno inside/outside/on, pocket, drill, vcarve, chamfer
- Tabs, ramping, step-down, step-over, compensacion, tool changes
- Laser: cut/engrave/fill/raster, color mappings, kerf, lead-in
- Plotter: presion, blade offset, color grouping
- Persistencia completa en proyectos

**El problema arquitectonico:**
Todo lo anterior vive en el workspace CAD (PropertiesPanel, PreviewPanel). El workspace CAM
es solo un visor 3D pasivo. Resultado: config rapida en CAD es buena UX, pero no hay donde
refinar, reordenar, debuggear operaciones. El CAM deberia ser el centro de control de operaciones.

**Arquitectura objetivo:**
```
CAD (diseño)                          CAM (operaciones)
├─ Config rapida por objeto    →→→    ├─ Arbol de operaciones completo
├─ Config global como default  →→→    ├─ Editor detallado por operacion
├─ "Generar rapido" one-click  →→→    ├─ Regenerar/editar/reordenar ops
└─ Preview simple (2D paths)          ├─ Preview 3D por operacion
                                      ├─ Simulacion de toolpaths
                                      └─ Validacion y export final
```

CAD mantiene su flujo rapido (es su fortaleza). CAM lee las ops definidas en CAD y permite
trabajarlas en profundidad. Cambios en CAM se sincronizan de vuelta a los elementos.

---

## CAM-P0 — Arbol de operaciones y edicion (minimo viable)

Migrar el control de operaciones al workspace CAM. Sin esto, CAM sigue siendo solo visor.

- **Arbol de operaciones**: panel lateral en CAM mostrando todas las ops extraidas de canvas
  - Cada elemento con config custom o global aparece como operacion
  - Elementos con multi-ops se expanden mostrando cada sub-operacion
  - Drag & drop para reordenar (afecta orden de generacion G-code)
  - Toggle visibilidad por operacion (mostrar/ocultar en visor 3D)
  - Iconos por tipo: contorno, pocket, drill, vcarve, laser cut, engrave, etc.
- **Editor de operacion en CAM**: al seleccionar op en arbol, panel derecho muestra:
  - Todos los params de GlobalConfig relevantes al tipo de operacion
  - Preview 3D aislado de esa operacion sola
  - Estimacion de tiempo/distancia por operacion individual
  - Cambios se guardan de vuelta en element.config / element.operations
- **Seleccion bidireccional**: click en op del arbol → resalta geometria en visor 3D; click en toolpath 3D → selecciona op en arbol
- **Regeneracion selectiva**: regenerar G-code de una sola op sin regenerar todo
- **Indicadores de estado**: op valida (verde), op con warnings (amarillo), op invalida (rojo)
  - Sin herramienta asignada = warning
  - Profundidad mayor que stock = warning
  - Path abierto con pocket = error

## CAM-P1 — Stock, entradas y sujecion

Definir el material y mejorar calidad de corte.

- **Definicion de stock**: bloque rectangular con dimensiones y posicion relativa al diseño
  - Config en panel lateral CAM (no en CAD)
  - Offset del stock respecto a geometria (margin)
- **Visualizacion de stock en 3D**: caja semitransparente envolviendo geometria
- **Lead-in / lead-out**: arco o linea tangente al contorno (evita marcas de entrada)
  - Config ya existe parcialmente en laser (laserLeadIn), extender a CNC
- **Ramping mejorado**: preview visual del ramp en visor 3D (ya existe logica en generator)
- **Tabs mejorados**: posicionamiento manual de tabs en visor 3D (hoy solo auto-distribuidos)
  - Click en contorno para colocar/mover/eliminar tabs individualmente
  - Preview de tabs como volumenes 3D sobre el contorno
- **Safe-Z y clearance plane**: editable desde CAM (hoy hardcodeado o en config general)
- **Validacion de profundidad vs stock**: warning si op corta mas profundo que stock definido

## CAM-P2 — Feeds, speeds y optimizacion

Automatizar calculos y optimizar movimientos.

- **Calculadora feeds & speeds**: RPM, feedrate y plunge basados en material + herramienta + flautas
  - Extender MaterialsModal con chipload, SFM por material
  - Sugerencia automatica al seleccionar material + herramienta en op
  - Override manual siempre disponible
- **Optimizacion de orden**: minimizar movimientos rapidos entre operaciones
  - TSP (nearest neighbor) entre puntos de entrada de cada op
  - Visualizar rapids antes/despues de optimizar
- **Optimizacion dentro de pocket**: reducir retracciones innecesarias entre pasadas
- **Compensacion de herramienta G41/G42**: como alternativa a offset geometrico
- **Feedrate overlay**: colorear toolpath por velocidad real en visor 3D
  - Gradiente de color: lento (azul) → rapido (rojo)
- **Depth overlay**: colorear por profundidad Z (ya parcialmente implementado)
- **Comparador antes/despues**: visualizar diferencia al cambiar un parametro

## CAM-P3 — Simulacion avanzada y estrategias extra

Diferenciadores de calidad.

- **Simulacion de remocion de material**: representar stock cortandose en 3D
  - Heightmap approach (mas performante) o CSG (mas preciso)
  - Playback sincronizado con toolpath animation existente
  - Resultado final: pieza terminada vs stock original
- **Deteccion de colisiones**: herramienta/holder vs clamps, stock, mesa
- **Estimacion de tiempo mejorada**: usar aceleracion real de maquina (config GRBL $120/$121)
- **Visualizacion de herramienta**: cilindro/esfera 3D siguiendo toolpath con diametro real
- **Adaptive clearing (trochoidal)**: pocket con carga constante en fresa
  - Algoritmo complejo — libreria externa o implementacion propia
- **Rest machining**: detectar material restante de op anterior, limpiar solo eso
  - Requiere simulacion de remocion (heightmap) para saber que queda
- **Export job sheet**: resumen PDF con ops, herramientas, tiempos, setup instructions
- **Undo/redo en CAM**: historial independiente del CAD para cambios de operaciones

---

## Dependencias tecnicas CAM

| Feature | Estado | Depende de |
|---------|--------|-----------|
| Contorno inside/outside/on | ✅ YA EXISTE en generator | Offset path (existe) |
| Pocket (contour-parallel) | ✅ YA EXISTE en generator | Clipper.js (existe) |
| Drill / peck drilling | ✅ YA EXISTE en generator | — |
| V-carve | ✅ YA EXISTE en generator | — |
| Chamfer | ✅ YA EXISTE en generator | — |
| Tabs | ✅ YA EXISTE en generator | Auto-distribuidos, falta manual placement |
| Ramping | ✅ YA EXISTE en generator | Falta preview 3D del ramp |
| Step-down / step-over | ✅ YA EXISTE en config | — |
| Tool compensation | ✅ YA EXISTE en config | center/inside/outside |
| Multi-ops por elemento | ✅ YA EXISTE en data model | element.operations[] |
| Tool changes M6 | ✅ YA EXISTE en generator | Agrupa por herramienta |
| Laser modes completos | ✅ YA EXISTE | cut/engrave/fill/raster/color mapping |
| Lead-in (laser) | ✅ YA EXISTE | laserLeadIn param |
| Arbol de operaciones | ✅ YA EXISTE | `OperationsPanel.tsx` con drag & drop real |
| Editor de op en CAM | ✅ YA EXISTE | `OperationEditor.tsx`, todos los params por tipo |
| Preview por operacion | ✅ YA EXISTE | Solo/apagado filtran segments en el visor |
| Stock 3D | ✅ YA EXISTE | Caja translucida + validacion profundidad |
| Lead-in CNC | ✅ YA EXISTE | Linea perpendicular o arco tangente, con lead-out |
| Espiral continua (pocket) | ✅ YA EXISTE | `generatePocketSpiral` — anillos encadenados |
| Climb / conventional | ✅ YA EXISTE | `millingCounterClockwise` |
| Sobremedida + acabado | ✅ YA EXISTE | Desbaste con allowance + pasada final exacta |
| G41/G42 | ✅ YA EXISTE | Contorno nominal + G40; avisa que GRBL no lo soporta |
| Calculadora feeds/speeds | ✅ YA EXISTE | `feeds-speeds.ts`, chipload por familia de material |
| Optimizacion orden | ✅ YA EXISTE | `orderByNearestEntry` + toggle en el setup |
| Color por avance/profundidad | ✅ YA EXISTE | Selector en la barra del visor |
| Persistencia del setup CAM | ✅ YA EXISTE | `.gravix` 1.4 guarda stock, clamps, marcadores y orden |
| **Tabs manuales en 3D** | 🟡 PARCIAL | Posiciones manuales por % de perimetro; falta click en el visor |
| **Remocion de material** | ❌ FALTA | Heightmap o Three.js CSG — CAM-P3 |
| **Adaptive clearing** | ❌ FALTA | Algoritmo trochoidal — CAM-P3 |
| **Deteccion de colisiones 3D** | ❌ FALTA | Herramienta/holder vs clamps — CAM-P3 |
| **Job sheet / hoja de setup** | ❌ FALTA | Export PDF — CAM-P3 |
| **Undo/redo en CAM** | ❌ FALTA | Historial propio — CAM-P3 |
| Photo V-Carve | ✅ YA EXISTE | `photo-vcarve.ts`, surcos de profundidad variable |
| Import PDF/AI/EPS | ✅ YA EXISTE | `vector_import.rs` (DWG no) |
| Auto-vectorizacion | ✅ YA EXISTE | contorno, silueta y eje medio |
| Nesting true-shape | ✅ YA EXISTE | grilla de ocupacion, no NFP |
| **Rest machining** | ❌ FALTA | Requiere heightmap de P3 — CAM-P3 |

---

## Archivos creados durante el roadmap CAD

| Archivo | Proposito |
|---------|-----------|
| `src/lib/node-editor.ts` | Extraccion, manipulacion, hit-testing de nodos |
| `src/lib/boolean-ops.ts` | Union, diferencia, interseccion, XOR via Clipper |
| `src/lib/dxf-parser.ts` | Parser de archivos DXF |
| `src/lib/trim-extend.ts` | Trim en interseccion + extend hasta barrera |
| `src/lib/constraints.ts` | Constraints H/V/Fixed para nodos |
| `src/components/canvas/NodeEditToolbar.tsx` | Toolbar flotante modo nodos |
| `src/components/panels/LayersPanel.tsx` | Panel de capas |
| `src/components/modals/ArrayModal.tsx` | Modal de array rect/polar |

## Bugs corregidos

1. `Text` no importado en useCanvasManager → crash al crear cota
2. `workArea` leido de store equivocado → crash en booleanas
3. Arrays con clone() async sin await → elementos invisibles
4. Tipo `'cota'` faltante en firma `setDrawingMode`
5. Memory leak: `canvas.on` en vez de `canvas.off` en cleanup
6. `moveNode` recalculaba coords 4x → simplificado a 1x
7. `filletNode`/`chamferNode` tomaba Z como comando geométrico → fix con helpers


---

## CAM 2026-09-13 — de visor a CAM usable

Lo que se sumo en esta pasada, con el detalle de por que.

### Gestion de operaciones
- **El arbol manda sobre el G-code**: antes apagar o reordenar una operacion en
  CAM no cambiaba nada, porque `getJobsForGCode` armaba los jobs directo del
  canvas. Ahora cada job lleva su `opId` y `applyCAMPlan` filtra, aisla (solo) y
  ordena antes de generar
- **Crear, duplicar y borrar operaciones desde CAM**. Un elemento sin lista de
  operaciones corre su config implicita; al agregar la segunda se convierte a
  `element.operations[]` usando esa config como semilla
- **Drag & drop real** en la lista (antes el asa de arrastre era decorativa)
- **"A todas"**: copia los parametros de corte a las demas operaciones del mismo
  tipo sin tocarles la estrategia
- **Plantillas de toolpath** aplicables desde el editor (`profiles.ts`)

### Editor completo
Todos los parametros que ya existian en `GlobalConfig` pero no tenian UI en CAM:
chamfer, v-carve avanzado (resolucion, fondo plano), photo v-carve entero, laser
raster con dithering y filtros de imagen, Z de foco, offset Z de herramienta,
material por operacion y cantidad de filos.

### Stock
`Stock` en el setup de CAM: espesor, donde esta el cero Z, y bloque automatico
(bounding box del dibujo + margen) o manual. Se dibuja como caja translucida en
el visor y alimenta dos validaciones: corte mas profundo que el material, y
corte que no lo atraviesa cuando la operacion es de corte pasante.

### Calidad de corte
- **Entrada y salida tangente** (linea perpendicular o arco de 90°), que evita la
  marca de hundida en el canto
- **Sentido de fresado** climb / conventional
- **Sobremedida de desbaste + pasada de acabado** a medida exacta
- **G41/G42** para controles que lo soporten (el G-code sale sin offset
  geometrico; se avisa que GRBL no lo implementa)
- **Pocket en espiral**: los anillos del contour-parallel encadenados en un solo
  recorrido continuo, sin retraer entre anillo y anillo
- **Tabs manuales** por posicion sobre el perimetro, ademas de los repartidos

### Feeds, speeds y recorrido
- `feeds-speeds.ts`: RPM desde velocidad de superficie, avance desde chipload
  escalado por diametro, con avisos cuando la viruta queda demasiado fina
- **Optimizacion de orden** por vecino mas cercano entre operaciones
- **Color del toolpath por avance o por profundidad** en el visor

### Persistencia
El `.gravix` sube a 1.4 y guarda el setup de CAM completo (stock, clamps, safe Z,
posicion de cambio de herramienta, marcadores, orden y operaciones apagadas).
Antes todo eso se perdia al cerrar el proyecto.

Archivos nuevos: `config-defaults.ts`, `feeds-speeds.ts`, `cam-jobs.ts`.
