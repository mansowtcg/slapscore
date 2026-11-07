// Novedades y funciones de SlapScore (página #novedades).
// Cada función: icono (de ICON en app.js), título, texto y adónde lleva. «nuevo» es la fecha en que llegó: durante
// 45 días sale arriba en «Lo último», con la etiqueta «Nuevo». Al añadir algo, pon su fecha y sube NEWS_DATE:
// a quien aún no lo haya visto le sale un punto en «Novedades» y un aviso en la portada.
// Los textos van en español y se traducen con t() (en.js, fr.js, de.js, pt.js).

export const NEWS_DATE = '2026-11-07';
// resumen de la última tanda, para el aviso de la portada
export const NEWS_HEADLINE = 'Nuevo: SlapScore en turco, un tutorial de bienvenida y prioridad para quien apoye en Ko-fi.';

export const GROUPS = [
  ['partidos', 'Partidos'],
  ['jugadores', 'Jugadores'],
  ['clasif', 'Clasificaciones'],
  ['ti', 'Para ti'],
  ['app', 'La app'],
];

export const FEATURES = [
  { g: 'partidos', icon: 'games', href: '#partidos', title: 'Partidos al momento', text: 'Todas las partidas públicas y custom de Slapshot: Rebound, con el resultado y la nota de cada jugador. Se actualiza sola cada 3-4 minutos.' },
  { g: 'partidos', icon: 'cal', href: '#partidos', title: 'Calendario y filtros', text: 'Salta a cualquier día y filtra por región, arena, tipo de partida o jugador. También puedes ver solo los destacados o tus favoritos.' },
  { g: 'partidos', icon: 'bolt', title: 'Ficha de cada partido', text: 'Estadísticas de cada jugador, alineaciones, comparativa de equipos, el MVP y cómo sale cada nota.' },
  { g: 'partidos', icon: 'vs', nuevo: '2026-11-05', title: 'Custom con periodos', text: 'Los periodos de un mismo partido custom se juntan en uno: marcador de cada periodo, estadísticas por periodo o del partido entero y la nota de cada periodo.' },
  { g: 'jugadores', icon: 'flame', href: '#notas', title: 'Notas de 3 a 10', text: 'Cada jugador recibe una nota en cada partido, calculada solo con sus estadísticas. El que más saca es el MVP.' },
  { g: 'jugadores', icon: 'users', href: '#jugadores', title: 'Perfil de cada jugador', text: 'Rango y MMR con su evolución, forma, notas por partido, atributos, mejores partidos, compañeros y rivales habituales y sus números en cada arena.' },
  { g: 'jugadores', icon: 'vs', href: '#jugadores', title: 'Comparar jugadores', text: 'Dos jugadores frente a frente: estadísticas por partido, atributos y cómo les va el uno contra el otro y jugando juntos.' },
  { g: 'jugadores', icon: 'search', href: '#jugadores', title: 'Tabla y buscador', text: 'Encuentra a cualquiera por su nombre, su ID o el enlace de su perfil, y ordena la tabla de jugadores por la columna que quieras.' },
  { g: 'clasif', icon: 'trophy', href: '#premios', nuevo: '2026-11-06', title: 'Premios', text: 'Equipo de la semana y jugador del mes por nota media, con su historial, una insignia en el perfil y una imagen para compartir.' },
  { g: 'clasif', icon: 'trophy', href: '#rankings', title: 'Rankings y récords', text: 'Los mejores de la comunidad en cada estadística, las mejores marcas en un partido y las rachas más largas.' },
  { g: 'clasif', icon: 'league', href: '#eusl', title: 'EUSL', text: 'Clasificación, resultados, próximos partidos y máximos goleadores de la European Slapshot League.' },
  { g: 'ti', icon: 'star', title: 'Favoritos', text: 'Marca jugadores con la estrella de su perfil para tener sus partidos a mano en la portada.' },
  { g: 'ti', icon: 'bell', nuevo: '2026-11-06', title: 'Avisos en el móvil', text: 'Con la campana te avisamos cuando un favorito termina un partido o sube de rango. En iPhone funciona con la app instalada.' },
  { g: 'ti', icon: 'share', nuevo: '2026-11-06', title: 'Enlaces con vista previa', text: 'Los jugadores y los partidos tienen su propio enlace: en Discord o WhatsApp sale con su nombre, su rango y sus estadísticas. También puedes compartir una imagen.' },
  { g: 'ti', icon: 'chat', nuevo: '2026-11-07', title: '6 idiomas', text: 'English, Español, Français, Deutsch, Português y Türkçe. Se cambia en el menú de idioma de arriba.' },
  { g: 'app', icon: 'install', title: 'Instálala como app', text: 'Añádela a la pantalla de inicio del móvil o al ordenador y ábrela como una app más.' },
  { g: 'app', icon: 'theme', title: 'Tema claro y oscuro', text: 'Sigue al de tu dispositivo, o elige el que prefieras con el botón de la luna.' },
  { g: 'app', icon: 'chat', action: 'feedback', title: 'Buzón de sugerencias', text: 'Cuéntanos ideas o fallos: lo lee la persona que hace SlapScore.' },
  { g: 'app', icon: 'coffee', action: 'support', nuevo: '2026-11-07', title: 'Prioridad para quien apoye', text: 'SlapScore es gratis y sin anuncios. Con cualquier donación en Ko-fi, aunque sea simbólica, y tu ID de jugador en el mensaje, tus partidos se cargan antes y llevas la insignia ♥ Supporter.' },
  { g: 'app', icon: 'info', action: 'tour', nuevo: '2026-11-07', title: 'Tutorial de bienvenida', text: 'Un repaso rápido de todo lo que hay en SlapScore, en menos de un minuto.' },
  { g: 'app', icon: 'info', href: '#legal', title: 'Sin cookies ni anuncios', text: 'Las visitas se cuentan de forma anónima, sin guardar tu IP ni ponerte identificadores.' },
];
