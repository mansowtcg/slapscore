// Overlay para OBS: las notas de los últimos partidos de un jugador y su nota media, para ponerlo en un directo.
// La página /overlay/<id>?... (overlay.html + overlay-page.js) lo dibuja sobre fondo transparente y se actualiza sola;
// el perfil de la web usa renderOverlay() para la vista previa del configurador. Ligero a propósito: no carga la web
// entera ni los diccionarios (sus textos van aquí, en los 6 idiomas).
import { bucketOf, gameObj, parseRank } from './core.js';
import { setOfficial, officialSrc } from './emblems.js';

export const OV_LANGS = ['en', 'es', 'fr', 'de', 'pt', 'tr'];
const LOCS = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', tr: 'tr-TR' };
const TX = {
  en: { avg: 'Avg rating', last: 'Last {n} matches', wl: 'W-L', win: 'Win %', g: 'G/GP', a: 'A/GP', mvp: 'MVP', pub: 'Public', cus: 'Custom', all: 'All', none: 'No matches yet', nf: 'Player not found', noid: 'Missing player ID', W: 'W', L: 'L', D: 'D' },
  es: { avg: 'Nota media', last: 'Últimos {n} partidos', wl: 'V-D', win: '% V', g: 'G/PJ', a: 'A/PJ', mvp: 'MVP', pub: 'Públicas', cus: 'Custom', all: 'Todas', none: 'Sin partidos todavía', nf: 'Jugador no encontrado', noid: 'Falta el ID del jugador', W: 'V', L: 'D', D: 'E' },
  fr: { avg: 'Note moyenne', last: '{n} derniers matchs', wl: 'V-D', win: '% V', g: 'B/MJ', a: 'A/MJ', mvp: 'MVP', pub: 'Publiques', cus: 'Custom', all: 'Toutes', none: 'Aucun match pour le moment', nf: 'Joueur introuvable', noid: "ID du joueur manquant", W: 'V', L: 'D', D: 'N' },
  de: { avg: 'Ø Note', last: 'Letzte {n} Spiele', wl: 'S-N', win: '% S', g: 'T/SP', a: 'V/SP', mvp: 'MVP', pub: 'Öffentlich', cus: 'Custom', all: 'Alle', none: 'Noch keine Spiele', nf: 'Spieler nicht gefunden', noid: 'Spieler-ID fehlt', W: 'S', L: 'N', D: 'U' },
  pt: { avg: 'Nota média', last: 'Últimas {n} partidas', wl: 'V-D', win: '% V', g: 'G/PJ', a: 'A/PJ', mvp: 'MVP', pub: 'Públicas', cus: 'Custom', all: 'Todas', none: 'Ainda sem partidas', nf: 'Jogador não encontrado', noid: 'Falta o ID do jogador', W: 'V', L: 'D', D: 'E' },
  tr: { avg: 'Ort. not', last: 'Son {n} maç', wl: 'G-M', win: 'G %', g: 'G/OM', a: 'A/OM', mvp: 'MVP', pub: 'Açık', cus: 'Özel', all: 'Tümü', none: 'Henüz maç yok', nf: 'Oyuncu bulunamadı', noid: 'Oyuncu ID\'si eksik', W: 'G', L: 'M', D: 'B' },
};

// Opciones (todas van en la dirección, para que OBS las recuerde): n partidos, m tipo, v diseño, th fondo, l idioma,
// rk rango y MMR, st estadísticas
export const OV_DEFAULTS = { n: 10, m: 'pub', v: 'full', th: 'dark', l: 'en', rk: 1, st: 1 };
export function ovOptions(search) {
  const q = new URLSearchParams(search || '');
  const pick = (k, ok) => { const v = q.get(k); return v != null && ok.includes(v) ? v : OV_DEFAULTS[k]; };
  return {
    n: Number(pick('n', ['5', '10', '20'])), m: pick('m', ['pub', 'cus', 'all']), v: pick('v', ['full', 'compact']),
    th: pick('th', ['dark', 'light', 'clear']), l: pick('l', OV_LANGS), rk: q.get('rk') === '0' ? 0 : 1, st: q.get('st') === '0' ? 0 : 1,
  };
}
export function ovQuery(o) {
  const q = new URLSearchParams();
  for (const k of Object.keys(OV_DEFAULTS)) if (o[k] !== OV_DEFAULTS[k]) q.set(k, String(o[k]));
  const s = q.toString(); return s ? '?' + s : '';
}
// tamaño recomendado para la fuente de navegador de OBS
export const ovSize = (o) => (o.v === 'compact' ? { w: 720, h: 90 } : { w: 500, h: o.st ? 250 : 200 });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rcls = (r) => (r >= 9 ? 'elite' : r >= 8 ? 'great' : r >= 7 ? 'good' : r >= 6.5 ? 'ok' : r >= 6 ? 'meh' : 'bad');
function hue(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 360; }
const initials = (n) => { const s = String(n || '?').replace(/[^\p{L}\p{N}]/gu, ''); return (s[0] || '?') + (s[1] || ''); };

// Cálculos sobre los últimos partidos del tipo elegido (los partidos vienen del más nuevo al más viejo)
export function ovStats(P, o) {
  const all = (P._g || (P.games || []).map(gameObj)).filter((g) => (o.m === 'all' ? true : o.m === 'cus' ? g.y === 'custom' : g.y !== 'custom'));
  const L = all.slice(0, o.n), k = L.length;
  const sum = (f) => L.reduce((s, g) => s + (f(g) || 0), 0);
  const w = L.filter((g) => g.r === 'W').length, l = L.filter((g) => g.r === 'L').length;
  let streak = 0; const r0 = L[0] && L[0].r;
  if (r0 === 'W' || r0 === 'L') for (const g of L) { if (g.r === r0) streak++; else break; }
  // MMR: el de ahora y cuánto ha cambiado desde el primero de estos partidos (historial de rango del robot)
  const meta = P.meta || {}, rh = Array.isArray(meta.rh) ? meta.rh : [];
  let dm = null;
  if (meta.mmr != null && rh.length && k) {
    const t0 = L[k - 1].t; let base = null;
    for (const p of rh) { if (p[0] <= t0) base = p[1]; else break; }
    if (base == null) base = rh[0][1];
    dm = meta.mmr - base;
  }
  return { L, k, avg: k ? sum((g) => g.rt) / k : null, w, l, winp: k ? w / k : null, g: k ? sum((g) => g.st.goals) / k : null, a: k ? sum((g) => g.st.assists) / k : null, mvp: sum((g) => (g.mv ? 1 : 0)), streak: r0 === 'L' ? -streak : streak, dm };
}

export function renderOverlay(P, o, opts = {}) {
  const T = TX[o.l] || TX.en, loc = LOCS[o.l] || 'en-GB';
  const n1 = (x) => new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.round(x * 10) / 10);
  const int = (x) => new Intl.NumberFormat(loc).format(Math.round(x));
  const pct = (x) => { const v = Math.round(x * 100); return o.l === 'tr' ? '%' + v : o.l === 'en' || o.l === 'pt' ? v + '%' : v + ' %'; };
  const cls = `ov ov-${o.v} ov-${o.th}`;
  const brand = `<span class="ov-brand"><i class="ov-puck"></i>SlapScore</span>`;
  if (!P) return `<div class="${cls} ov-msg">${brand}<span>${esc(opts.noid ? T.noid : T.nf)}</span></div>`;
  const s = ovStats(P, o), meta = P.meta || {};
  const rk = parseRank(meta.rk), src = rk ? officialSrc(meta.rk, 64) : null;
  const pic = src ? `<img class="ov-emb" src="${esc(src)}" alt="">` : `<span class="ov-av" style="--h:${hue(P.id || P.n)}">${esc(initials(P.n))}</span>`;
  const mmr = o.rk && meta.mmr != null ? `<span class="ov-mmr">${rk && o.v !== 'compact' ? esc(meta.rank || rk.name) + ' · ' : ''}<b>${int(meta.mmr)}</b> MMR${s.dm ? ` <em class="${s.dm > 0 ? 'up' : 'down'}">${s.dm > 0 ? '▲' : '▼'} ${int(Math.abs(s.dm))}</em>` : ''}</span>` : '';
  const chips = s.L.slice(0, 10).map((g, i) => `<span class="ov-chip ${g.r === 'W' ? 'w' : g.r === 'L' ? 'l' : 'd'}${i === 0 && opts.fresh ? ' new' : ''}"><b class="rt ${rcls(g.rt)}">${n1(g.rt)}</b><i></i></span>`).join('');
  const avg = s.avg != null ? `<span class="ov-big rt ${rcls(s.avg)}">${n1(s.avg)}</span>` : `<span class="ov-big rt none">–</span>`;
  const mode = o.m === 'pub' ? '' : `<span class="ov-tag">${esc(o.m === 'cus' ? T.cus : T.all)}</span>`;
  const last = T.last.replace('{n}', o.n);
  if (o.v === 'compact') {
    return `<div class="${cls}">${pic}<div class="ov-id"><b class="ov-name">${esc(P.n)}</b>${mmr || `<span class="ov-mmr">${esc(last)}</span>`}</div>
      <div class="ov-avg">${avg}<small>${esc(T.avg)}</small></div>
      <div class="ov-chips">${chips || `<span class="ov-none">${esc(T.none)}</span>`}</div></div>`;
  }
  const streak = s.streak ? `<span class="ov-streak ${s.streak > 0 ? 'w' : 'l'}">${s.streak > 0 ? T.W : T.L}${Math.abs(s.streak)}</span>` : '';
  const stats = o.st && s.k ? `<div class="ov-stats">
      <div><b>${s.w}-${s.l}</b><small>${esc(T.wl)}</small></div><div><b>${pct(s.winp)}</b><small>${esc(T.win)}</small></div>
      <div><b>${n1(s.g)}</b><small>${esc(T.g)}</small></div><div><b>${n1(s.a)}</b><small>${esc(T.a)}</small></div><div><b>${int(s.mvp)}</b><small>${esc(T.mvp)}</small></div></div>` : '';
  return `<div class="${cls}">
    <div class="ov-top">${brand}${mode}<span class="ov-last">${esc(last)}</span></div>
    <div class="ov-main">${pic}<div class="ov-id"><b class="ov-name">${esc(P.n)}</b>${mmr}</div><div class="ov-avg">${avg}<small>${esc(T.avg)}</small></div></div>
    <div class="ov-row"><div class="ov-chips">${chips || `<span class="ov-none">${esc(T.none)}</span>`}</div>${streak}</div>
    ${stats}</div>`;
}

// ---------- la página para OBS ----------
async function gunzipText(buf) {
  if (typeof DecompressionStream === 'function') return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const z = await import('./vendor/gunzip.js'); return z.strFromU8(z.gunzipSync(buf));
}
async function fetchPlayer(pid) {
  const r = await fetch(`/data/p/${bucketOf(pid)}.json.gz?v=${Date.now()}`, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  const j = JSON.parse(buf[0] === 0x1f && buf[1] === 0x8b ? await gunzipText(buf) : new TextDecoder().decode(buf));
  return j[pid] || null;
}
export async function boot() {
  const o = ovOptions(location.search);
  const m = /^\/overlay\/(\d{1,12})\/?$/.exec(location.pathname), pid = m ? m[1] : new URLSearchParams(location.search).get('p');
  document.documentElement.lang = o.l;
  const root = document.getElementById('ov');
  if (!pid || !/^\d{1,12}$/.test(pid)) { root.innerHTML = renderOverlay(null, o, { noid: true }); return; }
  try { setOfficial(await (await fetch('/assets/ranks/index.json?v=' + Date.now(), { cache: 'no-store' })).json()); } catch {}
  let lastId = null, lastJson = '';
  async function tick() {
    try {
      const P = await fetchPlayer(pid);
      const top = P && P.games && P.games[0] ? P.games[0][1] : null;
      const json = P ? JSON.stringify([P.meta, P.games && P.games.slice(0, 25)]) : 'null';
      if (json !== lastJson) { root.innerHTML = renderOverlay(P, o, { fresh: lastId != null && top !== lastId }); lastJson = json; lastId = top; }
    } catch { /* sin conexión: se queda lo último que se vio */ }
  }
  await tick();
  // la web se actualiza cada 3-4 minutos; aquí se mira cada minuto (y al volver a la escena)
  setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
