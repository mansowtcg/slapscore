// Robot de SlapScore (v3, incremental).
// 1) Rastrea slapshot.gg jugador a jugador (últimos 10 partidos + rango/MMR) respetando su límite.
// 2) Añade solo lo nuevo: partidos en bruto por hora, resúmenes por hora, perfiles y totales por día.
// 3) Los partidos en bruto de más de N días salen de la web a un archivo (GitHub Releases);
//    los resúmenes, los perfiles y las estadísticas de carrera se conservan siempre.
//
// Estructura de data/ (lo que empieza por _int no se publica):
//   index.json                      índice: días con versión, totales, pasadas
//   days/<día>.json                 resumen del día: recuentos, líderes, mejores actuaciones, trozos
//   days/<día>/<HH>.json.gz         resúmenes de los partidos de esa hora ('all' si el día está archivado)
//                                   (las custom con periodos van en un solo resumen, con 'pd': cada periodo y las cifras de cada jugador)
//   full/<día>/<HH>.json.gz         partidos tal cual los da slapshot.gg (solo los últimos N días)
//   p/<bucket>.json.gz              perfiles de jugadores (2048 grupos)
//   search.json.gz, players-{a,m,k}.json.gz, rankings.json, top.json, attr.json
//   _int/state.json.gz              estado del robot
//   _int/agg/d/<día>.json.gz        totales de cada jugador ese día (base de las estadísticas de carrera):
//                                   { v: 2, p: {públicas}, c: {personalizadas} }, cada una { id: [totales en orden AGG_KEYS] }
//   _int/agg/m/<AAAA-MM>.json.gz    totales de un mes ya cerrado (mismo formato)
//   _int/outbox/<día>.json.gz       partidos en bruto pendientes de subir al archivo
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../assets/core.js';
import { readJSON, readText, list, exists, Writer, hash } from './io.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const INT = path.join(DATA, '_int');
const SETTINGS = process.env.SETTINGS_FILE ? path.resolve(process.env.SETTINGS_FILE) : path.join(ROOT, 'config', 'settings.json');
const API = process.env.API_BASE || 'https://slapshot.gg/api/game/players/';
const UA = 'SlapScoreBot/3.0 (+https://github.com/mansowtcg/slapscore)';

const BUDGET_MS = Number(process.env.TIME_BUDGET_MS ?? 8 * 60_000);
const MAX_REQ = Number(process.env.MAX_REQUESTS ?? 150);
const GAP_MS = Number(process.env.GAP_MS ?? 6700);       // ≤ 9 peticiones/min (límite de slapshot.gg: 10)
const NOW = process.env.NOW ? Date.parse(process.env.NOW) : Date.now(); // para pruebas
const CAP = 400;            // partidos por perfil
const H = 3_600_000, D = 24 * H;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastT = Date.now();
const lap = (label) => { if (process.env.DEBUG) { console.log(`  [${label}] ${Date.now() - lastT} ms`); } lastT = Date.now(); };
const out = new Writer();
const started = Date.now();

// ---------- ajustes ----------
const settings = await readJSON(SETTINGS, {});
const W = C.weightsFrom(settings.weights);
const wHash = hash(JSON.stringify(W));
const RETAIN = Math.max(35, Math.min(400, Number(settings.retainDays) || 60));
// seguidos: los de la lista y los supporters (apoyan el proyecto): sus partidos se buscan en cada pasada mientras juegan.
// Solo cambia lo pronto que aparecen sus partidos; las notas, tablas y rankings son iguales para todos.
const seeds = [...new Set([...(settings.seeds || []), ...(Array.isArray(settings.supporters) ? settings.supporters : [])].map(String))];
// Jugadores ocultos: han pedido no aparecer (privacidad). Sus partidos siguen, pero sin su nombre ni su ID:
// en su lugar sale «—», sin perfil, sin estadísticas y sin entrar en tablas, rankings ni récords.
const HIDDEN_NAME = '—';
const hidP = new Set((Array.isArray(settings.hiddenPlayers) ? settings.hiddenPlayers : []).map((x) => String(x).trim()).filter((x) => C.pidOf({ game_user_id: x })));
function anonRaw(raw) {
  let changed = false;
  const list = raw && raw.game_stats && Array.isArray(raw.game_stats.players) ? raw.game_stats.players : [];
  for (const pl of list) if (pl && hidP.has(C.pidOf(pl))) { pl.game_user_id = null; pl.username = HIDDEN_NAME; changed = true; }
  return changed;
}
const hiddenNow = new Map();   // id -> clave día/hora (si se conoce)
for (const h of (settings.hidden || []).map(String)) { const i = h.indexOf('|'); if (i >= 0) hiddenNow.set(h.slice(i + 1), /^\d{4}-\d\d-\d\d\/\d\d$/.test(h.slice(0, i)) ? h.slice(0, i) : null); else hiddenNow.set(h, null); }

// ---------- fechas (días de Madrid) ----------
const dayAdd = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * D).toISOString().slice(0, 10);
const TODAY = C.madrid(NOW).day;
const CUTOFF = dayAdd(TODAY, -(RETAIN - 1));     // días anteriores a este: en bruto solo en el archivo
const RECENT = dayAdd(TODAY, -1);                // hoy y ayer: se refrescan los rangos
const M30 = dayAdd(TODAY, -29), K7 = dayAdd(TODAY, -6);
const keyOf = (t) => { const m = C.madrid(t); return `${m.day}/${m.hour}`; };
const P = {
  raw: (key) => path.join(DATA, 'full', key.slice(0, 10), key.slice(11) + '.json.gz'),
  chunk: (day, c) => path.join(DATA, 'days', day, c + '.json.gz'),
  meta: (day) => path.join(DATA, 'days', day + '.json'),
  bucket: (b) => path.join(DATA, 'p', b + '.json.gz'),
  aggD: (day) => path.join(INT, 'agg', 'd', day + '.json.gz'),
  aggM: (m) => path.join(INT, 'agg', 'm', m + '.json.gz'),
  outbox: (day) => path.join(INT, 'outbox', day + '.json.gz'),
};

// ---------- estado ----------
let S = await readJSON(path.join(INT, 'state.json.gz'), null);
let legacy = null;   // migración desde el formato v2
if (!S) {
  S = { v: 3, players: {}, hid: {}, days: {}, wHash: null };
  const old = await readJSON(path.join(DATA, 'state.json'), null);
  if (old && old.players) S.players = old.players;
  legacy = [];
  for (const day of await list(path.join(DATA, 'full'))) for (const f of await list(path.join(DATA, 'full', day))) {
    if (f.endsWith('.json')) for (const raw of await readJSON(path.join(DATA, 'full', day, f), [])) legacy.push(raw);
  }
}
S.hid = S.hid || {}; S.days = S.days || {};
const players = S.players;
for (const pid of hidP) { delete players[pid]; if (S.pendGames) delete S.pendGames[pid]; if (S.streak) delete S.streak[pid]; if (S.cur) delete S.cur[pid]; }
for (const p of Object.values(players)) {
  if (!p.prk && p.prank) p.prk = C.rankKeyFromName(p.prank) || undefined;
  if (!p.rk && p.rank) p.rk = C.rankKeyFromName(p.rank) || undefined;
}
for (const id of seeds) { if (hidP.has(id)) continue; if (!players[id]) players[id] = { n: null, found: NOW }; players[id].seed = true; }
for (const [id, p] of Object.entries(players)) if (p.seed && !seeds.includes(id)) delete p.seed;
const isArchived = (day) => !!(S.days[day] && S.days[day].x) || day < CUTOFF;

// ---------- cachés de archivos ----------
const raws = new Map();     // clave día/hora -> { list, ids, dirty }
async function rawShard(key) {
  let s = raws.get(key);
  if (!s) { const l = await readJSON(P.raw(key), []); s = { list: l, ids: new Set(l.map((r) => r.id)), dirty: false }; raws.set(key, s); }
  return s;
}
const chunks = new Map();   // día/trozo -> { list, dirty }
// Trozo de resúmenes que contiene una hora: 'HH' en días recientes; en días archivados, bloques de varias horas ('23-18')
const inChunk = (c, hh) => c === 'all' || c === hh || (c.includes('-') && hh <= c.slice(0, 2) && hh >= c.slice(3, 5));
async function chunkId(key) {
  const day = key.slice(0, 10), hh = key.slice(11);
  if (!(S.days[day] && S.days[day].x)) return hh;
  for (const f of await list(path.join(DATA, 'days', day))) { const c = f.replace('.json.gz', ''); if (inChunk(c, hh)) return c; }
  return hh;
}
async function chunk(day, c) {
  const k = day + '/' + c;
  let s = chunks.get(k);
  if (!s) { s = { list: await readJSON(P.chunk(day, c), []), dirty: false }; chunks.set(k, s); }
  return s;
}
const dirtyDays = new Set();

// ---------- perfiles pendientes ----------
const pend = new Map();     // pid -> { add: [], rm: Set, rh: bool }
const touch = (pid) => { let x = pend.get(pid); if (!x) pend.set(pid, x = { add: [], rm: new Set(), rh: false }); return x; };
const seenNames = new Map(); // pid -> nombre visto en un partido
const displayName = (pid) => (players[pid] && players[pid].n) || seenNames.get(pid) || pid;
const statsOf = (st) => { const o = {}; for (const [k, v] of Object.entries(st)) if (v && !C.META_STATS.has(k)) o[k] = v; return o; };

function summaryOf(m, key) {
  const o = {
    i: m.id, k: key, t: m.t, y: m.type, r: m.region, a: m.arena, e: m.endReason, o: m.ot ? 1 : 0,
    s: [m.score.home, m.score.away], w: m.winner === 'home' ? 0 : m.winner === 'away' ? 1 : -1, v: m.mvp, f: m.format,
    p: m.players.map((p) => [p.pid, p.name, p.team === 'home' ? 0 : 1, p.rating, p.st.goals || 0, p.st.assists || 0, p.rk || '', p.rkApprox ? 1 : 0,
      p.st.shots || 0, p.st.saves || 0, p.st.passes || 0, p.st.score || 0, p.st.takeaways || 0, p.st.blocks || 0,
      p.st.turnovers || 0, Math.round(p.st.possession_time_sec || 0), p.st.faceoffs_won || 0, p.st.faceoffs_lost || 0, p.st.post_hits || 0]),
  };
  // partida custom con periodos: cada periodo con su marcador y las cifras de cada jugador (C.PER_COLS, en el orden de p)
  if (m.per) o.pd = m.per.map((x) => ({
    n: x.n, ...(x.from !== x.n ? { f: x.from } : {}), i: x.id, k: keyOf(x.t), t: x.t, s: [x.score.home, x.score.away], e: x.endReason, ...(x.ot ? { o: 1 } : {}), v: x.mvp,
    q: x.rows.map((r) => (r ? [r.rating, ...C.PER_COLS.map((k) => Math.round(r.st[k] || 0))] : 0)),
  }));
  return o;
}
function normalizeAt(raw) {
  const m = C.normalize(raw, W);
  if (!m || !m.id) return null;
  for (const p of m.players) {
    const ra = players[p.pid] && players[p.pid].rh ? C.rankAt(players[p.pid].rh, m.t) : null;
    p.rk = ra ? ra.rk : ''; p.rkApprox = ra ? ra.approx : false;
  }
  return m;
}
// Partidos de cada jugador para su perfil (formato compacto de C.gamePack: [1]=id, [2]=t, [7]=nota, [8]=mvp, [9]=rango, [13]/[14]=compañeros/rivales)
function gamesOf(m, key) {
  return m.players.map((p, idx) => {
    const other = p.team === 'home' ? 'away' : 'home';
    return [p.pid, C.gamePack({
      k: key, i: m.id, t: m.t, tm: p.team === 'home' ? 0 : 1, gf: m.score[p.team], ga: m.score[other], r: p.res, rt: p.rating,
      mv: idx === m.mvp ? 1 : 0, st: statsOf(p.st), rk: p.rk, y: m.type, f: m.format, ar: m.arena,
      mt: m.players.filter((o) => o.team === p.team && o !== p && o.pid).map((o) => o.pid),
      op: m.players.filter((o) => o.team === other && o.pid).map((o) => o.pid),
    })];
  });
}
// Periodos de partidas custom: se juntan al final de la pasada (pueden llegar en cualquier orden)
const perPend = new Map();   // id del registro -> momento en que acabó ese periodo
// Añade un partido (ya guardado en bruto) a los resúmenes y perfiles
async function ingest(raw, key) {
  const id = String(raw.id);
  if (hiddenNow.has(id)) { S.hid[id] = key; return false; }
  if (C.periodNo(raw)) { perPend.set(id, Date.parse(raw.created || '') || 0); return true; }
  const m = normalizeAt(raw); if (!m) return false;
  const day = key.slice(0, 10);
  const ch = await chunk(day, await chunkId(key));
  if (ch.list.some((e) => e.i === m.id)) return false;
  ch.list.push(summaryOf(m, key)); ch.dirty = true; dirtyDays.add(day);
  for (const p of m.players) if (p.pid) seenNames.set(p.pid, p.name);
  for (const [pid, g] of gamesOf(m, key)) if (pid) touch(pid).add.push(g);
  return true;
}
// Partido nuevo de slapshot.gg
async function addRaw(raw, allowOld) {
  if (!raw || !C.okMatchId(raw.id) || !raw.game_stats || !Array.isArray(raw.game_stats.players)) return false;
  anonRaw(raw);
  const key = keyOf(Date.parse(raw.created) || 0);
  if (!allowOld && isArchived(key.slice(0, 10))) return false;   // demasiado antiguo: fuera de la ventana
  const s = await rawShard(key);
  if (s.ids.has(raw.id)) return false;
  s.list.push(raw); s.ids.add(raw.id); s.dirty = true;
  await ingest(raw, key);
  return true;
}

// ---------- rastreo ----------
// Destacados: los jugadores seguidos y los 100 de más MMR. Van los primeros y, mientras juegan, se revisan en cada pasada.
// Para no gastar peticiones de más, un partido visto en el historial de otro jugador cuenta como revisión de todos los
// que jugaron en él (p.cov): si tres destacados juegan juntos, basta con mirar a uno de ellos.
const TOP_N = Number(process.env.TOP_N ?? 100);
const MIN = 60_000;
const seedSet = new Set(seeds.filter((id) => !hidP.has(id)));
const prio = new Set(seeds.filter((id) => !hidP.has(id)));
Object.entries(players).filter(([, p]) => p.mmr != null && !p.gone).sort((a, b) => b[1].mmr - a[1].mmr).slice(0, TOP_N).forEach(([id]) => prio.add(id));
// Rangos: mientras haya muchos jugadores sin rango consultado, los destacados ceden sitio y el 70-85 % del resto son de rango
const RANK_WINDOW = 60 * D;
const backlog = Object.values(players).filter((p) => !p.rchk && !p.gone && p.seen && NOW - p.seen < RANK_WINDOW).length;
const PRIO_SHARE = backlog > 200 ? 0.45 : 0.6;   // tope de peticiones para destacados (los seguidos van siempre)
const RANKED_SHARE = backlog > 300 ? 0.85 : backlog > 40 ? 0.7 : 0.35;
const known = (p) => Math.max(p.chk || 0, p.cov || 0);
function interval(id, p) {
  if (!p.seen) return 3 * D;
  const age = Date.now() - p.seen;
  if (seedSet.has(id)) return age < H ? 3 * MIN : age < 6 * H ? 10 * MIN : age < 3 * D ? 30 * MIN : 3 * H;
  if (prio.has(id)) return age < H ? 5 * MIN : age < 6 * H ? 20 * MIN : age < 3 * D ? H : 6 * H;
  if (age < D) return 45 * MIN;
  if (age < 7 * D) return 4 * H;
  if (age < 30 * D) return D;
  return 7 * D;
}
function historyScore(id, p) {
  if (p.gone && Date.now() - (p.chk || 0) < 30 * D) return -1;
  // nunca revisados: cuentan como si llevaran un rato pendientes (más si jugaron hace poco), sin tapar a los que juegan ahora
  if (!p.chk) { const age = Date.now() - (p.seen || p.found || 0); return (age < D ? 3 : 1.5) * 1e6 + Math.min(p.hits || 0, 50) * 1e4 + (p.mmr || 0); }
  const over = (Date.now() - known(p)) / interval(id, p);
  if (over < 1) return -1;
  return over * 1e6 + (p.mmr || 0);
}
// destacados: primero los seguidos, después los que más se han pasado de su momento (y con más MMR)
function prioScore(id, p) {
  const s = historyScore(id, p);
  return s < 0 ? -1 : (seedSet.has(id) ? 1e14 : 0) + s;
}
function rankedScore(id, p) {
  if (p.gone || !p.seen) return -1;
  const age = Date.now() - p.seen;
  if (age > RANK_WINDOW) return -1;
  const since = p.rchk ? Date.now() - p.rchk : Infinity;
  const need = prio.has(id) ? (age < 3 * H ? 30 * MIN : 6 * H) : age < D ? 12 * H : age < 2 * D ? D : age < 14 * D ? 3 * D : 14 * D;
  if (since < need) return -1;
  return (p.rchk ? 0 : 1e9) + (prio.has(id) ? 5e8 : 0) + (age < 2 * D ? 1e8 : 0) + Math.min(p.hits || 0, 9999) * 1e3 - age / 1e6;
}
function pick(scoreFn, ids) {
  let best = null, bestScore = -1;
  if (ids) { for (const id of ids) { const p = players[id]; if (!p) continue; const s = scoreFn(id, p); if (s > bestScore) { bestScore = s; best = id; } } }
  else for (const [id, p] of Object.entries(players)) { const s = scoreFn(id, p); if (s > bestScore) { bestScore = s; best = id; } }
  return [best, bestScore];
}
const rhChanged = new Set();
function snapshot(pid, p, mmr, rk, t) {
  p.rh = p.rh || [];
  const last = p.rh[p.rh.length - 1];
  if (last && last[1] === mmr && last[2] === rk) return;
  p.rh.push([t, mmr, rk]);
  if (p.rh.length > 80) p.rh.splice(0, p.rh.length - 80);
  rhChanged.add(pid);
}

let reqs = 0, nextAt = 0, fails = 0, ok = 0, blocked = null;
async function get(url) {
  const wait = nextAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextAt = Date.now() + GAP_MS; reqs++;
  let res;
  try { res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } }); }
  catch (e) { return { err: 'network', msg: String(e) }; }
  const rem = res.headers.get('x-ratelimit-remaining');
  const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
  if ((rem === '0' || res.status === 429) && reset) { const until = reset + 1000; if (until > nextAt && until - Date.now() < 90_000) nextAt = until; }
  if (res.status === 429) return { err: 'rate', status: 429 };
  if (res.status === 404) return { err: 'missing', status: 404 };
  if (!res.ok) return { err: 'http', status: res.status };
  if (!(res.headers.get('content-type') || '').includes('json')) return { err: 'notjson', status: res.status };
  try { return { data: await res.json() }; } catch { return { err: 'badjson', status: res.status }; }
}

// Migración: los partidos del formato anterior entran como nuevos
let migrated = 0;
if (legacy) {
  legacy.sort((a, b) => (a.created || '').localeCompare(b.created || ''));
  for (const raw of legacy) if (await addRaw(raw, true)) migrated++;
}

let newMatches = 0, checked = 0, rankedChecked = 0, discovered = 0, prioChecked = 0, prioMatches = 0;
const featuredNew = [];   // partidos nuevos de destacados en esta pasada
while (Date.now() - started < BUDGET_MS && reqs < MAX_REQ && !blocked) {
  // 1) destacados que toca revisar (seguidos siempre; el resto, sin pasar del 60 %)
  // 2) rangos e historiales del resto, a partes
  let id = null, kind = 'history';
  const [pid, ps] = pick(prioScore, prio);
  if (pid && (ps >= 1e14 || prioChecked < PRIO_SHARE * (reqs + 1))) { id = pid; prioChecked++; }
  else {
    const other = reqs - prioChecked;
    if (rankedChecked < RANKED_SHARE * (other + 1)) { id = pick(rankedScore)[0]; if (id) kind = 'ranked'; }
    if (!id) { id = pick(historyScore)[0]; kind = 'history'; }
    if (!id) { id = pick(rankedScore)[0]; kind = 'ranked'; }
  }
  if (!id) break;
  const p = players[id];
  const r = await get(API + encodeURIComponent(id) + (kind === 'ranked' ? '/ranked' : ''));
  if (r.err) {
    console.log(`  ${kind} ${id}: ${r.err} ${r.status || ''}`);
    if (r.err === 'rate') continue;
    if (r.err === 'missing') { if (kind === 'history') { p.chk = Date.now(); p.gone = true; } else { p.rchk = Date.now(); p.unr = true; } continue; }
    if (r.status === 403 || r.status === 503 || r.err === 'notjson') { blocked = `slapshot.gg respondió ${r.status || r.err}`; break; }
    if (kind === 'history') p.chk = Date.now(); else p.rchk = Date.now();
    if (++fails >= 5) { blocked = 'demasiados errores seguidos'; break; }
    continue;
  }
  fails = 0; ok++;
  const d = r.data || {};
  if (kind === 'ranked') {
    rankedChecked++;
    p.rchk = Date.now();
    const before = JSON.stringify([p.mmr, p.rk, p.peak, p.prk, p.season, p.rmp, p.unr]);
    if (d.rating != null && d.rank && d.rank.key) {
      p.mmr = Number(d.rating); p.rk = d.rank.key; p.rank = d.rank.name; delete p.unr;
      snapshot(id, p, p.mmr, p.rk, Date.now());
    } else p.unr = true;
    if (d.highest_rating != null) p.peak = Number(d.highest_rating);
    if (d.highest_rank && d.highest_rank.key) { p.prk = d.highest_rank.key; p.prank = d.highest_rank.name; }
    if (d.season) p.season = d.season;
    if (d.matches_played != null) p.rmp = Number(d.matches_played);
    if (JSON.stringify([p.mmr, p.rk, p.peak, p.prk, p.season, p.rmp, p.unr]) !== before) touch(id);
    continue;
  }
  checked++;
  p.chk = Date.now(); delete p.gone;
  if (d.username && d.username !== p.n) { p.n = d.username; touch(id); }
  if (d.is_premium != null) p.prem = !!d.is_premium;
  for (const m of d.match_history || []) {
    if (!m || !m.id || !m.game_stats) continue;
    anonRaw(m);
    const t = Date.parse(m.created) || 0;
    const plist = Array.isArray(m.game_stats.players) ? m.game_stats.players : [];
    for (const pl of plist) {
      const pid = C.pidOf(pl); if (!pid) continue;
      let q = players[pid];
      if (!q) { q = players[pid] = { n: pl.username || null, found: Date.now() }; discovered++; }
      if (pl.username && !q.chk && t >= (q.seen || 0)) q.n = pl.username;
      if (t > (q.seen || 0)) q.seen = t;
      if (t > (q.cov || 0)) q.cov = t;
    }
    if (await addRaw(m)) {
      newMatches++;
      for (const pl of plist) { const id = C.pidOf(pl); const q = id ? players[id] : null; if (q) q.hits = (q.hits || 0) + 1; }
      if (plist.some((pl) => prio.has(C.pidOf(pl)))) { prioMatches++; featuredNew.push(String(m.id)); }
    }
  }
}
const crawlMs = Date.now() - started;

lap('crawl');
// ---------- partidos ocultos / vueltos a mostrar ----------
async function findKey(id) {
  for (const day of Object.keys(S.days).sort().reverse()) {
    for (const f of await list(path.join(DATA, 'days', day))) {
      const ch = await chunk(day, f.replace('.json.gz', ''));
      const e = ch.list.find((x) => x.i === id); if (e) return e.k;
    }
  }
  return null;
}
for (const [id, k] of hiddenNow) {
  if (id in S.hid) continue;
  const key = k || await findKey(id);
  S.hid[id] = key;
  if (!key) continue;
  const day = key.slice(0, 10), ch = await chunk(day, await chunkId(key));
  const i = ch.list.findIndex((e) => e.i === id);
  if (i >= 0) { const e = ch.list[i]; ch.list.splice(i, 1); ch.dirty = true; dirtyDays.add(day); for (const p of e.p) touch(p[0]).rm.add(id); }
}
for (const id of Object.keys(S.hid)) {
  if (hiddenNow.has(id)) continue;
  const key = S.hid[id]; delete S.hid[id];
  if (!key || isArchived(key.slice(0, 10))) continue;
  const raw = (await rawShard(key)).list.find((r) => String(r.id) === id);
  if (raw) await ingest(raw, key);
}

lap('hidden');
// ---------- fórmula cambiada: recalcular las notas de los días no archivados ----------
let rerate = null;
if (S.wHash && S.wHash !== wHash && !legacy) {
  rerate = new Map();   // id partido -> Map(pid -> [nota, mvp])
  for (const day of Object.keys(S.days)) {
    if (isArchived(day)) continue;
    for (const f of await list(path.join(DATA, 'full', day))) {
      const key = day + '/' + f.replace('.json.gz', '');
      const ch = await chunk(day, key.slice(11));
      const list2 = [];
      for (const raw of (await rawShard(key)).list) {
        if (hiddenNow.has(String(raw.id)) || C.periodNo(raw)) continue;   // los periodos se juntan después
        const m = normalizeAt(raw); if (!m) continue;
        list2.push(summaryOf(m, key));
        rerate.set(m.id, new Map(m.players.map((p, i) => [p.pid, [p.rating, i === m.mvp ? 1 : 0]])));
      }
      ch.list = list2; ch.dirty = true;
    }
    dirtyDays.add(day);
  }
  console.log(`Fórmula cambiada: ${rerate.size} partidos recalculados`);
}
S.wHash = wHash;

lap('rerate2');
// ---------- partidas custom con periodos: un solo partido con todos sus periodos ----------
// slapshot.gg da cada periodo como un partido aparte con el marcador y las estadísticas acumulados. Se juntan los
// periodos de la misma partida (C.linkPeriods) y el partido se guarda una sola vez, con el ID y la hora de su primer
// periodo; los resúmenes sueltos de los demás periodos (de pasadas anteriores) se quitan. Al cambiar este formato
// (PER_V) o la fórmula de la nota, se rehacen todas las partidas con periodos de los días no archivados.
const PER_V = 1;
const upgradePer = S.perV !== PER_V;
let perGroups = 0;
function rankUp(m) {
  for (const p of m.players) {
    const ra = players[p.pid] && players[p.pid].rh ? C.rankAt(players[p.pid].rh, m.t) : null;
    p.rk = ra ? ra.rk : ''; p.rkApprox = ra ? ra.approx : false;
  }
  return m;
}
const tOf = (raw) => Date.parse((raw && raw.created) || '') || 0;
// quita el resumen de un registro (si lo hay) y devuelve lo que había
async function dropEntry(id, key) {
  const day = key.slice(0, 10); if (isArchived(day) || !S.days[day] && !dirtyDays.has(day)) return null;
  const ch = await chunk(day, await chunkId(key));
  const i = ch.list.findIndex((e) => e.i === id); if (i < 0) return null;
  const [e] = ch.list.splice(i, 1); ch.dirty = true; dirtyDays.add(day);
  return e;
}
async function placeGroup(group) {
  const root = group[0], rid = String(root.id), rkey = keyOf(tOf(root));
  if (isArchived(rkey.slice(0, 10))) return;
  // los demás periodos no tienen resumen propio
  for (const r of group.slice(1)) { const e = await dropEntry(String(r.id), keyOf(tOf(r))); if (e) for (const p of e.p) if (p[0]) touch(p[0]).rm.add(e.i); }
  // si se ocultó cualquiera de sus periodos, se oculta la partida entera
  if (group.some((r) => hiddenNow.has(String(r.id)))) {
    const e = await dropEntry(rid, rkey); if (e) for (const p of e.p) if (p[0]) touch(p[0]).rm.add(rid);
    for (const r of group) if (hiddenNow.has(String(r.id))) S.hid[String(r.id)] = keyOf(tOf(r));
    return;
  }
  const m = C.mergePeriods(group, W); if (!m || !m.id) return;
  rankUp(m);
  const day = rkey.slice(0, 10), ch = await chunk(day, await chunkId(rkey));
  const sum = summaryOf(m, rkey), i = ch.list.findIndex((e) => e.i === m.id);
  if (i >= 0) {
    const now = new Set(m.players.map((p) => p.pid));
    for (const p of ch.list[i].p) if (p[0] && !now.has(p[0])) touch(p[0]).rm.add(m.id);
    ch.list[i] = sum;
  } else ch.list.push(sum);
  ch.dirty = true; dirtyDays.add(day); perGroups++;
  for (const p of m.players) if (p.pid) seenNames.set(p.pid, p.name);
  for (const [pid, g] of gamesOf(m, rkey)) if (pid) touch(pid).add.push(g);
}
if (upgradePer || rerate || perPend.size) {
  const recs = [], seen = new Set();
  const take = (raw) => { const id = String(raw.id); if (!seen.has(id) && C.periodNo(raw)) { seen.add(id); recs.push(raw); } };
  if (upgradePer || rerate) {
    // todos los días no archivados: lo que hay en disco y lo que ha llegado en esta pasada (aún sin escribir)
    const keys = new Set(raws.keys());
    for (const day of await list(path.join(DATA, 'full'))) for (const f of await list(path.join(DATA, 'full', day))) keys.add(day + '/' + f.replace('.json.gz', ''));
    for (const key of keys) if (!isArchived(key.slice(0, 10))) for (const raw of (await rawShard(key)).list) take(raw);
  } else {
    // alrededor de cada periodo nuevo (una partida de 3 periodos dura menos de hora y media)
    const keys = new Set();
    for (const t of perPend.values()) for (let j = -2; j <= 2; j++) keys.add(keyOf(t + j * H));
    for (const key of keys) if (!isArchived(key.slice(0, 10))) for (const raw of (await rawShard(key)).list) take(raw);
  }
  const all = upgradePer || rerate;
  for (const g of C.linkPeriods(recs)) if (all || g.some((r) => perPend.has(String(r.id)))) await placeGroup(g);
  console.log(`Partidas custom con periodos: ${perGroups} guardadas (${recs.length} periodos mirados${all ? ', todas' : ''})`);
}
S.perV = PER_V;

// ---------- jugadores ocultos: limpiar lo ya publicado cuando se añade alguno ----------
const hidPHash = hash(JSON.stringify([...hidP].sort()));
const hidPChanged = hidP.size > 0 && S.hidPHash !== hidPHash;
if (hidPChanged) {
  let nRaw = 0, nSum = 0, nAgg = 0;
  // partidos completos de los días no archivados y los que esperan a subirse al archivo
  for (const day of await list(path.join(DATA, 'full'))) for (const f of await list(path.join(DATA, 'full', day))) {
    const s = await rawShard(day + '/' + f.replace('.json.gz', ''));
    let ch = false; for (const raw of s.list) if (anonRaw(raw)) ch = true;
    if (ch) { s.dirty = true; nRaw++; }
  }
  for (const f of await list(path.join(INT, 'outbox'))) {
    const p = path.join(INT, 'outbox', f), l = await readJSON(p, null);
    if (!Array.isArray(l)) continue;
    let ch = false; for (const raw of l) if (anonRaw(raw)) ch = true;
    if (ch) await out.json(p, l);
  }
  // resúmenes de todos los días (también los archivados): sin nombre ni ID
  for (const day of await list(path.join(DATA, 'days'))) {
    if (!/^\d{4}-\d\d-\d\d$/.test(day)) continue;
    for (const f of await list(path.join(DATA, 'days', day))) {
      if (!f.endsWith('.json.gz')) continue;
      const ch = await chunk(day, f.slice(0, -8));
      let c = false;
      for (const e of ch.list) for (const p of e.p) if (hidP.has(String(p[0]))) { p[0] = ''; p[1] = HIDDEN_NAME; p[6] = ''; p[7] = 0; c = true; }
      if (c) { ch.dirty = true; dirtyDays.add(day); nSum++; }
    }
  }
  // totales por día y por mes
  for (const sub of ['d', 'm']) for (const f of await list(path.join(INT, 'agg', sub))) {
    const p = path.join(INT, 'agg', sub, f), x = await readJSON(p, null); if (!x) continue;
    const maps = x.v != null && (x.p || x.c) ? [x.p || {}, x.c || {}] : [x];   // formato con públicas/custom, o el antiguo
    let c = false; for (const mp of maps) for (const pid of hidP) if (Object.prototype.hasOwnProperty.call(mp, pid)) { delete mp[pid]; c = true; }
    if (c) { await out.json(p, x); nAgg++; }
  }
  console.log(`Jugadores ocultos (${hidP.size}): ${nRaw} archivos de partidos, ${nSum} de resúmenes y ${nAgg} de totales limpiados`);
}
S.hidPHash = hidPHash;

// Pasada completa (tablas, rankings, récords y todos los perfiles) como mucho cada 20 minutos;
// en las pasadas ligeras solo se publican los partidos, los días y los perfiles de los destacados.
const HEAVY_MS = Number(process.env.HEAVY_EVERY_MS ?? 20 * 60_000);
const META_V = 5, PROF_V = 4, AGG_V = 2;
const upgradeMeta = S.metaV !== META_V, upgradeProf = S.profV !== PROF_V;
// totales v2: las partidas personalizadas (custom) van aparte y no cuentan en la nota ni en las tablas.
// Al cambiar de formato se rehacen todos los totales desde los resúmenes de cada día (que se guardan siempre).
const upgradeAgg = S.aggV !== AGG_V;
const hiddenChanged = Object.keys(S.hid).length !== (S._hidN || 0);
const heavy = !S.lastHeavy || NOW - S.lastHeavy >= HEAVY_MS || !!process.env.FORCE_HEAVY || !!rerate || !!legacy || upgradeMeta || upgradeProf || upgradeAgg || hiddenChanged || upgradePer || hidPChanged;
if (upgradeMeta || upgradeAgg) for (const d of Object.keys(S.days)) dirtyDays.add(d);
if (upgradeAgg) for (const f of await list(path.join(INT, 'agg', 'm'))) await out.rm(path.join(INT, 'agg', 'm', f));

lap('rerate');
// ---------- rangos de los partidos de hoy y ayer ----------
for (const day of [TODAY, RECENT]) {
  if (!S.days[day] && !dirtyDays.has(day)) continue;
  for (const f of await list(path.join(DATA, 'days', day))) {
    const ch = await chunk(day, f.replace('.json.gz', ''));
    for (const e of ch.list) for (const p of e.p) {
      const st = players[p[0]];
      const ra = st && st.rh ? C.rankAt(st.rh, e.t) : null;
      const rk = ra ? ra.rk : '', ap = ra && ra.approx ? 1 : 0;
      if (p[6] !== rk || p[7] !== ap) { p[6] = rk; p[7] = ap; ch.dirty = true; dirtyDays.add(day); }
    }
  }
}
for (const pid of rhChanged) touch(pid).rh = true;
// Días anteriores (hasta dos semanas): en las pasadas completas se pone el rango a los jugadores que ya lo tienen
S.rhPend = [...new Set([...(S.rhPend || []), ...rhChanged])];
if (heavy && S.rhPend.length) {
  const want = new Set(S.rhPend);
  for (let i = 2; i < 14; i++) {
    const day = dayAdd(TODAY, -i);
    if (!S.days[day] || isArchived(day)) continue;
    for (const f of await list(path.join(DATA, 'days', day))) {
      const ch = await chunk(day, f.replace('.json.gz', ''));
      for (const e of ch.list) for (const p of e.p) {
        if (!want.has(p[0])) continue;
        const ra = C.rankAt(players[p[0]] && players[p[0]].rh, e.t);
        const rk = ra ? ra.rk : '', ap = ra && ra.approx ? 1 : 0;
        if (p[6] !== rk || p[7] !== ap) { p[6] = rk; p[7] = ap; ch.dirty = true; dirtyDays.add(day); }
      }
    }
  }
  S.rhPend = [];
}

lap('ranks');
// ---------- guardar partidos en bruto ----------
for (const [key, s] of raws) if (s.dirty) {
  s.list.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  await out.json(P.raw(key), s.list);
}
if (legacy) {
  for (const day of await list(path.join(DATA, 'full'))) for (const f of await list(path.join(DATA, 'full', day))) if (f.endsWith('.json')) await out.rm(path.join(DATA, 'full', day, f));
  for (const f of await list(path.join(DATA, 'days'))) if (f.endsWith('.json')) await out.rm(path.join(DATA, 'days', f));
  for (const f of await list(path.join(DATA, 'p'))) if (f.endsWith('.json')) await out.rm(path.join(DATA, 'p', f));
  for (const f of ['players.json', 'state.json', 'seeds.json']) await out.rm(path.join(DATA, f));
  await out.rm(path.join(DATA, 'matches'));
}

lap('raw');
// ---------- archivar días antiguos ----------
async function archiveDay(day) {
  const dir = path.join(DATA, 'full', day);
  const items = [];
  for (const f of await list(dir)) for (const raw of await readJSON(path.join(dir, f), [])) items.push(raw);
  if (items.length) {
    const prev = await readJSON(P.outbox(day), []);
    const ids = new Set(prev.map((r) => r.id));
    const all = prev.concat(items.filter((r) => !ids.has(r.id))).sort((a, b) => (a.created || '').localeCompare(b.created || ''));
    await out.json(P.outbox(day), all);
  }
  await out.rm(dir);
  // resúmenes por hora -> bloques de varias horas (unos 600 partidos) para no acumular miles de archivos
  const ddir = path.join(DATA, 'days', day);
  const hours = new Set((await list(ddir)).map((f) => f.replace('.json.gz', '')).filter((c) => /^\d\d$/.test(c)));
  for (const k of chunks.keys()) if (k.startsWith(day + '/') && /^\d\d$/.test(k.slice(11))) hours.add(k.slice(11));
  if (hours.size) {
    const blocks = []; let cur = null;
    for (const hh of [...hours].sort().reverse()) {
      const c = await chunk(day, hh);
      if (!cur || cur.list.length >= 600) blocks.push(cur = { hi: hh, lo: hh, list: [] });
      cur.lo = hh; cur.list.push(...c.list);
      chunks.delete(day + '/' + hh); await out.rm(P.chunk(day, hh));
    }
    if (blocks.length > 1 && blocks[blocks.length - 1].list.length < 200) { const t = blocks.pop(); const b = blocks[blocks.length - 1]; b.lo = t.lo; b.list.push(...t.list); }
    for (const b of blocks) chunks.set(day + '/' + b.hi + '-' + b.lo, { list: b.list, dirty: true });
  }
  if (S.days[day]) S.days[day].x = 1;
  dirtyDays.add(day);
}
const archivedNow = [];
const fullDays = await list(path.join(DATA, 'full'));
for (const day of new Set([...Object.keys(S.days), ...fullDays])) {
  if (day >= CUTOFF) continue;
  if (S.days[day] && S.days[day].x && !fullDays.includes(day)) continue;
  await archiveDay(day); archivedNow.push(day);
}

lap('archive');
// ---------- días modificados: trozos, resumen del día y totales del día ----------
function leaders(entries) {
  const map = new Map();
  for (const m of entries) for (const p of m.p) {
    if (!p[0]) continue;
    let a = map.get(p[0]);
    if (!a) { a = { id: p[0], n: p[1], rk: p[6], gp: 0, g: 0, a: 0, rs: 0, t: 0 }; map.set(p[0], a); }
    a.gp++; a.g += p[4]; a.a += p[5]; a.rs += p[3];
    if (m.t > a.t) { a.t = m.t; a.n = p[1]; if (p[6]) a.rk = p[6]; }
  }
  return [...map.values()].sort((x, y) => (y.g + y.a) - (x.g + x.a) || y.g - x.g || y.rs / y.gp - x.rs / x.gp).slice(0, 8)
    .map(({ id, n, rk, gp, g, a, rs }) => ({ id, n, rk, gp, g, a, rs: Math.round(rs * 10) / 10 }));
}
const isCustom = (y) => y === 'custom';
const round5 = (o) => { for (const a of Object.values(o)) a[5] = Math.round(a[5] * 10) / 10; return o; };
// Totales del día: públicas (p) y personalizadas (c) por separado
function dayAggOf(entries) {
  const o = { v: AGG_V, p: {}, c: {} };
  for (const e of entries) {
    const dst = isCustom(e.y) ? o.c : o.p;
    e.p.forEach((p, i) => {
      if (!p[0]) return;
      const c = C.contrib(e, i), a = dst[p[0]] || (dst[p[0]] = new Array(c.length).fill(0));
      for (let k = 0; k < c.length; k++) a[k] += c[k];
    });
  }
  round5(o.p); round5(o.c);
  return o;
}
// Lee un archivo de totales (formato v2; uno antiguo, sin separar, cuenta como públicas)
const aggSplit = (o) => (o && o.v === AGG_V ? { p: o.p || {}, c: o.c || {} } : { p: o || {}, c: {} });
const addInto = (dst, src) => { for (const [pid, a] of Object.entries(src)) { const s = dst[pid] || (dst[pid] = new Array(a.length).fill(0)); a.forEach((x, k) => { s[k] += x; }); } };
for (const day of [...dirtyDays].sort()) {
  const ddir = path.join(DATA, 'days', day);
  const ids = new Set((await list(ddir)).map((f) => f.replace('.json.gz', '')));
  for (const k of chunks.keys()) if (k.startsWith(day + '/')) ids.add(k.slice(11));
  const parts = [];
  const all = [];
  for (const c of [...ids].sort().reverse()) {
    const ch = await chunk(day, c);
    ch.list.sort((a, b) => b.t - a.t);
    if (!ch.list.length) { await out.rm(P.chunk(day, c)); continue; }
    const { v } = ch.dirty ? await out.json(P.chunk(day, c), ch.list) : { v: hash(JSON.stringify(ch.list)) };
    parts.push({ c, n: ch.list.length, v });
    all.push(...ch.list);
  }
  if (!all.length) { delete S.days[day]; await out.rm(P.meta(day)); await out.rm(ddir); await out.rm(P.aggD(day)); continue; }
  all.sort((a, b) => b.t - a.t);
  const counts = new Map();
  for (const e of all) { const k = `${e.y}\u0001${e.r}\u0001${e.a}`; counts.set(k, (counts.get(k) || 0) + 1); }
  const perf = [];
  for (const e of all) e.p.forEach((p) => { if (p[0]) perf.push({ e, p }); });
  perf.sort((a, b) => b.p[3] - a.p[3] || (b.p[4] + b.p[5]) - (a.p[4] + a.p[5]));
  // marcas del día para la página de récords (sin partidas personalizadas, que pueden ser de modos especiales)
  const pubPerf = perf.filter((x) => !isCustom(x.e.y)), pubAll = all.filter((e) => !isCustom(e.y));
  // partido destacado y mejores actuaciones: mejor de partidas públicas (si apenas hay, de todas)
  const bestPool = pubAll.length ? pubAll : all, perfPool = pubPerf.length >= 3 ? pubPerf : perf;
  let best = null;
  for (const e of bestPool) { const mv = e.p[e.v]; if (mv && (!best || mv[3] > best.p[best.v][3])) best = e; }
  const topBy = (idx) => pubPerf.filter((x) => (x.p[idx] || 0) > 0).sort((a, b) => b.p[idx] - a.p[idx] || b.p[3] - a.p[3]).slice(0, 5)
    .map(({ e, p }) => ({ i: e.i, k: e.k, t: e.t, id: p[0], n: p[1], rk: p[6], v: p[idx], rt: p[3], s: e.s }));
  const gpd = new Map(); for (const { p } of pubPerf) { const x = gpd.get(p[0]) || { id: p[0], n: p[1], rk: p[6], gp: 0 }; x.gp++; gpd.set(p[0], x); }
  const rec = {
    rt: pubPerf.slice(0, 5).map(({ e, p }) => ({ i: e.i, k: e.k, t: e.t, id: p[0], n: p[1], rk: p[6], ap: p[7], rt: p[3], g: p[4], as: p[5], s: e.s, tm: p[2] })),
    g: topBy(4), as: topBy(5), sv: topBy(9), pts: topBy(11),
    tot: pubAll.slice().sort((a, b) => (b.s[0] + b.s[1]) - (a.s[0] + a.s[1])).slice(0, 3).map((e) => ({ i: e.i, k: e.k, t: e.t, s: e.s, y: e.y, r: e.r, a: e.a })),
    gpd: [...gpd.values()].sort((a, b) => b.gp - a.gp).slice(0, 5),
  };
  const archived = isArchived(day);
  const meta = {
    d: day, n: all.length, x: archived ? 1 : 0, chunks: parts,
    counts: [...counts.entries()].map(([k, n]) => [...k.split('\u0001'), n]).sort((a, b) => b[3] - a[3]),
    lead: leaders(pubAll.length ? pubAll : all),
    perf: perfPool.slice(0, 10).map(({ e, p }) => ({ i: e.i, k: e.k, t: e.t, id: p[0], n: p[1], rk: p[6], ap: p[7], rt: p[3], g: p[4], as: p[5], s: e.s, tm: p[2] })),
    best, rec,
  };
  const { v: u } = await out.json(P.meta(day), meta);
  S.days[day] = { n: all.length, u, x: archived ? 1 : 0 };
  if (!(archived && !(await exists(P.aggD(day))) && await monthRolled(day))) await out.json(P.aggD(day), dayAggOf(all));
}
async function monthRolled(day) { return exists(P.aggM(day.slice(0, 7))); }

lap('days');
// meses cerrados: los totales de sus días se juntan en un solo archivo
const lastDayOf = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const aggDays = (await list(path.join(INT, 'agg', 'd'))).map((f) => f.slice(0, 10));
for (const ym of new Set(aggDays.map((d) => d.slice(0, 7)))) {
  if (lastDayOf(ym) >= CUTOFF) continue;
  const sum = aggSplit(await readJSON(P.aggM(ym), null));
  for (const d of aggDays.filter((x) => x.startsWith(ym))) { const x = aggSplit(await readJSON(P.aggD(d), {})); addInto(sum.p, x.p); addInto(sum.c, x.c); }
  await out.json(P.aggM(ym), { v: AGG_V, p: round5(sum.p), c: round5(sum.c) });
  for (const d of aggDays.filter((x) => x.startsWith(ym))) await out.rm(P.aggD(d));
}

lap('months');
// ---------- totales de carrera, 30 días y 7 días (públicas) y de carrera en personalizadas ----------
const TA = new Map(), TM = new Map(), TK = new Map(), CA = new Map();
const addTo = (map, obj) => { for (const [pid, a] of Object.entries(obj)) { const s = map.get(pid); if (!s) map.set(pid, a.slice()); else for (let k = 0; k < a.length; k++) s[k] += a[k]; } };
for (const f of await list(path.join(INT, 'agg', 'm'))) { const x = aggSplit(await readJSON(path.join(INT, 'agg', 'm', f), {})); addTo(TA, x.p); addTo(CA, x.c); }
for (const f of await list(path.join(INT, 'agg', 'd'))) {
  const day = f.slice(0, 10), x = aggSplit(await readJSON(path.join(INT, 'agg', 'd', f), {}));
  addTo(TA, x.p); addTo(CA, x.c); if (day >= M30 && day <= TODAY) addTo(TM, x.p); if (day >= K7 && day <= TODAY) addTo(TK, x.p);
}
for (const m of [TA, TM, TK, CA]) for (const a of m.values()) a[5] = Math.round(a[5] * 10) / 10;

lap('totals');
// ---------- perfiles ----------
const meta = (pid) => {
  const s = players[pid] || {};
  const o = {};
  for (const k of ['rk', 'rank', 'mmr', 'prk', 'prank', 'peak', 'season', 'rmp', 'unr']) if (s[k] != null) o[k] = s[k];
  o.rh = s.rh || [];
  return o;
};
// en las pasadas ligeras, los partidos nuevos de jugadores no destacados esperan a la siguiente pasada completa
S.pendGames = S.pendGames || {};
if (!heavy) for (const [pid, x] of [...pend]) {
  if (prio.has(pid) || x.rm.size || x.rh) continue;
  (S.pendGames[pid] = S.pendGames[pid] || []).push(...x.add);   // también sin partidos: cambió su rango o su MMR
  pend.delete(pid);
}
const schedB = new Set([...pend.keys()].map(C.bucketOf));
for (const [pid, games] of Object.entries(S.pendGames)) {
  if (!heavy && !schedB.has(C.bucketOf(pid))) continue;   // si su grupo se escribe igualmente, va ya
  touch(pid).add.unshift(...games); delete S.pendGames[pid];
}
const byBucket = new Map();
for (const pid of pend.keys()) { const b = C.bucketOf(pid); if (!byBucket.has(b)) byBucket.set(b, []); byBucket.get(b).push(pid); }
const sweep = rerate || legacy || upgradeProf || hidPChanged;
if (sweep) for (const f of await list(path.join(DATA, 'p'))) if (f.endsWith('.json.gz')) { const b = f.slice(0, -8); if (!byBucket.has(b)) byBucket.set(b, []); }
S.streak = S.streak || {}; S.cur = S.cur || {};
const recentT = Date.parse(RECENT + 'T00:00:00Z') - 2 * H;
let profiles = 0;
for (const [b, pids] of byBucket) {
  const oldText = await readText(P.bucket(b));
  let obj = {}; try { if (oldText) obj = JSON.parse(oldText); } catch {}
  const todo = new Set(pids); if (sweep) for (const pid of Object.keys(obj)) todo.add(pid);
  for (const pid of todo) {
    if (hidP.has(pid)) { delete obj[pid]; continue; }
    const x = pend.get(pid) || { add: [], rm: new Set(), rh: false };
    const prof = obj[pid] || { games: [], names: {} };
    let games = prof.games.filter((g) => !x.rm.has(g[1]) && !hiddenNow.has(g[1]));
    // una partida con periodos se vuelve a añadir cada vez que llega un periodo: vale la última versión;
    // y lo que se ha quitado en esta pasada (un periodo que ahora va dentro de su partida) no vuelve
    const lastOf = new Map(); for (const g of x.add) if (!hiddenNow.has(g[1]) && !x.rm.has(g[1])) lastOf.set(g[1], g);
    const add = [...lastOf.values()];
    if (add.length) { const ids = new Set(add.map((g) => g[1])); games = games.filter((g) => !ids.has(g[1])).concat(add); }
    if (rerate) for (const g of games) { const r = rerate.get(g[1]); const v = r && r.get(pid); if (v) { g[7] = v[0]; g[8] = v[1]; } }
    if ((x.rh || sweep) && players[pid] && players[pid].rh) for (const g of games) if (g[2] >= recentT || !g[9]) { const ra = C.rankAt(players[pid].rh, g[2]); g[9] = ra ? ra.rk : ''; }
    { const once = new Map(); for (const g of games) once.set(g[1], g); games = [...once.values()]; }   // cada partido una vez (en custom alguien puede salir en los dos equipos)
    games.sort((a, b) => b[2] - a[2]); games = games.slice(0, CAP);
    if (hidP.size) for (const g of games) { g[13] = g[13].filter((o) => !hidP.has(o)); g[14] = g[14].filter((o) => !hidP.has(o)); }
    const a = TA.get(pid), ac = CA.get(pid);
    if ((!a && !ac) || !games.length) { delete obj[pid]; continue; }
    const names = {};
    for (const g of games) for (const o of g[13].concat(g[14])) if (!(o in names)) names[o] = (players[o] && players[o].n) || seenNames.get(o) || (prof.names && prof.names[o]) || o;
    // racha actual (+ victorias / − derrotas) y mejor racha de victorias entre sus partidos públicos guardados
    const pg = games.filter((g) => !isCustom(g[10]));
    let cs = 0; const r0 = pg[0] && pg[0][6];
    if (r0 === 'W' || r0 === 'L') for (const g of pg) { if (g[6] === r0) cs++; else break; }
    let bs = 0, run = 0; for (let i = pg.length - 1; i >= 0; i--) { if (pg[i][6] === 'W') { run++; if (run > bs) bs = run; } else run = 0; }
    if (bs >= 3) S.streak[pid] = bs; else delete S.streak[pid];
    if (r0 === 'W' && cs >= 3) S.cur[pid] = [cs, pg[0][2]]; else delete S.cur[pid];
    // a: totales de partidas públicas; ac: de personalizadas (custom). Cada una puede faltar.
    obj[pid] = { id: pid, n: displayName(pid), meta: meta(pid), ...(a ? { a } : {}), ...(ac ? { ac } : {}), names, cs: r0 === 'L' ? -cs : cs, bs, games };
    profiles++;
  }
  if (Object.keys(obj).length) await out.json(P.bucket(b), obj, oldText); else await out.rm(P.bucket(b));
}

lap('profiles');
// ---------- tablas, buscador, rankings, récords (solo en las pasadas completas) ----------
const pubIds = [...TA.keys()].filter((pid) => TA.get(pid)[0] > 0);
// en el buscador están también los que solo juegan personalizadas (con el total de partidos de los dos tipos)
const gpAll = (pid) => ((TA.get(pid) || [0])[0] || 0) + ((CA.get(pid) || [0])[0] || 0);
const searchIds = [...new Set([...TA.keys(), ...CA.keys()])].filter((pid) => gpAll(pid) > 0);
const rowOf = (pid, a) => { const s = players[pid] || {}; return [pid, displayName(pid), s.rk || '', s.mmr ?? null, ...a]; };
const prevIdx = await readJSON(path.join(DATA, 'index.json'), {});
const verOf = { ...(prevIdx.files || {}) };
if (heavy) {
verOf.search = (await out.json(path.join(DATA, 'search.json.gz'), searchIds.map((pid) => { const s = players[pid] || {}; return [pid, displayName(pid), s.rk || '', s.mmr ?? null, gpAll(pid)]; })
  .sort((a, b) => b[4] - a[4]))).v;
const minA = pubIds.length > 15000 ? 2 : 1;
for (const [w, map, min] of [['a', TA, minA], ['m', TM, 1], ['k', TK, 1]]) {
  const rows = [...map.entries()].filter(([, a]) => a[0] >= min).map(([pid, a]) => rowOf(pid, a));
  verOf['p' + w] = (await out.json(path.join(DATA, `players-${w}.json.gz`), { cols: ['id', 'n', 'rk', 'mmr', ...C.AGG_KEYS], rows })).v;
}
// los 10 mejores sin ordenar toda la lista
function top10(objs, fn, min = 1) {
  const best = [];
  for (const r of objs) {
    if (r.a.gp < min) continue;
    const v = fn(r.a); if (!(v > 0)) continue;
    if (best.length === 10 && (v < best[9].v || (v === best[9].v && r.a.gp <= best[9].a.gp))) continue;
    best.push({ ...r, v }); best.sort((x, y) => y.v - x.v || y.a.gp - x.a.gp); if (best.length > 10) best.pop();
  }
  return best.map((r) => ({ id: r.pid, n: displayName(r.pid), rk: (players[r.pid] && players[r.pid].rk) || '', gp: r.a.gp, v: Math.round(r.v * 1000) / 1000 }));
}
const rankings = {};
for (const [w, map] of [['a', TA], ['m', TM], ['k', TK]]) {
  const objs = [...map.entries()].map(([pid, a]) => ({ pid, a: C.aggObj(a) }));
  const minGp = objs.filter((r) => r.a.gp >= 5).length >= 5 ? 5 : objs.filter((r) => r.a.gp >= 3).length >= 5 ? 3 : 1;
  rankings[w] = {
    min: minGp,
    avg: top10(objs, (a) => a.rs / a.gp, minGp), g: top10(objs, (a) => a.g), as: top10(objs, (a) => a.as), ga: top10(objs, (a) => a.g + a.as),
    mvp: top10(objs, (a) => a.mvp), sv: top10(objs, (a) => a.sv), ps: top10(objs, (a) => a.ps), tk: top10(objs, (a) => a.tk),
    bl: top10(objs, (a) => a.bl), wp: top10(objs, (a) => a.w / a.gp, minGp), gp: top10(objs, (a) => a.gp),
  };
}
const withMMR = pubIds.filter((pid) => players[pid] && players[pid].mmr != null).sort((a, b) => players[b].mmr - players[a].mmr);
rankings.mmr = withMMR.slice(0, 10).map((pid) => ({ id: pid, n: displayName(pid), rk: players[pid].rk, rank: players[pid].rank, mmr: players[pid].mmr }));
verOf.rankings = (await out.json(path.join(DATA, 'rankings.json'), rankings)).v;

lap('tables');
// portada: top MMR, mejores medias, mejores actuaciones (7 días) y más activos
const avgPool = (map, min) => [...map.entries()].filter(([, a]) => a[0] >= min).sort((x, y) => y[1][5] / y[1][0] - x[1][5] / x[1][0]);
let avgList = avgPool(TM, 5); if (avgList.length < 5) avgList = avgPool(TA, 3);
const perf7 = [];
for (const day of Object.keys(S.days)) if (day >= K7) { const mt = await readJSON(P.meta(day), null); if (mt && mt.perf) perf7.push(...mt.perf); }
perf7.sort((a, b) => b.rt - a.rt || (b.g + b.as) - (a.g + a.as));
verOf.top = (await out.json(path.join(DATA, 'top.json'), {
  mmr: rankings.mmr,
  avg: avgList.slice(0, 10).map(([id, a]) => ({ id, n: displayName(id), rk: (players[id] && players[id].rk) || '', avg: Math.round(a[5] / a[0] * 100) / 100, gp: a[0] })),
  perf: perf7.slice(0, 10),
  active: [...TK.entries()].sort((x, y) => y[1][0] - x[1][0]).slice(0, 10).map(([id, a]) => ({ id, n: displayName(id), rk: (players[id] && players[id].rk) || '', gp: a[0], avg: Math.round(a[5] / a[0] * 100) / 100 })),
  // equipo de la semana: mejores medias de los últimos 7 días con un mínimo de partidos
  week: (() => {
    const minW = [10, 6, 3].find((m) => [...TK.values()].filter((a) => a[0] >= m).length >= 5) || 1;
    return [...TK.entries()].filter(([, a]) => a[0] >= minW).sort((x, y) => y[1][5] / y[1][0] - x[1][5] / x[1][0]).slice(0, 5)
      .map(([id, a]) => ({ id, n: displayName(id), rk: (players[id] && players[id].rk) || '', avg: Math.round(a[5] / a[0] * 100) / 100, gp: a[0], g: a[6], as: a[7], mvp: a[4], min: minW }));
  })(),
})).v;

// atributos: cortes de percentil entre jugadores con 5+ partidos
const pool = pubIds.map((pid) => C.attrRaw(C.aggObj(TA.get(pid)))).filter((x, i) => x && TA.get(pubIds[i])[0] >= 5);
const q = {};
for (const [k] of C.ATTRS) {
  const vals = pool.map((x) => x[k]).filter((v) => v != null).sort((a, b) => a - b);
  q[k] = vals.length ? Array.from({ length: 101 }, (_, i) => Math.round(vals[Math.min(vals.length - 1, Math.round(i / 100 * (vals.length - 1)))] * 1e4) / 1e4) : [];
}
verOf.attr = (await out.json(path.join(DATA, 'attr.json'), { n: pool.length, q })).v;

// récords: de los resúmenes de todos los días (también los archivados) y de las rachas de los perfiles
const R = { rt: [], g: [], as: [], sv: [], pts: [], tot: [], gpd: [] };
for (const day of Object.keys(S.days)) {
  const mt = await readJSON(P.meta(day), null); if (!mt) continue;
  const rc = mt.rec || {};
  for (const x of rc.rt || mt.perf || []) R.rt.push({ ...x, d: day });
  for (const k of ['g', 'as', 'sv', 'pts', 'tot']) for (const x of rc[k] || []) R[k].push({ ...x, d: day });
  for (const x of rc.gpd || []) R.gpd.push({ ...x, d: day });
}
const topN = (list, f, n = 10) => list.filter((x) => !hiddenNow.has(x.i)).sort((a, b) => f(b) - f(a) || (b.rt || 0) - (a.rt || 0)).slice(0, n);
const records = {
  rt: topN(R.rt, (x) => x.rt, 15), g: topN(R.g, (x) => x.v), as: topN(R.as, (x) => x.v), sv: topN(R.sv, (x) => x.v), pts: topN(R.pts, (x) => x.v),
  tot: topN(R.tot, (x) => x.s[0] + x.s[1]), gpd: R.gpd.sort((a, b) => b.gp - a.gp).slice(0, 10),
  hot: Object.entries(S.cur).filter(([, [, t]]) => NOW - t < 2 * D).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).slice(0, 10)
    .map(([id, [v, t]]) => ({ id, n: displayName(id), rk: (players[id] && players[id].rk) || '', v, t })),
  streak: Object.entries(S.streak).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => ({ id, n: displayName(id), rk: (players[id] && players[id].rk) || '', v })),
};
// las mismas marcas, solo de los últimos 7 días
const wk = (list) => list.filter((x) => x.d >= K7);
records.week = {
  rt: topN(wk(R.rt), (x) => x.rt, 15), g: topN(wk(R.g), (x) => x.v), as: topN(wk(R.as), (x) => x.v), sv: topN(wk(R.sv), (x) => x.v), pts: topN(wk(R.pts), (x) => x.v),
  tot: topN(wk(R.tot), (x) => x.s[0] + x.s[1]), gpd: wk(R.gpd).sort((a, b) => b.gp - a.gp).slice(0, 10),
};
for (const x of records.gpd.concat(records.week.gpd)) x.n = displayName(x.id);
// nombres y rangos al día (los guardados en cada día pueden ser antiguos)
for (const list of [records.rt, records.g, records.as, records.sv, records.pts, ...Object.values(records.week)]) for (const x of list) if (x.id && players[x.id]) { x.n = displayName(x.id); if (!x.rk && players[x.id].rk) { x.rk = players[x.id].rk; x.ap = 1; } }
verOf.records = (await out.json(path.join(DATA, 'records.json'), records)).v;
S.lastHeavy = NOW;
}
S.metaV = META_V; S.profV = PROF_V; S.aggV = AGG_V; S._hidN = Object.keys(S.hid).length;

lap('top/attr');
// ---------- índice y estado ----------
const dayList = Object.entries(S.days).filter(([, x]) => x.n > 0).map(([d, x]) => ({ d, n: x.n, u: x.u, ...(x.x ? { x: 1 } : {}) })).sort((a, b) => b.d.localeCompare(a.d));
const totalMatches = dayList.reduce((s, x) => s + x.n, 0), stored = dayList.filter((x) => !x.x).reduce((s, x) => s + x.n, 0);
await fs.mkdir(INT, { recursive: true });
await out.json(path.join(INT, 'state.json.gz'), S);
const nowIso = new Date().toISOString();
const lastRun = {
  at: nowIso, requests: reqs, ok, checked, ranked: rankedChecked, newMatches, discovered, seconds: Math.round((Date.now() - started) / 1000),
  crawl: Math.round(crawlMs / 1000), heavy, prio: prioChecked, prioNew: prioMatches, pending: Object.keys(S.pendGames).length, blocked, files: out.files, removed: out.removed, profiles, archived: archivedNow.length, ...(migrated ? { migrated } : {}), ...(rerate ? { rerated: rerate.size } : {}),
};
const runs = [lastRun, ...((prevIdx.runs || []).filter((r) => r.at !== nowIso))].slice(0, 20);
const repo = process.env.GITHUB_REPOSITORY || 'mansowtcg/slapscore';
await fs.writeFile(path.join(DATA, 'index.json'), JSON.stringify({
  updated: nowIso, source: 'slapshot.gg', v: 3, retain: RETAIN,
  archive: { repo, tag: 'archivo-', file: 'partidos-' },
  files: verOf,
  featured: [...prio].filter((id) => players[id] && (players[id].mmr != null || seedSet.has(id))),
  // destacados que acaban de jugar (último partido hace menos de 25 minutos)
  live: [...prio].filter((id) => players[id] && players[id].seen && NOW - players[id].seen < 25 * MIN)
    .sort((a, b) => (players[b].mmr || 0) - (players[a].mmr || 0)).slice(0, 12)
    .map((id) => ({ id, n: displayName(id), rk: players[id].rk || '', t: players[id].seen })),
  totals: {
    matches: totalMatches, stored, hidden: hiddenNow.size, players: searchIds.length, known: Object.keys(players).length,
    tracked: Object.values(players).filter((p) => p.chk && !p.gone).length, ranked: Object.values(players).filter((p) => p.mmr != null).length,
    rankChecked: Object.values(players).filter((p) => p.rchk).length, rankBacklog: backlog,
  },
  lastRun, runs, days: dayList,
}));

console.log(`Peticiones: ${reqs} (${ok} correctas) · perfiles: ${checked} · rangos: ${rankedChecked}`);
console.log(`Partidos nuevos: ${newMatches}${migrated ? ` · migrados: ${migrated}` : ''} · total: ${totalMatches} (${stored} en bruto) · jugadores: ${searchIds.length} con partidos (${pubIds.length} en públicas), ${Object.keys(players).length} conocidos (${discovered} nuevos)`);
console.log(`Archivos escritos: ${out.files} (${Math.round(out.bytes / 1024)} KB) · borrados: ${out.removed} · perfiles: ${profiles} · días archivados: ${archivedNow.join(', ') || 'ninguno'}`);
console.log(`Tiempo: ${Math.round(crawlMs / 1000)} s rastreando, ${Math.round((Date.now() - started - crawlMs) / 1000)} s procesando`);
if (blocked) { console.log(`Parado: ${blocked}`); if (ok === 0) process.exit(1); }
