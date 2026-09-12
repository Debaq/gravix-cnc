# Publicar un release de gravix

## 0. Una sola vez — claves de firma del updater

El updater de Tauri solo instala artefactos firmados con una clave que el
binario lleva embebida. Esa clave **no es** la de licencias (`gravix_*.pem`):
son dos pares distintos con propósitos distintos.

```bash
npm run tauri signer generate -- -w ~/.tauri/gravix.key
```

Pide una contraseña. Genera dos archivos:

| Archivo | Qué es | Dónde va |
|---|---|---|
| `~/.tauri/gravix.key` | privada — firma los artefactos | secret de GitHub, **nunca** al repo |
| `~/.tauri/gravix.key.pub` | pública — verifica la firma | `tauri.conf.json` → `plugins.updater.pubkey` |

Pegar el contenido de la pública en la config:

```bash
# imprime la línea a pegar en plugins.updater.pubkey
cat ~/.tauri/gravix.key.pub
```

Y cargar la privada como secrets del repo:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/gravix.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # pide la contraseña
```

> Si se pierde la privada, los clientes ya instalados dejan de aceptar updates:
> hay que redistribuir el instalador a mano. Respaldarla fuera del equipo.

Con `plugins.updater.pubkey` vacío la app arranca bien y **sí detecta**
actualizaciones (el chequeo solo lee el `latest.json`), pero la instalación
falla al verificar la firma. O sea: el updater está a medias hasta que la
pubkey esté puesta. El bundler tampoco exige `TAURI_SIGNING_PRIVATE_KEY`
mientras la pubkey siga vacía; en cuanto se complete, `npm run tauri build`
la pide.

## 1. Subir la versión

`package.json` es la única fuente de verdad. `scripts/sync-version.mjs` la
propaga a `tauri.conf.json` y `Cargo.toml` en cada `predev`/`prebuild`/`pretauri`.

```bash
npm version patch --no-git-tag-version   # o minor / major
npm run sync:version
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: version X.Y.Z"
```

## 2. Regenerar avisos de terceros

```bash
node scripts/gen-third-party.mjs
git add THIRD-PARTY-NOTICES.md && git commit -m "chore: avisos de terceros"
```

## 3. Tag y push

```bash
git tag vX.Y.Z
git push origin main --tags
```

El tag dispara `.github/workflows/release.yml`, que compila Linux, Windows y
macOS (arm64 + x86_64), firma cada artefacto y sube un **release en borrador**
con el `latest.json` que consume el updater.

El workflow agrega `--config tauri.release.conf.json`, que activa
`createUpdaterArtifacts`. Vive aparte a propósito: activarlo en la config base
haría que cualquier `npm run tauri build` local fallara pidiendo la clave
privada de firma.

## 4. Publicar

Revisar el borrador en GitHub, escribir las notas (aparecen en el modal de
actualización dentro de la app) y publicarlo. Recién ahí los clientes lo ven:
el endpoint apunta a `releases/latest`, que ignora los borradores.

## Build local en Arch / distros con glibc reciente

`linuxdeploy` trae un `strip` viejo que no entiende la sección `.relr.dyn` de
las librerías actuales y aborta el AppImage con `Strip call failed`. Se evita
desactivando el strip:

```bash
NO_STRIP=true npm run tauri build
```

No afecta a CI: `ubuntu-22.04` no tiene el problema.

## Targets que se generan

| SO | Formatos |
|---|---|
| Linux | `.deb`, `.rpm`, `.AppImage` |
| Windows | instalador NSIS `.exe` |
| macOS | `.app`, `.dmg` (arm64 y x86_64 por separado) |

El updater solo puede actualizar formatos que se auto-reemplazan: AppImage,
NSIS y `.app`. Quien instaló por `.deb` o `.rpm` actualiza por el gestor de
paquetes de su distro, no por la app.

## Probar el updater sin publicar

1. Bajar temporalmente la versión de `package.json` (ej. `4.9.9`), `npm run sync:version`.
2. `npm run tauri build` y correr el binario resultante.
3. Debe detectar la versión real publicada en GitHub y ofrecer el update.
4. Revertir la versión.
