# Plan de Paridad: Mach3 + LightBurn + Vectric Aspire + Plotter Profesional

> Ultima auditoria de codigo: **2026-09-12**
>
> Estado actual estimado (corregido tras auditar los imports reales):
> - vs Mach3: **~78%**
> - vs LightBurn: **~62%**
> - vs Vectric Aspire: **~38%**
> - vs Plotter pro (Silhouette/Cricut): **~62%**

---

## Auditoria 2026-09-12: modulos escritos pero nunca conectados

La revision cruzo cada item marcado ✅ contra los imports reales del proyecto.
Varios modulos existian en `src/lib/` **sin un solo consumidor**: codigo muerto
que el plan contaba como feature entregada. Se corrigieron los estados abajo y
se conectaron los mas baratos en esta misma pasada.

| Modulo | Estado antes de la auditoria | Estado ahora |
|--------|------------------------------|--------------|
| `vector-diagnostics.ts` | ✅ segun plan, 0 imports | ✅ conectado (modal + auto-limpieza en el pipeline) |
| `grbl-diagnostics.ts` | ✅ segun plan, 0 imports | ✅ conectado (status crudo desde Rust + panel I/O) |
| `profiles.ts` → `ToolpathTemplate` | ✅ segun plan, 0 consumidores | ✅ conectado (guardar/aplicar/exportar en GlobalConfigModal) |
| `ColorMapping` (store + generador) | ✅ segun plan, sin UI | ✅ conectado (editor de capas por color) |
| `tiling.ts` | ✅ segun plan, 0 imports | ✅ conectado (modal de tiles + export de un G-code por tile) |
| `variable-text.ts` | ✅ segun plan, 0 imports | ✅ conectado (modal de merge CSV → N textos en el lienzo) |
| `sheets[]` en `useCanvasStore` | ✅ segun plan | ❌ eliminado — era estructura sin feature; se rehace cuando se implemente de verdad |

Regla que sale de esto: **un modulo sin import no cuenta como completado.**
Un item se marca ✅ solo cuando hay camino desde la UI hasta el G-code.

---

## Fase 1: Fundamentos Críticos (Semana 1-2)

Cosas que bloquean uso real en las 3 modalidades.

### 1.1 ~~Keyboard Jog + Atajos de Teclado~~ ✅ COMPLETADO
- **Referencia**: Mach3, LightBurn, Aspire
- **Qué**: Flechas mueven ejes, +Shift = rápido (10x), +Ctrl = lento (0.1x). PgUp/PgDn = Z. Escape = stop
- **Archivos**: `useKeyboardJog.ts` (nuevo), `ControlPanel.tsx`
- **Esfuerzo**: S

### 1.2 ~~GRBL Config UI ($$ settings)~~ ✅ COMPLETADO
- **Qué**: Modal `GrblSettingsModal.tsx` con lectura/escritura de $$ settings. Agrupados por categoría (ejes, límites, homing, spindle, general). Botón en ControlPanel
- **Archivos**: `GrblSettingsModal.tsx` (nuevo), `App.tsx`, `ControlPanel.tsx`
- **Esfuerzo**: M

### 1.3 ~~Múltiples Passes (Plotter + Laser)~~ ✅ COMPLETADO
- **Qué**: `emitPlotterBody()` ahora respeta `config.passes` con loop como laser
- **Archivos**: `gcode-generator.ts`
- **Esfuerzo**: S

### 1.4 ~~Consola Mejorada~~ ✅ COMPLETADO
- **Qué**: Syntax highlight (errors=rojo, ok=verde, commands=azul, settings=amber), historial comandos (flecha arriba/abajo, 50 entries), auto-scroll
- **Archivos**: `ControlPanel.tsx`
- **Esfuerzo**: S

---

## Fase 2: Plotter — De Inútil a Funcional (Semana 2-3)

Estado actual: ALPHA ROTO. Múltiples campos dead code, sin optimización, sin multi-color.

### 2.1 ~~Pressure Output Real~~ ✅ COMPLETADO (completado 2026-09-12)
- **Qué**: Plotter usa `config.pressureZ` para Z down (antes hardcoded -1)
- **Faltaba**: el campo `config.pressure` — el que el usuario edita en OperationEditor, PropertiesPanel y GlobalConfigModal bajo la etiqueta "Presion" — **no lo leia nadie**. El item se daba por cerrado con `pressureZ`, que es otro campo
- **2026-09-12**: `emitPlotterBody()` emite la presion como palabra S en el pen-down (`M3 S<pressure>`, `M5` al levantar), que es como la consumen plotters y cortadoras con servo. Con `pressure = 0` no se emite ninguna S
- **Archivos**: `gcode-generator.ts` emitPlotterBody()
- **Esfuerzo**: S

### 2.2 ~~Blade Offset Compensation~~ ✅ COMPLETADO
- **Qué**: Nuevo campo `bladeOffset` en GlobalConfig. `emitPlotterBody()` async, offset closed paths con clipper. UI en GlobalConfigModal sección plotter
- **Archivos**: `types.ts`, `useCanvasStore.ts`, `gcode-generator.ts`, `GlobalConfigModal.tsx`, i18n
- **Esfuerzo**: M

### 2.3 ~~Color Grouping / Pen Sorting~~ ✅ COMPLETADO
- **Qué**: `strokeColor` en GCodePath. Fabric stroke capturado al extraer paths. `emitPlotterBody()` agrupa por color con M0 entre grupos
- **Archivos**: `types.ts`, `useCanvasManager.ts`, `gcode-generator.ts`
- **Esfuerzo**: M

### 2.4 ~~Tool Change para Plotter (M0/M6)~~ ✅ COMPLETADO
- **Qué**: `generateFromJobs()` ahora emite M0 (pausa) entre tool groups para plotter/pencil
- **Archivos**: `gcode-generator.ts`
- **Esfuerzo**: S

### 2.5 ~~Path Optimization Avanzada~~ ✅ COMPLETADO
- **Qué**: `orderPaths()` mejorado con path reversal (check start AND end de cada path), deduplicación de paths idénticos. 30-50% menos travel
- **Archivos**: `geometry.ts`
- **Esfuerzo**: M

### 2.6 ~~Preview de Plotter con Colores~~ ✅ COMPLETADO
- **Qué**: `GCodeSegment.color` parseado de comentarios de color group. `GCodeViewer3D` usa color real del path en vez de depth-based
- **Archivos**: `gcode-parser.ts`, `GCodeViewer3D.tsx`
- **Esfuerzo**: S

### 2.7 ~~Test Cut / Test Draw~~ ✅ COMPLETADO
- **Qué**: Botón "Test" en ControlPanel. Genera cuadrado 10mm con config actual (laser/plotter/cnc). Usa potencia, velocidad y presión configuradas
- **Archivos**: `ControlPanel.tsx`
- **Esfuerzo**: S

---

## Fase 3: Laser — Cerrar Gap con LightBurn (Semana 3-5)

Estado actual: raster bueno, vectorial básico, sin optimización avanzada.

### ~~3.1 Power Ramp / Curva de Potencia~~ (parcial)
- **Qué**: Parcialmente cubierto por 3.2 Corner Power Reduction + modo M4 dinámico (GRBL nativo ajusta potencia con aceleración). Power ramp manual completo no implementado
- **Archivos**: `gcode-generator.ts` (Corner Power Reduction + M4 dynamic mode)

### 3.2 ~~Corner Power Reduction~~ ✅ COMPLETADO
- **Qué**: `generateLaserContour()` detecta ángulos <150° entre segmentos y reduce potencia proporcionalmente (40-100% según ángulo). Evita sobre-quemado en esquinas
- **Archivos**: `gcode-generator.ts` (+helper `angleBetween()`)
- **Esfuerzo**: M

### 3.3 ~~Kerf Compensation~~ ✅ COMPLETADO
- **Qué**: Nuevo campo `laserKerf` en GlobalConfig. `emitLaserBody()` async, offset closed paths con `offsetPolygon()` en cut mode. UI en GlobalConfigModal
- **Archivos**: `types.ts`, `useCanvasStore.ts`, `gcode-generator.ts`, `GlobalConfigModal.tsx`, i18n
- **Esfuerzo**: S

### 3.4 ~~Optimización de Path Ordering~~ ✅ COMPLETADO
- **Qué**: `pointInPolygon()` + `orderPathsInsideFirst()` en geometry.ts. Detecta containment, corta interiores primero. Aplicado en `generateLaserContour()`
- **Archivos**: `geometry.ts`, `gcode-generator.ts`
- **Esfuerzo**: M

### 3.5 Auto-Vectorización (Potrace/similar)
- **Referencia**: LightBurn Trace Image
- **Qué**: Convertir imagen bitmap a paths vectoriales automáticamente
- **Por qué**: Actualmente solo raster. Vectorizar permite corte/engrave de logos desde foto
- **Archivos**: Nuevo módulo, posiblemente en Rust (image_processing.rs)
- **Esfuerzo**: L

### ~~3.6 Lead-In / Lead-Out~~ ✅ COMPLETADO
- **Qué**: Campo `laserLeadIn` en GlobalConfig + arco de aproximación en `generateLaserContour()` para paths cerrados. UI en GlobalConfigModal sección laser
- **Archivos**: `types.ts`, `useCanvasStore.ts`, `gcode-generator.ts`, `GlobalConfigModal.tsx`

### 3.7 Más Dithering + Filtros de Imagen — ⚠️ PARCIAL (dithering listo 2026-09-12)
- **Referencia**: LightBurn
- **2026-09-12 ✅ dithering**: `diffuse_error()` generico con tabla de kernel + Jarvis-Judice-Ninke, Stucki, Burkes y Sierra. 9 modos en total. Floyd-Steinberg y Atkinson quedan con su funcion propia; todo kernel nuevo entra por la generica
- **Falta**: filtros de imagen (brillo, contraste, sharpen, gamma) antes del dithering
- **Archivos**: `image_processing.rs`, `types.ts`, `ImageWizardModal.tsx`, i18n
- **Esfuerzo restante**: S

### ~~3.8 Color Mapping (Capas por Color)~~ ✅ COMPLETADO (UI 2026-09-12)
- **Qué**: Tipo `ColorMapping` + paleta default de 5 colores en canvasStore. `emitLaserBody()` agrupa paths por strokeColor y aplica power/speed/passes por color
- **2026-09-12**: `ColorMappingModal.tsx` — editor de capas (color, nombre, modo, potencia, velocidad, pasadas, on/off) con acceso desde la seccion laser de GlobalConfigModal. Antes la paleta solo se podia cambiar editando el store a mano
- **Archivos**: `types.ts`, `useCanvasStore.ts`, `gcode-generator.ts`, `ColorMappingModal.tsx`, `GlobalConfigModal.tsx`, i18n

### 3.9 ~~Focus Height / Z para Laser~~ ✅ COMPLETADO
- **Qué**: `laserFocusZ` en GlobalConfig, G0 Z al inicio de emitLaserBody
- **Archivos**: `gcode-generator.ts`, `GlobalConfigModal.tsx`

### 3.10 ~~Laser Crosshair / Frame~~ ✅ COMPLETADO
- **Qué**: Botón "Frame" en ControlPanel. Lee bounding box de Fabric canvas (o workArea fallback), genera G-code rectangular M4 S10, envía por serial
- **Archivos**: `ControlPanel.tsx`
- **Esfuerzo**: S

---

## Fase 4: CNC — Cerrar Gap con Mach3 + Aspire (Semana 4-6)

### 4.1 ~~Sistemas de Coordenadas G54-G59~~ ✅ COMPLETADO
- **Qué**: Selector dropdown G54-G59 en ControlPanel. Envía comando al cambiar. Estado en `useSerialStore`
- **Archivos**: `ControlPanel.tsx`, `useSerialStore.ts`
- **Esfuerzo**: M

### 4.2 ~~Tool Length Offset~~ ✅ COMPLETADO
- **Qué**: `lengthOffset` en Tool, `toolLengthOffset` en GlobalConfig. G43.1 automático en tool change CNC
- **Archivos**: `types.ts`, `useCanvasStore.ts`, `gcode-generator.ts`
- **Esfuerzo**: M

### 4.3 Probing Avanzado
- **Referencia**: Mach3
- **Qué**: UI dedicada para: probe Z (tool setter), probe XY (edge finder), surface leveling
- **Por qué**: Macro G38.2 existe pero sin UI. Surface leveling crítico para PCB
- **Archivos**: Nuevo `ProbingPanel.tsx`, `serial.rs` (leer resultado probe)
- **Esfuerzo**: L

### 4.4 ~~Soft Limits UI~~ ✅ COMPLETADO
- **Qué**: GrblSettingsModal ya muestra $20-$23, $130-$132. Ahora sync maxTravel y softLimitsEnabled al `useSerialStore` al leer settings
- **Archivos**: `GrblSettingsModal.tsx`, `useSerialStore.ts`
- **Esfuerzo**: S

### 4.5 ~~Canned Drilling Cycles~~ ✅ COMPLETADO
- **Qué**: WorkType `drill`, G81 simple y G83 peck drill. Holes extraídos de primer punto de cada path
- **Archivos**: `gcode-generator.ts`, `types.ts`

### 4.6 ~~Diagnóstico I/O~~ ✅ COMPLETADO (2026-09-12)
- **Qué**: Módulo `grbl-diagnostics.ts` con parseStatusReport() y parseParserState(). Parsea Pn:, Bf:, FS:, Ov:, A:, $G
- **Estaba muerto**: el backend descartaba la linea cruda del status (`handle_line` hacia `return` despues de normalizar posicion y estado), asi que no habia forma de parsear pines ni buffers
- **2026-09-12**: `GrblStatus` lleva ahora el campo `raw` con el reporte completo; `useSerial` lo parsea hacia `useSerialStore.diagnostics`, se pide `$G` al conectar y al cambiar de G54-G59, y ControlPanel muestra pines (X/Y/Z/P/D/H), buffers planner/rx, feed real, rapid override y el parser state
- **Archivos**: `grbl-diagnostics.ts`, `src-tauri/src/commands/serial.rs`, `generated/GrblStatus.ts`, `useSerial.ts`, `useSerialStore.ts`, `ControlPanel.tsx`

### 4.7 Backlash Compensation
- **Referencia**: Mach3
- **Qué**: Compensar juego mecánico al cambiar dirección por eje
- **Por qué**: Máquinas baratas tienen backlash significativo
- **Archivos**: `gcode-generator.ts` o GRBL $140-$142 si firmware soporta
- **Esfuerzo**: M

---

## Fase 4B: CAM Avanzado — Cerrar Gap con Aspire (Semana 5-7)

Features de toolpath que Aspire tiene y son críticas para CNC serio.

### 4B.1 ~~V-Carve Toolpath~~ ✅ COMPLETADO
- **Qué**: Módulo `vcarve.ts` con progressive offset-based approach. Depth = offset / tan(halfAngle). Soporta flat-bottom. WorkType `'vcarve'` integrado. UI con ángulo, max depth, resolución, flat-bottom
- **Archivos**: `vcarve.ts` (nuevo), `types.ts`, `useCanvasStore.ts`, `gcode-generator.ts`, `GlobalConfigModal.tsx`, i18n
- **Esfuerzo**: L

### ~~4B.2 Toolpath de Pocket con Rest Machining~~ ✅ COMPLETADO (corregido 2026-09-12)
- **Qué**: `restMachiningEnabled` + `restToolDiameter` en GlobalConfig. Segunda pasada de pocket con herramienta menor incluyendo pausa M0 para cambio de herramienta. UI toggle en GlobalConfigModal
- **Bug corregido 2026-09-12**: la segunda pasada volvia a cajear el bolsillo **entero** con la fresa chica (mismo `paths`), no el resto. Ahora `computeRestRegions()` (`boolean-ops.ts`) calcula por apertura morfologica el material que la fresa grande no alcanza y devuelve la region de **centro de herramienta** de la fresa chica; el cajeado la consume con `initialInset = 0`. Si la fresa grande ya despejo todo, no se emite la pasada
- **Archivos**: `types.ts`, `useCanvasStore.ts`, `gcode-generator.ts`, `boolean-ops.ts`, `geometry.ts`, `GlobalConfigModal.tsx`

### 4B.3 ~~Ramping / Lead-In en Profile~~ ✅ COMPLETADO
- **Qué**: `rampEnabled` + `rampAngle` en GlobalConfig. `emitPathGCode()` desciende gradualmente a lo largo de segmentos del path en vez de plunge directo. UI toggle + ángulo en GlobalConfigModal
- **Archivos**: `types.ts`, `useCanvasStore.ts`, `gcode-generator.ts`, `GlobalConfigModal.tsx`, i18n
- **Esfuerzo**: M

### 4B.4 ~~Tabs/Bridges en Profile~~ ✅ YA EXISTÍA
- **Qué**: `emitPathGCodeWithTabs()` ya implementado con distribución uniforme, interpolación de boundaries, Z transitions. UI con toggle + tabCount/tabWidth/tabHeight. Aplicado en último pass de closed paths
- **Archivos**: `gcode-generator.ts`, `GlobalConfigModal.tsx`
- **Esfuerzo**: (ya hecho)

### 4B.5 Inlay Toolpath
- **Referencia**: Aspire
- **Qué**: Par de toolpaths male (plug) + female (pocket) para incrustaciones con V-bit. Allowance para ajuste, glue gap automático
- **Por qué**: V-carve inlay es trend masivo en woodworking. Genera ambos toolpaths automáticamente
- **Archivos**: `gcode-generator.ts`, nuevo modal de configuración
- **Esfuerzo**: L

### 4B.6 Fluting Toolpath
- **Referencia**: Aspire
- **Qué**: Flautas decorativas a lo largo de vectores con ball-nose. Ramp at start/end, profundidad variable a lo largo del vector
- **Por qué**: Feature decorativa popular en mueblería y signage
- **Archivos**: `gcode-generator.ts`
- **Esfuerzo**: M

### 4B.7 Moulding / Prism Toolpath
- **Referencia**: Aspire
- **Qué**: Usar perfil vectorial como cross-section de moldura, recorrer un vector guía. Prism: formas elevadas 3D con V-bit
- **Por qué**: Marcos, molduras arquitectónicas, letras 3D elevadas
- **Archivos**: `gcode-generator.ts`, nuevo tipo de operación
- **Esfuerzo**: L

### 4B.8 ~~Chamfer Toolpath~~ ✅ COMPLETADO
- **Qué**: WorkType `chamfer`, V-bit offset at fixed depth usando offsetPolygon. UI en GlobalConfigModal
- **Archivos**: `gcode-generator.ts`, `GlobalConfigModal.tsx`, `types.ts`

### 4B.9 Texture Toolpath
- **Referencia**: Aspire
- **Qué**: Generar textura aleatoria tipo "hand-carved" con control de amplitud, longitud, densidad
- **Por qué**: Efecto artístico popular en signage y mueblería
- **Archivos**: `gcode-generator.ts`
- **Esfuerzo**: M

### ~~4B.10 Tiling de Toolpaths~~ ✅ COMPLETADO (UI 2026-09-12)
- **Qué**: Módulo `tiling.ts` con generateTiles() y tileHeader(). Split paths en tiles con overlap, coordenadas locales por tile
- **Estaba muerto**: **cero imports**, sin UI ni integracion con `generateFromJobs()`
- **2026-09-12**: `TilingModal.tsx` (boton de grilla en GCodePanel) con tamaño de tile, solape y margen; vista previa de la grilla y export de un `.gcode` por tile. Dos bugs del modulo salieron al conectarlo: los tiles se filtraban por **vertices** dentro del tile (un rectangulo mas ancho que el tile perdia las columnas del medio) y los paths no se recortaban (cada tile emitia el path completo y la maquina se salia de recorrido). Ahora se recorta con Liang-Barsky y todos los jobs comparten una grilla global (`computeTileGrid`)
- **Archivos**: `tiling.ts`, `TilingModal.tsx`, `GCodePanel.tsx`, `App.tsx`, i18n

### 4B.11 ~~Toolpath Templates~~ ✅ COMPLETADO (UI 2026-09-12)
- **Qué**: ToolpathTemplate type en `profiles.ts`. Save/load/export configs de toolpath
- **Estaba sin consumidores**: las funciones existian pero ninguna pantalla las llamaba
- **2026-09-12**: barra de plantillas al tope de GlobalConfigModal — guardar la config actual con nombre, aplicar con un click, borrar y exportar a JSON. Persistencia en localStorage
- **Archivos**: `profiles.ts`, `GlobalConfigModal.tsx`, i18n

---

## Fase 4C: Modelado 3D — Roadmap Aspire (Semana 8-12+)

Feature set más ambicioso. Aspire se diferencia de VCarve Pro por su modelado 3D completo. Esto nos pondría en otra liga.

### 4C.1 Crear Formas 3D desde Vectores
- **Referencia**: Aspire
- **Qué**: Generar relieves 3D desde vectores cerrados: dome, round, curved, angled, flat, custom cross-section. Combine modes: add, subtract, merge high/low, multiply
- **Por qué**: Core de Aspire. Permite crear modelos 3D sin software externo
- **Archivos**: Nuevo módulo `3d-modeling.ts`, viewer 3D
- **Esfuerzo**: XL

### 4C.2 Two-Rail Sweep
- **Referencia**: Aspire
- **Qué**: Barrer un perfil (cross-section) entre dos rieles vectoriales con control de escala y twist
- **Por qué**: Crea formas orgánicas complejas: patas de mesa, molduras, marcos
- **Archivos**: `3d-modeling.ts`
- **Esfuerzo**: XL

### 4C.3 Extrude and Weave
- **Referencia**: Aspire
- **Qué**: Extruir perfil a lo largo de vector guía con opciones de entrelazado (weaving, Celtic knots, cestería)
- **Por qué**: Patrones decorativos complejos imposibles de hacer manualmente
- **Archivos**: `3d-modeling.ts`
- **Esfuerzo**: XL

### 4C.4 Turn/Spin (Torno)
- **Referencia**: Aspire
- **Qué**: Revolución de perfil alrededor de eje para formas torneadas
- **Por qué**: Vasos, patas, piezas de revolución. Requiere eje rotativo (4to eje)
- **Archivos**: `3d-modeling.ts`
- **Esfuerzo**: L

### 4C.5 Sculpting 3D Interactivo
- **Referencia**: Aspire
- **Qué**: Pinceles: smooth, smudge, deposit, remove, flatten. Control de tamaño, intensidad, falloff. Soporte tablet con presión
- **Por qué**: Permite refinar modelos 3D intuitivamente sin software externo
- **Archivos**: Nuevo módulo de sculpting, integración con viewer 3D
- **Esfuerzo**: XL

### 4C.6 Texturas 3D Procedurales
- **Referencia**: Aspire
- **Qué**: Generar texturas sobre áreas: wave, weave, crosshatch, custom patterns. Control de amplitud, frecuencia, rotación
- **Por qué**: Fondos texturizados en signage y decoración
- **Archivos**: `3d-modeling.ts`
- **Esfuerzo**: L

### 4C.7 Component Tree con Combine Modes
- **Referencia**: Aspire
- **Qué**: Árbol jerárquico de componentes 3D. Combine: add, subtract, merge high/low, multiply. Group, bake, fade, tilt por componente
- **Por qué**: Workflow no-destructivo para composición de modelos 3D complejos
- **Archivos**: Nuevo store `useComponentStore.ts`, UI de árbol
- **Esfuerzo**: L

### 4C.8 3D Roughing Toolpath
- **Referencia**: Aspire
- **Qué**: Z-level (waterline) y raster roughing sobre modelos 3D. Allowance para finishing, rest machining
- **Por qué**: Sin roughing no se pueden mecanizar modelos 3D
- **Archivos**: `gcode-generator.ts`, nuevo módulo de 3D toolpath calculation
- **Esfuerzo**: XL

### 4C.9 3D Finishing Toolpath
- **Referencia**: Aspire
- **Qué**: Raster finishing (X, Y, ángulo custom), offset finishing. Stepover configurable. Detección de áreas steep/shallow
- **Por qué**: Acabado final del modelo 3D. Sin esto queda escalonado
- **Archivos**: `gcode-generator.ts`
- **Esfuerzo**: XL

### 4C.10 3D Rest Machining / Pencil Finishing
- **Referencia**: Aspire
- **Qué**: Detectar esquinas y áreas no alcanzadas por herramientas grandes, pasar solo ahí con fresa chica
- **Por qué**: Detalles finos sin re-mecanizar toda la pieza. Ahorra horas
- **Archivos**: `gcode-generator.ts`
- **Esfuerzo**: L

---

## Fase 4D: Diseño 2D Avanzado — Gap con Aspire (Semana 6-8)

### ~~4D.1 Node Editing Avanzado~~ ✅ ~85% COMPLETADO
- **Qué**: Smooth/sharp, delete, insert midpoint, split, open/close, fillet, chamfer, dogbone, constraints H/V. Falta symmetric nodes y break node para 100%
- **Archivos**: `node-editor.ts`, `useCanvasManager.ts`, `NodeEditToolbar.tsx`

### 4D.2 ~~Fillet y Chamfer en Vectores~~ ✅ COMPLETADO
- **Qué**: Fillet y chamfer ya existían. Agregado **dog-bone fillet**: `dogboneNode()` en node-editor.ts que extiende arco INTO la esquina para compensar radio de fresa. Botón en NodeEditToolbar
- **Archivos**: `node-editor.ts`, `DesignCanvas.tsx`, `NodeEditToolbar.tsx`, i18n
- **Esfuerzo**: M

### 4D.3 Import DWG + AI + EPS + PDF vectores
- **Referencia**: Aspire
- **Qué**: Importar formatos de industria: DWG (AutoCAD), AI (Illustrator), EPS (PostScript), PDF (extracción de vectores)
- **Por qué**: Aspire soporta todos. Nosotros solo SVG y DXF básico. Mayoría de archivos industriales son DWG
- **Archivos**: Nuevos parsers o usar bibliotecas Rust
- **Esfuerzo**: L

### ~~4D.4 Variable Text / Merge Codes~~ ✅ COMPLETADO (UI 2026-09-12)
- **Qué**: Módulo `variable-text.ts` con parseCSV(), mergeText(), extractVariables(), previewMerge(). Soporta placeholders + variables built-in (index/date/time)
- **Estaba muerto**: **cero imports**. Sin carga de CSV, sin preview y sin conexion con el pipeline de texto
- **2026-09-12**: `VariableTextModal.tsx` (menu Agregar del DesignPanel) — plantilla con placeholders, carga de CSV, aviso de columnas faltantes, preview de las primeras 20 filas y generacion de un text-path por registro via `addTextPath()`
- **Archivos**: `variable-text.ts`, `VariableTextModal.tsx`, `DesignPanel.tsx`, `App.tsx`, i18n

### ~~4D.5 Vector Diagnostics~~ ✅ COMPLETADO (2026-09-12)
- **Qué**: Módulo `vector-diagnostics.ts` con `diagnoseVectors()`, `autoJoinPaths()`, `removeTinySpans()`, `removeDuplicatePaths()`
- **Estaba muerto**: **cero imports**. Los SVG/DXF importados seguian entrando con paths casi cerrados, segmentos de longitud cero y contornos duplicados — justo lo que rompe pocket, kerf y offset
- **2026-09-12**: `VectorDiagnosticsModal.tsx` (boton en CanvasToolbar) reporta los problemas sobre la geometria cruda, y la auto-limpieza configurable (`vectorCleanup` en el store) se aplica en `getPathsForGCode()` / `getJobsForGCode()`, el unico punto por el que pasan todos los toolpaths
- **Archivos**: `vector-diagnostics.ts`, `VectorDiagnosticsModal.tsx`, `useCanvasManager.ts`, `useCanvasStore.ts`, `types.ts`, `CanvasToolbar.tsx`, i18n

### 4D.6 Multiple Sheets — ❌ NO EMPEZADO
- **Qué**: hojas multiples con pestañas y elementos asociados a cada hoja
- **2026-09-12**: el stub `sheets[]` (add/remove/rename/setActive sin un solo consumidor) se **elimino** del store. Guardar la estructura sin la feature solo hacia que el plan se leyera como mas avanzado de lo que estaba
- **Esfuerzo restante**: M (campo `sheetId` en CanvasElement, filtrado en canvas, barra de pestañas)

### 4D.7 ~~Array Circular~~ ✅ YA EXISTÍA
- **Qué**: `arrayPolar()` en useCanvasManager + tab "Polar" en ArrayModal con count, totalAngle, centerX/Y
- **Archivos**: `ArrayModal.tsx`, `useCanvasManager.ts`
- **Esfuerzo**: (ya hecho)

### 4D.8 Photo V-Carve (Lithophane)
- **Referencia**: Aspire
- **Qué**: Convertir foto directamente a toolpath V-carve. Control de brillo, contraste, resolución de líneas, ángulo
- **Por qué**: Feature popular en signage: retratos en madera con V-bit
- **Archivos**: `image_processing.rs`, `gcode-generator.ts`
- **Esfuerzo**: L

---

## Fase 4E: Job Setup Avanzado — Gap con Aspire (Semana 7-9)

### 4E.1 Two-Sided Machining (Doble Cara)
- **Referencia**: Aspire
- **Qué**: Setup Top/Bottom, flip direction H/V, registration marks, mirror automático, toolpaths separados por lado
- **Por qué**: Piezas mecanizadas por ambos lados (ej: instrumentos musicales, piezas mecánicas)
- **Archivos**: Job setup, `gcode-generator.ts`, canvas
- **Esfuerzo**: L

### 4E.2 Rotary Machining (4to Eje)
- **Referencia**: Aspire
- **Qué**: Wrapping de diseño 2D/3D alrededor de cilindro. Diámetro, longitud, gap. Vista flat/wrapped toggle
- **Por qué**: Columnas, patas torneadas, vasos. Mercado creciente de CNC rotativo
- **Archivos**: `gcode-generator.ts`, canvas transform, nuevo modo de visualización
- **Esfuerzo**: XL

### 4E.3 Simulación 3D Animada de Toolpath
- **Referencia**: Aspire
- **Qué**: Preview 3D del material siendo mecanizado en tiempo real. Animación del recorrido de herramienta, control de velocidad, gouge detection
- **Por qué**: Preview actual es estática. Sin animación no ves errores de toolpath hasta que cortas
- **Archivos**: `PreviewPanel.tsx`, nuevo motor de simulación
- **Esfuerzo**: XL

### ~~4E.4 Tool Database Avanzada~~ ✅ COMPLETADO (parcial)
- **Qué**: Botones Import/Export JSON en header de ToolsModal. Falta organización por grupos/carpetas, feeds/speeds por material, tipos adicionales (tapered, form tool, diamond drag)
- **Archivos**: `ToolsModal.tsx`

### 4E.5 Post-Processor Editor
- **Referencia**: Aspire (500+ post-processors)
- **Qué**: Editor para crear/modificar post-procesadores. Variables: header, footer, tool change, spindle, coolant, arc format, line numbering
- **Por qué**: Cada máquina necesita su post-processor. Sin editor usuario queda limitado a GRBL genérico
- **Archivos**: Nuevo módulo de post-processing configurable
- **Esfuerzo**: L

### 4E.6 Gadgets / Scripting (LUA o similar)
- **Referencia**: Aspire (LUA scripting)
- **Qué**: Sistema de plugins/scripts para automatización. API accesible: box maker, gear creator, barcode, rosettes, etc.
- **Por qué**: Extensibilidad. Comunidad puede crear herramientas sin tocar core. Box generator ya existe hard-coded
- **Archivos**: Nuevo runtime de scripting, API bridge
- **Esfuerzo**: XL

---

## Fase 5: UX y Calidad de Vida (Semana 5-7)

### 5.1 ~~G-Code Editor con Syntax Highlight~~ ✅ COMPLETADO
- **Qué**: Highlight inline por regex (G0=azul, G1=foreground, M-codes=púrpura, comments=verde, tools=amber, setup=naranja). Números de línea. Hover highlight
- **Archivos**: `GCodePanel.tsx`
- **Esfuerzo**: M

### 5.2 ~~Estimación de Tiempo Precisa~~ ✅ COMPLETADO
- **Qué**: estimateSegmentTime() con modelo trapezoidal de aceleración (500mm/s²). Segmentos cortos calculados como triángulo, largos como trapecio
- **Archivos**: `gcode-parser.ts`

### ~~5.3 DXF Import Completo~~ ✅ COMPLETADO
- **Qué**: Agregados ELLIPSE, SPLINE (control + fit points), POLYLINE/VERTEX, POINT a dxf-parser.ts. Falta INSERT/BLOCK, TEXT, DIMENSION, HATCH para 100%
- **Archivos**: `dxf-parser.ts`

### 5.4 Nesting / Auto-Layout
- **Referencia**: LightBurn, Aspire (true-shape nesting), software de corte industrial
- **Qué**: Acomodar piezas automáticamente para minimizar desperdicio de material
- **Archivos**: Nuevo módulo `nesting.ts`
- **Esfuerzo**: XL

### ~~5.5 Undo/Redo Robusto~~ ✅ COMPLETADO
- **Qué**: Ya robusto: snapshot completo Fabric JSON + store elements, 50 entradas de historial, 38 llamadas a pushToHistory cubriendo todas las operaciones
- **Archivos**: `useCanvasManager.ts`

### 5.6 Gamepad / Pendant Support
- **Referencia**: Mach3
- **Qué**: Gamepad API del browser para jog. Joystick = velocidad proporcional
- **Archivos**: Nuevo hook `useGamepad.ts`, `ControlPanel.tsx`
- **Esfuerzo**: M

### 5.7 ~~Profiles de Máquina~~ ✅ COMPLETADO
- **Qué**: Módulo `profiles.ts` con MachineProfile type, localStorage persistence, import/export JSON
- **Archivos**: `profiles.ts`

---

## Fase 6: Features Diferenciadores (Semana 7+)

Cosas que ni Mach3 ni LightBurn tienen (o hacen mal).

### 6.1 Workflow Multi-Operación Inteligente
- **Qué**: Un diseño con: piezas CNC + grabado láser + etiquetas plotter. Todo en un proyecto
- **Ya tenemos la base**: multi-tool, workflow queue, element configs
- **Falta**: UI fluida que guíe el proceso, validación de compatibilidad
- **Esfuerzo**: L

### 6.2 Colaboración Remota
- **Qué**: Web server ya existe. Agregar: cola de trabajos con aprobación, multi-usuario
- **Ya tenemos**: REST API, WebSocket, auth básica
- **Falta**: JWT, roles, UI de cola con aprobación
- **Esfuerzo**: L

### 6.3 Surface Leveling Automático
- **Qué**: Probe grid → mesh de compensación → G-code ajustado automáticamente
- **Uso**: PCB, grabado en superficies irregulares
- **Esfuerzo**: XL

### 6.4 Camera Alignment
- **Qué**: Webcam para alinear diseño con material. Overlay en canvas
- **Esfuerzo**: XL

---

## Fase 7: PCB Milling — Nicho de Alto Valor

> Competencia directa: FlatCAM, Candle + autolevel, bCNC, PCB-GCODE (Eagle plugin)
> Ninguno integra CAD+CAM+Control como nosotros. Oportunidad de ser la solución completa.
> El V-Carve ya implementado es base para isolation routing con V-bit.

### Estado actual vs PCB milling: **~15%** (solo tenemos CNC básico + V-carve)

### 7.1 Gerber Import (RS-274X)
- **Qué**: Parsear archivos Gerber (copper layers, silk, mask). Aperture definitions (circles, rects, obrounds, polygons). D-codes (flash, draw). Coordenadas absolutas/incrementales. Formato texto, bien documentado
- **Por qué**: **BLOCKER #1** — sin esto no se puede usar para PCB. Todo EDA exporta Gerber (KiCad, Eagle, Altium, EasyEDA)
- **Archivos**: Nuevo `src/lib/gerber-parser.ts`, integración con canvas
- **Esfuerzo**: L
- **Prioridad**: P0-PCB

### 7.2 Excellon Drill Import
- **Qué**: Parsear archivos de perforación Excellon (.drl/.xln). Tool table (T01 C0.8, T02 C1.0), coordenadas de agujeros, formatos (leading/trailing zeros, inch/mm)
- **Por qué**: **BLOCKER #2** — PCBs tienen 20-200+ agujeros con múltiples diámetros. Sin esto hay que dibujar cada uno
- **Archivos**: Nuevo `src/lib/excellon-parser.ts`
- **Esfuerzo**: M
- **Prioridad**: P0-PCB

### 7.3 Isolation Routing
- **Qué**: Generar toolpath de aislación alrededor de traces de cobre. Offset por radio de fresa (o profundidad V-bit). Múltiples pasadas de isolation (2-3 offsets para clearance seguro). Detección de áreas no alcanzadas
- **Por qué**: **BLOCKER #3** — es la operación principal de PCB milling. Sin esto el Gerber import no sirve
- **Ya tenemos base**: `offsetPolygon()` con Clipper, V-carve toolpath
- **Archivos**: Nuevo `src/lib/pcb-isolation.ts`, `gcode-generator.ts`
- **Esfuerzo**: L
- **Prioridad**: P0-PCB

### 7.4 Surface Auto-Leveling
- **Qué**: Probe grid automático (G38.2 en grid NxM), interpolar mesh de altura, compensar Z en cada línea de G-code. Cobre = 0.035mm, fresa = 0.1mm → sin esto es inutilizable
- **Por qué**: **BLOCKER #4** — superficies de PCB nunca son perfectamente planas. 0.05mm de error = traces cortados o no aislados
- **Ya tenemos base**: Serial commands, probe G38.2
- **Archivos**: Nuevo `src/lib/surface-leveling.ts`, UI de probe grid, `gcode-generator.ts`
- **Esfuerzo**: XL
- **Prioridad**: P0-PCB

### 7.5 Fine Drill Cycles (Excellon → G-code)
- **Qué**: Convertir agujeros Excellon a G81 (drill) o G83 (peck drill). Agrupar por diámetro → tool change M6/M0. Retract configurable
- **Por qué**: PCB típico tiene 3-5 diámetros de broca distintos
- **Ya tenemos base**: Tool change funciona, falta G81/G83
- **Archivos**: `gcode-generator.ts`
- **Esfuerzo**: M
- **Prioridad**: P1-PCB

### 7.6 Mirror/Flip para Bottom Layer
- **Qué**: Espejo horizontal del diseño para mecanizar capa inferior. Eje de flip configurable (center/edge). Preview de ambos lados
- **Por qué**: PCB doble cara necesita mecanizar bottom como espejo del top
- **Archivos**: Canvas transform, `gcode-generator.ts`
- **Esfuerzo**: M
- **Prioridad**: P1-PCB

### 7.7 Registration / Alignment Holes
- **Qué**: Generar agujeros de referencia en esquinas para alinear top/bottom. Drill primero, flip, usar mismos agujeros como referencia. G10 L20 para setear zero en pin
- **Por qué**: Sin registro preciso las capas no coinciden
- **Archivos**: UI + generación de drill coordinates
- **Esfuerzo**: S
- **Prioridad**: P1-PCB

### 7.8 Backlash Compensation
- **Qué**: Compensar juego mecánico al cambiar dirección. Por eje (X/Y/Z independiente). Crítico cuando precisión es <0.1mm
- **Por qué**: Máquinas de escritorio tienen 0.02-0.1mm de backlash. En PCB eso es un trace cortado
- **Archivos**: `gcode-generator.ts` o GRBL $140-$142
- **Esfuerzo**: M
- **Prioridad**: P1-PCB

### 7.9 Copper Pour Clearing
- **Qué**: Raster o pocket para remover cobre sobrante (ground planes, zonas sin traces). Configurable: solo isolation vs clear todo
- **Ya tenemos**: Pocket toolpath funciona
- **Archivos**: `pcb-isolation.ts`
- **Esfuerzo**: S
- **Prioridad**: P2-PCB

### 7.10 PCB Panelización
- **Qué**: Repetir diseño en grid (NxM) con tabs/V-score entre boards. Outline routing del panel
- **Ya tenemos**: Array rectangular, tabs
- **Archivos**: UI de panel config
- **Esfuerzo**: M
- **Prioridad**: P2-PCB

### 7.11 DRC Visual (Design Rule Check)
- **Qué**: Verificar clearance mínimo entre traces aislados, detectar cortocircuitos potenciales, zonas sin aislar
- **Por qué**: Previene PCBs defectuosos antes de mecanizar
- **Archivos**: Nuevo módulo de validación
- **Esfuerzo**: M
- **Prioridad**: P2-PCB

### 7.12 Preview Copper
- **Qué**: Visualizar qué queda como cobre vs qué se remueve. Vista top/bottom. Overlay de drill holes
- **Por qué**: Verificación visual antes de cortar. Detectar errores de isolation
- **Archivos**: `PreviewPanel.tsx` o canvas overlay
- **Esfuerzo**: M
- **Prioridad**: P2-PCB

### Meta de Paridad PCB

| Hito | vs FlatCAM | vs bCNC | vs Candle |
|------|-----------|---------|-----------|
| Actual | ~5% | ~15% | ~20% |
| Post 7.1-7.3 (Gerber+Drill+Isolation) | ~45% | ~50% | ~60% |
| Post 7.4 (Auto-leveling) | ~70% | ~75% | ~85% |
| Post 7.5-7.8 (Drill+Mirror+Backlash) | ~85% | ~85% | ~90% |
| Post 7.9-7.12 (Polish) | ~90% | ~90% | ~95% |

> **Ventaja competitiva**: FlatCAM es solo CAM (no controla máquina), bCNC es solo control
> (no tiene CAD), Candle es básico. Nosotros podemos hacer Gerber→Isolation→Control
> en una sola app. Con auto-leveling integrado sería la mejor solución desktop para PCB.

---

## Cola de quick wins (siguiente pasada)

Ordenada por costo real medido contra el codigo actual, no por impacto teorico.
Todo lo de esta lista es autocontenido: no toca el motor de toolpaths ni el
canvas.

| # | Feature | Por que es barato | Esfuerzo |
|---|---------|-------------------|----------|
| 3.7b | Filtros de imagen (brillo, contraste, sharpen, gamma) | Los kernels de dithering ya entraron; los filtros son un paso previo sobre el mismo `GrayImage` | S |
| 7.2 | Excellon drill import | Parser de texto puro, sin dependencias; `drill` ya existe como WorkType con G81/G83 | M |
| 7.7 | Agujeros de registro | Se reduce a generar 2-4 circulos en esquinas y mandarlos al drill toolpath existente | S |
| 4.7 / 7.8 | Backlash compensation | Post-proceso sobre las lineas ya emitidas, detectando cambio de signo por eje | M |
| 5.6 | Gamepad / pendant | Gamepad API del browser contra el `jog()` que ya existe en `useSerial` | M |
| 4D.6 | Multiple sheets real | Campo `sheetId` en CanvasElement + filtrado en canvas + pestañas | M |

Lo grande que sigue pendiente y **no** es barato: Gerber import (7.1), isolation
routing (7.3), surface auto-leveling (7.4), auto-vectorizacion (3.5), nesting
(5.4) y toda la Fase 4C de modelado 3D.

---

## Tabla Resumen de Prioridad

### Features originales (Mach3 + LightBurn + Plotter)

| # | Feature | Modalidad | Esfuerzo | Impacto | Prioridad |
|---|---------|-----------|----------|---------|-----------|
| 1.1 | Keyboard Jog | Todas | S | Alto | P0 |
| 1.2 | GRBL Config UI | Todas | M | Alto | P0 |
| 1.3 | Multiple Passes | Plotter+Laser | S | Alto | P0 |
| 1.4 | Consola Mejorada | Todas | S | Medio | P1 |
| 2.1 | Pressure Output | Plotter | S | Alto | P0 |
| 2.2 | Blade Offset | Plotter | M | Alto | P0 |
| 2.3 | Color Grouping | Plotter | M | Alto | P0 |
| 2.4 | Tool Change Plotter | Plotter | S | Alto | P0 |
| 2.5 | Path Optimization | Plotter | M | Medio | P1 |
| 2.6 | Preview Colores | Plotter | S | Medio | P1 |
| 2.7 | Test Cut/Draw | Plotter+Laser | S | Medio | P1 |
| 3.1 | Power Ramp | Laser | L | Alto | P1 |
| 3.2 | Corner Power Reduction | Laser | M | Alto | P1 |
| 3.3 | Kerf Compensation | Laser | S | Alto | P0 |
| 3.4 | Path Inside-First | Laser | M | Alto | P0 |
| 3.5 | Auto-Vectorización | Laser | L | Medio | P2 |
| 3.6 | Lead-In/Out | Laser+CNC | M | Medio | P1 |
| 3.7 | Más Dithering | Laser | M | Bajo | P2 |
| 3.8 | Color Mapping | Laser | L | Alto | P1 |
| 3.9 | Focus Z Laser | Laser | S | Medio | P2 |
| 3.10 | Laser Frame | Laser | S | Alto | P0 |
| 4.1 | G54-G59 | CNC | M | Alto | P1 |
| 4.2 | Tool Length Offset | CNC | M | Alto | P1 |
| 4.3 | Probing Avanzado | CNC | L | Alto | P2 |
| 4.4 | Soft Limits UI | CNC | S | Medio | P1 |
| 4.5 | Canned Cycles | CNC | M | Medio | P2 |
| 4.6 | Diagnóstico I/O | CNC | M | Medio | P2 |
| 4.7 | Backlash Comp | CNC | M | Bajo | P3 |
| 5.1 | G-Code Editor | Todas | M | Medio | P1 |
| 5.2 | Estimación Tiempo | Todas | M | Bajo | P2 |
| 5.3 | DXF Completo | Todas | L | Alto | P1 |
| 5.4 | Nesting | Laser+Plotter | XL | Medio | P3 |
| 5.5 | Undo/Redo Robusto | Todas | M | Medio | P1 |
| 5.6 | Gamepad | Todas | M | Bajo | P3 |
| 5.7 | Machine Profiles | Todas | M | Medio | P2 |

### Features nuevas — Gap con Vectric Aspire

| # | Feature | Categoría | Esfuerzo | Impacto | Prioridad |
|---|---------|-----------|----------|---------|-----------|
| 4B.1 | V-Carve Toolpath | CAM | L | **Crítico** | P0 |
| 4B.2 | Pocket Rest Machining | CAM | L | Alto | P1 |
| 4B.3 | Ramping / Lead-In Profile | CAM | M | Alto | P0 |
| 4B.4 | Tabs/Bridges | CAM | M | **Crítico** | P0 |
| 4B.5 | Inlay Toolpath | CAM | L | Medio | P2 |
| 4B.6 | Fluting Toolpath | CAM | M | Bajo | P3 |
| 4B.7 | Moulding / Prism | CAM | L | Bajo | P3 |
| 4B.8 | Chamfer Toolpath | CAM | M | Medio | P2 |
| 4B.9 | Texture Toolpath | CAM | M | Bajo | P3 |
| 4B.10 | Tiling Toolpaths | CAM | M | Medio | P2 |
| 4B.11 | Toolpath Templates | CAM | M | Medio | P2 |
| 4C.1 | Formas 3D desde Vectores | 3D | XL | Alto | P2 |
| 4C.2 | Two-Rail Sweep | 3D | XL | Medio | P3 |
| 4C.3 | Extrude and Weave | 3D | XL | Bajo | P3 |
| 4C.4 | Turn/Spin (Torno) | 3D | L | Medio | P3 |
| 4C.5 | Sculpting 3D | 3D | XL | Medio | P3 |
| 4C.6 | Texturas 3D Procedurales | 3D | L | Bajo | P3 |
| 4C.7 | Component Tree 3D | 3D | L | Alto | P2 |
| 4C.8 | 3D Roughing Toolpath | 3D CAM | XL | **Crítico** | P1 |
| 4C.9 | 3D Finishing Toolpath | 3D CAM | XL | **Crítico** | P1 |
| 4C.10 | 3D Rest / Pencil Finishing | 3D CAM | L | Alto | P2 |
| 4D.1 | Node Editing Avanzado | CAD 2D | M | Alto | P1 |
| 4D.2 | Fillet/Chamfer + Dog-bone | CAD 2D | M | Alto | P0 |
| 4D.3 | Import DWG+AI+EPS+PDF | CAD 2D | L | Alto | P1 |
| 4D.4 | Variable Text / Merge | CAD 2D | M | Medio | P2 |
| 4D.5 | Vector Diagnostics | CAD 2D | M | Alto | P1 |
| 4D.6 | Multiple Sheets | CAD 2D | M | Medio | P2 |
| 4D.7 | Array Circular | CAD 2D | S | Medio | P1 |
| 4D.8 | Photo V-Carve | CAD 2D | L | Medio | P2 |
| 4E.1 | Two-Sided Machining | Job Setup | L | Alto | P2 |
| 4E.2 | Rotary (4to Eje) | Job Setup | XL | Medio | P3 |
| 4E.3 | Simulación 3D Animada | Preview | XL | Alto | P2 |
| 4E.4 | Tool Database Avanzada | Tools | M | Alto | P1 |
| 4E.5 | Post-Processor Editor | Output | L | Alto | P2 |
| 4E.6 | Gadgets / Scripting | Extensibilidad | XL | Alto | P3 |

## Leyenda

- **Esfuerzo**: S = 1-2 días, M = 3-5 días, L = 1-2 semanas, XL = 2+ semanas
- **Prioridad**: P0 = bloquea uso real, P1 = mejora significativa, P2 = nice-to-have, P3 = futuro

## Meta de Paridad

| Hito | vs Mach3 | vs LightBurn | vs Aspire | vs Plotter Pro |
|------|----------|--------------|-----------|----------------|
| Actual | 60% | 35% | 20% | 15% |
| Post Fase 1-2 | 65% | 40% | 22% | 55% |
| Post Fase 3 | 70% | 60% | 25% | 60% |
| Post Fase 4+4B | 85% | 65% | 40% | 65% |
| Post Fase 4C (3D) | 85% | 65% | 55% | 65% |
| Post Fase 4D+4E | 88% | 68% | 65% | 68% |
| Post Fase 5-6 | 90% | 75% | 70% | 75% |

> **Nota**: 100% paridad no es el objetivo. Nuestro diferenciador es el workflow integrado
> diseño→CAM→control en una sola app. Mach3 no tiene CAD, LightBurn no tiene CNC,
> Aspire no tiene control de máquina (solo genera G-code), y ningún plotter software
> tiene laser+CNC.
>
> **vs Aspire específicamente**: Aspire cuesta $2,000+ USD y es solo CAD/CAM sin control.
> Nosotros integramos diseño+CAM+control. Alcanzar ~65-70% de sus features CAM/3D
> ya nos hace competitivos porque ellos no controlan la máquina. Las features 3D
> (Fase 4C) son las más ambiciosas y pueden ser roadmap a largo plazo. Las features
> CAM 2.5D (Fase 4B: V-carve, tabs, ramping) son más alcanzables y de mayor impacto
> inmediato.
