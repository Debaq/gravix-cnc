#!/usr/bin/env node
// Genera THIRD-PARTY-NOTICES.md a partir de las dependencias reales que
// terminan en el bundle: las de produccion de package-lock.json y todo el
// grafo de crates de Cargo. Las licencias permisivas (MIT, BSD, Apache)
// obligan a distribuir su aviso junto al binario; este archivo es ese aviso.
//
// Uso: node scripts/gen-third-party.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Nombres de archivo de licencia, por orden de preferencia. */
const LICENSE_FILES = /^(LICENSE|LICENCE|COPYING|NOTICE)(\.(md|txt))?$/i

function readLicenseText(dir) {
  if (!existsSync(dir)) return null
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  const match = entries.find((f) => LICENSE_FILES.test(f))
  if (!match) return null
  try {
    const text = readFileSync(join(dir, match), 'utf8').trim()
    // Un texto enorme casi siempre es un LICENSE mal nombrado (ej. un README).
    return text.length > 20000 ? null : text
  } catch {
    return null
  }
}

// ─── npm ───

function collectNpm() {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const out = new Map()

  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (!path || meta.dev || meta.optional) continue
    const name = meta.name ?? path.replace(/^.*node_modules\//, '')
    if (!name) continue

    const dir = join(root, path)
    let license = meta.license
    if (!license && existsSync(join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type
      } catch {
        // package.json ilegible: queda como desconocida y se reporta asi.
      }
    }

    const key = `${name}@${meta.version ?? '?'}`
    if (out.has(key)) continue
    out.set(key, {
      name,
      version: meta.version ?? '?',
      license: license ?? 'UNKNOWN',
      text: readLicenseText(dir),
    })
  }

  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ─── cargo ───

function collectCargo() {
  let metadata
  try {
    metadata = JSON.parse(
      execFileSync(
        'cargo',
        ['metadata', '--format-version', '1', '--manifest-path', 'Cargo.toml'],
        { cwd: join(root, 'src-tauri'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      ),
    )
  } catch (err) {
    console.warn(`[third-party] cargo metadata fallo, se omiten crates: ${err.message}`)
    return []
  }

  const localNames = new Set((metadata.workspace_members ?? []).map((id) => String(id)))

  return (metadata.packages ?? [])
    .filter((p) => !localNames.has(p.id))
    .filter((p) => p.name !== 'gravix')
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? 'ver license_file' : 'UNKNOWN'),
      text: p.manifest_path ? readLicenseText(dirname(p.manifest_path)) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ─── salida ───

function summarize(deps) {
  const counts = new Map()
  for (const d of deps) counts.set(d.license, (counts.get(d.license) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([license, n]) => `- \`${license}\` — ${n}`)
    .join('\n')
}

function renderSection(title, deps) {
  const lines = [`## ${title}`, '', `${deps.length} paquetes.`, '', summarize(deps), '']

  for (const d of deps) {
    lines.push(`### ${d.name} ${d.version}`, '', `Licencia: \`${d.license}\``, '')
    if (d.text) lines.push('```text', d.text, '```', '')
  }

  return lines.join('\n')
}

const npm = collectNpm()
const cargo = collectCargo()

const doc = `# Avisos de terceros

gravix se distribuye bajo licencia propietaria (ver \`LICENSE\`), pero incorpora
componentes de terceros bajo sus propias licencias. Esta lista reproduce sus
avisos de copyright, como esas licencias exigen.

Generado por \`scripts/gen-third-party.mjs\`. No editar a mano.

## Notas de cumplimiento

- **Licencias duales** (\`MIT OR Apache-2.0\`, \`GPL-3.0/MIT\`, …): gravix ejerce la
  opción permisiva. Ninguna dependencia impone copyleft al código de gravix.
- **MPL-2.0** (entre otras \`serialport\`, base del control serial): es copyleft
  por archivo. Permite enlazar desde software propietario; obliga a publicar las
  modificaciones a *esos* archivos. gravix las usa sin modificar.
- **Paquetes marcados \`UNKNOWN\`**: el paquete no declara licencia en su
  manifiesto ni incluye archivo de licencia. Revisar antes de cada distribución.

${renderSection('Dependencias JavaScript (producción)', npm)}
${renderSection('Dependencias Rust', cargo)}`

writeFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), doc)
console.log(
  `[third-party] THIRD-PARTY-NOTICES.md — ${npm.length} paquetes npm, ${cargo.length} crates`,
)
