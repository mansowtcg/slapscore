# SlapScore

Resultados, estadísticas completas y notas estilo SofaScore de los partidos de **Slapshot: Rebound**.

Web: https://mansowtcg.github.io/slapscore/ · Panel de administrador: https://mansowtcg.github.io/slapscore/#admin

## Cómo funciona

- `crawler/crawl.js` revisa los perfiles públicos de slapshot.gg (`/api/game/players/ID` y `/ranked`): los últimos 10 partidos de cada jugador y su rango/MMR. Cada jugador que aparece en un partido entra en la lista; los más activos se revisan más a menudo. Como mucho 9 peticiones por minuto (el límite de slapshot.gg es 10).
- Guarda un historial de rango y MMR por jugador, que se usa para mostrar el rango que tenía cada uno en cada partido.
- `.github/workflows/crawl.yml` lo ejecuta cada 30 minutos (y cuando se lanza desde el panel), reconstruye los datos y publica la web en GitHub Pages.

## Datos (rama `data`)

La rama `data` tiene un solo commit que se reescribe en cada pasada, así el repositorio no crece sin control.

- `full/AAAA-MM-DD/HH.json`: partidos tal cual los da slapshot.gg, por día y hora de Madrid.
- `days/AAAA-MM-DD.json`: resumen de cada partido del día (lo que usa la portada).
- `p/<id>.json`: perfil de cada jugador con sus partidos, rango, MMR y atributos.
- `players.json`, `top.json`, `index.json`: tablas, rankings e índice.
- `state.json`: estado interno del robot (no se publica en la web).

## Ajustes (`config/settings.json`)

- `seeds`: jugadores que se revisan con prioridad.
- `hidden`: partidos ocultos.
- `weights`: pesos de la nota que cambian respecto a los de `assets/core.js`.

Se pueden cambiar desde el panel de administrador, que usa un token de GitHub de grano fino con permisos de **Actions** y **Contents** en lectura y escritura sobre este repositorio. El token solo se guarda en el navegador de quien lo usa.

## App en el móvil

SlapScore se puede instalar en la pantalla de inicio (Android: botón «Instalar»; iPhone: Compartir › Añadir a pantalla de inicio). Un service worker guarda la web y los datos ya vistos para que cargue al instante y funcione sin conexión. Cada publicación marca los archivos con su versión (`?b=…`) para que nunca se mezclen versiones.

## Logos de rango

La web usa los logos que haya en `assets/ranks/` según `assets/ranks/index.json` (por ejemplo `{"PLAT_III": "PLAT_III.png"}`). Se suben desde el panel de administrador. Si falta alguno, se usa el emblema de SlapScore.

## Código

- `assets/core.js`: nota de los jugadores, normalización de partidos y rangos (lo comparten la web y el robot).
- `assets/app.js`, `assets/style.css`, `assets/emblems.js`: la web. Los emblemas de rango son un diseño propio de SlapScore.
- `assets/admin.js`: panel de administrador.

SlapScore no está afiliado a Oddshot Games.
