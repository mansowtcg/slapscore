// SlapScore — aplicación web
import * as C from './core.js';
import { emblem, emblemDefs, setOfficial, hasOfficial, RANK_KEYS } from './emblems.js';
import { t as T, tp as TP, LANG, LOCALE, setDict, setLang } from './i18n.js';
if (LANG === 'en') setDict((await import('./i18n-en.js')).EN);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const ADMIN_KEY = 'slapscore-admin';

// ---------- estado ----------
const S = {
  index: null, ver: '', settings: { seeds: [], hidden: [], weights: {} }, W: C.DEFAULT_WEIGHTS, hidden: new Set(),
  dayMap: new Map(), mem: new Map(), booted: false,
};
function applySettings(s) {
  S.settings = { seeds: [], hidden: [], weights: {}, ...(s || {}) };
  S.W = C.weightsFrom(S.settings.weights);
  // los ocultos se guardan como "día/hora|id" (o solo el id en ajustes antiguos)
  S.hidden = new Set((S.settings.hidden || []).map((h) => String(h).split('|').pop()));
}
function setIndex(idx) {
  S.index = idx; S.ver = idx.updated;
  S.dayMap = new Map((idx.days || []).map((d) => [d.d, d]));
}

// ---------- datos ----------
// Cada archivo se pide con su versión (?v=hash): si no ha cambiado, sale de la caché del navegador al instante.
async function gunzip(buf) {
  if (typeof DecompressionStream === 'function') return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const z = await import('./vendor/gunzip.js'); return z.strFromU8(z.gunzipSync(buf));
}
async function getJSON(url, ver) {
  const fresh = ver === true;
  const u = url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(fresh ? Date.now() : (ver || S.ver));
  const r = await fetch(u, fresh ? { cache: 'no-store' } : {});
  if (!r.ok) { const e = new Error(r.status === 404 ? 'No encontrado' : 'Error ' + r.status); e.status = r.status; throw e; }
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
const notFoundErr = () => Object.assign(new Error('No encontrado'), { status: 404 });
const fileVer = (k) => (S.index && S.index.files && S.index.files[k]) || S.ver;
const inChunk = (c, hh) => c === 'all' || c === hh || (c.includes('-') && hh <= c.slice(0, 2) && hh >= c.slice(3, 5));
function loadMeta(d) { const di = S.dayMap.get(d); return di ? remember('m:' + d + di.u, () => getJSON(`data/days/${d}.json`, di.u)) : Promise.reject(notFoundErr()); }
const loadChunk = (d, c) => remember(`c:${d}/${c.c}:${c.v}`, () => getJSON(`data/days/${d}/${c.c}.json.gz`, c.v));
const loadRaw = (d, hh, v) => remember(`r:${d}/${hh}:${v}`, () => getJSON(`data/full/${d}/${hh}.json.gz`, v));
const loadBucket = (pid) => { const b = C.bucketOf(pid); return remember('p:' + b + ':' + S.ver, () => getJSON(`data/p/${b}.json.gz`, S.ver)); };
async function loadP(pid) {
  const P = (await loadBucket(pid))[pid];
  if (!P) throw notFoundErr();
  if (!P._g) { P._g = P.games.map(C.gameObj); P._a = C.aggObj(P.a); }
  return P;
}
const loadSearch = () => remember('s:' + fileVer('search'), () => getJSON('data/search.json.gz', fileVer('search')));
const loadTable = (w) => remember('t:' + w + fileVer('p' + w), () => getJSON(`data/players-${w}.json.gz`, fileVer('p' + w))
  .then((j) => j.rows.map((r) => ({ id: r[0], n: r[1], rk: r[2], mmr: r[3], a: C.aggObj(r.slice(4)) }))));
const loadRankings = () => remember('rk:' + fileVer('rankings'), () => getJSON('data/rankings.json', fileVer('rankings')));
const loadTop = () => remember('top:' + fileVer('top'), () => getJSON('data/top.json', fileVer('top')));
const loadAttr = () => remember('at:' + fileVer('attr'), () => getJSON('data/attr.json', fileVer('attr')));
const loadRecords = () => remember('rec:' + fileVer('records'), () => getJSON('data/records.json', fileVer('records')));
const loadLeague = () => remember('eu:' + fileVer('eusl'), () => getJSON('data/eusl.json', fileVer('eusl')));
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
  if (!e && !raw) throw notFoundErr();
  return { meta, e, raw };
}

// ---------- formato ----------
const nf = (d) => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d });
const NF0 = new Intl.NumberFormat(LOCALE), NF1 = nf(1), NF2 = nf(2);
const fmtR = (r) => NF1.format(Math.round(r * 10) / 10);
const dec = (x, d = 1) => (d === 2 ? NF2 : NF1).format(x || 0);
const int = (x) => NF0.format(x || 0);
const pct = (x) => Math.round((x || 0) * 100) + (LANG === 'es' ? ' %' : '%');
const rcls = (r) => r >= 9 ? 'elite' : r >= 8 ? 'great' : r >= 7 ? 'good' : r >= 6.5 ? 'ok' : r >= 6 ? 'meh' : 'bad';
const badge = (r, size) => `<span class="rt ${rcls(r)}${size ? ' ' + size : ''}">${fmtR(r)}</span>`;
function hash32(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const hue = (s) => hash32(s) % 360;
function initials(n) { const s = String(n || '?').replace(/[^\p{L}\p{N}]/gu, ''); return esc((s[0] || '?') + (s[1] || '')); }
const avatar = (name, id, size) => `<span class="av${size ? ' ' + size : ''}" style="--h:${hue(id || name)}" aria-hidden="true">${initials(name)}</span>`;
function crest(team, size = 20) {
  const col = team === 'home' || team === 0 ? 'var(--home)' : 'var(--away)';
  const letter = (team === 'home' || team === 0 ? T('Local') : T('Visitante')).charAt(0);
  return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 21 5v6.4c0 5.3-3.7 9.4-9 11-5.3-1.6-9-5.7-9-11V5Z" fill="${col}"/><path d="M12 3.6 19.3 6.2v5.2c0 4.3-2.9 7.7-7.3 9.1Z" fill="#fff" fill-opacity=".14"/><text x="12" y="15.6" text-anchor="middle" font-size="10" font-weight="800" fill="#fff" font-family="Sofia Sans, sans-serif">${letter}</text></svg>`;
}
const rank = (rk, size = 18, o = {}) => rk ? emblem(rk, size, o) : '';
const DF_TIME = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const DF_SHORT = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const DF_FULL = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DF_WD = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' });
const DF_DM = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const today = () => C.madrid(Date.now()).day;
const yesterday = () => C.madrid(Date.now() - 864e5).day;
const dayDate = (d) => new Date(d + 'T12:00:00Z');
function dayShort(d) { if (d === today()) return T('Hoy'); if (d === yesterday()) return T('Ayer'); const w = DF_WD.format(dayDate(d)).replace('.', ''); return w[0].toUpperCase() + w.slice(1); }
const dayLong = (d) => d === today() ? T('Hoy') : d === yesterday() ? T('Ayer') : new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dayDate(d));
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return T('hace un momento');
  if (s < 3600) return T('hace {n} min', { n: Math.round(s / 60) });
  if (s < 86400) return T('hace {n} h', { n: Math.round(s / 3600) });
  const d = Math.round(s / 86400); return d === 1 ? T('ayer') : T('hace {n} días', { n: d });
}
const regionLabel = (r) => String(r || '').split('-').map((x) => x.length <= 3 ? x.toUpperCase() : x[0].toUpperCase() + x.slice(1)).join(' ');
const regionShort = (r) => String(r || '?').split('-')[0].toUpperCase();
const typeLabel = (y) => C.TYPE_LABEL[y] ? T(C.TYPE_LABEL[y]) : (y ? y[0].toUpperCase() + y.slice(1) : T('Partida'));
const endLabel = (e, ot) => ot && (!e || e === 'EndOfRegulation') ? T('Final en prórroga') : (C.END_LABEL[e] ? T(C.END_LABEL[e]) : (e ? e.replace(/([a-z])([A-Z])/g, '$1 $2') : T('Final')));
const matchHref = (key, id) => `#m-${key.replace(/[-/]/g, '')}-${id}`;
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
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.36l-5.7 3 1.09-6.35-4.62-4.5 6.38-.93Z"/></svg>',
  league: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z"/><path d="M9 11.5h6M12 8.5v6"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8"/></svg>',
  vs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h6M7 6v12M14 18h6M17 6v12"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  coffee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1 .8 1.2.8 2.2M12 3.5c0 1 .8 1.2.8 2.2"/><path d="M5 21h10"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
};

// ---------- interfaz base ----------
document.body.insertAdjacentHTML('afterbegin', emblemDefs());
const APP = $('#app');
APP.innerHTML = `
<header class="hdr">
  <div class="wrap hdr-top">
    <a class="brand" href="#partidos" aria-label="${T('SlapScore, inicio')}"><span class="brand-mark"><i></i></span><span class="t">${T('SlapScore')}</span></a>
    <div class="search" role="search">${ICON.search}<input id="q" type="search" placeholder="${T('Buscar jugador')}" autocomplete="off" aria-label="${T('Buscar jugador')}" aria-controls="sres"><div class="sres" id="sres" role="listbox" hidden></div></div>
    <div class="hdr-actions">
      <button class="ibtn" id="btn-install" type="button" aria-label="${T('Instalar SlapScore')}" title="${T('Instalar la app')}" hidden>${ICON.install}</button>
      <button class="ibtn" id="btn-refresh" type="button" aria-label="${T('Actualizar datos')}" title="${T('Actualizar datos')}">${ICON.refresh}</button>
      <button class="ibtn lang" id="btn-lang" type="button" lang="${LANG === 'es' ? 'en' : 'es'}" title="${LANG === 'es' ? 'English' : 'Español'}" aria-label="${LANG === 'es' ? 'Switch to English' : 'Cambiar a español'}">${LANG === 'es' ? 'EN' : 'ES'}</button>
      <button class="ibtn" id="btn-theme" type="button" aria-label="${T('Cambiar tema claro u oscuro')}" title="${T('Tema claro / oscuro')}">${ICON.theme}</button>
      <a class="ibtn" id="btn-admin" href="#admin" aria-label="${T('Panel de administrador')}" title="${T('Administrador')}" hidden>${ICON.admin}</a>
    </div>
  </div>
  <nav class="wrap nav" aria-label="${T('Secciones')}">
    <a href="#partidos" data-nav="partidos">${T('Partidos')}</a><a href="#jugadores" data-nav="jugadores">${T('Jugadores')}</a><a href="#rankings" data-nav="rankings">${T('Rankings')}</a><a href="#liga" data-nav="liga">${T('Liga EUSL')}</a><a href="#notas" data-nav="notas">${T('Cómo puntuamos')}</a>
  </nav>
</header>
<div class="pbar" id="pbar" aria-hidden="true"></div>
<div class="wrap newbar" id="newbar" hidden><button type="button" id="btn-new">${T('Hay partidos nuevos · Actualizar')}</button></div>
<main class="wrap" id="main" tabindex="-1"></main>
<footer class="wrap foot" id="foot"></footer>
<nav class="bnav" aria-label="${T('Secciones')}"><a href="#partidos" data-nav="partidos">${ICON.games}${T('Partidos')}</a><a href="#jugadores" data-nav="jugadores">${ICON.users}${T('Jugadores')}</a><a href="#rankings" data-nav="rankings">${ICON.trophy}${T('Rankings')}</a><a href="#liga" data-nav="liga">${ICON.league}${T('Liga')}</a><a href="#notas" data-nav="notas">${ICON.info}${T('Info')}</a></nav>
<div id="itip"></div>
<div class="toasts" id="toasts" aria-live="polite"></div>
<div id="sheet-root"></div>`;
const MAIN = $('#main');
document.documentElement.lang = LANG;
$('#btn-lang').addEventListener('click', () => setLang(LANG === 'es' ? 'en' : 'es'));

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
  $('#foot').innerHTML = `<span>${T('Datos públicos de')} <a href="https://slapshot.gg" target="_blank" rel="noopener">slapshot.gg</a>${i ? ` · ${T('actualizado')} ${esc(ago(Date.parse(i.updated)))}` : ''} · ${T('SlapScore no está afiliado a Oddshot Games.')}</span><span class="foot-r">${sup ? `<a href="${esc(sup)}" target="_blank" rel="noopener">${T('Apoya el proyecto')}</a>` : ''}<a href="#admin">${T('Administrador')}</a></span>`;
}
// Si una transición se interrumpe (cambias de página muy rápido), el navegador la cancela: no es un error
function quiet(t) { if (t) for (const k of ['ready', 'finished', 'updateCallbackDone']) if (t[k]) t[k].catch(() => {}); return t; }
// tema
function applyTheme(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
try { applyTheme(localStorage.getItem('slapscore-theme')); } catch {}
const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
function themeIcon() { const b = $('#btn-theme'); const d = isDark(); b.innerHTML = d ? ICON.sun : ICON.theme; b.setAttribute('aria-label', d ? T('Cambiar a tema claro') : T('Cambiar a tema oscuro')); }
themeIcon(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeIcon);
$('#btn-theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  const doIt = () => { applyTheme(next); themeIcon(); try { localStorage.setItem('slapscore-theme', next); } catch {} };
  if (document.startViewTransition && !REDUCED.matches) quiet(document.startViewTransition(doIt)); else doIt();
});

// ---------- hoja (modal) ----------
let sheetPrevFocus = null;
function openSheet(html) {
  sheetPrevFocus = document.activeElement;
  $('#sheet-root').innerHTML = `<div class="ovl" id="ovl"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${html}</div></div>`;
  const ovl = $('#ovl');
  ovl.addEventListener('click', (e) => { if (e.target === ovl || e.target.closest('[data-close]')) closeSheet(); });
  const f = $('[data-close]', ovl); if (f) f.focus({ preventScroll: true });
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
  const sel = () => { try { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast(T('Texto seleccionado: cópialo con Ctrl+C')); } catch {} };
  try { navigator.clipboard.writeText(txt).then(() => toast(T('Copiado')), sel); } catch { sel(); }
}

// ---------- buscador ----------
let SIDX = null, SIDXV = '';
async function searchIdx() {
  const v = fileVer('search');
  if (!SIDX || SIDXV !== v) { const rows = await loadSearch(); SIDX = rows.map((r) => [fold(r[1]), r]); SIDXV = v; }
  return SIDX;
}
// primero los que empiezan por el texto (la lista ya viene ordenada por partidos jugados);
// también vale pegar el enlace de slapshot.gg o el número de jugador
function findPlayers(I, text, n = 8) {
  const q = fold(text.trim()); if (!q) return [];
  const starts = [], has = [];
  for (const [f, r] of I) { if (f.startsWith(q)) { starts.push(r); if (starts.length >= n) break; } else if (has.length < n && f.includes(q)) has.push(r); }
  let list = starts.concat(has).slice(0, n);
  const idm = /slapshot\.gg\/(?:[a-z]{2}\/)?players\/(\d+)/i.exec(text) || /^\s*(\d{4,10})\s*$/.exec(text);
  if (idm) { const known = I.find(([, r]) => r[0] === idm[1]); list = [known ? known[1] : [idm[1], T('Jugador {id}', { id: idm[1] }), '', null, -1]].concat(list.filter((r) => r[0] !== idm[1])).slice(0, n); }
  return list;
}
function playerOpt(r, href, on, together) {
  const rk = r[2] ? C.parseRank(r[2]) : null;
  const sub = r[4] < 0 ? T('Abrir su perfil por ID') : (rk ? esc(rk.name) + (r[3] != null ? ' · ' + int(r[3]) + ' MMR' : '') + ' · ' : '') + (together ? TP(together, '{n} partido en común', '{n} partidos en común') : TP(r[4], '{n} partido', '{n} partidos', { n: int(r[4]) }));
  return `<a role="option" href="${href}" class="${on ? 'on' : ''}">${avatar(r[1], r[0])}<span class="nm"><span translate="no">${esc(r[1])}</span>${isFav(r[0]) ? `<span class="fv-i">${ICON.star}</span>` : ''}<small>${sub}</small></span>${rank(r[2], 22)}</a>`;
}
(() => {
  const inp = $('#q'), box = $('#sres'); let sel = -1, list = [];
  async function draw() {
    const q = fold(inp.value.trim());
    if (!q) { box.hidden = true; return; }
    let I; try { I = await searchIdx(); } catch { box.innerHTML = '<div class="none">' + T('No se pudo cargar la lista de jugadores.') + '</div>'; box.hidden = false; return; }
    if (fold(inp.value.trim()) !== q) return;
    list = findPlayers(I, inp.value);
    box.innerHTML = list.length ? list.map((r, i) => playerOpt(r, '#j-' + esc(r[0]), i === sel)).join('')
      : '<div class="none">' + T('Ningún jugador con ese nombre todavía.') + '</div>';
    box.hidden = false;
  }
  const close = () => { box.hidden = true; inp.value = ''; sel = -1; inp.blur(); };
  inp.addEventListener('focus', () => { searchIdx().catch(() => {}); });
  let ti; inp.addEventListener('input', () => { sel = -1; clearTimeout(ti); ti = setTimeout(draw, 60); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { clearTimeout(ti); const s0 = sel; draw().then(() => { const it = list[s0 < 0 ? 0 : s0]; if (it) { location.hash = 'j-' + it[0]; close(); } }); }
    else if (e.key === 'Escape') close();
  });
  box.addEventListener('click', () => setTimeout(close, 0));
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.hidden = true; });
})();

// ---------- router ----------
let TOK = 0;
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('m-')) return { view: 'match', ...(parseMatch(h) || {}) };
  if (h.startsWith('j-')) return { view: 'player', pid: h.slice(2) };
  if (h.startsWith('vs-')) { const [a, b] = h.slice(3).split('-'); return { view: 'vs', a, b }; }
  if (h.startsWith('d-')) return { view: 'matches', day: h.slice(2) };
  return { view: ['jugadores', 'rankings', 'records', 'liga', 'notas', 'admin'].includes(h) ? h : 'matches' };
}
function setNav(view) {
  const map = { matches: 'partidos', match: 'partidos', player: 'jugadores', vs: 'jugadores', jugadores: 'jugadores', rankings: 'rankings', records: 'rankings', liga: 'liga', notas: 'notas' };
  $$('[data-nav]').forEach((a) => a.getAttribute('data-nav') === map[view] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
}
let lastPath = null, lastHash = location.hash || '#', lastView = '';
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
  if (r.view === 'player') return Promise.all([loadP(r.pid), loadAttr()]);
  if (r.view === 'jugadores') return loadTable(PF.win);
  if (r.view === 'rankings') return loadRankings();
  if (r.view === 'records') return loadRecords();
  if (r.view === 'liga') return loadLeague();
  if (r.view === 'vs') return Promise.all([loadP(r.a), loadP(r.b), loadAttr()]);
  if (r.view === 'matches') { const d = pickDay(r.day); return d ? Promise.all([loadMeta(d).then((m) => firstChunks(d, m)), loadTop()]) : null; }
  return null;
}
async function go(opts = {}) {
  const tok = ++TOK;
  const r = route(); setNav(r.view);
  const path = r.view + (r.day || r.id || r.pid || '');
  const scroll = !opts.keepScroll && path !== lastPath; lastPath = path;
  const y = opts.restore ? SCROLL.get(location.hash || '#') : null;
  // Con la página anterior aún visible esperamos un momento a los datos: la nueva aparece ya completa, sin esqueletos
  const pre = S.booted ? prefetch(r) : null;
  if (pre) {
    let done = false; const pp = pre.then(() => { done = true; }, () => { done = true; });
    await Promise.race([pp, sleep(16)]);
    if (!done && !opts.instant) { progress(true); await Promise.race([pp, sleep(650)]); progress(false); }
    if (!live(tok)) return;
  }
  closeSheet(true); closeCal(); MAIN.onclick = null; S.onResize = null;
  const sameView = r.view === 'matches' && lastView === 'matches'; lastView = r.view;
  const run = () => { const p = render(r, tok); if (y != null) restoreScroll(y, tok); else if (scroll) window.scrollTo(0, 0); return p; };
  const vt = S.booted && !opts.instant && document.startViewTransition && !REDUCED.matches;
  // Si la página entra con la transición, sus tarjetas no se animan otra vez; si llega más tarde (red lenta), sí
  MAIN.dataset.static = vt && pre ? '1' : '0';
  if (vt) {
    // entre días, la tira de días no se difumina: solo cambia la lista
    const root = document.documentElement; if (sameView) root.classList.add('vt-same');
    try { const t = quiet(document.startViewTransition(() => Promise.race([Promise.resolve(run()).catch(() => {}), sleep(90)]))); t.finished.finally(() => root.classList.remove('vt-same')).catch(() => {}); }
    catch { root.classList.remove('vt-same'); run(); }
  } else run();
}
function restoreScroll(y, tok) {
  let n = 0;
  const tryIt = () => { if (!live(tok)) return; window.scrollTo(0, y); if (Math.abs(window.scrollY - y) > 4 && n++ < 15) setTimeout(tryIt, 70); };
  requestAnimationFrame(tryIt);
}
window.addEventListener('hashchange', () => {
  SCROLL.set(lastHash, window.scrollY);
  const h = location.hash || '#';
  const back = STACK.length > 1 && STACK[STACK.length - 2] === h;
  if (back) STACK.pop(); else { STACK.push(h); if (STACK.length > 60) STACK.shift(); }
  lastHash = h;
  go({ restore: back });
});
function render(r, tok) {
  if (!S.index) { MAIN.innerHTML = skeletonList(6); return; }
  if (S.index.v !== 3) { MAIN.innerHTML = '<div class="card empty in"><strong>' + T('Actualizando los datos…') + '</strong>' + T('Vuelve a cargar la página en un par de minutos.') + '</div>'; return; }
  if (r.view === 'match') return r.id ? viewMatch(r, tok) : notFound(T('Este enlace de partido no es válido.'));
  if (r.view === 'vs') return viewVs(r, tok);
  if (r.view === 'records') return viewRecords(tok);
  if (r.view === 'liga') return viewLeague(tok);
  if (r.view === 'player') return viewPlayer(r.pid, tok);
  if (r.view === 'jugadores') return viewPlayers(tok);
  if (r.view === 'rankings') return viewRankings(tok);
  if (r.view === 'notas') return viewMethod();
  if (r.view === 'admin') return viewAdmin(tok);
  return viewMatches(r.day, tok);
}
const live = (tok) => tok === TOK;
function notFound(msg, extra = '') { MAIN.innerHTML = `<div class="card empty in"><strong>${esc(msg)}</strong>${extra}<p><a href="#partidos">${T('Volver a los partidos')}</a></p></div>`; }
function errorBox(e, retry = true) {
  MAIN.innerHTML = `<div class="card empty in"><strong>${T('No se pudieron cargar los datos.')}</strong><p>${esc(e && e.message || '')}</p>${retry ? '<button class="btn" type="button" data-retry>' + T('Reintentar') + '</button>' : ''}</div>`;
  const b = $('[data-retry]', MAIN); if (b) b.addEventListener('click', () => go({ instant: true }));
}
const skRow = () => `<div class="sk-row"><div class="sk" style="width:42px;height:28px"></div><div style="flex:1;display:flex;flex-direction:column;gap:6px"><div class="sk" style="height:12px;width:70%"></div><div class="sk" style="height:12px;width:55%"></div></div><div class="sk" style="width:34px;height:22px"></div></div>`;
const skeletonList = (n) => `<div class="card">${'<div class="card-h"><div class="sk" style="height:16px;width:160px"></div></div>'}${Array.from({ length: n }, skRow).join('')}</div>`;

// =====================================================================
// PARTIDOS
// =====================================================================
// ---------- selector de día: tira de días seguidos (de más antiguo a hoy) + calendario ----------
const dayAdd = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const DF_WD1 = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' });
const DF_MON = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const wdShort = (d) => DF_WD1.format(dayDate(d)).replace('.', '').toUpperCase();
const countShort = (n) => n >= 10000 ? Math.round(n / 1000) + T(' mil') : n >= 1000 ? NF1.format(Math.round(n / 100) / 10) + T(' mil') : String(n);
const dayN = (d) => { const x = S.dayMap.get(d); return x ? x.n : 0; };
// días con partidos, de más antiguo a más nuevo
const daysAsc = () => (S.index.days || []).map((x) => x.d).sort();
function prevDay(d) { const a = daysAsc(); let r = null; for (const x of a) { if (x < d) r = x; else break; } return r; }
function nextDay(d) { for (const x of daysAsc()) if (x > d) return x; return null; }
function dayBar(day) {
  const t = today();
  const end = day > t ? day : (dayAdd(day, 10) < t ? dayAdd(day, 10) : t);
  const cells = [];
  for (let d = dayAdd(end, -29); d <= end; d = dayAdd(d, 1)) {
    const n = dayN(d), lbl = d === t ? T('HOY') : d === yesterday() ? T('AYER') : wdShort(d);
    cells.push(`<button type="button" class="day${n ? '' : ' empty'}${d === t ? ' today' : ''}" data-day="${d}" ${n ? '' : 'disabled'} aria-pressed="${d === day}" aria-label="${esc(dayLong(d))}, ${n ? TP(n, '{n} partido', '{n} partidos', { n: int(n) }) : T('sin partidos')}"><small>${lbl}</small><b>${esc(DF_DM.format(dayDate(d)).replace('.', ''))}</b><i>${n ? countShort(n) : '–'}</i></button>`);
  }
  const p = prevDay(day), nx = nextDay(day);
  return `<div class="days" id="daybar">
    <button class="ibtn" type="button" data-day="${p || ''}" ${p ? '' : 'disabled'} aria-label="${T('Día anterior con partidos')}" title="${T('Día anterior')}">${ICON.left}</button>
    <div class="days-list" id="days" role="group" aria-label="${T('Días')}">${cells.join('')}</div>
    <button class="ibtn" type="button" data-day="${nx || ''}" ${nx ? '' : 'disabled'} aria-label="${T('Día siguiente con partidos')}" title="${T('Día siguiente')}">${ICON.right}</button>
    <button class="cal-btn" type="button" id="cal-btn" aria-haspopup="dialog" aria-expanded="false" title="${T('Elegir fecha')}">${ICON.cal}<span>${esc(day === t ? T('Hoy') : DF_DM.format(dayDate(day)).replace('.', ''))}</span></button>
  </div>`;
}
let dayKey = false;   // el último cambio de día se hizo con el teclado: mantener el foco en la tira
function goDay(d) { if (!d) return; MF.limit = 120; closeCal(); location.hash = 'd-' + d; }
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
  document.body.insertAdjacentHTML('beforeend', `<div class="cal" id="cal" role="dialog" aria-label="${T('Elegir fecha')}"></div>`);
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
function drawCal(day) {
  const el = $('#cal'); if (!el) return;
  const [y, m] = calMonth.split('-').map(Number);
  const startWd = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;   // lunes = 0
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const t = today(), all = daysAsc();
  const months = [...new Set(all.map((d) => d.slice(0, 7)))];
  const pm = months.filter((x) => x < calMonth).pop() || '', nm = months.find((x) => x > calMonth) || '';
  const max = Math.max(1, ...all.filter((d) => d.startsWith(calMonth)).map(dayN));
  let cells = '';
  for (let i = 0; i < startWd; i++) cells += '<span></span>';
  for (let i = 1; i <= len; i++) {
    const d = `${calMonth}-${String(i).padStart(2, '0')}`, n = dayN(d);
    const lvl = n ? Math.max(1, Math.ceil(Math.sqrt(n / max) * 4)) : 0;
    cells += `<button type="button" class="cd${d === t ? ' today' : ''}${lvl ? ' l' + lvl : ''}" data-cd="${d}" ${n ? '' : 'disabled'} aria-pressed="${d === day}" aria-label="${esc(dayLong(d))}, ${n ? TP(n, '{n} partido', '{n} partidos', { n: int(n) }) : T('sin partidos')}"><b>${i}</b>${n ? `<i>${countShort(n)}</i>` : ''}</button>`;
  }
  const title = DF_MON.format(new Date(Date.UTC(y, m - 1, 15)));
  const last = all[all.length - 1];
  el.innerHTML = `<div class="cal-h"><button class="ibtn" type="button" data-cm="${pm}" ${pm ? '' : 'disabled'} aria-label="${T('Mes anterior con partidos')}">${ICON.left}</button><b>${esc(title[0].toUpperCase() + title.slice(1))}</b><button class="ibtn" type="button" data-cm="${nm}" ${nm ? '' : 'disabled'} aria-label="${T('Mes siguiente con partidos')}">${ICON.right}</button></div>
    <div class="cal-w">${(LANG === 'es' ? ['L', 'M', 'X', 'J', 'V', 'S', 'D'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']).map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal-g">${cells}</div>
    <div class="cal-f"><span class="muted">${T('Más color, más partidos')}</span>${last ? `<button class="btn sm" type="button" data-cd="${last}">${last === t ? T('Hoy') : T('Último día')}</button>` : ''}</div>`;
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

const MF = { type: '', region: '', arena: '', q: '', fav: false, limit: 120, closed: new Set() };
// ---------- favoritos (se guardan en este navegador) ----------
const FAV_KEY = 'slapscore-favs';
let FAVS = (() => { try { const a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } })();
const isFav = (id) => FAVS.includes(String(id));
function toggleFav(id) {
  id = String(id); FAVS = isFav(id) ? FAVS.filter((x) => x !== id) : [id, ...FAVS].slice(0, 30);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(FAVS)); } catch {}
  return isFav(id);
}
const favBtn = (id, label) => `<button type="button" class="${label ? 'btn sm fav' : 'fav'}" data-fav="${esc(id)}" aria-pressed="${isFav(id)}" title="${isFav(id) ? T('Quitar de mis jugadores') : T('Añadir a mis jugadores')}">${ICON.star}${label ? `<span>${T('Mis jugadores')}</span>` : ''}</button>`;
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fav]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const on = toggleFav(b.getAttribute('data-fav'));
  $$(`[data-fav="${CSS.escape(b.getAttribute('data-fav'))}"]`).forEach((x) => { x.setAttribute('aria-pressed', String(on)); x.title = on ? T('Quitar de mis jugadores') : T('Añadir a mis jugadores'); });
  toast(on ? T('Añadido a Mis jugadores: lo verás arriba en la portada') : T('Quitado de Mis jugadores'));
});
// Primeros trozos (horas) del día hasta tener unos 120 partidos
function firstChunks(d, meta, need = 120) {
  const out = []; let n = 0;
  for (const c of meta.chunks || []) { if (n >= need) break; out.push(loadChunk(d, c)); n += c.n; }
  return Promise.all(out);
}
async function viewMatches(dayArg, tok) {
  const days = (S.index.days || []);
  if (!days.length) { MAIN.innerHTML = `<div class="card empty"><strong>${T('Todavía no hay partidos.')}</strong>${T('El robot rastrea slapshot.gg sin parar y publica cada pocos minutos.')}</div>`; return; }
  const day = pickDay(dayArg);
  const idx = days.findIndex((d) => d.d === day);
  MAIN.innerHTML = `<div class="layout">
    <aside class="col col-left" id="m-left">${skeletonList(4)}</aside>
    <section class="col" aria-label="${T('Partidos')}">
      <div class="card">
        ${dayBar(day)}
        <div class="filters" id="m-filters"></div>
      </div>
      <div id="m-lead" class="only-mobile"></div>
      <div id="m-list" class="col">${skeletonList(8)}</div>
    </section>
    <aside class="col" id="m-right">${skeletonList(5)}</aside>
  </div>`;
  wireDayBar(day);
  let meta, top;
  try { [meta, top] = await Promise.all([loadMeta(day), loadTop().catch(() => null)]); }
  catch (e) { if (live(tok)) errorBox(e); return; }
  if (!live(tok)) return;
  const st = { day, meta, lists: [], next: 0, tok };
  drawFilters(st); drawLeft(st);
  const ml = $('#m-lead'); if (ml) ml.innerHTML = `<div id="favs-m"></div>${leadersCard(meta, day)}`;
  drawRight(st, top);
  drawFavs(tok);
  await refreshList(st);
  // días de al lado, ya preparados para cuando cambies
  idle(() => { for (const d of [days[idx + 1], days[idx - 1]]) if (d) loadMeta(d.d).then((m) => firstChunks(d.d, m)).catch(() => {}); });
}
// recuentos del día: exactos aunque todavía no se hayan cargado todos los partidos
function countBy(st, f, filt) {
  const c = new Map();
  for (const t of st.meta.counts || []) { if (filt && !filt(t)) continue; c.set(t[f], (c.get(t[f]) || 0) + t[3]); }
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
}
const byType = (t) => !MF.type || t[0] === MF.type;
const loadedRows = (st) => { const out = []; for (const l of st.lists) for (const m of l) if (!S.hidden.has(m.i)) out.push(m); return out; };
async function moreChunks(st, need) {
  const chunks = st.meta.chunks || [];
  const all = !!MF.q.trim() || MF.fav;
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
  try { await moreChunks(st, MF.limit); } catch { if (live(st.tok) && seq === listSeq) toast(T('No se pudieron cargar más partidos. Comprueba tu conexión.')); }
  if (el) el.classList.remove('busy');
  if (!live(st.tok) || seq !== listSeq) return;
  drawList(st);
}
function drawFilters(st) {
  const el = $('#m-filters'); if (!el) return;
  const types = countBy(st, 0);
  el.innerHTML = `<div class="chips" role="group" aria-label="${T('Tipo de partida')}">${FAVS.length ? `<button type="button" class="chip fvc" id="m-fav" aria-pressed="${MF.fav}">${ICON.star}${T('Mis jugadores')}</button>` : ''}<button type="button" class="chip" data-t="" aria-pressed="${!MF.type}">${T('Todos')} <span class="n">${int(st.meta.n)}</span></button>${types.map(([y, n]) => `<button type="button" class="chip" data-t="${esc(y)}" aria-pressed="${MF.type === y}">${esc(typeLabel(y))} <span class="n">${int(n)}</span></button>`).join('')}</div>
    <input class="input" id="m-q" type="search" placeholder="${T('Filtrar por jugador')}" value="${esc(MF.q)}" autocomplete="off" aria-label="${T('Filtrar partidos por jugador')}">
    <select class="select only-narrow" id="m-region" aria-label="${T('Región')}"></select>
    <select class="select only-narrow" id="m-arena" aria-label="${T('Arena')}"></select>`;
  drawSelects(st);
  const fb = $('#m-fav'); if (fb) fb.addEventListener('click', () => { MF.fav = !MF.fav; MF.limit = 120; fb.setAttribute('aria-pressed', String(MF.fav)); refreshList(st); });
  $$('[data-t]', el).forEach((b) => b.addEventListener('click', () => { MF.type = b.getAttribute('data-t'); MF.limit = 120; $$('[data-t]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawLeft(st); drawSelects(st); refreshList(st); }));
  let tq; $('#m-q').addEventListener('input', (e) => { clearTimeout(tq); tq = setTimeout(() => { MF.q = e.target.value; MF.limit = 120; refreshList(st); }, 160); });
  $('#m-region').addEventListener('change', (e) => { MF.region = e.target.value; MF.limit = 120; drawLeft(st); refreshList(st); });
  $('#m-arena').addEventListener('change', (e) => { MF.arena = e.target.value; MF.limit = 120; drawLeft(st); refreshList(st); });
}
function drawSelects(st) {
  const r = $('#m-region'), a = $('#m-arena'); if (!r || !a) return;
  r.innerHTML = `<option value="">${T('Región')}</option>${countBy(st, 1, byType).map(([v, n]) => `<option value="${esc(v)}" ${MF.region === v ? 'selected' : ''}>${esc(regionLabel(v))} (${int(n)})</option>`).join('')}`;
  a.innerHTML = `<option value="">${T('Arena')}</option>${countBy(st, 2, byType).map(([v, n]) => `<option value="${esc(v)}" ${MF.arena === v ? 'selected' : ''}>${esc(v || T('Sin arena'))} (${int(n)})</option>`).join('')}`;
}
function filtered(list) {
  const q = fold(MF.q.trim());
  const fv = MF.fav ? new Set(FAVS) : null;
  return list.filter((m) => (!MF.type || m.y === MF.type) && (!MF.region || m.r === MF.region) && (!MF.arena || m.a === MF.arena) && (!q || m.p.some((p) => fold(p[1]).includes(q))) && (!fv || m.p.some((p) => fv.has(p[0]))));
}
function drawLeft(st) {
  const el = $('#m-left'); if (!el) return;
  const block = (title, f, key, fmt) => {
    const c = countBy(st, f, byType);
    if (!c.length) return '';
    return `<div class="card"><div class="card-h"><h3>${title}</h3></div><div class="flist" style="padding-bottom:8px">
      <button type="button" data-f="${key}" data-v="" aria-pressed="${!MF[key]}">${T('Todas')} <span class="n">${int(c.reduce((a, x) => a + x[1], 0))}</span></button>
      ${c.map(([v, n]) => `<button type="button" data-f="${key}" data-v="${esc(v)}" aria-pressed="${MF[key] === v}">${fmt(v)} <span class="n">${int(n)}</span></button>`).join('')}</div></div>`;
  };
  el.innerHTML = block(T('Regiones'), 1, 'region', (v) => `<span class="region">${esc(regionShort(v))}</span>${esc(regionLabel(v))}`) + block(T('Arenas'), 2, 'arena', (v) => esc(v || T('Sin arena')));
  $$('[data-f]', el).forEach((b) => b.addEventListener('click', () => { MF[b.getAttribute('data-f')] = b.getAttribute('data-v'); MF.limit = 120; drawLeft(st); drawSelects(st); refreshList(st); }));
}
function drawList(st) {
  const el = $('#m-list'); if (!el) return;
  el.dataset.ready = '1';
  const rows = filtered(loadedRows(st));
  if (!rows.length) { el.innerHTML = `<div class="card empty in"><strong>${T('Ningún partido con estos filtros.')}</strong>${T('Prueba a quitar algún filtro o cambia de día.')}</div>`; return; }
  const q = fold(MF.q.trim());
  // total de cada grupo (tipo + región): del resumen del día, o de lo cargado si se filtra por nombre
  const tot = new Map();
  if (q || MF.fav) for (const m of rows) tot.set(m.y + '|' + m.r, (tot.get(m.y + '|' + m.r) || 0) + 1);
  else for (const t of st.meta.counts || []) if (byType(t) && (!MF.region || t[1] === MF.region) && (!MF.arena || t[2] === MF.arena)) tot.set(t[0] + '|' + t[1], (tot.get(t[0] + '|' + t[1]) || 0) + t[3]);
  const groups = new Map();
  for (const m of rows) { const k = m.y + '|' + m.r; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  let budget = MF.limit, html = '', shown = 0;
  for (const [k, ms] of [...groups.entries()].sort((a, b) => (tot.get(b[0]) || b[1].length) - (tot.get(a[0]) || a[1].length))) {
    if (budget <= 0) break;
    const [y, r] = k.split('|'); const part = ms.slice(0, budget); budget -= part.length; shown += part.length;
    const open = !MF.closed.has(k);
    html += `<div class="card grp in" data-open="${open}" data-k="${esc(k)}"><button class="grp-h" type="button" aria-expanded="${open}"><span class="region">${esc(regionShort(r))}</span>${esc(typeLabel(y))}<span class="sub">${esc(regionLabel(r))}</span><span class="n">${int(Math.max(tot.get(k) || 0, ms.length))}</span>${ICON.down}</button>
      <div class="grp-b"><div>${part.map((m) => evRow(m, q)).join('')}</div></div></div>`;
  }
  const total = Math.max(rows.length, [...tot.values()].reduce((a, b) => a + b, 0));
  if (total > shown) html += `<div class="card more"><button class="btn" type="button" id="m-more">${T('Ver más partidos ({n})', { n: int(total - shown) })}</button></div>`;
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
function evRow(m, q) {
  const side = (tm) => {
    const ps = m.p.filter((p) => p[2] === tm);
    const names = ps.map((p) => q && fold(p[1]).includes(q) ? `<span class="hl">${esc(p[1])}</span>` : isFav(p[0]) ? `<span class="fv">${esc(p[1])}</span>` : esc(p[1])).join(', ');
    return `<div class="ev-team${m.w === tm ? ' won' : ''}">${crest(tm, 18)}<span class="names" translate="no">${names}</span></div>`;
  };
  const mvp = m.p[m.v];
  const status = m.o ? '<span class="ot">' + T('Prór.') + '</span>' : T(m.e === 'Tie' ? 'Empate' : m.e === 'Forfeit' ? 'Rend.' : /Left$/.test(m.e) ? 'Aband.' : 'Final');
  return `<div class="evw" data-i="${esc(m.i)}"><a class="ev" href="${matchHref(m.k, m.i)}"><div class="ev-time"><b>${DF_TIME.format(new Date(m.t))}</b><span>${status}</span></div>
    <div class="ev-teams">${side(0)}${side(1)}</div>
    <div class="ev-score"><span class="${m.w === 0 ? 'won' : ''}">${m.s[0]}</span><span class="${m.w === 1 ? 'won' : ''}">${m.s[1]}</span></div>
    <div class="ev-mvp" title="${mvp ? 'MVP: ' + esc(mvp[1]) : ''}" translate="no">${mvp ? badge(mvp[3]) : ''}</div></a>
    <button class="ev-x" type="button" aria-expanded="false" aria-label="${T('Ver las estadísticas de los jugadores')}">${ICON.down}</button>
    <div class="ev-box"><div><div class="ev-box-in"></div></div></div></div>`;
}
// Estadísticas de todos los jugadores de un partido, desde el resumen del día
const MINI = [['Nota', 3], ['G', 4, 'Goles'], ['A', 5, 'Asistencias'], ['TIR', 8, 'Tiros'], ['PAR', 9, 'Paradas'], ['PAS', 10, 'Pases'], ['ROB', 12, 'Robos'], ['BLQ', 13, 'Bloqueos'], ['PTS', 11, 'Puntos de juego']].map(([a, b, c]) => [T(a), b, c ? T(c) : '']);
function evBox(m) {
  const best = MINI.map(([, i]) => i === 3 ? null : Math.max(0, ...m.p.map((p) => typeof p[i] === 'number' ? p[i] : 0)));
  const row = (p) => `<tr><td><a class="pc" href="#j-${esc(p[0])}">${rank(p[6], 16, { approx: p[7] })}<span class="nm" translate="no">${esc(p[1])}</span></a></td>${MINI.map(([, i], k) => i === 3 ? `<td>${badge(p[3])}</td>`
    : `<td class="${typeof p[i] === 'number' && p[i] > 0 && p[i] === best[k] ? 'best' : ''}">${typeof p[i] === 'number' ? int(p[i]) : '–'}</td>`).join('')}</tr>`;
  return `<div class="tscroll"><table class="tbl evt"><thead><tr><th>${T('Jugador')}</th>${MINI.map(([l, , tt]) => `<th${tt ? ` title="${tt}"` : ''}>${l}</th>`).join('')}</tr></thead><tbody>
    ${[0, 1].map((tm) => `<tr class="tg"><td colspan="${MINI.length + 1}"><span class="pc">${crest(tm, 16)}${tm === 0 ? T('Local') : T('Visitante')} · ${m.s[tm]}</span></td></tr>` + m.p.filter((p) => p[2] === tm).sort((a, b) => b[3] - a[3]).map(row).join('')).join('')}
  </tbody></table></div><div class="ev-box-f"><a href="${matchHref(m.k, m.i)}">${T('Ver el partido completo')}</a></div>`;
}
function leadersCard(meta, day, cls = '') {
  const L = (meta && meta.lead) || []; if (!L.length) return '';
  return `<div class="card in ${cls}"><div class="card-h"><h3>${T('Líderes del día')}</h3><small>${esc(dayLong(day))}</small></div><div class="tscroll"><table class="tbl lead"><thead><tr><th>${T('Jugador')}</th><th title="${T('Partidos jugados')}">${T('PJ')}</th><th title="${T('Goles')}">${T('G')}</th><th title="${T('Asistencias')}">${T('A')}</th><th title="${T('Goles más asistencias')}">${T('G+A')}</th><th>${T('Nota')}</th></tr></thead><tbody>
    ${L.map((x, i) => `<tr class="${i >= 5 ? 'xtra' : ''}"><td><a class="pc" href="#j-${esc(x.id)}"><span class="i">${i + 1}</span>${rank(x.rk, 16)}<span class="nm">${esc(x.n)}</span></a></td><td>${x.gp}</td><td>${x.g}</td><td>${x.a}</td><td><b>${x.g + x.a}</b></td><td>${badge(x.rs / x.gp)}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}
// Mis jugadores: último partido de cada favorito (se cargan sus perfiles)
async function drawFavs(tok) {
  const ids = FAVS.slice(0, 8); if (!ids.length) return;
  const Ps = await Promise.all(ids.map((id) => loadP(id).catch(() => null)));
  if (!live(tok)) return;
  const rows = ids.map((id, i) => [id, Ps[i]]).filter(([, P]) => P).sort((a, b) => (b[1]._g[0] ? b[1]._g[0].t : 0) - (a[1]._g[0] ? a[1]._g[0].t : 0));
  if (!rows.length) return;
  const html = `<div class="card in favs"><div class="card-h"><h3>${ICON.star}${T('Mis jugadores')}</h3><small>${T('último partido')}</small></div><div style="padding-bottom:8px">${rows.map(([id, P]) => {
    const g = P._g[0], now = g && Date.now() - g.t < 20 * 60_000;
    return `<a class="lrow" href="#j-${esc(id)}"><span class="i">${now ? '<span class="dot pulse" title="' + T('Jugando ahora') + '"></span>' : ''}</span>${avatar(P.n, id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t" translate="no">${esc(P.n)}</span>${rank(P.meta && P.meta.rk, 16)}</span><span class="sub">${g ? `<span class="res ${g.r}">${resLetter(g.r)}</span> ${g.gf}-${g.ga} · ${esc(ago(g.t))}` : T('Sin partidos')}</span></span>${g ? badge(g.rt) : ''}</a>`;
  }).join('')}</div></div>`;
  for (const sel of ['#favs-d', '#favs-m']) { const el = $(sel); if (el) el.innerHTML = html; }
}
const resLetter = (r) => r === 'W' ? T('V') : r === 'L' ? T('D') : T('E');
function supportCard(cls = '') {
  const url = supportUrl(); if (!url) return '';
  return `<div class="card in support ${cls}"><div class="card-b"><b>${T('SlapScore es gratis y sin anuncios')}</b><p>${T('Lo hace un jugador de la comunidad. Si te resulta útil, puedes ayudar a mantenerlo.')}</p><a class="btn kofi" href="${esc(url)}" target="_blank" rel="noopener">${ICON.coffee}${T('Invítame a un café')}</a></div></div>`;
}
function drawRight(st, top) {
  const el = $('#m-right'); if (!el) return;
  const { meta, day } = st;
  let html = `<div id="favs-d" class="hide-mobile"></div>` + leadersCard(meta, day, 'hide-mobile');
  const best = meta.best && !S.hidden.has(meta.best.i) ? meta.best : null;
  if (best && best.p[best.v]) {
    const mv = best.p[best.v];
    html += `<div class="card in"><div class="card-h"><h3>${T('Partido destacado')}</h3><small>${esc(typeLabel(best.y))} · ${esc(regionLabel(best.r))}</small></div>
      <a class="mini" href="${matchHref(best.k, best.i)}"><div class="side">${crest(0, 34)}${T('Local')}</div><div class="sc">${best.s[0]}<i>-</i>${best.s[1]}</div><div class="side">${crest(1, 34)}${T('Visitante')}</div></a>
      <a class="lrow" href="${matchHref(best.k, best.i)}" style="border-top:1px solid var(--line)"><span class="i"></span>${avatar(mv[1], mv[0], 'sm')}<span class="nm"><span>${esc(mv[1])}</span>${rank(mv[6], 16, { approx: mv[7] })}</span><span>${badge(mv[3])}</span></a></div>`;
  }
  const perf = (meta.perf || []).filter((p) => !S.hidden.has(p.i)).slice(0, 6);
  if (perf.length) html += `<div class="card in"><div class="card-h"><h3>${T('Mejores actuaciones')}</h3><small>${esc(dayLong(day))}</small></div><div style="padding-bottom:8px">${perf.map((p, i) =>
    `<a class="lrow" href="${matchHref(p.k, p.i)}"><span class="i">${i + 1}</span>${avatar(p.n, p.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span style="display:flex;align-items:center;gap:6px;max-width:100%"><span style="overflow:hidden;text-overflow:ellipsis">${esc(p.n)}</span>${rank(p.rk, 16, { approx: p.ap })}</span><span class="sub">${p.g} ${T('G')} · ${p.as} ${T('A')} · ${p.s[0]}-${p.s[1]}</span></span>${badge(p.rt)}</a>`).join('')}</div></div>`;
  html += supportCard();
  if (top && top.mmr && top.mmr.length) html += `<div class="card in"><div class="card-h"><h3>${T('Top MMR')}</h3><a href="#rankings">${T('Ver rankings')}</a></div><div style="padding-bottom:8px">${top.mmr.slice(0, 5).map((p, i) =>
    `<a class="lrow" href="#j-${esc(p.id)}"><span class="i">${i + 1}</span>${rank(p.rk, 26)}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span>${esc(p.n)}</span><span class="sub">${esc(p.rank || '')}</span></span><span class="v">${int(p.mmr)}</span></a>`).join('')}</div></div>`;
  if (top && top.active && top.active.length) html += `<div class="card in"><div class="card-h"><h3>${T('Más activos')}</h3><small>${T('7 días')}</small></div><div style="padding-bottom:8px">${top.active.slice(0, 5).map((p, i) =>
    `<a class="lrow" href="#j-${esc(p.id)}"><span class="i">${i + 1}</span>${avatar(p.n, p.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t">${esc(p.n)}</span>${rank(p.rk, 16)}</span><span class="sub">${TP(p.gp, '{n} partido', '{n} partidos', { n: int(p.gp) })}</span></span>${badge(p.avg)}</a>`).join('')}</div></div>`;
  el.innerHTML = html || '<div class="card empty">' + T('Sin destacados todavía.') + '</div>';
}

// =====================================================================
// PARTIDO
// =====================================================================
let MTAB = 'resumen';
async function viewMatch(r, tok) {
  MAIN.innerHTML = `<div class="card evh"><div class="sk" style="height:14px;width:220px;margin-bottom:18px"></div><div style="display:flex;justify-content:space-around;align-items:center"><div class="sk" style="width:60px;height:60px;border-radius:50%"></div><div class="sk" style="width:140px;height:48px"></div><div class="sk" style="width:60px;height:60px;border-radius:50%"></div></div></div><div style="height:16px"></div>${skeletonList(6)}`;
  let res;
  try { res = await loadMatch(r.key, r.id); }
  catch (e) { if (!live(tok)) return; if (e.status === 404) return notFound(T('No encuentro este partido.'), '<p>' + T('Puede que todavía no se haya guardado o que el enlace sea antiguo.') + '</p>'); return errorBox(e); }
  if (!live(tok)) return;
  const { meta, e: se, raw } = res;
  let m;
  if (raw) {
    m = C.normalize(raw, S.W); m.raw = raw;
    const rk = new Map(); if (se) for (const p of se.p) rk.set(p[0], { rk: p[6], approx: !!p[7] });
    m.players.forEach((p) => { const x = rk.get(p.pid); p.rk = x ? x.rk : ''; p.rkApprox = x ? x.approx : false; });
  } else m = fromSummary(se);
  m.key = r.key; m.archived = !raw; m.dayArchived = !!meta.x;
  if (m.archived && MTAB === 'json') MTAB = 'resumen';
  S.curMatch = m;
  const teamAvg = (tm) => { const ps = m.players.filter((p) => p.team === tm); return ps.length ? ps.reduce((a, p) => a + p.rating, 0) / ps.length : 0; };
  const lose = (tm) => m.winner && m.winner !== tm ? 'lose' : '';
  const hidden = S.hidden.has(m.id);
  MAIN.innerHTML = `
    <nav class="crumbs in" aria-label="${T('Ruta')}"><a href="#d-${m.key.slice(0, 10)}">${T('Partidos')}</a>${ICON.right}<span>${esc(typeLabel(m.type))} · ${esc(regionLabel(m.region))}</span>${ICON.right}<span>${esc(m.arena)}</span></nav>
    <section class="card evh in" aria-label="${T('Marcador')}">
      <div class="evh-top"><span>${esc(DF_FULL.format(new Date(m.t)))} · ${DF_TIME.format(new Date(m.t))}</span><a href="https://slapshot.gg/matches/${encodeURIComponent(m.id)}" target="_blank" rel="noopener">slapshot.gg ${ICON.ext}</a></div>
      <div class="evh-main">
        <div class="evh-team">${crest('home', 56)}<b>${T('Local')}</b><span class="avg">${T('Nota media')} ${badge(teamAvg('home'))}</span></div>
        <div class="evh-score"><div class="sc" aria-label="${T('Local')} ${m.score.home}, ${T('Visitante')} ${m.score.away}"><span class="${lose('home')}">${m.score.home}</span><i>-</i><span class="${lose('away')}">${m.score.away}</span></div>
          <span class="pill ${m.ot ? 'ot' : ''}">${esc(endLabel(m.endReason, m.ot))}</span></div>
        <div class="evh-team">${crest('away', 56)}<b>${T('Visitante')}</b><span class="avg">${T('Nota media')} ${badge(teamAvg('away'))}</span></div>
      </div>
    </section>
    <div style="height:16px"></div>
    <div class="layout two">
      <div class="col">
        <div class="card"><div class="tabs" role="tablist" id="mtabs">${[['resumen', 'Resumen'], ['alineaciones', 'Alineaciones'], ['estadisticas', 'Estadísticas'], ...(m.archived ? [] : [['json', 'JSON']])].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${MTAB === k}">${T(l)}</button>`).join('')}<span class="ind"></span></div>
        <div class="panel" id="mpanel" role="tabpanel"></div></div>
      </div>
      <aside class="col sticky">${m.archived ? archiveCard(m) : ''}${mvpCard(m)}${infoCard(m)}${isAdmin() && !m.dayArchived ? `<div class="adminbar"><b>${T('Admin')}</b><span class="muted" style="flex:1">${hidden ? T('Este partido está oculto.') : T('Oculta partidos con datos erróneos.')}</span><button class="btn sm ${hidden ? '' : 'danger'}" type="button" id="m-hide">${hidden ? T('Mostrar partido') : T('Ocultar partido')}</button></div>` : ''}</aside>
    </div>`;
  const tabs = $('#mtabs');
  const moveInd = () => { const b = $('[aria-selected="true"]', tabs), ind = $('.ind', tabs); if (b && ind) { ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`; } };
  $$('[data-tab]', tabs).forEach((b) => b.addEventListener('click', () => {
    if (MTAB === b.getAttribute('data-tab')) return;
    MTAB = b.getAttribute('data-tab'); $$('[data-tab]', tabs).forEach((x) => x.setAttribute('aria-selected', String(x === b))); moveInd();
    drawPanel(m);
    const p = $('#mpanel'); if (p && !REDUCED.matches) { p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap'); }
  }));
  S.onResize = moveInd; requestAnimationFrame(moveInd); if (document.fonts) document.fonts.ready.then(() => { if (S.onResize === moveInd) moveInd(); });
  drawPanel(m);
  MAIN.onclick = (e) => { const b = e.target.closest('[data-perf]'); if (b && S.curMatch) { const p = S.curMatch.players[Number(b.getAttribute('data-perf'))]; if (p) openPerf(S.curMatch, p); } };
  const hb = $('#m-hide');
  if (hb) hb.addEventListener('click', async () => {
    hb.disabled = true;
    try { const A = await import('./admin.js'); await A.toggleHidden(m.id, !hidden, ctx(), m.key); } catch (e) { toast(e.message || T('No se pudo guardar.')); hb.disabled = false; }
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
  return { id: e.i, t: e.t, type: e.y, region: e.r, arena: e.a, endReason: e.e, ot: !!e.o, length: null, periods: null, score: { home: e.s[0], away: e.s[1] },
    winner: e.w === 0 ? 'home' : e.w === 1 ? 'away' : null, players, mvp: e.v, size: { home, away: players.length - home }, tot, format: e.f };
}
function archiveUrl(day) {
  const a = S.index.archive || {};
  return a.repo ? `https://github.com/${a.repo}/releases/download/${a.tag || 'archivo-'}${day.slice(0, 7)}/${a.file || 'partidos-'}${day}.json.gz` : '';
}
function archiveCard(m) {
  const day = m.key.slice(0, 10), url = m.dayArchived ? archiveUrl(day) : '';
  return `<div class="card in note"><div class="card-b"><b>${T('Partido archivado')}</b><p>${T('Guardamos el detalle completo de los partidos de los últimos {n} días. De este se conservan la nota y las estadísticas principales de cada jugador.', { n: int(S.index.retain || 60) })}</p>${url ? `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">${T('Descargar el archivo del día')} ${ICON.ext}</a>` : ''}</div></div>`;
}
function mvpCard(m) {
  const p = m.players[m.mvp]; if (!p) return '';
  return `<div class="card in"><div class="card-h"><h3>${T('Jugador del partido')}</h3>${rank(p.rk, 22, { approx: p.rkApprox })}</div>
    <button type="button" class="prow" data-perf="${m.mvp}" style="border-top:0;padding-top:4px;padding-bottom:16px">${avatar(p.name, p.pid, 'md')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span style="font-size:17px" translate="no">${esc(p.name)}</span><span class="ln">${statLine(p.st, 4)}</span></span>${badge(p.rating, 'lg')}</button></div>`;
}
function infoCard(m) {
  const rows = [['Arena', m.arena], ['Región', regionLabel(m.region)], ['Tipo', typeLabel(m.type)], ['Formato', m.format],
    ['Duración', m.length ? C.fmtPoss(m.length) : ''], ['Resultado', endLabel(m.endReason, m.ot)], ['Periodos', m.periods == null ? '' : m.periods ? T('Sí') : T('No')]].filter((x) => x[1]);
  return `<div class="card in"><div class="card-h"><h3>${T('Datos del partido')}</h3></div><dl class="info">${rows.map(([k, v]) => `<dt>${T(k)}</dt><dd>${esc(v)}</dd>`).join('')}<dt>${T('ID')}</dt><dd><button class="btn sm" type="button" data-copy="${esc(m.id)}" title="${esc(m.id)}">${T('Copiar ID')}</button></dd></dl></div>`;
}
function statLine(st, max = 3) {
  const b = [];
  if (st.goals) b.push(TP(st.goals, '{n} gol', '{n} goles'));
  if (st.assists) b.push(TP(st.assists, '{n} asistencia', '{n} asistencias'));
  if (st.saves) b.push(TP(st.saves, '{n} parada', '{n} paradas'));
  if (st.passes) b.push(TP(st.passes, '{n} pase', '{n} pases'));
  if (st.takeaways) b.push(TP(st.takeaways, '{n} robo', '{n} robos'));
  return esc((b.length ? b : [T('Sin acciones destacadas')]).slice(0, max).join(' · '));
}
const CMP_GROUPS = [
  ['Ataque', ['goals', 'shots', 'post_hits', 'overtime_goals']],
  ['Juego', ['passes', 'assists', 'possession_time_sec', 'faceoffs_won']],
  ['Defensa', ['saves', 'blocks', 'takeaways', 'turnovers']],
];
function cmpRow(m, k) {
  const a = m.tot.home[k] || 0, b = m.tot.away[k] || 0, sum = a + b;
  const inv = k === 'turnovers';
  const la = inv ? a < b : a > b, lb = inv ? b < a : b > a;
  const f = (v) => k === 'possession_time_sec' ? (sum ? pct(v / sum) : '–') : int(v);
  return `<div class="cmp-row"><div class="cmp-top"><span class="v ${la ? 'lead h' : ''}">${f(a)}</span><em>${esc(k === 'possession_time_sec' ? T('Posesión') : T(C.LABELS[k][0]))}</em><span class="v ${lb ? 'lead a' : ''}">${f(b)}</span></div>
    <div class="cmp-bars"><div><i class="${la ? 'lead' : ''}" style="width:${sum ? Math.round(a / sum * 100) : 0}%"></i></div><div><i class="${lb ? 'lead' : ''}" style="width:${sum ? Math.round(b / sum * 100) : 0}%"></i></div></div></div>`;
}
function drawPanel(m) {
  const el = $('#mpanel'); if (!el) return;
  if (MTAB === 'json') {
    const raw = JSON.stringify(m.raw, null, 2);
    el.innerHTML = `<div class="lu-head"><b>${T('JSON original de slapshot.gg')}</b><button class="btn sm" type="button" id="cp">${T('Copiar')}</button></div><pre class="json" id="jsonpre">${esc(raw)}</pre>`;
    $('#cp').addEventListener('click', () => copyText(raw, $('#jsonpre')));
    return;
  }
  if (MTAB === 'estadisticas') {
    el.innerHTML = CMP_GROUPS.map(([g, ks]) => `<div class="sgrp-h">${T(g)}</div>${ks.filter((k) => m.tot.home[k] != null || m.tot.away[k] != null).map((k) => cmpRow(m, k)).join('')}`).join('')
      + `<div class="sgrp-h" style="margin-top:22px">${T('Todos los jugadores')}</div><div class="tscroll" style="margin:0 -16px">${statsTable(m)}</div>`;
    return;
  }
  if (MTAB === 'alineaciones') {
    el.innerHTML = `<div class="lu-head"><span class="lu-team">${crest('home', 20)}${T('Local')} ${badge(avg(m, 'home'))}</span><span class="lu-team">${badge(avg(m, 'away'))} ${T('Visitante')} ${crest('away', 20)}</span></div>${rink(m)}
      <p class="muted" style="font-size:12.5px;margin:10px 0 0">${T('Las posiciones son orientativas: slapshot.gg no indica dónde juega cada uno, así que colocamos más atrás a quien más paradas hizo.')}</p>
      <div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0 16px;margin:12px -16px -16px">${['home', 'away'].map((tm) => lineupList(m, tm)).join('')}</div>`;
    return;
  }
  el.innerHTML = `<div class="sgrp-h">${T('Estadísticas de los jugadores')}</div>${boxScore(m)}
    <div class="sgrp-h">${T('Comparativa de equipos')}</div>${['shots', 'saves', 'passes', 'possession_time_sec', 'takeaways', 'turnovers', 'faceoffs_won'].map((k) => cmpRow(m, k)).join('')}`;
}
const BOX = [['rating', 'Nota', 'Nota'], ['goals', 'G', 'Goles'], ['primary_assists', 'A1', 'Asistencias primarias'], ['secondary_assists', 'A2', 'Asistencias secundarias'],
  ['score', 'PTS', 'Puntos de juego'], ['shots', 'TIR', 'Tiros'], ['saves', 'PAR', 'Paradas'], ['blocks', 'BLQ', 'Bloqueos'], ['passes', 'PAS', 'Pases'],
  ['post_hits', 'PST', 'Postes'], ['takeaways', 'ROB', 'Robos'], ['turnovers', 'PÉR', 'Pérdidas'], ['possession_time_sec', 'POS', 'Posesión'],
  ['faceoffs_won', 'FO+', 'Faceoffs ganados'], ['faceoffs_lost', 'FO−', 'Faceoffs perdidos']].map(([k, s, l]) => [k, T(s), T(l)]);
// En partidos archivados no hay asistencias primarias/secundarias: se muestra A
const BOX_ARCH = (() => { const b = BOX.filter(([k]) => k !== 'primary_assists' && k !== 'secondary_assists'); b.splice(2, 0, ['assists', T('A'), T('Asistencias')]); return b; })();
function boxScore(m) {
  const cols = m.archived ? BOX_ARCH : BOX;
  const best = {};
  for (const [k] of cols) if (!['rating', 'turnovers', 'faceoffs_lost'].includes(k)) best[k] = Math.max(0, ...m.players.map((p) => p.st[k] || 0));
  const cell = (k, v) => k === 'possession_time_sec' ? C.fmtPoss(v || 0) : int(v || 0);
  const team = (tm) => {
    const ps = m.players.map((p, i) => [p, i]).filter(([p]) => p.team === tm).sort((a, b) => b[0].rating - a[0].rating);
    return `<div class="bx-team"><div class="bx-h">${crest(tm, 22)}<b>${tm === 'home' ? T('Local') : T('Visitante')}</b><span class="sc">${m.score[tm]}</span>${m.winner === tm ? '<span class="pill live">' + T('Ganador') + '</span>' : ''}<span class="avg">${T('Nota media')} ${badge(avg(m, tm))}</span></div>
      <div class="tscroll"><table class="tbl bx"><thead><tr><th>${T('Jugador')}</th>${cols.map(([, s, l]) => `<th title="${l}">${s}</th>`).join('')}</tr></thead><tbody>
      ${ps.map(([p, i]) => `<tr><td><button type="button" class="linkish" data-perf="${i}">${avatar(p.name, p.pid, 'sm')}<span class="nm" translate="no">${esc(p.name)}</span>${rank(p.rk, 16, { approx: p.rkApprox })}${i === m.mvp ? '<span class="mvp-tag">' + T('MVP') + '</span>' : ''}</button></td>${cols.map(([k]) => k === 'rating' ? `<td>${badge(p.rating)}</td>`
        : `<td class="${best[k] && (p.st[k] || 0) === best[k] ? 'best' : ''}">${cell(k, p.st[k])}</td>`).join('')}</tr>`).join('')}
      <tr class="tot"><td>${T('Total')}</td>${cols.map(([k]) => k === 'rating' ? '<td></td>' : `<td>${cell(k, m.tot[tm][k])}</td>`).join('')}</tr></tbody></table></div></div>`;
  };
  return team('home') + team('away') + `<p class="legend">${cols.slice(1).map(([, s, l]) => `<b>${s}</b> ${l}`).join(' · ')}. ${T('En azul, el mejor del partido en cada columna.')}</p>`;
}
const avg = (m, tm) => { const ps = m.players.filter((p) => p.team === tm); return ps.length ? ps.reduce((a, p) => a + p.rating, 0) / ps.length : 0; };
function lineupList(m, tm) {
  const ps = m.players.map((p, i) => [p, i]).filter(([p]) => p.team === tm).sort((a, b) => b[0].rating - a[0].rating);
  return `<div><div class="lu-team" style="padding:10px 16px">${crest(tm, 18)}${tm === 'home' ? T('Local') : T('Visitante')}${m.winner === tm ? ' <span class="pill live" style="height:20px">' + T('Ganador') + '</span>' : ''}</div>
    ${ps.map(([p, i]) => `<button type="button" class="prow" data-perf="${i}">${avatar(p.name, p.pid)}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span style="display:flex;align-items:center;gap:6px;max-width:100%"><span style="overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>${rank(p.rk, 18, { approx: p.rkApprox })}${i === m.mvp ? '<span class="mvp-tag">' + T('MVP') + '</span>' : ''}</span><span class="ln">${statLine(p.st)}</span></span>${badge(p.rating, 'md')}</button>`).join('')}</div>`;
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
    `<button type="button" class="rink-p ${p.team}" data-perf="${i}" style="left:${x}%;top:${y}%">${avatar(p.name, p.pid)}${badge(p.rating)}<span class="nm">${rank(p.rk, 14, { approx: p.rkApprox })}${esc(p.name)}</span></button>`).join('');
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
  const lab = (k) => C.LABELS[k] ? C.LABELS[k].map((x) => T(x)) : [k.replace(/_/g, ' '), k.slice(0, 4).toUpperCase()];
  const val = (k, v) => v == null ? '–' : k === 'possession_time_sec' ? C.fmtPoss(v) : int(v);
  let body = '';
  for (const tm of ['home', 'away']) {
    const ps = m.players.map((p, i) => [p, i]).filter(([p]) => p.team === tm).sort((a, b) => b[0].rating - a[0].rating);
    body += `<tr class="tg"><td colspan="${keys.length + 2}">${tm === 'home' ? T('Local') : T('Visitante')} · ${m.score[tm]}</td></tr>`;
    body += ps.map(([p]) => `<tr><td><a class="pc" href="#j-${esc(p.pid)}">${rank(p.rk, 16, { approx: p.rkApprox })}${esc(p.name)}</a></td><td>${badge(p.rating)}</td>${keys.map((k) => `<td>${val(k, p.st[k])}</td>`).join('')}</tr>`).join('');
    body += `<tr class="tot"><td>${T('Total')}</td><td></td>${keys.map((k) => `<td>${val(k, m.tot[tm][k])}</td>`).join('')}</tr>`;
  }
  return `<table class="tbl"><thead><tr><th>${T('Jugador')}</th><th>${T('Nota')}</th>${keys.map((k) => `<th title="${esc(lab(k)[0])}">${esc(lab(k)[1])}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    <p class="muted" style="font-size:12px;padding:10px 16px 0">${keys.map((k) => `<b>${esc(lab(k)[1])}</b> ${esc(lab(k)[0])}`).join(' · ')}</p>`;
}
function openPerf(m, p) {
  const keys = C.STAT_ORDER.filter((k) => p.st[k]);
  const maxAbs = Math.max(0.3, ...p.parts.map((x) => Math.abs(x.c)));
  const res = T(p.res === 'W' ? 'Victoria' : p.res === 'L' ? 'Derrota' : 'Empate');
  openSheet(`<div class="sheet-h">${avatar(p.name, p.pid, 'md')}<div style="min-width:0"><div class="nm" id="sheet-title"><span translate="no">${esc(p.name)}</span>${rank(p.rk, 22, { approx: p.rkApprox })}</div>
      <small>${crest(p.team, 16)}${p.team === 'home' ? T('Local') : T('Visitante')} · <span class="res ${p.res}">${resLetter(p.res)}</span> ${res} ${m.score.home}-${m.score.away}${m.players[m.mvp] === p ? ' · <span class="mvp-tag">' + T('MVP') + '</span>' : ''}</small></div>${badge(p.rating, 'xl')}</div>
    <div class="sgrid">${(keys.length ? keys : ['goals']).map((k) => `<div><b>${k === 'possession_time_sec' ? C.fmtPoss(p.st[k]) : int(p.st[k])}</b><span>${esc(C.LABELS[k] ? T(C.LABELS[k][0]) : k)}</span></div>`).join('')}</div>
    ${m.archived ? `<div class="bd"><p class="muted" style="margin:0">${T('El desglose de la nota no está disponible en los partidos archivados.')}</p></div>` : `<div class="bd"><h3>${T('Cómo sale la nota')}</h3><div class="bd-row"><span>${T('Nota de partida')}</span><span></span><b>${fmtR(S.W.base)}</b></div>
      ${p.parts.map((x) => `<div class="bd-row"><span>${esc(T(x.label))}${x.n !== '' && x.n != null ? ` <span class="muted">(${esc(x.n)})</span>` : ''}</span><span class="bar"><i class="${x.c >= 0 ? 'pos' : 'neg'}" style="width:${Math.round(Math.abs(x.c) / maxAbs * 50)}%"></i></span><b class="${x.c >= 0 ? 'pos' : 'neg'}">${x.c >= 0 ? '+' : '−'}${dec(Math.abs(x.c), 2)}</b></div>`).join('')}
      <div class="bd-row tot"><span>${T('Nota final')}</span><span></span><b>${fmtR(p.rating)}</b></div></div>`}
    <div class="sheet-f"><button class="btn" type="button" data-close>${T('Cerrar')}</button><a class="btn primary" href="#j-${esc(p.pid)}">${T('Ver perfil')}</a></div>`);
}

// =====================================================================
// JUGADOR
// =====================================================================
const PV = { hist: 'all', histN: 15, statMode: 'pg' };
// racha actual (+ victorias seguidas / − derrotas seguidas) y mejor racha de victorias
function streaks(games) {
  let cs = 0; const r0 = games[0] && games[0].r;
  if (r0 === 'W' || r0 === 'L') for (const g of games) { if (g.r === r0) cs++; else break; }
  let bs = 0, run = 0; for (const g of games) { if (g.r === 'W') { run++; if (run > bs) bs = run; } else run = 0; }
  return { cs: r0 === 'L' ? -cs : cs, bs };
}
const streakTxt = (cs) => cs ? `${Math.abs(cs)}${cs > 0 ? T('V') : T('D')}` : '–';
// semanas (de lunes a domingo, hora local) con su nota media
const weekStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
function weekly(games) {
  const wk = new Map();
  for (const g of games) { const k = weekStart(g.t), x = wk.get(k) || { t: k, n: 0, rs: 0, w: 0 }; x.n++; x.rs += g.rt; if (g.r === 'W') x.w++; wk.set(k, x); }
  return [...wk.values()].sort((a, b) => a.t - b.t).slice(-12);
}
function weekChart(W) {
  const Wd = 600, H = 190, L = 30, R = 14, TOP = 22, B = 24;
  const av = W.map((w) => w.rs / w.n);
  const lo = Math.max(3, Math.floor(Math.min(...av) - 0.4)), hi = Math.min(10, Math.max(Math.ceil(Math.max(...av) + 0.4), lo + 2));
  const n = W.length, slot = (Wd - L - R) / n, bw = Math.min(26, slot * 0.5);
  const x = (i) => L + slot * i + slot / 2, y = (v) => TOP + (H - TOP - B) * (1 - (v - lo) / (hi - lo));
  const maxN = Math.max(...W.map((w) => w.n)), bh = (H - TOP - B) * 0.4;
  let g = '';
  for (let v = lo; v <= hi; v++) g += `<line class="gl" x1="${L}" x2="${Wd - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 7}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  const bars = W.map((w, i) => { const h = Math.max(2, w.n / maxN * bh); return `<rect class="wbar" x="${(x(i) - bw / 2).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>`; }).join('');
  const line = W.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(av[i]).toFixed(1)}`).join(' ');
  const dots = W.map((w, i) => `<circle class="wdot f-${rcls(av[i])}" cx="${x(i).toFixed(1)}" cy="${y(av[i]).toFixed(1)}" r="5.5"><title>${esc(T('Semana del {d}', { d: DF_SHORT.format(new Date(w.t)) }))} · ${fmtR(av[i])} · ${TP(w.n, '{n} partido', '{n} partidos')} · ${pct(w.w / w.n)} ${T('victorias')}</title></circle>`).join('');
  const every = n > 8 ? 2 : 1;
  const labels = W.map((w, i) => (n - 1 - i) % every ? '' : `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(DF_SHORT.format(new Date(w.t)).replace('.', ''))}</text>`).join('');
  const last = n - 1;
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${T('Nota media por semana')}">${g}${bars}<path class="line" d="${line}"/>${dots}${labels}<text x="${x(last).toFixed(1)}" y="${(y(av[last]) - 10).toFixed(1)}" text-anchor="middle" style="fill:var(--fg);font-weight:800">${fmtR(av[last])}</text></svg>`;
}
function weekSummary(W) {
  const a = W[W.length - 1], b = W[W.length - 2];
  const va = a.rs / a.n, d = b ? va - b.rs / b.n : 0;
  const cur = a.t === weekStart(Date.now());
  return `<div class="wsum"><div><span>${cur ? T('Esta semana') : T('Última semana')}</span><b>${fmtR(va)}</b></div><div><span>${T('Frente a la anterior')}</span><b class="${d > 0.05 ? 'up' : d < -0.05 ? 'down' : ''}">${d > 0.05 ? '▲ ' : d < -0.05 ? '▼ ' : ''}${d > 0 ? '+' : d < 0 ? '−' : ''}${dec(Math.abs(d), 2)}</b></div><div><span>${T('Partidos')}</span><b>${int(a.n)}</b></div><div><span>${T('Victorias')}</span><b>${pct(a.w / a.n)}</b></div></div>`;
}
async function viewPlayer(pid, tok) {
  MAIN.innerHTML = `<div class="card"><div class="ph"><div class="sk" style="width:76px;height:76px;border-radius:50%"></div><div><div class="sk" style="height:26px;width:220px"></div><div class="sk" style="height:12px;width:260px;margin-top:10px"></div></div></div></div><div style="height:16px"></div>${skeletonList(5)}`;
  let P, AT;
  try { [P, AT] = await Promise.all([loadP(pid), loadAttr().catch(() => null)]); }
  catch (e) { if (!live(tok)) return; if (e.status === 404) return notFound(T('Este jugador no tiene partidos guardados todavía.'), `<p><a href="https://slapshot.gg/players/${encodeURIComponent(pid)}" target="_blank" rel="noopener">${T('Ver su perfil en slapshot.gg')}</a></p>`); return errorBox(e); }
  if (!live(tok)) return;
  PV.hist = 'all'; PV.histN = 15;
  const games = P._g.filter((g) => !S.hidden.has(g.i));
  const meta = P.meta || {}, a = P._a;
  // atributos: percentil frente al resto de jugadores con 5 partidos o más
  const attr = attrOf(a, AT);
  const avgR = a.gp ? a.rs / a.gp : 0;
  const { cs, bs } = streaks(games);
  const W = weekly(games);
  const season = meta.season ? T('Temporada {n}', { n: String(meta.season).replace(/^season[\s_-]*/i, '') }) : '';
  const curRank = meta.rk ? `<div class="rank-c">${rank(meta.rk, 56)}<div><div class="k">${T('Rango actual')}</div><div class="nm">${esc(meta.rank || C.parseRank(meta.rk)?.name || '')}</div><div class="pts"><b>${int(meta.mmr)}</b> MMR${season ? ' · ' + esc(season) : ''}${meta.rmp != null ? ' · ' + TP(meta.rmp, '{n} partida', '{n} partidas', { n: int(meta.rmp) }) : ''}</div></div></div>`
    : `<div class="rank-c"><svg width="56" height="56" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2.5 35.5 11.5v17L20 37.5 4.5 28.5v-17Z" fill="none" stroke="var(--line-2)" stroke-width="1.6" stroke-dasharray="3 3"/></svg><div><div class="k">${T('Rango actual')}</div><div class="nm">${meta.unr ? T('Sin clasificar') : T('Sin consultar')}</div><div class="pts">${meta.unr ? T('No ha jugado clasificatorias esta temporada') : T('El robot aún no ha mirado su rango')}</div></div></div>`;
  const peakRank = meta.prk ? `<div class="rank-c">${rank(meta.prk, 56)}<div><div class="k">${T('Mejor rango')}</div><div class="nm">${esc(meta.prank || C.parseRank(meta.prk)?.name || '')}</div><div class="pts">${meta.peak != null ? `<b>${int(meta.peak)}</b> ${T('MMR máximo')}` : ''}</div></div></div>`
    : `<div class="rank-c"><div style="width:56px"></div><div><div class="k">${T('Mejor rango')}</div><div class="nm">—</div><div class="pts">${T('Sin datos todavía')}</div></div></div>`;
  const last10 = games.slice(0, 10).reverse();
  MAIN.innerHTML = `
    <nav class="crumbs in"><a href="#jugadores">${T('Jugadores')}</a>${ICON.right}<span translate="no">${esc(P.n)}</span></nav>
    <section class="card in">
      <div class="ph">${avatar(P.n, P.id, 'lg')}<div style="min-width:0"><h1><span translate="no">${esc(P.n)}</span> ${rank(meta.rk, 30)}</h1>
        <div class="meta"><span>${T('ID')} ${esc(P.id)}</span>${games[0] ? `<span>${T('Último partido {t}', { t: esc(ago(games[0].t)) })}</span>` : ''}<a href="https://slapshot.gg/players/${encodeURIComponent(P.id)}" target="_blank" rel="noopener">slapshot.gg ${ICON.ext}</a></div>
        <div class="ph-act">${favBtn(P.id, true)}<button class="btn sm" type="button" id="p-cmp">${ICON.vs}${T('Comparar')}</button></div></div>
        <div class="avg">${badge(avgR, 'xl')}${T('Nota media')}</div></div>
      <div class="ranks">${curRank}${peakRank}</div>
      <div class="strip s8"><div><b>${int(a.gp)}</b><span>${T('Partidos')}</span></div><div><b>${a.w}-${a.l}${a.d ? '-' + a.d : ''}</b><span>${T('V')}-${T('D')}${a.d ? '-' + T('E') : ''}</span></div><div><b>${pct(a.gp ? a.w / a.gp : 0)}</b><span>${T('Victorias')}</span></div><div title="${T('Victorias o derrotas seguidas en sus últimos partidos')}"><b class="stk ${cs > 0 ? 'up' : cs < 0 ? 'down' : ''}">${streakTxt(cs)}</b><span>${T('Racha actual')}</span></div><div title="${T('Más victorias seguidas entre sus {n} últimos partidos', { n: int(games.length) })}"><b>${bs ? bs + T('V') : '–'}</b><span>${T('Mejor racha')}</span></div><div><b>${int(a.mvp)}</b><span>${T('MVP')}</span></div><div><b>${int(a.g)}</b><span>${T('Goles')}</span></div><div><b>${int(a.as)}</b><span>${T('Asistencias')}</span></div></div>
    </section>
    <div style="height:16px"></div>
    <div class="layout half">
      <div class="col">
        <div class="card in"><div class="card-h"><h3>${T('Forma')}</h3><small>${TP(last10.length, 'último partido', 'últimos {n} partidos')}</small></div><div class="form">${last10.map((g) => `<a href="${matchHref(g.k, g.i)}" title="${esc(DF_SHORT.format(new Date(g.t)) + ' · ' + g.gf + '-' + g.ga)}">${badge(g.rt)}<span class="res ${g.r}">${resLetter(g.r)}</span></a>`).join('')}</div></div>
        ${W.length >= 2 ? `<div class="card in"><div class="card-h"><h3>${T('Evolución semanal')}</h3><small>${T('nota media y partidos por semana')}</small></div><div class="chart">${weekChart(W)}</div>${weekSummary(W)}</div>` : ''}
        <div class="card in"><div class="card-h"><h3>${T('Notas por partido')}</h3><small>${T('la línea es su media')}</small></div><div class="chart">${ratingChart(games.slice(0, 30).reverse(), avgR)}</div></div>
        ${meta.rh && meta.rh.length > 1 ? `<div class="card in"><div class="card-h"><h3>${T('Evolución del MMR')}</h3><small>${TP(meta.rh.length, '{n} registro', '{n} registros')}</small></div><div class="chart">${mmrChart(meta.rh)}</div></div>` : ''}
        ${attr ? `<div class="card in"><div class="card-h"><h3>${T('Atributos')}</h3><small>${T('frente a {n} jugadores', { n: int(AT.n) })}</small></div>${radar(attr)}</div>` : ''}
      </div>
      <div class="col">
        <div class="card in"><div class="card-h"><h3>${T('Estadísticas')}</h3><div class="seg" role="group" aria-label="${T('Modo')}"><button type="button" data-sm="pg" aria-pressed="${PV.statMode === 'pg'}">${T('Por partido')}</button><button type="button" data-sm="tot" aria-pressed="${PV.statMode === 'tot'}">${T('Totales')}</button></div></div><div id="pstats"></div></div>
        ${matesCard(P, games)}
        <div class="card in"><div class="card-h"><h3>${T('Partidos')}</h3><div class="seg" role="group" aria-label="${T('Filtrar')}">${[['all', 'Todos'], ['W', 'Victorias'], ['L', 'Derrotas']].map(([k, l]) => `<button type="button" data-hf="${k}" aria-pressed="${PV.hist === k}">${T(l)}</button>`).join('')}</div></div><div id="phist"></div></div>
      </div>
    </div>`;
  const drawStats = () => { $('#pstats').innerHTML = playerStats(a, PV.statMode); };
  $$('[data-sm]', MAIN).forEach((b) => b.addEventListener('click', () => { PV.statMode = b.getAttribute('data-sm'); $$('[data-sm]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawStats(); }));
  $$('[data-hf]', MAIN).forEach((b) => b.addEventListener('click', () => { PV.hist = b.getAttribute('data-hf'); PV.histN = 15; $$('[data-hf]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawHist(P, games); }));
  $('#p-cmp').addEventListener('click', () => openPicker(P));
  drawStats(); drawHist(P, games);
}
const attrOf = (a, AT) => {
  if (!AT || !(AT.n > 1) || !a || a.gp < 5) return null;
  const raw = C.attrRaw(a), o = {}; for (const [k] of C.ATTRS) o[k] = C.percentile(AT.q[k], raw[k]); return o;
};
function playerStats(a, mode) {
  const gp = a.gp || 1, pg = mode === 'pg';
  const v = (x) => pg ? dec(x / gp) : int(x);
  const fo = a.fw + a.fl;
  const groups = [
    ['Ataque', [['Goles', v(a.g)], ['Tiros', v(a.sh)], ['Acierto de tiro', a.sh ? pct(a.g / a.sh) : '–'], ['Postes', v(a.ph)]]],
    ['Juego', [['Asistencias', v(a.as)], ['Pases', v(a.ps)], ['Posesión', pg ? C.fmtPoss(a.po / gp) : C.fmtPoss(a.po)], ['Faceoffs ganados', fo ? `${pct(a.fw / fo)} (${int(a.fw)}/${int(fo)})` : '–']]],
    ['Defensa', [['Paradas', v(a.sv)], ['Robos', v(a.tk)], ['Bloqueos', v(a.bl)], ['Pérdidas', v(a.to)]]],
  ];
  return groups.map(([g, rows]) => `<div class="slist"><div class="sgrp-h">${T(g)}</div>${rows.map(([k, x]) => `<div class="row"><span>${T(k)}</span><b>${x}</b></div>`).join('')}</div>`).join('');
}
function matesCard(P, games) {
  const mates = new Map();
  for (const g of games) for (const id of g.mt) { const r = mates.get(id) || { id, n: 0, w: 0 }; r.n++; if (g.r === 'W') r.w++; mates.set(id, r); }
  const list = [...mates.values()].sort((a, b) => b.n - a.n || b.w - a.w).slice(0, 5);
  if (!list.length) return '';
  return `<div class="card in"><div class="card-h"><h3>${T('Compañeros habituales')}</h3><small>${T('victorias juntos')}</small></div><div style="padding-bottom:8px">${list.map((r, i) => {
    const n = (P.names && P.names[r.id]) || r.id;
    return `<div class="lrow-w"><a class="lrow" href="#j-${esc(r.id)}"><span class="i">${i + 1}</span>${avatar(n, r.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span translate="no">${esc(n)}</span><span class="sub">${TP(r.n, '{n} partido juntos', '{n} partidos juntos')}</span></span><span class="v">${pct(r.w / r.n)}</span></a><a class="lrow-x" href="#vs-${esc(P.id)}-${esc(r.id)}" title="${T('Comparar')}" aria-label="${T('Comparar')}">${ICON.vs}</a></div>`;
  }).join('')}</div></div>`;
}
function drawHist(P, games) {
  const el = $('#phist'); if (!el) return;
  const list = games.filter((g) => PV.hist === 'all' || g.r === PV.hist);
  if (!list.length) { el.innerHTML = '<div class="empty">' + T('No hay partidos con este filtro.') + '</div>'; return; }
  el.innerHTML = list.slice(0, PV.histN).map((g) => {
    const opp = g.op.map((id) => (P.names && P.names[id]) || id).join(', ');
    return `<a class="hrow" href="${matchHref(g.k, g.i)}"><span class="d">${esc(DF_SHORT.format(new Date(g.t)))}<br>${DF_TIME.format(new Date(g.t))}</span><span class="res ${g.r}">${resLetter(g.r)}</span><span class="vs"><span class="sc">${g.gf}-${g.ga}</span> vs <span translate="no">${esc(opp)}</span></span><span class="ga">${g.st.goals || 0} ${T('G')} · ${g.st.assists || 0} ${T('A')}</span>${badge(g.rt)}</a>`;
  }).join('') + (list.length > PV.histN ? `<div class="more"><button class="btn" type="button" id="h-more">${T('Ver más ({n})', { n: int(list.length - PV.histN) })}</button></div>`
    : P._a.gp > P._g.length && PV.hist === 'all' ? `<p class="muted hnote">${T('Aquí salen sus últimos {n} partidos. Las estadísticas cuentan los {m} de su carrera.', { n: int(P._g.length), m: int(P._a.gp) })}</p>` : '');
  const b = $('#h-more'); if (b) b.addEventListener('click', () => { PV.histN += 20; drawHist(P, games); });
}
function ratingChart(gs, avgR) {
  if (!gs.length) return '<div class="empty">' + T('Sin partidos') + '</div>';
  const Wd = 600, H = 180, L = 26, R = 8, TOP = 14, B = 20, lo = 4, hi = 10;
  const y = (v) => TOP + (H - TOP - B) * (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo));
  const n = gs.length, slot = (Wd - L - R) / Math.max(n, 10), bw = Math.min(16, slot * 0.6);
  let g = '';
  for (const v of [5, 6, 7, 8, 9, 10]) g += `<line class="gl" x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 7}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const bars = gs.map((x, i) => { const cx = L + slot * i + slot / 2, top = y(x.rt); return `<rect class="bar f-${rcls(x.rt)}" style="animation-delay:${i * 18}ms" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(lo) - top).toFixed(1)}" rx="3"><title>${esc(DF_SHORT.format(new Date(x.t)))} · ${fmtR(x.rt)}</title></rect>`; }).join('');
  const last = gs[n - 1], lx = L + slot * (n - 1) + slot / 2;
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${T('Notas de los últimos {n} partidos', { n })}">${g}${bars}<line class="avgl" x1="${L}" x2="${Wd - R}" y1="${y(avgR).toFixed(1)}" y2="${y(avgR).toFixed(1)}"/><text x="${lx.toFixed(1)}" y="${(y(last.rt) - 5).toFixed(1)}" text-anchor="middle" style="fill:var(--fg);font-weight:800">${fmtR(last.rt)}</text></svg>`;
}
function mmrChart(rh) {
  const pts = rh.slice(-40), Wd = 600, H = 170, L = 40, R = 12, TOP = 14, B = 22;
  const vals = pts.map((p) => p[1]); let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 50) { lo -= 25; hi += 25; }
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const x = (t) => L + (Wd - L - R) * (t1 === t0 ? 1 : (t - t0) / (t1 - t0)), y = (v) => TOP + (H - TOP - B) * (1 - (v - lo) / (hi - lo));
  const ticks = [lo, (lo + hi) / 2, hi].map(Math.round);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${T('Evolución del MMR')}">${ticks.map((v) => `<line class="gl" x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 7}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <path class="area" d="${line} L${x(last[0]).toFixed(1)} ${H - B} L${x(pts[0][0]).toFixed(1)} ${H - B}Z"/><path class="line" d="${line}"/>
    <circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="5" fill="var(--primary)" stroke="var(--surface)" stroke-width="2"/>
    <text x="${L}" y="${H - 4}">${esc(DF_SHORT.format(new Date(t0)))}</text><text x="${Wd - R}" y="${H - 4}" text-anchor="end">${esc(DF_SHORT.format(new Date(t1)))}</text></svg>`;
}
// radar de atributos; con dos jugadores se superponen (A en azul, B en naranja)
function radar(attr, attrB, names) {
  const ax = C.ATTRS;
  const cx = 110, cy = 110, R = 78;
  const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / ax.length; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
  const ring = (v) => ax.map((_, i) => pt(i, v).map((n) => n.toFixed(1)).join(',')).join(' ');
  const shape = (at) => ax.map(([k], i) => pt(i, Math.max(0.06, (at[k] ?? 0) / 100)).map((n) => n.toFixed(1)).join(',')).join(' ');
  const labels = ax.map(([, l], i) => { const [x, y] = pt(i, 1.24); return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${T(l)}</text>`; }).join('');
  const two = !!attrB;
  const bar = (v, cls = '') => `<span class="b ${cls}"><i style="width:${v ?? 0}%"></i></span>`;
  return `<div class="radar${two ? ' two' : ''}"><svg viewBox="-36 -4 292 228" role="img" aria-label="${T('Atributos del jugador')}">${[0.25, 0.5, 0.75, 1].map((v) => `<polygon class="ax" points="${ring(v)}"/>`).join('')}${ax.map((_, i) => { const [x, y] = pt(i, 1); return `<line class="ax" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}<polygon class="shape${two ? ' a' : ''}" points="${shape(attr)}"/>${two ? `<polygon class="shape b" points="${shape(attrB)}"/>` : ''}${labels}</svg>
    <ul>${two ? `<li class="rl"><span></span><span class="a" translate="no">${esc(names[0])}</span><span class="b" translate="no">${esc(names[1])}</span></li>` : ''}${ax.map(([k, l]) => two
      ? `<li class="r2"><span>${T(l)}</span><span class="a">${attr[k] ?? '–'}</span><span class="b">${attrB[k] ?? '–'}</span>${bar(attr[k], 'a')}${bar(attrB[k], 'b')}</li>`
      : `<li><span>${T(l)}</span><span>${attr[k] == null ? '–' : attr[k]}</span>${bar(attr[k])}</li>`).join('')}</ul></div>`;
}

// ---------- elegir rival para comparar ----------
async function openPicker(A) {
  openSheet(`<div class="sheet-h"><div style="min-width:0;flex:1"><div class="nm" id="sheet-title">${T('Comparar a {n} con…', { n: `<span translate="no">${esc(A.n)}</span>` })}</div><small>${T('Busca un jugador o pega su enlace de slapshot.gg')}</small></div></div>
    <div class="pk"><div class="search pk-s">${ICON.search}<input id="pk-q" type="search" placeholder="${T('Buscar jugador')}" autocomplete="off" aria-label="${T('Buscar jugador')}"></div><div class="pk-list" id="pk-list" role="listbox"></div></div>
    <div class="sheet-f"><button class="btn" type="button" data-close>${T('Cerrar')}</button></div>`);
  const inp = $('#pk-q'), box = $('#pk-list');
  inp.focus({ preventScroll: true });
  const href = (id) => `#vs-${A.id}-${id}`;
  let I = null; try { I = await searchIdx(); } catch {}
  const byId = new Map((I || []).map(([, r]) => [r[0], r]));
  const rowOf = (id) => byId.get(id) || [id, (A.names && A.names[id]) || T('Jugador {id}', { id }), '', null, -1];
  // sin texto: favoritos y los jugadores con los que más ha coincidido
  const cnt = new Map(); for (const g of A._g) for (const id of g.mt.concat(g.op)) cnt.set(id, (cnt.get(id) || 0) + 1);
  const sug = [...new Set([...FAVS, ...[...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)])].filter((id) => id !== A.id).slice(0, 8).map(rowOf);
  const draw = () => {
    const q = inp.value.trim();
    const list = q ? (I ? findPlayers(I, q).filter((r) => r[0] !== A.id) : []) : sug;
    box.innerHTML = (q ? '' : `<div class="pk-h">${T('Sugerencias')}</div>`) + (list.length ? list.map((r) => playerOpt(r, href(r[0]), false, cnt.get(r[0]))).join('') : `<div class="none">${q ? T('Ningún jugador con ese nombre todavía.') : ''}</div>`);
  };
  let ti; inp.addEventListener('input', () => { clearTimeout(ti); ti = setTimeout(draw, 60); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $('a', box); if (a) { location.hash = a.getAttribute('href'); closeSheet(true); } } });
  box.addEventListener('click', (e) => { if (e.target.closest('a')) closeSheet(true); });
  draw();
}

// =====================================================================
// COMPARAR DOS JUGADORES
// =====================================================================
async function viewVs(r, tok) {
  const ida = r.a, idb = r.b;
  if (!ida || !idb || ida === idb) return notFound(T('Elige dos jugadores distintos para compararlos.'));
  MAIN.innerHTML = `<div class="card"><div class="vsh"><div class="sk" style="width:76px;height:76px;border-radius:50%;margin:auto"></div><div></div><div class="sk" style="width:76px;height:76px;border-radius:50%;margin:auto"></div></div></div><div style="height:16px"></div>${skeletonList(5)}`;
  let A, B, AT;
  try { [A, B, AT] = await Promise.all([loadP(ida), loadP(idb), loadAttr().catch(() => null)]); }
  catch (e) { if (!live(tok)) return; if (e.status === 404) return notFound(T('Uno de los dos jugadores no tiene partidos guardados todavía.')); return errorBox(e); }
  if (!live(tok)) return;
  const ga = A._g.filter((g) => !S.hidden.has(g.i)), gb = B._g.filter((g) => !S.hidden.has(g.i));
  const aa = A._a, ab = B._a, avg = (a) => a.gp ? a.rs / a.gp : 0;
  // partidos en los que coincidieron (de los dos perfiles, sin repetir), vistos desde A
  const inv = (x) => x === 'W' ? 'L' : x === 'L' ? 'W' : 'D';
  const H2H = new Map();
  const add = (g, other, isA) => {
    const w = g.mt.includes(other); if (!w && !g.op.includes(other)) return;
    const x = H2H.get(g.i) || { i: g.i, k: g.k, t: g.t, w };
    if (isA) { x.r = g.r; x.gf = g.gf; x.ga = g.ga; x.ra = g.rt; }
    else { if (x.r == null) { x.r = w ? g.r : inv(g.r); x.gf = w ? g.gf : g.ga; x.ga = w ? g.ga : g.gf; } x.rb = g.rt; }
    H2H.set(g.i, x);
  };
  for (const g of ga) add(g, idb, true);
  for (const g of gb) add(g, ida, false);
  const h2h = [...H2H.values()].sort((x, y) => y.t - x.t);
  const tog = h2h.filter((x) => x.w), vs = h2h.filter((x) => !x.w);
  const tw = tog.filter((x) => x.r === 'W').length, tl = tog.filter((x) => x.r === 'L').length;
  const va = vs.filter((x) => x.r === 'W').length, vb = vs.filter((x) => x.r === 'L').length;
  const side = (P, a, cls) => `<a class="vs-p ${cls}" href="#j-${esc(P.id)}">${avatar(P.n, P.id, 'lg')}<b translate="no">${esc(P.n)}</b><span class="vs-rk">${rank(P.meta && P.meta.rk, 20)}${P.meta && P.meta.mmr != null ? `${int(P.meta.mmr)} MMR` : esc(T('Sin rango'))}</span>${badge(avg(a), 'lg')}</a>`;
  // filas de comparación por partido: [etiqueta, valor(a), formato, menos es mejor]
  const per = (k) => (a) => a.gp ? (a[k] || 0) / a.gp : 0;
  const ROWS = [['Nota media', avg, fmtR], ['% de victorias', (a) => a.gp ? a.w / a.gp : 0, pct], ['MVP', (a) => a.gp ? a.mvp / a.gp : 0, pct],
    ['Goles', per('g'), dec], ['Asistencias', per('as'), dec], ['Tiros', per('sh'), dec], ['Acierto de tiro', (a) => a.sh ? a.g / a.sh : 0, pct],
    ['Paradas', per('sv'), dec], ['Pases', per('ps'), dec], ['Robos', per('tk'), dec], ['Bloqueos', per('bl'), dec], ['Pérdidas', per('to'), dec, true],
    ['Posesión', per('po'), (v) => C.fmtPoss(v)], ['Puntos de juego', per('pt'), dec]];
  const cmp = ([l, f, fmt, low]) => {
    const x = f(aa), y = f(ab), s = x + y;
    const la = low ? x < y : x > y, lb = low ? y < x : y > x;
    return `<div class="cmp-row"><div class="cmp-top"><span class="v ${la ? 'lead h' : ''}">${fmt(x)}</span><em>${T(l)}</em><span class="v ${lb ? 'lead a' : ''}">${fmt(y)}</span></div>
      <div class="cmp-bars"><div><i class="${la ? 'lead' : ''}" style="width:${s ? Math.round(x / s * 100) : 0}%"></i></div><div><i class="${lb ? 'lead' : ''}" style="width:${s ? Math.round(y / s * 100) : 0}%"></i></div></div></div>`;
  };
  const atA = attrOf(aa, AT), atB = attrOf(ab, AT);
  const form = (P, gs) => `<div class="vs-form"><span class="nm" translate="no">${esc(P.n)}</span><div class="form">${gs.slice(0, 10).reverse().map((g) => `<a href="${matchHref(g.k, g.i)}" title="${esc(DF_SHORT.format(new Date(g.t)) + ' · ' + g.gf + '-' + g.ga)}">${badge(g.rt)}<span class="res ${g.r}">${resLetter(g.r)}</span></a>`).join('')}</div></div>`;
  const sa = streaks(ga), sb = streaks(gb);
  MAIN.innerHTML = `
    <nav class="crumbs in"><a href="#jugadores">${T('Jugadores')}</a>${ICON.right}<span>${T('Comparar')}</span></nav>
    <section class="card in vsh">${side(A, aa, 'a')}<div class="vs-mid"><span class="vs-x">VS</span><a class="ibtn" href="#vs-${esc(idb)}-${esc(ida)}" title="${T('Intercambiar')}" aria-label="${T('Intercambiar')}">${ICON.swap}</a><button class="btn sm" type="button" id="vs-chg">${T('Cambiar rival')}</button></div>${side(B, ab, 'b')}</section>
    <div style="height:16px"></div>
    <div class="layout half">
      <div class="col">
        <div class="card in"><div class="card-h"><h3>${T('Cara a cara')}</h3><small>${TP(h2h.length, '{n} partido en común', '{n} partidos en común')}</small></div>
          <div class="h2h"><div class="h2h-b"><span class="k">${T('Uno contra otro')}</span><div class="h2h-sc"><b class="a">${va}</b><i>-</i><b class="b">${vb}</b></div><span class="sub">${vs.length ? TP(vs.length, '{n} partido', '{n} partidos') + (vs.length - va - vb ? ' · ' + TP(vs.length - va - vb, '{n} empate', '{n} empates') : '') : T('Nunca se han enfrentado')}</span>
            ${vs.length ? `<div class="h2h-bar"><i class="a" style="flex:${va || 0.0001}"></i><i class="b" style="flex:${vb || 0.0001}"></i></div>` : ''}</div>
            <div class="h2h-b"><span class="k">${T('En el mismo equipo')}</span><div class="h2h-sc"><b>${tw}</b><i>-</i><b>${tl}</b></div><span class="sub">${tog.length ? TP(tog.length, '{n} partido', '{n} partidos') + ' · ' + pct(tw / tog.length) + ' ' + T('victorias') : T('Nunca han jugado juntos')}</span></div></div>
          ${h2h.length ? `<div class="h2h-list">${h2h.slice(0, 10).map((x) => `<a class="hrow" href="${matchHref(x.k, x.i)}"><span class="d">${esc(DF_SHORT.format(new Date(x.t)))}<br>${DF_TIME.format(new Date(x.t))}</span><span class="res ${x.r}">${resLetter(x.r)}</span><span class="vs"><span class="sc">${x.gf}-${x.ga}</span> <span class="pill ${x.w ? 'tog' : ''}">${x.w ? T('Juntos') : T('Contra')}</span></span><span class="ga">${x.ra != null ? badge(x.ra) : ''}</span>${x.rb != null ? badge(x.rb) : '<span></span>'}</a>`).join('')}</div>
            <p class="legend">${T('Resultado visto desde {a}. Las notas son de {a} y de {b}.', { a: `<b translate="no">${esc(A.n)}</b>`, b: `<b translate="no">${esc(B.n)}</b>` })}</p>` : `<div class="empty">${T('Todavía no han coincidido en ningún partido guardado.')}</div>`}
        </div>
        ${atA && atB ? `<div class="card in"><div class="card-h"><h3>${T('Atributos')}</h3><small>${T('percentil frente a {n} jugadores', { n: int(AT.n) })}</small></div>${radar(atA, atB, [A.n, B.n])}</div>` : ''}
        <div class="card in"><div class="card-h"><h3>${T('Forma')}</h3><small>${T('últimos 10 partidos')}</small></div><div class="vs-forms">${form(A, ga)}${form(B, gb)}</div></div>
      </div>
      <div class="col">
        <div class="card in"><div class="card-h"><h3>${T('Por partido')}</h3><small>${T('{a} y {b} partidos', { a: int(aa.gp), b: int(ab.gp) })}</small></div><div class="card-b" style="padding-top:0">
          <div class="cmp-row"><div class="cmp-top"><span class="v">${int(aa.gp)}</span><em>${T('Partidos')}</em><span class="v">${int(ab.gp)}</span></div></div>
          <div class="cmp-row"><div class="cmp-top"><span class="v">${streakTxt(sa.cs)}</span><em>${T('Racha actual')}</em><span class="v">${streakTxt(sb.cs)}</span></div></div>
          ${ROWS.map(cmp).join('')}</div></div>
      </div>
    </div>`;
  $('#vs-chg').addEventListener('click', () => openPicker(A));
}

// =====================================================================
// JUGADORES (tabla)
// =====================================================================
const PF = { q: '', win: 'a', min: 3, sort: 'avg', dir: -1, limit: 50 };
const PCOLS = [['mmr', 'Rango'], ['gp', 'PJ'], ['w', 'V'], ['wp', '% V'], ['avg', 'Nota'], ['mvp', 'MVP'], ['g', 'G'], ['as', 'A'], ['ga', 'G+A'], ['ppg', 'PTS/PJ'], ['sh', 'Tiros'], ['shp', '% tiro'], ['sv', 'Paradas'], ['ps', 'Pases'], ['tk', 'Robos'], ['to', 'Pérd.'], ['po', 'Posesión/PJ']].map(([k, l]) => [k, T(l)]);
async function viewPlayers(tok) {
  MAIN.innerHTML = `<h1 class="h1 in">${T('Jugadores')}</h1><p class="lead">${T('Todos los jugadores con partidos guardados. Pulsa una columna para ordenar.')}</p>
    <div class="card in"><div class="card-h" style="flex-wrap:wrap"><div class="toolbar" style="width:100%">
      <input class="input grow" id="p-q" type="search" placeholder="${T('Buscar jugador')}" value="${esc(PF.q)}" autocomplete="off" aria-label="${T('Buscar jugador')}">
      <div class="seg" role="group" aria-label="${T('Periodo')}">${[['a', 'Siempre'], ['m', '30 días'], ['k', '7 días']].map(([k, l]) => `<button type="button" data-w="${k}" aria-pressed="${PF.win === k}">${T(l)}</button>`).join('')}</div>
      ${FAVS.length ? `<button type="button" class="chip fvc" id="p-fav" aria-pressed="${!!PF.fav}">${ICON.star}${T('Mis jugadores')}</button>` : ''}
      <select class="select" id="p-min" aria-label="${T('Mínimo de partidos')}">${[1, 3, 5, 10, 25].map((v) => `<option value="${v}" ${PF.min === v ? 'selected' : ''}>${T('Mín. {n} PJ', { n: v })}</option>`).join('')}</select>
    </div></div><div class="tscroll" id="ptable">${Array.from({ length: 8 }, skRow).join('')}</div></div>`;
  let rows; try { rows = await loadTable(PF.win); } catch (e) { if (live(tok)) errorBox(e); return; }
  if (!live(tok)) return;
  let tq;
  $('#p-q').addEventListener('input', (e) => { clearTimeout(tq); tq = setTimeout(() => { PF.q = e.target.value; PF.limit = 50; drawPlayers(rows); }, 120); });
  $('#p-min').addEventListener('change', (e) => { PF.min = Number(e.target.value); PF.limit = 50; drawPlayers(rows); });
  const pf = $('#p-fav'); if (pf) pf.addEventListener('click', () => { PF.fav = !PF.fav; PF.limit = 50; pf.setAttribute('aria-pressed', String(PF.fav)); drawPlayers(rows); });
  $$('[data-w]', MAIN).forEach((b) => b.addEventListener('click', async () => {
    PF.win = b.getAttribute('data-w'); PF.limit = 50; $$('[data-w]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const el = $('#ptable'); el.classList.add('busy');
    try { rows = await loadTable(PF.win); } catch { toast(T('No se pudo cargar la tabla.')); }
    if (live(tok)) { el.classList.remove('busy'); drawPlayers(rows); }
  }));
  $('#ptable').addEventListener('click', (e) => { const b = e.target.closest('[data-sort]'); if (!b) return; const k = b.getAttribute('data-sort'); if (PF.sort === k) PF.dir *= -1; else { PF.sort = k; PF.dir = -1; } drawPlayers(rows); });
  drawPlayers(rows);
}
function drawPlayers(all) {
  const q = fold(PF.q.trim());
  const rows = [];
  for (const p of all) {
    const a = p.a; if (a.gp < PF.min) continue;
    if (q && !fold(p.n).includes(q)) continue;
    if (PF.fav && !isFav(p.id)) continue;
    rows.push({ p, v: { mmr: p.mmr ?? -1, gp: a.gp, w: a.w, wp: a.w / a.gp, avg: a.rs / a.gp, mvp: a.mvp, g: a.g, as: a.as, ga: a.g + a.as, ppg: (a.pt || 0) / a.gp, shp: a.sh ? a.g / a.sh : 0, sh: a.sh, sv: a.sv, ps: a.ps, tk: a.tk, to: a.to, po: a.po / a.gp } });
  }
  rows.sort((x, y) => (PF.dir === -1 ? y.v[PF.sort] - x.v[PF.sort] : x.v[PF.sort] - y.v[PF.sort]) || y.v.avg - x.v.avg);
  const el = $('#ptable'); if (!el) return;
  if (!rows.length) { el.innerHTML = '<div class="empty"><strong>' + T('Ningún jugador con estos filtros.') + '</strong>' + T('Baja el mínimo de partidos o cambia el periodo.') + '</div>'; return; }
  const shown = rows.slice(0, PF.limit);
  const fmt = (k, v) => k === 'avg' ? badge(v) : k === 'wp' || k === 'shp' ? pct(v) : k === 'po' ? C.fmtPoss(v) : k === 'ppg' ? int(Math.round(v)) : k === 'mmr' ? '' : int(v);
  el.innerHTML = `<table class="tbl"><thead><tr><th>${T('Jugador')}</th>${PCOLS.map(([k, l]) => `<th><button type="button" data-sort="${k}" class="${PF.sort === k ? 'on' : ''}" aria-label="${T('Ordenar por {c}', { c: l })}">${l}${PF.sort === k ? (PF.dir === -1 ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}</tr></thead><tbody>
    ${shown.map((r) => `<tr><td><a class="pc" href="#j-${esc(r.p.id)}">${avatar(r.p.n, r.p.id, 'sm')}<span translate="no">${esc(r.p.n)}</span>${isFav(r.p.id) ? `<span class="fv-i">${ICON.star}</span>` : ''}</a></td><td class="rkc"><span class="pc" style="justify-content:flex-end">${r.p.rk ? `${r.p.mmr != null ? int(r.p.mmr) : ''} ${rank(r.p.rk, 20)}` : '<span class="muted">–</span>'}</span></td>${PCOLS.slice(1).map(([k]) => `<td>${fmt(k, r.v[k])}</td>`).join('')}</tr>`).join('')}
  </tbody></table>${rows.length > PF.limit ? `<div class="more"><button class="btn" type="button" id="p-more">${T('Ver más ({n})', { n: int(rows.length - PF.limit) })}</button></div>` : ''}`;
  const b = $('#p-more'); if (b) b.addEventListener('click', () => { PF.limit += 50; drawPlayers(all); });
}

// =====================================================================
// RANKINGS y RÉCORDS
// =====================================================================
const RK = { win: 'a' };
const rkTabs = (cur) => `<div class="ptabs in" role="tablist"><a role="tab" href="#rankings" aria-selected="${cur === 'rankings'}">${ICON.trophy}${T('Rankings')}</a><a role="tab" href="#records" aria-selected="${cur === 'records'}">${ICON.star}${T('Récords')}</a></div>`;
async function viewRankings(tok) {
  MAIN.innerHTML = `<h1 class="h1 in">${T('Rankings')}</h1><p class="lead">${T('Los mejores de la comunidad. Las medias piden un mínimo de partidos para contar.')}</p>${rkTabs('rankings')}
    <div class="toolbar" style="margin-bottom:16px"><div class="seg" role="group" aria-label="${T('Periodo')}">${[['a', 'Siempre'], ['m', '30 días'], ['k', '7 días']].map(([k, l]) => `<button type="button" data-w="${k}" aria-pressed="${RK.win === k}">${T(l)}</button>`).join('')}</div></div>
    <div class="rk-grid" id="rk">${Array.from({ length: 6 }, () => skeletonList(5)).join('')}</div>`;
  let R; try { R = await loadRankings(); } catch (e) { if (live(tok)) errorBox(e); return; }
  if (!live(tok)) return;
  $$('[data-w]', MAIN).forEach((b) => b.addEventListener('click', () => { RK.win = b.getAttribute('data-w'); $$('[data-w]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawRankings(R); }));
  drawRankings(R);
}
function drawRankings(R) {
  const el = $('#rk'); if (!el) return;
  const W = R[RK.win] || {};
  const card = (title, note, list, fmt) => {
    if (!list || !list.length) return '';
    return `<div class="card in"><div class="card-h"><h3>${T(title)}</h3><small>${note}</small></div><div style="padding-bottom:8px">${list.map((x, i) =>
      `<a class="lrow" href="#j-${esc(x.id)}"><span class="i">${i + 1}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span class="nr"><span class="t" translate="no">${esc(x.n)}</span>${rank(x.rk, 16)}${isFav(x.id) ? `<span class="fv-i">${ICON.star}</span>` : ''}</span><span class="sub">${TP(x.gp, '{n} partido', '{n} partidos', { n: int(x.gp) })}</span></span>${fmt(x.v)}</a>`).join('')}</div></div>`;
  };
  const v = (x) => `<span class="v">${int(x)}</span>`;
  const mmr = R.mmr || [];
  const mmrCard = mmr.length ? `<div class="card in"><div class="card-h"><h3>${T('Top MMR')}</h3><small>${T('clasificatoria')}</small></div><div style="padding-bottom:8px">${mmr.map((p, i) =>
    `<a class="lrow" href="#j-${esc(p.id)}"><span class="i">${i + 1}</span>${rank(p.rk, 28)}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span translate="no">${esc(p.n)}</span><span class="sub">${esc(p.rank || '')}</span></span><span class="v">${int(p.mmr)}</span></a>`).join('')}</div></div>` : '';
  const minGp = W.min || 1, minTxt = T('mín. {n} PJ', { n: minGp }), tot = T('total');
  const html = mmrCard
    + card('Nota media', minTxt, W.avg, (x) => badge(x))
    + card('Goles', tot, W.g, v)
    + card('Asistencias', tot, W.as, v)
    + card('Goles + asistencias', tot, W.ga, v)
    + card('Jugador del partido', T('veces MVP'), W.mvp, v)
    + card('Paradas', tot, W.sv, v)
    + card('Pases', tot, W.ps, v)
    + card('Robos', tot, W.tk, v)
    + card('Bloqueos', tot, W.bl, v)
    + card('% de victorias', minTxt, W.wp, (x) => `<span class="v">${pct(x)}</span>`)
    + card('Más partidos', T('jugados'), W.gp, v);
  el.innerHTML = html || '<div class="card empty">' + T('Todavía no hay datos para este periodo.') + '</div>';
}
async function viewRecords(tok) {
  MAIN.innerHTML = `<h1 class="h1 in">${T('Récords')}</h1><p class="lead">${T('Las mejores marcas desde que SlapScore guarda partidos.')}</p>${rkTabs('records')}
    <div class="rk-grid" id="rec">${Array.from({ length: 6 }, () => skeletonList(5)).join('')}</div>`;
  let R;
  try { R = await loadRecords(); }
  catch (e) { if (!live(tok)) return; if (e.status === 404) { $('#rec').innerHTML = `<div class="card empty in"><strong>${T('Calculando los récords…')}</strong>${T('Estarán listos en unos minutos.')}</div>`; return; } return errorBox(e); }
  if (!live(tok)) return;
  const when = (x) => esc(DF_SHORT.format(new Date(x.t)).replace('.', ''));
  const who = (x) => `<span class="nr"><span class="t" translate="no">${esc(x.n)}</span>${rank(x.rk, 16, { approx: x.ap })}${isFav(x.id) ? `<span class="fv-i">${ICON.star}</span>` : ''}</span>`;
  const card = (title, note, list, row) => list && list.length ? `<div class="card in"><div class="card-h"><h3>${T(title)}</h3><small>${note}</small></div><div style="padding-bottom:8px">${list.map(row).join('')}</div></div>` : '';
  // marca de un jugador en un partido
  const inMatch = (fmt) => (x, i) => `<a class="lrow" href="${matchHref(x.k, x.i)}"><span class="i">${i + 1}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0">${who(x)}<span class="sub">${when(x)} · ${x.s[0]}-${x.s[1]}${x.rt != null ? ' · ' + T('nota') + ' ' + fmtR(x.rt) : ''}</span></span>${fmt(x)}</a>`;
  const big = (x) => `<span class="v">${int(x.v)}</span>`;
  const html = card('Mejor nota en un partido', T('nota'), R.rt, (x, i) => `<a class="lrow" href="${matchHref(x.k, x.i)}"><span class="i">${i + 1}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0">${who(x)}<span class="sub">${when(x)} · ${x.g} ${T('G')} · ${x.as} ${T('A')} · ${x.s[0]}-${x.s[1]}</span></span>${badge(x.rt)}</a>`)
    + card('Más goles en un partido', T('goles'), R.g, inMatch(big))
    + card('Más asistencias en un partido', T('asistencias'), R.as, inMatch(big))
    + card('Más paradas en un partido', T('paradas'), R.sv, inMatch(big))
    + card('Más puntos de juego en un partido', T('puntos'), R.pts, inMatch(big))
    + card('Partidos con más goles', T('goles en total'), R.tot, (x, i) => `<a class="lrow" href="${matchHref(x.k, x.i)}"><span class="i">${i + 1}</span><span class="rec-sc">${x.s[0]}<i>-</i>${x.s[1]}</span><span class="nm" style="flex-direction:column;align-items:flex-start;gap:0"><span>${esc(typeLabel(x.y))} · ${esc(regionLabel(x.r))}</span><span class="sub">${when(x)}${x.a ? ' · ' + esc(x.a) : ''}</span></span><span class="v">${x.s[0] + x.s[1]}</span></a>`)
    + card('Mejor racha de victorias', T('victorias seguidas'), R.streak, (x, i) => `<a class="lrow" href="#j-${esc(x.id)}"><span class="i">${i + 1}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0">${who(x)}<span class="sub">${T('entre sus partidos guardados')}</span></span><span class="v">${int(x.v)}</span></a>`)
    + card('Más partidos en un día', T('partidos'), R.gpd, (x, i) => `<a class="lrow" href="#d-${esc(x.d)}"><span class="i">${i + 1}</span>${avatar(x.n, x.id, 'sm')}<span class="nm" style="flex-direction:column;align-items:flex-start;gap:0">${who(x)}<span class="sub">${esc(dayLong(x.d))}</span></span><span class="v">${int(x.gp)}</span></a>`);
  $('#rec').innerHTML = html || `<div class="card empty in">${T('Todavía no hay récords.')}</div>`;
}

// =====================================================================
// LIGA EUSL (datos de eusl.gg)
// =====================================================================
const LG = { sc: 'pro' };
async function viewLeague(tok) {
  MAIN.innerHTML = `<h1 class="h1 in">${T('Liga EUSL')}</h1><p class="lead">${T('European Slapshot League: clasificación, resultados y máximos anotadores de la temporada.')}</p><div class="layout two"><div class="col">${skeletonList(8)}</div><div class="col">${skeletonList(5)}</div></div>`;
  let L;
  try { if (!(S.index.files || {}).eusl) throw notFoundErr(); L = await loadLeague(); }
  catch (e) { if (!live(tok)) return; if (e.status === 404) { MAIN.innerHTML = `<h1 class="h1 in">${T('Liga EUSL')}</h1><div class="card empty in"><strong>${T('Los datos de la liga todavía no están disponibles.')}</strong>${T('El robot los trae de eusl.gg una vez por hora.')}<p><a href="https://www.eusl.gg" target="_blank" rel="noopener">eusl.gg ${ICON.ext}</a></p></div>`; return; } return errorBox(e); }
  if (!live(tok)) return;
  const TM = L.teams || {};
  const logo = (id, sz = 22) => { const t = TM[id] || {}; return t.logo ? `<img class="tlogo" src="${esc(t.logo)}" width="${sz}" height="${sz}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="tlogo ph" style="width:${sz}px;height:${sz}px">${esc((t.ab || t.n || '?').slice(0, 3))}</span>`; };
  const tname = (id) => esc((TM[id] && TM[id].n) || '?');
  const lname = (id) => esc((L.leagues || {})[id] || '');
  const DF_LG = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  const table = (t) => `<div class="card in"><div class="card-h"><h3>${esc(t.title)}</h3>${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">eusl.gg ${ICON.ext}</a>` : ''}</div><div class="tscroll"><table class="tbl lgt"><thead><tr><th>#</th><th>${T('Equipo')}</th><th title="${T('Partidos jugados')}">${T('PJ')}</th><th title="${T('Victorias')}">${T('V')}</th><th title="${T('Victorias en prórroga')}">${T('VP')}</th><th title="${T('Derrotas en prórroga')}">${T('DP')}</th><th title="${T('Derrotas')}">${T('D')}</th><th class="xs-h" title="${T('Goles a favor')}">${T('GF')}</th><th class="xs-h" title="${T('Goles en contra')}">${T('GC')}</th><th title="${T('Diferencia de goles')}">${T('DG')}</th><th title="${T('Puntos')}">${T('PTS')}</th></tr></thead><tbody>
    ${t.rows.map((r) => `<tr><td class="pos">${r.pos}</td><td><span class="pc lg-t">${logo(r.id)}<span class="nm">${tname(r.id)}</span></span></td><td>${r.gp}</td><td>${r.w}</td><td>${r.otw}</td><td>${r.otl}</td><td>${r.l}</td><td class="xs-h">${r.gf}</td><td class="xs-h">${r.ga}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td></tr>`).join('')}
  </tbody></table></div></div>`;
  const game = (g, done) => `<a class="lg-g" href="${esc(g.link || 'https://www.eusl.gg')}" target="_blank" rel="noopener"><span class="lg-d">${esc(DF_LG.format(new Date(g.t)).replace('.', ''))}<br>${DF_TIME.format(new Date(g.t))}</span>
    <span class="lg-tm">${logo(g.teams[0], 20)}<span class="nm${done && g.s[0] > g.s[1] ? ' won' : ''}">${tname(g.teams[0])}</span></span>
    <span class="lg-sc">${done ? `<b class="${g.s[0] > g.s[1] ? 'won' : ''}">${g.s[0]}</b><i>-</i><b class="${g.s[1] > g.s[0] ? 'won' : ''}">${g.s[1]}</b>${g.ot ? `<small>${T('Prór.')}</small>` : ''}` : '<i>vs</i>'}</span>
    <span class="lg-tm r"><span class="nm${done && g.s[1] > g.s[0] ? ' won' : ''}">${tname(g.teams[1])}</span>${logo(g.teams[1], 20)}</span>
    <span class="lg-l">${lname(g.league)}</span></a>`;
  const scorers = () => {
    const list = (L.scorers || {})[LG.sc] || [];
    if (!list.length) return `<div class="empty">${T('Sin estadísticas todavía.')}</div>`;
    return `<div class="tscroll"><table class="tbl lgs"><thead><tr><th>${T('Jugador')}</th><th title="${T('Partidos jugados')}">${T('PJ')}</th><th title="${T('Goles')}">${T('G')}</th><th title="${T('Asistencias')}">${T('A')}</th><th title="${T('Goles más asistencias')}">${T('G+A')}</th></tr></thead><tbody>
      ${list.map((x, i) => `<tr><td><span class="pc"><span class="i">${i + 1}</span>${logo(x.team, 18)}${x.sid ? `<a href="#j-${esc(x.sid)}" class="nm" translate="no">${esc(x.n)}</a>` : `<span class="nm" translate="no">${esc(x.n)}</span>`}</span></td><td>${x.gp}</td><td>${x.g}</td><td>${x.a}</td><td><b>${x.g + x.a}</b></td></tr>`).join('')}
    </tbody></table></div>`;
  };
  const up = L.upcoming || [], rs = L.results || [];
  MAIN.innerHTML = `<h1 class="h1 in">${T('Liga EUSL')}</h1><p class="lead">${T('{s} de la European Slapshot League: clasificación, resultados y máximos anotadores.', { s: esc(L.season ? L.season.name : '') })}</p>
    <div class="layout two"><div class="col">
      ${(L.tables || []).map(table).join('') || `<div class="card empty in">${T('Todavía no hay clasificación esta temporada.')}</div>`}
      <div class="card in"><div class="card-h"><h3>${T('Últimos resultados')}</h3></div>${rs.length ? `<div class="lg-list">${rs.slice(0, 15).map((g) => game(g, true)).join('')}</div>` : `<div class="empty">${T('Todavía no hay resultados esta temporada.')}</div>`}</div>
    </div><aside class="col sticky">
      <div class="card in"><div class="card-h"><h3>${T('Próximos partidos')}</h3></div>${up.length ? `<div class="lg-list">${up.slice(0, 8).map((g) => game(g, false)).join('')}</div>` : `<div class="empty">${T('No hay partidos programados ahora mismo.')}</div>`}</div>
      <div class="card in"><div class="card-h"><h3>${T('Máximos anotadores')}</h3><div class="seg" role="group" aria-label="${T('Competición')}">${[['pro', 'Pro'], ['challenger', 'Challenger']].map(([k, l]) => `<button type="button" data-sc="${k}" aria-pressed="${LG.sc === k}">${l}</button>`).join('')}</div></div><div id="lg-sc">${scorers()}</div></div>
      <div class="card in note"><div class="card-b"><b>${T('Datos de eusl.gg')}</b><p>${T('La clasificación y los resultados son los oficiales de la liga. Se actualizan cada hora; última vez {t}.', { t: esc(ago(Date.parse(L.updated))) })}</p><a class="btn sm" href="${esc(L.source || 'https://www.eusl.gg')}" target="_blank" rel="noopener">eusl.gg ${ICON.ext}</a></div></div>
    </aside></div>`;
  $$('[data-sc]', MAIN).forEach((b) => b.addEventListener('click', () => { LG.sc = b.getAttribute('data-sc'); $$('[data-sc]', MAIN).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#lg-sc').innerHTML = scorers(); }));
}

// =====================================================================
// CÓMO PUNTUAMOS
// =====================================================================
function viewMethod() {
  const W = S.W, D = C.DEFAULT_WEIGHTS;
  const t = (S.index && S.index.totals) || {}, lr = (S.index && S.index.lastRun) || {};
  const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + dec(Math.abs(x), Math.abs(x) < 0.1 ? 3 : 2).replace(/,?0+$/, '');
  MAIN.innerHTML = `<h1 class="h1 in">${T('Cómo puntuamos')}</h1><p class="lead">${T('Cada jugador recibe en cada partido una nota de 3 a 10 calculada solo con las estadísticas del partido.')}</p>
    <div class="layout half"><div class="col">
      <div class="card in"><div class="card-h"><h3>${T('La nota')}</h3></div><div class="card-b">
        <p>${T('Todos empiezan en')} <b>${dec(W.base)}</b>. ${T('Cada acción suma o resta según su peso; después se añade el resultado y se resta un poco por cada gol que encaja su equipo, porque en Slapshot defienden todos.')}</p>
        <p>${T('En 2v2 y 1v1 cada jugador acumula más acciones, así que ahí pesan menos para que las notas se puedan comparar entre formatos. Por encima de 8,5 y por debajo de 4,5 la escala se comprime, así que un 10 o un 3 solo salen en partidos excepcionales. El jugador con la nota más alta es el MVP.')}</p>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:10px">${[[9.2, '9 o más'], [8.4, '8 – 8,9'], [7.4, '7 – 7,9'], [6.7, '6,5 – 6,9'], [6.2, '6 – 6,4'], [5.5, 'menos de 6']].map(([r, l]) => `<span style="display:flex;gap:8px;align-items:center">${badge(r)}<span class="muted">${T(l)}</span></span>`).join('')}</div>
      </div></div>
      <div class="card in"><div class="card-h"><h3>${T('Rangos')}</h3><small>${hasOfficial() ? T('logos oficiales') : T('emblemas de SlapScore')}</small></div><div class="card-b"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px">
        ${RANK_KEYS.map((k) => `<div style="display:flex;align-items:center;gap:10px">${rank(k, 34)}<b>${esc(C.parseRank(k).name)}</b></div>`).join('')}
        </div><p class="muted" style="margin:14px 0 0;font-size:13px">${T('El rango de cada jugador en un partido es el que tenía según el último registro de SlapScore anterior a ese partido. Si el partido es de antes de empezar a seguirle, se muestra atenuado como aproximado.')}</p></div></div>
      <div class="card in"><div class="card-h"><h3>${T('De dónde salen los datos')}</h3></div><div class="card-b">
        <p>${T('Un robot revisa sin parar los perfiles públicos de')} <a href="https://slapshot.gg" target="_blank" rel="noopener">slapshot.gg</a>: ${T('los últimos 10 partidos de cada jugador con todas sus estadísticas, y su rango y MMR. Cada jugador que aparece en un partido entra en la lista y los más activos se revisan más a menudo. Los mejores jugadores van primero: si están jugando, sus partidos salen en unos 5 minutos.')}</p>
        <p>${T('Guardamos el detalle completo de los partidos de los últimos {n} días. Los anteriores pasan a un archivo descargable, pero sus notas, los perfiles y las estadísticas de carrera de cada jugador se conservan siempre.', { n: int((S.index && S.index.retain) || 60) })}</p>
        <p class="muted">${T('Ahora mismo: {m} partidos, {p} jugadores con partidos, {r} con rango. Última pasada {t}: {n} partidos nuevos.', { m: int(t.matches), p: int(t.players), r: int(t.ranked), t: lr.at ? esc(ago(Date.parse(lr.at))) : '–', n: int(lr.newMatches) })}</p>
      </div></div>
    </div><div class="col">
      <div class="card in"><div class="card-h"><h3>${T('Pesos de cada acción')}</h3>${JSON.stringify(W) !== JSON.stringify(D) ? '<small>' + T('personalizados') + '</small>' : ''}</div><div class="tscroll"><table class="tbl"><thead><tr><th>${T('Acción')}</th><th>${T('Peso')}</th></tr></thead><tbody>
        ${C.WEIGHT_FIELDS.map(([k, l]) => `<tr><td>${esc(T(l))}</td><td>${k === 'base' ? dec(W[k]) : k.startsWith('fmt') ? '×' + dec(W[k], 2) : sign(W[k])}</td></tr>`).join('')}
      </tbody></table></div></div>
    </div></div>`;
}

// =====================================================================
// ADMIN
// =====================================================================
function ctx() {
  return { S, C, esc, toast, emblem, avatar, badge, fmtR, dec, int, ago, getJSON, loadPlayers, loadSearch, applySettings, refreshData, renderChrome, go, isAdmin, ADMIN_KEY, rank, RANK_KEYS, setOfficial, supportUrl };
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
async function refreshData(manual) {
  const btn = $('#btn-refresh'); btn.classList.add('spin');
  try {
    const { idx, set } = await fetchIndex();
    if (set) applySettings(set);
    const changed = idx.updated !== S.ver;
    const prev = S.index && S.index.totals ? S.index.totals.matches : 0;
    setIndex(idx); $('#newbar').hidden = true;
    renderChrome(); go({ keepScroll: true });
    if (manual) toast(changed ? T('Datos actualizados') + (idx.totals.matches > prev ? ' · ' + TP(idx.totals.matches - prev, '{n} partido nuevo', '{n} partidos nuevos', { n: int(idx.totals.matches - prev) }) : '') : T('Ya tienes lo último'));
    return changed;
  } catch (e) { if (manual) toast(T('No se pudo actualizar. Comprueba tu conexión.')); return false; }
  finally { btn.classList.remove('spin'); }
}
$('#btn-refresh').addEventListener('click', () => refreshData(true));
$('#btn-new').addEventListener('click', () => refreshData(true));
setInterval(async () => {
  if (document.hidden || !S.index) return;
  try { const idx = await getJSON('data/index.json', true); if (idx.updated !== S.ver) $('#newbar').hidden = false; } catch {}
}, 4 * 60_000);

// ---------- precarga al señalar un enlace (ratón encima o dedo apoyado) ----------
(() => {
  let hov = 0;
  const warm = (a) => {
    if (!S.index || S.index.v !== 3) return;
    const h = decodeURIComponent((a.getAttribute('href') || '').slice(1));
    try {
      if (h.startsWith('m-')) { const m = parseMatch(h); if (m) loadMatch(m.key, m.id).catch(() => {}); }
      else if (h.startsWith('j-')) Promise.all([loadP(h.slice(2)), loadAttr()]).catch(() => {});
      else if (h.startsWith('d-')) { const d = h.slice(2); loadMeta(d).then((m) => firstChunks(d, m)).catch(() => {}); }
      else if (h === 'jugadores') loadTable(PF.win).catch(() => {});
      else if (h === 'rankings') loadRankings().catch(() => {});
      else if (h === 'records') loadRecords().catch(() => {});
      else if (h === 'liga' && (S.index.files || {}).eusl) loadLeague().catch(() => {});
      else if (h.startsWith('vs-')) { const [x, y] = h.slice(3).split('-'); Promise.all([loadP(x), loadP(y), loadAttr()]).catch(() => {}); }
    } catch {}
  };
  const target = (e) => e.target.closest && e.target.closest('a[href^="#"]');
  document.addEventListener('pointerover', (e) => { const a = target(e); if (!a || e.pointerType === 'touch') return; clearTimeout(hov); hov = setTimeout(() => warm(a), 70); }, { passive: true });
  document.addEventListener('pointerout', () => clearTimeout(hov), { passive: true });
  document.addEventListener('touchstart', (e) => { const a = target(e); if (a) warm(a); }, { passive: true });
  document.addEventListener('pointerdown', (e) => { const a = target(e); if (a) warm(a); }, { passive: true });
  // botones de día: también se precargan
  document.addEventListener('pointerover', (e) => { const b = e.target.closest && e.target.closest('button[data-day]'); const d = b && b.getAttribute('data-day'); if (d && S.index) loadMeta(d).then((m) => firstChunks(d, m)).catch(() => {}); }, { passive: true });
})();

// Si la web se muda (ajuste "home"), la dirección antigua de GitHub Pages lleva a la nueva
function moved() {
  try {
    const u = new URL(String(S.settings.home || ''));
    // solo desde las direcciones de GitHub Pages y workers.dev; #admin nunca redirige, para poder corregirlo si algo falla
    if (u.protocol === 'https:' && u.origin !== location.origin && /\.(github\.io|workers\.dev)$/.test(location.hostname) && location.hash !== '#admin') { location.replace(u.origin + u.pathname + location.hash); return true; }
  } catch {}
  return false;
}

// ---------- arranque ----------
(async function boot() {
  renderChrome(); go({ instant: true });
  try {
    const { idx, set } = await fetchIndex();
    applySettings(set || {}); setIndex(idx);
    if (moved()) return;
  } catch (e) {
    MAIN.innerHTML = `<div class="card empty"><strong>${T('No se pudieron cargar los partidos.')}</strong><p>${e.status === 404 ? T('El robot aún no ha publicado datos.') : T('Comprueba tu conexión y vuelve a intentarlo.')}</p><button class="btn" type="button" onclick="location.reload()">${T('Reintentar')}</button></div>`;
    return;
  }
  renderChrome(); go({ instant: true }); S.booted = true;
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
  $('#itip').innerHTML = `<div class="itip" role="dialog" aria-label="${T('Instalar SlapScore')}"><span class="brand-mark sm"><i></i></span><div class="t"><b>${T('Instala SlapScore')}</b><span>${ios ? T('Pulsa Compartir y después «Añadir a pantalla de inicio».') : T('Tenla en tu pantalla de inicio y ábrela como una app.')}</span></div>${ios ? '' : '<button class="btn primary sm" type="button" id="tip-ok">' + T('Instalar') + '</button>'}<button class="ibtn" type="button" id="tip-x" aria-label="${T('Cerrar')}">×</button></div>`;
  $('#tip-x').addEventListener('click', () => hideTip(true));
  const ok = $('#tip-ok'); if (ok) ok.addEventListener('click', install);
}
async function install() {
  if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; $('#btn-install').hidden = true; hideTip(true); return; }
  if (isIOS()) { hideTip(false); try { localStorage.removeItem('slapscore-tip'); } catch {} showTip(); }
}
$('#btn-install').addEventListener('click', install);
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btn-install').hidden = false; setTimeout(showTip, 2500); });
addEventListener('appinstalled', () => { installEvt = null; $('#btn-install').hidden = true; hideTip(true); toast(T('SlapScore instalada en tu dispositivo')); });
if (isIOS() && !standalone()) { $('#btn-install').hidden = false; setTimeout(showTip, 3500); }
if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
