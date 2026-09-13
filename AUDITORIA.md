# Auditoría de código — 2026-09-12

> **Estado: resuelta.** Todos los hallazgos de la auditoría original fueron
> corregidos en esta misma fecha. Este documento conserva el hallazgo y
> registra qué se hizo con cada uno.

## Resumen

Se auditaron módulos de `src/lib`, campos de `GlobalConfig`, acciones de store,
funciones exportadas y comandos Tauri. La auditoría encontró **2 módulos
huérfanos completos**, **3 campos de configuración con control de UI que no
afectaba la salida** (el usuario cambiaba el control y no pasaba nada), **19
acciones de store nunca invocadas**, **10 funciones exportadas sin consumidor**,
**4 comandos Tauri sin invocador** y **1 bug funcional confirmado** en rest
machining. Al conectar el módulo de tiling aparecieron **2 bugs más** que
estaban ocultos justamente porque el módulo nunca se ejecutaba.

De los 39 ítems marcados como completados en `PLAN-PARIDAD.md`, 35 se
verificaron con camino real UI→salida; los 2 que no resistieron la auditoría
(2.1 Pressure Output Real y 4B.2 Rest Machining) quedaron corregidos.

## Hallazgos graves (controles que mentían al usuario) — ✅ corregidos

| Control | Campo | Hallazgo | Resolución |
|---|---|---|---|
| `<Select>` estrategia de cajeado (`OperationEditor.tsx`) | `pocketStrategy` | `gcode-generator.ts` nunca leía el campo: el cajeado usaba siempre el mismo algoritmo | Implementada la estrategia zigzag (`generatePocketZigzag()` en `geometry.ts`, barrido raster a 45° + acabado de perímetro) y `emitHatchGCode()` en el generador, que enlaza barridos contiguos a profundidad en vez de retraer. La salida cambia de verdad según la selección |
| `<Select>` compensación de herramienta (`OperationEditor.tsx`) | `compensation` | 0 lecturas en todo el repo. Duplicaba exactamente lo que ya hace `workType` (`outline`/`inside`/`outside`), que sí se aplica | Campo y control **eliminados**. Dos controles para lo mismo, uno de ellos muerto, es peor que uno solo |
| `<Input>` presión, en 3 pantallas | `pressure` | `emitPlotterBody()` sólo leía `speed`, `pressureZ`, `passes` y `bladeOffset` | La presión se emite como palabra S en el pen-down (`M3 S<pressure>` / `M5` al levantar), que es como la consumen plotters y cortadoras con servo. Con `pressure = 0` no se emite S |

## Bug funcional — ✅ corregido

**Rest machining** (`gcode-generator.ts`): `restMachiningEnabled` sí cambiaba la
salida, pero `generatePocketGCode` se volvía a llamar sobre el **mismo `paths`
completo**, es decir, la fresa chica recajeaba el bolsillo entero en vez del
material que la grande no alcanzó. Costaba tiempo de máquina y desgaste sin
aportar nada.

Ahora `computeRestRegions()` (`boolean-ops.ts`) calcula por apertura morfológica
el material que la fresa de desbaste no alcanza y devuelve la **región de centro
de herramienta** de la fresa de acabado — el residuo de una esquina es más fino
que la propia fresa, así que tratarlo como material y erosionarlo por el radio
dejaba la pasada vacía. El cajeado la consume con `initialInset = 0`. Si la
fresa grande ya despejó todo, la pasada no se emite y se deja una nota en el
G-code.

Verificado sobre una L de 100×100 con fresa 6mm → 2mm: 5 regiones, una por cada
esquina convexa, con el centro de herramienta confinado a 1–3.2mm del borde.

## Módulos huérfanos — ✅ conectados

| Módulo | Resolución |
|---|---|
| `src/lib/tiling.ts` | `TilingModal.tsx`, accesible desde el botón de grilla en `GCodePanel`. Tamaño de tile, solape y margen; vista previa de la grilla; exporta un `.gcode` por tile |
| `src/lib/variable-text.ts` | `VariableTextModal.tsx`, en el menú Agregar del `DesignPanel`. Plantilla con placeholders, carga de CSV, aviso de columnas faltantes, preview de las primeras 20 filas y un text-path por registro |

### Bugs que aparecieron al conectar tiling

El módulo nunca se había ejecutado, así que nadie los había visto:

1. **Tiles vacíos en el medio**: los paths se asignaban a un tile por tener un
   **vértice** dentro. Un rectángulo más ancho que el tile no tiene vértices en
   las columnas del medio, así que esas columnas quedaban sin cortar.
2. **Paths sin recortar**: el docstring decía "paths clipped to this tile" pero
   no se recortaba nada — cada tile emitía el path completo y la máquina se
   habría salido de recorrido.

Ambos corregidos con recorte Liang-Barsky por segmento (`clipPathToRect()`). Un
path que entra completo en el tile se conserva tal cual, incluida su condición
de cerrado; uno que lo cruza se parte en tramos abiertos y el vecino corta el
resto. Además todos los jobs comparten ahora una grilla global
(`computeTileGrid()`): antes cada job calculaba su propio bbox y las piezas de
tiles distintos no habrían encajado.

## Código muerto — ✅ eliminado o reconectado

**Eliminado** (sin consumidor y sin propósito):

- Acciones de store: `addSheet`, `removeSheet`, `setActiveSheet`, `renameSheet`,
  `setGridSize`, `setShowPropertiesPanel`, `toggleGrid`, `toggleProportionalScale`,
  `updateConfigStatus`, `setGCodeGenerated`, `setAuthenticated`, `setAuthPassword`,
  `setMaterialsStatus`, `setToolsStatus`, `resetPresets`, `setLaserTestDuration`,
  `updateMacro`, `updatePosition` — junto con el estado que sólo ellas tocaban
  (`sheets[]`, `activeSheetId`, `gridSize`, `showPropertiesPanel`,
  `proportionalScale`, `configStatus`, `authenticated`, `authPassword`,
  `toolsStatus`, `materialsStatus`).
- Funciones: `polygonArea`, `ensureCCW`, `ensureCW` (`geometry.ts`),
  `hasConstraint`, `getNodeConstraints` (`constraints.ts`), `defaultOrigin`
  (`profiles.ts`), `textBoundsMm` (`text-to-path.ts`).
- Comandos Tauri sin invocador: `get_local_ips` y `serial_get_status` (el
  servidor HTTP usa sus propias funciones, no estos wrappers), `authenticate` y
  `process_image_base64_for_laser` (la ruta HTTP llama directo a
  `authenticate_from` y `process_image_base64`), más sus entradas muertas en
  `http-transport.ts`.

**Reconectado en vez de borrado**:

- `applyConstraints` y `getConstraintIndicators` (`constraints.ts`):
  `DesignCanvas.tsx` reimplementaba inline la lógica de aplicar y dibujar
  constraints. Ahora llama a las funciones de la librería.
- `addMachine` (`useMachineStore`): la auditoría lo marcó como muerto, pero sí
  vivía a través de `cloneFromPreset`. Se sacó de la interfaz pública del store
  y se inlineó en su único llamador.
- `feedOverride` / `spindleOverride` (`useSerialStore`): estos campos estaban
  fijos en 100 y sus setters nunca se llamaban, así que `ControlPanel` mostraba
  un 100% hardcodeado. Los overrides reales sí llegaban parseados en
  `diagnostics`. El panel lee ahora los valores reales y los campos duplicados
  se eliminaron.

## Falsos positivos descartados

| Símbolo | Por qué parecía muerto | Por qué no lo estaba |
|---|---|---|
| `vcarve.ts` (módulo completo) | 0 imports estáticos | Se carga con `await import('./vcarve')` en `gcode-generator.ts` |
| `pointInPolygon` (`geometry.ts`) | 0 hits fuera del propio archivo | Usado por `orderPathsInsideFirst`, que consume el generador |
| `estimateMinFeatureWidth` (`geometry.ts`) | ídem | Usado por `validateToolVsPaths`, consumido por el generador y `OperationsPanel` |
| `circleFrom3Points`, `linearizeArc` | ídem | Usados por `arcFrom3Points`, consumido por `DesignCanvas` y `useCanvasManager` |
| `segmentIntersection`, `extractSegments`, `findAllIntersections` | Aislados al buscar sólo su nombre | Encadenados dentro de `trimPathAtClick`/`extendPathToIntersection` |
| `material` (`GlobalConfig`) | 0 lecturas en el generador | Alimenta `BoxGeneratorModal` → `box-generator.ts` |
| `rasterDpi`, `rasterDithering`, `rasterThreshold`, `rasterInvert` | 0 lecturas en los TS de generación | Se envían al comando Tauri `process_image_for_laser`, cuyo backend Rust sí los usa |
| `toggleConstraint` | El módulo entero olía a muerto | Se usa en `NodeEditToolbar.tsx` |

## Verificación

- `tsc -b` y `vite build` limpios; `cargo check` limpio.
- Generación de G-code probada end-to-end fuera del navegador: cajeado
  contour-parallel vs zigzag producen salidas distintas y ambas marcadas en el
  encabezado; rest machining emite recorridos confinados a las esquinas;
  el plotter emite `M3 S35` / `M5` con presión 35 y ninguna S con presión 0.
- Tiling verificado sobre un rectángulo de 900×500 en tiles de 400×400: 6 tiles
  con cobertura completa (antes se perdía la columna del medio) y todos los
  fragmentos dentro de 0–400 en coordenadas locales.

## No verificado

- 1.4 Consola Mejorada y 4E.4 Tool Database Avanzada: los archivos existen y son
  importados, pero no se revisó el detalle interno de la implementación.
- No se auditaron los ~20 comandos Tauri restantes campo por campo del lado
  Rust; no se descarta lógica muerta *dentro* de un comando que sí es invocado.
- No se corrió la app en vivo ni se cortó material: la verificación es estática
  más ejecución del generador de G-code fuera del navegador.
