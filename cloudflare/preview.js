// Vista previa de los enlaces de jugadores y partidos (Discord, WhatsApp, Google...).
// Las direcciones bonitas /j/<id> y /m/<día+hora>-<id> no son archivos, así que llegan al Worker: devuelve la misma
// web (index.html) pero con su título, descripción e imagen en las etiquetas <meta>. Los robots de las redes leen
// esas etiquetas; las personas ven la web normal (la app entiende esas direcciones). Va en inglés, como la web por defecto.
import { bucketOf, aggObj } from '../assets/core.js';
import { keyFor, pathFor, langOfPath } from '../assets/routes.js';

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

// Dirección -> qué página es (cualquier idioma, las cortas /j/ y /m/ y las antiguas; routes.js). null: no es de la web
export function parsePath(path) {
  const k = keyFor(path); if (k == null) return null;
  let m = /^j-(\d{1,12})$/.exec(k);
  if (m) return { kind: 'player', key: k, pid: m[1] };
  m = /^m-(\d{4})(\d{2})(\d{2})(\d{2})-([0-9a-f-]{8,64})$/i.exec(k);
  if (m) return { kind: 'match', key: k, d: `${m[1]}-${m[2]}-${m[3]}`, hh: m[4], id: m[5].toLowerCase() };
  return { kind: 'page', key: k };
}
// Título y descripción de cada sección (en inglés, como la web por defecto)
const PAGE_META = {
  jugadores: ['Players', 'Every Slapshot: Rebound player with recorded matches: ratings, stats and form, sortable by any column.'],
  rankings: ['Rankings', 'The best Slapshot: Rebound players in every stat.'],
  records: ['Records', 'The best single-match performances and longest streaks in Slapshot: Rebound.'],
  racha: ['On fire', 'Who is climbing this week in Slapshot: Rebound: biggest MMR gains, most improved ratings and win streaks.'],
  premios: ['Awards', 'Slapshot: Rebound team of the week and player of the month, by average rating.'],
  eusl: ['EUSL', 'European Slapshot League standings, results and top scorers.'],
  notas: ['How we rate', 'How SlapScore rates every Slapshot: Rebound player from 3 to 10 in every match.'],
  novedades: ["What's new", 'Everything you can do on SlapScore, and the latest additions.'],
  legal: ['Legal & privacy', 'Legal notice and privacy policy of SlapScore.'],
};
function pageMeta(key) {
  if (PAGE_META[key]) return { title: PAGE_META[key][0], desc: PAGE_META[key][1], url: SITE + pathFor(key, 'en') };
  let m = /^d-(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (m) return { title: `Matches on ${date(Date.parse(m[1] + 'T12:00:00Z'))}`, desc: 'Every public and custom Slapshot: Rebound match of the day, with ratings for every player.', url: SITE + pathFor(key, 'en') };
  if (/^cmp-/.test(key)) return { title: 'Compare players', desc: 'Two Slapshot: Rebound players head to head: per-match stats, attributes and results against each other.', url: SITE + pathFor(key, 'en') };
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
    image: img, small: !!img, url: SITE + pathFor('j-' + pid, 'en'),
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
    image: null, small: false, url: SITE + pathFor(`m-${d.replace(/-/g, '')}${hh}-${id}`, 'en'),
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

// La web en cualquiera de sus direcciones (/players, /jugador/123, /match/...): index.html con el título, la descripción
// y la imagen de esa página. Si la dirección no es de la web, la misma página con error 404 (la web enseña la portada).
export async function preview(request, env, ctx, path) {
  const p = parsePath(path);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(SITE + path);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const base = await env.ASSETS.fetch(new Request(SITE + '/'));
  let html = await base.text();
  let m = null;
  try { m = !p ? null : p.kind === 'player' ? await playerMeta(env, p.pid) : p.kind === 'match' ? await matchMeta(env, p.d, p.hh, p.id) : pageMeta(p.key); } catch (e) { console.log('vista previa: ' + (e && e.message)); }
  if (m) html = withMeta(html, m);
  // cada página existe en 5 idiomas: la dirección abierta es la buena (canonical) y se enlazan las demás (hreflang)
  if (p && p.key !== 'admin' && p.key !== 'entrada-ibai' && pathFor(p.key, 'en')) {
    const lang = langOfPath(path) || 'en', alt = (l) => SITE + pathFor(p.key, l);
    html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${escAttr(alt(lang))}$2`).replace(/<html lang="[a-z]+"/, `<html lang="${lang}"`);
    const links = ['en', 'es', 'fr', 'de', 'pt', 'tr'].map((l) => `<link rel="alternate" hreflang="${l}" href="${escAttr(alt(l))}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${escAttr(alt('en'))}">`;
    html = html.replace('</head>', links + '</head>');
  }
  // el panel de administrador, las direcciones que no existen y los jugadores o partidos que no están no salen en los buscadores
  if (!p || p.key === 'admin' || p.key === 'entrada-ibai' || (!m && (p.kind === 'player' || p.kind === 'match'))) html = html.replace('</head>', '<meta name="robots" content="noindex"></head>');
  // mismas cabeceras de seguridad que la portada (vienen de _headers); se guarda 10 minutos
  const h = new Headers(base.headers);
  for (const k of ['content-length', 'etag', 'last-modified', 'content-encoding']) h.delete(k);
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'public, max-age=600');
  const res = new Response(request.method === 'HEAD' ? null : html, { status: !base.ok ? base.status : p ? 200 : 404, headers: h });
  if (cache && base.ok && p && request.method === 'GET') { const put = cache.put(key, res.clone()).catch(() => {}); if (ctx && ctx.waitUntil) ctx.waitUntil(put); }
  return res;
}
