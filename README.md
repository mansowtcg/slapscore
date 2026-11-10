# SlapScore

Resultados, estadísticas completas y notas estilo SofaScore de los partidos de **Slapshot: Rebound**.

Web: https://slapscore.app

La web se sirve desde Cloudflare (Worker `slapscore` con los dominios slapscore.app y www.slapscore.app; www lleva a slapscore.app).

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
- **Portada**: jugando ahora (destacados que acaban de jugar), favoritos, líderes del día, partido destacado, mejores actuaciones, equipo de la semana (en la pista, como una alineación: dos delante y atrás el que más para y bloquea), top MMR, más activos y actividad por horas.
- **Partido**: resumen, alineaciones, estadísticas, JSON original e **imagen para compartir** (1080×1350).
- **Jugador**: rango actual y mejor rango con logos oficiales, racha, forma, forma semanal, notas, MMR con ascensos y descensos, atributos, estadísticas de toda la carrera, mejores partidos, compañeros y rivales habituales (con su cara a cara), rendimiento por arena, historial, comparar, imagen para compartir y su equipo de la EUSL si juega en la liga.
- **Novedades** (`/novedades`, `/whats-new`..., la pestaña «Info» del móvil): todo lo que hace la web y lo último que ha llegado (`assets/news.js`). A quien no lo ha visto le sale un punto en el menú y un aviso en la portada; al añadir algo, pon su fecha en `nuevo` y sube `NEWS_DATE` (y su texto en los diccionarios).
- **Premios** (`/premios`, `/awards`...): equipo de la semana (lunes a domingo) y jugador del mes, por nota media en públicas con un mínimo de partidos (20 en la semana, 60 en el mes; `crawler/awards.js`), con historial, insignias en el perfil e imagen para compartir.
- **Comparar jugadores**, **tabla de jugadores** (periodo, mínimo de partidos, rango, favoritos), **rankings** (con reparto de rangos), **récords** (siempre o 7 días), **EUSL** (eusl.gg, con enlace a cada equipo) y **cómo puntuamos**.
- **Overlay para OBS** (`overlay.html`, `assets/overlay.js`, `assets/overlay.css`): en el perfil de cualquier jugador, «Overlay para OBS» abre un configurador con vista previa (partidos 5/10/20, públicas/custom/todas, diseño completo o compacto, fondo oscuro/claro/transparente, rango y MMR, estadísticas e idioma) y da un enlace `/overlay/<id>?...` para una fuente de navegador de OBS. La página es ligera (no carga la web), tiene el fondo transparente y se actualiza sola cada minuto; el partido nuevo entra con una pequeña animación. Muestra las notas de los últimos partidos (con victoria o derrota), la nota media, el MMR y cuánto ha cambiado, y V-D, % de victorias, goles y asistencias por partido y MVP. El Worker sirve `overlay.html` en esas direcciones (sin caché larga y fuera de los buscadores).
- **Ventana flotante** (uso personal): el mismo overlay en una ventana pequeña que se queda encima de las demás (y del juego, si está en ventana o ventana sin bordes), para ver tus últimas notas mientras juegas. En el perfil, «Ventana flotante», o desde el configurador del overlay con las opciones elegidas. Usa «Document Picture-in-Picture» (Chrome y Edge de ordenador); en los demás navegadores abre `/overlay/<id>?win` como ventana normal. El contenido se escala al tamaño de la ventana y se actualiza cada minuto mientras la pestaña de SlapScore siga abierta (`mountFloat` en `assets/overlay.js`).
- **Mi perfil**: cada visitante puede decir quién es («Soy yo» en su perfil, o el botón de la cabecera). Se guarda en su navegador (`slapscore-me`) y le da acceso directo a su perfil y la tarjeta «Tu resumen» en la portada (nota de sus últimos 10 partidos, última sesión, ventana flotante y «Mi semana»).
- **Resumen de sesión y de la semana** (`assets/insights.js`): en el perfil, la última sesión (partidos seguidos con menos de 75 minutos entre uno y otro: nota media, V-D, goles, asistencias, MMR ganado o perdido y mejor partido) y los últimos 7 días, cada uno con imagen para compartir (`summaryImage` en `share.js`); la de la semana lleva el puesto por nota media entre quienes han jugado 10 partidos o más.
- **Logros**: insignias por partidos, victorias, goles, asistencias, paradas, MVP, racha, mejor nota, goles y paradas en un partido, rango máximo, premios y supporter, con los tres siguientes más cercanos. Cuentan las partidas públicas. Las mejores marcas en un partido las guarda el robot en el perfil (`mx`) para que no se pierdan cuando el partido sale de la lista.
- **En racha** (`/on-fire`, `/en-racha`...): quién ha subido más de MMR y quién ha mejorado más su nota media en 7 días (los calcula el robot: `hot` en `data/top.json`) y las rachas de victorias en curso.
- **Notas de equipos** (pestaña de la EUSL): los equipos ordenados por la nota media de sus jugadores en públicas (plantillas de eusl.gg; cuentan los jugadores con 5 partidos o más y hacen falta dos).
- **Tutorial de bienvenida** (`assets/tour.js`): la primera vez que alguien entra desde un navegador, en la portada, un repaso de 8 pasos que ilumina cada parte de la web (partidos, días y filtros, buscador, favoritos y avisos, secciones, idioma y tema, Ko-fi). Se puede saltar (Esc o «Saltar») y se recuerda en el navegador (`slapscore-tour`); no sale a robots. Se vuelve a ver desde Novedades o con `?tutorial` en la dirección. El panel de tráfico cuenta los vistos enteros y los saltados.
- **Prioridad para quien apoye en Ko-fi**: con cualquier donación y el ID de jugador (o el enlace de su perfil) en el mensaje, `cloudflare/kofi.js` lo apunta como supporter: insignia ♥ y sus partidos se buscan en cada pasada. Se explica en la tarjeta de apoyo de la portada, en el tutorial, en Novedades y en el perfil de quien aún no es supporter («¿Es tu perfil?»). Además, a cada navegador le sale una vez un aviso con la explicación (`slapscore-kofi-note`), también a quien ya había entrado antes; quien lo vio en el tutorial no lo vuelve a ver, y si se saltó el tutorial le sale en otra visita.
- **Avisos en el móvil** (Web Push): con la campana, el navegador recibe un aviso cuando un favorito termina un partido o sube de rango. El robot deja los sucesos recientes en `data/events.json` y el Worker los manda cada 3 minutos desde el Durable Object `Push` (`cloudflare/push.js`), que genera sus propias claves VAPID. En iPhone solo funciona con la app instalada.
- **Favoritos** guardados en el navegador de cada uno (con la lista de hoy abierta, sale un aviso cuando un favorito termina un partido); buscador por nombre, ID o enlace de slapshot.gg (también de partido); atajo «/».
- **Buzón de sugerencias** (icono de bocadillo en la cabecera, enlace en el pie y recuadro en la portada): ideas, errores u otros, con contacto opcional. Los mensajes se guardan en Cloudflare y se leen y borran desde el panel de administrador.
- **Panel de tráfico** (pestaña «Tráfico» del administrador): personas conectadas ahora mismo, visitantes, visitas, páginas vistas, páginas por visita, tiempo medio y rebote comparados con el periodo anterior, gráfico por horas, días o meses, páginas y jugadores más vistos, de dónde vienen (también enlaces con `?ref=`), países, dispositivos, navegadores, sistemas, idiomas, páginas de entrada, fidelidad, acciones (compartir, favoritos, sugerencias, instalar la app) y cuándo entra la gente. Periodos: hoy, ayer, 7, 30 y 90 días y 12 meses; tabla y CSV.
- **Direcciones sin `#` y en cada idioma** (`assets/routes.js`): `/players`, `/jugadores`, `/joueurs`, `/spieler`, `/jogadores`, `/oyuncular`; `/player/<id>`, `/jugador/<id>`...; `/match/<día+hora>-<id>`, `/partido/...`; `/matches/<día>`; `/compare/<id>-<id>`; `/awards`, `/whats-new`, `/how-we-rate`, `/legal`... La web enseña siempre la dirección en el idioma de quien la ve y cambia sola las antiguas (`/#j-123`, `/j/123`, `/m/...`) y las de otro idioma. Quien entra sin haber elegido idioma ve la web en el de la dirección (`/jugador/123` en español). El Worker sirve la web en todas ellas con el título, la descripción y la imagen de esa página (vista previa en Discord, WhatsApp o Google), la dirección buena (`canonical`) y las de los otros idiomas (`hreflang`); las que no existen dan 404.
- Inglés por defecto, y también español, francés, alemán, portugués y turco (menú de idioma en la cabecera y lista en el pie). Tema claro y oscuro. Se instala como app en el móvil.

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
- `hiddenPlayers`: jugadores ocultos (IDs) que han pedido no aparecer. En sus partidos salen como «—», sin ID: se borran su perfil, sus totales y su nombre de todo lo publicado (también de los resúmenes de los días archivados) y no vuelven a salir. Se gestionan desde el panel (tarjeta «Jugadores ocultos»). Los partidos de hace más de 60 días que ya están en el archivo de GitHub no se tocan.
- `weights`: pesos de la nota que cambian respecto a los de `assets/core.js`. Al cambiarlos se recalculan las notas de los partidos no archivados.
- `retainDays`: días con el detalle completo en la web (por defecto 60).
- `support`: enlace de apoyo (Ko-fi, Patreon…). Si está, aparece un recuadro en la portada y un enlace en el pie.
- `discord`: invitación al servidor de Discord de la comunidad (`https://discord.gg/...`, que no caduque). Si está, sale un recuadro en la portada, un enlace en el pie, en el buzón de sugerencias y en Novedades. El panel de tráfico cuenta los clics. Además, a cada navegador le sale una vez un aviso del servidor (`slapscore-dc-note`), también a quien ya había entrado antes; solo sale un aviso por visita (tutorial, Ko-fi o Discord, en ese orden).
- `discordRoles`: roles de Discord a los que mencionan los avisos automáticos: `{ "totw": "<id del rol TOTW Ping>", "news": "<id del rol News Ping>" }`. Sin ellos, los avisos salen sin mención.
- `social`: redes sociales (ver «Redes sociales» más abajo): `{ "tiktok": true, "xLink": false, "tags": "#SlapshotRebound #SlapScore" }`. `tiktok`: prepara cada semana el kit (imagen y texto) para subirlo a mano. `xLink`: añade el enlace a la web en las publicaciones de X (en la API de X una publicación con enlace cuesta bastante más). `tags`: etiquetas de las publicaciones.
- `supporters`: IDs con la insignia ♥ puestos a mano. Los de **Ko-fi** van aparte y solos: Ko-fi avisa al Worker de cada apoyo (`/api/kofi`, con la clave de verificación que se pega en el panel); si el mensaje lleva el ID o el enlace del perfil, la insignia se pone sola, y si no, se asigna desde el panel. El robot baja esa lista en cada pasada.
- `home`: dirección nueva de la web si se muda; la de GitHub Pages redirige a ella.

Se pueden cambiar desde el panel de administrador, que usa un token de GitHub de grano fino con permisos de **Actions** y **Contents** en lectura y escritura sobre este repositorio. El token solo se guarda en el navegador de quien lo usa. El panel no se enlaza en la web: se entra por `/entrada-ibai` o, en la app instalada (que no tiene barra de direcciones), tocando 5 veces seguidas el logo de SlapScore. Con la sesión iniciada sale el botón del panel en la cabecera.

## Publicación en Cloudflare (gratis)

La web se publica en Cloudflare Workers, en https://slapscore.app y https://www.slapscore.app (dominios del Worker `slapscore`; workers.dev está desactivado y GitHub Pages ya no se usa). El flujo la publica en cada pasada con estos secretos (Settings › Secrets and variables › Actions):

- `CLOUDFLARE_API_TOKEN`: token de Cloudflare con la plantilla «Edit Cloudflare Workers».
- `CLOUDFLARE_ACCOUNT_ID`: el ID de la cuenta de Cloudflare.
- `DISPATCH_TOKEN` (opcional): token de GitHub de grano fino con **Actions: lectura y escritura** sobre este repositorio. Con él, el Worker (`cloudflare/worker.js`) comprueba cada 30 minutos que la cadena de pasadas sigue viva y, si se ha cortado, la relanza.

Los archivos estáticos los sirve Cloudflare sin pasar por el Worker (sin límite de tráfico) y solo se suben los que cambian. Las cabeceras de caché y de seguridad están en `_headers`.

**Buzón de sugerencias.** El Worker recibe los mensajes en `/api/feedback` y los guarda en un almacén KV `slapscore-feedback`, que el flujo crea solo la primera vez (el token de Cloudflare necesita **Workers KV Storage: Edit**, incluido en la plantilla «Edit Cloudflare Workers»). No se guarda la IP: solo un resumen cifrado de un minuto para frenar envíos en bucle, y como mucho 200 mensajes al día. Para leer o borrar mensajes el Worker pide el token de GitHub del panel y comprueba con GitHub que puede escribir en el repositorio.

**Estadísticas de visitas.** La web avisa al Worker de cada página vista (`/api/v`, con `fetch` y `keepalive`), del tiempo con la página a la vista y de algunas acciones. Se guardan en un Durable Object con SQLite (`cloudflare/stats.js`, clase `Stats`), que entra en el plan gratuito (100.000 filas escritas y 5 millones leídas al día: cada evento es una fila). Sin cookies ni identificadores en el navegador: las personas se cuentan con un resumen cifrado de IP + navegador con una sal que cambia cada mes y se borra, y la IP no se guarda. No cuentan los robots, los navegadores automáticos ni el administrador (al entrar en el panel, su navegador queda marcado para no contar). Cada día cerrado se resume en una fila; los eventos se guardan 400 días. El panel los pide a `/api/stats` con el token de GitHub, igual que el buzón.

## App en el móvil

SlapScore se puede instalar en la pantalla de inicio (Android: botón «Instalar»; iPhone: Compartir › Añadir a pantalla de inicio). Un service worker guarda la web y los datos ya vistos: como cada archivo se pide con la huella de su contenido (`?v=…`), lo que no ha cambiado sale al instante de la caché.

## Logos de rango

`assets/ranks/` tiene los logos oficiales de los 14 rangos (Bronze I a Legend, también Diamond), recortados de la captura «ALL RANKS» del juego (`tools/rangos-slapshot.png`) con `tools/cut-ranks.py`: 128 px y una versión de 64 px para los tamaños pequeños (`_small` en `assets/ranks/index.json`). Se pueden cambiar desde el panel de administrador; si falta alguno, se usa el emblema de SlapScore.

## Idioma

Los textos se escriben en español en el código y se traducen con `t()` (`assets/i18n.js`). Diccionarios: `assets/en.js` (inglés), `assets/fr.js`, `assets/de.js`, `assets/pt.js` (portugués de Brasil) y `assets/tr.js` (turco). Las claves son los textos en español; en francés, alemán, portugués y turco, lo que falte sale en inglés. Para añadir un idioma: su diccionario, `LANGS`, `LOC`, `LOAD` y `TEAM_LETTER` en `i18n.js`, sus direcciones en `routes.js`, `periodOrd` en `core.js`, los textos de los avisos en `cloudflare/push.js`, la lista de idiomas de `cloudflare/worker.js` y `cloudflare/preview.js` y el nombre del archivo en los `sed` del flujo de publicación. El aviso legal está en español y en inglés (los demás idiomas ven el inglés). Si añades un texto nuevo, ponlo al menos en `en.js`.

## Código

- `assets/core.js`: nota de los jugadores, normalización de partidos, rangos y formato de datos (lo comparten la web y el robot).
- `assets/app.js`, `assets/style.css`, `assets/emblems.js`: la web (los emblemas propios solo se usan si falta algún logo oficial).
- `assets/i18n.js`, `assets/en.js`: idioma (inglés por defecto).
- `assets/routes.js`: direcciones de cada página en cada idioma (lo usan la web y el Worker).
- `assets/share.js`: imágenes para compartir (se carga solo al usarlas).
- `crawler/eusl.js`: datos de la liga EUSL (API pública de eusl.gg).
- `tools/cut-ranks.py`: recorta los logos de rango de la captura oficial.
- `assets/admin.js`: panel de administrador.
- `assets/vendor/gunzip.js`: descompresor para navegadores antiguos ([fflate](https://github.com/101arrowz/fflate), MIT).
- `crawler/`: el robot.
- `cloudflare/worker.js`, `wrangler.toml`: publicación opcional en Cloudflare.

SlapScore no está afiliado a Oddshot Games.

## Avisos automáticos en Discord

El robot publica solo en el servidor de Discord (`crawler/discord.js`, paso «Avisos en Discord» de la pasada):

- **Equipo de la semana**: los lunes a partir de las 18:00 (hora de Madrid), con la misma imagen que hace la web en Premios.
- **Jugador del mes**: el día 1 a partir de las 18:00.
- **Novedades de la web**: cuando sube `NEWS_DATE` en `assets/news.js`, con el titular en inglés.

Usa webhooks (sin bot). Cada webhook es la dirección secreta de un canal y va en los secretos del repositorio
(Settings → Secrets and variables → Actions): `DISCORD_WEBHOOK_TOTW` (canal `#team-of-the-week`) y
`DISCORD_WEBHOOK_NEWS` (canal `#announcements`). Sin secretos no se publica nada. Lo ya publicado se apunta en
`data/_int/discord.json`; si un premio lleva más de 6 días sin publicarse, se da por visto. La primera vez, las novedades
no se publican (solo las que lleguen después). Para publicar algo a mano: «Run workflow» con `discord` = `totw`, `month` o `news`.

## Redes sociales

El robot publica también en las redes (`crawler/social.js`, paso «Redes sociales» de la pasada), a la misma hora que en
Discord (equipo de la semana los lunes a las 18:00 de Madrid; jugador del mes el día 1) y con la misma imagen de Premios,
en JPEG de 1080×1350. La imagen se guarda en `data/social/` y sale publicada con la web.

- **X (Twitter)**: imagen y texto, y además las novedades de la web como texto. Secretos `X_API_KEY`, `X_API_SECRET`,
  `X_ACCESS_TOKEN` y `X_ACCESS_SECRET` (los cuatro de la app en console.x.com, con permiso «Read and write»; no caducan).
  La API de X es de pago por uso: unos céntimos por publicación, y bastante más si el texto lleva un enlace (por eso `xLink`
  viene apagado: la dirección de la web ya sale en la imagen).
- **Instagram**: cuenta profesional y un token de la «API de Instagram con inicio de sesión de Instagram» con el permiso
  `instagram_business_content_publish`, en el secreto `IG_ACCESS_TOKEN`. Instagram descarga la imagen de la web, así que
  publica en la pasada siguiente a la que la prepara. El token dura 60 días: el robot lo renueva cada semana y, si al
  renovarlo cambia, lo guarda en el almacén privado de Cloudflare (clave `sys:social-ig` del KV del buzón).
- **TikTok**: su API solo deja publicar en público a aplicaciones auditadas y no admite herramientas para cuentas propias,
  así que no se publica solo. Con `social.tiktok` se prepara el kit (imagen y texto), que sale en el panel de administración
  («Redes sociales») con botones para copiar el texto y compartir la imagen desde el móvil. Con el secreto
  `DISCORD_WEBHOOK_STAFF` (webhook de un canal privado), el kit llega también a Discord.

Sin secretos no se publica nada. Lo publicado, los fallos y los textos se apuntan en `data/social/status.json` (público, sin
nada secreto). Cada publicación se intenta hasta 4 veces, con media hora entre intentos; si un premio lleva más de 6 días
sin publicarse, se da por visto. Las claves nunca se escriben en el registro. Para publicar algo a mano: «Run workflow» con
`social` = `totw`, `month` o `news`.
