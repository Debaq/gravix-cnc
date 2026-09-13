#!/usr/bin/env node
// package.json es la única fuente de verdad de la versión.
// tauri.conf.json y Cargo.toml se derivan de ella en cada pre-build.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[sync-version] version invalida en package.json: "${version}"`)
  process.exit(1)
}

const changed = []

// tauri.conf.json
const confPath = join(root, 'src-tauri/tauri.conf.json')
const confRaw = readFileSync(confPath, 'utf8')
const conf = JSON.parse(confRaw)
if (conf.version !== version) {
  conf.version = version
  writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')
  changed.push('tauri.conf.json')
}

// Cargo.toml — solo el `version` del bloque [package], no el de las deps.
const cargoPath = join(root, 'src-tauri/Cargo.toml')
const cargoRaw = readFileSync(cargoPath, 'utf8')
const cargoNext = cargoRaw.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]*)(")/,
  (m, pre, cur, post) => (cur === version ? m : `${pre}${version}${post}`),
)
if (cargoNext !== cargoRaw) {
  writeFileSync(cargoPath, cargoNext)
  changed.push('Cargo.toml')
}

// splashscreen.html — el splash es estatico (fuera del bundle de Vite), asi que
// la version se estampa aca en vez de usar __APP_VERSION__.
const splashPath = join(root, 'public/splashscreen.html')
const splashRaw = readFileSync(splashPath, 'utf8')
const splashNext = splashRaw.replace(
  /(<span class="version" data-version>)v?[^<]*(<\/span>)/,
  `$1v${version}$2`,
)
if (splashNext !== splashRaw) {
  writeFileSync(splashPath, splashNext)
  changed.push('splashscreen.html')
} else if (!splashRaw.includes(`data-version>v${version}<`)) {
  console.error('[sync-version] no se encontro el marcador data-version en public/splashscreen.html')
  process.exit(1)
}

console.log(
  changed.length
    ? `[sync-version] ${version} → ${changed.join(', ')}`
    : `[sync-version] ${version} ya sincronizado`,
)
