# SlapScore

Resultados, estadísticas completas y notas estilo SofaScore de los partidos de **Slapshot: Rebound**.

Web: https://mansowtcg.github.io/slapscore/

## Cómo funciona

- `crawler/crawl.mjs` consulta los perfiles públicos de slapshot.gg (`/api/game/players/ID` y `/ranked`). Cada perfil da los últimos 10 partidos del jugador y su rango/MMR.
- Cada jugador que aparece en un partido se añade a la lista de rastreo; los más activos se revisan más a menudo.
- Respeta el límite de slapshot.gg: como mucho 9 peticiones por minuto.
- `.github/workflows/crawl.yml` lo ejecuta cada 30 minutos, guarda los datos en `data/` y publica la web en GitHub Pages.

## Datos

- `data/matches/AAAA-MM.json`: partidos tal cual los da slapshot.gg, agrupados por mes.
- `data/players.json`: jugadores conocidos (nombre, MMR, rango, última vez visto…).
- `data/seeds.json`: IDs por los que empieza el rastreo. Añade aquí cualquier ID de slapshot.gg (7 cifras) para que se rastree con prioridad.

## Nota de los jugadores

Base 6,0; cada acción suma o resta (goles, asistencias, pases, paradas, robos, pérdidas, posesión…), más victoria/derrota y goles encajados. En 2v2 y 1v1 las acciones pesan menos. Los pesos están en `index.html` (objeto `W`) y se explican en la sección «Cómo puntuamos» de la web.

SlapScore no está afiliado a Oddshot Games.
