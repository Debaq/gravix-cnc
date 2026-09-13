# gravix

App de escritorio para control CNC/GRBL. Diseño CAD 2D, generación G-code, visor 3D, ejecución vía serial. Construida con **Tauri 2 + React + Rust**.

## Stack

| Capa | Tech |
|------|------|
| Shell | Tauri 2 (Rust) |
| UI | React 18 + TypeScript + Vite |
| Estilos | Tailwind + Radix UI |
| Canvas 2D | Fabric.js |
| Visor 3D | React Three Fiber (Three.js) |
| Estado | Zustand (stores por dominio) |
| i18n | i18next |
| Serial | `serialport` (Rust) |
| Red | `mdns-sd`, servidor web embebido |
| Type safety | `ts-rs` — codegen Rust → TS |

## Features

### CAD / Diseño
- Canvas Fabric.js con herramientas: select, line, rect, circle, polygon, path, text
- **Text-to-path** (texto a curvas vectoriales)
- **Generador de cajas** paramétrico (box generator)
- **Wizard de imagen** (raster → vector)
- Operaciones booleanas, Trim y Extend reales con intersección geométrica
- Snapping, grid, capas, propiedades por objeto

### CAM / G-code
- Generación de G-code portada a TypeScript
- Preview 3D con React Three Fiber
- Perfiles de máquina, materiales y herramientas configurables
- Dialectos: GRBL, Marlin

### Control
- Conexión serial real (Tauri invoke → Rust `serialport`)
- Jog, homing, zero, feed override
- Job queue con estado persistente
- Streaming de líneas y parser de estado

### Multi-máquina / Red
- Arquitectura multi-máquina (varios perfiles simultáneos)
- Descubrimiento mDNS
- Servidor web embebido para control remoto

### Licencias
- Sistema de licencias con firma RSA (`gravix_public.pem` embebido)
- Validación offline

### Misc
- i18n completo (es/en)
- Ventana frameless con controles custom en header
- Code splitting, lazy loading de paneles
- Persistencia JSON (tools, materials, workspaces, machines)

## Arquitectura

```
src/
├── components/
│   ├── canvas/      — DesignCanvas, Toolbar, Footer
│   ├── viewer/      — visor 3D
│   ├── panels/      — Design, Preview, Control, Properties, GCode
│   ├── modals/      — WorkArea, GlobalConfig, Tools, Materials, Help
│   ├── layout/      — Header, Sidebar, WorkspaceLayout
│   ├── serial/      — UI conexión serial
│   ├── projects/    — gestor proyectos
│   ├── brand/       — branding Gravix
│   └── ui/          — primitivos Radix
├── stores/          — Zustand (App, Canvas, GCode, Job, Library,
│                      Machine, Serial, Workflow, Workspace, CAM)
├── hooks/
├── lib/
│   ├── generated/   — tipos auto-generados desde Rust (ts-rs)
│   └── types.ts     — re-exports + tipos solo-TS
└── i18n/

src-tauri/src/
├── commands/        — tauri invoke handlers
│   ├── serial.rs
│   ├── files.rs
│   ├── image_processing.rs
│   ├── machines.rs / materials.rs / tools.rs
│   ├── workspace_cmd.rs / web_server_cmd.rs / license_cmd.rs / auth.rs
│   └── mod.rs
├── job_queue.rs     — cola de jobs
├── json_store.rs    — persistencia genérica (read_json / write_json)
├── mdns.rs          — descubrimiento red
├── web_server.rs    — server embebido
├── workspace.rs     — workspaces multi-máquina
├── license.rs       — validación RSA
├── paths.rs         — app data dir
└── shared_state.rs
```

## Type safety Rust ↔ TS

Una sola fuente de verdad: Rust. Tipos TS se generan con `ts-rs`. Ver [`docs/rust-ts-type-safety.md`](docs/rust-ts-type-safety.md).

Trampas del webview de escritorio —zoom por gesto, encuadre del lienzo al arrancar, claves de i18n faltantes— y como verificarlas en Wayland: [`docs/webview-gotchas.md`](docs/webview-gotchas.md).

```bash
npm run types:gen   # cd src-tauri && cargo test --quiet export_bindings
```

Se corre automático vía `predev` / `prebuild` / `pretauri`.

## Desarrollo

```bash
npm install
npm run tauri dev    # app desktop
npm run dev          # solo web (sin serial/FS)
npm run build        # bundle prod
```

Pre-hooks regeneran tipos Rust→TS antes de cada build.

## Branches

- `main` — estable
- `feature/tauri-react-migration` — migración desde build legacy web-only

## Commits clave

- `feat: arquitectura multi-máquina con codegen ts-rs Rust↔TS`
- `feat: implementar plan de paridad completo — P0, P1 y P2 (45+ features)`
- `feat: Trim y Extend reales con intersección geométrica`
- `feat: ventana frameless, generador de cajas, wizard imagen, text-to-path`
- `wip: migración Tauri+React — features, paneles, i18n, licencias`
- `fix: limpieza warnings build (ts-rs, vite, tauri)`

Ver `PLAN-PARIDAD.md` y `ROADMAP-CAD.md` para roadmap.

## Distribución

```bash
npm run tauri build              # bundle para la plataforma actual
node scripts/gen-third-party.mjs # regenera THIRD-PARTY-NOTICES.md
```

En Arch (y cualquier distro con glibc reciente) el AppImage necesita
`NO_STRIP=true npm run tauri build`: el `strip` que trae `linuxdeploy` no
entiende la sección `.relr.dyn` de las librerías actuales.

Targets declarados en `src-tauri/tauri.conf.json` → `bundle.targets`:
`deb`, `appimage`, `rpm` (Linux) · `nsis` (Windows) · `dmg`, `app` (macOS).

**CI compila Linux y Windows.** macOS queda fuera hasta que haya cuenta de
Apple Developer: sin firma y notarización, un `.app` descargado no abre. Los
targets siguen declarados para que un build local en Mac funcione.

### Versiones

`package.json` es la única fuente de verdad; `scripts/sync-version.mjs` la
propaga a `tauri.conf.json` y `Cargo.toml` en cada pre-build.

| | Cómo | Versión |
|---|---|---|
| Pre-release | Actions → `prerelease` → Run workflow | `0.5.0-pre.20260912.70` |
| Estable | `git tag vX.Y.Z && git push --tags` | `0.5.0` |

La pre-release calcula fecha y número de commit **sola, dentro del Action**, y
no los commitea: la rama siempre lleva la versión base. Para probarla en local:
`npm run version:pre`, buildear, y revertir los tres archivos de versión.

El auto-updater consulta `https://github.com/Debaq/gravix-cnc/releases/latest/download/latest.json`.
Publicar un release con el tag `vX.Y.Z` dispara `.github/workflows/release.yml`,
que compila Linux y Windows, firma los artefactos y sube el `latest.json`.

Firmar releases necesita dos secrets en GitHub — ver `docs/RELEASE.md`:
`TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Licencia

**Propietaria** — ver [`LICENSE`](LICENSE). El código es público para auditoría;
eso no concede derecho de uso, redistribución ni de compilar binarios derivados.

Avisos de dependencias de terceros: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

Claves de firma de licencias: `gravix_private.pem` (gitignored) / `gravix_public.pem`.
Las claves de firma de *updates* son distintas y viven solo en los secrets de CI.
