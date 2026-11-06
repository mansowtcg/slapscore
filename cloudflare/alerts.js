// Avisos por email al administrador si la web deja de actualizarse.
// El Worker lo comprueba en cada aviso del reloj (dos veces por hora): si los datos de la web tienen más de 45 minutos
// (el robot publica cada 3-4 minutos), manda un email; recuerda cada 12 horas mientras siga así y avisa cuando se arregle.
// El correo sale de avisos@slapscore.app con el enlace «send_email» de Cloudflare, que solo puede escribir a direcciones
// verificadas en el reenvío de correo (Email Routing) de la cuenta. La dirección se elige en el panel de administrador
// y se guarda en el KV del buzón (no está en el repositorio, que es público).

const KEY = 'sys:alerts';
const STALE_MIN = 45, REMIND_MS = 12 * 3600_000;
const FROM = 'avisos@slapscore.app';
const SITE = 'https://slapscore.app';

export const okEmail = (e) => /^[^\s@<>"',;:\\()[\]]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i.test(String(e || ''));
export async function getAlerts(env) {
  if (!env.FEEDBACK) return {};
  try { return JSON.parse((await env.FEEDBACK.get(KEY)) || '{}') || {}; } catch { return {}; }
}
export async function putAlerts(env, s) { if (env.FEEDBACK) await env.FEEDBACK.put(KEY, JSON.stringify(s)); }

const b64 = (s) => { let bin = ''; new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
export function buildMail(to, subject, text, now = new Date()) {
  return [
    `From: SlapScore <${FROM}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${now.toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@slapscore.app>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    b64(text).replace(/.{76}/g, '$&\r\n'), '',
  ].join('\r\n');
}
export async function sendMail(env, to, subject, text) {
  if (!env.MAIL) throw new Error('El envío de emails no está activado en Cloudflare.');
  if (!okEmail(to)) throw new Error('La dirección no es válida.');
  const EmailMessage = env.__EmailMessage || (await import('cloudflare:email')).EmailMessage;   // (__EmailMessage: solo en las pruebas)
  await env.MAIL.send(new EmailMessage(FROM, to, buildMail(to, subject, text)));
}

const madrid = (t) => new Date(t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dur = (min) => (min < 90 ? `${Math.round(min)} minutos` : min < 48 * 60 ? `${Math.round(min / 60)} horas` : `${Math.round(min / 1440)} días`);

// ¿Está bien la web? Devuelve '' si todo va bien o el problema en una frase.
export async function diagnose(env, now = Date.now()) {
  try {
    const r = await env.ASSETS.fetch(new Request(SITE + '/data/index.json'));
    if (!r.ok) return `La web no encuentra sus datos (error ${r.status}).`;
    const j = await r.json();
    const t = Date.parse(j && j.updated);
    const age = (now - t) / 60000;
    if (!(age < STALE_MIN)) return `Los partidos llevan ${Number.isFinite(age) ? dur(age) : 'un rato'} sin actualizarse (última actualización: ${Number.isFinite(t) ? madrid(t) : '¿?'}).`;
    const h = await env.ASSETS.fetch(new Request(SITE + '/'));
    if (!h.ok) return `La portada responde con un error ${h.status}.`;
    return '';
  } catch (e) { return `No se pudo comprobar la web (${String(e && e.message || e).slice(0, 120)}).`; }
}

const HELP = `Qué mirar:\n· Las pasadas del robot: https://github.com/mansowtcg/slapscore/actions\n· Si alguna sale en rojo, ábrela y mira el paso que falla.\n· Desde el panel de administrador puedes lanzar una pasada con «Traer partidos ahora».`;

export async function checkHealth(env, now = Date.now()) {
  const s = await getAlerts(env);
  const problem = await diagnose(env, now);
  const prev = { ...s };
  s.checked = now; s.problem = problem;
  if (s.email && okEmail(s.email)) {
    try {
      if (problem) {
        if (!s.down) { s.down = now; s.sent = 0; }
        if (!s.sent || now - s.sent > REMIND_MS) {
          await sendMail(env, s.email, s.sent ? 'SlapScore sigue sin actualizarse' : 'SlapScore no se está actualizando',
            `${problem}\n\nLo detectó el aviso automático de SlapScore (${madrid(now)}).\n\n${HELP}\n\nTe volveré a avisar cada 12 horas mientras siga así, y cuando se arregle.`);
          s.sent = now;
        }
      } else if (s.down) {
        if (s.sent) await sendMail(env, s.email, 'SlapScore vuelve a funcionar', `Todo en orden otra vez: la web se está actualizando.\nEstuvo parada unos ${dur((now - s.down) / 60000)}.`);
        s.down = 0; s.sent = 0;
      }
      s.err = '';
    } catch (e) { s.err = String(e && e.message || e).slice(0, 200); }
  } else if (!problem) { s.down = 0; s.sent = 0; }
  // solo se escribe si algo cambia o cada hora (el KV gratuito admite 1000 escrituras al día)
  if (prev.problem !== s.problem || prev.down !== s.down || prev.sent !== s.sent || prev.err !== s.err || !prev.checked || now - prev.checked > 3500_000) await putAlerts(env, s);
  return s;
}
