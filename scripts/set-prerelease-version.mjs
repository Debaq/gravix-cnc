#!/usr/bin/env node
// Calcula y fija la version de pre-release en package.json.
//
//   <base>-pre.<YYYYMMDD>.<numero de commit>
//   ej. 5.0.0-pre.20260912.70
//
// El numero de commit es `git rev-list --count HEAD`: crece con cada commit,
// asi que dos pre-releases del mismo dia quedan ordenadas. Eso importa porque
// el updater compara versiones con semver — con un hash no sabria cual es mas
// nueva.
//
// Uso:
//   node scripts/set-prerelease-version.mjs             # calcula y escribe package.json
//   node scripts/set-prerelease-version.mjs --print     # solo imprime, no toca nada
//   node scripts/set-prerelease-version.mjs --set <v>   # escribe una version ya calculada
//
// `--set` existe para CI: la version se calcula una vez en un job aparte y se
// reparte a los runners. Si cada runner la calculara por su cuenta, dos que
// cruzan medianoche UTC firmarian versiones distintas para el mismo release.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

const setIndex = process.argv.indexOf('--set')
if (setIndex !== -1) {
  const given = process.argv[setIndex + 1]
  if (!given || !/^\d+\.\d+\.\d+-pre\.\d{8}\.\d+$/.test(given)) {
    console.error(`[prerelease] --set necesita una version tipo 5.0.0-pre.20260912.70, recibi: "${given ?? ''}"`)
    process.exit(1)
  }
  pkg.version = given
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`[prerelease] ${given} (fijada desde --set)`)
  process.exit(0)
}

// La base es la version sin su parte de pre-release: correr el script dos
// veces no debe producir 5.0.0-pre.X-pre.Y.
const base = pkg.version.split('-')[0]
if (!/^\d+\.\d+\.\d+$/.test(base)) {
  console.error(`[prerelease] version base invalida en package.json: "${pkg.version}"`)
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

// En un checkout superficial el contador miente. CI debe clonar con
// fetch-depth: 0; si no, el numero salta hacia atras y el updater deja de
// ofrecer la version nueva.
const shallow = git('rev-parse', '--is-shallow-repository') === 'true'
if (shallow) {
  console.error('[prerelease] el repo es un clon superficial: el contador de commits seria incorrecto')
  console.error('[prerelease] en GitHub Actions usa actions/checkout con fetch-depth: 0')
  process.exit(1)
}

const count = git('rev-list', '--count', 'HEAD')
const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
const version = `${base}-pre.${date}.${count}`

if (process.argv.includes('--print')) {
  console.log(version)
  process.exit(0)
}

pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`[prerelease] ${version}`)
console.log(`[prerelease] propaga con: npm run sync:version`)
console.log(`[prerelease] tag: v${version}`)
