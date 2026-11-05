// SlapScore en Cloudflare Workers.
// La web son archivos estáticos (los sirve Cloudflare sin pasar por aquí). Este Worker solo:
//  1) responde a las rutas que no son un archivo (404),
//  2) recibe el buzón de sugerencias (/api/feedback) y se lo enseña al administrador,
//  3) cuenta las visitas (/api/v) y le enseña las estadísticas al administrador (/api/stats), y
//  4) cada 30 minutos comprueba que el robot sigue en marcha: las pasadas van encadenadas
//     (cada una deja en cola la siguiente) y, si la cadena se ha cortado, la vuelve a lanzar.
//
// Buzón: los mensajes se guardan en el KV "FEEDBACK" (lo crea el flujo de GitHub al publicar).
// No se guarda la IP: solo un resumen cifrado de un minuto para frenar envíos en bucle.
// Para leerlos o borrarlos hace falta el token de GitHub del administrador, que se comprueba con GitHub
// (tiene que poder escribir en el repositorio).
//
// Visitas: se guardan en el Durable Object "Stats" (stats.js), sin cookies ni IP. Ver la explicación allí.

import { Stats, cleanHit, BOT } from './stats.js';
export { Stats };

const TYPES = new Set(['idea', 'bug', 'other']);
const MAX_TEXT = 2000, MAX_CONTACT = 120, MAX_PAGE = 300, LIST_LIMIT = 300;
const DEFAULT_ORIGINS = ['https://slapscore.app', 'https://www.slapscore.app'];
const adminCache = new Map();   // resumen del token -> caduca (ms), para no preguntar a GitHub en cada petición

function allowedOrigin(request, env) {
  const o = request.headers.get('origin');
  if (!o) return null;
  const self = new URL(request.url).origin;
  const list = String(env.ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return o === self || DEFAULT_ORIGINS.includes(o) || list.includes(o) ? o : null;
}
function json(data, status, request, env, extra = {}) {
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra };
  const o = allowedOrigin(request, env);
  if (o) { h['access-control-allow-origin'] = o; h.vary = 'Origin'; }
  return new Response(JSON.stringify(data), { status, headers: h });
}
async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
// sin caracteres de control ni de dirección del texto (con ellos un mensaje podría mostrarse cambiado en el panel)
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim().slice(0, max);
// IP para los límites: en IPv6, la red /64 (cada conexión de casa tiene millones de direcciones)
const ipKey = (ip) => (String(ip).includes(':') ? String(ip).toLowerCase().split(':').slice(0, 4).join(':') : String(ip));
const MAX_BODY = 8192;
const tooBig = (request) => Number(request.headers.get('content-length') || 0) > MAX_BODY;
const failCache = new Map();   // tokens rechazados hace poco: no se vuelve a preguntar a GitHub en 1 minuto

// ¿Es este token de GitHub de alguien que puede escribir en el repositorio?
async function isAdmin(request, env) {
  const m = /^Bearer\s+(\S{20,300})$/.exec(request.headers.get('authorization') || '');
  if (!m || !env.GH_REPO) return false;
  const key = await sha(m[1]);
  const until = adminCache.get(key);
  if (until && until > Date.now()) return true;
  const failed = failCache.get(key);
  if (failed && failed > Date.now()) return false;
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}`, {
    headers: { authorization: `Bearer ${m[1]}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'slapscore-feedback' },
  }).catch(() => null);
  if (!r || !r.ok) return false;
  const j = await r.json().catch(() => null);
  const ok = !!(j && j.permissions && (j.permissions.push || j.permissions.admin));
  if (ok) adminCache.set(key, Date.now() + 5 * 60_000);
  else failCache.set(key, Date.now() + 60_000);
  if (adminCache.size > 50) adminCache.delete(adminCache.keys().next().value);
  if (failCache.size > 500) failCache.clear();
  return ok;
}

async function feedback(request, env, path) {
  const cors = {
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  };
  if (request.method === 'OPTIONS') {
    const o = allowedOrigin(request, env);
    return new Response(null, { status: 204, headers: o ? { 'access-control-allow-origin': o, vary: 'Origin', ...cors } : {} });
  }
  const KV = env.FEEDBACK;
  if (!KV) return json({ error: 'unavailable' }, 503, request, env);

  // enviar una sugerencia (cualquiera)
  if (request.method === 'POST' && path === '/api/feedback') {
    if (!allowedOrigin(request, env)) return json({ error: 'origin' }, 403, request, env);
    if (tooBig(request)) return json({ error: 'bad' }, 413, request, env);
    let b;
    try { b = JSON.parse((await request.text()).slice(0, MAX_BODY)); } catch { return json({ error: 'bad' }, 400, request, env); }
    if (!b || typeof b !== 'object') return json({ error: 'bad' }, 400, request, env);
    if (b.website) return json({ ok: true }, 200, request, env);   // campo trampa: solo lo rellenan los robots
    const type = TYPES.has(b.type) ? b.type : 'other';
    const text = clean(b.text, MAX_TEXT);
    if (text.length < 5) return json({ error: 'short' }, 400, request, env);
    // límites (1 por minuto y 5 al día por conexión, 200 al día en total): los lleva el Durable Object, de uno en uno,
    // para que no se puedan saltar mandando muchos a la vez
    if (env.STATS) {
      const r = await statsStub(env).fetch('https://stats/fb', { method: 'POST', body: JSON.stringify({ ip: ipKey(request.headers.get('cf-connecting-ip') || '') }) }).catch(() => null);
      const v = r ? await r.json().catch(() => null) : null;
      if (!v || !v.ok) return json({ error: v && v.error === 'full' ? 'full' : 'wait' }, 429, request, env);
    }
    const t = Date.now();
    const id = `fb:${String(9999999999999 - t).padStart(13, '0')}-${crypto.randomUUID().slice(0, 8)}`;
    const item = {
      t, type, text,
      contact: clean(b.contact, MAX_CONTACT),
      page: clean(b.page, MAX_PAGE),
      lang: b.lang === 'en' ? 'en' : 'es',
    };
    // los mensajes se borran solos al año
    try { await KV.put(id, JSON.stringify(item), { expirationTtl: 365 * 86400 }); } catch { return json({ error: 'unavailable' }, 503, request, env); }
    return json({ ok: true }, 200, request, env);
  }

  // leer y borrar: solo el administrador
  if (request.method === 'GET' && path === '/api/feedback') {
    if (!(await isAdmin(request, env))) return json({ error: 'auth' }, 401, request, env);
    const keys = []; let cursor;
    do {
      const page = await KV.list({ prefix: 'fb:', cursor, limit: 1000 });
      keys.push(...page.keys.map((k) => k.name)); cursor = page.list_complete ? null : page.cursor;
    } while (cursor && keys.length < LIST_LIMIT);
    const items = (await Promise.all(keys.slice(0, LIST_LIMIT).map(async (k) => {
      const v = await KV.get(k); if (!v) return null;
      try { return { id: k, ...JSON.parse(v) }; } catch { return null; }
    }))).filter(Boolean);
    return json({ items, total: keys.length }, 200, request, env);
  }
  const del = /^\/api\/feedback\/(fb:[0-9]{13}-[0-9a-f]{8})$/.exec(path);
  if (request.method === 'DELETE' && del) {
    if (!(await isAdmin(request, env))) return json({ error: 'auth' }, 401, request, env);
    try { await KV.delete(del[1]); } catch { return json({ error: 'unavailable' }, 503, request, env); }
    return json({ ok: true }, 200, request, env);
  }
  return json({ error: 'not found' }, 404, request, env);
}

// ---------- visitas ----------
const statsStub = (env) => env.STATS.get(env.STATS.idFromName('main'));
function preflight(request, env, methods, headers) {
  const o = allowedOrigin(request, env);
  return new Response(null, { status: 204, headers: o ? { 'access-control-allow-origin': o, vary: 'Origin', 'access-control-allow-methods': methods, 'access-control-allow-headers': headers, 'access-control-max-age': '86400' } : {} });
}
// La web manda cada página vista con fetch keepalive (texto JSON, sin cookies). Se responde enseguida y se guarda por detrás.
async function visit(request, env, ctx) {
  if (request.method === 'OPTIONS') return preflight(request, env, 'POST, OPTIONS', 'content-type');
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const o = allowedOrigin(request, env);
  if (!o) return new Response(null, { status: 403 });
  const h = { 'access-control-allow-origin': o, vary: 'Origin', 'cache-control': 'no-store' };
  const ua = request.headers.get('user-agent') || '';
  if (!env.STATS || !ua || BOT.test(ua) || tooBig(request)) return new Response(null, { status: 204, headers: h });
  let b = null;
  try { b = JSON.parse((await request.text()).slice(0, 2000)); } catch {}
  const ip = request.headers.get('cf-connecting-ip') || '';
  const d = cleanHit(b, { ip, ua, cc: request.cf && request.cf.country });
  if (d) d.rk = ipKey(ip);   // solo para el límite por conexión (no se guarda)
  if (d) {
    const p = statsStub(env).fetch('https://stats/hit', { method: 'POST', body: JSON.stringify(d) }).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  }
  return new Response(null, { status: 204, headers: h });
}
async function stats(request, env) {
  if (request.method === 'OPTIONS') return preflight(request, env, 'GET, DELETE, OPTIONS', 'authorization');
  if (request.method !== 'GET' && request.method !== 'DELETE') return json({ error: 'method' }, 405, request, env);
  if (!env.STATS) return json({ error: 'unavailable' }, 503, request, env);
  if (!(await isAdmin(request, env))) return json({ error: 'auth' }, 401, request, env);
  // DELETE: quita las visitas de hoy del navegador del administrador (mismo resumen de IP + navegador)
  const r = request.method === 'DELETE'
    ? await statsStub(env).fetch('https://stats/forget', { method: 'POST', body: JSON.stringify({ id: (request.headers.get('cf-connecting-ip') || '') + '|' + (request.headers.get('user-agent') || '') }) })
    : await statsStub(env).fetch('https://stats/stats?range=' + encodeURIComponent(new URL(request.url).searchParams.get('range') || '7d'));
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  const o = allowedOrigin(request, env); if (o) { h['access-control-allow-origin'] = o; h.vary = 'Origin'; }
  return new Response(await r.text(), { status: r.status, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    let path = '';
    try { path = decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/, ''); } catch { return new Response('Bad request', { status: 400 }); }
    if (path === '/api/v') return visit(request, env, ctx);
    if (path === '/api/stats') return stats(request, env);
    if (path === '/api/feedback' || path.startsWith('/api/feedback/')) return feedback(request, env, path);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env) {
    if (!env.GH_DISPATCH_TOKEN || !env.GH_REPO) return;
    const api = `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/crawl.yml`;
    const headers = {
      authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'slapscore-cron',
    };
    // ¿Hay alguna pasada en marcha, en cola o de hace menos de 15 minutos? Entonces la cadena funciona.
    const r = await fetch(`${api}/runs?per_page=5`, { headers });
    if (r.ok) {
      const runs = (await r.json()).workflow_runs || [];
      const alive = runs.some((x) => x.status !== 'completed' || Date.now() - Date.parse(x.updated_at) < 15 * 60_000);
      if (alive) return;
    }
    const d = await fetch(`${api}/dispatches`, { method: 'POST', headers, body: JSON.stringify({ ref: 'main', inputs: { minutes: '3', chain: '1' } }) });
    if (!d.ok) console.log(`GitHub respondió ${d.status}: ${(await d.text()).slice(0, 300)}`);
  },
};
