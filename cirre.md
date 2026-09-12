# Revisión — Gravix CNC para prototipo vendible

> Revisión original: 2026-06-08 · **Reverificada y parcialmente ejecutada: 2026-09-12** · Branch: `feature/tauri-react-migration`
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

### 10. Sin auto-updater
`tauri.conf.json` tiene `plugins: {}` vacío. No hay `tauri-plugin-updater` ni config `updater`.
- **Fix:** plugin + endpoint + pubkey de firma de updates.

### 11. `bundle.targets: []` y CSP `null`
Especificar targets (`deb`/`appimage`/`msi`/`dmg`) y definir CSP explícito. (targets vacío no bloquea el build, pero conviene ser explícito).

### 12. Sin LICENSE / EULA
README dice "propietaria" pero no existe el archivo legal en la raíz.

### 13. Pulido UX / onboarding
- Empty states sin contexto (`ProjectsScreen`, `GCodePreviewPanel`).
- Sin spinner al generar GCode.
- El wizard de setup existe pero sin accesibilidad básica: 0 hits de `aria-` o `role=` en `SetupWizardModal.tsx`.

> ⚠️ **Corrección a la revisión original:** `Badge variant="success"` **sí existe** — `src/components/ui/badge.tsx:14`. También hay `warning`. El uso en `SetupWizardModal` es correcto.

### 14. Sin autosave
Solo guardados manuales — un crash = trabajo perdido. 0 hits de `autosave`/`autoSave`.

---

## Orden de ataque recomendado

Estado al 2026-09-12: cerrados el frente de máquina (#5, #6, #6b) y el de calidad percibida (#7, #8, #9).

Lo que queda:

1. **Monetización** (#1–4) — único bloqueante real. Sin esto no hay producto que vender.
   Orden dentro del frente: #3 (agregar `exp` al claim y firmarlo) → #1 (decidir qué se gatea) → #4 (mover el chequeo al backend) → #2 (sacar el trial de `localStorage`).
   Hacer #1 antes que #3 obliga a rehacer el gating cuando aparezca la expiración.
2. **Packaging** (#10, #11, #12) — necesario para distribuir, no para que funcione.
3. **Pulido** (#13, #14).

---

### Archivos clave
- Licencia: `src-tauri/src/license.rs`, `src-tauri/src/commands/license_cmd.rs`, `src/hooks/useLicense.ts`, `src/lib/trial.ts`
- Backend server: `src-tauri/src/web_server.rs`
- Serial/máquina: `src-tauri/src/commands/serial.rs`, `src/hooks/useSerial.ts`, `src/lib/serial-reconnect.ts`, `src/lib/machine-limits.ts`
- Notificaciones: `src/lib/toast.ts`, `src/stores/useToastStore.ts`, `src/components/ui/toaster.tsx`
- Packaging: `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`, `scripts/sync-version.mjs`
- UX: `src/components/modals/SetupWizardModal.tsx`, `src/components/projects/ProjectsScreen.tsx`
