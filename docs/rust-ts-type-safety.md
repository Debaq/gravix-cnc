# Rust ↔ TypeScript type safety

Guía reusable para lograr **una sola fuente de verdad** para tipos compartidos entre backend Rust y frontend TypeScript. Basado en la implementación en este proyecto (Tauri + React).

## El problema

En apps con backend Rust y frontend TS, los tipos suelen estar **duplicados** a mano:

```rust
// Rust
pub enum Dialect { Grbl, Marlin }
```

```ts
// TS (hand-written, se olvida actualizar)
type Dialect = 'grbl' | 'marlin'
```

Cuando agregás una variante en Rust y olvidás TS, no hay error de compilación. El bug aparece en runtime: serde recibe `"smoothie"` y panica.

## La solución: code generation

Rust es la **única fuente de verdad**. Los tipos TS se generan automáticamente. Cambios en Rust → regenerás TS → el compilador TS obliga a actualizar los consumers.

## Nombres técnicos

- **Cross-language type safety**
- **Single Source of Truth (SSOT) for types**
- **End-to-end type safety**
- **Typed IPC** (Inter-Process Communication)
- **Schema-first / contract-driven development**

## Herramientas del ecosistema

| Tool | Cuándo usar |
|------|-------------|
| `ts-rs` | Simple, bien mantenida, scope pequeño-medio |
| `specta` | Más moderna, mejor integración Tauri |
| `tauri-specta` | **Recomendado para Tauri** — genera invoke wrappers completos |
| `typeshare` (Shopify) | Cross-lang (TS, Kotlin, Swift) |
| `serde-reflection` | Multi-target, más abstracto |

**Para Tauri hoy**: usá `tauri-specta` — genera no solo tipos sino el cliente completo:

```ts
import { commands } from '@/lib/bindings'
await commands.serialConnect({ port: '/dev/ttyUSB0', baudRate: 115200 })
//           ↑ autocomplete, error si el backend cambia la firma
```

## Receta paso a paso (con `ts-rs`)

### 1. Cargo.toml

```toml
[dependencies]
ts-rs = "10"
# Para Tauri moderno preferir:
# specta = { version = "2", features = ["derive", "typescript"] }
# tauri-specta = "2"
```

### 2. Rust — derive en cada tipo compartido

```rust
use ts_rs::TS;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
#[serde(rename_all = "lowercase")]   // enum → "variant", no "Variant"
pub enum MyEnum {
    Foo,
    Bar,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct MyStruct {
    pub id: String,

    #[serde(rename = "feedRate", skip_serializing_if = "Option::is_none")]
    #[ts(rename = "feedRate", optional)]  // camelCase + ?: en vez de | null
    pub feed_rate: Option<f64>,

    pub nested: MyEnum,  // también debe tener derive(TS)
}
```

**Atributos clave**:
- `#[ts(export)]` — genera al correr `cargo test`
- `#[ts(export_to = "...")]` — path relativo a Cargo.toml (o al source file en algunas versiones)
- `#[ts(rename = "...")]` — para camelCase/snake_case mapping
- `#[ts(optional)]` — genera `field?: T` en vez de `field: T | null`
- `#[serde(rename_all = "lowercase")]` — en enums, para variants limpias

### 3. package.json scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "tauri": "tauri",
    "types:gen": "cd src-tauri && cargo test --quiet export_bindings",
    "predev": "npm run types:gen",
    "prebuild": "npm run types:gen",
    "pretauri": "npm run types:gen"
  }
}
```

`predev` / `prebuild` / `pretauri` corren **antes** de su script homónimo. Cada `npm run dev` regenera tipos primero. Drift imposible en pipeline.

### 4. Estructura de archivos

```
src/
├── lib/
│   ├── generated/        ← auto, committeado, NO editar a mano
│   │   ├── MyEnum.ts
│   │   ├── MyStruct.ts
│   │   └── ...
│   └── types.ts          ← hand-written + re-exports de generated
```

### 5. Re-export transparente (migración incremental)

Si ya tenías tipos hand-written en `types.ts`, **no rompas los imports existentes**. Re-exportá desde `types.ts`:

```ts
// src/lib/types.ts
export type { MyEnum } from '@/lib/generated/MyEnum'
export type { MyStruct } from '@/lib/generated/MyStruct'

// Tipos que siguen siendo solo-TS se mantienen acá
export interface UiOnlyType { ... }
```

Consumers siguen funcionando sin tocar:

```ts
import type { MyEnum } from '@/lib/types'   // ← sin cambios
```

### 6. Consumer con exhaustividad

```ts
import type { MyEnum } from '@/lib/types'

function handle(e: MyEnum): string {
  switch (e) {
    case 'foo': return 'Foo action'
    case 'bar': return 'Bar action'
    // ← Si Rust agrega `Baz`, tsc error acá hasta agregar el case
  }
}
```

El `switch` exhaustivo es la **garantía real**: obliga a actualizar código TS cuando Rust cambia.

## Garantías que ganás

| Situación | Manual | Con codegen |
|-----------|--------|-------------|
| Agregás variante al enum Rust y olvidás TS | silencioso, runtime error | **tsc error** |
| Renombrás variante | silencioso, parser rompe | **archivo regenerado, tsc error** |
| Cambiás `rename_all` | silencioso, strings divergen | **TS ve strings nuevos** |
| Nuevo dev toca Rust | "¿qué más tenía que actualizar?" | `cargo test` le dice todo |

## Patrones complementarios

### 1. Opaque JSON blob (tipos solo-frontend)

Cuando un tipo conceptualmente vive en el frontend (UI state, config estructurada), **no lo repliques en Rust**. Usá `serde_json::Value`:

```rust
pub struct ConfigFile {
    pub profiles: Vec<serde_json::Value>,  // shape vive en TS
    pub active_id: Option<String>,
}
```

Rust solo persiste, TS define el shape. Evita replicar 200 LOC.

### 2. Generic persistence layer (DRY)

Si tenés N tipos persistidos a JSON, extraé helpers genéricos:

```rust
// src-tauri/src/json_store.rs
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;
use std::fs;

pub fn read_json<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    if !path.exists() { return Ok(T::default()); }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn write_json<T: Serialize>(path: &Path, data: &T) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}
```

Y el path del data dir aparte:

```rust
// src-tauri/src/paths.rs
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
}
```

Cada command-file queda en 3 líneas:

```rust
pub fn read_tools_from(dir: &Path) -> Result<Vec<Tool>, String> {
    read_json(&dir.join("tools.json"))
}
```

Esto se llama **Repository pattern** o **Data Access Layer**.

### 3. Strategy pattern para protocolos

Cuando el backend tiene que elegir lógica según una variante del enum (ej: parser GRBL vs Marlin):

```rust
fn classify_line(line: &str, dialect: Dialect) -> DataKind {
    match dialect {
        Dialect::Grbl => classify_grbl(line),
        Dialect::Marlin => classify_marlin(line),
    }
}
```

Más idiomático en Rust que trait objects. Exhaustivo por match.

### 4. Value Object con `Record<K, V>` para labels

Si tenés un enum con labels para UI:

```ts
import type { MyEnum } from '@/lib/types'

export const LABELS: Record<MyEnum, string> = {
  foo: 'Foo bonito',
  bar: 'Bar amigable',
  // ← Si agregás variante al enum, tsc obliga a agregar label acá
}
```

TS obliga exhaustividad porque `Record<Enum, V>` requiere cada key.

## Checklist para próximos proyectos

```
[ ] Agregar ts-rs (o specta + tauri-specta si es Tauri) a Cargo.toml
[ ] Convención: 1 tipo por archivo .rs → 1 archivo .ts generado
[ ] Carpeta src/lib/generated/ aparte y committeada
[ ] #[ts(optional)] en todos los Option<T>
[ ] #[ts(rename = ...)] para camelCase en fields
[ ] #[serde(rename_all = "lowercase")] en enums
[ ] npm predev + prebuild + pretauri regeneran antes de compilar
[ ] Re-export desde types.ts para migración sin romper imports
[ ] Switch exhaustivo en TS sobre enums compartidos
[ ] Tipos que vivan solo en TS → serde_json::Value en Rust
[ ] Repository pattern para persistencia JSON (read_json/write_json genéricos)
[ ] Record<Enum, V> para labels UI (exhaustividad forzada)
```

## Qué dejar fuera del codegen

- Tipos de **UI state** puro (ej: form data, modal state)
- Tipos con **computed properties** o métodos
- Tipos con **lógica compleja de validación** (Zod, class-validator)
- Tipos que cambian **mucho más rápido en TS** que en Rust

## Referencias

- `ts-rs`: https://github.com/Aleph-Alpha/ts-rs
- `specta`: https://github.com/oscartbeaumont/specta
- `tauri-specta`: https://github.com/oscartbeaumont/tauri-specta
- `typeshare`: https://github.com/1Password/typeshare

## TL;DR

> Code-generated shared types from Rust to TypeScript using `ts-rs` (o `tauri-specta` en apps Tauri), con una carpeta `generated/` re-exportada transparentemente desde `types.ts`. Cada cambio en Rust regenera el `.ts` vía `predev/prebuild`, y el compilador TS fuerza la actualización de consumers.
