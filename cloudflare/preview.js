// Vista previa de los enlaces de jugadores y partidos (Discord, WhatsApp, Google...).
// Las direcciones bonitas /j/<id> y /m/<día+hora>-<id> no son archivos, así que llegan al Worker: devuelve la misma
// web (index.html) pero con su título, descripción e imagen en las etiquetas <meta>. Los robots de las redes leen
// esas etiquetas; las personas ven la web normal (la app entiende esas direcciones). Va en inglés, como la web por defecto.
import { bucketOf, aggObj } from '../assets/core.js';

const SITE = 'https://slapscore.app';
const TIER = { BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold', PLAT: 'Platinum', DIAMOND: 'Diamond', LEGEND: 'Legend' };
const TYPE = { casual: 'Public match', ranked: 'Ranked match', custom: 'Custom match', private: 'Private match', tournament: 'Tournament match', league: 'League match' };
export const rankName = (rk) => { const [t, n] = String(rk || '').split('_'); return TIER[t] ? TIER[t] + (n ? ' ' + n : '') : ''; };
const region = (r) => String(r || '').split('-').map((x) => (x.length <= 3 ? x.toUpperCase() : x[0].toUpperCase() + x.slice(1))).join(' ');
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const int = (n) => Math.round(n).toLocaleString('en-US');
const date = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' });
const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// sin caracteres de control ni de dirección del texto (los nombres de jugador los escribe cualquiera)
const tidy = (s, max = 300) => String(s ?? '').replace(/[\u0000-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export function parsePath(path) {
  let m = /^\/j\/(\d{1,12})$/.exec(path);
  if (m) return { kind: 'player', pid: m[1] };
  m = /^\/m\/(\d{4})(\d{2})(\d{2})(\d{2})-([0-9a-f-]{8,64})$/i.exec(path);
  if (m) return { kind: 'match', d: `${m[1]}-${m[2]}-${m[3]}`, hh: m[4], id: m[5].toLowerCase() };
  return null;
}

async function asset(env, path) {
  const r = await env.ASSETS.fetch(new Request(SITE + path));
  return r.ok ? r : null;
}
async function gzJSON(env, path) {
  const r = await asset(env, path); if (!r) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf));
  return JSON.parse(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
const inChunk = (c, hh) => c === 'all' || c === hh || (c.includes('-') && hh <= c.slice(0, 2) && hh >= c.slice(3, 5));

async function rankImage(env, rk) {
  if (!rk) return null;
  const r = await asset(env, '/assets/ranks/index.json'); if (!r) return null;
  const idx = await r.json().catch(() => null);
  const f = idx && (idx[rk] || idx[String(rk).split('_')[0]]);
  return f && /^[\w.-]+\.png$/.test(f) ? `${SITE}/assets/ranks/${f}` : null;
}

// ¿Está este jugador en SlapScore? (tiene perfil guardado)
export async function playerExists(env, pid) {
  if (!/^\d{1,12}$/.test(String(pid))) return false;
  const b = await gzJSON(env, `/data/p/${bucketOf(String(pid))}.json.gz`);
  return !!(b && b[pid]);
}

export async function playerMeta(env, pid) {
  const b = await gzJSON(env, `/data/p/${bucketOf(pid)}.json.gz`);
  const P = b && b[pid]; if (!P || !P.n) return null;
  const name = tidy(P.n, 60), m = P.meta || {}, a = aggObj(P.a);
  const rank = m.rank || rankName(m.rk);
  const bits = [];
  if (m.mmr) bits.push(`${int(m.mmr)} MMR`);
  if (a.gp) {
    bits.push(`${r1(a.rs / a.gp)} average rating`, `${int(a.gp)} games`, `${Math.round((a.w / a.gp) * 100)}% wins`);
    bits.push(`${int(a.g)} ${a.g === 1 ? 'goal' : 'goals'}, ${int(a.as)} ${a.as === 1 ? 'assist' : 'assists'}`);
  }
  const img = await rankImage(env, m.rk);
  return {
    title: rank ? `${name} · ${rank}` : name,
    desc: (bits.length ? bits.join(' · ') + '. ' : '') + 'Ratings, form and match history on SlapScore.',
    image: img, small: !!img, url: `${SITE}/j/${pid}`,
  };
}

export async function matchMeta(env, d, hh, id) {
  const r = await asset(env, `/data/days/${d}.json`); if (!r) return null;
  const meta = await r.json().catch(() => null);
  const c = meta && (meta.chunks || []).find((x) => inChunk(x.c, hh)); if (!c || !/^[\w-]+$/.test(c.c)) return null;
  const list = await gzJSON(env, `/data/days/${d}/${c.c}.json.gz`);
  const e = Array.isArray(list) && list.find((x) => x.i === id); if (!e) return null;
  const P = (e.p || []).map((p) => ({ name: tidy(p[1], 40) || '—', team: p[2], rating: p[3], g: p[4], as: p[5] }));
  const team = (k) => P.filter((p) => p.team === k).sort((x, y) => (y.rating || 0) - (x.rating || 0)).map((p) => `${p.name} (${r1(p.rating || 0)})`).join(', ');
  const s = e.s || [0, 0];
  const mvp = Number.isInteger(e.v) && P[e.v] ? P[e.v] : null;
  const where = [TYPE[e.y] || 'Match', e.f, region(e.r), e.a].filter(Boolean).join(' · ');
  return {
    title: `Home ${s[0]}–${s[1]} Away · ${where}`,
    desc: tidy([`Home: ${team(0) || '—'}.`, `Away: ${team(1) || '—'}.`, mvp ? `MVP: ${mvp.name} (${r1(mvp.rating || 0)}).` : '', e.t ? date(e.t) + '.' : ''].filter(Boolean).join(' '), 600),
    image: null, small: false, url: `${SITE}/m/${d.replace(/-/g, '')}${hh}-${id}`,
  };
}

// Cambia las etiquetas de la portada por las de esta página (solo las que ya existen en index.html)
export function withMeta(html, m) {
  const t = escAttr(tidy(m.title, 200) + ' — SlapScore'), d = escAttr(tidy(m.desc, 600)), u = escAttr(m.url);
  const set = (attr, key, val) => { html = html.replace(new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`), `$1${val}$2`); };
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`);
  set('name', 'description', d);
  set('property', 'og:title', t); set('property', 'og:description', d); set('property', 'og:url', u);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${u}$2`);
  if (m.image) {
    set('property', 'og:image', escAttr(m.image));
    html = html.replace(/<meta property="og:image:width"[^>]*>/, '').replace(/<meta property="og:image:height"[^>]*>/, '');
  }
  if (m.small) set('name', 'twitter:card', 'summary');
  return html;
}

// Respuesta para /j/... y /m/... (null si la dirección no es de esas)
export async function preview(request, env, ctx, path) {
  const p = parsePath(path); if (!p) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(SITE + path);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const base = await env.ASSETS.fetch(new Request(SITE + '/'));
  let html = await base.text();
  let m = null;
  try { m = p.kind === 'player' ? await playerMeta(env, p.pid) : await matchMeta(env, p.d, p.hh, p.id); } catch (e) { console.log('vista previa: ' + (e && e.message)); }
  if (m) html = withMeta(html, m);
  // mismas cabeceras de seguridad que la portada (vienen de _headers); se guarda 10 minutos
  const h = new Headers(base.headers);
  for (const k of ['content-length', 'etag', 'last-modified', 'content-encoding']) h.delete(k);
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'public, max-age=600');
  const res = new Response(request.method === 'HEAD' ? null : html, { status: base.ok ? 200 : base.status, headers: h });
  if (cache && base.ok && request.method === 'GET') { const put = cache.put(key, res.clone()).catch(() => {}); if (ctx && ctx.waitUntil) ctx.waitUntil(put); }
  return res;
}
