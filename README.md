# SlapScore

Resultados, estadísticas completas y notas estilo SofaScore de los partidos de **Slapshot: Rebound**.

Web: https://mansowtcg.github.io/slapscore/ · Panel de administrador: https://mansowtcg.github.io/slapscore/#admin

## Cómo funciona

- `crawler/crawl.js` revisa los perfiles públicos de slapshot.gg (`/api/game/players/ID` y `/ranked`): los últimos 10 partidos de cada jugador y su rango/MMR. Cada jugador que aparece en un partido entra en la lista; los más activos se revisan más a menudo. Como mucho 9 peticiones por minuto (el límite de slapshot.gg es 10).
- El robot es **incremental**: en cada pasada solo añade lo nuevo (partidos, resúmenes de esa hora, perfiles de los jugadores que han jugado). Una pasada normal tarda unos segundos en procesar aunque haya decenas de miles de jugadores.
- `.github/workflows/crawl.yml` lo ejecuta, guarda los datos y publica la web. Las pasadas automáticas van **encadenadas**: cada una rastrea 3 minutos (9 peticiones/min), publica y deja en cola la siguiente, así que la web se actualiza cada 3-4 minutos sin depender del reloj de GitHub, que no es fiable. El reloj de GitHub (`schedule`) y el Worker de Cloudflare solo relanzan la cadena si se corta. «Pausar robot» en el panel la detiene.
- **Destacados**: los jugadores seguidos y los 100 de más MMR van los primeros (hasta el 60 % de las peticiones, o el 45 % mientras haya muchos jugadores sin rango; los seguidos, siempre). Mientras juegan se revisan en cada pasada, y un partido visto en el historial de uno cuenta como revisión de todos los que jugaron en él, así que un grupo de destacados que juega junto gasta una sola petición.
- **Rangos**: mientras haya jugadores de los últimos 60 días sin rango consultado, el 70 % del resto de peticiones son de rango. Al conocer el rango de un jugador se pone también en sus partidos de las dos últimas semanas (atenuado si el partido es anterior a la primera consulta).
- Las tablas, rankings, récords y el resto de perfiles se recalculan cada 20 minutos.

## Qué hay en la web

- **Partidos** por día (tira de días y calendario), filtros por tipo, región, arena, jugador, **destacados** y **favoritos**; estadísticas de todos los jugadores desplegables en cada fila; la lista de hoy se actualiza sola y dice cuándo fue la última vez.
- **Públicas y custom por separado**: cada jugador tiene una nota media y unas estadísticas para cada tipo, y en su perfil (y en el comparador) se elige cuáles ver. Las tablas, rankings, récords, líderes y rachas cuentan solo las públicas. En la portada las custom llevan color y etiqueta propios.
- **Custom con periodos en un solo partido**: slapshot.gg da cada periodo de una partida custom como un partido aparte, con el marcador y las estadísticas acumulados. El robot junta los periodos de la misma partida (mismo servidor y arena, los mismos jugadores en el mismo equipo, a menos de 40 minutos y con los acumulados creciendo) y la guarda una vez, con el ID de su primer periodo. Dentro del partido se ve el marcador por periodos y se pueden ver las estadísticas y las notas del partido entero o de cada periodo. La nota del partido es la media de las notas de los periodos que jugó cada uno.
- **Portada**: jugando ahora (destacados que acaban de jugar), favoritos, líderes del día, partido destacado, mejores actuaciones, equipo de la semana, top MMR, más activos y actividad por horas.
- **Partido**: resumen, alineaciones, estadísticas, JSON original e **imagen para compartir** (1080×1350).
- **Jugador**: rango actual y mejor rango con logos oficiales, racha, forma, forma semanal, notas, MMR con ascensos y descensos, atributos, estadísticas de toda la carrera, mejores partidos, compañeros y rivales habituales (con su cara a cara), rendimiento por arena, historial, comparar, imagen para compartir y su equipo de la EUSL si juega en la liga.
- **Comparar jugadores**, **tabla de jugadores** (periodo, mínimo de partidos, rango, favoritos), **rankings** (con reparto de rangos), **récords** (siempre o 7 días), **EUSL** (eusl.gg, con enlace a cada equipo) y **cómo puntuamos**.
- **Favoritos** guardados en el navegador de cada uno (con la lista de hoy abierta, sale un aviso cuando un favorito termina un partido); buscador por nombre, ID o enlace de slapshot.gg (también de partido); atajo «/».
- **Buzón de sugerencias** (icono de bocadillo en la cabecera, enlace en el pie y recuadro en la portada): ideas, errores u otros, con contacto opcional. Los mensajes se guardan en Cloudflare y se leen y borran desde el panel de administrador.
- **Panel de tráfico** (pestaña «Tráfico» del administrador): personas conectadas ahora mismo, visitantes, visitas, páginas vistas, páginas por visita, tiempo medio y rebote comparados con el periodo anterior, gráfico por horas, días o meses, páginas y jugadores más vistos, de dónde vienen (también enlaces con `?ref=`), países, dispositivos, navegadores, sistemas, idiomas, páginas de entrada, fidelidad, acciones (compartir, favoritos, sugerencias, instalar la app) y cuándo entra la gente. Periodos: hoy, ayer, 7, 30 y 90 días y 12 meses; tabla y CSV.
- Inglés por defecto y español (botón ES/EN). Tema claro y oscuro. Se instala como app en el móvil.

## Datos (rama `data`)

La rama `data` tiene un solo commit que se reescribe en cada pasada. Los archivos grandes van comprimidos con gzip (`.json.gz`) y el navegador los descomprime solo.

- `index.json`: días con la versión de cada uno, totales y últimas pasadas.
- `days/AAAA-MM-DD.json`: resumen del día (recuentos, líderes, mejores actuaciones, partido destacado).
- `days/AAAA-MM-DD/HH.json.gz`: resúmenes de los partidos de esa hora (en días archivados, bloques de varias horas).
- `full/AAAA-MM-DD/HH.json.gz`: partidos tal cual los da slapshot.gg, solo de los últimos 60 días.
- `p/<grupo>.json.gz`: perfiles de jugadores agrupados en 4096 archivos (últimos 400 partidos de cada uno; `a` son los totales en públicas y `ac` en custom).
- `search.json.gz`, `players-{a,m,k}.json.gz`, `rankings.json`, `top.json`, `attr.json`, `records.json`, `eusl.json`: buscador, tabla de jugadores (siempre, 30 días, 7 días), rankings, portada (con equipo de la semana), atributos, récords y liga EUSL. `index.json` lleva además los destacados (`featured`) y los que acaban de jugar (`live`).
- `_int/` (no se publica): estado del robot, totales de cada jugador por día y por mes (públicas y custom por separado: `{ v: 2, p: {…}, c: {…} }`) y partidos pendientes de archivar.

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
- `api`: dirección del Worker de Cloudflare para el buzón de sugerencias (por defecto, la de workers.dev).

Se pueden cambiar desde el panel de administrador, que usa un token de GitHub de grano fino con permisos de **Actions** y **Contents** en lectura y escritura sobre este repositorio. El token solo se guarda en el navegador de quien lo usa.

## Publicar también en Cloudflare (gratis, opcional)

El flujo publica siempre en GitHub Pages. Si el repositorio tiene estos secretos (Settings › Secrets and variables › Actions), además publica en Cloudflare Workers:

- `CLOUDFLARE_API_TOKEN`: token de Cloudflare con la plantilla «Edit Cloudflare Workers».
- `CLOUDFLARE_ACCOUNT_ID`: el ID de la cuenta de Cloudflare.
- `DISPATCH_TOKEN` (opcional): token de GitHub de grano fino con **Actions: lectura y escritura** sobre este repositorio. Con él, el Worker (`cloudflare/worker.js`) comprueba cada 30 minutos que la cadena de pasadas sigue viva y, si se ha cortado, la relanza.

En Cloudflare la web queda en `https://slapscore.<tu-subdominio>.workers.dev`, sin límite de tráfico, y solo se suben los archivos que cambian.

**Buzón de sugerencias.** El Worker recibe los mensajes en `/api/feedback` y los guarda en un almacén KV `slapscore-feedback`, que el flujo crea solo la primera vez (el token de Cloudflare necesita **Workers KV Storage: Edit**, incluido en la plantilla «Edit Cloudflare Workers»). Desde GitHub Pages la web envía los mensajes a la dirección de workers.dev (se puede cambiar con `api` en los ajustes). No se guarda la IP: solo un resumen cifrado de un minuto para frenar envíos en bucle, y como mucho 200 mensajes al día. Para leer o borrar mensajes el Worker pide el token de GitHub del panel y comprueba con GitHub que puede escribir en el repositorio.

**Estadísticas de visitas.** La web avisa al Worker de cada página vista (`/api/v`, con `fetch` y `keepalive`), del tiempo con la página a la vista y de algunas acciones. Se guardan en un Durable Object con SQLite (`cloudflare/stats.js`, clase `Stats`), que entra en el plan gratuito (100.000 filas escritas y 5 millones leídas al día: cada evento es una fila). Sin cookies ni identificadores en el navegador: las personas se cuentan con un resumen cifrado de IP + navegador con una sal que cambia cada mes y se borra, y la IP no se guarda. No cuentan los robots, los navegadores automáticos ni el administrador (al entrar en el panel, su navegador queda marcado para no contar). Cada día cerrado se resume en una fila; los eventos se guardan 400 días. El panel los pide a `/api/stats` con el token de GitHub, igual que el buzón.

## App en el móvil

SlapScore se puede instalar en la pantalla de inicio (Android: botón «Instalar»; iPhone: Compartir › Añadir a pantalla de inicio). Un service worker guarda la web y los datos ya vistos: como cada archivo se pide con la huella de su contenido (`?v=…`), lo que no ha cambiado sale al instante de la caché.

## Logos de rango

`assets/ranks/` tiene los logos oficiales de los 14 rangos (Bronze I a Legend, también Diamond), recortados de la captura «ALL RANKS» del juego (`tools/rangos-slapshot.png`) con `tools/cut-ranks.py`: 128 px y una versión de 64 px para los tamaños pequeños (`_small` en `assets/ranks/index.json`). Se pueden cambiar desde el panel de administrador; si falta alguno, se usa el emblema de SlapScore.

## Idioma

La web sale en inglés por defecto; el botón ES/EN de la cabecera (o el enlace del pie) cambia a español y se recuerda en ese navegador. Los textos se escriben en español en el código y se traducen con `t()` (`assets/i18n.js`, diccionario en `assets/en.js`).

## Código

- `assets/core.js`: nota de los jugadores, normalización de partidos, rangos y formato de datos (lo comparten la web y el robot).
- `assets/app.js`, `assets/style.css`, `assets/emblems.js`: la web (los emblemas propios solo se usan si falta algún logo oficial).
- `assets/i18n.js`, `assets/en.js`: idioma (inglés por defecto).
- `assets/share.js`: imágenes para compartir (se carga solo al usarlas).
- `crawler/eusl.js`: datos de la liga EUSL (API pública de eusl.gg).
- `tools/cut-ranks.py`: recorta los logos de rango de la captura oficial.
- `assets/admin.js`: panel de administrador.
- `assets/vendor/gunzip.js`: descompresor para navegadores antiguos ([fflate](https://github.com/101arrowz/fflate), MIT).
- `crawler/`: el robot.
- `cloudflare/worker.js`, `wrangler.toml`: publicación opcional en Cloudflare.

SlapScore no está afiliado a Oddshot Games.
