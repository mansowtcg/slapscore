// Aviso legal, privacidad y almacenamiento local (#legal). En español y en inglés.
// Si cambia algo de lo que se cuenta aquí (datos, proveedores, plazos), actualizar también UPDATED.
export const UPDATED = { es: '5 de noviembre de 2026', en: '5 November 2026' };
const OWNER = 'Ibai Manso';
const MAIL = 'contact@slapscore.app';
const mail = `<a href="mailto:${MAIL}">${MAIL}</a>`;

const ES = {
  title: 'Aviso legal y privacidad',
  lead: `Quién está detrás de SlapScore, qué datos se usan, para qué y cómo pedir que se borren. Última actualización: ${UPDATED.es}.`,
  sections: [
    ['titular', 'Quién está detrás', `
      <p>SlapScore (<b>slapscore.app</b>) es un proyecto personal, gratuito y sin publicidad de <b>${OWNER}</b>, que es el responsable de la web y de los datos que se tratan en ella. Contacto: ${mail}.</p>
      <p>SlapScore no está afiliado, patrocinado ni respaldado por Oddshot Games ni por slapshot.gg. Slapshot: Rebound, sus nombres, logotipos y emblemas de rango pertenecen a sus titulares y aquí solo se usan para identificar el juego. Los datos de la liga EUSL vienen de eusl.gg.</p>`],
    ['partidos', 'Datos de los partidos y de los jugadores', `
      <p>La web muestra resultados y estadísticas públicas de partidas de Slapshot: Rebound que publica slapshot.gg: el nombre de usuario y el identificador de cada jugador, su rango y las estadísticas de cada partido. Las notas son un cálculo propio a partir de esas estadísticas (ver <a href="#notas">Cómo puntuamos</a>), no una opinión sobre nadie.</p>
      <ul><li><b>Para qué:</b> resultados, estadísticas, perfiles, rankings, récords y comparativas.</li>
      <li><b>Base legal:</b> interés legítimo (art. 6.1.f del RGPD) en ofrecer información estadística sobre un juego cuyos datos ya son públicos.</li>
      <li><b>Cuánto tiempo:</b> el detalle completo de cada partido se muestra 60 días; después quedan sus resúmenes y una copia del partido completo en el archivo público del repositorio de GitHub de SlapScore. Cada perfil muestra los últimos 400 partidos.</li></ul>
      <p>Si eres jugador y no quieres aparecer, mira <a href="#legal" data-legal-go="jugadores">más abajo</a>.</p>`],
    ['visitas', 'Visitas a la web', `
      <p>Para saber cuánta gente usa SlapScore se cuentan las visitas <b>sin cookies y sin guardar la IP</b>. Por cada página vista se anota la página, la hora, el país aproximado (lo indica Cloudflare), el tipo de dispositivo, el nombre del navegador y del sistema, el idioma, la web desde la que llegas y algunas acciones (compartir, favoritos, sugerencias, instalar la app).</p>
      <p>Para no contar dos veces a la misma persona se usa un resumen cifrado de la IP y el navegador con una clave que cambia cada mes y se borra: con él no se puede saber quién eres ni seguirte de un mes a otro.</p>
      <ul><li><b>Base legal:</b> interés legítimo en medir el uso de la web de forma anónima para mejorarla.</li>
      <li><b>Cuánto tiempo:</b> los eventos, 400 días; después solo quedan totales por día.</li>
      <li>Si tu navegador envía la señal <b>No rastrear</b> (Do Not Track) o <b>Global Privacy Control</b>, no se cuenta nada.</li></ul>`],
    ['buzon', 'Buzón de sugerencias y correo', `
      <p>Si escribes en el buzón se guarda tu mensaje, su tipo, la página desde la que lo envías, el idioma y, solo si lo pones, tu forma de contacto. Para frenar envíos en bucle se tiene en cuenta tu conexión durante unos minutos, sin guardar la IP con el mensaje. Los mensajes se borran como mucho al año.</p>
      <p>Los correos a ${mail} se reenvían al correo personal del responsable (Gmail).</p>
      <ul><li><b>Base legal:</b> tu consentimiento, al enviarlo. Puedes pedir que se borre cuando quieras.</li>
      <li>Si tienes menos de 14 años, no pongas datos de contacto en el buzón.</li></ul>`],
    ['cookies', 'Cookies y almacenamiento local', `
      <p>SlapScore <b>no usa cookies</b> ni herramientas de publicidad o seguimiento de terceros. Solo guarda en tu navegador lo necesario para funciones que tú usas: idioma, tema claro u oscuro, favoritos, filtros, el borrador del buzón y, si eres el administrador, su sesión. También guarda una copia de la web para que cargue rápido y funcione sin conexión.</p>
      <p>Esto no necesita tu consentimiento (art. 22.2 de la LSSI) y puedes borrarlo cuando quieras desde los ajustes de tu navegador. Las fuentes tipográficas se sirven desde la propia web.</p>`],
    ['proveedores', 'Proveedores', `
      <ul><li><b>Cloudflare, Inc.</b> (EE. UU.): alojamiento, red, DNS, contador de visitas, buzón y reenvío del correo.</li>
      <li><b>GitHub, Inc.</b> (EE. UU.): código de la web, datos públicos de los partidos y su archivo.</li>
      <li><b>Google</b> (Gmail): recibe los correos enviados a ${MAIL}.</li></ul>
      <p>Las transferencias fuera del Espacio Económico Europeo se amparan en el Marco de Privacidad de Datos UE-EE. UU. o en las cláusulas contractuales tipo de la Comisión Europea, según el proveedor. slapshot.gg y eusl.gg son las fuentes de los datos públicos y no reciben nada de tus visitas. No se venden ni se ceden datos a nadie.</p>`],
    ['derechos', 'Tus derechos', `
      <p>Puedes pedir acceso, rectificación, supresión, oposición, limitación o portabilidad de tus datos escribiendo a ${mail}. Se responde en un mes como máximo. Si no estás conforme con la respuesta, puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es" target="_blank" rel="noopener">aepd.es</a>).</p>`],
    ['jugadores', 'Si eres jugador y no quieres aparecer', `
      <p>Escribe a ${mail} con tu nombre de usuario y el enlace a tu perfil (por ejemplo, <code>slapscore.app/#j-123456</code>). En un mes como máximo se ocultarán tu perfil y tus estadísticas y tu nombre dejará de mostrarse.</p>`],
    ['uso', 'Condiciones de uso', `
      <p>La información se ofrece tal cual, sin garantía de que sea exacta o completa: puede haber errores o partidos que falten. No uses la web ni su API para hacer peticiones masivas o automatizadas. El código y el diseño de SlapScore son de su titular; los datos, de sus fuentes. Se aplica la legislación española.</p>
      <p>¿Has encontrado un fallo de seguridad? Escribe a ${mail} (también en <a href="/.well-known/security.txt">security.txt</a>).</p>`],
  ],
};

const EN = {
  title: 'Legal notice and privacy',
  lead: `Who runs SlapScore, what data is used, why, and how to have it removed. Last updated: ${UPDATED.en}.`,
  sections: [
    ['titular', 'Who runs it', `
      <p>SlapScore (<b>slapscore.app</b>) is a free, ad-free personal project by <b>${OWNER}</b>, who is responsible for the site and the data processed on it. Contact: ${mail}.</p>
      <p>SlapScore is not affiliated with, sponsored or endorsed by Oddshot Games or slapshot.gg. Slapshot: Rebound and its names, logos and rank emblems belong to their owners and are used here only to identify the game. EUSL league data comes from eusl.gg.</p>`],
    ['partidos', 'Match and player data', `
      <p>The site shows public Slapshot: Rebound results and stats published by slapshot.gg: each player's username and ID, their rank and the stats of each match. Ratings are our own calculation from those stats (see <a href="#notas">How we rate</a>), not an opinion about anyone.</p>
      <ul><li><b>Why:</b> results, stats, profiles, rankings, records and comparisons.</li>
      <li><b>Legal basis:</b> legitimate interest (Art. 6(1)(f) GDPR) in providing statistics about a game whose data is already public.</li>
      <li><b>How long:</b> full match details are shown for 60 days; after that their summaries remain, and a copy of the full match is kept in the public archive of SlapScore's GitHub repository. Each profile shows the last 400 matches.</li></ul>
      <p>If you are a player and don't want to appear, see <a href="#legal" data-legal-go="jugadores">below</a>.</p>`],
    ['visitas', 'Visits to the site', `
      <p>To know how many people use SlapScore, visits are counted <b>without cookies and without storing your IP</b>. For each page view we record the page, the time, the approximate country (provided by Cloudflare), the device type, the browser and system name, the language, the site you came from and a few actions (share, favourites, feedback, installing the app).</p>
      <p>To avoid counting the same person twice, an encrypted digest of the IP and browser is used, with a key that changes every month and is then deleted: it cannot tell who you are or follow you from one month to the next.</p>
      <ul><li><b>Legal basis:</b> legitimate interest in measuring site usage anonymously to improve it.</li>
      <li><b>How long:</b> events, 400 days; after that only daily totals remain.</li>
      <li>If your browser sends <b>Do Not Track</b> or <b>Global Privacy Control</b>, nothing is counted.</li></ul>`],
    ['buzon', 'Feedback box and email', `
      <p>If you write in the feedback box, we store your message, its type, the page you sent it from, the language and, only if you add it, your contact. To stop spam loops your connection is taken into account for a few minutes, without storing the IP with the message. Messages are deleted after one year at the latest.</p>
      <p>Emails to ${mail} are forwarded to the owner's personal mailbox (Gmail).</p>
      <ul><li><b>Legal basis:</b> your consent, when you send it. You can ask for it to be deleted at any time.</li>
      <li>If you are under 14, don't include contact details in the feedback box.</li></ul>`],
    ['cookies', 'Cookies and local storage', `
      <p>SlapScore <b>does not use cookies</b> or third-party advertising or tracking tools. It only stores in your browser what is needed for features you use: language, light or dark theme, favourites, filters, the feedback draft and, for the administrator, their session. It also keeps a copy of the site so it loads fast and works offline.</p>
      <p>This doesn't require consent (Art. 22.2 of Spain's LSSI) and you can clear it at any time in your browser settings. Fonts are served from the site itself.</p>`],
    ['proveedores', 'Providers', `
      <ul><li><b>Cloudflare, Inc.</b> (USA): hosting, network, DNS, visit counter, feedback box and email forwarding.</li>
      <li><b>GitHub, Inc.</b> (USA): the site's code, public match data and its archive.</li>
      <li><b>Google</b> (Gmail): receives emails sent to ${MAIL}.</li></ul>
      <p>Transfers outside the European Economic Area rely on the EU-US Data Privacy Framework or on the European Commission's standard contractual clauses, depending on the provider. slapshot.gg and eusl.gg are the sources of the public data and receive nothing from your visits. No data is sold or shared with anyone.</p>`],
    ['derechos', 'Your rights', `
      <p>You can ask for access, rectification, erasure, objection, restriction or portability of your data by writing to ${mail}. We reply within one month at the latest. If you are not satisfied, you can complain to the Spanish Data Protection Agency (<a href="https://www.aepd.es" target="_blank" rel="noopener">aepd.es</a>) or your local authority.</p>`],
    ['jugadores', 'If you are a player and don’t want to appear', `
      <p>Write to ${mail} with your username and a link to your profile (for example <code>slapscore.app/#j-123456</code>). Within one month your profile and stats will be hidden and your name will no longer be shown.</p>`],
    ['uso', 'Terms of use', `
      <p>Information is provided as is, with no guarantee that it is accurate or complete: there may be errors or missing matches. Don't use the site or its API for bulk or automated requests. SlapScore's code and design belong to its owner; the data belongs to its sources. Spanish law applies.</p>
      <p>Found a security issue? Write to ${mail} (also in <a href="/.well-known/security.txt">security.txt</a>).</p>`],
  ],
};

export function render(lang) {
  const L = lang === 'en' ? EN : ES;
  return `<h1 class="h1 in">${L.title}</h1><p class="lead">${L.lead}</p>
    <nav class="legal-toc in" aria-label="${lang === 'en' ? 'Contents' : 'Contenido'}">${L.sections.map(([id, h]) => `<a href="#legal" data-legal-go="${id}">${h}</a>`).join('')}</nav>
    <div class="legal">${L.sections.map(([id, h, body]) => `<section class="card in" id="lg-${id}"><div class="card-h"><h2>${h}</h2></div><div class="card-b">${body}</div></section>`).join('')}</div>`;
}
