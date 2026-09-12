# Revisión — gravix para prototipo vendible

> Revisión original: 2026-06-08 · **Reverificada y ejecutada: 2026-09-12** · Repo: `Debaq/gravix-cnc` · Branch: `main`
> Base: 30.2k líneas TS, 3.4k Rust, sin TODOs sueltos, i18n EN/ES, design system, 14 modales, CAD+CAM+control.
> Desde la revisión original solo entraron 2 commits (`bf0af54`, `d4b884f` — ambos 2026-09-12), y cerraron el frente de seguridad de máquina.

---

## ✅ Resuelto desde la revisión original

### ~~5. Sin validación de límites de GCode antes de enviar~~ — **RESUELTO** (`bf0af54`)
`src-tauri/src/commands/serial.rs:578` → `check_bounds()`. Se invoca en `serial_send_gcode` (`:1395`) y existe el comando suelto `serial_check_bounds` (`:1408`) para chequear antes de mandar.
El frontend sí pasa los límites: `src/hooks/useSerial.ts:221` → `buildAxisLimits(activeMachine())`.
El error identifica línea, eje y rango violado.

### ~~6. Sin abort si se desconecta el CNC a media ejecución~~ — **RESUELTO** (`bf0af54`)
`serial.rs:1105` → `io.abort_job("desconexion")`, con drenaje de 600 ms de la secuencia de parada antes de cerrar el puerto.
Secuencia de parada real implementada (`:814-852`): feed hold → deceleración → soft reset.
Además, no estaba en la revisión original y ya existe:
- abort automático si una línea devuelve `error:` (`:785`, `abort_on_error`)
- abort por alarma del firmware (`:877`)
- watchdog por falta de respuesta del firmware (`:967`)

### ~~6b. Sin reconexión automática~~ — **RESUELTO** (2026-09-12)
`src/lib/serial-reconnect.ts`. Backoff exponencial 0.5s→8s, 6 intentos, con lista de puertos consultada antes de cada intento (abrir un puerto que el SO no reenumeró devuelve un error indistinguible de "ocupado").
- Distingue caída inesperada de desconexión pedida por el usuario.
- **No reanuda el job**: tras una caída la posición de la máquina es desconocida; el operador homea y relanza.
- Perder el puerto con un job en vuelo dispara un toast de error persistente aparte.
- Indicador con botón de cancelar en `ControlPanel.tsx` mientras reintenta.

> 🐛 **Bug destapado al implementarlo:** el guard de registro de listeners en `useSerial.ts` era un `useRef`, o sea **por instancia de componente**. Como `useSerial()` se consume desde 9 lugares, se registraban 9 juegos de listeners: cada línea del firmware entraba 9 veces a la consola y cada evento se procesaba 9 veces. Ahora hay un singleton a nivel de módulo con refcount.

### ~~7. Errores silenciosos en saves~~ — **RESUELTO** (2026-09-12)
Sistema de notificaciones nuevo:
- `src/stores/useToastStore.ts` — cola con máximo 4 visibles y auto-descarte por variante. **Los errores no se auto-descartan**: en una app que maneja una máquina física, un "no se guardó" que desaparece a los 3s es lo mismo que no avisar.
- `src/lib/toast.ts` — API imperativa (`toast.error(...)`), usable fuera de React.
- `src/components/ui/toaster.tsx` — `z-[100]` para quedar sobre dialogs, `role="alert"` en errores.
- `src/index.css` — los tokens semánticos (`--color-success-bg` y compañía) **no tenían override en `.dark`** y quedaban en sus valores claros; agregados.

Los 5 catches vacíos, cableados:
- `ProjectsScreen.tsx` crear → si el `.gravix` no se escribe ahora **no navega al editor** (antes abría un editor sobre un archivo inexistente).
- `ProjectsScreen.tsx` borrar → éxito y error visibles.
- `ProjectsScreen.tsx` abrir → el fallback silencioso hacía ver un archivo corrupto como proyecto vacío; ahora avisa.
- `App.tsx` seed de librerías → un aviso agregado con `Promise.allSettled`, no uno por herramienta.
- `App.tsx` splashscreen → a `console.error`, no molesta al usuario.

### ~~8. Paniqueos~~ — **RESUELTO** (2026-09-12)
`license.rs` → `license_path()` devuelve `Option<PathBuf>` y `save_license()` devuelve `Result`. Una licencia válida que no se puede persistir ahora lo reporta, en vez de activarse y perderse al reiniciar.
El `.expect()` de `lib.rs` se deja: es boilerplate de Tauri y un panic en init es aceptable.

### ~~9. Versión desincronizada~~ — **RESUELTO** (2026-09-12)
`scripts/sync-version.mjs` propaga la versión de `package.json` a `tauri.conf.json` y `Cargo.toml`; corre en `predev`/`prebuild`/`pretauri`. `vite.config.ts` la inyecta como `__APP_VERSION__` y `useProject.ts` dejó de hardcodear `'5.0.0'`.

---

## 🔴 Crítico — bloquea venta

### 1. El modelo de monetización NO existe en la práctica
Tras el trial, **todo sigue gratis**. No hay paywall.
- `exportBlocked` existe en `src/i18n/locales/en/license.json:14` y su par `es` → **0 usos en código**.
- `Header.tsx:103-104` calcula `trialActive` e `isLicensed`, pero solo los usa para pintar el badge (`:443-459`). Ninguna acción está gateada.
- **Fix:** decidir modelo (freemium / suscripción) e implementar gating real.

### 2. Trial bypasseable en 1 línea
`src/lib/trial.ts` usa `localStorage`. En DevTools:
```js
localStorage.removeItem('gravix_first_run')
```
→ resetea los 30 días. **Verificado 2026-09-12.**
- **Fix:** mover marca de primer-uso a archivo en app-config con verificación de integridad, o atar a device ID.

### 3. Las licencias nunca expiran
`src-tauri/src/license.rs:39` → `validation.validate_exp = false;`
Peor: `LicenseClaims` **ni siquiera declara un campo `exp`** (solo `email`, `order`, `product`, `version`, `iat`). No hay nada que validar. **Verificado 2026-09-12.**
- **Fix:** agregar `exp` a `LicenseClaims` + al firmado, y activar `validate_exp = true`.

### 4. Licencia solo se valida en cliente
Editando el store Zustand en DevTools te volvés "Pro". `src-tauri/src/web_server.rs` no menciona licencia en ningún lado (0 hits) — no chequea nada en export/save.
- **Fix:** middleware de validación de licencia en backend para operaciones pro.

> ✅ **Bien:** `gravix_private.pem` gitignoreada (`.gitignore:37` → `*.pem`) y ningún `.pem` trackeado. Esquema ES256 (ECDSA P-256) correcto. Solo cuidado de no copiar la privada al bundle distribuible.

---

## 🟠 Alto — riesgo de producto

Vacío: los puntos 6b, 7 y 8 se cerraron el 2026-09-12 (ver arriba).

> ⚠️ **Correcciones a la revisión original, para que no vuelvan a colarse:**
> - `JobQueuePanel.tsx` nunca calificó para el #7. Sus catches loggean con `console.error` y el único vacío está justificado por comentario (endpoint opcional sin web server).
> - `workspace_cmd.rs:14` **no** crashea al cancelar el file-picker: la cancelación la cubre el `if let Some(path) … else { None }`. El `.unwrap()` es sobre `FilePath::as_path()`, que solo devuelve `None` con URIs de mobile. No-issue en desktop.

---

## 🟡 Medio — pulido para vender

Vacío: los puntos 10 a 14 se cerraron el 2026-09-12 (ver abajo).

> ⚠️ **Corrección a la revisión original:** `Badge variant="success"` **sí existe** — `src/components/ui/badge.tsx:14`. También hay `warning`. El uso en `SetupWizardModal` es correcto.

---

## ✅ Packaging y pulido — cerrados el 2026-09-12

### Rename y versionado — 2026-09-12

El repo pasó a `Debaq/gravix-cnc` (renombrado, con historia e issues intactos;
el main viejo quedó respaldado en `backup/main-pre-gravix`). El nombre interno
`grbl-web-control-pro` era del producto legacy: paquete npm y crate pasan a
`gravix`, la lib a `gravix_lib`, el binario a `gravix` y `cnc.sh` a
`gravix.sh`. `cnc` como tipo de operación no se toca.

Versión base **0.5.0** — 5.0.0 venía del legacy y no describía el estado real.

Pre-releases: `<base>-pre.<YYYYMMDD>.<git rev-list --count HEAD>`, calculado
por el Action en el momento del run y nunca commiteado. El contador ordena dos
pre-releases del mismo día; el updater compara con semver y un hash no le
serviría. La versión se calcula en un job aparte y se reparte a los runners:
dos que crucen medianoche UTC firmarían versiones distintas.

CI compila **Linux y Windows**. macOS sale de la matriz hasta que haya cuenta
de Apple Developer — sin firma ni notarización, Gatekeeper no abre la app en
ninguna máquina ajena.

Identifier: `com.gravix.desktop` → **`io.github.debaq.gravix`**. Nadie verifica
el dominio, pero con uno que no controlamos otro proyecto puede elegir el mismo
y romper instalaciones, y las tiendas validan más estricto. Se cambió antes del
primer release a propósito: el identifier decide dónde viven config y licencia,
y moverlo después dejaría esos datos huérfanos.

### ~~10. Sin auto-updater~~ — **RESUELTO**
`tauri-plugin-updater` + `tauri-plugin-process` instalados y registrados (`lib.rs:33-36`), permisos en `capabilities/default.json`.
- `src/lib/updater.ts` — envoltorio del plugin: check, descarga con progreso, relaunch separado del install (reiniciar con un job en vuelo cortaría el envío a la máquina).
- `src/stores/useUpdateStore.ts` + `src/components/modals/UpdateModal.tsx`.
- Chequeo al arranque a los 4 s, **silencioso**: sin red no grita, y cuando hay versión nueva avisa con un toast en vez de abrir el modal encima de la app recién abierta. El modal se abre solo a pedido.
- Endpoint: `https://github.com/Debaq/gravix-cnc/releases/latest/download/latest.json`.
- `.github/workflows/release.yml` — tag `vX.Y.Z` → compila Linux/Windows/macOS (arm64 + x86_64), firma y sube el `latest.json` como release en borrador.
- `docs/RELEASE.md` — proceso completo.

> ⚠️ **Falta un paso manual:** `plugins.updater.pubkey` está **vacío**. Hay que generar el par de claves de firma (`npm run tauri signer generate -- -w ~/.tauri/gravix.key`) y cargar la privada como secret de GitHub. Con la pubkey vacía la app arranca y **sí detecta** updates, pero la instalación falla al verificar la firma.

> `createUpdaterArtifacts` vive en `src-tauri/tauri.release.conf.json`, no en la config base, y el workflow lo agrega con `--config`. Activarlo en la base hace que **cualquier** `npm run tauri build` local aborte con `A public key has been found, but no private key` — comprobado.

### ~~11. `bundle.targets: []` y CSP `null`~~ — **RESUELTO**
- `targets`: `deb`, `rpm`, `appimage`, `nsis`, `app`, `dmg`.
- CSP explícito en `app.security.csp`, más un `devCsp` aparte porque el HMR de Vite necesita `unsafe-eval` y el dev server en `connect-src` — cosas que no deben quedar en el binario distribuido.
- El proyecto no carga nada externo (fuentes locales, 0 CDN, 0 `eval`), así que `default-src 'self'` alcanza; `style-src` lleva `'unsafe-inline'` por Tailwind y Radix.
- Metadata de bundle: publisher, copyright, `licenseFile`, categoría, descripciones, `depends` de deb/rpm (`libudev1` y compañía).
- **Verificado con un bundle real**: `deb`, `rpm` y `AppImage` se generan y el binario arranca. Los targets de Windows y macOS se saltan en Linux sin romper el build.
- Hubo que subir el crate `tauri` de 2.10.3 a 2.11.3: los plugins nuevos traen `@tauri-apps/api` 2.11 y el CLI aborta si el crate y el paquete npm no van en la misma minor.
- En Arch el AppImage necesita `NO_STRIP=true`: el `strip` que trae `linuxdeploy` no entiende la sección `.relr.dyn` de las librerías actuales. Documentado; CI en `ubuntu-22.04` no lo sufre.

> Sobre el CSP y los nonces: Tauri inyecta `'nonce-…'` en `style-src`/`script-src` **solo** en los assets que traen `<style>` o `<script src="http…">`, y un nonce desactiva `'unsafe-inline'`. El `index.html` de Vite no tiene ninguno de los dos, así que la app conserva `'unsafe-inline'` y Radix/Fabric siguen funcionando. El `splashscreen.html` sí tiene un `<style>` y recibe nonce — pero ese `<style>` es el que lo lleva, y el splash no usa atributos `style=`. Verificado en `tauri-utils` y con la app compilada.

### ~~12. Sin LICENSE / EULA~~ — **RESUELTO**
- `LICENSE` — EULA propietario: concesión, trial, restricciones, **advertencia de seguridad de maquinaria**, garantías, límite de responsabilidad, ley chilena. Aclara que el repo público no concede licencia de uso.
- `THIRD-PARTY-NOTICES.md` — generado por `scripts/gen-third-party.mjs` desde `package-lock.json` (prod) y `cargo metadata`: 147 paquetes npm y 642 crates con sus textos de licencia.
- Auditoría de licencias: nada bloquea la venta. Todo copyleft encontrado es dual (`GPL-3.0/MIT`, `… OR LGPL-2.1`) y se ejerce la opción permisiva. `serialport` es MPL-2.0 — copyleft por archivo, permite enlazar desde propietario y no se modifica.

### ~~13. Pulido UX / onboarding~~ — **RESUELTO**
- **Empty states.** `ProjectsScreen`: icono, explicación de que lista los `.gravix` de la carpeta, la ruta a la vista, y dos botones (crear / cambiar carpeta). `GCodePreviewPanel`: dice de dónde sale el G-code; el "Preview" suelto del panel de ruteo pasó a explicar qué va a aparecer ahí, y distingue "no hay G-code" de "el G-code no tiene movimientos XY dibujables".
- **Spinner de generación.** `generating` en `useGCodeStore`, los 4 sitios que generan pasan por `withGenerating()` (`src/lib/gcode-run.ts`), que cede un frame antes de arrancar — si no, React no llega a pintar el spinner antes de que la generación bloquee el hilo. Los 4 botones muestran `Loader2` + "Generando…" y quedan deshabilitados.
- **Accesibilidad del wizard.** El indicador de pasos es un `tablist` real con `role="tab"`, `aria-selected`, roving `tabIndex` y flechas ←/→ (las barras son de 1.5 px: sin teclado no había forma de recorrerlas). El contenido es su `tabpanel`. Los botones de jog dicen qué eje mueven y cuántos mm; el selector de paso es un `radiogroup`. De 0 a 28 atributos ARIA.

### ~~14. Sin autosave~~ — **RESUELTO**
El `.gravix` se creaba vacío y **nunca se volvía a escribir**: `activeProjectPath` se seteaba y no lo usaba nadie. El botón Guardar abría un diálogo y escribía un `.json` aparte.
- `src/lib/project-file.ts` — serializa el `.gravix` desde los stores. El formato suma `globalConfig` y `gcode`, conservando los campos que `list_projects` lee en Rust.
- `src/lib/autosave.ts` — debounce de 2,5 s, tope de 60 s con edición continua, heartbeat de respaldo. Compara una huella de contenido antes de escribir: las suscripciones de zustand no tienen selector y disparan con selección o hover, y eso no debe ensuciar el proyecto ni generar escrituras.
- **Escritura atómica** en `workspace_cmd.rs`: temporal + `sync_all` + `rename`. Un `fs::write` directo que se corta a mitad deja el archivo truncado — con autosave cada pocos segundos eso deja de ser hipotético. Tres tests cubren sobrescritura, temporales huérfanos y creación del directorio.
- Guardar (botón y **Ctrl/Cmd+S**) escribe el `.gravix` activo; sin proyecto activo cae al diálogo de antes.
- Indicador en el header: "Guardando…" / "Guardado hace N min" / "Sin guardar", con `aria-live`.
- Abrir un proyecto ahora restaura también su `globalConfig` y su G-code — sin eso el autosave escribía la config por defecto encima de la guardada.
- Un `.gravix` que no parsea se **respalda** (`backup_gravix_project`) antes de que el autosave lo pise.
- Un fallo al guardar deja el asterisco de "modificado" y un toast persistente.

---

## Orden de ataque recomendado

Estado al 2026-09-12: cerrados el frente de máquina (#5, #6, #6b), el de calidad percibida (#7, #8, #9) y el de packaging y pulido (#10 a #14).

**Queda un solo frente: monetización (#1–4).** Es el único bloqueante real — sin esto no hay producto que vender, solo una app gratis muy completa.

Orden dentro del frente: #3 (agregar `exp` al claim y firmarlo) → #1 (decidir qué se gatea) → #4 (mover el chequeo al backend) → #2 (sacar el trial de `localStorage`).
Hacer #1 antes que #3 obliga a rehacer el gating cuando aparezca la expiración.

Y un paso manual pendiente del #10: generar el par de claves de firma de updates y poner la pubkey en `tauri.conf.json` (ver `docs/RELEASE.md`).

> ⚠️ El repo es **público** (`github.com/Debaq/gravix-cnc`). El EULA cubre lo legal, pero cualquiera puede leer el gating que se implemente en #1–#4 y compilar una versión sin él. Eso no se arregla con código; se decide: o el repo pasa a privado antes de vender, o el modelo asume que el binario firmado y el soporte son el producto.

---

### Archivos clave
- Licencia: `src-tauri/src/license.rs`, `src-tauri/src/commands/license_cmd.rs`, `src/hooks/useLicense.ts`, `src/lib/trial.ts`
- Backend server: `src-tauri/src/web_server.rs`
- Serial/máquina: `src-tauri/src/commands/serial.rs`, `src/hooks/useSerial.ts`, `src/lib/serial-reconnect.ts`, `src/lib/machine-limits.ts`
- Notificaciones: `src/lib/toast.ts`, `src/stores/useToastStore.ts`, `src/components/ui/toaster.tsx`
- Packaging: `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`, `scripts/sync-version.mjs`, `scripts/gen-third-party.mjs`, `.github/workflows/release.yml`, `docs/RELEASE.md`, `LICENSE`
- Updater: `src/lib/updater.ts`, `src/stores/useUpdateStore.ts`, `src/components/modals/UpdateModal.tsx`
- Autosave: `src/lib/autosave.ts`, `src/lib/project-file.ts`, `src-tauri/src/commands/workspace_cmd.rs`
- UX: `src/components/modals/SetupWizardModal.tsx`, `src/components/projects/ProjectsScreen.tsx`, `src/lib/gcode-run.ts`
