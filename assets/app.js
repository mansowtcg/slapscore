// SlapScore — aplicación web
import * as C from './core.js';
import { emblem, emblemDefs, setOfficial, hasOfficial, officialSrc, RANK_KEYS } from './emblems.js';
import { t, LANG, LOC, setLang, LANGS, TEAM_LETTER } from './i18n.js';
import { FEATURES, GROUPS, NEWS_DATE, NEWS_HEADLINE } from './news.js';
import { pathFor, keyFor } from './routes.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const ADMIN_KEY = 'slapscore-admin';

// ---------- estado ----------
const S = {
  index: null, ver: '', settings: { seeds: [], hidden: [], weights: {} }, W: C.DEFAULT_WEIGHTS, hidden: new Set(),
  dayMap: new Map(), mem: new Map(), booted: false, featured: new Set(),
};
function applySettings(s) {
  S.settings = { seeds: [], hidden: [], weights: {}, ...(s || {}) };
  S.W = C.weightsFrom(S.settings.weights);
  // los ocultos se guardan como "día/hora|id" (o solo el id en ajustes antiguos)
  S.hidden = new Set((S.settings.hidden || []).map((h) => String(h).split('|').pop()));
  S.sup = new Set([...(Array.isArray(S.settings.supporters) ? S.settings.supporters : []), ...((S.index && Array.isArray(S.index.sup)) ? S.index.sup : [])].map(String));
}
function setIndex(idx) {
  S.index = idx; S.ver = idx.updated;
  S.dayMap = new Map((idx.days || []).map((d) => [d.d, d]));
  S.featured = new Set((idx.featured || []).map(String));
  if (Array.isArray(idx.sup)) idx.sup.forEach((id) => S.sup && S.sup.add(String(id)));   // supporters de Ko-fi (los junta el robot)
}

// ---------- favoritos (solo en este navegador) ----------
const FAV_KEY = 'slapscore-favs', FAV_MAX = 40;
let FAVS = new Map();   // id -> nombre
try { FAVS = new Map((JSON.parse(localStorage.getItem(FAV_KEY) || '[]') || []).filter((x) => Array.isArray(x) && x[0]).map(([id, n]) => [String(id), String(n || id)])); } catch {}
const isFav = (id) => FAVS.has(String(id));
function toggleFav(id, name) {
  id = String(id);
  if (FAVS.has(id)) FAVS.delete(id);
  else { if (FAVS.size >= FAV_MAX) { toast(t('Como mucho {n} favoritos', { n: FAV_MAX })); return false; } FAVS.set(id, name || id); trackEvent('fav'); }
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...FAVS])); } catch {}
  pushResync();
  return FAVS.has(id);
}

// ---------- avisos en el móvil de los favoritos (Web Push) ----------
// El navegador se suscribe con la clave pública del Worker y le pasa los IDs de sus favoritos; el Worker avisa cuando
// uno termina un partido o sube de rango (cloudflare/push.js). En iPhone solo funciona con la app instalada.
const PUSH_KEY = 'slapscore-push';
let pushOn = (() => { try { return localStorage.getItem(PUSH_KEY) === '1'; } catch { return false; } })();
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:';
const b64uBytes = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const postJSON = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function pushSub(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    const r = await fetch('/api/push/key'); if (!r.ok) throw new Error('key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes((await r.json()).key) });
  }
  return sub;
}
async function pushSync(test) {
  const sub = await pushSub(false); if (!sub) return false;
  const r = await postJSON('/api/push/sub', { sub: sub.toJSON(), ids: [...FAVS.keys()], lang: LANG });
  if (test && r.ok) postJSON('/api/push/test', { endpoint: sub.endpoint }).catch(() => {});
  return r.ok;
}
function setPushOn(v) { pushOn = v; try { if (v) localStorage.setItem(PUSH_KEY, '1'); else localStorage.removeItem(PUSH_KEY); } catch {} $$('[data-push]').forEach((b) => b.setAttribute('aria-pressed', String(v))); }
async function pushEnable() {
  if (!pushOk()) { toast(isIOS() && !standalone() ? t('En iPhone, los avisos funcionan con la app instalada: Compartir → «Añadir a pantalla de inicio».') : t('Este navegador no admite avisos.')); return false; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast(t('Los avisos están bloqueados: actívalos en los ajustes del navegador para esta web.')); return false; }
  try { await pushSub(true); setPushOn(true); if (!(await pushSync(true))) throw new Error('sync'); trackEvent('push'); toast(FAVS.size ? t('Avisos activados: te avisaremos cuando tus favoritos terminen un partido o suban de rango') : t('Avisos activados. Añade jugadores a favoritos con la estrella para recibir sus avisos.')); return true; }
  catch { setPushOn(false); toast(t('No se pudieron activar los avisos. Inténtalo otra vez.')); return false; }
}
async function pushDisable() {
  try { const sub = await pushSub(false); if (sub) { postJSON('/api/push/unsub', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); } } catch {}
  setPushOn(false); toast(t('Avisos desactivados'));
}
let pushT = 0;
function pushResync() { if (!pushOn || !pushOk()) return; clearTimeout(pushT); pushT = setTimeout(() => pushSync(false).catch(() => {}), 800); }
// botón de campana: activa o desactiva los avisos de todos los favoritos
const pushBtn = (cls = 'btn sm') => (pushOk() || isIOS() ? `<button type="button" class="${cls} push-btn" data-push aria-pressed="${pushOn}" title="${esc(t('Avisos de tus favoritos'))}" aria-label="${esc(t('Avisos de tus favoritos'))}">${ICON.bell}<span>${esc(t('Avisos'))}</span></button>` : '');
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-push]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  if (pushOn) pushDisable(); else pushEnable();
});

// ---------- datos ----------
// Cada archivo se pide con su versión (?v=hash): si no ha cambiado, sale de la caché del navegador al instante.
async function gunzip(buf) {
  if (typeof DecompressionStream === 'function') return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const z = await import('./vendor/gunzip.js'); return z.strFromU8(z.gunzipSync(buf));
}
async function getJSON(url, ver) {
  if (!/^(https?:)?\//.test(url)) url = '/' + url;   // siempre desde la raíz: la página puede estar en /j/... o /m/...
  const fresh = ver === true;
  const u = url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(fresh ? Date.now() : (ver || S.ver));
  const r = await fetch(u, fresh ? { cache: 'no-store' } : {});
  if (!r.ok) { const e = new Error(r.status === 404 ? t('No encontrado') : t('Error {n}', { n: r.status })); e.status = r.status; throw e; }
  if (!url.endsWith('.gz')) return r.json();
  const buf = new Uint8Array(await r.arrayBuffer());
  // por si el servidor ya lo ha descomprimido (Content-Encoding: gzip)
  return JSON.parse(buf[0] === 0x1f && buf[1] === 0x8b ? await gunzip(buf) : new TextDecoder().decode(buf));
}
// Memoria de la sesión: lo ya cargado se reutiliza sin volver a pedirlo (las claves llevan la versión)
function remember(key, fn) {
  let p = S.mem.get(key);
  if (p) { S.mem.delete(key); S.mem.set(key, p); return p; }
  p = fn().catch((e) => { S.mem.delete(key); throw e; });
  S.mem.set(key, p);
  if (S.mem.size > 500) S.mem.delete(S.mem.keys().next().value);
  return p;
}
const notFoundErr = () => Object.assign(new Error(t('No encontrado')), { status: 404 });
const fileVer = (k) => (S.index && S.index.files && S.index.files[k]) || S.ver;
const inChunk = (c, hh) => c === 'all' || c === hh || (c.includes('-') && hh <= c.slice(0, 2) && hh >= c.slice(3, 5));
function loadMeta(d) { const di = S.dayMap.get(d); return di ? remember('m:' + d + di.u, () => getJSON(`data/days/${d}.json`, di.u)) : Promise.reject(notFoundErr()); }
const loadChunk = (d, c) => remember(`c:${d}/${c.c}:${c.v}`, () => getJSON(`data/days/${d}/${c.c}.json.gz`, c.v));
const loadRaw = (d, hh, v) => remember(`r:${d}/${hh}:${v}`, () => getJSON(`data/full/${d}/${hh}.json.gz`, v));
const loadBucket = (pid) => { const b = C.bucketOf(pid); return remember('p:' + b + ':' + S.ver, () => getJSON(`data/p/${b}.json.gz`, S.ver)); };
async function loadP(pid) {
  const P = (await loadBucket(pid))[pid];
  if (!P) throw notFoundErr();
  if (!P._g) { P._g = P.games.map(C.gameObj); P._a = C.aggObj(P.a); P._ac = C.aggObj(P.ac); }
  return P;
}
const loadSearch = () => remember('s:' + fileVer('search'), () => getJSON('data/search.json.gz', fileVer('search')));
const loadTable = (w) => remember('t:' + w + fileVer('p' + w), () => getJSON(`data/players-${w}.json.gz`, fileVer('p' + w))
  .then((j) => j.rows.map((r) => ({ id: r[0], n: r[1], rk: r[2], mmr: r[3], a: C.aggObj(r.slice(4)) }))));
const loadRankings = () => remember('rk:' + fileVer('rankings'), () => getJSON('data/rankings.json', fileVer('rankings')));
const loadTop = () => remember('top:' + fileVer('top'), () => getJSON('data/top.json', fileVer('top')));
const loadAttr = () => remember('at:' + fileVer('attr'), () => getJSON('data/attr.json', fileVer('attr')));
const loadRecords = () => remember('rec:' + fileVer('records'), () => getJSON('data/records.json', fileVer('records')));
const loadEusl = () => remember('eu:' + fileVer('eusl'), () => getJSON('data/eusl.json', fileVer('eusl')));
const loadAwards = () => remember('aw:' + fileVer('awards'), () => getJSON('data/awards.json', fileVer('awards')).then((a) => { S.awards = a; return a; }));
// Compatibilidad con el panel de administrador: { id: { n, rk, mmr, a: { gp } } }
async function loadPlayers() { const rows = await loadSearch(); const o = {}; for (const r of rows) o[r[0]] = { n: r[1], rk: r[2], mmr: r[3], a: { gp: r[4] } }; return o; }
// Un partido: su resumen (rangos, nota) y, si no está archivado, el JSON original de slapshot.gg
async function loadMatch(key, id) {
  const d = key.slice(0, 10), hh = key.slice(11);
  const meta = await loadMeta(d);
  const c = (meta.chunks || []).find((x) => inChunk(x.c, hh));
  if (!c) throw notFoundErr();
  const [list, raws] = await Promise.all([loadChunk(d, c), meta.x ? null : loadRaw(d, hh, c.v).catch(() => null)]);
  const e = list.find((x) => x.i === id) || null, raw = raws ? raws.find((x) => x.id === id) || null : null;
  // enlace antiguo a un periodo suelto de una partida custom: lleva a la partida completa
  if (!e && raw && C.periodNo(raw)) { const host = await periodHost(raw).catch(() => null); if (host) return { redirect: matchHref(host.k, host.i) }; }
  if (!e && !raw) throw notFoundErr();
  // partida custom con periodos: hacen falta los registros de todos sus periodos (pueden estar en otras horas)
  let per = null;
  if (e && e.pd && raw) per = await Promise.all(e.pd.map((x) => (x.i === id ? raw : rawAt(x.k, x.i)))).then((l) => (l.every(Boolean) ? l : null)).catch(() => null);
  return { meta, e, raw, per };
}
// Registro original de un partido por su clave día/hora (null si el día está archivado o no está)
async function rawAt(key, id) {
  const d = key.slice(0, 10), hh = key.slice(11), di = S.dayMap.get(d); if (!di) return null;
  const meta = await loadMeta(d); if (meta.x) return null;
  const c = (meta.chunks || []).find((x) => inChunk(x.c, hh));
  const l = await loadRaw(d, hh, c ? c.v : di.u).catch(() => null);
  return (l && l.find((x) => x.id === id)) || null;
}
// Partida a la que pertenece un periodo suelto: se busca en las horas anteriores
async function periodHost(raw) {
  const t = Date.parse(raw.created || '') || 0;
  for (let j = 0; j <= 2; j++) {
    const k = C.madrid(t - j * 3_600_000), d = k.day, di = S.dayMap.get(d); if (!di) continue;
    const meta = await loadMeta(d), c = (meta.chunks || []).find((x) => inChunk(x.c, k.hour)); if (!c) continue;
    const e = (await loadChunk(d, c)).find((x) => x.pd && x.pd.some((y) => y.i === raw.id)); if (e) return e;
  }
  return null;
}
// Buscar un partido por su ID entre los de los últimos días
async function findMatchById(mid) {
  for (const di of (S.index.days || []).slice(0, 3)) {
    const meta = await loadMeta(di.d).catch(() => null); if (!meta) continue;
    for (const c of meta.chunks || []) { const l = await loadChunk(di.d, c).catch(() => []); const e = l.find((x) => x.i === mid || (x.pd && x.pd.some((y) => y.i === mid))); if (e) return e; }
  }
  return null;
}

// ---------- formato ----------
const nf = (d) => new Intl.NumberFormat(LOC, { minimumFractionDigits: d, maximumFractionDigits: d });
const NF0 = new Intl.NumberFormat(LOC), NF1 = nf(1), NF2 = nf(2);
const fmtR = (r) => NF1.format(Math.round(r * 10) / 10);
const dec = (x, d = 1) => (d === 2 ? NF2 : NF1).format(x || 0);
const int = (x) => NF0.format(x || 0);
const pct = (x) => Math.round((x || 0) * 100) + (LANG === 'en' || LANG === 'pt' ? '%' : ' %');
const pl = (n, one, many) => `${int(n)} ${t(n === 1 ? one : many)}`;
const rcls = (r) => r >= 9 ? 'elite' : r >= 8 ? 'great' : r >= 7 ? 'good' : r >= 6.5 ? 'ok' : r >= 6 ? 'meh' : 'bad';
const badge = (r, size) => `<span class="rt ${rcls(r)}${size ? ' ' + size : ''}">${fmtR(r)}</span>`;
function hash32(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const hue = (s) => hash32(s) % 360;
function initials(n) { const s = String(n || '?').replace(/[^\p{L}\p{N}]/gu, ''); return esc((s[0] || '?') + (s[1] || '')); }
const avatar = (name, id, size) => `<span class="av${size ? ' ' + size : ''}" style="--h:${hue(id || name)}" aria-hidden="true">${initials(name)}</span>`;
const HOME = () => t('Local'), AWAY = () => t('Visitante');
const teamName = (tm) => (tm === 'home' || tm === 0 ? HOME() : AWAY());
function crest(team, size = 20) {
  const col = team === 'home' || team === 0 ? 'var(--home)' : 'var(--away)';
  const letter = team === 'home' || team === 0 ? TEAM_LETTER[0] : TEAM_LETTER[1];
  return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 21 5v6.4c0 5.3-3.7 9.4-9 11-5.3-1.6-9-5.7-9-11V5Z" fill="${col}"/><path d="M12 3.6 19.3 6.2v5.2c0 4.3-2.9 7.7-7.3 9.1Z" fill="#fff" fill-opacity=".14"/><text x="12" y="15.6" text-anchor="middle" font-size="10" font-weight="800" fill="#fff" font-family="Sofia Sans, sans-serif">${letter}</text></svg>`;
}
const rank = (rk, size = 18, o = {}) => rk ? emblem(rk, size, { ...o, approxLabel: t('aproximado') }) : '';
const DF_TIME = new Intl.DateTimeFormat(LOC, { hour: '2-digit', minute: '2-digit' });
const DF_SHORT = new Intl.DateTimeFormat(LOC, { day: 'numeric', month: 'short' });
const DF_FULL = new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DF_WD = new Intl.DateTimeFormat(LOC, { weekday: 'short', timeZone: 'UTC' });
const DF_DM = new Intl.DateTimeFormat(LOC, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DF_LONGDAY = new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const today = () => C.madrid(Date.now()).day;
const yesterday = () => C.madrid(Date.now() - 864e5).day;
const dayDate = (d) => new Date(d + 'T12:00:00Z');
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
function dayShort(d) { if (d === today()) return t('Hoy'); if (d === yesterday()) return t('Ayer'); return cap(DF_WD.format(dayDate(d)).replace('.', '')); }
const dayLong = (d) => d === today() ? t('Hoy') : d === yesterday() ? t('Ayer') : DF_LONGDAY.format(dayDate(d));
const shortDate = (ms) => DF_SHORT.format(new Date(ms)).replace('.', '');
function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return t('hace un momento');
  if (s < 3600) return t('hace {n} min', { n: Math.round(s / 60) });
  if (s < 86400) return t('hace {n} h', { n: Math.round(s / 3600) });
  const d = Math.round(s / 86400); return d === 1 ? t('ayer') : t('hace {n} días', { n: d });
}
const regionLabel = (r) => String(r || '').split('-').map((x) => x.length <= 3 ? x.toUpperCase() : x[0].toUpperCase() + x.slice(1)).join(' ');
const regionShort = (r) => String(r || '?').split('-')[0].toUpperCase();
const typeLabel = (y) => C.TYPE_LABEL[y] ? t(C.TYPE_LABEL[y]) : (y ? cap(y) : t('Partida'));
const endLabel = (e, ot) => ot && (!e || e === 'EndOfRegulation') ? t('Final en prórroga') : (C.END_LABEL[e] ? t(C.END_LABEL[e]) : (e ? String(e).replace(/([a-z])([A-Z])/g, '$1 $2') : t('Final')));
const statName = (k) => C.LABELS[k] ? t(C.LABELS[k][0]) : k.replace(/_/g, ' ');
const statAbbr = (k) => C.LABELS[k] ? t(C.LABELS[k][1]) : k.slice(0, 4).toUpperCase();
const resLetter = (r) => r === 'W' ? t('V') : r === 'L' ? t('D') : t('E');
const matchHref = (key, id) => esc(`#m-${String(key).replace(/[-/]/g, '')}-${id}`);
function parseMatch(h) {
  const m = /^m-(\d{4})(\d{2})(\d{2})(\d{2})-(.+)$/.exec(h);
  return m ? { key: `${m[1]}-${m[2]}-${m[3]}/${m[4]}`, id: m[5] } : null;
}
const ICON = {
  install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="4"/><path d="M12 4v16"/><circle cx="12" cy="12" r="2.6"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.2 14.8c1.7.8 2.9 2.6 3.3 5.2"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5Z"/></svg>',
  league: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 20 6v5.6c0 4.6-3.3 8.4-8 9.6-4.7-1.2-8-5-8-9.6V6Z"/><path d="m12 7.8 1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4Z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-4.3A7.5 7.5 0 1 1 20 12.5Z"/><path d="M9 11h6M9 14.5h3.5"/></svg>',
  coffee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1 .8 1.2.8 2.2M12 3.5c0 1 .8 1.2.8 2.2"/><path d="M5 21h10"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c4 0 7-2.7 7-6.6 0-3.6-2.6-5.8-4.2-8.9-.4 2.3-1.6 3.6-2.8 4.2C12.4 6.6 10.8 4.4 8.6 3c.3 3.2-1.4 5.1-2.6 7.1A7.4 7.4 0 0 0 5 14.4C5 18.3 8 21 12 21Z"/><path d="M12 21c-1.8 0-3-1.3-3-3 0-1.9 1.5-2.9 2.3-4.4.5 1.1 1.4 1.6 2 1.9.9.5 1.7 1.3 1.7 2.5 0 1.7-1.2 3-3 3Z"/></svg>',
  vs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3.5"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M13 2.5 4.5 13.5H11L10 21.5l8.5-11H12Z"/></svg>',
};

// ---------- interfaz base ----------
document.body.insertAdjacentHTML('afterbegin', emblemDefs());
const APP = $('#app');
const NAV = [['partidos', 'Partidos'], ['jugadores', 'Jugadores'], ['rankings', 'Rankings'], ['records', 'Récords'], ['premios', 'Premios'], ['eusl', 'EUSL'], ['notas', 'Cómo puntuamos'], ['novedades', 'Novedades']];
// Novedades: punto en el menú y aviso en la portada hasta que se vean (news.js)
const NEWS_KEY = 'slapscore-news';
const newsUnseen = () => { try { return (localStorage.getItem(NEWS_KEY) || '') < NEWS_DATE; } catch { return false; } };
function newsSeen() { try { localStorage.setItem(NEWS_KEY, NEWS_DATE); } catch {} $$('.news-dot, #news-banner').forEach((e) => e.remove()); }
const newsDot = () => (newsUnseen() ? '<span class="news-dot" aria-hidden="true"></span>' : '');
APP.innerHTML = `
<header class="hdr">
  <div class="wrap hdr-top">
    <a class="brand" href="#partidos" aria-label="${esc(t('SlapScore, inicio'))}"><span class="brand-mark"><i></i></span><span class="t">SlapScore</span></a>
    <div class="search" role="search">${ICON.search}<input id="q" type="search" placeholder="${esc(innerWidth < 560 ? t('Buscar jugador') : t('Buscar jugador, ID o enlace'))}" autocomplete="off" aria-label="${esc(t('Buscar jugador'))}" aria-controls="sres"><div class="sres" id="sres" role="listbox" hidden></div></div>
    <div class="hdr-actions">
      <button class="ibtn" id="btn-install" type="button" aria-label="${esc(t('Instalar SlapScore'))}" title="${esc(t('Instalar la app'))}" hidden>${ICON.install}</button>
      <button class="ibtn" id="btn-fb" type="button" data-fb aria-label="${esc(t('Enviar una sugerencia'))}" title="${esc(t('Sugerencias y errores'))}">${ICON.chat}</button>
      <button class="ibtn" id="btn-refresh" type="button" aria-label="${esc(t('Actualizar datos'))}" title="${esc(t('Actualizar datos'))}">${ICON.refresh}</button>
      <button class="ibtn lang" id="btn-lang" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Language · Idioma" title="Language · Idioma">${LANG.toUpperCase()}</button>
      <button class="ibtn" id="btn-theme" type="button" aria-label="${esc(t('Cambiar tema claro u oscuro'))}" title="${esc(t('Tema claro / oscuro'))}">${ICON.theme}</button>
      <a class="ibtn" id="btn-admin" href="#admin" aria-label="${esc(t('Panel de administrador'))}" title="${esc(t('Administrador'))}" hidden>${ICON.admin}</a>
    </div>
  </div>
  <nav class="wrap nav" aria-label="${esc(t('Secciones'))}">
    ${NAV.map(([k, l]) => `<a href="#${k}" data-nav="${k}">${esc(t(l))}${k === 'novedades' ? newsDot() : ''}</a>`).join('')}
  </nav>
</header>
<div class="pbar" id="pbar" aria-hidden="true"></div>
<div class="wrap newbar" id="newbar" hidden><button type="button" id="btn-new">${esc(t('Hay partidos nuevos · Actualizar'))}</button></div>
<main class="wrap" id="main" tabindex="-1"></main>
<footer class="wrap foot" id="foot"></footer>
<nav class="bnav" aria-label="${esc(t('Menú inferior'))}"><a href="#partidos" data-nav="partidos">${ICON.games}${esc(t('Partidos'))}</a><a href="#jugadores" data-nav="jugadores">${ICON.users}${esc(t('Jugadores'))}</a><a href="#rankings" data-nav="rankings" data-also="records,premios">${ICON.trophy}${esc(t('Rankings'))}</a><a href="#eusl" data-nav="eusl">${ICON.league}EUSL</a><a href="#novedades" data-nav="novedades" data-also="notas,legal">${ICON.info}${esc(t('Info'))}${newsDot()}</a></nav>
<div id="itip"></div>
<div class="toasts" id="toasts" aria-live="polite"></div>
<div id="sheet-root"></div>`;
const MAIN = $('#main');
// idioma: menú bajo el botón de la cabecera y lista en el pie
function langMenu(open) {
  const btn = $('#btn-lang'); let m = $('#lang-menu');
  if (!open) { if (m) m.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  m = document.createElement('div'); m.id = 'lang-menu'; m.className = 'lang-menu'; m.setAttribute('role', 'menu');
  m.innerHTML = LANGS.map(([k, n]) => `<button type="button" role="menuitemradio" aria-checked="${k === LANG}" data-setlang="${k}"><b>${k.toUpperCase()}</b>${esc(n)}</button>`).join('');
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(); m.style.top = `${r.bottom + 6}px`; m.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  btn.setAttribute('aria-expanded', 'true'); $('[aria-checked="true"]', m).focus();
}
$('#btn-lang').addEventListener('click', (e) => { e.stopPropagation(); langMenu(!$('#lang-menu')); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-setlang]'); if (b) { e.preventDefault(); const l = b.getAttribute('data-setlang'); if (l !== LANG) setLang(l); else langMenu(false); return; }
  if ($('#lang-menu') && !e.target.closest('#lang-menu')) langMenu(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#lang-menu')) { langMenu(false); $('#btn-lang').focus(); } });
addEventListener('resize', () => langMenu(false));

function toast(msg, ms = 3800) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}
// Enlace de apoyo (Ko-fi u otro) configurable desde el panel; si no hay, no se muestra nada
function supportUrl() { const u = String((S.settings && S.settings.support) || '').trim(); return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : ''; }
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 300));
function isAdmin() { try { return !!JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null')?.token; } catch { return false; } }
function renderChrome() {
  $('#btn-admin').hidden = !isAdmin();
  const i = S.index;
  const sup = supportUrl();
  $('#foot').innerHTML = `<span>${t('Datos públicos de {a}', { a: '<a href="https://slapshot.gg" target="_blank" rel="noopener">slapshot.gg</a>' })}${i ? ` · ${esc(t('actualizado {x}', { x: ago(Date.parse(i.updated)) }))}` : ''} · ${esc(t('SlapScore no está afiliado a Oddshot Games.'))}</span><span class="foot-r"><button type="button" class="linkbtn" data-fb>${esc(t('Sugerencias'))}</button>${sup ? `<a href="${esc(sup)}" target="_blank" rel="noopener">${esc(t('Apoya el proyecto'))}</a>` : ''}<a href="#notas">${esc(t('Cómo puntuamos'))}</a><a href="#legal">${esc(t('Aviso legal y privacidad'))}</a><span class="foot-langs">${LANGS.map(([k, n]) => k === LANG ? `<b>${esc(n)}</b>` : `<a href="#" data-setlang="${k}" lang="${k}">${esc(n)}</a>`).join('')}</span></span>`;
}
// Si una transición se interrumpe (cambias de página muy rápido), el navegador la cancela: no es un error
function quiet(tr) { if (tr) for (const k of ['ready', 'finished', 'updateCallbackDone']) if (tr[k]) tr[k].catch(() => {}); return tr; }
// tema
function applyTheme(x) { if (x) document.documentElement.setAttribute('data-theme', x); else document.documentElement.removeAttribute('data-theme'); }
try { applyTheme(localStorage.getItem('slapscore-theme')); } catch {}
const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
function themeIcon() { const b = $('#btn-theme'); const d = isDark(); b.innerHTML = d ? ICON.sun : ICON.theme; b.setAttribute('aria-label', d ? t('Cambiar a tema claro') : t('Cambiar a tema oscuro')); }
themeIcon(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeIcon);
$('#btn-theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  const doIt = () => { applyTheme(next); themeIcon(); try { localStorage.setItem('slapscore-theme', next); } catch {} };
  if (document.startViewTransition && !REDUCED.matches) quiet(document.startViewTransition(doIt)); else doIt();
});

// ---------- hoja (modal) ----------
let sheetPrevFocus = null;
function openSheet(html, cls = '') {
  sheetPrevFocus = document.activeElement;
  $('#sheet-root').innerHTML = `<div class="ovl" id="ovl"><div class="sheet ${cls}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${html}</div></div>`;
  const ovl = $('#ovl');
  ovl.addEventListener('click', (e) => { if (e.target === ovl || e.target.closest('[data-close]')) closeSheet(); });
  const f = $('[autofocus]', ovl) || $('[data-close]', ovl); if (f) f.focus({ preventScroll: true });
  return ovl;
}
function closeSheet(instant) {
  const ovl = $('#ovl'); if (!ovl) return;
  if (instant || REDUCED.matches) { ovl.remove(); return; }
  ovl.classList.add('closing'); $('.sheet', ovl).classList.add('closing');
  setTimeout(() => ovl.remove(), 220);
  if (sheetPrevFocus && sheetPrevFocus.focus) sheetPrevFocus.focus();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
document.addEventListener('click', (e) => { const c = e.target.closest('[data-copy]'); if (c) copyText(c.getAttribute('data-copy'), c); });
addEventListener('resize', () => { if (S.onResize) S.onResize(); }, { passive: true });

function copyText(txt, el) {
  const sel = () => { try { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast(t('Texto seleccionado: cópialo con Ctrl+C')); } catch {} };
  try { navigator.clipboard.writeText(txt).then(() => toast(t('Copiado')), sel); } catch { sel(); }
}

// ---------- buscador (nombre, ID o enlace de slapshot.gg) ----------
// "https://slapshot.gg/players/1545491" o "1545491" -> jugador; enlace o ID de partido -> partido
function parseIdQuery(raw) {
  const s = String(raw || '').trim();
  let m = /slapshot\.gg\/players\/(\d{1,10})/i.exec(s) || /^#?j-(\d{1,10})$/i.exec(s) || /^(\d{3,10})$/.exec(s);
  if (m) return { pid: m[1] };
  // enlace de SlapScore (slapscore.app/jugador/123, /player/123, /j/123...)
  const sm = /slapscore\.app(\/[^\s?#]*)/i.exec(s); const k = sm && keyFor(sm[1]);
  if (k && /^j-\d+$/.test(k)) return { pid: k.slice(2) };
  m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(s);
  if (m && (/slapshot\.gg\/matches\//i.test(s) || m[1].length === s.length)) return { mid: m[1].toLowerCase() };
  return null;
}
function srow(r, on, pick) {
  const rk = r[2] ? C.parseRank(r[2]) : null;
  const inner = `${avatar(r[1], r[0])}<span class="nm">${isFav(r[0]) ? '<span class="fv">★</span>' : ''}${esc(r[1])}<small>${rk ? esc(rk.name) + (r[3] != null ? ' · ' + int(r[3]) + ' MMR' : '') + ' · ' : ''}${pl(r[4], 'partido', 'partidos')}</small></span>${rank(r[2], 22)}`;
  return pick ? `<button type="button" class="srow" data-pick="${esc(r[0])}">${inner}</button>` : `<a role="option" href="#j-${esc(r[0])}" class="${on ? 'on' : ''}">${inner}</a>`;
}
(() => {
  const inp = $('#q'), box = $('#sres'); let sel = -1, list = [];
  let idx = null, idxVer = '', byId = null;
  async function getIdx() {
    const v = fileVer('search');
    if (!idx || idxVer !== v) { const rows = await loadSearch(); idx = rows.map((r) => [fold(r[1]), r]); byId = new Map(rows.map((r) => [String(r[0]), r])); idxVer = v; }
    return idx;
  }
  async function draw() {
    const raw = inp.value.trim(), q = fold(raw);
    if (!q && !FAVS.size) { box.hidden = true; return; }
    let I; try { I = await getIdx(); } catch { box.innerHTML = `<div class="none">${esc(t('No se pudo cargar la lista de jugadores.'))}</div>`; box.hidden = false; return; }
    if (fold(inp.value.trim()) !== q) return;
    if (!q) {   // campo vacío: atajo a los favoritos
      list = [...FAVS.keys()].map((id) => byId.get(id)).filter(Boolean).slice(0, 8);
      if (!list.length) { box.hidden = true; return; }
      box.innerHTML = `<div class="sres-h">${ICON.star}${esc(t('Tus favoritos'))}</div>` + list.map((r, i) => srow(r, i === sel)).join('');
      box.hidden = false; return;
    }
    const idq = parseIdQuery(raw);
    if (idq && idq.mid) {
      list = [];
      box.innerHTML = `<div class="none">${esc(t('Buscando el partido…'))}</div>`; box.hidden = false;
      const e = await findMatchById(idq.mid).catch(() => null);
      if (inp.value.trim() !== raw) return;
      if (e) { list = [{ href: matchHref(e.k, e.i) }]; box.innerHTML = `<a role="option" class="on" href="${matchHref(e.k, e.i)}"><span class="av" style="--h:220">${ICON.games}</span><span class="nm">${esc(typeLabel(e.y))} · ${e.s[0]}-${e.s[1]}<small>${esc(dayLong(C.madrid(e.t).day))} · ${DF_TIME.format(new Date(e.t))} · ${esc(regionLabel(e.r))}</small></span></a>`; }
      else box.innerHTML = `<div class="none">${esc(t('Ese partido no está entre los de los últimos días.'))} <a href="https://slapshot.gg/matches/${encodeURIComponent(idq.mid)}" target="_blank" rel="noopener">${esc(t('Abrir en slapshot.gg'))}</a></div>`;
      return;
    }
    // primero los que empiezan por el texto; la lista ya viene ordenada por partidos jugados
    const starts = [], has = [];
    if (idq && idq.pid) { const r = byId.get(idq.pid); list = r ? [r] : [{ id: idq.pid }]; }
    else {
      for (const [f, r] of I) { if (f.startsWith(q)) { starts.push(r); if (starts.length >= 8) break; } else if (has.length < 8 && f.includes(q)) has.push(r); }
      list = starts.concat(has).slice(0, 8);
    }
    box.innerHTML = list.length ? list.map((r, i) => r.id ? `<a role="option" href="#j-${esc(r.id)}" class="on">${avatar('#', r.id)}<span class="nm">${esc(t('Jugador {id}', { id: r.id }))}<small>${esc(t('Todavía sin partidos en SlapScore'))}</small></span></a>` : srow(r, i === sel)).join('')
      : `<div class="none">${esc(t('Ningún jugador con ese nombre todavía.'))} ${esc(t('También puedes pegar su ID o el enlace de su perfil de slapshot.gg.'))}</div>`;
    box.hidden = false;
  }
  const hrefOf = (it) => it.href || '#j-' + (it.id || it[0]);
  const close = () => { box.hidden = true; inp.value = ''; sel = -1; inp.blur(); };
  inp.addEventListener('focus', () => { getIdx().catch(() => {}); if (!inp.value.trim() && FAVS.size) draw(); });
  // «/» lleva al buscador desde cualquier parte
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); inp.focus(); } });
  let ti; inp.addEventListener('input', () => { sel = -1; clearTimeout(ti); ti = setTimeout(draw, 60); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { clearTimeout(ti); const s0 = sel; draw().then(() => { const it = list[s0 < 0 ? 0 : s0]; if (it) { navTo(hrefOf(it)); close(); } }); }
    else if (e.key === 'Escape') close();
  });
  inp.addEventListener('paste', () => setTimeout(() => { clearTimeout(ti); draw(); }, 0));
  box.addEventListener('click', () => setTimeout(close, 0));
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.hidden = true; });
})();
// Selector de jugador en una hoja (para comparar)
async function pickPlayer(title, exclude, onPick) {
  openSheet(`<div class="sheet-h" style="grid-template-columns:minmax(0,1fr) auto"><div class="nm" id="sheet-title"><span>${esc(title)}</span></div><button class="ibtn" type="button" data-close aria-label="${esc(t('Cerrar'))}" style="color:var(--muted);font-size:22px">×</button></div>
    <div class="pick"><input class="input" id="pk-q" type="search" placeholder="${esc(t('Nombre, ID o enlace'))}" autocomplete="off" autofocus aria-label="${esc(t('Buscar jugador'))}"><div class="pick-l" id="pk-l"><div class="empty">${esc(t('Escribe para buscar'))}</div></div></div>`, 'pick-sheet');
  let rows = []; try { rows = await loadSearch(); } catch {}
  const byId = new Map(rows.map((r) => [String(r[0]), r]));
  const L = $('#pk-l'), inp = $('#pk-q');
  const sug = (exclude.sug || []).map((id) => byId.get(String(id))).filter(Boolean);
  const draw = () => {
    const raw = inp.value.trim(), q = fold(raw), idq = parseIdQuery(raw);
    let out = [];
    if (!q) out = sug.length ? sug : [...FAVS.keys()].map((id) => byId.get(id)).filter(Boolean);
    else if (idq && idq.pid) out = byId.get(idq.pid) ? [byId.get(idq.pid)] : [];
    else { for (const r of rows) { if (String(r[0]) === exclude.id) continue; if (fold(r[1]).includes(q)) out.push(r); if (out.length >= 12) break; } }
    out = out.filter((r) => String(r[0]) !== exclude.id);
    L.innerHTML = out.length ? (!q && sug.length ? `<div class="sgrp-h" style="margin:4px 16px">${esc(t('Sugeridos'))}</div>` : '') + out.map((r) => srow(r, false, true)).join('')
      : `<div class="empty">${esc(q ? t('Ningún jugador con ese nombre todavía.') : t('Escribe para buscar'))}</div>`;
  };
  let ti; inp.addEventListener('input', () => { clearTimeout(ti); ti = setTimeout(draw, 60); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $('[data-pick]', L); if (a) { e.preventDefault(); closeSheet(true); onPick(a.getAttribute('data-pick')); } } });
  L.addEventListener('click', (e) => { const a = e.target.closest('[data-pick]'); if (a) { e.preventDefault(); closeSheet(true); onPick(a.getAttribute('data-pick')); } });
  draw();
}

// ---------- router ----------
// Las direcciones van sin # y en el idioma de cada uno (/jugadores, /players, /jugador/123...; routes.js).
// Por dentro cada página tiene su clave de siempre (#jugadores, #j-123, #m-..., #d-..., #cmp-...): curHash() la saca de
// la dirección, y las antiguas con # o en otro idioma se cambian solas por la buena (syncUrl, sin recargar).
let TOK = 0;
function curHash() {
  if (location.hash.length > 1 && !location.hash.startsWith('#lg-')) return location.hash;   // enlaces antiguos con #
  const k = keyFor(location.pathname);
  return k ? '#' + k : '';
}
// Deja en la barra la dirección buena (sin recargar ni añadir historial)
function syncUrl() {
  const want = (pathFor(curHash(), LANG) || '/') + location.search;
  if (location.pathname + location.search + location.hash !== want) { try { history.replaceState(history.state, '', want); } catch {} }
}
const pageUrl = (h) => location.origin + (pathFor(h, LANG) || '/');
// Ir a una página de la web sin recargar (con las claves #... de siempre)
function navTo(hash, replace = false) {
  const u = (pathFor(hash, LANG) || '/');
  try { if (replace) history.replaceState(null, '', u); else history.pushState(null, '', u); } catch { location.href = u; return; }
  onNav();
}
const ADMIN_ENTRY = 'entrada-ibai';
// Entrada escondida para la app instalada (no tiene barra de direcciones): 5 toques seguidos al logo de SlapScore
// abren la entrada del administrador (o el panel, con la sesión iniciada). Solo pide el token; no da acceso por sí sola.
let brandTaps = [];
document.addEventListener('click', (e) => {
  if (!e.target.closest('.brand')) return;
  const now = Date.now(); brandTaps = brandTaps.filter((x) => now - x < 3000); brandTaps.push(now);
  if (brandTaps.length >= 5) { brandTaps = []; e.preventDefault(); e.stopPropagation(); navTo(isAdmin() ? '#admin' : '#' + ADMIN_ENTRY); }
}, true);
function route() {
  const h = decodeURIComponent(curHash().slice(1));
  if (h.startsWith('m-')) return { view: 'match', ...(parseMatch(h) || {}) };
  if (h.startsWith('j-')) return { view: 'player', pid: h.slice(2) };
  if (h.startsWith('d-')) return { view: 'matches', day: h.slice(2) };
  if (h.startsWith('cmp-')) { const [a, b] = h.slice(4).split('-'); return { view: 'compare', a, b: b || '' }; }
  if (h === 'records' || h === 'récords') return { view: 'records' };
  if (h === 'premios' || h === 'awards') return { view: 'premios' };
  if (h === 'novedades' || h === 'news' || h === 'whatsnew') return { view: 'novedades' };
  // panel de administrador: #admin solo existe con la sesión iniciada (si no, es una dirección cualquiera);
  // para entrar desde otro navegador hay una dirección que no se enlaza en ningún sitio
  if (h === 'admin') return { view: isAdmin() ? 'admin' : 'matches' };
  if (h === ADMIN_ENTRY) return { view: 'admin', entry: true };
  return { view: ['jugadores', 'rankings', 'notas', 'eusl', 'legal'].includes(h) ? h : 'matches' };
}
function setNav(view) {
  const map = { matches: 'partidos', match: 'partidos', player: 'jugadores', compare: 'jugadores', jugadores: 'jugadores', rankings: 'rankings', records: 'records', premios: 'premios', eusl: 'eusl', notas: 'notas', novedades: 'novedades' };
  const k = map[view];
  $$('[data-nav]').forEach((a) => (a.getAttribute('data-nav') === k || (a.dataset.also || '').split(',').includes(k)) ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  const tt = { player: '', match: '', matches: '', jugadores: 'Jugadores', rankings: 'Rankings', records: 'Récords', premios: 'Premios', novedades: 'Novedades', eusl: 'EUSL', notas: 'Cómo puntuamos', compare: 'Comparar jugadores', admin: 'Administrador', legal: 'Aviso legal y privacidad' }[view];
  document.title = tt ? `${t(tt)} · SlapScore` : 'SlapScore';
}
let lastPath = null, lastHash = curHash() || '#', lastView = '';
const SCROLL = new Map(), STACK = [lastHash];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Barra de carga fina bajo la cabecera (solo si la espera se nota)
let barT = 0;
function progress(on) {
  const b = $('#pbar'); if (!b) return;
  clearTimeout(barT);
  if (on) barT = setTimeout(() => b.classList.add('on'), 90);
  else { b.classList.remove('on'); }
}
function pickDay(dayArg) {
  const days = (S.index && S.index.days) || [];
  if (!days.length) return null;
  if (dayArg && S.dayMap.has(dayArg)) return dayArg;
  return S.dayMap.has(today()) ? today() : days[0].d;
}
// Lo que necesita cada vista: se pide antes de cambiar de página
function prefetch(r) {
  if (!S.index) return null;
  if (r.view === 'match' && r.id) return loadMatch(r.key, r.id);
  if (r.view === 'player') return Promise.all([loadP(r.pid), loadAttr(), loadAwards().catch(() => null)]);
  if (r.view === 'premios') return loadAwards();
  if (r.view === 'compare') return Promise.all([loadP(r.a), r.b ? loadP(r.b) : null, loadAttr()]);
  if (r.view === 'jugadores') return loadTable(PF.win);
  if (r.view === 'rankings') return loadRankings();
  if (r.view === 'records') return loadRecords();
  if (r.view === 'eusl') return loadEusl();
  if (r.view === 'matches') { const d = pickDay(r.day); return d ? Promise.all([loadMeta(d).then((m) => firstChunks(d, m)), loadTop(), loadAwards().catch(() => null)]) : null; }
  return null;
}
async function go(opts = {}) {
  const tok = ++TOK;
  syncUrl();
  const r = route(); setNav(r.view);
  const path = r.view + (r.day || r.id || r.pid || (r.a ? r.a + '-' + r.b : ''));
  if (S.booted && path !== lastPath) trackView(r);
  const scroll = !opts.keepScroll && path !== lastPath; lastPath = path;
  const y = opts.restore ? SCROLL.get(curHash() || '#') : null;
  // Con la página anterior aún visible esperamos un momento a los datos: la nueva aparece ya completa, sin esqueletos
  const pre = S.booted ? prefetch(r) : null;
  if (pre) {
    let done = false; const pp = pre.then(() => { done = true; }, () => { done = true; });
    await Promise.race([pp, sleep(opts.silent ? 4000 : 16)]);
    if (!done && !opts.instant && !opts.silent) { progress(true); await Promise.race([pp, sleep(650)]); progress(false); }
    if (!live(tok)) return;
  }
  closeSheet(true); closeCal(); MAIN.onclick = null; S.onResize = null;
  const sameView = r.view === 'matches' && lastView === 'matches'; lastView = r.view;
  const run = () => { const p = render(r, tok); if (y != null) restoreScroll(y, tok); else if (scroll) window.scrollTo(0, 0); return p; };
  const vt = S.booted && !opts.instant && !opts.silent && document.startViewTransition && !REDUCED.matches;
  // Si la página entra con la transición, sus tarjetas no se animan otra vez; si llega más tarde (red lenta), sí
  MAIN.dataset.static = (vt && pre) || opts.silent ? '1' : '0';
  if (vt) {
    // entre días, la tira de días no se difumina: solo cambia la lista
    const root = document.documentElement; if (sameView) root.classList.add('vt-same');
    try { const tr = quiet(document.startViewTransition(() => Promise.race([Promise.resolve(run()).catch(() => {}), sleep(90)]))); tr.finished.finally(() => root.classList.remove('vt-same')).catch(() => {}); }
    catch { root.classList.remove('vt-same'); run(); }
  } else run();
}
function restoreScroll(y, tok) {
  let n = 0;
  const tryIt = () => { if (!live(tok)) return; window.scrollTo(0, y); if (Math.abs(window.scrollY - y) > 4 && n++ < 15) setTimeout(tryIt, 70); };
  requestAnimationFrame(tryIt);
}
// Al cambiar de página: los enlaces #... disparan hashchange; volver atrás entre /j/... y /m/... solo dispara popstate
function onNav() {
  const h = curHash() || '#';
  if (h === lastHash) { syncUrl(); return; }
  SCROLL.set(lastHash, window.scrollY);
  const back = STACK.length > 1 && STACK[STACK.length - 2] === h;
  if (back) STACK.pop(); else { STACK.push(h); if (STACK.length > 60) STACK.shift(); }
  lastHash = h;
  go({ restore: back });
}
window.addEventListener('hashchange', onNav);
window.addEventListener('popstate', onNav);
function render(r, tok) {
  if (!S.index) { MAIN.innerHTML = skeletonList(6); return; }
  if (S.index.v !== 3) { MAIN.innerHTML = `<div class="card empty in"><strong>${esc(t('Actualizando los datos…'))}</strong>${esc(t('Vuelve a cargar la página en un par de minutos.'))}</div>`; return; }
  if (r.view === 'match') return r.id ? viewMatch(r, tok) : notFound(t('Este enlace de partido no es válido.'));
  if (r.view === 'player') return viewPlayer(r.pid, tok);
  if (r.view === 'compare') return viewCompare(r, tok);
  if (r.view === 'jugadores') return viewPlayers(tok);
  if (r.view === 'rankings') return viewRankings(tok);
  if (r.view === 'records') return viewRecords(tok);
  if (r.view === 'premios') return viewAwards(tok);
  if (r.view === 'eusl') return viewEusl(tok);
  if (r.view === 'notas') return viewMethod();
  if (r.view === 'novedades') return viewNews();
  if (r.view === 'legal') return viewLegal(tok);
  if (r.view === 'admin') { if (r.entry && isAdmin()) { navTo('#admin', true); return; } return viewAdmin(tok); }
  return viewMatches(r.day, tok);
}
const live = (tok) => tok === TOK;
function notFound(msg, extra = '') { MAIN.innerHTML = `<div class="card empty in"><strong>${esc(msg)}</strong>${extra}<p><a href="#partidos">${esc(t('Volver a los partidos'))}</a></p></div>`; }
function errorBox(e, retry = true) {
  MAIN.innerHTML = `<div class="card empty in"><strong>${esc(t('No se pudieron cargar los datos.'))}</strong><p>${esc(e && e.message || '')}</p>${retry ? `<button class="btn" type="button" data-retry>${esc(t('Reintentar'))}</button>` : ''}</div>`;
  const b = $('[data-retry]', MAIN); if (b) b.addEventListener('click', () => go({ instant: true }));
}
const skRow = () => `<div class="sk-row"><div class="sk" style="width:42px;height:28px"></div><div style="flex:1;display:flex;flex-direction:column;gap:6px"><div class="sk" style="height:12px;width:70%"></div><div class="sk" style="height:12px;width:55%"></div></div><div class="sk" style="width:34px;height:22px"></div></div>`;
const skeletonList = (n) => `<div class="card">${'<div class="card-h"><div class="sk" style="height:16px;width:160px"></div></div>'}${Array.from({ length: n }, skRow).join('')}</div>`;

// =====================================================================
// PARTIDOS
// =====================================================================
// ---------- selector de día: tira de días seguidos (de más antiguo a hoy) + calendario ----------
const dayAdd = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const DF_WD1 = new Intl.DateTimeFormat(LOC, { weekday: 'short', timeZone: 'UTC' });
const DF_MON = new Intl.DateTimeFormat(LOC, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const wdShort = (d) => DF_WD1.format(dayDate(d)).replace('.', '').toUpperCase();
const K_SUF = { en: 'k', es: ' mil', fr: ' k', de: ' Tsd.', pt: ' mil' }[LANG];
const countShort = (n) => n >= 10000 ? Math.round(n / 1000) + K_SUF : n >= 1000 ? NF1.format(Math.round(n / 100) / 10) + K_SUF : String(n);
const dayN = (d) => { const x = S.dayMap.get(d); return x ? x.n : 0; };
const dmShort = (d) => DF_DM.format(dayDate(d)).replace('.', '');
// días con partidos, de más antiguo a más nuevo
const daysAsc = () => (S.index.days || []).map((x) => x.d).sort();
function prevDay(d) { const a = daysAsc(); let r = null; for (const x of a) { if (x < d) r = x; else break; } return r; }
function nextDay(d) { for (const x of daysAsc()) if (x > d) return x; return null; }
function dayBar(day) {
  const td = today();
  const end = day > td ? day : (dayAdd(day, 10) < td ? dayAdd(day, 10) : td);
  const cells = [];
  for (let d = dayAdd(end, -29); d <= end; d = dayAdd(d, 1)) {
    const n = dayN(d), lbl = d === td ? t('HOY') : d === yesterday() ? t('AYER') : wdShort(d);
    cells.push(`<button type="button" class="day${n ? '' : ' empty'}${d === td ? ' today' : ''}" data-day="${d}" ${n ? '' : 'disabled'} aria-pressed="${d === day}" aria-label="${esc(dayLong(d))}, ${esc(n ? pl(n, 'partido', 'partidos') : t('sin partidos'))}"><small>${lbl}</small><b>${esc(dmShort(d))}</b><i>${n ? countShort(n) : '–'}</i></button>`);
  }
  const p = prevDay(day), nx = nextDay(day);
  return `<div class="days" id="daybar">
    <button class="ibtn" type="button" data-day="${p || ''}" ${p ? '' : 'disabled'} aria-label="${esc(t('Día anterior con partidos'))}" title="${esc(t('Día anterior'))}">${ICON.left}</button>
    <div class="days-list" id="days" role="group" aria-label="${esc(t('Días'))}">${cells.join('')}</div>
    <button class="ibtn" type="button" data-day="${nx || ''}" ${nx ? '' : 'disabled'} aria-label="${esc(t('Día siguiente con partidos'))}" title="${esc(t('Día siguiente'))}">${ICON.right}</button>
    <button class="cal-btn" type="button" id="cal-btn" aria-haspopup="dialog" aria-expanded="false" title="${esc(t('Elegir fecha'))}">${ICON.cal}<span>${esc(day === td ? t('Hoy') : dmShort(day))}</span></button>
  </div>`;
}
let dayKey = false;   // el último cambio de día se hizo con el teclado: mantener el foco en la tira
function goDay(d) { if (!d) return; MF.limit = 120; closeCal(); navTo('#d-' + d); }
function wireDayBar(day) {
  const bar = $('#daybar'); if (!bar) return;
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b && !b.disabled && b.getAttribute('data-day') !== day) goDay(b.getAttribute('data-day')); });
  bar.addEventListener('keydown', (e) => {
    if (e.target.closest('#cal')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const d = e.key === 'ArrowLeft' ? prevDay(day) : nextDay(day); if (d) { e.preventDefault(); dayKey = true; goDay(d); } }
  });
  $('#cal-btn').addEventListener('click', (e) => { e.stopPropagation(); if ($('#cal')) closeCal(); else openCal(day); });
  // el día elegido, centrado en la tira (sin animación)
  const L = $('#days'), cur = $('.day[aria-pressed="true"]', L);
  if (cur) { const lr = L.getBoundingClientRect(), cr = cur.getBoundingClientRect(); L.scrollLeft += (cr.left - lr.left) - (L.clientWidth - cr.width) / 2; }
  if (dayKey && cur) cur.focus({ preventScroll: true });
  dayKey = false;
}
// calendario
let calMonth = '';
addEventListener('resize', () => closeCal(), { passive: true });
function closeCal() { const c = $('#cal'); if (!c) return; c.remove(); const o = $('#cal-ovl'); if (o) o.remove(); const b = $('#cal-btn'); if (b) { b.setAttribute('aria-expanded', 'false'); } document.removeEventListener('click', calOutside, true); }
function calOutside(e) { if (!e.target.closest('#cal') && !e.target.closest('#cal-btn')) closeCal(); }
function openCal(day) {
  closeCal();
  calMonth = day.slice(0, 7);
  const btn = $('#cal-btn'); if (!btn) return;
  const mobile = matchMedia('(max-width:720px)').matches;
  if (mobile) document.body.insertAdjacentHTML('beforeend', '<div class="cal-ovl" id="cal-ovl"></div>');
  document.body.insertAdjacentHTML('beforeend', `<div class="cal" id="cal" role="dialog" aria-label="${esc(t('Elegir fecha'))}"></div>`);
  if (!mobile) {   // bajo el botón, alineado a su derecha
    const r = btn.getBoundingClientRect(), c = $('#cal');
    c.style.top = (r.bottom + scrollY + 8) + 'px';
    c.style.left = Math.max(8, r.right + scrollX - 316) + 'px';
  }
  $('#cal-btn').setAttribute('aria-expanded', 'true');
  drawCal(day);
  setTimeout(() => document.addEventListener('click', calOutside, true), 0);
  const f = $('#cal .cd[aria-pressed="true"]') || $('#cal .cd:not([disabled])'); if (f) f.focus({ preventScroll: true });
}
// iniciales de los días de la semana, de lunes a domingo (5-11 ene 2026 es de lunes a domingo)
const WEEK = LANG === 'es' ? ['L', 'M', 'X', 'J', 'V', 'S', 'D'] : Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(LOC, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 5 + i))));
function drawCal(day) {
  const el = $('#cal'); if (!el) return;
  const [y, m] = calMonth.split('-').map(Number);
  const startWd = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;   // lunes = 0
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const td = today(), all = daysAsc();
  const months = [...new Set(all.map((d) => d.slice(0, 7)))];
  const pm = months.filter((x) => x < calMonth).pop() || '', nm = months.find((x) => x > calMonth) || '';
  const max = Math.max(1, ...all.filter((d) => d.startsWith(calMonth)).map(dayN));
  let cells = '';
  for (let i = 0; i < startWd; i++) cells += '<span></span>';
  for (let i = 1; i <= len; i++) {
    const d = `${calMonth}-${String(i).padStart(2, '0')}`, n = dayN(d);
    const lvl = n ? Math.max(1, Math.ceil(Math.sqrt(n / max) * 4)) : 0;
    cells += `<button type="button" class="cd${d === td ? ' today' : ''}${lvl ? ' l' + lvl : ''}" data-cd="${d}" ${n ? '' : 'disabled'} aria-pressed="${d === day}" aria-label="${esc(dayLong(d))}, ${esc(n ? pl(n, 'partido', 'partidos') : t('sin partidos'))}"><b>${i}</b>${n ? `<i>${countShort(n)}</i>` : ''}</button>`;
  }
  const title = DF_MON.format(new Date(Date.UTC(y, m - 1, 15)));
  const last = all[all.length - 1];
  el.innerHTML = `<div class="cal-h"><button class="ibtn" type="button" data-cm="${pm}" ${pm ? '' : 'disabled'} aria-label="${esc(t('Mes anterior con partidos'))}">${ICON.left}</button><b>${esc(cap(title))}</b><button class="ibtn" type="button" data-cm="${nm}" ${nm ? '' : 'disabled'} aria-label="${esc(t('Mes siguiente con partidos'))}">${ICON.right}</button></div>
    <div class="cal-w">${WEEK.map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal-g">${cells}</div>
    <div class="cal-f"><span class="muted">${esc(t('Más color, más partidos'))}</span>${last ? `<button class="btn sm" type="button" data-cd="${last}">${esc(last === td ? t('Hoy') : t('Último día'))}</button>` : ''}</div>`;
  el.onclick = (e) => {
    const c = e.target.closest('[data-cd]'); if (c && !c.disabled) { goDay(c.getAttribute('data-cd')); return; }
    const mo = e.target.closest('[data-cm]'); if (mo && !mo.disabled) { calMonth = mo.getAttribute('data-cm'); drawCal(day); const f = $('#cal .cd:not([disabled])'); if (f) f.focus({ preventScroll: true }); }
  };
  el.onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeCal(); const b = $('#cal-btn'); if (b) b.focus(); return; }
    const cur = e.target.closest('.cd'); if (!cur) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]; if (!step) return;
    e.preventDefault();
    let d = cur.getAttribute('data-cd');
    for (let k = 0; k < 40; k++) { d = dayAdd(d, step > 0 ? 1 : -1); if (Math.abs(step) === 7 && k < 6) continue; const b = $(`#cal .cd[data-cd="${d}"]`); if (!b) break; if (!b.disabled) { b.focus(); break; } }
  };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#cal')) closeCal(); });

const MF = { type: '', region: '', arena: '', q: '', fav: false, top: false, limit: 120, closed: new Set() };
// Primeros trozos (horas) del día hasta tener unos 120 partidos
function firstChunks(d, meta, need = 120) {
  const out = []; let n = 0;
  for (const c of meta.chunks || []) { if (n >= need) break; out.push(loadChunk(d, c)); n += c.n; }
  return Promise.all(out);
}
let curMatches = null;   // estado de la lista visible (para la actualización automática)
async function viewMatches(dayArg, tok) {
  const days = (S.index.days || []);
  if (!days.length) { MAIN.innerHTML = `<div class="card empty"><strong>${esc(t('Todavía no hay partidos.'))}</strong>${esc(t('El robot rastrea slapshot.gg sin parar y publica cada pocos minutos.'))}</div>`; return; }
  const day = pickDay(dayArg);
  const idx = days.findIndex((d) => d.d === day);
  MAIN.innerHTML = `<div class="layout">
    <h1 class="sr-only">${esc(t('Partidos'))} · ${esc(dayLong(day))}</h1>
    <aside class="col col-left" id="m-left" aria-label="${esc(t('Filtros'))}">${skeletonList(4)}</aside>
    <section class="col" aria-label="${esc(t('Partidos'))}">
      ${newsBanner()}<div class="card">
        ${dayBar(day)}
        <div class="filters" id="m-filters"></div>
        <div class="upd" id="m-upd" hidden></div>
      </div>
      <div id="m-live" class="only-mobile"></div>
      <div id="m-favs" class="only-mobile"></div>
      <div id="m-lead" class="only-mobile"></div>
      <div id="m-list" class="col">${skeletonList(8)}</div>
    </section>
    <aside class="col" id="m-right" aria-label="${esc(t('Destacados'))}">${skeletonList(5)}</aside>
  </div>`;
  wireDayBar(day);
  let meta, top;
  try { [meta, top] = await Promise.all([loadMeta(day), loadTop().catch(() => null)]); }
  catch (e) { if (live(tok)) errorBox(e); return; }
  if (!live(tok)) return;
  const st = { day, meta, lists: [], next: 0, tok };
  curMatches = st;
  drawFilters(st); drawLeft(st); drawUpd();
  const ml = $('#m-lead'); if (ml) ml.innerHTML = leadersCard(meta, day);
  drawRight(st, top);
  drawFavs(st);
  await refreshList(st);
  // días de al lado, ya preparados para cuando cambies
  idle(() => { for (const d of [days[idx + 1], days[idx - 1]]) if (d) loadMeta(d.d).then((m) => firstChunks(d.d, m)).catch(() => {}); });
}
// Hoy: cuándo se actualizaron los datos por última vez (el robot publica cada 3-4 min y la lista se pone al día sola)
function drawUpd() {
  const el = $('#m-upd'); if (!el) return;
  const r = route(), at = S.index && Date.parse(S.index.updated);
  const on = !!at && r.view === 'matches' && pickDay(r.day) === today();
  el.hidden = !on; if (!on) return;
  const fresh = Date.now() - at < 10 * 60_000;
  el.innerHTML = `<span class="dot${fresh ? ' pulse' : ''}" style="color:${fresh ? 'var(--win)' : 'var(--faint)'}"></span>${esc(t('Actualizado {x} · se actualiza solo', { x: ago(at) }))}`;
}
setInterval(() => { if (!document.hidden) drawUpd(); }, 30_000);
// recuentos del día: exactos aunque todavía no se hayan cargado todos los partidos
function countBy(st, f, filt) {
  const c = new Map();
  for (const x of st.meta.counts || []) { if (filt && !filt(x)) continue; c.set(x[f], (c.get(x[f]) || 0) + x[3]); }
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
}
const byType = (x) => !MF.type || x[0] === MF.type;
const loadedRows = (st) => { const out = []; for (const l of st.lists) for (const m of l) if (!S.hidden.has(m.i)) out.push(m); return out; };
const localFilter = () => !!(MF.q.trim() || MF.fav || MF.top);   // filtros que obligan a mirar todos los partidos del día
async function moreChunks(st, need) {
  const chunks = st.meta.chunks || [];
  const all = localFilter();
  while (st.next < chunks.length && (all || filtered(loadedRows(st)).length < need)) {
    const batch = chunks.slice(st.next, all ? chunks.length : st.next + 2); st.next += batch.length;
    st.lists.push(...await Promise.all(batch.map((c) => loadChunk(st.day, c))));
  }
}
let listSeq = 0;
async function refreshList(st) {
  if (!live(st.tok)) return;   // un temporizador de una vista anterior no debe tocar la actual
  const seq = ++listSeq, el = $('#m-list');
  if (el && el.dataset.ready && st.next < (st.meta.chunks || []).length) el.classList.add('busy');
  try { await moreChunks(st, MF.limit); } catch { if (live(st.tok) && seq === listSeq) toast(t('No se pudieron cargar más partidos. Comprueba tu conexión.')); }
  if (el) el.classList.remove('busy');
  if (!live(st.tok) || seq !== listSeq) return;
  drawList(st);
}
function drawFilters(st) {
  const el = $('#m-filters'); if (!el) return;
  const types = countBy(st, 0);
  if (MF.fav && !FAVS.size) MF.fav = false;
  el.innerHTML = `<div class="chips" role="group" aria-label="${esc(t('Tipo de partida'))}"><button type="button" class="chip" data-t="" aria-pressed="${!MF.type}">${esc(t('Todos'))} <span class="n">${int(st.meta.n)}</span></button>${types.sort((x, y) => (x[0] === 'custom') - (y[0] === 'custom')).map(([y, n]) => `<button type="button" class="chip${y === 'custom' ? ' cu' : ''}" data-t="${esc(y)}" aria-pressed="${MF.type === y}">${y === 'custom' ? '<span class="cu-dot" aria-hidden="true"></span>' : ''}${esc(typeLabel(y))} <span class="n">${int(n)}</span></button>`).join('')}
      ${S.featured.size ? `<button type="button" class="chip tg" data-x="top" aria-pressed="${MF.top}" title="${esc(t('Partidos con jugadores destacados: los seguidos y los de más MMR'))}">${ICON.bolt}${esc(t('Destacados'))}</button>` : ''}
      ${FAVS.size ? `<button type="button" class="chip tg" data-x="fav" aria-pressed="${MF.fav}" title="${esc(t('Partidos de tus favoritos'))}">${ICON.star}${esc(t('Favoritos'))}</button>` : ''}</div>
    <input class="input" id="m-q" type="search" placeholder="${esc(t('Filtrar por jugador'))}" value="${esc(MF.q)}" autocomplete="off" aria-label="${esc(t('Filtrar partidos por jugador'))}">
    <select class="select only-narrow" id="m-region" aria-label="${esc(t('Región'))}"></select>
    <select class="select only-narrow" id="m-arena" aria-label="${esc(t('Arena'))}"></select>`;
  drawSelects(st);
  $$('[data-t]', el).forEach((b) => b.addEventListener('click', () => { MF.type = b.getAttribute('data-t'); MF.limit = 120; $$('[data-t]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawLeft(st); drawSelects(st); refreshList(st); }));
  $$('[data-x]', el).forEach((b) => b.addEventListener('click', () => { const k = b.getAttribute('data-x'); MF[k] = !MF[k]; MF.limit = 120; b.setAttribute('aria-pressed', String(MF[k])); if (k === 'fav') $$('[data-favf]').forEach((x) => { x.setAttribute('aria-pressed', String(MF.fav)); x.textContent = MF.fav ? t('Ver todos') : t('Ver sus partidos'); }); refreshList(st); }));
  let tq; $('#m-q').addEventListener('input', (e) => { clearTimeout(tq); tq = setTimeout(() => { MF.q = e.target.value; MF.limit = 120; refreshList(st); }, 160); });
  $('#m-region').addEventListener('change', (e) => { MF.region = e.target.value; MF.limit = 120; drawLeft(st); refreshList(st); });
  $('#m-arena').addEventListener('change', (e) => { MF.arena = e.target.value; MF.limit = 120; drawLeft(st); refreshList(st); });
}
function drawSelects(st) {
  const r = $('#m-region'), a = $('#m-arena'); if (!r || !a) return;
  r.innerHTML = `<option value="">${esc(t('Región'))}</option>${countBy(st, 1, byType).map(([v, n]) => `<option value="${esc(v)}" ${MF.region === v ? 'selected' : ''}>${esc(regionLabel(v))} (${int(n)})</option>`).join('')}`;
  a.innerHTML = `<option value="">${esc(t('Arena'))}</option>${countBy(st, 2, byType).map(([v, n]) => `<option value="${esc(v)}" ${MF.arena === v ? 'selected' : ''}>${esc(v || t('Sin arena'))} (${int(n)})</option>`).join('')}`;
}
function filtered(list) {
  const q = fold(MF.q.trim());
  return list.filter((m) => (!MF.type || m.y === MF.type) && (!MF.region || m.r === MF.region) && (!MF.arena || m.a === MF.arena) && (!q || m.p.some((p) => fold(p[1]).includes(q)))
    && (!MF.fav || m.p.some((p) => FAVS.has(String(p[0])))) && (!MF.top || m.p.some((p) => S.featured.has(String(p[0])))));
}
function drawLeft(st) {
  const el = $('#m-left'); if (!el) return;
  const block = (title, f, key, fmt) => {
    const c = countBy(st, f, byType);
    if (!c.length) return '';
    return `<div class="card"><div class="card-h"><h3>${esc(title)}</h3></div><div class="flist" style="padding-bottom:8px">
      <button type="button" data-f="${key}" data-v="" aria-pressed="${!MF[key]}">${esc(t('Todas'))} <span class="n">${int(c.reduce((a, x) => a + x[1], 0))}</span></button>
      ${c.map(([v, n]) => `<button type="button" data-f="${key}" data-v="${esc(v)}" aria-pressed="${MF[key] === v}">${fmt(v)} <span class="n">${int(n)}</span></button>`).join('')}</div></div>`;
  };
  el.innerHTML = block(t('Regiones'), 1, 'region', (v) => `<span class="region">${esc(regionShort(v))}</span>${esc(regionLabel(v))}`) + block(t('Arenas'), 2, 'arena', (v) => esc(v || t('Sin arena'))) + activityCard(st);
  $$('[data-f]', el).forEach((b) => b.addEventListener('click', () => { MF[b.getAttribute('data-f')] = b.getAttribute('data-v'); MF.limit = 120; drawLeft(st); drawSelects(st); refreshList(st); }));
}
// Partidos por hora del día (hora de Madrid), de los trozos por hora del resumen del día
function activityCard(st) {
  const ch = (st.meta.chunks || []).filter((c) => /^\d\d$/.test(c.c)); if (!ch.length) return '';
  const per = new Array(24).fill(0); for (const c of ch) per[Number(c.c)] += c.n;
  const max = Math.max(1, ...per), peak = per.indexOf(Math.max(...per)), nowH = st.day === today() ? Number(C.madrid(Date.now()).hour) : -1;
  return `<div class="card in act"><div class="card-h"><h3>${esc(t('Actividad'))}</h3><small>${esc(t('hora de Madrid'))}</small></div>
    <div class="act-b" role="img" aria-label="${esc(t('Partidos por hora'))}">${per.map((n, h) => `<span class="${h === peak ? 'pk' : ''}${h === nowH ? ' now' : ''}" style="height:${Math.max(n ? 6 : 2, Math.round(n / max * 100))}%" title="${String(h).padStart(2, '0')}:00 · ${esc(pl(n, 'partido', 'partidos'))}"></span>`).join('')}</div>
    <div class="act-x"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    <p class="muted act-n">${esc(t('Hora punta: {h}:00 · {n}', { h: String(peak).padStart(2, '0'), n: pl(per[peak], 'partido', 'partidos') }))}</p></div>`;
}
// Avisos de favoritos: con los partidos de hoy abiertos, cuando entra un partido nuevo de un favorito sale un aviso con enlace
const FAVSEEN = new Set(); let favSince = 0;
function favAlerts(st) {
  if (!FAVS.size || st.day !== today()) return;
  const first = !favSince; if (first) favSince = Date.now();
  const news = [];
  for (const m of loadedRows(st)) {
    if (FAVSEEN.has(m.i)) continue; FAVSEEN.add(m.i);
    if (first || m.t < favSince - 3 * 60_000) continue;   // lo que ya estaba al abrir la página, o más antiguo, no avisa
    const p = m.p.find((x) => isFav(x[0])); if (p) news.push([m, p]);
  }
  for (const [m, p] of news.slice(-3)) {
    const me = p[2], r = m.w === me ? 'W' : m.w === 1 - me ? 'L' : 'D';
    const el = document.createElement('a'); el.className = 'toast fav-toast'; el.href = matchHref(m.k, m.i);
    el.textContent = `★ ${p[1]} · ${resLetter(r)} ${m.s[me]}-${m.s[1 - me]} · ${t('Nota')} ${dec(p[3])}`;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 7000);
  }
}
function drawList(st) {
  const el = $('#m-list'); if (!el) return;
  el.dataset.ready = '1';
  try { favAlerts(st); } catch {}
  const rows = filtered(loadedRows(st));
  if (!rows.length) {
    const why = MF.fav ? t('Tus favoritos no han jugado este día.') : MF.top ? t('Ningún destacado ha jugado este día con estos filtros.') : t('Prueba a quitar algún filtro o cambia de día.');
    el.innerHTML = `<div class="card empty in"><strong>${esc(t('Ningún partido con estos filtros.'))}</strong>${esc(why)}</div>`; return;
  }
  const q = fold(MF.q.trim()), local = localFilter();
  // total de cada grupo (tipo + región): del resumen del día, o de lo cargado si se filtra por nombre o favoritos
  const tot = new Map();
  if (local) for (const m of rows) tot.set(m.y + '|' + m.r, (tot.get(m.y + '|' + m.r) || 0) + 1);
  else for (const x of st.meta.counts || []) if (byType(x) && (!MF.region || x[1] === MF.region) && (!MF.arena || x[2] === MF.arena)) tot.set(x[0] + '|' + x[1], (tot.get(x[0] + '|' + x[1]) || 0) + x[3]);
  const groups = new Map();
  for (const m of rows) { const k = m.y + '|' + m.r; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  let budget = MF.limit, html = '', shown = 0;
  for (const [k, ms] of [...groups.entries()].sort((a, b) => (tot.get(b[0]) || b[1].length) - (tot.get(a[0]) || a[1].length))) {
    if (budget <= 0) break;
    const [y, r] = k.split('|'); const part = ms.slice(0, budget); budget -= part.length; shown += part.length;
    const open = !MF.closed.has(k), cu = isCustom(y);
    html += `<div class="card grp${cu ? ' cu' : ''} in" data-open="${open}" data-k="${esc(k)}"><button class="grp-h" type="button" aria-expanded="${open}"><span class="region">${esc(regionShort(r))}</span>${cu ? `<span class="ty-cu">${esc(t('Custom'))}</span>` : esc(typeLabel(y))}<span class="sub">${esc(regionLabel(r))}</span><span class="n">${int(Math.max(tot.get(k) || 0, ms.length))}</span>${ICON.down}</button>
      <div class="grp-b"><div>${part.map((m) => evRow(m, q)).join('')}</div></div></div>`;
  }
  const total = Math.max(rows.length, [...tot.values()].reduce((a, b) => a + b, 0));
  if (total > shown) html += `<div class="card more"><button class="btn" type="button" id="m-more">${esc(t('Ver más partidos ({n})', { n: int(total - shown) }))}</button></div>`;
  el.innerHTML = html;
  const byId = new Map(rows.map((m) => [m.i, m]));
  el.onclick = (e) => {
    const b = e.target.closest('.ev-x'); if (!b) return;
    const w = b.closest('.evw'), box = $('.ev-box', w), m = byId.get(w.getAttribute('data-i'));
    const open = b.getAttribute('aria-expanded') !== 'true';
    if (open && !box.dataset.ready && m) { $('.ev-box-in', box).innerHTML = evBox(m); box.dataset.ready = '1'; }
    b.setAttribute('aria-expanded', String(open)); box.classList.toggle('open', open);
  };
  $$('.grp-h', el).forEach((b) => b.addEventListener('click', () => {
    const g = b.closest('.grp'); const k = g.getAttribute('data-k'); const open = g.getAttribute('data-open') !== 'true';
    g.setAttribute('data-open', String(open)); b.setAttribute('aria-expanded', String(open)); open ? MF.closed.delete(k) : MF.closed.add(k);
  }));
  const more = $('#m-more'); if (more) more.addEventListener('click', () => { more.disabled = true; MF.limit += 120; refreshList(st); });
}
// nombre en las listas: favoritos con estrella, destacados en negrita, coincidencias del filtro resaltadas
// insignia de quien apoya el proyecto (Ko-fi): un corazón junto al nombre
const supMark = (id) => (S.sup && S.sup.has(String(id)) ? '<span class="sup" role="img" aria-label="Supporter" title="Supporter">♥</span>' : '');
function pname(p, q) {
  const id = String(p[0]), nm = esc(p[1]);
  const inner = q && fold(p[1]).includes(q) ? `<span class="hl">${nm}</span>` : nm;
  return `${FAVS.has(id) ? '<span class="fv">★</span>' : ''}${S.featured.has(id) ? `<b class="ft">${inner}</b>` : inner}${supMark(id)}`;
}
function evRow(m, q) {
  const side = (tm) => `<div class="ev-team${m.w === tm ? ' won' : ''}">${crest(tm, 18)}<span class="names">${m.p.filter((p) => p[2] === tm).map((p) => pname(p, q)).join(', ')}</span></div>`;
  const mvp = m.p[m.v];
  const status = m.o ? `<span class="ot">${esc(t('Prór.'))}</span>` : m.pd ? esc(t('{n} per.', { n: m.pd[m.pd.length - 1].n })) : esc(m.e === 'Tie' ? t('Empate') : m.e === 'Forfeit' ? t('Rend.') : /Left$/.test(m.e) ? t('Aband.') : t('Final'));
  return `<div class="evw" data-i="${esc(m.i)}"><a class="ev" href="${matchHref(m.k, m.i)}"><div class="ev-time"><b>${DF_TIME.format(new Date(m.t))}</b><span>${status}</span></div>
    <div class="ev-teams">${side(0)}${side(1)}</div>
    <div class="ev-score"><span class="${m.w === 0 ? 'won' : ''}">${m.s[0]}</span><span class="${m.w === 1 ? 'won' : ''}">${m.s[1]}</span></div>
    <div class="ev-mvp" title="${mvp ? esc(t('MVP: {n}', { n: mvp[1] })) : ''}">${mvp ? badge(mvp[3]) : ''}</div></a>
    <button class="ev-x" type="button" aria-expanded="false" aria-label="${esc(t('Ver las estadísticas de los jugadores'))}">${ICON.down}</button>
    <div class="ev-box"><div><div class="ev-box-in"></div></div></div></div>`;
}
// Estadísticas de todos los jugadores de un partido, desde el resumen del día
const MINI = [['Nota', 3], ['G', 4, 'Goles'], ['A', 5, 'Asistencias'], ['TIR', 8, 'Tiros'], ['PAR', 9, 'Paradas'], ['PAS', 10, 'Pases'], ['ROB', 12, 'Robos'], ['BLQ', 13, 'Bloqueos'], ['PTS', 11, 'Puntos de juego']];
function evBox(m) {
  const best = MINI.map(([, i]) => i === 3 ? null : Math.max(0, ...m.p.map((p) => typeof p[i] === 'number' ? p[i] : 0)));
  const row = (p) => `<tr><td><a class="pc" href="#j-${esc(p[0])}">${rank(p[6], 20, { approx: p[7] })}<span class="nm">${pname(p)}</span></a></td>${MINI.map(([, i], k) => i === 3 ? `<td>${badge(p[3])}</td>`
    : `<td class="${typeof p[i] === 'number' && p[i] > 0 && p[i] === best[k] ? 'best' : ''}">${typeof p[i] === 'number' ? int(p[i]) : '–'}</td>`).join('')}</tr>`;
  return `<div class="tscroll"><table class="tbl evt"><thead><tr><th>${esc(t('Jugador'))}</th>${MINI.map(([l, , ti]) => `<th${ti ? ` title="${esc(t(ti))}"` : ''}>${esc(t(l))}</th>`).join('')}</tr></thead><tbody>
    ${[0, 1].map((tm) => `<tr class="tg"><td colspan="${MINI.length + 1}"><span class="pc">${crest(tm, 16)}${esc(teamName(tm))} · ${m.s[tm]}</span></td></tr>` + m.p.filter((p) => p[2] === tm).sort((a, b) => b[3] - a[3]).map(row).join('')).join('')}
  </tbody></table></div><div class="ev-box-f">${m.pd ? `<span class="muted">${esc(t('Periodos'))}: ${m.pd.map((x) => `${x.s[0]}-${x.s[1]}`).join(' · ')}</span>` : ''}<a href="${matchHref(m.k, m.i)}">${esc(t('Ver el partido completo'))}</a></div>`;
}
function leadersCard(meta, day, cls = '') {
  const L = (meta && meta.lead) || []; if (!L.length) return '';
  return `<div class="card in ${cls}"><div class="card-h"><h3>${esc(t('Líderes del día'))}</h3><small>${esc(dayLong(day))}</small></div><div class="tscroll"><table class="tbl lead"><thead><tr><th>${esc(t('Jugador'))}</th><th title="${esc(t('Partidos jugados'))}">${esc(t('PJ'))}</th><th title="${esc(t('Goles'))}">${esc(t('G'))}</th><th title="${esc(t('Asistencias'))}">${esc(t('A'))}</th><th title="${esc(t('Goles más asistencias'))}">${esc(t('G+A'))}</th><th>${esc(t('Nota'))}</th></tr></thead><tbody>
    ${L.map((x, i) => `<tr class="${i >= 5 ? 'xtra' : ''}"><td><a class="pc" href="#j-${esc(x.id)}"><span class="i">${i + 1}</span>${rank(x.rk, 20)}<span class="nm">${pname([x.id, x.n])}</span></a></td><td>${x.gp}</td><td>${x.g}</td><td>${x.a}</td><td><b>${x.g + x.a}</b></td><td>${badge(x.rs / x.gp)}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}
function supportCard(cls = '') {
  const url = supportUrl(); if (!url) return '';
  return `<div class="card in support ${cls}"><div class="card-b"><b>${esc(t('SlapScore es gratis y sin anuncios'))}</b><p>${esc(t('Lo hace un jugador de la comunidad. Si te resulta útil, puedes ayudar a mantenerlo.'))}</p><a class="btn kofi" href="${esc(url)}" target="_blank" rel="noopener">${ICON.coffee}${esc(t('Invítame a un café'))}</a></div></div>`;
}
// ---------- buzón de sugerencias ----------
// La web y su API (Worker de Cloudflare) están en la misma dirección: el token del administrador nunca sale de ella
function apiBase() { return ''; }

// ---------- visitas (estadísticas anónimas del panel de administrador) ----------
// Sin cookies ni identificadores: la web solo avisa de qué página se ve (y, en la primera, de qué dominio viene),
// el tipo de dispositivo, el idioma y si es la app instalada. El servidor cuenta personas con un resumen cifrado que
// cambia cada mes y no guarda la IP. No se cuenta al administrador ni a los navegadores automáticos.
const NOTRACK_KEY = 'slapscore-notrack';
const TRK = { started: false, vis: 0, acc: 0 };
function trackable() {
  if (!S.booted || navigator.webdriver || location.protocol !== 'https:' || isAdmin()) return false;
  // quien pide no ser rastreado (No rastrear / Global Privacy Control) no se cuenta
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return false;
  try { if (localStorage.getItem(NOTRACK_KEY)) return false; } catch {}
  return true;
}
// fetch con keepalive (llega aunque se cierre la página) y no sendBeacon: los bloqueadores de anuncios que desactivan
// el «hyperlink auditing» (uBlock Origin, por defecto) también bloquean sendBeacon en Chrome
function beacon(o) {
  const url = apiBase() + '/api/v', body = JSON.stringify(o);
  try { fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(() => {}); }
  catch { try { navigator.sendBeacon && navigator.sendBeacon(url, body); } catch {} }
}
function pageKey(r) {
  switch (r.view) {
    case 'player': { const id = String(r.pid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); return id ? 'j:' + id : null; }
    case 'match': return 'partido';
    case 'compare': return 'cmp';
    case 'jugadores': return 'tabla';
    case 'rankings': case 'records': case 'premios': case 'eusl': case 'notas': case 'legal': case 'novedades': return r.view;
    case 'admin': return null;
    default: return r.day && r.day !== today() ? 'dia' : 'home';
  }
}
const devKind = () => { const m = Math.min(screen.width || 0, screen.height || 0); return !matchMedia('(pointer: coarse)').matches ? 'd' : m >= 600 ? 't' : 'm'; };
const OLD_HOST = /\.(github\.io|workers\.dev)$/;   // direcciones antiguas de la web
function trackView(r) {
  const p = pageKey(r);
  if (!p || !trackable()) return;
  const o = { k: 0, p, d: devKind(), l: String(navigator.language || '').slice(0, 2).toLowerCase(), s: LANG, a: standalone() ? 1 : 0 };
  if (!TRK.started) {
    TRK.started = true; engOn();
    try { const q = new URLSearchParams(location.search); const v = q.get('ref') || q.get('utm_source'); if (v) o.q = v.slice(0, 40); } catch {}
    // de dónde viene: si llegó redirigido desde la dirección antigua, la página de origen va en ?rf=
    try {
      const q = new URLSearchParams(location.search), rf = q.get('rf');
      const h = rf || (document.referrer ? new URL(document.referrer).hostname : '');
      if (h && h !== location.hostname && !OLD_HOST.test(h)) o.r = h.slice(0, 80);
      if (rf) { q.delete('rf'); const qs = q.toString(); history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash); }
    } catch {}
  }
  beacon(o);
}
function trackEvent(name) { if (TRK.started && trackable()) beacon({ k: 2, p: name }); }
// tiempo con la página a la vista: se manda al ocultarla (cambiar de pestaña, bloquear el móvil, cerrar)
function engOn() { if (!document.hidden && !TRK.vis) TRK.vis = Date.now(); }
function engFlush() {
  if (TRK.vis) { TRK.acc += Date.now() - TRK.vis; TRK.vis = 0; }
  const n = Math.round(TRK.acc / 1000); TRK.acc = 0;
  if (n >= 1 && TRK.started && trackable()) beacon({ k: 1, n: Math.min(n, 1800) });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) engFlush(); else if (TRK.started) engOn(); });
addEventListener('pagehide', engFlush);
function feedbackCard(cls = '') {
  return `<div class="card in fb-card ${cls}"><div class="card-b"><b>${ICON.chat}${esc(t('¿Ideas o errores?'))}</b><p>${esc(t('Cuéntanos qué mejorarías, qué falta o qué no funciona. Lo leemos todo.'))}</p><button class="btn" type="button" data-fb>${esc(t('Enviar sugerencia'))}</button></div></div>`;
}
const FB = { type: 'idea', text: '', contact: '' };   // borrador mientras no se envía
const FB_TYPES = [['idea', 'Idea'], ['bug', 'Error'], ['other', 'Otro']];
function openFeedback() {
  const ovl = openSheet(`<div class="sheet-h" style="grid-template-columns:minmax(0,1fr) auto"><div class="nm" id="sheet-title"><span>${esc(t('Buzón de sugerencias'))}</span></div><button class="ibtn" type="button" data-close aria-label="${esc(t('Cerrar'))}" style="color:var(--muted);font-size:22px">×</button></div>
    <form class="fb-form" id="fb-form" novalidate>
      <p class="muted" style="margin:0">${esc(t('Propuestas, errores de la web, ideas… lo que quieras. Lo lee quien hace SlapScore.'))}</p>
      <div class="chips" role="radiogroup" aria-label="${esc(t('Tipo de mensaje'))}">${FB_TYPES.map(([k, l]) => `<button type="button" class="chip" role="radio" data-fbt="${k}" aria-checked="${FB.type === k}" aria-pressed="${FB.type === k}">${esc(t(l))}</button>`).join('')}</div>
      <div class="field"><label for="fb-text">${esc(t('Tu mensaje'))}</label><textarea class="input fb-ta" id="fb-text" maxlength="2000" rows="5" required autofocus placeholder="${esc(t('Por ejemplo: estaría bien poder filtrar por arena en los rankings'))}">${esc(FB.text)}</textarea><small class="muted fb-n" id="fb-n"></small></div>
      <div class="field"><label for="fb-contact">${esc(t('Discord o email (opcional)'))}</label><input class="input" id="fb-contact" maxlength="120" autocomplete="off" value="${esc(FB.contact)}" placeholder="${esc(t('Solo si quieres que te respondamos'))}"></div>
      <input class="fb-hp" name="website" id="fb-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="muted fb-note">${esc(t('Junto al mensaje se envía la página en la que estás, para poder ver el error.'))} <a href="#legal">${esc(t('Privacidad'))}</a></p>
      <p class="err" id="fb-err" role="alert" hidden></p>
      <div class="fb-acts"><button class="btn primary" type="submit" id="fb-send">${esc(t('Enviar'))}</button></div>
    </form>`, 'fb-sheet');
  const form = $('#fb-form', ovl), ta = $('#fb-text', ovl), ct = $('#fb-contact', ovl), err = $('#fb-err', ovl), send = $('#fb-send', ovl), cnt = $('#fb-n', ovl);
  const count = () => { cnt.textContent = ta.value.length > 1500 ? `${ta.value.length} / 2000` : ''; };
  count();
  ta.addEventListener('input', () => { FB.text = ta.value; count(); });
  ct.addEventListener('input', () => { FB.contact = ct.value; });
  $$('[data-fbt]', ovl).forEach((b) => b.addEventListener('click', () => { FB.type = b.getAttribute('data-fbt'); $$('[data-fbt]', ovl).forEach((x) => { const on = x === b; x.setAttribute('aria-checked', String(on)); x.setAttribute('aria-pressed', String(on)); }); }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    const fail = (msg) => { err.textContent = msg; err.hidden = false; send.disabled = false; send.textContent = t('Enviar'); };
    if (text.length < 5) { fail(t('Escribe un poco más (al menos 5 letras).')); ta.focus(); return; }
    err.hidden = true; send.disabled = true; send.textContent = t('Enviando…');
    let r;
    try {
      r = await fetch(apiBase() + '/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: FB.type, text, contact: ct.value.trim(), page: curHash() || '#', lang: LANG, website: $('#fb-hp', ovl).value }) });
    } catch { return fail(t('No se pudo enviar. Comprueba tu conexión e inténtalo otra vez.')); }
    if (!r.ok) {
      let code = ''; try { code = (await r.json()).error || ''; } catch {}
      return fail(code === 'wait' ? t('Acabas de enviar un mensaje: espera un minuto para mandar otro.') : code === 'full' ? t('Hoy hemos recibido muchísimos mensajes. Prueba mañana, por favor.')
        : code === 'short' ? t('Escribe un poco más (al menos 5 letras).') : t('El buzón no está disponible ahora mismo. Prueba más tarde.'));
    }
    FB.text = ''; FB.contact = ''; trackEvent('feedback');
    const sh = $('.sheet', ovl);
    sh.innerHTML = `<div class="sheet-h" style="grid-template-columns:minmax(0,1fr) auto"><div class="nm" id="sheet-title"><span>${esc(t('¡Gracias!'))}</span></div><button class="ibtn" type="button" data-close aria-label="${esc(t('Cerrar'))}" style="color:var(--muted);font-size:22px">×</button></div>
      <div class="fb-form"><p style="margin:0">${esc(t('Hemos recibido tu mensaje. Cada sugerencia se lee y ayuda a decidir qué mejorar.'))}</p><div class="fb-acts"><button class="btn primary" type="button" data-close>${esc(t('Cerrar'))}</button></div></div>`;
    const c = $('[data-close]', sh); if (c) c.focus({ preventScroll: true });
  });
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-fb]')) { e.preventDefault(); openFeedback(); } });

// Favoritos: tarjeta en la columna derecha (escritorio) y tira deslizable encima de la lista (móvil)
function drawFavs(st) {
  const right = $('#fav-card'), strip = $('#m-favs');
  if (!FAVS.size) {
    if (right) right.innerHTML = `<div class="card-h"><h3>${esc(t('Tus favoritos'))}</h3></div><div class="card-b muted" style="font-size:13px">${t('Pulsa la estrella {s} en el perfil de un jugador para tenerlo aquí y filtrar sus partidos.', { s: `<span class="fv">★</span>` })}</div>`;
    if (strip) strip.innerHTML = '';
    return;
  }
  const ids = [...FAVS.keys()].slice(0, 12);
  const playedToday = new Set(); for (const x of st.meta.lead || []) playedToday.add(String(x.id));
  const item = (id, P) => {
    const n = (P && P.n) || FAVS.get(id), g = P && P._g && P._g[0];
    const sub = g ? `${resLetter(g.r)} ${g.gf}-${g.ga} · ${ago(g.t)}` : t('sin partidos recientes');
    return { id, n, rk: P && P.meta ? P.meta.rk : '', g, sub };
  };
  const paint = (list) => {
    if (!live(st.tok)) return;
    if (right) right.innerHTML = `<div class="card-h"><h3>${esc(t('Tus favoritos'))}</h3><span class="fav-acts">${pushBtn()}<button class="btn sm" type="button" data-favf aria-pressed="${MF.fav}">${esc(MF.fav ? t('Ver todos') : t('Ver sus partidos'))}</button></span></div><div style="padding-bottom:8px">${list.map((x) =>
      `<a class="lrow" href="#j-${esc(x.id)}"><span class="i">${ICON.star}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t">${esc(x.n)}${supMark(x.id)}</span>${rank(x.rk, 20)}</span><span class="sub">${esc(x.sub)}</span></span>${x.g ? badge(x.g.rt) : ''}</a>`).join('')}</div>`;
    if (strip) strip.innerHTML = `<div class="favs-h"><b>${ICON.star}${esc(t('Tus favoritos'))}</b><span class="fav-acts">${pushBtn()}<button class="btn sm" type="button" data-favf aria-pressed="${MF.fav}">${esc(MF.fav ? t('Ver todos') : t('Ver sus partidos'))}</button></span></div>
      <div class="favs" role="list">${list.map((x) => `<a role="listitem" href="#j-${esc(x.id)}" class="fav-i">${avatar(x.n, x.id, 'sm')}<span class="t">${esc(x.n)}</span>${x.g ? badge(x.g.rt) : ''}</a>`).join('')}</div>`;
    $$('[data-favf]').forEach((b) => b.addEventListener('click', () => { MF.fav = !MF.fav; MF.limit = 120; const c = $('[data-x="fav"]'); if (c) c.setAttribute('aria-pressed', String(MF.fav)); drawFavs(st); refreshList(st); }));
  };
  paint(ids.map((id) => item(id, null)));
  Promise.all(ids.map((id) => loadP(id).catch(() => null))).then((ps) => paint(ids.map((id, i) => item(id, ps[i]))
    .sort((a, b) => (playedToday.has(b.id) - playedToday.has(a.id)) || ((b.g ? b.g.t : 0) - (a.g ? a.g.t : 0)))));
}
// Destacados que acaban de jugar (último partido hace menos de 25 min): solo en la lista de hoy
const liveList = () => ((S.index && S.index.live) || []).filter((x) => Date.now() - x.t < 40 * 60_000);
function liveCard(day, cls = '') {
  const L = day === today() ? liveList() : []; if (!L.length) return '';
  return `<div class="card in live-card ${cls}"><div class="card-h"><h3><span class="dot pulse"></span>${esc(t('Jugando ahora'))}</h3><small>${esc(t('destacados'))}</small></div><div style="padding-bottom:8px">${L.slice(0, 6).map((x) =>
    `<a class="lrow" href="#j-${esc(x.id)}"><span class="i"></span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t">${esc(x.n)}${supMark(x.id)}</span>${rank(x.rk, 20)}</span><span class="sub">${esc(t('último partido {x}', { x: ago(x.t) }))}</span></span>${ICON.right}</a>`).join('')}</div></div>`;
}
function liveStrip(day) {
  const L = day === today() ? liveList() : []; if (!L.length) return '';
  return `<div class="live-strip"><span class="lbl"><span class="dot pulse"></span>${esc(t('Jugando ahora'))}</span>${L.slice(0, 10).map((x) => `<a href="#j-${esc(x.id)}">${rank(x.rk, 18)}<span>${esc(x.n)}${supMark(x.id)}</span></a>`).join('')}</div>`;
}
// Equipo de la semana: las mejores medias de los últimos 7 días
// Premios (awards.json): equipo de la semana (lunes a domingo) y jugador del mes. Si aún no hay, los mejores de los últimos 7 días.
const awRange = (f, to) => `${DF_DM.format(dayDate(f)).replace('.', '')} – ${DF_DM.format(dayDate(to)).replace('.', '')}`;
const awMonth = (m) => { const s = DF_MON.format(new Date(m + '-15T12:00:00Z')); return s[0].toUpperCase() + s.slice(1); };
const podium = (W, avgKey) => `<div class="podium">${[1, 0, 2].filter((i) => W[i]).map((i) => { const x = W[i]; return `<a class="pod p${i + 1}" href="#j-${esc(x.id)}">${avatar(x.n, x.id, i === 0 ? 'lg' : 'md')}<span class="medal">${i + 1}</span><span class="nr"><span class="t">${esc(x.n)}${supMark(x.id)}</span>${rank(x.rk, 18)}</span>${badge(x[avgKey], 'md')}<small>${esc(pl(x.gp, 'partido', 'partidos'))}</small></a>`; }).join('')}</div>`;
// Equipo de la semana en la pista, como una alineación: dos delante y atrás el que más defiende (paradas y bloqueos
// por partido). Cada uno con su nota; el mejor de la semana, con estrella.
function teamRink(L, big) {
  const W = L.slice(0, 3); if (!W.length) return '';
  const def = (x) => ((x.sv || 0) + (x.bl || 0) * 0.5) / (x.gp || 1);
  const back = W.length === 3 ? W.reduce((b, x) => (def(x) > def(b) ? x : b), W[0]) : null;
  const order = back ? [...W.filter((x) => x !== back), back] : W;
  const slots = order.length === 3 ? [[27, 29], [73, 29], [50, 64]] : order.length === 2 ? [[30, 45], [70, 45]] : [[50, 50]];
  const marks = order.map((x, k) => `<a class="tw-p${x === W[0] ? ' best' : ''}" href="#j-${esc(x.id)}" style="left:${slots[k][0]}%;top:${slots[k][1]}%">${x === W[0] ? `<span class="tw-star" title="${esc(t('Mejor nota de la semana'))}">${ICON.star}</span>` : ''}${avatar(x.n, x.id, big ? 'lg' : 'md')}${badge(x.rt)}<span class="nm">${rank(x.rk, 14)}<span class="t">${esc(x.n)}</span>${supMark(x.id)}</span><small>${esc(pl(x.gp, 'partido', 'partidos'))}</small></a>`).join('');
  return `<div class="tw-rink${big ? ' big' : ''}"><svg viewBox="0 0 100 112" preserveAspectRatio="none" aria-hidden="true">
    <path d="M2 2H98V86A24 24 0 0 1 74 110H26A24 24 0 0 1 2 86Z" fill="var(--ice)" stroke="var(--ice-line)" stroke-width=".8"/>
    <line x1="2" y1="3" x2="98" y2="3" stroke="var(--ice-red)" stroke-width="1.2" opacity=".7"/>
    <line x1="2" y1="26" x2="98" y2="26" stroke="var(--ice-blue)" stroke-width="1.4" opacity=".6"/>
    <circle cx="27" cy="64" r="10" fill="none" stroke="var(--ice-red)" stroke-width=".6" opacity=".45"/><circle cx="73" cy="64" r="10" fill="none" stroke="var(--ice-red)" stroke-width=".6" opacity=".45"/>
    <line x1="7" y1="100" x2="93" y2="100" stroke="var(--ice-red)" stroke-width=".6" opacity=".6"/>
    <path d="M42 100a8 5 0 0 1 16 0" fill="var(--ice-blue)" fill-opacity=".18" stroke="var(--ice-red)" stroke-width=".6"/>
    <rect x="45.5" y="100" width="9" height="3.4" fill="none" stroke="var(--ice-red)" stroke-width=".6"/>
  </svg>${marks}</div>`;
}
function teamWeekCard(top) {
  const A = S.awards, L = A && A.week && A.week.last && A.week.last.list;
  if (L && L.length >= 3) return `<div class="card in"><div class="card-h"><h3>${esc(t('Equipo de la semana'))}</h3><a href="#premios">${esc(awRange(A.week.last.f, A.week.last.t))}</a></div><div class="tw-box">${teamRink(L)}</div></div>`;
  const W = (top && top.week) || []; if (W.length < 3) return '';
  return `<div class="card in"><div class="card-h"><h3>${esc(t('Mejores de la semana'))}</h3><small>${esc(t('7 días · mín. {n} PJ', { n: W[0].min || 1 }))}</small></div>
    ${podium(W, 'avg')}
    ${W.slice(3).map((x, i) => `<a class="lrow" href="#j-${esc(x.id)}"><span class="i">${i + 4}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t">${esc(x.n)}${supMark(x.id)}</span>${rank(x.rk, 20)}</span><span class="sub">${esc(pl(x.gp, 'partido', 'partidos'))} · ${x.g} ${t('G')} · ${x.as} ${t('A')}</span></span>${badge(x.avg)}</a>`).join('')}<div style="height:8px"></div></div>`;
}
function drawRight(st, top) {
  const el = $('#m-right'); if (!el) return;
  if (!S.awards) loadAwards().then(() => { const slot = $('#tw-slot'); if (slot && live(st.tok)) slot.innerHTML = teamWeekCard(top); }).catch(() => {});
  const { meta, day } = st;
  let html = liveCard(day, 'hide-mobile') + `<div class="card in hide-mobile" id="fav-card"></div>` + leadersCard(meta, day, 'hide-mobile');
  const ml = $('#m-live'); if (ml) ml.innerHTML = liveStrip(day);
  const best = meta.best && !S.hidden.has(meta.best.i) ? meta.best : null;
  if (best && best.p[best.v]) {
    const mv = best.p[best.v];
    html += `<div class="card in"><div class="card-h"><h3>${esc(t('Partido destacado'))}</h3><small>${esc(typeLabel(best.y))} · ${esc(regionLabel(best.r))}</small></div>
      <a class="mini" href="${matchHref(best.k, best.i)}"><div class="side">${crest(0, 34)}${esc(HOME())}</div><div class="sc">${best.s[0]}<i>-</i>${best.s[1]}</div><div class="side">${crest(1, 34)}${esc(AWAY())}</div></a>
      <a class="lrow" href="${matchHref(best.k, best.i)}" style="border-top:1px solid var(--line)"><span class="i"></span>${avatar(mv[1], mv[0], 'sm')}<span class="nm"><span>${esc(mv[1])}</span>${rank(mv[6], 20, { approx: mv[7] })}</span><span>${badge(mv[3])}</span></a></div>`;
  }
  const perf = (meta.perf || []).filter((p) => !S.hidden.has(p.i)).slice(0, 6);
  if (perf.length) html += `<div class="card in"><div class="card-h"><h3>${esc(t('Mejores actuaciones'))}</h3><small>${esc(dayLong(day))}</small></div><div style="padding-bottom:8px">${perf.map((p, i) =>
    `<a class="lrow" href="${matchHref(p.k, p.i)}"><span class="i">${i + 1}</span>${avatar(p.n, p.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span style="display:flex;align-items:center;gap:6px;max-width:100%"><span style="overflow:hidden;text-overflow:ellipsis">${esc(p.n)}</span>${rank(p.rk, 20, { approx: p.ap })}</span><span class="sub">${p.g} ${t('G')} · ${p.as} ${t('A')} · ${p.s[0]}-${p.s[1]}</span></span>${badge(p.rt)}</a>`).join('')}</div></div>`;
  html += `<div id="tw-slot">${teamWeekCard(top)}</div>`;
  html += supportCard();
  html += feedbackCard();
  if (top && top.mmr && top.mmr.length) html += `<div class="card in"><div class="card-h"><h3>${esc(t('Top MMR'))}</h3><a href="#rankings">${esc(t('Ver rankings'))}</a></div><div style="padding-bottom:8px">${top.mmr.slice(0, 5).map((p, i) =>
    `<a class="lrow" href="#j-${esc(p.id)}"><span class="i">${i + 1}</span>${rank(p.rk, 26)}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span>${esc(p.n)}${supMark(p.id)}</span><span class="sub">${esc(p.rank || '')}</span></span><span class="v">${int(p.mmr)}</span></a>`).join('')}</div></div>`;
  if (top && top.active && top.active.length) html += `<div class="card in"><div class="card-h"><h3>${esc(t('Más activos'))}</h3><small>${esc(t('7 días'))}</small></div><div style="padding-bottom:8px">${top.active.slice(0, 5).map((p, i) =>
    `<a class="lrow" href="#j-${esc(p.id)}"><span class="i">${i + 1}</span>${avatar(p.n, p.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t">${esc(p.n)}${supMark(p.id)}</span>${rank(p.rk, 20)}</span><span class="sub">${esc(pl(p.gp, 'partido', 'partidos'))}</span></span>${badge(p.avg)}</a>`).join('')}</div></div>`;
  html += `<div class="card in links"><a href="#records">${ICON.trophy}<span><b>${esc(t('Récords'))}</b><small>${esc(t('Las mejores marcas y rachas'))}</small></span>${ICON.right}</a><a href="#eusl">${ICON.league}<span><b>EUSL</b><small>${esc(t('Clasificación y resultados de la liga'))}</small></span>${ICON.right}</a></div>`;
  el.innerHTML = html;
}

// =====================================================================
// PARTIDO
// =====================================================================
let MTAB = 'resumen';
const MPER = { id: '', j: -1 };   // periodo elegido en una partida custom con periodos (-1: el partido entero)
const ordP = (n) => C.periodOrd(n, LANG);
// "1.er periodo"; un tramo que junta varios periodos (el robot no vio el primero por separado): "Periodos 1 y 2"
function perLabel(x) { return x.from === x.n ? t('{o} periodo', { o: ordP(x.n) }) : x.n - x.from === 1 ? t('Periodos {a} y {b}', { a: x.from, b: x.n }) : t('Periodos {a} a {b}', { a: x.from, b: x.n }); }
const perShort = (x) => (x.from === x.n ? `P${x.n}` : `P${x.from}-${x.n}`);
// El partido visto en un periodo: mismas funciones de dibujo, con las cifras y notas de ese periodo
function periodView(m, j) {
  const x = m.per && m.per[j]; if (!x) return m;
  const players = [], at = new Map();
  m.players.forEach((p, i) => { const r = x.rows[i]; if (!r) return; at.set(i, players.length); players.push({ ...p, st: r.st, rating: r.rating, rawRating: r.rawRating ?? r.rating, parts: r.parts || [], res: r.res, k: r.k || 1 }); });
  return { ...m, full: m, isPeriod: j, players, score: x.score, winner: x.winner, mvp: at.has(x.mvp) ? at.get(x.mvp) : -1, tot: x.tot, endReason: x.endReason, ot: x.ot };
}
async function viewMatch(r, tok) {
  MAIN.innerHTML = `<div class="card evh"><div class="sk" style="height:14px;width:220px;margin-bottom:18px"></div><div style="display:flex;justify-content:space-around;align-items:center"><div class="sk" style="width:60px;height:60px;border-radius:50%"></div><div class="sk" style="width:140px;height:48px"></div><div class="sk" style="width:60px;height:60px;border-radius:50%"></div></div></div><div style="height:16px"></div>${skeletonList(6)}`;
  let res;
  try { res = await loadMatch(r.key, r.id); }
  catch (e) { if (!live(tok)) return; if (e.status === 404) return notFound(t('No encuentro este partido.'), `<p>${esc(t('Puede que todavía no se haya guardado o que el enlace sea antiguo.'))}</p>`); return errorBox(e); }
  if (!live(tok)) return;
  if (res.redirect) { location.replace(res.redirect); return; }
  const { meta, e: se, raw, per } = res;
  let m;
  // con periodos y sin todos sus registros (alguno en un día archivado): se rehace con el resumen
  const fromSum = !raw || !!(se && se.pd && !per);
  if (!fromSum) {
    m = per ? C.mergePeriods(per, S.W) : C.normalize(raw, S.W); m.raw = per || raw;
    const rk = new Map(); if (se) for (const p of se.p) rk.set(p[0], { rk: p[6], approx: !!p[7] });
    m.players.forEach((p) => { const x = rk.get(p.pid); p.rk = x ? x.rk : ''; p.rkApprox = x ? x.approx : false; });
  } else m = fromSummary(se);
  m.key = r.key; m.archived = fromSum; m.dayArchived = !!meta.x;
  if (MPER.id !== m.id) { MPER.id = m.id; MPER.j = -1; }
  if (!m.per || MPER.j >= m.per.length) MPER.j = -1;
  const view = () => (m.per && MPER.j >= 0 ? periodView(m, MPER.j) : m);
  if (m.archived && MTAB === 'json') MTAB = 'resumen';
  S.curMatch = m; S.curView = view;
  document.title = `${HOME()} ${m.score.home}-${m.score.away} ${AWAY()} · ${typeLabel(m.type)} · SlapScore`;
  const lose = (tm) => m.winner && m.winner !== tm ? 'lose' : '';
  const hidden = S.hidden.has(m.id);
  MAIN.innerHTML = `
    <nav class="crumbs in" aria-label="${esc(t('Ruta'))}"><a href="#d-${m.key.slice(0, 10)}">${esc(t('Partidos'))}</a>${ICON.right}<span>${esc(typeLabel(m.type))} · ${esc(regionLabel(m.region))}</span>${ICON.right}<span>${esc(m.arena)}</span></nav>
    <section class="card evh in" aria-label="${esc(t('Marcador'))}">
      <div class="evh-top"><span>${esc(cap(DF_FULL.format(new Date(m.t))))} · ${DF_TIME.format(new Date(m.t))}</span><span class="evh-acts"><button type="button" class="tbtn" id="m-share">${ICON.share}<span>${esc(t('Compartir'))}</span></button><a href="https://slapshot.gg/matches/${encodeURIComponent(m.id)}" target="_blank" rel="noopener">slapshot.gg ${ICON.ext}</a></span></div>
      <div class="evh-main">
        <div class="evh-team">${crest('home', 56)}<b>${esc(HOME())}</b><span class="avg">${esc(t('Nota media'))} ${badge(avg(m, 'home'))}</span></div>
        <div class="evh-score"><div class="sc" aria-label="${esc(HOME())} ${m.score.home}, ${esc(AWAY())} ${m.score.away}"><span class="${lose('home')}">${m.score.home}</span><i>-</i><span class="${lose('away')}">${m.score.away}</span></div>
          <span class="pill ${m.ot ? 'ot' : ''}">${esc(endLabel(m.endReason, m.ot))}</span>${isCustom(m.type) ? `<span class="pill cu-pill" title="${esc(t('No cuenta para la nota media en públicas'))}">${esc(t('Custom'))}</span>` : ''}
          ${m.per ? `<div class="per-sc" aria-label="${esc(t('Marcador por periodos'))}">${m.per.map((x) => `<span title="${esc(perLabel(x))}">${x.score.home}-${x.score.away}</span>`).join('')}</div>` : ''}</div>
        <div class="evh-team">${crest('away', 56)}<b>${esc(AWAY())}</b><span class="avg">${esc(t('Nota media'))} ${badge(avg(m, 'away'))}</span></div>
      </div>
    </section>
    <div style="height:16px"></div>
    <div class="layout two">
      <div class="col">
        ${m.per && m.per.length > 1 ? `<div class="seg per-seg in" role="group" aria-label="${esc(t('Ver estadísticas de'))}" id="mper">${[[-1, t('Partido completo'), t('Total')], ...m.per.map((x, j) => [j, perLabel(x), perShort(x)])].map(([j, l, sh]) => `<button type="button" data-per="${j}" aria-pressed="${MPER.j === j}"><span class="lg">${esc(l)}</span><span class="sh" aria-hidden="true">${esc(sh)}</span></button>`).join('')}</div>` : ''}
        <div class="card"><div class="tabs" role="tablist" id="mtabs">${[['resumen', 'Resumen'], ['alineaciones', 'Alineaciones'], ['estadisticas', 'Estadísticas'], ...(m.archived ? [] : [['json', 'JSON']])].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${MTAB === k}">${esc(t(l))}</button>`).join('')}<span class="ind"></span></div>
        <div class="panel" id="mpanel" role="tabpanel"></div></div>
      </div>
      <aside class="col sticky">${!raw ? archiveCard(m) : ''}<div id="m-mvp">${mvpCard(view())}</div>${infoCard(m)}${isAdmin() && !m.dayArchived ? `<div class="adminbar"><b>Admin</b><span class="muted" style="flex:1">${hidden ? 'Este partido está oculto.' : 'Oculta partidos con datos erróneos.'}</span><button class="btn sm ${hidden ? '' : 'danger'}" type="button" id="m-hide">${hidden ? 'Mostrar partido' : 'Ocultar partido'}</button></div>` : ''}</aside>
    </div>`;
  const tabs = $('#mtabs');
  const moveInd = () => { const b = $('[aria-selected="true"]', tabs), ind = $('.ind', tabs); if (b && ind) { ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`; } };
  $$('[data-tab]', tabs).forEach((b) => b.addEventListener('click', () => {
    if (MTAB === b.getAttribute('data-tab')) return;
    MTAB = b.getAttribute('data-tab'); $$('[data-tab]', tabs).forEach((x) => x.setAttribute('aria-selected', String(x === b))); moveInd();
    drawPanel(view());
    const p = $('#mpanel'); if (p && !REDUCED.matches) { p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap'); }
  }));
  S.onResize = moveInd; requestAnimationFrame(moveInd); if (document.fonts) document.fonts.ready.then(() => { if (S.onResize === moveInd) moveInd(); });
  drawPanel(view());
  const seg = $('#mper');
  if (seg) seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-per]'); if (!b) return;
    const j = Number(b.getAttribute('data-per')); if (j === MPER.j) return;
    MPER.j = j; $$('[data-per]', seg).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const v = view(); drawPanel(v); const mv = $('#m-mvp'); if (mv) mv.innerHTML = mvpCard(v);
    const p = $('#mpanel'); if (p && !REDUCED.matches) { p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap'); }
  });
  MAIN.onclick = (e) => { const b = e.target.closest('[data-perf]'); if (b && S.curView) { const v = S.curView(); const p = v.players[Number(b.getAttribute('data-perf'))]; if (p) openPerf(v, p); } };
  $('#m-share').addEventListener('click', () => shareImage('match', m, `slapscore-${m.key.slice(0, 10)}-${m.id.slice(0, 8)}.png`));
  const hb = $('#m-hide');
  if (hb) hb.addEventListener('click', async () => {
    hb.disabled = true;
    try { const A = await import('./admin.js'); await A.toggleHidden(m.id, !hidden, ctx(), m.key); } catch (e) { toast(e.message || 'No se pudo guardar.'); hb.disabled = false; }
  });
}
// Partido archivado: se reconstruye con el resumen guardado (nota y estadísticas principales de cada jugador)
function fromSummary(e) {
  const players = e.p.map((p) => ({
    pid: p[0], name: p[1], team: p[2] === 0 ? 'home' : 'away', rating: p[3], rawRating: p[3], parts: [], rk: p[6], rkApprox: !!p[7],
    res: e.w === -1 ? 'D' : e.w === p[2] ? 'W' : 'L',
    st: { goals: p[4], assists: p[5], shots: p[8], saves: p[9], passes: p[10], score: p[11], takeaways: p[12], blocks: p[13], turnovers: p[14] || 0,
      possession_time_sec: p[15] || 0, faceoffs_won: p[16] || 0, faceoffs_lost: p[17] || 0, post_hits: p[18] || 0 },
  }));
  const tot = { home: {}, away: {} };
  for (const p of players) for (const k of Object.keys(p.st)) tot[p.team][k] = (tot[p.team][k] || 0) + p.st[k];
  const home = players.filter((p) => p.team === 'home').length;
  const m = { id: e.i, t: e.t, type: e.y, region: e.r, arena: e.a, endReason: e.e, ot: !!e.o, length: null, periods: null, score: { home: e.s[0], away: e.s[1] },
    winner: e.w === 0 ? 'home' : e.w === 1 ? 'away' : null, players, mvp: e.v, size: { home, away: players.length - home }, tot, format: e.f };
  if (e.pd) {
    m.periods = true; m.tEnd = e.pd[e.pd.length - 1].t;
    m.per = e.pd.map((x) => {
      const score = { home: x.s[0], away: x.s[1] }, winner = score.home > score.away ? 'home' : score.away > score.home ? 'away' : null;
      const rows = e.p.map((p, i) => {
        const q = x.q[i]; if (!q) return null;
        const st = {}; C.PER_COLS.forEach((k, j) => { st[k] = q[j + 1] || 0; });
        const team = p[2] === 0 ? 'home' : 'away';
        return { team, st, rating: q[0], rawRating: q[0], parts: [], res: !winner ? 'D' : team === winner ? 'W' : 'L' };
      });
      const tt = { home: {}, away: {} };
      for (const r of rows) if (r) for (const k of Object.keys(r.st)) tt[r.team][k] = (tt[r.team][k] || 0) + r.st[k];
      return { n: x.n, from: x.f || x.n, id: x.i, t: x.t, score, winner, endReason: x.e, ot: !!x.o, rows, mvp: x.v, tot: tt };
    });
    players.forEach((p, i) => { p.perR = m.per.map((x) => (x.rows[i] ? x.rows[i].rating : null)); });
  }
  return m;
}
function archiveUrl(day) {
  const a = S.index.archive || {};
  return a.repo ? `https://github.com/${a.repo}/releases/download/${a.tag || 'archivo-'}${day.slice(0, 7)}/${a.file || 'partidos-'}${day}.json.gz` : '';
}
function archiveCard(m) {
  const day = m.key.slice(0, 10), url = m.dayArchived ? archiveUrl(day) : '';
  return `<div class="card in note"><div class="card-b"><b>${esc(t('Partido archivado'))}</b><p>${esc(t('Guardamos el detalle completo de los partidos de los últimos {n} días. De este se conservan la nota y las estadísticas principales de cada jugador.', { n: int(S.index.retain || 60) }))}</p>${url ? `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">${esc(t('Descargar el archivo del día'))} ${ICON.ext}</a>` : ''}</div></div>`;
}
function mvpCard(m) {
  const p = m.players[m.mvp]; if (!p) return '';
  const x = m.isPeriod != null ? m.per[m.isPeriod] : null;
  return `<div class="card in"><div class="card-h"><h3>${esc(x ? t('Mejor del periodo') : t('Jugador del partido'))}</h3>${x ? `<small>${esc(perLabel(x))}</small>` : rank(p.rk, 22, { approx: p.rkApprox })}</div>
    <button type="button" class="prow" data-perf="${m.mvp}" style="border-top:0;padding-top:4px;padding-bottom:16px">${avatar(p.name, p.pid, 'md')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span style="font-size:17px">${esc(p.name)}</span><span class="ln">${statLine(p.st, 4)}</span></span>${badge(p.rating, 'lg')}</button></div>`;
}
function infoCard(m) {
  const lastN = m.per ? m.per[m.per.length - 1].n : 0;
  const rows = [['Arena', m.arena], ['Región', regionLabel(m.region)], ['Tipo', typeLabel(m.type)], ['Formato', m.format],
    ['Duración', m.per && m.periodLength ? `${lastN} × ${C.fmtPoss(m.periodLength)}` : m.length ? C.fmtPoss(m.length) : ''], ['Resultado', endLabel(m.endReason, m.ot)],
    ['Periodos', m.per ? String(lastN) : m.periods == null ? '' : m.periods ? t('Sí') : t('No')]].filter((x) => x[1]);
  return `<div class="card in"><div class="card-h"><h3>${esc(t('Datos del partido'))}</h3></div><dl class="info">${rows.map(([k, v]) => `<dt>${esc(t(k))}</dt><dd>${esc(v)}</dd>`).join('')}<dt>ID</dt><dd><button class="btn sm" type="button" data-copy="${esc(m.id)}" title="${esc(m.id)}">${esc(t('Copiar ID'))}</button></dd></dl></div>`;
}
function statLine(st, max = 3) {
  const b = [];
  if (st.goals) b.push(pl(st.goals, 'gol', 'goles'));
  if (st.assists) b.push(pl(st.assists, 'asistencia', 'asistencias'));
  if (st.saves) b.push(pl(st.saves, 'parada', 'paradas'));
  if (st.passes) b.push(pl(st.passes, 'pase', 'pases'));
  if (st.takeaways) b.push(pl(st.takeaways, 'robo', 'robos'));
  return esc((b.length ? b : [t('Sin acciones destacadas')]).slice(0, max).join(' · '));
}
const CMP_GROUPS = [
  ['Ataque', ['goals', 'shots', 'post_hits', 'overtime_goals']],
  ['Juego', ['passes', 'assists', 'possession_time_sec', 'faceoffs_won']],
  ['Defensa', ['saves', 'blocks', 'takeaways', 'turnovers']],
];
// Fila de comparación con barras (equipos en el partido o dos jugadores en el comparador)
function cmpLine(label, a, b, f = int, inv = false, share = true) {
  const la = inv ? a < b : a > b, lb = inv ? b < a : b > a, sum = (a || 0) + (b || 0);
  const w = (v) => sum ? Math.round((v || 0) / sum * 100) : 0;
  return `<div class="cmp-row"><div class="cmp-top"><span class="v ${la ? 'lead h' : ''}">${f(a)}</span><em>${esc(label)}</em><span class="v ${lb ? 'lead a' : ''}">${f(b)}</span></div>
    <div class="cmp-bars"><div><i class="${la ? 'lead' : ''}" style="width:${share ? w(a) : Math.round(a * 100)}%"></i></div><div><i class="${lb ? 'lead' : ''}" style="width:${share ? w(b) : Math.round(b * 100)}%"></i></div></div></div>`;
}
function cmpRow(m, k) {
  const a = m.tot.home[k] || 0, b = m.tot.away[k] || 0, sum = a + b;
  return cmpLine(k === 'possession_time_sec' ? t('Posesión') : statName(k), a, b, (v) => k === 'possession_time_sec' ? (sum ? pct(v / sum) : '–') : int(v), k === 'turnovers');
}
function drawPanel(m) {
  const el = $('#mpanel'); if (!el) return;
  if (MTAB === 'json') {
    const raw = JSON.stringify(m.raw, null, 2);
    el.innerHTML = `<div class="lu-head"><b>${esc(Array.isArray(m.raw) ? t('JSON original de slapshot.gg (uno por periodo)') : t('JSON original de slapshot.gg'))}</b><button class="btn sm" type="button" id="cp">${esc(t('Copiar'))}</button></div><pre class="json" id="jsonpre">${esc(raw)}</pre>`;
    $('#cp').addEventListener('click', () => copyText(raw, $('#jsonpre')));
    return;
  }
  if (MTAB === 'estadisticas') {
    el.innerHTML = CMP_GROUPS.map(([ti, ks]) => `<div class="sgrp-h">${esc(t(ti))}</div>${ks.filter((k) => m.tot.home[k] != null || m.tot.away[k] != null).map((k) => cmpRow(m, k)).join('')}`).join('')
      + `<div class="sgrp-h" style="margin-top:22px">${esc(t('Todos los jugadores'))}</div><div class="tscroll" style="margin:0 -16px">${statsTable(m)}</div>`;
    return;
  }
  if (MTAB === 'alineaciones') {
    el.innerHTML = `<div class="lu-head"><span class="lu-team">${crest('home', 20)}${esc(HOME())} ${badge(avg(m, 'home'))}</span><span class="lu-team">${badge(avg(m, 'away'))} ${esc(AWAY())} ${crest('away', 20)}</span></div>${rink(m)}
      <p class="muted" style="font-size:12.5px;margin:10px 0 0">${esc(t('Las posiciones son orientativas: slapshot.gg no indica dónde juega cada uno, así que colocamos más atrás a quien más paradas hizo.'))}</p>
      <div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0 16px;margin:12px -16px -16px">${['home', 'away'].map((tm) => lineupList(m, tm)).join('')}</div>`;
    return;
  }
  el.innerHTML = `${m.per ? perTable(m) : ''}<div class="sgrp-h">${esc(m.isPeriod != null ? t('Estadísticas de los jugadores en el periodo') : t('Estadísticas de los jugadores'))}</div>${boxScore(m)}
    <div class="sgrp-h">${esc(t('Comparativa de equipos'))}</div>${['shots', 'saves', 'passes', 'possession_time_sec', 'takeaways', 'turnovers', 'faceoffs_won'].map((k) => cmpRow(m, k)).join('')}`;
}
// Marcador por periodos (con el periodo elegido resaltado) y avisos si faltan periodos
function perTable(m) {
  const F = m.full || m, sel = m.isPeriod ?? -1, last = F.per[F.per.length - 1];
  const cell = (cls, v) => `<td class="${cls}">${v}</td>`;
  const row = (tm) => `<tr><td><span class="pc">${crest(tm, 16)}${esc(teamName(tm))}</span></td>${F.per.map((x, j) => cell(`${j === sel ? 'on' : ''}${x.winner === tm ? ' w' : ''}`, x.score[tm])).join('')}${cell(`tt${sel < 0 ? ' on' : ''}${F.winner === tm ? ' w' : ''}`, F.score[tm])}</tr>`;
  const notes = [];
  const joined = F.per.find((x) => x.from !== x.n);
  if (joined) notes.push(t('Las cifras de {l} van juntas: no llegamos a ver esos periodos por separado.', { l: perLabel(joined).toLowerCase() }));
  if (last.n < 3) {
    if (last.endReason === 'MercyRule') notes.push(t('Terminó en el {o} periodo por la regla de piedad.', { o: ordP(last.n) }));
    else notes.push(t('Solo hay datos hasta el {o} periodo.', { o: ordP(last.n) }) + (Date.now() - (F.tEnd || F.t) < 25 * 60_000 ? ' ' + t('Puede que aún se esté jugando.') : ''));
  }
  return `<div class="sgrp-h">${esc(t('Marcador por periodos'))}</div><div class="tscroll"><table class="tbl per-tbl"><thead><tr><th>${esc(t('Equipo'))}</th>${F.per.map((x, j) => `<th class="${j === sel ? 'on' : ''}" title="${esc(perLabel(x))}">${esc(perShort(x))}</th>`).join('')}<th class="tt${sel < 0 ? ' on' : ''}">${esc(t('Total'))}</th></tr></thead>
    <tbody>${row('home')}${row('away')}</tbody></table></div>${notes.map((x) => `<p class="per-note">${esc(x)}</p>`).join('')}`;
}
const BOX = [['rating', 'Nota', 'Nota'], ['goals', 'G', 'Goles'], ['primary_assists', 'A1', 'Asistencias primarias'], ['secondary_assists', 'A2', 'Asistencias secundarias'],
  ['score', 'PTS', 'Puntos de juego'], ['shots', 'TIR', 'Tiros'], ['saves', 'PAR', 'Paradas'], ['blocks', 'BLQ', 'Bloqueos'], ['passes', 'PAS', 'Pases'],
  ['post_hits', 'PST', 'Postes'], ['takeaways', 'ROB', 'Robos'], ['turnovers', 'PÉR', 'Pérdidas'], ['possession_time_sec', 'POS', 'Posesión'],
  ['faceoffs_won', 'FO+', 'Faceoffs ganados'], ['faceoffs_lost', 'FO−', 'Faceoffs perdidos']];
// En partidos archivados no hay asistencias primarias/secundarias: se muestra A
const BOX_ARCH = (() => { const b = BOX.filter(([k]) => k !== 'primary_assists' && k !== 'secondary_assists'); b.splice(2, 0, ['assists', 'A', 'Asistencias']); return b; })();
function boxScore(m) {
  const cols = m.archived ? BOX_ARCH : BOX;
  const best = {};
  for (const [k] of cols) if (!['rating', 'turnovers', 'faceoffs_lost'].includes(k)) best[k] = Math.max(0, ...m.players.map((p) => p.st[k] || 0));
  const cell = (k, v) => k === 'possession_time_sec' ? C.fmtPoss(v || 0) : int(v || 0);
  const team = (tm) => {
    const ps = m.players.map((p, i) => [p, i]).filter(([p]) => p.team === tm).sort((a, b) => b[0].rating - a[0].rating);
    return `<div class="bx-team"><div class="bx-h">${crest(tm, 22)}<b>${esc(teamName(tm))}</b><span class="sc">${m.score[tm]}</span>${m.winner === tm ? `<span class="pill live">${esc(t('Ganador'))}</span>` : ''}<span class="avg">${esc(t('Nota media'))} ${badge(avg(m, tm))}</span></div>
      <div class="tscroll"><table class="tbl bx"><thead><tr><th>${esc(t('Jugador'))}</th>${cols.map(([, s, l]) => `<th title="${esc(t(l))}">${esc(t(s))}</th>`).join('')}</tr></thead><tbody>
      ${ps.map(([p, i]) => `<tr><td><button type="button" class="linkish" data-perf="${i}">${avatar(p.name, p.pid, 'sm')}<span class="nm">${pname([p.pid, p.name])}</span>${rank(p.rk, 20, { approx: p.rkApprox })}${i === m.mvp ? '<span class="mvp-tag">MVP</span>' : ''}</button></td>${cols.map(([k]) => k === 'rating' ? `<td>${badge(p.rating)}</td>`
        : `<td class="${best[k] && (p.st[k] || 0) === best[k] ? 'best' : ''}">${cell(k, p.st[k])}</td>`).join('')}</tr>`).join('')}
      <tr class="tot"><td>${esc(t('Total'))}</td>${cols.map(([k]) => k === 'rating' ? '<td></td>' : `<td>${cell(k, m.tot[tm][k])}</td>`).join('')}</tr></tbody></table></div></div>`;
  };
  return team('home') + team('away') + `<p class="legend">${cols.slice(1).map(([, s, l]) => `<b>${esc(t(s))}</b> ${esc(t(l))}`).join(' · ')}. ${esc(t('En azul, el mejor del partido en cada columna.'))}</p>`;
}
const avg = (m, tm) => { const ps = m.players.filter((p) => p.team === tm); return ps.length ? ps.reduce((a, p) => a + p.rating, 0) / ps.length : 0; };
function lineupList(m, tm) {
  const ps = m.players.map((p, i) => [p, i]).filter(([p]) => p.team === tm).sort((a, b) => b[0].rating - a[0].rating);
  return `<div><div class="lu-team" style="padding:10px 16px">${crest(tm, 18)}${esc(teamName(tm))}${m.winner === tm ? ` <span class="pill live" style="height:20px">${esc(t('Ganador'))}</span>` : ''}</div>
    ${ps.map(([p, i]) => `<button type="button" class="prow" data-perf="${i}">${avatar(p.name, p.pid)}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span style="display:flex;align-items:center;gap:6px;max-width:100%"><span style="overflow:hidden;text-overflow:ellipsis">${pname([p.pid, p.name])}</span>${rank(p.rk, 18, { approx: p.rkApprox })}${i === m.mvp ? '<span class="mvp-tag">MVP</span>' : ''}</span><span class="ln">${statLine(p.st)}</span></span>${badge(p.rating, 'md')}</button>`).join('')}</div>`;
}
function rink(m) {
  const pos = { 1: [[25, 50]], 2: [[17, 50], [37, 50]], 3: [[13, 50], [33, 27], [33, 73]], 4: [[12, 50], [27, 25], [27, 75], [41, 50]], 5: [[11, 50], [24, 22], [24, 78], [40, 33], [40, 67]] };
  const place = (tm) => {
    const ps = m.players.map((p, i) => [p, i]).filter(([p]) => p.team === tm).sort((a, b) => (b[0].st.saves - a[0].st.saves) || (a[0].st.goals - b[0].st.goals));
    const n = ps.length;
    const slots = pos[n] || ps.map((_, k) => [12 + (k % 3) * 13, 20 + Math.floor(k / 3) * 30 + (k % 3) * 8]);
    return ps.map(([p, i], k) => { const [x, y] = slots[k]; return { p, i, x: tm === 'home' ? x : 100 - x, y }; });
  };
  const marks = [...place('home'), ...place('away')].map(({ p, i, x, y }) =>
    `<button type="button" class="rink-p ${p.team}" data-perf="${i}" style="left:${x}%;top:${y}%">${avatar(p.name, p.pid)}${badge(p.rating)}<span class="nm">${rank(p.rk, 16, { approx: p.rkApprox })}${esc(p.name)}</span></button>`).join('');
  return `<div class="rink-wrap"><svg class="rink" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
    <rect x="2" y="2" width="196" height="96" rx="16" fill="none" stroke="var(--ice-line)" stroke-width="1.4"/>
    <line x1="100" y1="2" x2="100" y2="98" stroke="var(--ice-red)" stroke-width="1.6" opacity=".7"/>
    <line x1="70" y1="2" x2="70" y2="98" stroke="var(--ice-blue)" stroke-width="1.6" opacity=".6"/><line x1="130" y1="2" x2="130" y2="98" stroke="var(--ice-blue)" stroke-width="1.6" opacity=".6"/>
    <line x1="14" y1="4" x2="14" y2="96" stroke="var(--ice-red)" stroke-width=".8" opacity=".6"/><line x1="186" y1="4" x2="186" y2="96" stroke="var(--ice-red)" stroke-width=".8" opacity=".6"/>
    <ellipse cx="100" cy="50" rx="7" ry="14" fill="none" stroke="var(--ice-blue)" stroke-width="1" opacity=".55"/>
    <ellipse cx="40" cy="27" rx="5.5" ry="11" fill="none" stroke="var(--ice-red)" stroke-width=".8" opacity=".45"/><ellipse cx="40" cy="73" rx="5.5" ry="11" fill="none" stroke="var(--ice-red)" stroke-width=".8" opacity=".45"/>
    <ellipse cx="160" cy="27" rx="5.5" ry="11" fill="none" stroke="var(--ice-red)" stroke-width=".8" opacity=".45"/><ellipse cx="160" cy="73" rx="5.5" ry="11" fill="none" stroke="var(--ice-red)" stroke-width=".8" opacity=".45"/>
    <path d="M14 42a5 8 0 0 1 0 16" fill="var(--ice-blue)" fill-opacity=".18" stroke="var(--ice-red)" stroke-width=".8"/><path d="M186 42a5 8 0 0 0 0 16" fill="var(--ice-blue)" fill-opacity=".18" stroke="var(--ice-red)" stroke-width=".8"/>
    <rect x="10.5" y="45.5" width="3.5" height="9" fill="none" stroke="var(--ice-red)" stroke-width=".8"/><rect x="186" y="45.5" width="3.5" height="9" fill="none" stroke="var(--ice-red)" stroke-width=".8"/>
  </svg>${marks}</div>`;
}
function statsTable(m) {
  const set = new Set(); m.players.forEach((p) => Object.keys(p.st).forEach((k) => { if (!C.META_STATS.has(k)) set.add(k); }));
  const keys = C.STAT_ORDER.filter((k) => set.has(k)).concat([...set].filter((k) => !C.STAT_ORDER.includes(k)).sort());
  const val = (k, v) => v == null ? '–' : k === 'possession_time_sec' ? C.fmtPoss(v) : int(v);
  let body = '';
  for (const tm of ['home', 'away']) {
    const ps = m.players.map((p, i) => [p, i]).filter(([p]) => p.team === tm).sort((a, b) => b[0].rating - a[0].rating);
    body += `<tr class="tg"><td colspan="${keys.length + 2}">${esc(teamName(tm))} · ${m.score[tm]}</td></tr>`;
    body += ps.map(([p]) => `<tr><td><a class="pc" href="#j-${esc(p.pid)}">${rank(p.rk, 20, { approx: p.rkApprox })}${esc(p.name)}${supMark(p.pid)}</a></td><td>${badge(p.rating)}</td>${keys.map((k) => `<td>${val(k, p.st[k])}</td>`).join('')}</tr>`).join('');
    body += `<tr class="tot"><td>${esc(t('Total'))}</td><td></td>${keys.map((k) => `<td>${val(k, m.tot[tm][k])}</td>`).join('')}</tr>`;
  }
  return `<table class="tbl"><thead><tr><th>${esc(t('Jugador'))}</th><th>${esc(t('Nota'))}</th>${keys.map((k) => `<th title="${esc(statName(k))}">${esc(statAbbr(k))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    <p class="muted" style="font-size:12px;padding:10px 16px 0">${keys.map((k) => `<b>${esc(statAbbr(k))}</b> ${esc(statName(k))}`).join(' · ')}</p>`;
}
function openPerf(m, p) {
  const keys = C.STAT_ORDER.filter((k) => p.st[k]);
  const maxAbs = Math.max(0.3, ...p.parts.map((x) => Math.abs(x.c)));
  const res = p.res === 'W' ? t('Victoria') : p.res === 'L' ? t('Derrota') : t('Empate');
  const px = m.isPeriod != null ? m.per[m.isPeriod] : null;
  const fmtN = (n) => (typeof n === 'number' && !Number.isInteger(n) ? dec(n) : n);
  // partido entero con periodos: la nota es la media de sus periodos
  const perBlock = m.per && m.isPeriod == null && p.perR ? `<div class="bd"><h3>${esc(t('Nota por periodo'))}</h3>
      ${m.per.map((x, j) => `<div class="bd-row"><span>${esc(perLabel(x))}</span><span></span>${p.perR[j] == null ? `<span class="muted">${esc(t('No jugó'))}</span>` : badge(p.perR[j])}</div>`).join('')}
      <div class="bd-row tot"><span>${esc(t('Nota del partido (media)'))}</span><span></span><b>${fmtR(p.rating)}</b></div>
      <p class="muted" style="margin:10px 0 0;font-size:12.5px">${esc(t('La nota del partido es la media de las notas de cada periodo que jugó. Elige un periodo arriba para ver cómo sale cada una.'))}</p></div>` : '';
  openSheet(`<div class="sheet-h">${avatar(p.name, p.pid, 'md')}<div style="min-width:0"><div class="nm" id="sheet-title"><span>${esc(p.name)}</span>${rank(p.rk, 22, { approx: p.rkApprox })}</div>
      <small>${crest(p.team, 16)}${esc(teamName(p.team))}${px ? ` · ${esc(perLabel(px))}` : ''} · <span class="res ${p.res}">${resLetter(p.res)}</span> ${esc(res)} ${m.score.home}-${m.score.away}${m.players[m.mvp] === p ? ' · <span class="mvp-tag">MVP</span>' : ''}</small></div>${badge(p.rating, 'xl')}</div>
    <div class="sgrid">${(keys.length ? keys : ['goals']).map((k) => `<div><b>${k === 'possession_time_sec' ? C.fmtPoss(p.st[k]) : int(p.st[k])}</b><span>${esc(statName(k))}</span></div>`).join('')}</div>
    ${perBlock || (m.archived ? `<div class="bd"><p class="muted" style="margin:0">${esc(t('El desglose de la nota no está disponible en los partidos archivados.'))}</p></div>` : `<div class="bd"><h3>${esc(t('Cómo sale la nota'))}</h3>${p.k > 1 ? `<p class="muted" style="margin:0 0 8px;font-size:12.5px">${esc(t('Este tramo junta {n} periodos: la nota sale de la media por periodo.', { n: p.k }))}</p>` : ''}<div class="bd-row"><span>${esc(t('Nota de partida'))}</span><span></span><b>${fmtR(S.W.base)}</b></div>
      ${p.parts.map((x) => `<div class="bd-row"><span>${esc(t(x.label))}${x.n !== '' && x.n != null ? ` <span class="muted">(${esc(fmtN(x.n))})</span>` : ''}</span><span class="bar"><i class="${x.c >= 0 ? 'pos' : 'neg'}" style="width:${Math.round(Math.abs(x.c) / maxAbs * 50)}%"></i></span><b class="${x.c >= 0 ? 'pos' : 'neg'}">${x.c >= 0 ? '+' : '−'}${dec(Math.abs(x.c), 2)}</b></div>`).join('')}
      <div class="bd-row tot"><span>${esc(t('Nota final'))}</span><span></span><b>${fmtR(p.rating)}</b></div></div>`)}
    <div class="sheet-f"><button class="btn" type="button" data-close>${esc(t('Cerrar'))}</button><a class="btn primary" href="#j-${esc(p.pid)}">${esc(t('Ver perfil'))}</a></div>`);
}

// ---------- imagen para compartir (partido o perfil) ----------
function statPlain(st) {
  const b = [];
  if (st.goals) b.push(pl(st.goals, 'gol', 'goles'));
  if (st.assists) b.push(pl(st.assists, 'asistencia', 'asistencias'));
  if (st.saves) b.push(pl(st.saves, 'parada', 'paradas'));
  if (st.passes) b.push(pl(st.passes, 'pase', 'pases'));
  return (b.length ? b : [t('Sin acciones destacadas')]).slice(0, 3).join(' · ');
}
async function shareImage(kind, obj, fname) {
  openSheet(`<div class="sheet-h" style="grid-template-columns:minmax(0,1fr) auto"><div class="nm" id="sheet-title"><span>${esc(t('Compartir imagen'))}</span></div><button class="ibtn" type="button" data-close aria-label="${esc(t('Cerrar'))}" style="color:var(--muted);font-size:22px">×</button></div><div class="share-pv" id="sh-pv"><div class="sk" style="width:100%;aspect-ratio:4/5"></div></div><div class="sheet-f" id="sh-f"></div>`, 'share-sheet');
  try {
    const Sh = await import('./share.js');
    const X = { t, lang: LANG, teamL: TEAM_LETTER, host: location.host, fmtR, int, resLetter, typeLabel, region: regionLabel,
      date: (ms) => `${shortDate(ms)} · ${DF_TIME.format(new Date(ms))}`, statLine: statPlain, rankSrc: (rk) => rk ? officialSrc(rk, 128) : null, rankName: (rk) => (C.parseRank(rk) || {}).name || '',
      endLabel: kind === 'match' ? endLabel(obj.endReason, obj.ot) + (obj.per ? ' · ' + obj.per.map((x) => `${x.score.home}-${x.score.away}`).join(' · ') : '') : '' };
    const cv = kind === 'match' ? await Sh.matchImage(obj, X) : kind === 'week' || kind === 'month' ? await Sh.awardImage(kind, obj, X) : await Sh.profileImage(obj, X);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!$('#sh-pv')) return;
    const url = URL.createObjectURL(blob), file = new File([blob], fname, { type: 'image/png' });
    let canShare = false; try { canShare = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch {}
    $('#sh-pv').innerHTML = `<img src="${url}" alt="">`;
    $('#sh-f').innerHTML = `<a class="btn" href="${url}" download="${esc(fname)}">${ICON.install}${esc(t('Descargar'))}</a>${canShare ? `<button class="btn primary" type="button" id="sh-go">${ICON.share}${esc(t('Compartir'))}</button>` : ''}`;
    const go = $('#sh-go'); if (go) go.addEventListener('click', () => navigator.share({ files: [file], title: 'SlapScore' }).catch(() => {}));
    let counted = false; $('#sh-f').addEventListener('click', (e) => { if (!counted && e.target.closest('a, button')) { counted = true; trackEvent('share'); } });
  } catch (e) { const pv = $('#sh-pv'); if (pv) pv.innerHTML = `<div class="empty">${esc(t('No se pudo crear la imagen.'))}</div>`; }
}

// =====================================================================
// JUGADOR
// =====================================================================
const PV = { hist: 'all', histN: 15, statMode: 'pg', mode: 'pub' };
// Partidas públicas y personalizadas (custom) van por separado: cada perfil se ve en uno de los dos modos
const isCustom = (y) => y === 'custom';
const MODES = [['pub', 'Partidas públicas'], ['cus', 'Partidas custom']];
// modo con el que se ve a un jugador: el elegido, salvo que no tenga partidos de ese tipo
const modeFor = (P) => (PV.mode === 'cus' ? (P._ac.gp || !P._a.gp ? 'cus' : 'pub') : (P._a.gp || !P._ac.gp ? 'pub' : 'cus'));
const modeGames = (games, mode) => games.filter((g) => (mode === 'cus') === isCustom(g.y));
const modeAgg = (P, mode) => (mode === 'cus' ? P._ac : P._a);
function modeSwitch(P, mode, id = 'pmode') {
  if (!P._a.gp || !P._ac.gp) return '';
  return `<div class="mode-bar"><div class="seg mode-sw" id="${id}" role="group" aria-label="${esc(t('Tipo de partida'))}">${MODES.map(([k, l]) => `<button type="button" data-pm="${k}" aria-pressed="${mode === k}">${k === 'cus' ? '<span class="cu-dot" aria-hidden="true"></span>' : ''}${esc(t(l))} <span class="n">${int(modeAgg(P, k).gp)}</span></button>`).join('')}</div></div>`;
}
function wireModeSwitch(root = MAIN) {
  $$('[data-pm]', root).forEach((b) => b.addEventListener('click', () => { if (b.getAttribute('aria-pressed') === 'true') return; PV.mode = b.getAttribute('data-pm'); go({ keepScroll: true, silent: true }); }));
}
// Mejor racha de victorias entre unos partidos (del más reciente al más antiguo)
function bestStreak(games) { let bs = 0, run = 0; for (let i = games.length - 1; i >= 0; i--) { if (games[i].r === 'W') { run++; if (run > bs) bs = run; } else run = 0; } return bs; }
const favBtn = (id, name) => `<button type="button" class="fav-btn" data-fav="${esc(id)}" data-n="${esc(name)}" aria-pressed="${isFav(id)}" aria-label="${esc(isFav(id) ? t('Quitar de favoritos') : t('Añadir a favoritos'))}" title="${esc(isFav(id) ? t('Quitar de favoritos') : t('Añadir a favoritos'))}">${ICON.star}</button>`;
// campana del perfil: avisos de este jugador (lo añade a favoritos y activa los avisos si hace falta)
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pbell]'); if (!b) return;
  e.preventDefault();
  const id = b.getAttribute('data-pbell'), name = b.getAttribute('data-n');
  if (pushOn && isFav(id)) { toast(t('Ya te avisamos de sus partidos. Para dejarlo, quítalo de favoritos o desactiva los avisos en «Tus favoritos».')); return; }
  if (!isFav(id)) { if (!toggleFav(id, name)) return; $$(`[data-fav="${CSS.escape(id)}"]`).forEach((x) => x.setAttribute('aria-pressed', 'true')); }
  if (!pushOn) { if (!(await pushEnable())) return; } else toast(t('Te avisaremos cuando {n} termine un partido o suba de rango', { n: name }));
  b.setAttribute('aria-pressed', 'true');
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fav]'); if (!b) return;
  e.preventDefault();
  const on = toggleFav(b.getAttribute('data-fav'), b.getAttribute('data-n'));
  $$(`[data-fav="${CSS.escape(b.getAttribute('data-fav'))}"]`).forEach((x) => { x.setAttribute('aria-pressed', String(on)); x.setAttribute('aria-label', on ? t('Quitar de favoritos') : t('Añadir a favoritos')); x.title = x.getAttribute('aria-label'); });
  $$(`[data-pbell="${CSS.escape(b.getAttribute('data-fav'))}"]`).forEach((x) => x.setAttribute('aria-pressed', String(on && pushOn)));
  toast(on ? t('Añadido a favoritos: verás sus partidos en la portada') : t('Quitado de favoritos'));
});
// Racha actual: +n victorias seguidas / −n derrotas seguidas
function streakOf(games) {
  const r0 = games[0] && games[0].r; if (r0 !== 'W' && r0 !== 'L') return 0;
  let n = 0; for (const g of games) { if (g.r === r0) n++; else break; }
  return r0 === 'W' ? n : -n;
}
function streakPill(cs) {
  if (cs >= 3) return `<span class="pill live strk">${ICON.flame}${esc(t('{n} victorias seguidas', { n: cs }))}</span>`;
  if (cs <= -3) return `<span class="pill ot strk">${esc(t('{n} derrotas seguidas', { n: -cs }))}</span>`;
  return '';
}
async function viewPlayer(pid, tok) {
  MAIN.innerHTML = `<div class="card"><div class="ph"><div class="sk" style="width:76px;height:76px;border-radius:50%"></div><div><div class="sk" style="height:26px;width:220px"></div><div class="sk" style="height:12px;width:260px;margin-top:10px"></div></div></div></div><div style="height:16px"></div>${skeletonList(5)}`;
  let P, AT;
  try { [P, AT] = await Promise.all([loadP(pid), loadAttr().catch(() => null), loadAwards().catch(() => null)]); }
  catch (e) {
    if (!live(tok)) return;
    if (e.status === 404) {
      const adm = isAdmin() && /^\d+$/.test(pid) ? `<p><button class="btn primary" type="button" id="p-follow">Seguir a este jugador (admin)</button></p>` : '';
      notFound(t('Todavía no tenemos partidos de este jugador.'), `<p>${esc(t('El robot encuentra a los jugadores cuando aparecen en partidos de otros. Si juega a menudo, saldrá pronto.'))}</p><p><a href="https://slapshot.gg/players/${encodeURIComponent(pid)}" target="_blank" rel="noopener">${esc(t('Ver su perfil en slapshot.gg'))} ${ICON.ext}</a></p>${adm}`);
      const fb = $('#p-follow'); if (fb) fb.addEventListener('click', () => adminFollow(pid, true, fb));
      return;
    }
    return errorBox(e);
  }
  if (!live(tok)) return;
  PV.hist = 'all'; PV.histN = 15;
  document.title = `${P.n} · SlapScore`;
  const allGames = P._g.filter((g) => !S.hidden.has(g.i));
  const mode = modeFor(P), cus = mode === 'cus';
  const games = modeGames(allGames, mode);
  const meta = P.meta || {}, a = modeAgg(P, mode);
  // atributos (solo en públicas): percentil frente al resto de jugadores con 5 partidos o más
  let attr = null;
  if (!cus && AT && AT.n > 1 && a.gp >= 5) { const raw = C.attrRaw(a); attr = {}; for (const [k] of C.ATTRS) attr[k] = C.percentile(AT.q[k], raw[k]); }
  const avgR = a.gp ? a.rs / a.gp : 0;
  const season = meta.season ? ' · ' + esc(String(meta.season).replace(/^season/i, t('Temporada') + ' ')) : '';
  const curRank = meta.rk ? `<div class="rank-c">${rank(meta.rk, 56)}<div><div class="k">${esc(t('Rango actual'))}</div><div class="nm">${esc(meta.rank || C.parseRank(meta.rk)?.name || '')}</div><div class="pts"><b>${int(meta.mmr)}</b> MMR${season}${meta.rmp != null ? ' · ' + esc(pl(meta.rmp, 'partida', 'partidas')) : ''}</div></div></div>`
    : `<div class="rank-c"><svg width="56" height="56" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2.5 35.5 11.5v17L20 37.5 4.5 28.5v-17Z" fill="none" stroke="var(--line-2)" stroke-width="1.6" stroke-dasharray="3 3"/></svg><div><div class="k">${esc(t('Rango actual'))}</div><div class="nm">${esc(meta.unr ? t('Sin clasificar') : t('Sin consultar'))}</div><div class="pts">${esc(meta.unr ? t('No ha jugado clasificatorias esta temporada') : t('El robot aún no ha mirado su rango'))}</div></div></div>`;
  const peakRank = meta.prk ? `<div class="rank-c">${rank(meta.prk, 56)}<div><div class="k">${esc(t('Mejor rango'))}</div><div class="nm">${esc(meta.prank || C.parseRank(meta.prk)?.name || '')}</div><div class="pts">${meta.peak != null ? `<b>${int(meta.peak)}</b> ${esc(t('MMR máximo'))}` : ''}</div></div></div>`
    : `<div class="rank-c"><div style="width:56px"></div><div><div class="k">${esc(t('Mejor rango'))}</div><div class="nm">—</div><div class="pts">${esc(t('Sin datos todavía'))}</div></div></div>`;
  const last10 = games.slice(0, 10).reverse();
  const cs = streakOf(games), bs = bestStreak(games), feat = S.featured.has(String(P.id));
  const onlyCus = !P._a.gp && P._ac.gp;
  const seed = (S.settings.seeds || []).map(String).includes(String(P.id));
  MAIN.innerHTML = `
    <nav class="crumbs in"><a href="#jugadores">${esc(t('Jugadores'))}</a>${ICON.right}<span>${esc(P.n)}</span></nav>
    <section class="card in">
      <div class="ph">${avatar(P.n, P.id, 'lg')}<div style="min-width:0"><h1>${esc(P.n)} ${rank(meta.rk, 30)}${S.sup && S.sup.has(String(P.id)) ? `<span class="pill sup-pill" title="${esc(t('Apoya SlapScore'))}">♥ Supporter</span>` : ''}${((aw) => aw ? `${aw.months.length ? `<a class="pill aw-pill" href="#premios">${ICON.trophy}${esc(t('Jugador del mes'))} · ${esc(awMonth(aw.months[0]))}</a>` : ''}${aw.weeks ? `<a class="pill aw-pill" href="#premios">${ICON.trophy}${esc(t('Equipo de la semana'))}${aw.weeks > 1 ? ' ×' + aw.weeks : ''}</a>` : ''}` : '')(awardsOf(String(P.id)))}${favBtn(P.id, P.n)}${pushOk() || isIOS() ? `<button type="button" class="fav-btn bell-btn" data-pbell="${esc(P.id)}" data-n="${esc(P.n)}" aria-pressed="${pushOn && isFav(P.id)}" aria-label="${esc(t('Avisarme de sus partidos'))}" title="${esc(t('Avisarme de sus partidos'))}">${ICON.bell}</button>` : ''}</h1>
        <div class="meta"><span>ID ${esc(P.id)}</span>${allGames[0] ? `<span>${esc(t('Último partido {x}', { x: ago(allGames[0].t) }))}</span>` : ''}<a href="https://slapshot.gg/players/${encodeURIComponent(P.id)}" target="_blank" rel="noopener">slapshot.gg ${ICON.ext}</a></div>
        <div class="ph-tags">${streakPill(cs)}${feat ? `<span class="pill">${ICON.bolt}${esc(t('Destacado'))}</span>` : ''}${bs >= 3 ? `<span class="pill">${esc(t('Mejor racha: {n} victorias', { n: bs }))}</span>` : ''}${onlyCus ? `<span class="pill cu-pill">${esc(t('Solo juega custom'))}</span>` : ''}</div></div>
        <div class="avg">${badge(avgR, 'xl')}<span class="avg-l">${esc(t('Nota media'))}<small class="avg-m${cus ? ' cu' : ''}">${esc(t(cus ? 'en custom' : 'en públicas'))}</small></span></div></div>
      <div class="ph-acts"><a class="btn sm" href="#cmp-${esc(P.id)}">${ICON.vs}${esc(t('Comparar'))}</a><button class="btn sm" type="button" id="p-shimg">${ICON.share}${esc(t('Compartir imagen'))}</button><button class="btn sm" type="button" data-share>${esc(t('Copiar enlace'))}</button>${isAdmin() ? `<button class="btn sm" type="button" id="p-follow">${seed ? 'Dejar de seguir (admin)' : 'Seguir (admin)'}</button>` : ''}</div>
      <div class="ranks">${curRank}${peakRank}</div>
      ${modeSwitch(P, mode)}
      <div class="strip"><div><b>${int(a.gp)}</b><span>${esc(t('Partidos'))}</span></div><div><b>${a.w}-${a.l}${a.d ? '-' + a.d : ''}</b><span>${esc(a.d ? t('V-D-E') : t('V-D'))}</span></div><div><b>${pct(a.gp ? a.w / a.gp : 0)}</b><span>${esc(t('Victorias'))}</span></div><div><b>${int(a.mvp)}</b><span>MVP</span></div><div><b>${int(a.g)}</b><span>${esc(t('Goles'))}</span></div><div><b>${int(a.as)}</b><span>${esc(t('Asistencias'))}</span></div></div>
    </section>
    <div style="height:16px"></div>
    <div class="layout half">
      <div class="col">
        <div class="card in"><div class="card-h"><h3>${esc(t('Forma'))}</h3><small>${esc(t('últimos {n} partidos', { n: last10.length }))}</small></div><div class="form">${last10.map((g) => `<a href="${matchHref(g.k, g.i)}" title="${esc(shortDate(g.t) + ' · ' + g.gf + '-' + g.ga)}">${badge(g.rt)}<span class="res ${g.r}">${resLetter(g.r)}</span></a>`).join('')}</div></div>
        ${weekCard(games)}
        <div class="card in"><div class="card-h"><h3>${esc(t('Notas por partido'))}</h3><small>${esc(t('la línea es su media'))}</small></div><div class="chart">${ratingChart(games.slice(0, 30).reverse(), avgR)}</div></div>
        ${meta.rh && meta.rh.length > 1 ? `<div class="card in"><div class="card-h"><h3>${esc(t('Evolución del MMR'))}</h3><small>${esc(pl(meta.rh.length, 'registro', 'registros'))}</small></div><div class="chart">${mmrChart(meta.rh)}</div>${rankMoves(meta.rh)}</div>` : ''}
        ${attr ? `<div class="card in"><div class="card-h"><h3>${esc(t('Atributos'))}</h3><small>${esc(t('frente a {n} jugadores', { n: int(AT.n) }))}</small></div>${radar(attr)}</div>` : ''}
        ${arenaCard(games)}
      </div>
      <div class="col">
        <div class="card in"><div class="card-h"><h3>${esc(t('Estadísticas'))}</h3><div class="seg" role="group" aria-label="${esc(t('Modo'))}"><button type="button" data-sm="pg" aria-pressed="${PV.statMode === 'pg'}">${esc(t('Por partido'))}</button><button type="button" data-sm="tot" aria-pressed="${PV.statMode === 'tot'}">${esc(t('Totales'))}</button></div></div>
          <div id="pstats"></div></div>
        ${bestGamesCard(P, games)}
        ${matesCard(P, games)}
        ${rivalsCard(P, games)}
        <div class="card in"><div class="card-h"><h3>${esc(t('Partidos'))}</h3><div class="seg" role="group" aria-label="${esc(t('Filtrar'))}">${[['all', 'Todos'], ['W', 'Victorias'], ['L', 'Derrotas']].map(([k, l]) => `<button type="button" data-hf="${k}" aria-pressed="${PV.hist === k}">${esc(t(l))}</button>`).join('')}</div></div><div id="phist"></div></div>
      </div>
    </div>`;
  // estadísticas de toda su carrera en el modo elegido (públicas o custom)
  const drawStats = () => { $('#pstats').innerHTML = playerStats(a, PV.statMode); };
  wireModeSwitch();
  $$('[data-sm]', MAIN).forEach((b) => b.addEventListener('click', () => { PV.statMode = b.getAttribute('data-sm'); $$('[data-sm]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawStats(); }));
  $$('[data-hf]', MAIN).forEach((b) => b.addEventListener('click', () => { PV.hist = b.getAttribute('data-hf'); PV.histN = 15; $$('[data-hf]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawHist(P, games, a); }));
  const sh = $('[data-share]', MAIN); if (sh) sh.addEventListener('click', () => copyText(pageUrl('#j-' + P.id), sh));
  const fb = $('#p-follow'); if (fb) fb.addEventListener('click', () => adminFollow(P.id, !seed, fb));
  $('#p-shimg').addEventListener('click', () => shareImage('profile', { ...P, _g: games, _a: a, _mode: mode }, `slapscore-${String(P.n).replace(/[^\p{L}\p{N}_-]+/gu, '') || P.id}.png`));
  drawStats(); drawHist(P, games, a);
  // su equipo de la EUSL, si su nombre en la liga coincide con este jugador
  if (S.index && S.index.files && S.index.files.eusl) loadEusl().then((E) => {
    const r = E && E.roster && E.roster[String(P.id)], tg = $('.ph-tags', MAIN);
    if (!r || !tg || curHash() !== '#j-' + P.id || $('.eu-pill', tg)) return;
    const x = (E.teams || {})[r[0]] || {}, lg = (E.leagues || {})[r[1]] || '';
    tg.insertAdjacentHTML('beforeend', `<a class="pill eu-pill" href="#eusl" title="${esc(t('Juega en la EUSL'))}">${x.logo ? `<img src="${esc(x.logo)}" width="16" height="16" alt="" referrerpolicy="no-referrer" data-fb="rm">` : ''}EUSL ${esc(lg)} · ${esc(x.n || '?')}</a>`);
  }).catch(() => {});
}
async function adminFollow(pid, follow, btn) {
  btn.disabled = true;
  try { const A = await import('./admin.js'); await A.followPlayer(String(pid), follow, ctx()); }
  catch (e) { toast(e.message || 'No se pudo guardar.'); }
  btn.disabled = false;
}
// Forma semanal: partidos, victorias y nota de cada uno de los últimos 7 días (hora de Madrid)
function weekStats(games, from, to) {
  const x = { gp: 0, w: 0, rs: 0 };
  for (const g of games) { const d = C.madrid(g.t).day; if (d >= from && d <= to) { x.gp++; if (g.r === 'W') x.w++; x.rs += g.rt; } }
  return x;
}
function weekCard(games) {
  const td = today(), days = Array.from({ length: 7 }, (_, i) => dayAdd(td, i - 6));
  const per = new Map(days.map((d) => [d, { gp: 0, w: 0, l: 0, rs: 0 }]));
  for (const g of games) { const d = C.madrid(g.t).day; const x = per.get(d); if (!x) continue; x.gp++; if (g.r === 'W') x.w++; else if (g.r === 'L') x.l++; x.rs += g.rt; }
  const cur = weekStats(games, days[0], td), prev = weekStats(games, dayAdd(td, -13), dayAdd(td, -7));
  if (!cur.gp && !prev.gp) return '';
  const max = Math.max(1, ...[...per.values()].map((x) => x.gp));
  const cols = days.map((d) => {
    const x = per.get(d), h = x.gp ? Math.max(8, Math.round(x.gp / max * 64)) : 3, av = x.gp ? x.rs / x.gp : 0;
    return `<div class="wk-d${x.gp ? '' : ' none'}" title="${esc(dayLong(d))}: ${esc(pl(x.gp, 'partido', 'partidos'))}${x.gp ? ` · ${x.w}-${x.l}` : ''}"><span class="wk-n">${x.gp || ''}</span><span class="wk-b ${x.gp ? 'f-' + rcls(av) : ''}" style="height:${h}px"></span>${x.gp ? badge(av) : '<span class="rt" style="visibility:hidden">0</span>'}<small>${esc(d === td ? t('Hoy') : dayShort(d))}</small><span class="wk-wl">${x.gp ? `${x.w}-${x.l}` : '–'}</span></div>`;
  }).join('');
  const ca = cur.gp ? cur.rs / cur.gp : 0, pa = prev.gp ? prev.rs / prev.gp : 0, dl = cur.gp && prev.gp ? ca - pa : null;
  const trend = dl == null ? '' : `<span class="trend ${dl >= 0.05 ? 'up' : dl <= -0.05 ? 'down' : ''}">${dl >= 0 ? '▲' : '▼'} ${dec(Math.abs(dl), 1)}</span>`;
  return `<div class="card in"><div class="card-h"><h3>${esc(t('Forma semanal'))}</h3><small>${esc(t('últimos 7 días'))}</small></div>
    <div class="wk">${cols}</div>
    <div class="wk-sum"><div><b>${int(cur.gp)}</b><span>${esc(t('Partidos'))}</span></div><div><b>${cur.gp ? pct(cur.w / cur.gp) : '–'}</b><span>${esc(t('Victorias'))}</span></div><div><b>${cur.gp ? fmtR(ca) : '–'} ${trend}</b><span>${esc(prev.gp ? t('Nota media (vs semana anterior)') : t('Nota media'))}</span></div></div></div>`;
}
// Sus mejores partidos (por nota) entre los guardados
function bestGamesCard(P, games) {
  const best = games.slice().sort((x, y) => y.rt - x.rt).slice(0, 5);
  if (best.length < 3) return '';
  return `<div class="card in"><div class="card-h"><h3>${esc(t('Mejores partidos'))}</h3><small>${esc(t('por nota'))}</small></div>${best.map((g) => {
    const opp = g.op.map((id) => (P.names && P.names[id]) || id).join(', ');
    return `<a class="hrow" href="${matchHref(g.k, g.i)}"><span class="d">${esc(shortDate(g.t))}<br>${DF_TIME.format(new Date(g.t))}</span><span class="res ${g.r}">${resLetter(g.r)}</span><span class="vs"><span class="sc">${g.gf}-${g.ga}</span> vs ${esc(opp)}</span><span class="ga">${g.st.goals || 0} ${t('G')} · ${g.st.assists || 0} ${t('A')}${g.mv ? ' · MVP' : ''}</span>${badge(g.rt)}</a>`;
  }).join('')}<div style="height:6px"></div></div>`;
}
function playerStats(a, mode) {
  const gp = a.gp || 1, pg = mode === 'pg';
  const v = (x) => pg ? dec(x / gp) : int(x);
  const fo = a.fw + a.fl;
  const groups = [
    ['Ataque', [['Goles', v(a.g)], ['Tiros', v(a.sh)], ['Acierto de tiro', a.sh ? pct(a.g / a.sh) : '–'], ['Postes', v(a.ph)]]],
    ['Juego', [['Asistencias', v(a.as)], ['Pases', v(a.ps)], ['Posesión', pg ? C.fmtPoss(a.po / gp) : C.fmtPoss(a.po)], ['Faceoffs ganados', fo ? `${pct(a.fw / fo)} (${int(a.fw)}/${int(fo)})` : '–']]],
    ['Defensa', [['Paradas', v(a.sv)], ['Robos', v(a.tk)], ['Bloqueos', v(a.bl)], ['Pérdidas', v(a.to)]]],
  ];
  return groups.map(([ti, rows]) => `<div class="slist"><div class="sgrp-h">${esc(t(ti))}</div>${rows.map(([k, x]) => `<div class="row"><span>${esc(t(k))}</span><b>${x}</b></div>`).join('')}</div>`).join('');
}
// Compañeros y rivales más habituales (sirven también de sugerencias en el comparador)
function mates(P, games, key) {
  const m = new Map();
  for (const g of games) for (const id of g[key]) { const r = m.get(id) || { id, n: 0, w: 0 }; r.n++; if (g.r === 'W') r.w++; m.set(id, r); }
  return [...m.values()].sort((a, b) => b.n - a.n || b.w - a.w);
}
function matesCard(P, games) {
  const list = mates(P, games, 'mt').slice(0, 5);
  if (!list.length) return '';
  return `<div class="card in"><div class="card-h"><h3>${esc(t('Compañeros habituales'))}</h3><small>${esc(t('victorias juntos'))}</small></div><div style="padding-bottom:8px">${list.map((r, i) => {
    const n = (P.names && P.names[r.id]) || r.id;
    return `<a class="lrow" href="#j-${esc(r.id)}"><span class="i">${i + 1}</span>${avatar(n, r.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span>${esc(n)}${supMark(r.id)}</span><span class="sub">${esc(t('{n} juntos', { n: pl(r.n, 'partido', 'partidos') }))}</span></span><span class="v">${pct(r.w / r.n)}</span></a>`;
  }).join('')}</div></div>`;
}
// Rivales con los que más se ha cruzado: su % de victorias contra ellos y enlace al cara a cara
function rivalsCard(P, games) {
  const list = mates(P, games, 'op').filter((r) => r.n >= 2).slice(0, 5);
  if (list.length < 2) return '';
  return `<div class="card in"><div class="card-h"><h3>${esc(t('Rivales habituales'))}</h3><small>${esc(t('victorias contra ellos'))}</small></div><div style="padding-bottom:8px">${list.map((r, i) => {
    const n = (P.names && P.names[r.id]) || r.id;
    return `<a class="lrow" href="#cmp-${esc(P.id)}-${esc(r.id)}" title="${esc(t('Comparar'))}"><span class="i">${i + 1}</span>${avatar(n, r.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span>${esc(n)}</span><span class="sub">${esc(t('{n} en contra', { n: pl(r.n, 'partido', 'partidos') }))}</span></span><span class="v">${pct(r.w / r.n)}</span></a>`;
  }).join('')}</div></div>`;
}
// Cómo le va en cada arena (solo si ha jugado en varias)
function arenaCard(games) {
  const m = new Map();
  for (const g of games) { if (!g.ar) continue; const x = m.get(g.ar) || { n: 0, w: 0, rs: 0 }; x.n++; if (g.r === 'W') x.w++; x.rs += g.rt; m.set(g.ar, x); }
  const list = [...m.entries()].filter(([, x]) => x.n >= 3).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  if (list.length < 2) return '';
  return `<div class="card in"><div class="card-h"><h3>${esc(t('Por arena'))}</h3><small>${esc(t('% de victorias y nota media'))}</small></div><div class="dist-b">${list.map(([ar, x]) =>
    `<div class="ar-r" title="${esc(ar)}: ${esc(pl(x.n, 'partido', 'partidos'))} · ${x.w}-${x.n - x.w}"><span class="nm"><span>${esc(ar)}</span><small>${esc(pl(x.n, 'partido', 'partidos'))}</small></span><span class="bar"><i style="width:${Math.round(x.w / x.n * 100)}%"></i></span><span class="v">${pct(x.w / x.n)}</span>${badge(x.rs / x.n)}</div>`).join('')}</div></div>`;
}
function drawHist(P, games, a) {
  const el = $('#phist'); if (!el) return;
  const list = games.filter((g) => PV.hist === 'all' || g.r === PV.hist);
  if (!list.length) { el.innerHTML = `<div class="empty">${esc(t('No hay partidos con este filtro.'))}</div>`; return; }
  el.innerHTML = list.slice(0, PV.histN).map((g) => {
    const opp = g.op.map((id) => (P.names && P.names[id]) || id).join(', ');
    return `<a class="hrow" href="${matchHref(g.k, g.i)}"><span class="d">${esc(shortDate(g.t))}<br>${DF_TIME.format(new Date(g.t))}</span><span class="res ${g.r}">${resLetter(g.r)}</span><span class="vs"><span class="sc">${g.gf}-${g.ga}</span> vs ${esc(opp)}</span><span class="ga">${g.st.goals || 0} ${t('G')} · ${g.st.assists || 0} ${t('A')}</span>${badge(g.rt)}</a>`;
  }).join('') + (list.length > PV.histN ? `<div class="more"><button class="btn" type="button" id="h-more">${esc(t('Ver más ({n})', { n: list.length - PV.histN }))}</button></div>`
    : a.gp > games.length && PV.hist === 'all' ? `<p class="muted hnote">${esc(t('Aquí salen sus últimos {a} partidos. Las estadísticas cuentan los {b} de su carrera.', { a: int(games.length), b: int(a.gp) }))}</p>` : '');
  const b = $('#h-more'); if (b) b.addEventListener('click', () => { PV.histN += 20; drawHist(P, games, a); });
}
function ratingChart(gs, avgR) {
  if (!gs.length) return `<div class="empty">${esc(t('Sin partidos'))}</div>`;
  const Wd = 600, H = 180, L = 26, R = 8, T = 14, B = 20, lo = 4, hi = 10;
  const y = (v) => T + (H - T - B) * (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo));
  const n = gs.length, slot = (Wd - L - R) / Math.max(n, 10), bw = Math.min(16, slot * 0.6);
  let g = '';
  for (const v of [5, 6, 7, 8, 9, 10]) g += `<line class="gl" x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 7}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const bars = gs.map((x, i) => { const cx = L + slot * i + slot / 2, top = y(x.rt); return `<rect class="bar f-${rcls(x.rt)}" style="animation-delay:${i * 18}ms" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(lo) - top).toFixed(1)}" rx="3"><title>${esc(shortDate(x.t))} · ${fmtR(x.rt)}</title></rect>`; }).join('');
  const last = gs[n - 1], lx = L + slot * (n - 1) + slot / 2;
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${esc(t('Notas de los últimos {n} partidos', { n }))}">${g}${bars}<line class="avgl" x1="${L}" x2="${Wd - R}" y1="${y(avgR).toFixed(1)}" y2="${y(avgR).toFixed(1)}"/><text x="${lx.toFixed(1)}" y="${(y(last.rt) - 5).toFixed(1)}" text-anchor="middle" style="fill:var(--fg);font-weight:800">${fmtR(last.rt)}</text></svg>`;
}
// Cambios de rango (ascensos y descensos) a partir del historial [[t, mmr, rango], ...]
function rankMoves(rh) {
  const moves = [];
  for (let i = 1; i < rh.length; i++) {
    const a = C.parseRank(rh[i - 1][2]), b = C.parseRank(rh[i][2]);
    if (a && b && a.key !== b.key) moves.push({ t: rh[i][0], from: a, to: b, up: b.order > a.order, mmr: rh[i][1] });
  }
  if (!moves.length) return '';
  return `<div class="moves">${moves.slice(-4).reverse().map((x) => `<div class="mv ${x.up ? 'up' : 'down'}">${rank(x.from.key, 22)}<span class="ar">${x.up ? '▲' : '▼'}</span>${rank(x.to.key, 26)}<span class="tx"><b>${esc(x.up ? t('Ascenso a {r}', { r: x.to.name }) : t('Descenso a {r}', { r: x.to.name }))}</b><small>${esc(ago(x.t))} · ${int(x.mmr)} MMR</small></span></div>`).join('')}</div>`;
}
function mmrChart(rh) {
  const pts = rh.slice(-40), Wd = 600, H = 170, L = 40, R = 12, T = 14, B = 22;
  const vals = pts.map((p) => p[1]); let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 50) { lo -= 25; hi += 25; }
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const x = (tt) => L + (Wd - L - R) * (t1 === t0 ? 1 : (tt - t0) / (t1 - t0)), y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks = [lo, (lo + hi) / 2, hi].map(Math.round);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${esc(t('Evolución del MMR'))}">${ticks.map((v) => `<line class="gl" x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 7}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <path class="area" d="${line} L${x(last[0]).toFixed(1)} ${H - B} L${x(pts[0][0]).toFixed(1)} ${H - B}Z"/><path class="line" d="${line}"/>
    <circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="5" fill="var(--primary)" stroke="var(--surface)" stroke-width="2"/>
    <text x="${L}" y="${H - 4}">${esc(shortDate(t0))}</text><text x="${Wd - R}" y="${H - 4}" text-anchor="end">${esc(shortDate(t1))}</text></svg>`;
}
// Radar de atributos; con dos jugadores, dos formas superpuestas (colores de local y visitante)
function radar(attr, attr2) {
  const ax = C.ATTRS;
  const cx = 110, cy = 110, R = 78;
  const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / ax.length; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
  const ring = (v) => ax.map((_, i) => pt(i, v).map((n) => n.toFixed(1)).join(',')).join(' ');
  const shape = (at) => ax.map(([k], i) => pt(i, Math.max(0.06, (at[k] ?? 0) / 100)).map((n) => n.toFixed(1)).join(',')).join(' ');
  const labels = ax.map(([, l], i) => { const [x, y] = pt(i, 1.24); return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${esc(t(l))}</text>`; }).join('');
  const li = attr2
    ? ax.map(([k, l]) => `<li class="two"><span>${esc(t(l))}</span><span><b class="h">${attr[k] ?? '–'}</b> · <b class="a">${attr2[k] ?? '–'}</b></span><span class="b"><i class="h" style="width:${attr[k] ?? 0}%"></i></span><span class="b"><i class="a" style="width:${attr2[k] ?? 0}%"></i></span></li>`).join('')
    : ax.map(([k, l]) => `<li><span>${esc(t(l))}</span><span>${attr[k] == null ? '–' : attr[k]}</span><span class="b"><i style="width:${attr[k] ?? 0}%"></i></span></li>`).join('');
  return `<div class="radar"><svg viewBox="-36 -4 292 228" role="img" aria-label="${esc(t('Atributos del jugador'))}">${[0.25, 0.5, 0.75, 1].map((v) => `<polygon class="ax" points="${ring(v)}"/>`).join('')}${ax.map((_, i) => { const [x, y] = pt(i, 1); return `<line class="ax" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}<polygon class="shape${attr2 ? ' h' : ''}" points="${shape(attr)}"/>${attr2 ? `<polygon class="shape a" points="${shape(attr2)}"/>` : ''}${labels}</svg>
    <ul>${li}</ul></div>`;
}

// =====================================================================
// COMPARAR JUGADORES
// =====================================================================
const attrOf = (a, AT) => { if (!AT || AT.n < 2 || a.gp < 5) return null; const raw = C.attrRaw(a), o = {}; for (const [k] of C.ATTRS) o[k] = C.percentile(AT.q[k], raw[k]); return o; };
async function viewCompare(r, tok) {
  MAIN.innerHTML = skeletonList(6);
  let A, B, AT;
  try { [A, B, AT] = await Promise.all([loadP(r.a), r.b ? loadP(r.b).catch((e) => (e.status === 404 ? null : Promise.reject(e))) : null, loadAttr().catch(() => null)]); }
  catch (e) { if (!live(tok)) return; if (e.status === 404) return notFound(t('Este jugador no tiene partidos guardados todavía.')); return errorBox(e); }
  if (!live(tok)) return;
  const allA = A._g.filter((g) => !S.hidden.has(g.i));
  const sug = [...new Set([...mates(A, allA, 'op').slice(0, 6), ...mates(A, allA, 'mt').slice(0, 6)].map((x) => x.id))];
  // públicas o custom: el mismo modo para los dos jugadores
  const mode = PV.mode === 'cus' && (A._ac.gp || (B && B._ac.gp)) ? 'cus' : 'pub', cus = mode === 'cus';
  const ga = modeGames(allA, mode);
  const choose = (side) => pickPlayer(side === 'b' ? t('Comparar a {n} con…', { n: A.n }) : t('Cambiar jugador'), { id: side === 'b' ? String(A.id) : String(B && B.id), sug: side === 'b' ? sug : [] },
    (id) => { navTo(side === 'b' ? `#cmp-${A.id}-${id}` : `#cmp-${id}-${B.id}`); });
  const head = (P, side) => {
    const m = P.meta || {}, a = modeAgg(P, mode);
    return `<div class="cmp-p ${side}"><a href="#j-${esc(P.id)}" aria-label="${esc(P.n)}">${avatar(P.n, P.id, 'lg')}</a><a class="nm" href="#j-${esc(P.id)}"><span>${esc(P.n)}</span>${rank(m.rk, 24)}</a>
      <span class="sub">${m.rk ? `${esc(m.rank || C.parseRank(m.rk)?.name || '')} · ${int(m.mmr)} MMR` : esc(t('Sin rango'))}</span>${badge(a.gp ? a.rs / a.gp : 0, 'lg')}
      <button class="btn sm" type="button" data-chg="${side}">${esc(t('Cambiar'))}</button></div>`;
  };
  if (!B) {
    MAIN.innerHTML = `<nav class="crumbs in"><a href="#jugadores">${esc(t('Jugadores'))}</a>${ICON.right}<a href="#j-${esc(A.id)}">${esc(A.n)}</a>${ICON.right}<span>${esc(t('Comparar'))}</span></nav>
      <h1 class="h1 in">${esc(t('Comparar jugadores'))}</h1><p class="lead">${esc(t('Elige con quién comparar a {n}: estadísticas por partido, atributos y cara a cara.', { n: A.n }))}</p>
      <div class="card in cmp-head">${head(A, 'h')}<div class="cmp-vs">VS</div><div class="cmp-p a empty"><button class="btn primary" type="button" data-chg="b">${ICON.search}${esc(t('Elegir jugador'))}</button></div></div>
      ${sug.length ? `<div class="card in" style="margin-top:16px"><div class="card-h"><h3>${esc(t('Sugeridos'))}</h3><small>${esc(t('rivales y compañeros habituales'))}</small></div><div style="padding-bottom:8px">${sug.slice(0, 8).map((id) => { const n = (A.names && A.names[id]) || id; return `<a class="lrow" href="#cmp-${esc(A.id)}-${esc(id)}"><span class="i">${ICON.vs}</span>${avatar(n, id, 'sm')}<span class="nm"><span>${esc(n)}</span></span>${ICON.right}</a>`; }).join('')}</div></div>` : ''}`;
    MAIN.onclick = (e) => { const b = e.target.closest('[data-chg]'); if (b) choose('b'); };
    if (r.b) toast(t('Ese jugador no tiene partidos guardados todavía.'));
    return;
  }
  const gb = modeGames(B._g.filter((g) => !S.hidden.has(g.i)), mode);
  const a = modeAgg(A, mode), b = modeAgg(B, mode), ma = A.meta || {}, mb = B.meta || {};
  const anyCus = A._ac.gp || B._ac.gp;
  // cara a cara: partidos de los dos (de los últimos guardados de cada uno)
  const both = new Map();
  for (const g of ga) { const ida = String(B.id); if (g.op.includes(ida)) both.set(g.i, { g, vs: true, r: g.r }); else if (g.mt.includes(ida)) both.set(g.i, { g, vs: false, r: g.r }); }
  for (const g of gb) { if (both.has(g.i)) continue; const idb = String(A.id); const r2 = g.r === 'W' ? 'L' : g.r === 'L' ? 'W' : 'D'; if (g.op.includes(idb)) both.set(g.i, { g: { ...g, gf: g.ga, ga: g.gf }, vs: true, r: r2 }); else if (g.mt.includes(idb)) both.set(g.i, { g, vs: false, r: g.r }); }
  const h2h = [...both.values()].sort((x, y) => y.g.t - x.g.t);
  const vs = h2h.filter((x) => x.vs), tg = h2h.filter((x) => !x.vs);
  const vsW = vs.filter((x) => x.r === 'W').length, vsL = vs.filter((x) => x.r === 'L').length, tgW = tg.filter((x) => x.r === 'W').length;
  const per = (x, n) => n ? x / n : 0;
  const d2 = (v) => dec(v, 2), fo = (o) => (o.fw + o.fl) ? o.fw / (o.fw + o.fl) : 0;
  const rows = [
    ['Partidos', a.gp, b.gp, int], ['% de victorias', per(a.w, a.gp), per(b.w, b.gp), pct], ['Nota media', per(a.rs, a.gp), per(b.rs, b.gp), fmtR], ['MVP por partido', per(a.mvp, a.gp), per(b.mvp, b.gp), pct],
    ['Goles por partido', per(a.g, a.gp), per(b.g, b.gp), d2], ['Asistencias por partido', per(a.as, a.gp), per(b.as, b.gp), d2], ['Tiros por partido', per(a.sh, a.gp), per(b.sh, b.gp), d2],
    ['Acierto de tiro', per(a.g, a.sh), per(b.g, b.sh), pct], ['Paradas por partido', per(a.sv, a.gp), per(b.sv, b.gp), d2], ['Pases por partido', per(a.ps, a.gp), per(b.ps, b.gp), d2],
    ['Robos por partido', per(a.tk, a.gp), per(b.tk, b.gp), d2], ['Bloqueos por partido', per(a.bl, a.gp), per(b.bl, b.gp), d2], ['Pérdidas por partido', per(a.to, a.gp), per(b.to, b.gp), d2, true],
    ['Posesión por partido', per(a.po, a.gp), per(b.po, b.gp), (v) => C.fmtPoss(v)], ['Faceoffs ganados', fo(a), fo(b), pct],
  ];
  const rk = (ma.mmr != null || mb.mmr != null) ? [['MMR', ma.mmr || 0, mb.mmr || 0, int], ['MMR máximo', ma.peak || 0, mb.peak || 0, int]] : [];
  const atA = cus ? null : attrOf(a, AT), atB = cus ? null : attrOf(b, AT);
  MAIN.innerHTML = `<nav class="crumbs in"><a href="#jugadores">${esc(t('Jugadores'))}</a>${ICON.right}<span>${esc(t('Comparar'))}</span></nav>
    <h1 class="sr-only">${esc(A.n)} vs ${esc(B.n)}</h1>
    <div class="card in cmp-head">${head(A, 'h')}<div class="cmp-vs">VS<button class="ibtn" type="button" id="cmp-swap" title="${esc(t('Intercambiar'))}" aria-label="${esc(t('Intercambiar'))}">${ICON.vs}</button></div>${head(B, 'a')}</div>
    ${anyCus ? `<div class="cmp-mode in"><div class="seg mode-sw" role="group" aria-label="${esc(t('Tipo de partida'))}">${MODES.map(([k, l]) => `<button type="button" data-pm="${k}" aria-pressed="${mode === k}">${k === 'cus' ? '<span class="cu-dot" aria-hidden="true"></span>' : ''}${esc(t(l))}</button>`).join('')}</div></div>` : ''}
    <div style="height:16px"></div>
    <div class="layout two">
      <div class="col">
        <div class="card in"><div class="card-h"><h3>${esc(t('Estadísticas'))}</h3><small>${esc(t(cus ? 'toda su carrera en custom' : 'toda su carrera en públicas'))}</small></div><div class="card-b">
          ${rk.length ? `<div class="sgrp-h">${esc(t('Clasificatoria'))}</div>${rk.map(([l, x, y, f]) => cmpLine(t(l), x, y, f)).join('')}` : ''}
          <div class="sgrp-h">${esc(t('General'))}</div>${rows.slice(0, 4).map(([l, x, y, f, inv]) => cmpLine(t(l), x, y, f, inv)).join('')}
          <div class="sgrp-h">${esc(t('Por partido'))}</div>${rows.slice(4).map(([l, x, y, f, inv]) => cmpLine(t(l), x, y, f, inv)).join('')}
        </div></div>
      </div>
      <aside class="col">
        <div class="card in"><div class="card-h"><h3>${esc(t('Cara a cara'))}</h3><small>${esc(t('en sus partidos guardados'))}</small></div>
          <div class="h2h"><div><b>${vs.length ? `${vsW}-${vsL}` : '–'}</b><span>${esc(t('Enfrentados'))}</span><small>${esc(vs.length ? t('{n} de {a}', { n: pl(vsW, 'victoria', 'victorias'), a: A.n }) : t('Nunca se han enfrentado'))}</small></div><div><b>${tg.length ? `${tgW}-${tg.length - tgW}` : '–'}</b><span>${esc(t('Juntos'))}</span><small>${esc(tg.length ? t('{n} juntos', { n: pl(tg.length, 'partido', 'partidos') }) : t('Nunca han jugado juntos'))}</small></div></div>
          ${h2h.length ? `<div>${h2h.slice(0, 6).map((x) => `<a class="hrow" href="${matchHref(x.g.k, x.g.i)}"><span class="d">${esc(shortDate(x.g.t))}<br>${DF_TIME.format(new Date(x.g.t))}</span><span class="res ${x.r}">${resLetter(x.r)}</span><span class="vs"><span class="sc">${x.g.gf}-${x.g.ga}</span> ${esc(x.vs ? t('enfrentados') : t('juntos'))}</span><span></span>${badge(x.g.rt)}</a>`).join('')}</div>` : ''}
        </div>
        ${atA && atB ? `<div class="card in"><div class="card-h"><h3>${esc(t('Atributos'))}</h3><small><span class="dot h"></span> ${esc(A.n)} · <span class="dot a"></span> ${esc(B.n)}</small></div>${radar(atA, atB)}</div>` : ''}
      </aside>
    </div>`;
  MAIN.onclick = (e) => { const c = e.target.closest('[data-chg]'); if (c) choose(c.getAttribute('data-chg')); };
  wireModeSwitch();
  $('#cmp-swap').addEventListener('click', () => { navTo(`#cmp-${B.id}-${A.id}`); });
}

// =====================================================================
// JUGADORES (tabla)
// =====================================================================
const PF = { q: '', win: 'a', min: 3, sort: 'avg', dir: -1, limit: 50, fav: false, tier: '' };
const TIER_OPTS = [['', 'Todos los rangos'], ['LEGEND', 'Legend'], ['DIAMOND', 'Diamond'], ['PLAT', 'Platinum'], ['GOLD', 'Gold'], ['SILVER', 'Silver'], ['BRONZE', 'Bronze'], ['-', 'Sin rango']];
const PCOLS = [['mmr', 'Rango'], ['gp', 'PJ'], ['w', 'V'], ['wp', '% V'], ['avg', 'Nota'], ['mvp', 'MVP'], ['g', 'G'], ['as', 'A'], ['ga', 'G+A'], ['ppg', 'PTS/PJ'], ['sh', 'Tiros'], ['shp', '% tiro'], ['sv', 'Paradas'], ['ps', 'Pases'], ['tk', 'Robos'], ['to', 'Pérd.'], ['po', 'Posesión/PJ']];
async function viewPlayers(tok) {
  MAIN.innerHTML = `<h1 class="h1 in">${esc(t('Jugadores'))}</h1><p class="lead">${esc(t('Todos los jugadores con partidas públicas guardadas. Las custom van aparte, en el perfil de cada uno. Pulsa una columna para ordenar.'))}</p>
    <div class="card in"><div class="card-h" style="flex-wrap:wrap"><div class="toolbar" style="width:100%">
      <input class="input grow" id="p-q" type="search" placeholder="${esc(t('Buscar jugador'))}" value="${esc(PF.q)}" autocomplete="off" aria-label="${esc(t('Buscar jugador'))}">
      <div class="seg" role="group" aria-label="${esc(t('Periodo'))}">${[['a', 'Siempre'], ['m', '30 días'], ['k', '7 días']].map(([k, l]) => `<button type="button" data-w="${k}" aria-pressed="${PF.win === k}">${esc(t(l))}</button>`).join('')}</div>
      <select class="select" id="p-tier" aria-label="${esc(t('Rango'))}">${TIER_OPTS.map(([k, l]) => `<option value="${k}" ${PF.tier === k ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select>
      <select class="select" id="p-min" aria-label="${esc(t('Mínimo de partidos'))}">${[1, 3, 5, 10, 25].map((v) => `<option value="${v}" ${PF.min === v ? 'selected' : ''}>${esc(t('Mín. {n} PJ', { n: v }))}</option>`).join('')}</select>
      ${FAVS.size ? `<button type="button" class="chip tg" id="p-fav" aria-pressed="${PF.fav}">${ICON.star}${esc(t('Favoritos'))}</button>` : ''}
    </div></div><div class="tscroll" id="ptable">${Array.from({ length: 8 }, skRow).join('')}</div></div>`;
  let rows; try { rows = await loadTable(PF.win); } catch (e) { if (live(tok)) errorBox(e); return; }
  if (!live(tok)) return;
  let tq;
  $('#p-q').addEventListener('input', (e) => { clearTimeout(tq); tq = setTimeout(() => { PF.q = e.target.value; PF.limit = 50; drawPlayers(rows); }, 120); });
  $('#p-min').addEventListener('change', (e) => { PF.min = Number(e.target.value); PF.limit = 50; drawPlayers(rows); });
  $('#p-tier').addEventListener('change', (e) => { PF.tier = e.target.value; PF.limit = 50; drawPlayers(rows); });
  const pf = $('#p-fav'); if (pf) pf.addEventListener('click', () => { PF.fav = !PF.fav; pf.setAttribute('aria-pressed', String(PF.fav)); PF.limit = 50; drawPlayers(rows); });
  $$('[data-w]', MAIN).forEach((b) => b.addEventListener('click', async () => {
    PF.win = b.getAttribute('data-w'); PF.limit = 50; $$('[data-w]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const el = $('#ptable'); el.classList.add('busy');
    try { rows = await loadTable(PF.win); } catch { toast(t('No se pudo cargar la tabla.')); }
    if (live(tok)) { el.classList.remove('busy'); drawPlayers(rows); }
  }));
  $('#ptable').addEventListener('click', (e) => { const b = e.target.closest('[data-sort]'); if (!b) return; const k = b.getAttribute('data-sort'); if (PF.sort === k) PF.dir *= -1; else { PF.sort = k; PF.dir = -1; } drawPlayers(rows); });
  drawPlayers(rows);
}
function drawPlayers(all) {
  const q = fold(PF.q.trim()), fav = PF.fav && FAVS.size;
  const rows = [];
  for (const p of all) {
    const a = p.a; if (a.gp < (fav ? 1 : PF.min)) continue;
    if (q && !fold(p.n).includes(q)) continue;
    if (fav && !FAVS.has(String(p.id))) continue;
    if (PF.tier) { const rt = p.rk ? (C.parseRank(p.rk) || {}).tier : ''; if (PF.tier === '-' ? !!rt : rt !== PF.tier) continue; }
    rows.push({ p, v: { mmr: p.mmr ?? -1, gp: a.gp, w: a.w, wp: a.w / a.gp, avg: a.rs / a.gp, mvp: a.mvp, g: a.g, as: a.as, ga: a.g + a.as, ppg: (a.pt || 0) / a.gp, shp: a.sh ? a.g / a.sh : 0, sh: a.sh, sv: a.sv, ps: a.ps, tk: a.tk, to: a.to, po: a.po / a.gp } });
  }
  rows.sort((x, y) => (PF.dir === -1 ? y.v[PF.sort] - x.v[PF.sort] : x.v[PF.sort] - y.v[PF.sort]) || y.v.avg - x.v.avg);
  const el = $('#ptable'); if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="empty"><strong>${esc(t('Ningún jugador con estos filtros.'))}</strong>${esc(t('Baja el mínimo de partidos o cambia el periodo.'))}</div>`; return; }
  const shown = rows.slice(0, PF.limit);
  const fmt = (k, v) => k === 'avg' ? badge(v) : k === 'wp' || k === 'shp' ? pct(v) : k === 'po' ? C.fmtPoss(v) : k === 'ppg' ? int(Math.round(v)) : k === 'mmr' ? '' : int(v);
  el.innerHTML = `<table class="tbl"><thead><tr><th>${esc(t('Jugador'))}</th>${PCOLS.map(([k, l]) => `<th><button type="button" data-sort="${k}" class="${PF.sort === k ? 'on' : ''}" aria-label="${esc(t('Ordenar por {c}', { c: t(l) }))}">${esc(t(l))}${PF.sort === k ? (PF.dir === -1 ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}</tr></thead><tbody>
    ${shown.map((r) => `<tr><td><a class="pc" href="#j-${esc(r.p.id)}">${avatar(r.p.n, r.p.id, 'sm')}<span class="nm">${pname([r.p.id, r.p.n])}</span></a></td><td class="rkc"><span class="pc" style="justify-content:flex-end">${r.p.rk ? `${r.p.mmr != null ? int(r.p.mmr) : ''} ${rank(r.p.rk, 20)}` : '<span class="muted">–</span>'}</span></td>${PCOLS.slice(1).map(([k]) => `<td>${fmt(k, r.v[k])}</td>`).join('')}</tr>`).join('')}
  </tbody></table>${rows.length > PF.limit ? `<div class="more"><button class="btn" type="button" id="p-more">${esc(t('Ver más ({n})', { n: int(rows.length - PF.limit) }))}</button></div>` : ''}`;
  const b = $('#p-more'); if (b) b.addEventListener('click', () => { PF.limit += 50; drawPlayers(all); });
}

// =====================================================================
// RANKINGS
// =====================================================================
const rkTabs = (on) => `<div class="seg seg-links in" role="navigation" aria-label="${esc(t('Secciones'))}"><a href="#rankings" aria-current="${on === 'rankings' ? 'page' : 'false'}">${esc(t('Rankings'))}</a><a href="#records" aria-current="${on === 'records' ? 'page' : 'false'}">${esc(t('Récords'))}</a><a href="#premios" aria-current="${on === 'premios' ? 'page' : 'false'}">${esc(t('Premios'))}</a></div>`;
const RK = { win: 'a' };
async function viewRankings(tok) {
  MAIN.innerHTML = `${rkTabs('rankings')}<h1 class="h1 in">${esc(t('Rankings'))}</h1><p class="lead">${esc(t('Los mejores de la comunidad en partidas públicas. Las medias piden un mínimo de partidos para contar.'))}</p>
    <div class="toolbar" style="margin-bottom:16px"><div class="seg" role="group" aria-label="${esc(t('Periodo'))}">${[['a', 'Siempre'], ['m', '30 días'], ['k', '7 días']].map(([k, l]) => `<button type="button" data-w="${k}" aria-pressed="${RK.win === k}">${esc(t(l))}</button>`).join('')}</div></div>
    <div class="rk-grid" id="rk">${Array.from({ length: 6 }, () => skeletonList(5)).join('')}</div>`;
  let R; try { R = await loadRankings(); } catch (e) { if (live(tok)) errorBox(e); return; }
  if (!live(tok)) return;
  $$('[data-w]', MAIN).forEach((b) => b.addEventListener('click', () => { RK.win = b.getAttribute('data-w'); $$('[data-w]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawRankings(R); }));
  drawRankings(R);
  // reparto de rangos (de la lista de búsqueda, que tiene el rango de todos)
  loadSearch().then((rows) => { S.distHTML = rankDist(rows); if (live(tok)) { const el = $('#rk-dist'); if (el) el.outerHTML = S.distHTML; } }).catch(() => {});
}
function rankDist(rows) {
  const cnt = new Map(); let ranked = 0;
  for (const r of rows) { const k = r[2]; if (!k || !C.parseRank(k)) continue; cnt.set(k, (cnt.get(k) || 0) + 1); ranked++; }
  if (ranked < 10) return '';
  const pend = ((S.index && S.index.totals) || {}).rankBacklog || 0;
  const keys = [...RANK_KEYS].reverse(), max = Math.max(...keys.map((k) => cnt.get(k) || 0));
  return `<div class="card in dist"><div class="card-h"><h3>${esc(t('Reparto de rangos'))}</h3><small>${esc(t('{n} jugadores con rango', { n: int(ranked) }))}</small></div><div class="dist-b">${keys.map((k) => {
    const n = cnt.get(k) || 0;
    return `<div class="dist-r">${rank(k, 26)}<span class="nm">${esc(C.parseRank(k).name)}</span><span class="bar"><i style="width:${max ? Math.max(n ? 2 : 0, Math.round(n / max * 100)) : 0}%"></i></span><span class="v">${n && n / ranked < 0.005 ? '&lt;' + pct(0.01) : pct(n / ranked)}</span></div>`;
  }).join('')}</div>${pend > 0 ? `<p class="muted dist-n">${esc(t('El robot sigue consultando rangos: quedan {n} jugadores por mirar.', { n: int(pend) }))}</p>` : ''}</div>`;
}
function drawRankings(R) {
  const el = $('#rk'); if (!el) return;
  const W = R[RK.win] || {};
  const card = (title, note, list, fmt) => {
    if (!list || !list.length) return '';
    return `<div class="card in"><div class="card-h"><h3>${esc(t(title))}</h3><small>${esc(note)}</small></div><div style="padding-bottom:8px">${list.map((x, i) =>
      `<a class="lrow" href="#j-${esc(x.id)}"><span class="i">${i + 1}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t">${pname([x.id, x.n])}</span>${rank(x.rk, 20)}</span><span class="sub">${esc(pl(x.gp, 'partido', 'partidos'))}</span></span>${fmt(x.v)}</a>`).join('')}</div></div>`;
  };
  const v = (x) => `<span class="v">${int(x)}</span>`;
  const mmr = R.mmr || [];
  const mmrCard = mmr.length ? `<div class="card in"><div class="card-h"><h3>${esc(t('Top MMR'))}</h3><a href="#jugadores" data-allmmr>${esc(t('Ver todos'))}</a></div><div style="padding-bottom:8px">${mmr.map((p, i) =>
    `<a class="lrow" href="#j-${esc(p.id)}"><span class="i">${i + 1}</span>${rank(p.rk, 28)}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span>${pname([p.id, p.n])}</span><span class="sub">${esc(p.rank || '')}</span></span><span class="v">${int(p.mmr)}</span></a>`).join('')}</div></div>` : '';
  const minGp = W.min || 1, mn = t('mín. {n} PJ', { n: minGp }), tot = t('total');
  const html = mmrCard
    + card('Nota media', mn, W.avg, (x) => badge(x))
    + card('Goles', tot, W.g, v)
    + card('Asistencias', tot, W.as, v)
    + card('Goles + asistencias', tot, W.ga, v)
    + card('Jugador del partido', t('veces MVP'), W.mvp, v)
    + card('Paradas', tot, W.sv, v)
    + card('Pases', tot, W.ps, v)
    + card('Robos', tot, W.tk, v)
    + card('Bloqueos', tot, W.bl, v)
    + card('% de victorias', mn, W.wp, (x) => `<span class="v">${pct(x)}</span>`)
    + card('Más partidos', t('jugados'), W.gp, v);
  el.innerHTML = (html || `<div class="card empty">${esc(t('Todavía no hay datos para este periodo.'))}</div>`) + (S.distHTML || '<div id="rk-dist"></div>');
  const all = $('[data-allmmr]', el); if (all) all.addEventListener('click', (e) => { e.preventDefault(); PF.sort = 'mmr'; PF.dir = -1; PF.min = 1; PF.win = 'a'; PF.tier = ''; PF.q = ''; navTo('#jugadores'); });
}

// =====================================================================
// RÉCORDS
// =====================================================================
const REC = { win: 'a' };
async function viewRecords(tok) {
  MAIN.innerHTML = `${rkTabs('records')}<h1 class="h1 in">${esc(t('Récords'))}</h1><p class="lead">${esc(t('Las mejores marcas desde que SlapScore guarda partidos. Solo partidas públicas: las custom pueden ser de modos especiales.'))}</p>
    <div class="toolbar" style="margin-bottom:16px"><div class="seg" role="group" aria-label="${esc(t('Periodo'))}">${[['a', 'Siempre'], ['k', '7 días']].map(([k, l]) => `<button type="button" data-rw="${k}" aria-pressed="${REC.win === k}">${esc(t(l))}</button>`).join('')}</div></div>
    <div class="rk-grid" id="rec">${Array.from({ length: 6 }, () => skeletonList(5)).join('')}</div>`;
  let R; try { R = await loadRecords(); } catch (e) { if (!live(tok)) return; if (e.status === 404) { $('#rec').innerHTML = `<div class="card empty">${esc(t('Los récords aparecerán en unos minutos.'))}</div>`; return; } errorBox(e); return; }
  if (!live(tok)) return;
  $$('[data-rw]', MAIN).forEach((b) => b.addEventListener('click', () => { REC.win = b.getAttribute('data-rw'); $$('[data-rw]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawRecords(R); }));
  drawRecords(R);
}
function drawRecords(R0) {
  const el = $('#rec'); if (!el) return;
  const R = REC.win === 'k' && R0.week ? { ...R0.week, hot: R0.hot } : R0;
  const when = (x) => `${shortDate(x.t || Date.parse(x.d + 'T12:00:00Z'))}`;
  const mrow = (x, i, val, sub) => `<a class="lrow" href="${x.i ? matchHref(x.k, x.i) : '#j-' + esc(x.id)}"><span class="i">${i + 1}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t">${pname([x.id, x.n])}</span>${rank(x.rk, 20, { approx: x.ap })}</span><span class="sub">${esc(sub)}</span></span>${val}</a>`;
  const card = (title, note, list, fn) => list && list.length ? `<div class="card in"><div class="card-h"><h3>${esc(t(title))}</h3>${note ? `<small>${esc(t(note))}</small>` : ''}</div><div style="padding-bottom:8px">${list.map(fn).join('')}</div></div>` : '';
  const v = (n) => `<span class="v">${int(n)}</span>`;
  const sc = (x) => x.s ? ` · ${x.s[0]}-${x.s[1]}` : '';
  const html = card('Mejor nota en un partido', 'nota', R.rt, (x, i) => mrow(x, i, badge(x.rt), `${when(x)}${sc(x)} · ${x.g} ${t('G')} · ${x.as} ${t('A')}`))
    + card('Más goles en un partido', '', R.g, (x, i) => mrow(x, i, v(x.v), `${when(x)}${sc(x)}`))
    + card('Más asistencias en un partido', '', R.as, (x, i) => mrow(x, i, v(x.v), `${when(x)}${sc(x)}`))
    + card('Más paradas en un partido', '', R.sv, (x, i) => mrow(x, i, v(x.v), `${when(x)}${sc(x)}`))
    + card('Más puntos en un partido', 'puntos de juego', R.pts, (x, i) => mrow(x, i, v(x.v), `${when(x)}${sc(x)}`))
    + card('En racha ahora', 'victorias seguidas', R.hot, (x, i) => mrow(x, i, `<span class="v hot">${ICON.flame}${int(x.v)}</span>`, t('último partido {x}', { x: ago(x.t) })))
    + card('Mejores rachas', 'victorias seguidas', R.streak, (x, i) => mrow(x, i, v(x.v), t('entre sus últimos partidos')))
    + card('Más partidos en un día', '', R.gpd, (x, i) => mrow(x, i, v(x.gp), dayLong(x.d)))
    + card('Partidos con más goles', 'goles en total', R.tot, (x, i) => `<a class="lrow" href="${matchHref(x.k, x.i)}"><span class="i">${i + 1}</span><span class="region">${esc(regionShort(x.r))}</span><span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span>${x.s[0]}-${x.s[1]} · ${esc(typeLabel(x.y))}</span><span class="sub">${esc(when(x))} · ${esc(x.a || '')}</span></span>${v(x.s[0] + x.s[1])}</a>`);
  el.innerHTML = html || `<div class="card empty">${esc(t('Todavía no hay récords.'))}</div>`;
}

// =====================================================================
// PREMIOS
// =====================================================================
async function viewAwards(tok) {
  MAIN.innerHTML = `${rkTabs('premios')}<h1 class="h1 in">${esc(t('Premios'))}</h1><div id="aw">${skeletonList(6)}</div>`;
  let A; try { A = await loadAwards(); } catch (e) { if (!live(tok)) return; if (e.status === 404) { $('#aw').innerHTML = `<div class="card empty">${esc(t('Los premios aparecerán en unos minutos.'))}</div>`; return; } errorBox(e); return; }
  if (!live(tok)) return;
  const W = A.week || {}, M = A.month || {};
  const line = (x) => `${pl(x.gp, 'partido', 'partidos')} · ${Math.round((x.w / (x.gp || 1)) * 100)}% ${t('victorias')} · ${x.g} ${t('G')} · ${x.as} ${t('A')}`;
  const short = (x) => `${pl(x.gp, 'partido', 'partidos')} · ${Math.round((x.w / (x.gp || 1)) * 100)}% ${t('victorias')}`;
  const lrow = (x, i) => `<a class="lrow" href="#j-${esc(x.id)}"><span class="i">${i + 1}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t">${esc(x.n)}${supMark(x.id)}</span>${rank(x.rk, 20)}</span><span class="sub">${esc(short(x))}</span></span>${badge(x.rt)}</a>`;
  const list = (l, empty) => (l && l.length ? `<div style="padding-bottom:8px">${l.map(lrow).join('')}</div>` : `<div class="card-b muted">${esc(empty)}</div>`);
  const wl = (W.last && W.last.list) || [], ml = (M.last && M.last.list) || [];
  const champ = ml[0];
  const weekHero = `<section class="card in aw-card"><div class="card-h"><h2>${esc(t('Equipo de la semana'))}</h2><small>${W.last ? esc(awRange(W.last.f, W.last.t)) : ''}</small></div>
    ${wl.length >= 3 ? `<div class="tw-box">${teamRink(wl, true)}</div>` + `<div class="aw-sub">${wl.slice(0, 3).map((x, i) => `<span><b>${i + 1}.</b> ${esc(x.n)} · ${esc(line(x))}</span>`).join('')}</div><div class="card-b aw-acts"><button class="btn sm" type="button" data-aw-share="week">${ICON.share}${esc(t('Compartir imagen'))}</button></div>`
      : `<div class="card-b muted">${esc(t('Nadie llegó a {n} partidos públicos esa semana.', { n: A.minW }))}</div>`}</section>`;
  const monthHero = `<section class="card in aw-card"><div class="card-h"><h2>${esc(t('Jugador del mes'))}</h2><small>${M.last ? esc(awMonth(M.last.m)) : ''}</small></div>
    ${champ ? `<a class="aw-champ" href="#j-${esc(champ.id)}">${avatar(champ.n, champ.id, 'lg')}<span class="aw-cn"><span class="nr"><b>${esc(champ.n)}</b>${supMark(champ.id)}${rank(champ.rk, 24)}</span><small>${esc(line(champ))}</small></span>${badge(champ.rt, 'md')}</a>
      ${ml.slice(1, 3).map((x, i) => lrow(x, i + 1)).join('')}<div class="card-b aw-acts"><button class="btn sm" type="button" data-aw-share="month">${ICON.share}${esc(t('Compartir imagen'))}</button></div>`
      : `<div class="card-b muted">${esc(t('Nadie llegó a {n} partidos públicos ese mes.', { n: A.minM }))}</div>`}</section>`;
  const hw = (A.hist && A.hist.w) || [], hm = (A.hist && A.hist.m) || [];
  const histW = hw.length > 1 ? `<div class="card in"><div class="card-h"><h3>${esc(t('Equipos de la semana anteriores'))}</h3></div><div style="padding-bottom:8px">${hw.slice(1).map((x) => `<div class="aw-hist"><span class="aw-d">${esc(awRange(x.f, x.t))}</span><span class="aw-ns">${x.top.map(([id, n], i) => `<a href="#j-${esc(id)}"><b>${i + 1}.</b> ${esc(n)}</a>`).join('')}</span></div>`).join('')}</div></div>` : '';
  const histM = hm.length > 1 ? `<div class="card in"><div class="card-h"><h3>${esc(t('Jugadores del mes anteriores'))}</h3></div><div style="padding-bottom:8px">${hm.slice(1).map((x) => `<div class="aw-hist"><span class="aw-d">${esc(awMonth(x.m))}</span><span class="aw-ns">${x.top[0] ? `<a href="#j-${esc(x.top[0][0])}">${esc(x.top[0][1])}</a> ${badge(x.top[0][3])}` : '—'}</span></div>`).join('')}</div></div>` : '';
  $('#aw').innerHTML = `<p class="lead">${esc(t('La mejor nota media en partidas públicas (las custom no cuentan), con un mínimo de {w} partidos en la semana y {m} en el mes. Semanas de lunes a domingo, en hora de Madrid.', { w: A.minW, m: A.minM }))}</p>
    <div class="aw-grid">${weekHero}${monthHero}</div>
    <div class="aw-grid">
      <div class="card in"><div class="card-h"><h3>${esc(t('Esta semana, de momento'))}</h3><small>${W.cur ? esc(awRange(W.cur.f, W.cur.t)) : ''}</small></div>${list(W.cur && W.cur.list, t('Aún nadie llega a {n} partidos esta semana.', { n: A.minW }))}</div>
      <div class="card in"><div class="card-h"><h3>${esc(t('Este mes, de momento'))}</h3><small>${M.cur ? esc(awMonth(M.cur.m)) : ''}</small></div>${list(M.cur && M.cur.list, t('Aún nadie llega a {n} partidos este mes.', { n: A.minM }))}</div>
    </div>${histW || histM ? `<div class="aw-grid">${histW}${histM}</div>` : ''}`;
  $$('[data-aw-share]', MAIN).forEach((b) => b.addEventListener('click', () => {
    const k = b.getAttribute('data-aw-share');
    if (k === 'week') shareImage('week', { list: wl.slice(0, 3), label: awRange(W.last.f, W.last.t) }, `slapscore-equipo-semana-${W.last.f}.png`);
    else shareImage('month', { list: ml.slice(0, 3), label: awMonth(M.last.m) }, `slapscore-jugador-mes-${M.last.m}.png`);
  }));
}
// Premios de un jugador (para su perfil): veces en el equipo de la semana y meses como jugador del mes
function awardsOf(pid) {
  const A = S.awards; if (!A || !A.hist) return null;
  const weeks = (A.hist.w || []).filter((x) => x.top.some((y) => y[0] === pid)).length;
  const months = (A.hist.m || []).filter((x) => x.top[0] && x.top[0][0] === pid).map((x) => x.m);
  return weeks || months.length ? { weeks, months } : null;
}

// =====================================================================
// EUSL
// =====================================================================
const EU = { tab: 'tabla' };
async function viewEusl(tok) {
  MAIN.innerHTML = skeletonList(8);
  let E; try { E = await loadEusl(); } catch (e) { if (!live(tok)) return; if (e.status === 404) return notFound(t('Los datos de la EUSL aparecerán en unos minutos.')); return errorBox(e); }
  if (!live(tok)) return;
  // escudo del equipo (de eusl.gg); si no carga, sus iniciales
  // con link, el nombre lleva a la ficha del equipo en eusl.gg (no en los resultados: la fila entera ya es un enlace)
  const team = (id, size = 22, link = false) => {
    const x = E.teams[id] || { n: '?' }, ab = `<span class="eu-x" style="--h:${hue(x.n)};width:${size}px;height:${size}px"${x.logo ? ' hidden' : ''}>${esc(String(x.ab || x.n || '').slice(0, 3))}</span>`;
    const nm = link && /^https:\/\/(www\.)?eusl\.gg\//.test(x.link || '') ? `<a class="t" href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.n)}</a>` : `<span class="t">${esc(x.n)}</span>`;
    return `<span class="eu-t">${x.logo ? `<img src="${esc(x.logo)}" width="${size}" height="${size}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fb="next">` : ''}${ab}${nm}</span>`;
  };
  const lg = (id) => E.leagues[id] || '';
  const tabs = [['tabla', 'Clasificación'], ['res', 'Resultados'], ['prox', 'Próximos'], ['gol', 'Jugadores']];
  MAIN.innerHTML = `<div class="eu-h in"><div><h1 class="h1">EUSL · ${esc(E.season.name.replace(/^Season/i, t('Temporada')))}</h1><p class="lead" style="margin:0">${esc(t('European Slapshot League: clasificación, resultados y máximos anotadores.'))} ${t('Datos de {a}', { a: `<a href="${esc(E.source)}" target="_blank" rel="noopener">eusl.gg</a>` })} · ${esc(t('actualizado {x}', { x: ago(Date.parse(E.updated)) }))}</p></div></div>
    <div class="card in"><div class="tabs" role="tablist" id="eutabs">${tabs.map(([k, l]) => `<button type="button" role="tab" data-eu="${k}" aria-selected="${EU.tab === k}">${esc(t(l))}</button>`).join('')}<span class="ind"></span></div><div id="eupanel"></div></div>`;
  const draw = () => {
    const el = $('#eupanel'); if (!el) return;
    if (EU.tab === 'tabla') {
      el.innerHTML = E.tables.length ? E.tables.map((tb) => {
        const ot = tb.rows.some((r) => r.otw || r.otl);
        return `<div class="sgrp-h eu-sh">${esc(tb.title.replace(/Season \d+/i, '').trim() || tb.title)}</div><div class="tscroll"><table class="tbl eu-tbl"><thead><tr><th>#&nbsp;&nbsp;${esc(t('Equipo'))}</th><th title="${esc(t('Partidos jugados'))}">${esc(t('PJ'))}</th><th title="${esc(t('Victorias'))}">${esc(t('V'))}</th><th title="${esc(t('Derrotas'))}">${esc(t('D'))}</th>${ot ? `<th title="${esc(t('Victorias en prórroga'))}">${esc(t('VP'))}</th><th title="${esc(t('Derrotas en prórroga'))}">${esc(t('DP'))}</th>` : ''}<th title="${esc(t('Goles a favor'))}">${esc(t('GF'))}</th><th title="${esc(t('Goles en contra'))}">${esc(t('GC'))}</th><th title="${esc(t('Diferencia de goles'))}">${esc(t('DG'))}</th><th title="${esc(t('Puntos'))}">${esc(t('PTS'))}</th></tr></thead><tbody>
          ${tb.rows.map((r) => `<tr><td><span class="pc"><span class="i">${r.pos}</span>${team(r.id, 22, true)}</span></td><td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td>${ot ? `<td>${r.otw}</td><td>${r.otl}</td>` : ''}<td>${r.gf}</td><td>${r.ga}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td></tr>`).join('')}</tbody></table></div>`;
      }).join('') : `<div class="empty">${esc(t('Sin clasificación todavía.'))}</div>`;
    } else if (EU.tab === 'res' || EU.tab === 'prox') {
      const list = EU.tab === 'res' ? E.results : E.upcoming;
      el.innerHTML = list.length ? list.map((g) => {
        const [a, b] = g.teams, w = g.s ? (g.s[0] > g.s[1] ? 0 : g.s[1] > g.s[0] ? 1 : -1) : -1;
        return `<a class="ev eu-ev" href="${/^https:\/\/(www\.)?eusl\.gg\//.test(g.link || '') ? esc(g.link) : '#eusl'}" target="_blank" rel="noopener"><div class="ev-time"><b>${esc(shortDate(g.t))}</b><span>${g.s ? (g.ot ? `<span class="ot">${esc(t('Prór.'))}</span>` : esc(t('Final'))) : DF_TIME.format(new Date(g.t))}</span></div>
          <div class="ev-teams"><div class="ev-team${w === 0 ? ' won' : ''}">${team(a, 18)}</div><div class="ev-team${w === 1 ? ' won' : ''}">${team(b, 18)}</div></div>
          <div class="ev-score">${g.s ? `<span class="${w === 0 ? 'won' : ''}">${g.s[0]}</span><span class="${w === 1 ? 'won' : ''}">${g.s[1]}</span>` : ''}</div><div class="ev-mvp"><span class="region" title="${esc(lg(g.league))}">${esc(/playoff/i.test(lg(g.league)) ? 'PO' : lg(g.league).slice(0, 3).toUpperCase())}</span></div></a>`;
      }).join('') : `<div class="empty"><strong>${esc(EU.tab === 'res' ? t('Sin resultados todavía.') : t('No hay partidos programados.'))}</strong>${EU.tab === 'prox' ? esc(t('Cuando la liga publique el calendario, aparecerá aquí.')) : ''}</div>`;
    } else {
      const block = (title, rows) => rows.length ? `<div class="sgrp-h eu-sh">${esc(title)}</div><div class="tscroll"><table class="tbl eu-tbl"><thead><tr><th>${esc(t('Jugador'))}</th><th>${esc(t('Equipo'))}</th><th title="${esc(t('Partidos jugados'))}">${esc(t('PJ'))}</th><th title="${esc(t('Goles'))}">${esc(t('G'))}</th><th title="${esc(t('Asistencias'))}">${esc(t('A'))}</th><th title="${esc(t('Goles más asistencias'))}">${esc(t('G+A'))}</th><th title="${esc(t('Paradas'))}">${esc(t('PAR'))}</th></tr></thead><tbody>
        ${rows.map((x, i) => `<tr><td><span class="pc"><span class="i">${i + 1}</span>${x.sid ? `<a href="#j-${esc(x.sid)}">${esc(x.n)}</a>` : esc(x.n)}</span></td><td>${team(x.team, 18, true)}</td><td>${x.gp}</td><td>${x.g}</td><td>${x.a}</td><td><b>${x.g + x.a}</b></td><td>${x.sv}</td></tr>`).join('')}</tbody></table></div>` : '';
      el.innerHTML = (block('Pro', E.scorers.pro || []) + block('Challenger', E.scorers.challenger || [])) || `<div class="empty">${esc(t('Sin estadísticas todavía.'))}</div>`;
      el.insertAdjacentHTML('beforeend', `<p class="muted hnote">${esc(t('Los nombres enlazados llevan a su perfil de SlapScore.'))}</p>`);
    }
  };
  const tabsEl = $('#eutabs');
  const moveInd = () => { const b = $('[aria-selected="true"]', tabsEl), ind = $('.ind', tabsEl); if (b && ind) { ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`; } };
  $$('[data-eu]', tabsEl).forEach((b) => b.addEventListener('click', () => { EU.tab = b.getAttribute('data-eu'); $$('[data-eu]', tabsEl).forEach((x) => x.setAttribute('aria-selected', String(x === b))); moveInd(); draw(); const p = $('#eupanel'); if (p && !REDUCED.matches) { p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap'); } }));
  S.onResize = moveInd; requestAnimationFrame(moveInd); if (document.fonts) document.fonts.ready.then(() => { if (S.onResize === moveInd) moveInd(); });
  draw();
}

// =====================================================================
// CÓMO PUNTUAMOS
// =====================================================================
// Aviso legal y privacidad (texto en assets/legal.js, se carga al entrar)
async function viewLegal(tok) {
  let L;
  try { L = await import('./legal.js'); } catch (e) { if (live(tok)) errorBox(e); return; }
  if (!live(tok)) return;
  MAIN.innerHTML = L.render(LANG);
  MAIN.onclick = (e) => {
    const a = e.target.closest('[data-legal-go]'); if (!a) return;
    e.preventDefault();
    const el = document.getElementById('lg-' + a.getAttribute('data-legal-go'));
    if (el) el.scrollIntoView({ behavior: REDUCED.matches ? 'auto' : 'smooth', block: 'start' });
  };
}
// =====================================================================
// NOVEDADES: todo lo que hace SlapScore y lo último que ha llegado (news.js)
// =====================================================================
const infoTabs = (on) => `<div class="seg seg-links in" role="navigation" aria-label="${esc(t('Secciones'))}"><a href="#novedades" aria-current="${on === 'novedades' ? 'page' : 'false'}">${esc(t('Novedades'))}</a><a href="#notas" aria-current="${on === 'notas' ? 'page' : 'false'}">${esc(t('Cómo puntuamos'))}</a></div>`;
function newsBanner() {
  if (!newsUnseen()) return '';
  return `<div class="news-banner in" id="news-banner" role="status"><span class="nb-ic">${ICON.bolt}</span><p><b>${esc(t('Novedades'))}</b> ${esc(t(NEWS_HEADLINE))}</p><a class="btn sm primary" href="#novedades">${esc(t('Ver novedades'))}</a><button type="button" class="nb-x" data-news-x aria-label="${esc(t('Cerrar'))}" title="${esc(t('Cerrar'))}">✕</button></div>`;
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-news-x]')) { e.preventDefault(); newsSeen(); } });
const DF_NEWS = new Intl.DateTimeFormat(LOC, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function viewNews() {
  const now = Date.parse(today() + 'T12:00:00Z');
  const isNew = (f) => f.nuevo && now - Date.parse(f.nuevo + 'T12:00:00Z') <= 45 * 86400000;
  const go = (f) => (f.action === 'feedback' ? `<button type="button" class="tbtn nw-go" data-fb>${esc(t('Abrir el buzón'))}${ICON.right}</button>`
    : f.action === 'support' ? (supportUrl() ? `<a class="tbtn nw-go" href="${esc(supportUrl())}" target="_blank" rel="noopener">${esc(t('Ir a Ko-fi'))}${ICON.ext}</a>` : '')
    : f.href ? `<a class="tbtn nw-go" href="${esc(f.href)}">${esc(t('Abrir'))}${ICON.right}</a>` : '');
  const tile = (f, big) => `<div class="nw-item${big ? ' big' : ''}"><span class="nw-ic">${ICON[f.icon] || ICON.info}</span><div class="nw-b"><h3>${esc(t(f.title))}${!big && isNew(f) ? ` <span class="pill nw-new">${esc(t('Nuevo'))}</span>` : ''}</h3><p>${esc(t(f.text))}</p>${go(f)}</div></div>`;
  const recent = FEATURES.filter(isNew).sort((a, b) => (b.nuevo > a.nuevo) - (b.nuevo < a.nuevo));
  const byDay = [...new Set(recent.map((f) => f.nuevo))];
  const latest = recent.length ? `<section class="card in nw-latest"><div class="card-h"><h2>${esc(t('Lo último'))}</h2></div>${byDay.map((d) => `<div class="nw-day"><span class="nw-d">${esc(DF_NEWS.format(new Date(d + 'T12:00:00Z')))}</span>${recent.filter((f) => f.nuevo === d).map((f) => tile(f, true)).join('')}</div>`).join('')}</section>` : '';
  const all = GROUPS.map(([g, label]) => `<section class="nw-group"><h2 class="nw-gh">${esc(t(label))}</h2><div class="nw-grid">${FEATURES.filter((f) => f.g === g).map((f) => `<div class="card in">${tile(f, false)}</div>`).join('')}</div></section>`).join('');
  MAIN.innerHTML = `${infoTabs('novedades')}<h1 class="h1 in">${esc(t('Novedades'))}</h1><p class="lead">${esc(t('Todo lo que puedes hacer en SlapScore, y lo último que ha llegado.'))}</p>
    ${latest}<h2 class="nw-all">${esc(t('Todo lo que puedes hacer'))}</h2>${all}
    <p class="muted nw-foot">${esc(t('¿Echas algo en falta?'))} <button type="button" class="tbtn" data-fb>${esc(t('Cuéntanoslo'))}</button></p>`;
  newsSeen();
}

function viewMethod() {
  const W = S.W, D = C.DEFAULT_WEIGHTS;
  const tt = (S.index && S.index.totals) || {}, lr = (S.index && S.index.lastRun) || {};
  const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + dec(Math.abs(x), Math.abs(x) < 0.1 ? 3 : 2).replace(/[.,]?0+$/, '');
  MAIN.innerHTML = `${infoTabs('notas')}<h1 class="h1 in">${esc(t('Cómo puntuamos'))}</h1><p class="lead">${esc(t('Cada jugador recibe en cada partido una nota de 3 a 10 calculada solo con las estadísticas del partido.'))}</p>
    <div class="layout half"><div class="col">
      <div class="card in"><div class="card-h"><h3>${esc(t('La nota'))}</h3></div><div class="card-b">
        <p>${t('Todos empiezan en {b}. Cada acción suma o resta según su peso; después se añade el resultado y se resta un poco por cada gol que encaja su equipo, porque en Slapshot defienden todos.', { b: `<b>${dec(W.base)}</b>` })}</p>
        <p>${esc(t('En 2v2 y 1v1 cada jugador acumula más acciones, así que ahí pesan menos para que las notas se puedan comparar entre formatos. Por encima de 8,5 y por debajo de 4,5 la escala se comprime, así que un 10 o un 3 solo salen en partidos excepcionales. El jugador con la nota más alta es el MVP.'))}</p>
        <p>${esc(t('Las partidas públicas y las custom van por separado: cada jugador tiene una nota media y unas estadísticas para cada tipo, y en su perfil eliges cuáles ver. Las tablas, los rankings y los récords cuentan solo las públicas.'))}</p>
        <p>${esc(t('En las partidas custom con periodos, slapshot.gg da cada periodo por separado. SlapScore los junta en un solo partido: el resultado y las estadísticas son las del partido entero, cuenta como un partido y dentro puedes ver cada periodo. La nota del partido es la media de las notas de los periodos que jugó.'))}</p>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:10px">${[[9.2, '9 o más'], [8.4, '8 – 8,9'], [7.4, '7 – 7,9'], [6.7, '6,5 – 6,9'], [6.2, '6 – 6,4'], [5.5, 'menos de 6']].map(([r, l]) => `<span style="display:flex;gap:8px;align-items:center">${badge(r)}<span class="muted">${esc(t(l))}</span></span>`).join('')}</div>
      </div></div>
      <div class="card in"><div class="card-h"><h3>${esc(t('Rangos'))}</h3><small>${esc(hasOfficial() ? t('logos oficiales') : t('emblemas de SlapScore'))}</small></div><div class="card-b"><div class="rk-legend">
        ${RANK_KEYS.map((k) => `<div>${rank(k, 34)}<b>${esc(C.parseRank(k).name)}</b></div>`).join('')}
        </div><p class="muted" style="margin:14px 0 0;font-size:13px">${esc(t('El rango de cada jugador en un partido es el que tenía según el último registro de SlapScore anterior a ese partido. Si el partido es de antes de empezar a seguirle, se muestra atenuado como aproximado.'))}</p></div></div>
      <div class="card in"><div class="card-h"><h3>${esc(t('De dónde salen los datos'))}</h3></div><div class="card-b">
        <p>${t('Un robot revisa sin parar los perfiles públicos de {a}: los últimos 10 partidos de cada jugador con todas sus estadísticas, y su rango y MMR. Cada jugador que aparece en un partido entra en la lista y los más activos se revisan más a menudo.', { a: '<a href="https://slapshot.gg" target="_blank" rel="noopener">slapshot.gg</a>' })}</p>
        <p>${esc(t('La web se actualiza cada 3-4 minutos. Los jugadores destacados (los de más MMR y los que sigue SlapScore) van los primeros: mientras juegan, sus partidos salen en pocos minutos.'))}</p>
        <p>${esc(t('Guardamos el detalle completo de los partidos de los últimos {n} días. Los anteriores pasan a un archivo descargable, pero sus notas, los perfiles y las estadísticas de carrera de cada jugador se conservan siempre.', { n: int((S.index && S.index.retain) || 60) }))}</p>
        <p class="muted">${esc(t('Ahora mismo: {m} partidos, {p} jugadores con partidos, {r} con rango. Última pasada {x}: {n} partidos nuevos.', { m: int(tt.matches), p: int(tt.players), r: int(tt.ranked), x: lr.at ? ago(Date.parse(lr.at)) : '–', n: int(lr.newMatches) }))}</p>
      </div></div>
    </div><div class="col">
      <div class="card in"><div class="card-h"><h3>${esc(t('Pesos de cada acción'))}</h3>${JSON.stringify(W) !== JSON.stringify(D) ? `<small>${esc(t('personalizados'))}</small>` : ''}</div><div class="tscroll"><table class="tbl"><thead><tr><th>${esc(t('Acción'))}</th><th>${esc(t('Peso'))}</th></tr></thead><tbody>
        ${C.WEIGHT_FIELDS.map(([k, l]) => `<tr><td>${esc(t(l))}</td><td>${k === 'base' ? dec(W[k]) : k.startsWith('fmt') ? '×' + dec(W[k], 2) : sign(W[k])}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="card in"><div class="card-h"><h3>${esc(t('Privacidad'))}</h3></div><div class="card-b">
        <p style="margin-top:0">${esc(t('SlapScore no usa cookies ni publicidad. Para saber cuánta gente usa la web contamos las visitas de forma anónima: qué páginas se ven, desde qué web se llega, el país y el tipo de dispositivo.'))}</p>
        <p>${esc(t('No guardamos tu IP ni ponemos identificadores en tu navegador. Tus favoritos y ajustes se quedan solo en él.'))}</p>
        <p style="margin-bottom:0"><a href="#legal">${esc(t('Aviso legal y privacidad'))}</a></p>
      </div></div>
    </div></div>`;
}

// =====================================================================
// ADMIN
// =====================================================================
function ctx() {
  return { S, C, esc, toast, emblem, avatar, badge, fmtR, dec, int, ago, getJSON, loadPlayers, loadSearch, applySettings, refreshData, renderChrome, go, isAdmin, ADMIN_KEY, rank, RANK_KEYS, setOfficial, supportUrl, apiBase, NOTRACK_KEY, loadP, navTo, curHash };
}
async function viewAdmin(tok) {
  MAIN.innerHTML = skeletonList(4);
  try { const A = await import('./admin.js'); if (live(tok)) await A.mount(MAIN, ctx()); }
  catch (e) { if (live(tok)) errorBox(e); }
}

// =====================================================================
// ACTUALIZACIÓN DE DATOS
// =====================================================================
async function fetchIndex() {
  const [idx, set, ranks] = await Promise.all([getJSON('data/index.json', true), getJSON('config/settings.json', true).catch(() => null), getJSON('assets/ranks/index.json', true).catch(() => ({}))]);
  setOfficial(ranks);
  return { idx, set };
}
async function refreshData(manual, silent) {
  const btn = $('#btn-refresh'); btn.classList.add('spin');
  try {
    const { idx, set } = await fetchIndex();
    if (set) applySettings(set);
    const changed = idx.updated !== S.ver;
    const prev = S.index && S.index.totals ? S.index.totals.matches : 0;
    setIndex(idx); $('#newbar').hidden = true;
    renderChrome(); go({ keepScroll: true, silent: !!silent });
    if (manual) toast(changed ? (idx.totals.matches > prev ? (idx.totals.matches - prev === 1 ? t('Datos actualizados · 1 partido nuevo') : t('Datos actualizados · {n} partidos nuevos', { n: int(idx.totals.matches - prev) })) : t('Datos actualizados')) : t('Ya tienes lo último'));
    return changed;
  } catch (e) { if (manual) toast(t('No se pudo actualizar. Comprueba tu conexión.')); return false; }
  finally { btn.classList.remove('spin'); }
}
$('#btn-refresh').addEventListener('click', () => refreshData(true));
$('#btn-new').addEventListener('click', () => refreshData(true));
// Cada 90 s se mira si hay datos nuevos. En la lista de hoy, arriba del todo y sin nada abierto, se actualiza sola;
// en el resto de casos aparece el aviso "Hay partidos nuevos".
function canAutoApply() {
  const r = route();
  if (r.view !== 'matches' || pickDay(r.day) !== today()) return false;
  if (window.scrollY > 320 || $('#ovl') || $('#cal') || $('.ev-box.open')) return false;
  const a = document.activeElement; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return false;
  return true;
}
setInterval(async () => {
  if (document.hidden || !S.index || !S.booted) return;
  try {
    const idx = await getJSON('data/index.json', true);
    if (idx.updated === S.ver) return;
    if (canAutoApply()) refreshData(false, true); else $('#newbar').hidden = false;
  } catch {}
}, 90_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.booted && S.index && Date.now() - Date.parse(S.index.updated) > 5 * 60_000) getJSON('data/index.json', true).then((idx) => { if (idx.updated !== S.ver) { if (canAutoApply()) refreshData(false, true); else $('#newbar').hidden = false; } }).catch(() => {}); });

// ---------- enlaces sin # ----------
// Las plantillas siguen escribiendo href="#jugadores", "#j-123"...: aquí se cambian por la dirección limpia en el
// idioma de la web (para pasar el ratón, copiar el enlace o abrirlo en otra pestaña) y los clics navegan sin recargar.
function fixLinks(root) {
  const fix = (a) => { const h = a.getAttribute('href'); if (!h || h.length < 2 || h.startsWith('#lg-')) return; const u = pathFor(h, LANG); if (u) a.setAttribute('href', u); };
  if (root.matches && root.matches('a[href^="#"]')) fix(root);
  if (root.querySelectorAll) root.querySelectorAll('a[href^="#"]').forEach(fix);
}
fixLinks(document.body);
new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) fixLinks(n); })
  .observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href]'); if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  const href = a.getAttribute('href') || '';
  let k = null;
  if (href.startsWith('#') && href.length > 1 && !href.startsWith('#lg-')) k = href.slice(1);
  else if (href.startsWith('/') && !href.startsWith('//') && !/^\/(data|assets|api)\//.test(href)) k = keyFor(href);
  if (k == null) return;
  e.preventDefault();
  if (('#' + k) === (curHash() || '#')) { window.scrollTo({ top: 0, behavior: REDUCED.matches ? 'auto' : 'smooth' }); return; }
  navTo('#' + k);
});

// ---------- precarga al señalar un enlace (ratón encima o dedo apoyado) ----------
(() => {
  let hov = 0;
  const warm = (a) => {
    if (!S.index || S.index.v !== 3) return;
    const href = a.getAttribute('href') || '';
    const h = href.startsWith('#') ? decodeURIComponent(href.slice(1)) : (keyFor(href) || '');
    try {
      if (h.startsWith('m-')) { const m = parseMatch(h); if (m) loadMatch(m.key, m.id).catch(() => {}); }
      else if (h.startsWith('j-')) Promise.all([loadP(h.slice(2)), loadAttr()]).catch(() => {});
      else if (h.startsWith('cmp-')) { const [x, y] = h.slice(4).split('-'); Promise.all([loadP(x), y ? loadP(y) : null]).catch(() => {}); }
      else if (h.startsWith('d-')) { const d = h.slice(2); loadMeta(d).then((m) => firstChunks(d, m)).catch(() => {}); }
      else if (h === 'jugadores') loadTable(PF.win).catch(() => {});
      else if (h === 'rankings') loadRankings().catch(() => {});
      else if (h === 'records') loadRecords().catch(() => {});
      else if (h === 'eusl') loadEusl().catch(() => {});
    } catch {}
  };
  const target = (e) => e.target.closest && e.target.closest('a[href^="#"], a[href^="/"]:not([href^="//"])');
  document.addEventListener('pointerover', (e) => { const a = target(e); if (!a || e.pointerType === 'touch') return; clearTimeout(hov); hov = setTimeout(() => warm(a), 70); }, { passive: true });
  document.addEventListener('pointerout', () => clearTimeout(hov), { passive: true });
  document.addEventListener('touchstart', (e) => { const a = target(e); if (a) warm(a); }, { passive: true });
  document.addEventListener('pointerdown', (e) => { const a = target(e); if (a) warm(a); }, { passive: true });
  // botones de día: también se precargan
  document.addEventListener('pointerover', (e) => { const b = e.target.closest && e.target.closest('button[data-day]'); const d = b && b.getAttribute('data-day'); if (d && S.index) loadMeta(d).then((m) => firstChunks(d, m)).catch(() => {}); }, { passive: true });
})();

// Si la web se muda (ajuste "home"), las direcciones antiguas (GitHub Pages, workers.dev) y www. llevan a la nueva,
// con el mismo enlace (?ref= incluido) y diciendo de qué página venía la visita (?rf=)
function moved() {
  try {
    const u = new URL(String(S.settings.home || ''));
    const old = OLD_HOST.test(location.hostname) || location.hostname === 'www.' + u.hostname;
    // #admin nunca redirige, para poder corregirlo si algo falla
    if (u.protocol === 'https:' && u.origin !== location.origin && old && location.hash !== '#admin' && location.hash !== '#' + ADMIN_ENTRY) {
      const q = new URLSearchParams(location.search);
      try { const h = document.referrer ? new URL(document.referrer).hostname : ''; if (h && h !== location.hostname && !q.has('rf')) q.set('rf', h); } catch {}
      const qs = q.toString();
      location.replace(u.origin + location.pathname + (qs ? '?' + qs : '') + location.hash); return true;
    }
  } catch {}
  return false;
}

// Sin JavaScript dentro del HTML (lo prohíbe la política de seguridad de la web): logos que no cargan y botón de reintentar
document.addEventListener('error', (e) => {
  const el = e.target; if (!el || el.tagName !== 'IMG' || !el.dataset || !el.dataset.fb) return;
  if (el.dataset.fb === 'rm') el.remove();
  else { el.hidden = true; if (el.nextElementSibling) el.nextElementSibling.hidden = false; }
}, true);
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-reload]')) location.reload(); });

// ---------- arranque ----------
(async function boot() {
  renderChrome(); go({ instant: true });
  try {
    const { idx, set } = await fetchIndex();
    applySettings(set || {}); setIndex(idx);
    if (moved()) return;
  } catch (e) {
    MAIN.innerHTML = `<div class="card empty"><strong>${esc(t('No se pudieron cargar los partidos.'))}</strong><p>${esc(e.status === 404 ? t('El robot aún no ha publicado datos.') : t('Comprueba tu conexión y vuelve a intentarlo.'))}</p><button class="btn" type="button" data-reload>${esc(t('Reintentar'))}</button></div>`;
    return;
  }
  renderChrome(); go({ instant: true }); S.booted = true;
  trackView(route());
})();

// ---------- app instalable ----------
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvt = null;
function hideTip(remember) { $('#itip').innerHTML = ''; if (remember) { try { localStorage.setItem('slapscore-tip', String(Date.now())); } catch {} } }
function showTip() {
  if (standalone() || !matchMedia('(max-width: 900px)').matches) return;
  let last = 0; try { last = Number(localStorage.getItem('slapscore-tip')) || 0; } catch {}
  if (Date.now() - last < 7 * 864e5) return;
  const ios = isIOS() && !installEvt;
  $('#itip').innerHTML = `<div class="itip" role="dialog" aria-label="${esc(t('Instalar SlapScore'))}"><span class="brand-mark sm"><i></i></span><div class="t"><b>${esc(t('Instala SlapScore'))}</b><span>${esc(ios ? t('Pulsa Compartir y después «Añadir a pantalla de inicio».') : t('Tenla en tu pantalla de inicio y ábrela como una app.'))}</span></div>${ios ? '' : `<button class="btn primary sm" type="button" id="tip-ok">${esc(t('Instalar'))}</button>`}<button class="ibtn" type="button" id="tip-x" aria-label="${esc(t('Cerrar'))}">×</button></div>`;
  $('#tip-x').addEventListener('click', () => hideTip(true));
  const ok = $('#tip-ok'); if (ok) ok.addEventListener('click', install);
}
async function install() {
  if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; $('#btn-install').hidden = true; hideTip(true); return; }
  if (isIOS()) { hideTip(false); try { localStorage.removeItem('slapscore-tip'); } catch {} showTip(); }
}
$('#btn-install').addEventListener('click', install);
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btn-install').hidden = false; setTimeout(showTip, 2500); });
addEventListener('appinstalled', () => { trackEvent('install'); installEvt = null; $('#btn-install').hidden = true; hideTip(true); toast(t('SlapScore instalada en tu dispositivo')); });
if (isIOS() && !standalone()) { $('#btn-install').hidden = false; setTimeout(showTip, 3500); }
if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
// avisos: si el permiso se quitó o la suscripción caducó, el botón vuelve a «apagado»; si siguen, se renuevan los favoritos
if (pushOn) addEventListener('load', () => setTimeout(async () => {
  try {
    if (!pushOk() || Notification.permission !== 'granted' || !(await pushSub(false))) { setPushOn(false); return; }
    pushResync();
  } catch {}
}, 3000));
