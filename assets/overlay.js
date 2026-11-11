// Overlays para OBS, para ponerlos en un directo. La página /overlay/... (overlay.html + overlay-page.js) los dibuja
// sobre fondo transparente y se actualiza sola; la web usa las funciones render…() para la vista previa de los
// configuradores (obs.js). Lo que enseña cada dirección:
//   /overlay/<id>                     un jugador: las notas de sus últimos partidos y su nota media
//   /overlay/<id>,<id>,...            varios jugadores que van rotando (r = segundos con cada uno)
//   /overlay/match/<id>               el último partido de ese jugador: marcador, notas y MVP
//   /overlay/match/<AAAAMMDDHH>-<partido>   un partido concreto
//   /overlay/vs?t1=<ids>&t2=<ids>     dos equipos frente a frente, con la nota media de cada jugador
//   /overlay/s/<clave>                enlace fijo: enseña lo que haya guardado su dueño (cualquiera de los anteriores) Ligero a propósito: no carga la web
// entera ni los diccionarios (sus textos van aquí, en los 6 idiomas).
import { bucketOf, gameObj, parseRank } from './core.js';
import { setOfficial, officialSrc } from './emblems.js';

export const OV_LANGS = ['en', 'es', 'fr', 'de', 'pt', 'tr'];
const LOCS = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', tr: 'tr-TR' };
const TX = {
  en: { home: 'Home', away: 'Away', fin: 'Final', tavg: 'Team average', nm: 'Match not found', gone: 'This link no longer exists', avg: 'Avg rating', last: 'Last {n} matches', sel: '{n} matches', wl: 'W-L', win: 'Win %', g: 'G/GP', a: 'A/GP', mvp: 'MVP', pub: 'Public', cus: 'Custom', all: 'All', none: 'No matches yet', nf: 'Player not found', noid: 'Missing player ID', W: 'W', L: 'L', D: 'D' },
  es: { home: 'Local', away: 'Visitante', fin: 'Final', tavg: 'Media del equipo', nm: 'Partido no encontrado', gone: 'Este enlace ya no existe', avg: 'Nota media', last: 'Últimos {n} partidos', sel: '{n} partidos', wl: 'V-D', win: '% V', g: 'G/PJ', a: 'A/PJ', mvp: 'MVP', pub: 'Públicas', cus: 'Custom', all: 'Todas', none: 'Sin partidos todavía', nf: 'Jugador no encontrado', noid: 'Falta el ID del jugador', W: 'V', L: 'D', D: 'E' },
  fr: { home: 'Domicile', away: 'Extérieur', fin: 'Final', tavg: 'Moyenne de l’équipe', nm: 'Match introuvable', gone: 'Ce lien n’existe plus', avg: 'Note moyenne', last: '{n} derniers matchs', sel: '{n} matchs', wl: 'V-D', win: '% V', g: 'B/MJ', a: 'A/MJ', mvp: 'MVP', pub: 'Publiques', cus: 'Custom', all: 'Toutes', none: 'Aucun match pour le moment', nf: 'Joueur introuvable', noid: "ID du joueur manquant", W: 'V', L: 'D', D: 'N' },
  de: { home: 'Heim', away: 'Gast', fin: 'Endstand', tavg: 'Teamschnitt', nm: 'Spiel nicht gefunden', gone: 'Diesen Link gibt es nicht mehr', avg: 'Ø Note', last: 'Letzte {n} Spiele', sel: '{n} Spiele', wl: 'S-N', win: '% S', g: 'T/SP', a: 'V/SP', mvp: 'MVP', pub: 'Öffentlich', cus: 'Custom', all: 'Alle', none: 'Noch keine Spiele', nf: 'Spieler nicht gefunden', noid: 'Spieler-ID fehlt', W: 'S', L: 'N', D: 'U' },
  pt: { home: 'Casa', away: 'Fora', fin: 'Final', tavg: 'Média da equipe', nm: 'Partida não encontrada', gone: 'Este link não existe mais', avg: 'Nota média', last: 'Últimas {n} partidas', sel: '{n} partidas', wl: 'V-D', win: '% V', g: 'G/PJ', a: 'A/PJ', mvp: 'MVP', pub: 'Públicas', cus: 'Custom', all: 'Todas', none: 'Ainda sem partidas', nf: 'Jogador não encontrado', noid: 'Falta o ID do jogador', W: 'V', L: 'D', D: 'E' },
  tr: { home: 'Ev sahibi', away: 'Deplasman', fin: 'Maç sonu', tavg: 'Takım ortalaması', nm: 'Maç bulunamadı', gone: 'Bu bağlantı artık yok', avg: 'Ort. not', last: 'Son {n} maç', sel: '{n} maç', wl: 'G-M', win: 'G %', g: 'G/OM', a: 'A/OM', mvp: 'MVP', pub: 'Açık', cus: 'Özel', all: 'Tümü', none: 'Henüz maç yok', nf: 'Oyuncu bulunamadı', noid: 'Oyuncu ID\'si eksik', W: 'G', L: 'M', D: 'B' },
};

// Opciones (todas van en la dirección, para que OBS las recuerde): n partidos, m tipo, v diseño, th fondo, l idioma,
// rk rango y MMR, st estadísticas, d fecha debajo de cada partido.
// Y qué partidos cuentan: k = los partidos elegidos (p. ej. los de una liga) y a = añadir además, solos, los que se
// jueguen después de ese momento (segundos en base 36). Con k sin a, la selección queda fija; con a, cuentan como mucho
// los últimos n. (x = partidos quitados de «los últimos n»: lo usaban los primeros enlaces y sigue valiendo.)
// Cada partido se nombra con los 8 primeros caracteres de su identificador, separados por puntos.
export const OV_DEFAULTS = { n: 10, m: 'pub', v: 'full', th: 'dark', l: 'en', rk: 1, st: 1, d: 0 };
export const OV_MAX_PICK = 40;
export const ovKey = (g) => String((g && g.i) || '').slice(0, 8).toLowerCase();
// momento desde el que un partido es «nuevo» para un enlace: justo después del último que se conoce
export const ovNewest = (P) => Math.ceil(((P.games || []).reduce((m, g) => Math.max(m, Number(g[2]) || 0), 0) || Date.now()) / 1000);
const since = (v) => { const n = parseInt(String(v || ''), 36); return Number.isFinite(n) && n > 1.5e9 && n < 4e9 ? n : 0; };
const pickList = (v) => [...new Set(String(v || '').toLowerCase().split(/[^0-9a-z]+/).filter((x) => /^[0-9a-z]{8}$/.test(x)))].slice(0, OV_MAX_PICK);
export function ovOptions(search) {
  const q = new URLSearchParams(search || '');
  const pick = (k, ok) => { const v = q.get(k); return v != null && ok.includes(v) ? v : OV_DEFAULTS[k]; };
  return {
    n: Number(pick('n', ['5', '10', '20'])), m: pick('m', ['pub', 'cus', 'all']), v: pick('v', ['full', 'compact']),
    th: pick('th', ['dark', 'light', 'clear']), l: pick('l', OV_LANGS), rk: q.get('rk') === '0' ? 0 : 1, st: q.get('st') === '0' ? 0 : 1,
    d: q.get('d') === '1' ? 1 : 0, x: pickList(q.get('x')), k: pickList(q.get('k')), a: since(q.get('a')),
  };
}
export function ovQuery(o) {
  const q = new URLSearchParams();
  for (const k of Object.keys(OV_DEFAULTS)) if (o[k] !== OV_DEFAULTS[k]) q.set(k, String(o[k]));
  if ((o.k && o.k.length) || o.a) { if (o.k && o.k.length) q.set('k', o.k.slice(0, OV_MAX_PICK).join('.')); if (o.a) q.set('a', Number(o.a).toString(36)); }
  else if (o.x && o.x.length) q.set('x', o.x.slice(0, OV_MAX_PICK).join('.'));
  const s = q.toString(); return s ? '?' + s : '';
}
// tamaño recomendado para la fuente de navegador de OBS
// tamaño de la ventana flotante (sin márgenes)
export const ovWinSize = (o) => (o.v === 'compact' ? { w: 620, h: 72 + (o.d ? 12 : 0) } : { w: 480, h: (o.st ? 216 : 162) + (o.d ? 16 : 0) });
export const ovSize = (o) => (o.v === 'compact' ? { w: 720, h: o.d ? 100 : 90 } : { w: 500, h: (o.st ? 250 : 200) + (o.d ? 16 : 0) });

// ---------- qué enseña una dirección ----------
export const OV_ROT = 10;   // segundos con cada jugador, si rotan
const idList = (v) => [...new Set(String(v || '').split(',').filter((x) => /^\d{1,12}$/.test(x)))].slice(0, 8);
const rot = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 5 && n <= 120 ? Math.round(n) : OV_ROT; };
// nombres de equipo que escribe quien configura: cortos y sin nada raro (al dibujarlos se escapan igualmente)
export const ovName = (v) => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
export function ovSpec(pathname, search) {
  const q = new URLSearchParams(search || ''), o = ovOptions(search);
  const p = String(pathname || '').replace(/\/+$/, ''), names = { n1: ovName(q.get('n1')), n2: ovName(q.get('n2')) };
  const type = (d) => (['pub', 'cus', 'all'].includes(q.get('m')) ? q.get('m') : d);
  let m;
  if ((m = /^\/overlay\/s\/([a-z0-9]{8})$/.exec(p))) return { kind: 'saved', sid: m[1], o };
  if (p === '/overlay/vs') return { kind: 'vs', t1: idList(q.get('t1')), t2: idList(q.get('t2')), ...names, o };
  if ((m = /^\/overlay\/match\/(\d{1,12})$/.exec(p))) return { kind: 'match', pid: m[1], ...names, o: { ...o, m: type('all') } };
  if ((m = /^\/overlay\/match\/(\d{4})(\d\d)(\d\d)(\d\d)-([0-9a-f-]{8,40})$/.exec(p))) return { kind: 'match', key: `${m[1]}-${m[2]}-${m[3]}/${m[4]}`, mid: m[5], ...names, o };
  if ((m = /^\/overlay\/(\d{1,12}(?:,\d{1,12}){1,7})$/.exec(p)) && idList(m[1]).length > 1) return { kind: 'team', ids: idList(m[1]), r: rot(q.get('r')), o };
  if ((m = /^\/overlay\/(\d{1,12})(?:,|$)/.exec(p))) return { kind: 'player', pid: m[1], o };
  const pid = q.get('p'); if (pid && /^\d{1,12}$/.test(pid)) return { kind: 'player', pid, o };
  return { kind: 'none', o };
}
// La dirección (ruta y opciones) de lo que describe spec: la usan los configuradores
export function ovHref(spec) {
  const o = spec.o, q = new URLSearchParams(), put = (k, v, d) => { if (v != null && v !== '' && v !== d) q.set(k, String(v)); };
  const look = () => { put('th', o.th, OV_DEFAULTS.th); put('l', o.l, OV_DEFAULTS.l); }, names = () => { put('n1', ovName(spec.n1), ''); put('n2', ovName(spec.n2), ''); };
  const end = (path) => { const s = q.toString(); return path + (s ? '?' + s : ''); };
  if (spec.kind === 'player') return `/overlay/${spec.pid}${ovQuery(o)}`;
  if (spec.kind === 'team') { for (const k of Object.keys(OV_DEFAULTS)) put(k, o[k], OV_DEFAULTS[k]); put('r', spec.r, OV_ROT); return end(`/overlay/${spec.ids.join(',')}`); }
  if (spec.kind === 'match') { if (spec.pid) put('m', o.m, 'all'); look(); names(); return end(spec.pid ? `/overlay/match/${spec.pid}` : `/overlay/match/${String(spec.key).replace(/[-/]/g, '')}-${spec.mid}`); }
  if (spec.kind === 'vs') { q.set('t1', spec.t1.join(',')); q.set('t2', spec.t2.join(',')); put('n', o.n, OV_DEFAULTS.n); put('m', o.m, OV_DEFAULTS.m); look(); names(); return end('/overlay/vs').replace(/%2C/g, ','); }
  if (spec.kind === 'saved') return `/overlay/s/${spec.sid}`;
  return '/overlay';
}
// tamaño recomendado para la fuente de navegador de OBS, según lo que se enseñe (rows: jugadores del equipo más largo)
export function ovSizeOf(spec, rows = 3) {
  if (spec.kind === 'match' || spec.kind === 'vs') return { w: 580, h: 130 + 32 * Math.max(1, Math.min(8, rows)) };
  return ovSize(spec.o);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rcls = (r) => (r >= 9 ? 'elite' : r >= 8 ? 'great' : r >= 7 ? 'good' : r >= 6.5 ? 'ok' : r >= 6 ? 'meh' : 'bad');
function hue(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 360; }
const initials = (n) => { const s = String(n || '?').replace(/[^\p{L}\p{N}]/gu, ''); return (s[0] || '?') + (s[1] || ''); };

// Partidos del tipo elegido, del más nuevo al más viejo (los que se pueden elegir en el configurador)
export const ovGames = (P, m) => (P._g || (P.games || []).map(gameObj)).filter((g) => (m === 'all' ? true : m === 'cus' ? g.y === 'custom' : g.y !== 'custom'));
const ofType = (g, m) => (m === 'all' ? true : m === 'cus' ? g.y === 'custom' : g.y !== 'custom');
// Cálculos sobre los partidos que cuentan:
//   · lo normal: los últimos n del tipo elegido (sin los quitados con x);
//   · con partidos elegidos (k): solo esos, sean del tipo que sean;
//   · con «a»: además, los del tipo elegido jugados después de ese momento, y como mucho los últimos n.
export function ovStats(P, o) {
  const fixed = !!((o.k && o.k.length) || o.a), X = new Set(fixed ? o.k || [] : o.x || []);
  const all = ovGames(P, fixed ? 'all' : o.m), a = (Number(o.a) || 0) * 1000;
  const L = fixed ? all.filter((g) => X.has(ovKey(g)) || (a && g.t > a && ofType(g, o.m))).slice(0, a ? o.n : OV_MAX_PICK)
    : (X.size ? all.filter((g) => !X.has(ovKey(g))) : all).slice(0, o.n), k = L.length;
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
  return { L, k, fixed, avg: k ? sum((g) => g.rt) / k : null, w, l, winp: k ? w / k : null, g: k ? sum((g) => g.st.goals) / k : null, a: k ? sum((g) => g.st.assists) / k : null, mvp: sum((g) => (g.mv ? 1 : 0)), streak: r0 === 'L' ? -streak : streak, dm };
}

export function renderOverlay(P, o, opts = {}) {
  const T = TX[o.l] || TX.en, loc = LOCS[o.l] || 'en-GB';
  const n1 = (x) => new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.round(x * 10) / 10);
  const int = (x) => new Intl.NumberFormat(loc).format(Math.round(x));
  const pct = (x) => { const v = Math.round(x * 100); return o.l === 'tr' ? '%' + v : o.l === 'en' || o.l === 'pt' ? v + '%' : v + ' %'; };
  const cls = `ov ov-${o.v} ov-${o.th}${o.d ? ' ov-dates' : ''}`;
  const brand = `<span class="ov-brand"><i class="ov-puck"></i>SlapScore</span>`;
  if (!P) return `<div class="${cls} ov-msg">${brand}<span>${esc(opts.noid ? T.noid : T.nf)}</span></div>`;
  const s = ovStats(P, o), meta = P.meta || {};
  const rk = parseRank(meta.rk), src = rk ? officialSrc(meta.rk, 64) : null;
  const pic = src ? `<img class="ov-emb" src="${esc(src)}" alt="">` : `<span class="ov-av" style="--h:${hue(P.id || P.n)}">${esc(initials(P.n))}</span>`;
  const mmr = o.rk && meta.mmr != null ? `<span class="ov-mmr">${rk && o.v !== 'compact' ? esc(meta.rank || rk.name) + ' · ' : ''}<b>${int(meta.mmr)}</b> MMR${s.dm ? ` <em class="${s.dm > 0 ? 'up' : 'down'}">${s.dm > 0 ? '▲' : '▼'} ${int(Math.abs(s.dm))}</em>` : ''}</span>` : '';
  // fecha corta debajo de cada partido («8 Nov»), en la hora de quien lo ve
  const DF = o.d ? new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' }) : null;
  const day = (ms) => { const p = DF.formatToParts(new Date(ms)), f = (t) => (p.find((x) => x.type === t) || {}).value || ''; return `${f('day')} ${f('month').replace(/\./g, '')}`; };
  const chips = s.L.slice(0, 10).map((g, i) => `<span class="ov-chip ${g.r === 'W' ? 'w' : g.r === 'L' ? 'l' : 'd'}${i === 0 && opts.fresh ? ' new' : ''}"><b class="rt ${rcls(g.rt)}">${n1(g.rt)}</b><i></i>${DF ? `<small class="ov-d">${esc(day(g.t))}</small>` : ''}</span>`).join('');
  const avg = s.avg != null ? `<span class="ov-big rt ${rcls(s.avg)}">${n1(s.avg)}</span>` : `<span class="ov-big rt none">–</span>`;
  const mode = o.m === 'pub' ? '' : `<span class="ov-tag">${esc(o.m === 'cus' ? T.cus : T.all)}</span>`;
  const last = s.fixed ? T.sel.replace('{n}', s.k) : T.last.replace('{n}', o.n);
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

// ---------- varios jugadores que rotan ----------
// Todas las tarjetas van apiladas en el mismo hueco y solo se ve una (la página va cambiando cuál)
export function renderTeam(list, o, idx = 0) {
  const ok = list.filter(Boolean);
  if (!ok.length) return renderOverlay(null, o);
  return `<div class="ov-rot">${ok.map((P, i) => `<div class="ov-slide${i === idx % ok.length ? ' on' : ''}">${renderOverlay(P, o)}</div>`).join('')}</div>`;
}

// ---------- partido: marcador, notas y MVP ----------
// De la ficha resumida de un partido (la de los archivos de cada día) a lo que hace falta para dibujarlo
export function matchOf(e) {
  if (!e || !Array.isArray(e.p) || !Array.isArray(e.s)) return null;
  return { id: e.i, t: e.t, type: e.y, format: e.f, ot: !!e.o, score: [e.s[0], e.s[1]], winner: e.w, mvp: e.v,
    players: e.p.map((p) => ({ pid: p[0], name: p[1], team: p[2] === 0 ? 0 : 1, rating: p[3], g: p[4] || 0, a: p[5] || 0, rk: p[6] || '' })) };
}
function fmt(o) {
  const loc = LOCS[o.l] || 'en-GB';
  return { T: TX[o.l] || TX.en, loc, n1: (x) => new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.round(x * 10) / 10) };
}
const brandHTML = `<span class="ov-brand"><i class="ov-puck"></i>SlapScore</span>`;
const emb = (rk, name, id) => { const src = parseRank(rk) ? officialSrc(rk, 64) : null; return src ? `<img class="ov-emb" src="${esc(src)}" alt="">` : `<span class="ov-av" style="--h:${hue(id || name)}">${esc(initials(name))}</span>`; };
const shortDay = (ms, loc) => { const p = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' }).formatToParts(new Date(ms)), f = (t) => (p.find((x) => x.type === t) || {}).value || ''; return `${f('day')} ${f('month').replace(/\./g, '')}`; };
// una fila de jugador: emblema, nombre, dato pequeño y nota
const plRow = (p, extra, rt, cls = '') => `<div class="ov-pl${cls}">${emb(p.rk, p.name, p.pid)}<span class="nm">${esc(p.name)}</span>${extra}${rt}</div>`;
export function renderMatch(M, o, names = {}) {
  const { T, loc, n1 } = fmt(o), cls = `ov ov-duel ov-${o.th}`;
  if (!M) return `<div class="${cls} ov-msg">${brandHTML}<span>${esc(T.nm)}</span></div>`;
  const side = (tm) => M.players.map((p, i) => ({ ...p, i })).filter((p) => p.team === tm).sort((a, b) => b.rating - a.rating)
    .map((p) => plRow(p, `<span class="x">${p.g || p.a ? `${p.g}G ${p.a}A` : ''}</span>`, `<b class="rt ${rcls(p.rating)}">${n1(p.rating)}</b>`, p.i === M.mvp ? ' mvp' : '')).join('');
  const lose = (tm) => (M.winner === 0 || M.winner === 1) && M.winner !== tm ? ' lose' : '';
  const tag = [M.type === 'custom' ? T.cus : '', M.format].filter(Boolean).join(' ');
  return `<div class="${cls}">
    <div class="ov-top">${brandHTML}${tag ? `<span class="ov-tag">${esc(tag)}</span>` : ''}<span class="ov-last">${esc(T.fin)}${M.ot ? ' · OT' : ''}${M.t ? ' · ' + esc(shortDay(M.t, loc)) : ''}</span></div>
    <div class="ov-sb"><b class="ov-tn">${esc(ovName(names.n1) || T.home)}</b><span class="ov-sc"><b class="${lose(0).trim()}">${esc(M.score[0])}</b><i>–</i><b class="${lose(1).trim()}">${esc(M.score[1])}</b></span><b class="ov-tn r">${esc(ovName(names.n2) || T.away)}</b></div>
    <div class="ov-teams"><div class="ov-tm">${side(0)}</div><div class="ov-tm r">${side(1)}</div></div></div>`;
}

// ---------- dos equipos frente a frente ----------
// A y B: listas de jugadores (los que no existen llegan como null y no salen)
export function renderVs(A, B, o, names = {}) {
  const { T, n1 } = fmt(o), cls = `ov ov-duel ov-${o.th}`;
  const team = (list) => { const rows = list.filter(Boolean).map((P) => ({ P, s: ovStats(P, { ...o, x: [], k: [], a: 0 }) })); const r = rows.filter((x) => x.s.avg != null); return { rows, avg: r.length ? r.reduce((t, x) => t + x.s.avg, 0) / r.length : null }; };
  const a = team(A), b = team(B);
  if (!a.rows.length && !b.rows.length) return `<div class="${cls} ov-msg">${brandHTML}<span>${esc(T.nf)}</span></div>`;
  const side = (tm) => tm.rows.sort((x, y) => (y.s.avg ?? -1) - (x.s.avg ?? -1)).map(({ P, s }) => plRow({ rk: (P.meta || {}).rk, name: P.n, pid: P.id }, `<span class="x">${s.k ? `${s.w}-${s.l}` : ''}</span>`, s.avg != null ? `<b class="rt ${rcls(s.avg)}">${n1(s.avg)}</b>` : `<b class="rt none">–</b>`)).join('');
  const big = (v) => (v != null ? `<b class="rt ${rcls(v)}">${n1(v)}</b>` : `<b class="rt none">–</b>`);
  const mode = o.m === 'pub' ? '' : `<span class="ov-tag">${esc(o.m === 'cus' ? T.cus : T.all)}</span>`;
  return `<div class="${cls} ov-vs">
    <div class="ov-top">${brandHTML}${mode}<span class="ov-last">${esc(T.avg)} · ${esc(T.last.replace('{n}', o.n))}</span></div>
    <div class="ov-sb"><b class="ov-tn">${esc(ovName(names.n1) || T.home)}</b><span class="ov-sc avg">${big(a.avg)}<i>VS</i>${big(b.avg)}</span><b class="ov-tn r">${esc(ovName(names.n2) || T.away)}</b></div>
    <div class="ov-teams"><div class="ov-tm">${side(a)}</div><div class="ov-tm r">${side(b)}</div></div></div>`;
}

// ---------- la página para OBS ----------
async function gunzipText(buf) {
  if (typeof DecompressionStream === 'function') return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const z = await import('./vendor/gunzip.js'); return z.strFromU8(z.gunzipSync(buf));
}
// JSON (comprimido o no) sin caché; null si no existe
async function getData(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  return JSON.parse(buf[0] === 0x1f && buf[1] === 0x8b ? await gunzipText(buf) : new TextDecoder().decode(buf));
}
export async function fetchPlayer(pid) {
  const j = await getData(`/data/p/${bucketOf(pid)}.json.gz?v=${Date.now()}`);
  return (j && j[pid]) || null;
}
// varios jugadores de una vez: un archivo por grupo, aunque compartan
export async function fetchPlayers(ids) {
  const files = new Map();
  for (const id of ids) { const b = bucketOf(id); if (!files.has(b)) files.set(b, getData(`/data/p/${b}.json.gz?v=${Date.now()}`)); }
  return Promise.all(ids.map(async (id) => { const j = await files.get(bucketOf(id)); return (j && j[id]) || null; }));
}
// La ficha resumida de un partido: está en el archivo de su día y su hora
const inChunk = (c, hh) => c === 'all' || c === hh || (c.includes('-') && hh <= c.slice(0, 2) && hh >= c.slice(3, 5));
export async function fetchMatch(key, id) {
  const d = key.slice(0, 10), hh = key.slice(11);
  const meta = await getData(`/data/days/${d}.json?v=${Date.now()}`); if (!meta) return null;
  const c = (meta.chunks || []).find((x) => inChunk(x.c, hh)); if (!c) return null;
  const list = await getData(`/data/days/${d}/${c.c}.json.gz?v=${encodeURIComponent(c.v || '')}`);
  return (list || []).find((x) => x.i === id || (x.pd && x.pd.some((y) => y.i === id))) || null;
}
// Lo que hay que dibujar ahora para una dirección. st guarda lo que se recuerda entre una mirada y la siguiente.
async function frame(spec, st) {
  const o = spec.o;
  if (spec.kind === 'player') {
    const P = await fetchPlayer(spec.pid), top = P && P.games && P.games[0] ? P.games[0][1] : null;
    const fresh = st.top !== undefined && top !== st.top && st.pid === spec.pid; st.top = top; st.pid = spec.pid; st.title = P ? P.n : '';
    return renderOverlay(P, o, { fresh });
  }
  if (spec.kind === 'team') return renderTeam(await fetchPlayers(spec.ids), o, st.idx);
  if (spec.kind === 'vs') { const all = await fetchPlayers([...spec.t1, ...spec.t2]); return renderVs(all.slice(0, spec.t1.length), all.slice(spec.t1.length), o, spec); }
  if (spec.kind === 'match') {
    let key = spec.key, mid = spec.mid;
    if (spec.pid) { const P = await fetchPlayer(spec.pid), g = P ? ovGames(P, o.m)[0] : null; if (!g) return renderMatch(null, o); key = g.k; mid = g.i; }
    // un partido terminado no cambia: se pide una vez
    if (!st.match || st.match.id !== mid) { const e = await fetchMatch(key, mid); st.match = { id: mid, M: matchOf(e) }; }
    return renderMatch(st.match.M, o, spec);
  }
  return renderOverlay(null, o, { noid: true });
}
export async function boot() {
  const base = ovSpec(location.pathname, location.search), o = base.o;
  document.documentElement.lang = o.l;
  const root = document.getElementById('ov');
  // ?win: ventana pequeña normal (navegadores sin ventana siempre encima): con fondo y ajustada al tamaño de la ventana
  const asWin = new URLSearchParams(location.search).has('win');
  if (asWin) { document.body.classList.add('ov-win', 'ov-win-' + o.th); addEventListener('resize', () => fitWin(window, root)); }
  if (base.kind === 'none') { root.innerHTML = renderOverlay(null, o, { noid: true }); return; }
  try { setOfficial(await (await fetch('/assets/ranks/index.json?v=' + Date.now(), { cache: 'no-store' })).json()); } catch {}
  const st = { html: '', idx: 0, r: base.r || OV_ROT, saved: null, savedAt: 0 };
  const show = (html) => { if (html === st.html) return; root.innerHTML = html; st.html = html; if (asWin) { document.title = (st.title ? st.title + ' · ' : '') + 'SlapScore'; fitWin(window, root); } };
  async function tick(force) {
    try {
      let spec = base;
      if (base.kind === 'saved') {
        // enlace fijo: lo guardado se vuelve a pedir cada 3 minutos (o al volver a la escena)
        if (!st.saved || Date.now() - st.savedAt > (force ? 30_000 : 170_000)) {
          const r = await fetch('/api/ov/' + base.sid, { cache: 'no-store' });
          if (r.status === 404) st.saved = { kind: 'none' };
          else if (r.ok) { const u = String((await r.json()).u || ''), i = u.indexOf('?'); st.saved = ovSpec(i < 0 ? u : u.slice(0, i), i < 0 ? '' : u.slice(i)); }
          if (r.ok || r.status === 404) st.savedAt = Date.now();
        }
        if (!st.saved) return;
        if (st.saved.kind === 'none' || st.saved.kind === 'saved') { show(`<div class="ov ov-full ov-${o.th} ov-msg">${brandHTML}<span>${esc((TX[o.l] || TX.en).gone)}</span></div>`); return; }
        spec = st.saved; document.documentElement.lang = spec.o.l;
      }
      st.r = spec.r || OV_ROT;
      show(await frame(spec, st));
    } catch { /* sin conexión: se queda lo último que se vio */ }
  }
  await tick();
  // la web se actualiza cada 3-4 minutos; aquí se mira cada minuto (y al volver a la escena)
  setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(true); });
  // varios jugadores: cada r segundos se pasa al siguiente
  (function turn() {
    setTimeout(() => {
      const slides = root.querySelectorAll('.ov-slide');
      if (slides.length > 1) { st.idx = (st.idx + 1) % slides.length; slides.forEach((x, i) => x.classList.toggle('on', i === st.idx)); st.html = ''; }
      turn();
    }, Math.max(5, st.r) * 1000);
  })();
}

// ---------- ventana flotante (uso personal) ----------
// El overlay en una ventana pequeña que se queda encima de las demás (también del juego, si no está en pantalla
// completa exclusiva). La abre el perfil con la API «Document Picture-in-Picture» (Chrome y Edge de ordenador) y aquí
// se rellena y se mantiene al día; en los demás navegadores se abre /overlay/<id>?win como ventana normal.
// El contenido se escala para ocupar la ventana, se cambie al tamaño que se cambie.
export function fitWin(win, root) {
  const el = root.firstElementChild; if (!el) return;
  el.style.zoom = 1;
  const w = el.offsetWidth, h = el.offsetHeight; if (!w || !h) return;
  el.style.zoom = Math.max(0.3, Math.min(win.innerWidth / w, win.innerHeight / h));
}
export function mountFloat(win, P0, o, cssHref) {
  const d = win.document, origin = location.origin;
  d.title = `${P0.n} · SlapScore`; d.documentElement.lang = o.l; d.documentElement.className = 'ov-html';
  const link = d.createElement('link'); link.rel = 'stylesheet'; link.href = cssHref; d.head.appendChild(link);
  d.body.className = `ov-page ov-win ov-win-${o.th}`;
  const root = d.createElement('div'); root.id = 'ov'; d.body.appendChild(root);
  const fit = () => fitWin(win, root);
  const draw = (P, fresh) => { root.innerHTML = renderOverlay(P, o, { fresh }).replace(/src="\//g, `src="${origin}/`); fit(); };
  let lastId = P0.games && P0.games[0] ? P0.games[0][1] : null, lastJson = JSON.stringify([P0.meta, P0.games && P0.games.slice(0, 60)]);
  draw(P0, false);
  link.addEventListener('load', fit); win.addEventListener('resize', fit);
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(fit).catch(() => {});
  async function tick() {
    try {
      const P = await fetchPlayer(String(P0.id)); if (!P) return;
      const top = P.games && P.games[0] ? P.games[0][1] : null, json = JSON.stringify([P.meta, P.games && P.games.slice(0, 60)]);
      if (json !== lastJson) { draw(P, top !== lastId); lastJson = json; lastId = top; }
    } catch { /* sin conexión: se queda lo último */ }
  }
  // el reloj es el de la ventana flotante: está siempre a la vista, así que el navegador no lo frena
  const timer = win.setInterval(tick, 60_000);
  win.addEventListener('pagehide', () => win.clearInterval(timer));
  return { tick };
}
