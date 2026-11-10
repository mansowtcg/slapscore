// Redes sociales de SlapScore: el equipo de la semana y el jugador del mes, con la imagen de la web.
//   · X (Twitter): se publica solo, con las cuatro claves de la app (secretos X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET).
//     También las novedades de la web, como texto.
//   · Instagram: se publica solo, con el token de la cuenta profesional (secreto IG_ACCESS_TOKEN). El token dura 60 días
//     y el robot lo renueva cada semana.
//   · TikTok: su API no deja publicar en público a una herramienta propia, así que se prepara el «kit» (imagen y texto)
//     para subirlo a mano desde el móvil: sale en el panel de administración y, si hay webhook del canal privado
//     (secreto DISCORD_WEBHOOK_STAFF), también llega a Discord.
// Las claves van solo en los secretos del repositorio y nunca se escriben en el registro ni en los datos.
// Lo publicado, los fallos y los textos se apuntan en data/social/status.json (público: no lleva nada secreto).
//
//   node crawler/social.js plan     escribe «render» si hay que preparar alguna imagen (necesita Playwright)
//   node crawler/social.js render   prepara las imágenes que faltan en data/social/ (PW_DIR = carpeta con node_modules)
//   node crawler/social.js post     publica lo que toca y apunta el resultado
// Variables: DATA_DIR, SOCIAL_FORCE (totw|month|news: publica aunque no toque), DRY_RUN=1, NOW.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { plan as duePlan, render as renderShare, send as discordSend, newsInfo, hookOk, weekLabel, monthLabel } from './discord.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DIR = path.join(DATA, 'social');
const STATUS = path.join(DIR, 'status.json');
const SITE = 'https://slapscore.app';
const base = (k, d) => String(process.env[k] || d).replace(/\/+$/, '');
const X_API = base('X_API_BASE', 'https://api.x.com');
const IG_API = base('IG_API_BASE', 'https://graph.instagram.com');
const CF_API = base('CF_API_BASE', 'https://api.cloudflare.com/client/v4');
const PUBLIC = base('SOCIAL_PUBLIC_BASE', SITE) + '/data/social/';
const IG_WAIT = Number(process.env.IG_POLL_MS) || 5000;
export const NETS = ['x', 'ig', 'kit'];
export const MAX_TRIES = 4;                 // intentos por publicación; después se deja y queda el fallo apuntado
export const RETRY_MS = 30 * 60000;         // entre un intento fallido y el siguiente
const IG_REFRESH_MS = 7 * 86400000;         // el token de Instagram se renueva cada semana (dura 60 días)
const KV_KEY = 'sys:social-ig';
const DEFAULT_TAGS = '#SlapshotRebound #SlapScore';

const readJSON = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fp = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
const rating = (x) => Number(x).toFixed(2);
// Nombres de jugadores: sin menciones, etiquetas ni enlaces (en X un enlace en el texto encarece la publicación)
export const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069`]/g, '').replace(/([@#.:/])/g, '$1\u200b').trim().slice(0, 60) || '?';
// Longitud como la cuenta X: 280 de tope; los emojis y casi todo lo que no es latino cuentan doble
export function xLen(s) {
  let n = 0;
  for (const ch of String(s).normalize('NFC')) { const c = ch.codePointAt(0); n += (c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037)) ? 1 : 2; }
  return n;
}
const MEDALS = ['🥇', '🥈', '🥉'];
const tagsOf = (s) => { const t = String(s || '').split(/\s+/).filter((x) => /^#[\p{L}\p{N}_]{2,40}$/u.test(x)).slice(0, 12); return t.length ? t : DEFAULT_TAGS.split(' '); };

// Claves de las imágenes y de lo publicado
export function keysOf(awards) {
  const W = awards && awards.week && awards.week.last, M = awards && awards.month && awards.month.last;
  return {
    totw: W && W.f && Array.isArray(W.list) && W.list.length >= 3 && /^\d{4}-\d\d-\d\d$/.test(W.f) ? W.f : null,
    month: M && M.m && Array.isArray(M.list) && M.list.length >= 1 && /^\d{4}-\d\d$/.test(M.m) ? M.m : null,
  };
}
export const imageName = (kind, key) => `${kind}-${key}.jpg`;

// Textos de cada red (en inglés, como el servidor de Discord)
export function captions(kind, { awards, headline, opts = {} }) {
  const tags = tagsOf(opts.tags), link = opts.xLink === true;
  const more = [...new Set([...tags, '#Slapshot', '#hockey', '#esports', '#gaming'])].join(' ');
  if (kind === 'news') {
    const head = '📢 What’s new on SlapScore', tail = `${tags.join(' ')}${link ? `\n${SITE}/whats-new` : ''}`;
    let body = String(headline || '').replace(/\s+/g, ' ').trim();
    const room = 280 - xLen(head) - xLen(tags.join(' ')) - (link ? 24 : 0) - 4;
    while (body && xLen(body) > room) body = body.slice(0, -2).trimEnd().replace(/[.,;:·]?$/, '') + '…';
    return { label: 'What’s new', x: `${head}\n\n${body}\n\n${tail}` };
  }
  const isW = kind === 'totw', L = isW ? awards.week.last : awards.month.last, top = L.list.slice(0, 3);
  const label = isW ? weekLabel(L.f, L.t) : monthLabel(L.m), min = isW ? awards.minW || 20 : awards.minM || 60;
  const title = isW ? `🏆 Team of the Week · ${label}` : `⭐ Player of the Month · ${label}`;
  const why = `Best average rating in public matches (min. ${min}).`;
  const short = (cut) => top.map((p, i) => `${MEDALS[i]} ${clean(p.n).slice(0, cut)} · ${rating(p.rt)}`).join('\n');
  const long = top.map((p, i) => `${MEDALS[i]} ${clean(p.n)} · ${rating(p.rt)} avg · ${p.gp} matches · ${p.w} W${p.mvp ? ` · ${p.mvp} MVP` : ''}`).join('\n');
  const tail = `${tags.join(' ')}${link ? `\n${SITE}/awards` : ''}`;
  // en X el enlace cuenta 23 sea como sea de largo
  const fits = (s) => xLen(link ? s.replace(`${SITE}/awards`, 'x'.repeat(23)) : s) <= 280;
  let x = `${title}\n\n${short(60)}\n\n${why}\n${tail}`;
  for (const cut of [60, 24, 14]) { if (fits(x)) break; x = `${title}\n\n${short(cut)}\n\n${tail}`; }
  const ig = `${title}\n\n${long}\n\n${isW ? 'The three best average ratings of the week' : 'The best average ratings of the month'} in public Slapshot: Rebound matches (min. ${min} matches).\n\nYour own rating, stats and rankings: slapscore.app\n\n${more}`;
  const tiktok = `${title}\n\n${short(60)}\n\nYour own rating and stats: slapscore.app\n\n${more}`;
  return { label, x, ig, tiktok };
}

// ---------- qué toca ----------
// Devuelve { jobs: [{ net, kind, key }], state } con el estado puesto al día en lo que se da por visto sin publicar.
export function todo({ awards, newsDate, state, now, on, force }) {
  const st = structuredClone(state || {}); st.done = st.done || {}; st.tries = st.tries || {}; st.err = st.err || {}; st.last = st.last || {};
  const K = { ...keysOf(awards), news: newsDate || null }, jobs = [];
  for (const net of NETS) {
    if (!on[net]) continue;
    const P = duePlan({ awards, newsDate: net === 'x' ? newsDate : null, state: st.done[net], now, hooks: { totw: true, news: net === 'x' }, force });
    st.done[net] = P.state;
    for (const kind of P.due) {
      const key = K[kind]; if (!key) continue;
      const id = `${net}:${kind}`, t = st.tries[id] && st.tries[id].k === key ? st.tries[id] : null;
      if (force !== kind && t) {
        if (t.n >= MAX_TRIES) { st.done[net][kind] = key; delete st.tries[id]; continue; }   // se deja: el fallo queda apuntado en st.err
        if (now - t.at < RETRY_MS) continue;
      }
      jobs.push({ net, kind, key });
    }
  }
  for (const id of Object.keys(st.tries)) { const [net, kind] = id.split(':'); if (!on[net] || st.tries[id].k !== K[kind]) delete st.tries[id]; }
  return { jobs, state: st };
}

// ---------- X (Twitter) ----------
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
// Cabecera OAuth 1.0a (HMAC-SHA1). Los cuerpos JSON o multipart no entran en la firma: solo la dirección y los parámetros oauth_*.
export function oauth1(method, url, c, fixed = {}) {
  const u = new URL(url);
  const o = { oauth_consumer_key: c.key, oauth_nonce: fixed.nonce || crypto.randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(fixed.timestamp || Math.floor(Date.now() / 1000)), oauth_token: c.token, oauth_version: '1.0' };
  const all = [...Object.entries(o), ...u.searchParams.entries()].map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const text = [method.toUpperCase(), pct(u.origin + u.pathname), pct(all.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  o.oauth_signature = crypto.createHmac('sha1', `${pct(c.secret)}&${pct(c.tsecret)}`).update(text).digest('base64');
  return 'OAuth ' + Object.keys(o).sort().map((k) => `${pct(k)}="${pct(o[k])}"`).join(', ');
}
async function call(url, opts, tries = 3) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    let res; try { res = await fetch(url, { ...(typeof opts === 'function' ? opts() : opts), signal: AbortSignal.timeout(45000) }); } catch (e) { last = { status: 0, json: null, text: `sin respuesta (${e.name})` }; await sleep(2000); continue; }
    const text = await res.text().catch(() => ''); let json = null; try { json = JSON.parse(text); } catch {}
    last = { status: res.status, json, text, type: res.headers.get('content-type') || '' };
    if (res.status === 429 || res.status >= 500) { await sleep(Math.min(15, Number(res.headers.get('retry-after')) || 3) * 1000); continue; }
    return last;
  }
  return last;
}
const xDetail = (r) => { const j = r.json || {}; return String(j.detail || j.title || (Array.isArray(j.errors) && j.errors[0] && (j.errors[0].message || j.errors[0].detail)) || r.text || '').slice(0, 220); };
function xHint(r) {
  const d = xDetail(r).toLowerCase();
  if (r.status === 401) return 'las claves no valen: revisa los cuatro secretos X_… (y que el Access Token se generó después de dar permiso de escritura a la app)';
  if (r.status === 402 || /credit/.test(d)) return 'no queda crédito en la cuenta de desarrollador de X';
  if (r.status === 403 && /oauth1|permission|not permitted|read-only/.test(d)) return 'la app de X solo tiene permiso de lectura: pon «Read and write» y genera de nuevo el Access Token';
  return '';
}
class Fail extends Error {}
const fail = (net, r, what) => new Fail(`${net} respondió ${r.status || 'sin conexión'} al ${what}${r.status ? `: ${net === 'X' ? xDetail(r) : igDetail(r)}` : ''}${net === 'X' && xHint(r) ? ` — ${xHint(r)}` : ''}`);

export async function postX(c, text, image) {
  let media = null;
  if (image) {
    const url = `${X_API}/2/media/upload`;
    let r = await call(url, () => { const fd = new FormData(); fd.append('media', new Blob([image], { type: 'image/jpeg' }), 'slapscore.jpg'); fd.append('media_category', 'tweet_image'); return { method: 'POST', headers: { authorization: oauth1('POST', url, c) }, body: fd }; });
    // por si esa dirección solo aceptara JSON (la referencia admite las dos formas)
    if (r.status === 400 || r.status === 415) r = await call(url, () => ({ method: 'POST', headers: { authorization: oauth1('POST', url, c), 'content-type': 'application/json' }, body: JSON.stringify({ media: image.toString('base64'), media_category: 'tweet_image' }) }));
    media = r.json && r.json.data && (r.json.data.id || r.json.data.media_id_string);
    if (r.status < 200 || r.status > 299 || !media) throw fail('X', r, 'subir la imagen');
  }
  const url = `${X_API}/2/tweets`;
  const r = await call(url, () => ({ method: 'POST', headers: { authorization: oauth1('POST', url, c), 'content-type': 'application/json' }, body: JSON.stringify({ text, ...(media ? { media: { media_ids: [String(media)] } } : {}) }) }));
  if (r.status === 403 && /duplicate/i.test(xDetail(r))) return { url: null, dup: true };   // ya estaba publicado (p. ej. la pasada anterior no llegó a apuntarlo)
  const id = r.json && r.json.data && r.json.data.id;
  if (r.status < 200 || r.status > 299 || !id) throw fail('X', r, 'publicar');
  return { url: `https://x.com/i/status/${id}` };
}

// ---------- Instagram ----------
const igDetail = (r) => { const e = (r.json && r.json.error) || {}; return String(e.error_user_msg || e.message || r.text || '').slice(0, 220); };
const igCall = (token, p, body) => call(`${IG_API}${p}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const firstLine = (s) => String(s || '').split('\n')[0].trim();

export async function postInstagram(token, caption, imageUrl) {
  const me = await igCall(token, '/me?fields=user_id,username');
  if (me.status !== 200 || !me.json) throw fail('Instagram', me, 'identificar la cuenta');
  // si ya está publicado (la pasada anterior no llegó a apuntarlo), no se repite
  const recent = await igCall(token, '/me/media?fields=caption,permalink&limit=6');
  const dup = recent.status === 200 && Array.isArray(recent.json && recent.json.data) && recent.json.data.find((m) => firstLine(m.caption) === firstLine(caption));
  if (dup) return { url: dup.permalink || null, dup: true, user: me.json.username };
  // la cuenta se puede nombrar de tres maneras según cómo se creara el token: se usa la primera que Instagram acepte
  const ids = ['me', me.json.user_id, me.json.id].filter((x, i, a) => x && a.indexOf(x) === i);
  let who = ids[0], box = null;
  for (const id of ids) { who = id; box = await igCall(token, `/${id}/media`, { image_url: imageUrl, caption }); if (box.status === 200 || ![400, 404].includes(box.status) || !/unsupported|does not exist|unknown path/i.test(igDetail(box))) break; }
  const cid = box.json && box.json.id;
  if (box.status !== 200 || !cid) throw fail('Instagram', box, 'preparar la publicación');
  for (let i = 0; i < 12; i++) {
    const s = await igCall(token, `/${cid}?fields=status_code`), code = s.json && s.json.status_code;
    if (code === 'FINISHED' || code === 'PUBLISHED') break;
    if (code === 'ERROR' || code === 'EXPIRED') throw new Fail(`Instagram no pudo procesar la imagen (${code})`);
    if (i === 11) throw new Fail('Instagram tarda demasiado en procesar la imagen');
    await sleep(IG_WAIT);
  }
  const pub = await igCall(token, `/${who}/media_publish`, { creation_id: cid }), mid = pub.json && pub.json.id;
  if (pub.status !== 200 || !mid) throw fail('Instagram', pub, 'publicar');
  const link = await igCall(token, `/${mid}?fields=permalink`);
  return { url: (link.json && link.json.permalink) || null, user: me.json.username };
}

// Almacén privado de Cloudflare (el mismo KV del buzón): ahí se guarda el token de Instagram si al renovarlo cambia
async function kvStore(cf) {
  if (!cf.token || !cf.account) return null;
  const h = { authorization: `Bearer ${cf.token}` }, root = `${CF_API}/accounts/${encodeURIComponent(cf.account)}/storage/kv/namespaces`;
  const list = await call(`${root}?per_page=100`, { headers: h });
  const ns = list.status === 200 && Array.isArray(list.json && list.json.result) && list.json.result.find((n) => n.title === 'slapscore-feedback');
  if (!ns) return null;
  const url = `${root}/${ns.id}/values/${encodeURIComponent(KV_KEY)}`;
  return {
    async get() { const r = await call(url, { headers: h }); return r.status === 200 && r.json && typeof r.json.token === 'string' ? r.json : null; },
    async put(v) { const r = await call(url, { method: 'PUT', headers: { ...h, 'content-type': 'text/plain' }, body: JSON.stringify(v) }); return r.status >= 200 && r.status < 300; },
  };
}
// Token de Instagram en uso (el del secreto, o el renovado que haya en el almacén) y renovación semanal
export const igRefreshDue = (info, now) => !info.ref || now - info.ref >= IG_REFRESH_MS || !!(info.exp && info.exp - now < 15 * 86400000);
export async function igToken(secret, cf, info, now) {
  const mark = fp(secret); let token = secret, store = null;
  try { store = await kvStore(cf); const v = store && await store.get(); if (v && v.from === mark && v.token) token = v.token; } catch {}
  if (!igRefreshDue(info, now)) return token;
  const r = await call(`${IG_API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`, {});
  const got = r.status === 200 && r.json && typeof r.json.access_token === 'string' ? r.json : null;
  if (!got) {
    // recién creado (menos de 24 h) aún no se puede renovar: se prueba mañana
    info.ref = now - IG_REFRESH_MS + 86400000;
    const code = r.json && r.json.error && r.json.error.code;
    if (code === 190) info.dead = true;
    console.log(`Instagram: el token no se ha renovado (respuesta ${r.status}${code ? `, código ${code}` : ''})`);
    return token;
  }
  delete info.dead; info.ref = now;
  if (got.access_token === token) { info.exp = now + (Number(got.expires_in) || 0) * 1000; delete info.rotate; console.log('Instagram: token renovado'); return token; }
  let saved = false; try { saved = !!store && await store.put({ token: got.access_token, from: mark, at: now }); } catch {}
  if (saved) { info.exp = now + (Number(got.expires_in) || 0) * 1000; delete info.rotate; console.log('Instagram: token renovado y guardado en Cloudflare'); return got.access_token; }
  info.rotate = true; console.log('::warning::Instagram ha dado un token nuevo al renovar y no se ha podido guardar: habrá que poner uno nuevo en el secreto IG_ACCESS_TOKEN antes de que caduque.');
  return token;
}

// ---------- contexto ----------
const env = (k) => String(process.env[k] || '').trim();
async function context() {
  const x = { key: env('X_API_KEY'), secret: env('X_API_SECRET'), token: env('X_ACCESS_TOKEN'), tsecret: env('X_ACCESS_SECRET') };
  const xn = Object.values(x).filter(Boolean).length;
  if (xn > 0 && xn < 4) console.error('::warning::Faltan secretos de X: hacen falta los cuatro (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN y X_ACCESS_SECRET).');
  const ig = env('IG_ACCESS_TOKEN');
  const staff = hookOk(env('DISCORD_WEBHOOK_STAFF')) ? env('DISCORD_WEBHOOK_STAFF') : '';
  if (env('DISCORD_WEBHOOK_STAFF') && !staff) console.error('::warning::DISCORD_WEBHOOK_STAFF no parece la dirección de un webhook de Discord: se ignora.');
  const settings = await readJSON(path.join(ROOT, 'config', 'settings.json'), {});
  const opts = settings.social && typeof settings.social === 'object' ? settings.social : {};
  const on = { x: xn === 4, ig: ig.length > 20, kit: opts.tiktok === true };
  const force = ['totw', 'month', 'news'].includes(process.env.SOCIAL_FORCE) ? process.env.SOCIAL_FORCE : '';
  const now = process.env.NOW ? Date.parse(process.env.NOW) : Date.now();
  const [awards, state, news] = [await readJSON(path.join(DATA, 'awards.json'), null), await readJSON(STATUS, {}), await newsInfo()];
  const secrets = [...Object.values(x), ig, staff, env('CLOUDFLARE_API_TOKEN')].filter((s) => s.length > 5);
  const safe = (s) => secrets.reduce((t, k) => t.split(k).join('•••'), String(s));
  return { x, ig, staff, cf: { token: env('CLOUDFLARE_API_TOKEN'), account: env('CLOUDFLARE_ACCOUNT_ID') }, opts, on, force, now, awards, state, news, safe };
}
const exists = async (f) => { try { return (await fs.stat(f)).size > 5000; } catch { return false; } };
async function missingImages(jobs) {
  const need = new Map();
  for (const j of jobs) if (j.kind !== 'news' && !need.has(j.kind) && !(await exists(path.join(DIR, imageName(j.kind, j.key))))) need.set(j.kind, j.key);
  return need;
}
// La imagen ya está en la web (Instagram la descarga de ahí)
async function live(name) {
  try { const r = await fetch(PUBLIC + name, { method: 'HEAD', signal: AbortSignal.timeout(15000) }); return r.ok && /image\/jpeg/.test(r.headers.get('content-type') || ''); } catch { return false; }
}

async function main() {
  const cmd = process.argv[2];
  const C = await context();
  if (!NETS.some((n) => C.on[n])) { if (cmd !== 'plan') console.log('Redes: nada configurado.'); return; }
  const T = todo({ awards: C.awards, newsDate: C.news.date, state: C.state, now: C.now, on: C.on, force: C.force });
  if (cmd === 'plan') { if ((await missingImages(T.jobs)).size) console.log('render'); return; }
  if (cmd === 'render') {
    const need = await missingImages(T.jobs); if (!need.size) return;
    const names = Object.fromEntries([...need].map(([k, key]) => [k, imageName(k, key)]));
    await renderShare([...need.keys()], { dir: DIR, names, jpeg: true });
    // solo se guarda la última imagen de cada tipo
    for (const f of await fs.readdir(DIR)) { const m = /^(totw|month)-.+\.jpg$/.exec(f); if (m && names[m[1]] && f !== names[m[1]]) await fs.rm(path.join(DIR, f)).catch(() => {}); }
    return;
  }
  if (cmd !== 'post') { console.error('Uso: node crawler/social.js plan|render|post'); process.exitCode = 2; return; }
  const dry = process.env.DRY_RUN === '1', st = T.state, K = keysOf(C.awards); let failed = 0;
  st.v = 1; st.on = { ...C.on, staff: !!C.staff }; st.ig = st.ig || {}; st.posts = st.posts || {};
  if (!C.on.ig) st.ig = {};
  // textos al día (los usa el panel de administración para TikTok)
  for (const kind of ['totw', 'month']) {
    if (!K[kind]) continue;
    const c = captions(kind, { awards: C.awards, opts: C.opts }), img = imageName(kind, K[kind]);
    st.posts[kind] = { k: K[kind], label: c.label, img: (await exists(path.join(DIR, img))) ? img : (st.posts[kind] && st.posts[kind].k === K[kind] ? st.posts[kind].img : null) || null, x: c.x, ig: c.ig, tiktok: c.tiktok };
  }
  let igTok = C.ig;
  if (C.on.ig && st.ig.fp !== fp(C.ig)) st.ig = { fp: fp(C.ig) };   // secreto nuevo: se empieza de cero
  // el token solo se mira (y se renueva) cuando hace falta: si hay algo que publicar o toca renovarlo
  if (C.on.ig && !dry && (T.jobs.some((j) => j.net === 'ig') || igRefreshDue(st.ig, C.now))) { try { igTok = await igToken(C.ig, C.cf, st.ig, C.now); } catch (e) { console.log(`Instagram: no se pudo revisar el token (${C.safe(e.message)})`); } }
  for (const j of T.jobs) {
    const id = `${j.net}:${j.kind}`, name = j.kind === 'news' ? null : imageName(j.kind, j.key);
    const c = captions(j.kind, { awards: C.awards, headline: C.news.headline, opts: C.opts });
    let image = null; if (name) { try { image = await fs.readFile(path.join(DIR, name)); } catch {} }
    try {
      if (name && !image) throw new Fail('no se pudo preparar la imagen');
      let out = {};
      if (dry) { console.log(`[prueba] ${id} (${j.key})${image ? ` con imagen de ${Math.round(image.length / 1024)} KB` : ''}:\n${j.net === 'x' ? c.x : j.net === 'ig' ? c.ig : c.tiktok}\n`); continue; }
      if (j.net === 'x') out = await postX(C.x, c.x, image);
      else if (j.net === 'ig') {
        if (!(await live(name))) { console.log(`Instagram: la imagen de ${j.kind} aún no está en la web; se publica en la siguiente pasada.`); continue; }
        out = await postInstagram(igTok, c.ig, PUBLIC + name); if (out.user) st.ig.user = String(out.user).slice(0, 40);
      } else if (C.staff) {
        const ok = await discordSend(C.staff, { username: 'SlapScore', allowed_mentions: { parse: [] }, content: `📱 **Listo para TikTok** · ${c.label}\nGuarda la imagen y pega este texto:\n\`\`\`\n${c.tiktok}\n\`\`\`` }, { name, data: image });
        if (!ok) throw new Fail('Discord no aceptó el aviso del canal privado');
      }
      console.log(`Redes: ${id} ${j.net === 'kit' ? 'preparado' : out.dup ? 'ya estaba publicado' : 'publicado'}`);
      delete st.tries[id]; if (st.err[j.net] && st.err[j.net].kind === j.kind) delete st.err[j.net];
      st.last[j.net] = { kind: j.kind, k: j.key, at: C.now, ...(out.url ? { url: out.url } : {}) };
      if (C.force !== j.kind) st.done[j.net][j.kind] = j.key;
    } catch (e) {
      failed++;
      const msg = C.safe(e instanceof Fail ? e.message : `fallo inesperado (${e.message})`).slice(0, 300);
      const n = (st.tries[id] && st.tries[id].k === j.key ? st.tries[id].n : 0) + 1;
      if (C.force !== j.kind) st.tries[id] = { k: j.key, n, at: C.now };
      st.err[j.net] = { kind: j.kind, k: j.key, msg, at: C.now, n };
      console.log(`::warning::Redes: ${id} NO publicado (intento ${n} de ${MAX_TRIES}): ${msg}`);
    }
  }
  for (const n of NETS) if (!C.on[n]) { delete st.err[n]; }
  if (!dry && JSON.stringify(st) !== JSON.stringify(C.state || {})) { await fs.mkdir(DIR, { recursive: true }); await fs.writeFile(STATUS, JSON.stringify(st)); }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
