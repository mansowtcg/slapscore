# SlapScore

Resultados, estadísticas completas y notas estilo SofaScore de los partidos de **Slapshot: Rebound**.

Web: https://mansowtcg.github.io/slapscore/ · Panel de administrador: https://mansowtcg.github.io/slapscore/#admin

## Cómo funciona

- `crawler/crawl.js` revisa los perfiles públicos de slapshot.gg (`/api/game/players/ID` y `/ranked`): los últimos 10 partidos de cada jugador y su rango/MMR. Cada jugador que aparece en un partido entra en la lista; los más activos se revisan más a menudo. Como mucho 9 peticiones por minuto (el límite de slapshot.gg es 10).
- El robot es **incremental**: en cada pasada solo añade lo nuevo (partidos, resúmenes de esa hora, perfiles de los jugadores que han jugado). Una pasada normal tarda unos segundos en procesar aunque haya decenas de miles de jugadores.
- `.github/workflows/crawl.yml` lo ejecuta, guarda los datos y publica la web. Las pasadas automáticas van **encadenadas**: cada una rastrea 20 minutos a ritmo suave (5 peticiones/min) y, al terminar, deja en cola la siguiente, así que la web se actualiza cada 25 minutos aprox. sin depender del reloj de GitHub, que no es fiable. El reloj de GitHub (`schedule`) y el Worker de Cloudflare solo relanzan la cadena si se corta. «Pausar robot» en el panel la detiene.

## Datos (rama `data`)

La rama `data` tiene un solo commit que se reescribe en cada pasada. Los archivos grandes van comprimidos con gzip (`.json.gz`) y el navegador los descomprime solo.

- `index.json`: días con la versión de cada uno, totales y últimas pasadas.
- `days/AAAA-MM-DD.json`: resumen del día (recuentos, líderes, mejores actuaciones, partido destacado).
- `days/AAAA-MM-DD/HH.json.gz`: resúmenes de los partidos de esa hora (en días archivados, bloques de varias horas).
- `full/AAAA-MM-DD/HH.json.gz`: partidos tal cual los da slapshot.gg, solo de los últimos 60 días.
- `p/<grupo>.json.gz`: perfiles de jugadores agrupados en 4096 archivos (últimos 400 partidos de cada uno).
- `search.json.gz`, `players-{a,m,k}.json.gz`, `rankings.json`, `top.json`, `attr.json`: buscador, tabla de jugadores (siempre, 30 días, 7 días), rankings, portada y atributos.
- `_int/` (no se publica): estado del robot, totales de cada jugador por día y por mes, y partidos pendientes de archivar.

### Archivo y estadísticas de carrera

- Los partidos completos de más de 60 días (configurable entre 35 y 400 en el panel) salen de la web y se suben a [GitHub Releases](https://github.com/mansowtcg/slapscore/releases): una publicación `archivo-AAAA-MM` por mes con un archivo `partidos-AAAA-MM-DD.json.gz` por día.
- Las estadísticas de carrera no dependen de esos partidos: el robot guarda los totales de cada jugador por día (y junta los meses cerrados), así que perfiles, rankings y resúmenes se conservan siempre.
- Un partido archivado se sigue viendo en la web con su nota y las estadísticas principales de cada jugador, y enlaza al archivo del día.

## Ajustes (`config/settings.json`)

- `seeds`: jugadores que se revisan con prioridad.
- `hidden`: partidos ocultos (`AAAA-MM-DD/HH|id`).
- `weights`: pesos de la nota que cambian respecto a los de `assets/core.js`. Al cambiarlos se recalculan las notas de los partidos no archivados.
- `retainDays`: días con el detalle completo en la web (por defecto 60).
- `support`: enlace de apoyo (Ko-fi, Patreon…). Si está, aparece un recuadro en la portada y un enlace en el pie.
- `home`: dirección nueva de la web si se muda; la de GitHub Pages redirige a ella.

Se pueden cambiar desde el panel de administrador, que usa un token de GitHub de grano fino con permisos de **Actions** y **Contents** en lectura y escritura sobre este repositorio. El token solo se guarda en el navegador de quien lo usa.

## Publicar también en Cloudflare (gratis, opcional)

El flujo publica siempre en GitHub Pages. Si el repositorio tiene estos secretos (Settings › Secrets and variables › Actions), además publica en Cloudflare Workers:

- `CLOUDFLARE_API_TOKEN`: token de Cloudflare con la plantilla «Edit Cloudflare Workers».
- `CLOUDFLARE_ACCOUNT_ID`: el ID de la cuenta de Cloudflare.
- `DISPATCH_TOKEN` (opcional): token de GitHub de grano fino con **Actions: lectura y escritura** sobre este repositorio. Con él, el Worker (`cloudflare/worker.js`) comprueba cada 30 minutos que la cadena de pasadas sigue viva y, si se ha cortado, la relanza.

En Cloudflare la web queda en `https://slapscore.<tu-subdominio>.workers.dev`, sin límite de tráfico, y solo se suben los archivos que cambian.

## App en el móvil

SlapScore se puede instalar en la pantalla de inicio (Android: botón «Instalar»; iPhone: Compartir › Añadir a pantalla de inicio). Un service worker guarda la web y los datos ya vistos: como cada archivo se pide con la huella de su contenido (`?v=…`), lo que no ha cambiado sale al instante de la caché.

## Logos de rango

La web usa los logos que haya en `assets/ranks/` según `assets/ranks/index.json` (por ejemplo `{"PLAT_III": "PLAT_III.png"}`). Se suben desde el panel de administrador. Si falta alguno, se usa el emblema de SlapScore.

## Código

- `assets/core.js`: nota de los jugadores, normalización de partidos, rangos y formato de datos (lo comparten la web y el robot).
- `assets/app.js`, `assets/style.css`, `assets/emblems.js`: la web. Los emblemas de rango son un diseño propio de SlapScore.
- `assets/admin.js`: panel de administrador.
- `assets/vendor/gunzip.js`: descompresor para navegadores antiguos ([fflate](https://github.com/101arrowz/fflate), MIT).
- `crawler/`: el robot.
- `cloudflare/worker.js`, `wrangler.toml`: publicación opcional en Cloudflare.

SlapScore no está afiliado a Oddshot Games.
