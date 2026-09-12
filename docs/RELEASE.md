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

## Pre-releases

Lo normal mientras el producto no esté cerrado. Van con versión propia,
calculada en el momento y **sin commitear**:

```
<base>-pre.<YYYYMMDD>.<número de commit>     ej. 0.5.0-pre.20260912.70
```

Fecha y número de commit los calcula el Action en el momento del run —no hay
nada que escribir a mano ni que commitear. El número es `git rev-list --count
HEAD`, que crece con cada commit, así que dos pre-releases del mismo día quedan
ordenadas; el updater compara con semver y con un hash no sabría cuál es más
nueva. Toda pre-release es *menor* que la estable del mismo número
(`0.5.0-pre.… < 0.5.0`), así que quien esté en una pre-release recibe la
estable cuando salga.

**Desde GitHub:** Actions → `prerelease` → Run workflow. La versión se calcula
una sola vez en un job aparte y se reparte a los runners; si cada uno la
calculara por su cuenta, dos que crucen medianoche UTC firmarían versiones
distintas para el mismo release.

**En local**, para probar el bundle antes de publicar:

```bash
npm run version:pre        # calcula, escribe package.json y propaga
npm run version:pre:print  # solo muestra cuál sería
npm run tauri build
git checkout package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
```

El último paso importa: la versión de pre-release no se commitea. La rama
siempre lleva la versión estable.

> ⚠️ Sin verificar: que el instalador NSIS de Windows acepte una versión con
> parte de pre-release. El bundler debería descartarla para `VIProductVersion`,
> que exige `X.Y.Z.W`. Linux (deb, rpm, AppImage) sí está comprobado. La
> primera corrida del workflow lo confirma o lo desmiente.

### El updater no ve las pre-releases

`releases/latest` de GitHub devuelve **solo releases estables**: ignora
pre-releases y borradores. El endpoint del updater apunta ahí, así que
mientras el proyecto solo publique pre-releases:

- El workflow sube su `latest.json`, pero nadie lo consulta.
- La app no encuentra actualizaciones nunca — no falla, no muestra nada.
- Los testers instalan y actualizan **a mano** desde la página de releases.

El updater empieza a funcionar solo con la primera release estable. Si antes de
eso hace falta que los testers se actualicen solos, la salida es apuntar
`plugins.updater.endpoints` a una URL de tag fijo, por ejemplo
`https://github.com/Debaq/gravix-cnc/releases/download/updater/latest.json`, y
que el workflow suba ahí el `latest.json` de cada pre-release. Requiere crear
ese release-contenedor una vez y cambiar el endpoint.

## 1. Subir la versión

Solo para **releases estables**. Las pre-releases no tocan la versión de la rama.

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

El tag dispara `.github/workflows/release.yml`, que compila Linux y Windows,
firma cada artefacto y sube un **release en borrador** con el `latest.json`
que consume el updater.

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

| SO | Formatos | En CI |
|---|---|---|
| Linux | `.deb`, `.rpm`, `.AppImage` | sí |
| Windows | instalador NSIS `.exe` | sí |
| macOS | `.app`, `.dmg` | no — ver abajo |

### macOS

Fuera de CI por ahora. Distribuir en macOS exige cuenta de Apple Developer
(99 USD/año), firma y notarización: sin eso Gatekeeper no abre la app en
ninguna máquina que no sea la que la compiló, y publicar un `.dmg` sin firmar
solo genera soporte.

Los targets siguen declarados en `tauri.conf.json`, así que un build local en
un Mac funciona. Para sumarlo a CI hacen falta dos entradas más en la matriz
(`--target aarch64-apple-darwin` y `--target x86_64-apple-darwin`), el
toolchain con esos targets, y los secrets de firma y notarización de Apple.

### El identifier

`io.github.debaq.gravix`. No hace falta ser dueño del dominio —nadie lo
verifica—, pero usar uno que no controlás sí trae problemas: otro proyecto
puede elegir el mismo y romper instalaciones, y en las tiendas la validación
es más estricta. `io.github.<usuario>` es el espacio de nombres que sí
controlás a través de tu cuenta de GitHub, y es la convención de proyectos
alojados ahí.

Dos cosas a tener presentes:

- El identifier define dónde guarda la app su config y su licencia. Cambiarlo
  hace que una instalación previa se vea como otra app y no encuentre nada.
  Por eso se cambió ahora, antes del primer release.
- Nada de guiones bajos: rompen la notarización de Apple
  ([tauri#4359](https://github.com/tauri-apps/tauri/issues/4359)).

El updater solo puede actualizar formatos que se auto-reemplazan: AppImage,
NSIS y `.app`. Quien instaló por `.deb` o `.rpm` actualiza por el gestor de
paquetes de su distro, no por la app.

## Probar el updater sin publicar

1. Bajar temporalmente la versión de `package.json` (ej. `4.9.9`), `npm run sync:version`.
2. `npm run tauri build` y correr el binario resultante.
3. Debe detectar la versión real publicada en GitHub y ofrecer el update.
4. Revertir la versión.
