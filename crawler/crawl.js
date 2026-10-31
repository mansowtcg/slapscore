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
//   full/<día>/<HH>.json.gz         partidos tal cual los da slapshot.gg (solo los últimos N días)
//   p/<bucket>.json.gz              perfiles de jugadores (2048 grupos)
//   search.json.gz, players-{a,m,k}.json.gz, rankings.json, top.json, attr.json
//   _int/state.json.gz              estado del robot
//   _int/agg/d/<día>.json.gz        totales de cada jugador ese día (base de las estadísticas de carrera)
//   _int/agg/m/<AAAA-MM>.json.gz    totales de un mes ya cerrado
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
const RANKED_SHARE = 0.35;
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
const seeds = [...new Set((settings.seeds || []).map(String))];
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
for (const p of Object.values(players)) {
  if (!p.prk && p.prank) p.prk = C.rankKeyFromName(p.prank) || undefined;
  if (!p.rk && p.rank) p.rk = C.rankKeyFromName(p.rank) || undefined;
}
for (const id of seeds) { if (!players[id]) players[id] = { n: null, found: NOW }; players[id].seed = true; }
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
  return {
    i: m.id, k: key, t: m.t, y: m.type, r: m.region, a: m.arena, e: m.endReason, o: m.ot ? 1 : 0,
    s: [m.score.home, m.score.away], w: m.winner === 'home' ? 0 : m.winner === 'away' ? 1 : -1, v: m.mvp, f: m.format,
    p: m.players.map((p) => [p.pid, p.name, p.team === 'home' ? 0 : 1, p.rating, p.st.goals || 0, p.st.assists || 0, p.rk || '', p.rkApprox ? 1 : 0,
      p.st.shots || 0, p.st.saves || 0, p.st.passes || 0, p.st.score || 0, p.st.takeaways || 0, p.st.blocks || 0,
      p.st.turnovers || 0, Math.round(p.st.possession_time_sec || 0), p.st.faceoffs_won || 0, p.st.faceoffs_lost || 0, p.st.post_hits || 0]),
  };
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
      mt: m.players.filter((o) => o.team === p.team && o !== p).map((o) => o.pid),
      op: m.players.filter((o) => o.team === other).map((o) => o.pid),
    })];
  });
}
// Añade un partido (ya guardado en bruto) a los resúmenes y perfiles
async function ingest(raw, key) {
  const id = String(raw.id);
  if (hiddenNow.has(id)) { S.hid[id] = key; return false; }
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
  if (!raw || !raw.id || !raw.game_stats || !Array.isArray(raw.game_stats.players)) return false;
  const key = keyOf(Date.parse(raw.created) || 0);
  if (!allowOld && isArchived(key.slice(0, 10))) return false;   // demasiado antiguo: fuera de la ventana
  const s = await rawShard(key);
  if (s.ids.has(raw.id)) return false;
  s.list.push(raw); s.ids.add(raw.id); s.dirty = true;
  await ingest(raw, key);
  return true;
}

// ---------- rastreo ----------
function interval(p) {
  if (!p.seen) return 3 * D;
  const age = started - p.seen;
  if (age < D) return 45 * 60_000;
  if (age < 7 * D) return 4 * H;
  if (age < 30 * D) return D;
  return 7 * D;
}
function historyScore(p) {
  if (p.gone && started - (p.chk || 0) < 30 * D) return -1;
  if (!p.chk) return 1e12 + (p.seed ? 1e11 : 0) + (p.mmr || 0) * 1e3 + (p.hits || 0);
  const over = (Date.now() - p.chk) / interval(p);
  if (over < 1) return -1;
  return over * 1e6 + (p.mmr || 0) + (p.seed ? 5e5 : 0);
}
function rankedScore(p) {
  if (p.gone || !p.seen) return -1;
  const age = started - p.seen;
  if (age > 14 * D) return -1;
  const since = p.rchk ? Date.now() - p.rchk : Infinity;
  const need = p.seed ? 3 * H : age < D ? 12 * H : age < 2 * D ? D : 3 * D;
  if (since < need) return -1;
  return (p.rchk ? 0 : 1e9) + (age < 2 * D ? 1e8 : 0) + (p.seed ? 5e7 : 0) + (p.hits || 0) * 1e3 - age / 1e6;
}
function pick(scoreFn) {
  let best = null, bestScore = -1;
  for (const [id, p] of Object.entries(players)) { const s = scoreFn(p); if (s > bestScore) { bestScore = s; best = id; } }
  return best;
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

let newMatches = 0, checked = 0, rankedChecked = 0, discovered = 0;
while (Date.now() - started < BUDGET_MS && reqs < MAX_REQ && !blocked) {
  const wantRanked = rankedChecked < RANKED_SHARE * (reqs + 1);
  let id = null, kind = 'history';
  if (wantRanked) { id = pick(rankedScore); if (id) kind = 'ranked'; }
  if (!id) { id = pick(historyScore); kind = 'history'; }
  if (!id) { id = pick(rankedScore); kind = 'ranked'; }
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
    const t = Date.parse(m.created) || 0;
    const plist = Array.isArray(m.game_stats.players) ? m.game_stats.players : [];
    for (const pl of plist) {
      const pid = String(pl.game_user_id || ''); if (!pid) continue;
      let q = players[pid];
      if (!q) { q = players[pid] = { n: pl.username || null, found: Date.now() }; discovered++; }
      if (pl.username && !q.chk && t >= (q.seen || 0)) q.n = pl.username;
      if (t > (q.seen || 0)) q.seen = t;
    }
    if (await addRaw(m)) {
      newMatches++;
      for (const pl of plist) { const q = players[String(pl.game_user_id || '')]; if (q) q.hits = (q.hits || 0) + 1; }
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
        if (hiddenNow.has(String(raw.id))) continue;
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
    let a = map.get(p[0]);
    if (!a) { a = { id: p[0], n: p[1], rk: p[6], gp: 0, g: 0, a: 0, rs: 0, t: 0 }; map.set(p[0], a); }
    a.gp++; a.g += p[4]; a.a += p[5]; a.rs += p[3];
    if (m.t > a.t) { a.t = m.t; a.n = p[1]; if (p[6]) a.rk = p[6]; }
  }
  return [...map.values()].sort((x, y) => (y.g + y.a) - (x.g + x.a) || y.g - x.g || y.rs / y.gp - x.rs / x.gp).slice(0, 8)
    .map(({ id, n, rk, gp, g, a, rs }) => ({ id, n, rk, gp, g, a, rs: Math.round(rs * 10) / 10 }));
}
function dayAggOf(entries) {
  const o = {};
  for (const e of entries) e.p.forEach((p, i) => {
    if (!p[0]) return;
    const c = C.contrib(e, i), a = o[p[0]] || (o[p[0]] = new Array(c.length).fill(0));
    for (let k = 0; k < c.length; k++) a[k] += c[k];
  });
  for (const a of Object.values(o)) a[5] = Math.round(a[5] * 10) / 10;
  return o;
}
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
  for (const e of all) e.p.forEach((p) => perf.push({ e, p }));
  perf.sort((a, b) => b.p[3] - a.p[3] || (b.p[4] + b.p[5]) - (a.p[4] + a.p[5]));
  let best = null;
  for (const e of all) { const mv = e.p[e.v]; if (mv && (!best || mv[3] > best.p[best.v][3])) best = e; }
  const archived = isArchived(day);
  const meta = {
    d: day, n: all.length, x: archived ? 1 : 0, chunks: parts,
    counts: [...counts.entries()].map(([k, n]) => [...k.split('\u0001'), n]).sort((a, b) => b[3] - a[3]),
    lead: leaders(all),
    perf: perf.slice(0, 10).map(({ e, p }) => ({ i: e.i, k: e.k, id: p[0], n: p[1], rk: p[6], ap: p[7], rt: p[3], g: p[4], as: p[5], s: e.s, tm: p[2] })),
    best,
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
  const sum = await readJSON(P.aggM(ym), {});
  for (const d of aggDays.filter((x) => x.startsWith(ym))) {
    for (const [pid, a] of Object.entries(await readJSON(P.aggD(d), {}))) { const s = sum[pid] || (sum[pid] = new Array(a.length).fill(0)); a.forEach((x, k) => { s[k] += x; }); }
  }
  for (const a of Object.values(sum)) a[5] = Math.round(a[5] * 10) / 10;
  await out.json(P.aggM(ym), sum);
  for (const d of aggDays.filter((x) => x.startsWith(ym))) await out.rm(P.aggD(d));
}

lap('months');
// ---------- totales de carrera, 30 días y 7 días ----------
const TA = new Map(), TM = new Map(), TK = new Map();
const addTo = (map, obj) => { for (const [pid, a] of Object.entries(obj)) { const s = map.get(pid); if (!s) map.set(pid, a.slice()); else for (let k = 0; k < a.length; k++) s[k] += a[k]; } };
for (const f of await list(path.join(INT, 'agg', 'm'))) addTo(TA, await readJSON(path.join(INT, 'agg', 'm', f), {}));
for (const f of await list(path.join(INT, 'agg', 'd'))) {
  const day = f.slice(0, 10), obj = await readJSON(path.join(INT, 'agg', 'd', f), {});
  addTo(TA, obj); if (day >= M30 && day <= TODAY) addTo(TM, obj); if (day >= K7 && day <= TODAY) addTo(TK, obj);
}
for (const m of [TA, TM, TK]) for (const a of m.values()) a[5] = Math.round(a[5] * 10) / 10;

lap('totals');
// ---------- perfiles ----------
const meta = (pid) => {
  const s = players[pid] || {};
  const o = {};
  for (const k of ['rk', 'rank', 'mmr', 'prk', 'prank', 'peak', 'season', 'rmp', 'unr']) if (s[k] != null) o[k] = s[k];
  o.rh = s.rh || [];
  return o;
};
const byBucket = new Map();
for (const pid of pend.keys()) { const b = C.bucketOf(pid); if (!byBucket.has(b)) byBucket.set(b, []); byBucket.get(b).push(pid); }
if (rerate || legacy) for (const f of await list(path.join(DATA, 'p'))) if (f.endsWith('.json.gz')) { const b = f.slice(0, -8); if (!byBucket.has(b)) byBucket.set(b, []); }
const recentT = Date.parse(RECENT + 'T00:00:00Z') - 2 * H;
let profiles = 0;
for (const [b, pids] of byBucket) {
  const oldText = await readText(P.bucket(b));
  let obj = {}; try { if (oldText) obj = JSON.parse(oldText); } catch {}
  const todo = new Set(pids); if (rerate) for (const pid of Object.keys(obj)) todo.add(pid);
  for (const pid of todo) {
    const x = pend.get(pid) || { add: [], rm: new Set(), rh: false };
    const prof = obj[pid] || { games: [], names: {} };
    let games = prof.games.filter((g) => !x.rm.has(g[1]) && !hiddenNow.has(g[1]));
    if (x.add.length) { const ids = new Set(x.add.map((g) => g[1])); games = games.filter((g) => !ids.has(g[1])).concat(x.add); }
    if (rerate) for (const g of games) { const r = rerate.get(g[1]); const v = r && r.get(pid); if (v) { g[7] = v[0]; g[8] = v[1]; } }
    if (x.rh && players[pid] && players[pid].rh) for (const g of games) if (g[2] >= recentT) { const ra = C.rankAt(players[pid].rh, g[2]); g[9] = ra ? ra.rk : ''; }
    games.sort((a, b) => b[2] - a[2]); games = games.slice(0, CAP);
    const a = TA.get(pid);
    if (!a || !games.length) { delete obj[pid]; continue; }
    const names = {};
    for (const g of games) for (const o of g[13].concat(g[14])) if (!(o in names)) names[o] = (players[o] && players[o].n) || seenNames.get(o) || (prof.names && prof.names[o]) || o;
    obj[pid] = { id: pid, n: displayName(pid), meta: meta(pid), a, names, games };
    profiles++;
  }
  if (Object.keys(obj).length) await out.json(P.bucket(b), obj, oldText); else await out.rm(P.bucket(b));
}

lap('profiles');
// ---------- tablas, buscador, rankings ----------
const pubIds = [...TA.keys()].filter((pid) => TA.get(pid)[0] > 0);
const rowOf = (pid, a) => { const s = players[pid] || {}; return [pid, displayName(pid), s.rk || '', s.mmr ?? null, ...a]; };
const verOf = {};
verOf.search = (await out.json(path.join(DATA, 'search.json.gz'), pubIds.map((pid) => { const s = players[pid] || {}; return [pid, displayName(pid), s.rk || '', s.mmr ?? null, TA.get(pid)[0]]; })
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
})).v;

// atributos: cortes de percentil entre jugadores con 5+ partidos
const pool = pubIds.map((pid) => C.attrRaw(C.aggObj(TA.get(pid)))).filter((x, i) => x && TA.get(pubIds[i])[0] >= 5);
const q = {};
for (const [k] of C.ATTRS) {
  const vals = pool.map((x) => x[k]).filter((v) => v != null).sort((a, b) => a - b);
  q[k] = vals.length ? Array.from({ length: 101 }, (_, i) => Math.round(vals[Math.min(vals.length - 1, Math.round(i / 100 * (vals.length - 1)))] * 1e4) / 1e4) : [];
}
verOf.attr = (await out.json(path.join(DATA, 'attr.json'), { n: pool.length, q })).v;

lap('top/attr');
// ---------- índice y estado ----------
const dayList = Object.entries(S.days).filter(([, x]) => x.n > 0).map(([d, x]) => ({ d, n: x.n, u: x.u, ...(x.x ? { x: 1 } : {}) })).sort((a, b) => b.d.localeCompare(a.d));
const totalMatches = dayList.reduce((s, x) => s + x.n, 0), stored = dayList.filter((x) => !x.x).reduce((s, x) => s + x.n, 0);
await fs.mkdir(INT, { recursive: true });
await out.json(path.join(INT, 'state.json.gz'), S);
const nowIso = new Date().toISOString();
const lastRun = {
  at: nowIso, requests: reqs, ok, checked, ranked: rankedChecked, newMatches, discovered, seconds: Math.round((Date.now() - started) / 1000),
  crawl: Math.round(crawlMs / 1000), blocked, files: out.files, removed: out.removed, profiles, archived: archivedNow.length, ...(migrated ? { migrated } : {}), ...(rerate ? { rerated: rerate.size } : {}),
};
const prevIdx = await readJSON(path.join(DATA, 'index.json'), {});
const runs = [lastRun, ...((prevIdx.runs || []).filter((r) => r.at !== nowIso))].slice(0, 20);
const repo = process.env.GITHUB_REPOSITORY || 'mansowtcg/slapscore';
await fs.writeFile(path.join(DATA, 'index.json'), JSON.stringify({
  updated: nowIso, source: 'slapshot.gg', v: 3, retain: RETAIN,
  archive: { repo, tag: 'archivo-', file: 'partidos-' },
  files: verOf,
  totals: {
    matches: totalMatches, stored, hidden: hiddenNow.size, players: pubIds.length, known: Object.keys(players).length,
    tracked: Object.values(players).filter((p) => p.chk && !p.gone).length, ranked: Object.values(players).filter((p) => p.mmr != null).length,
  },
  lastRun, runs, days: dayList,
}));

console.log(`Peticiones: ${reqs} (${ok} correctas) · perfiles: ${checked} · rangos: ${rankedChecked}`);
console.log(`Partidos nuevos: ${newMatches}${migrated ? ` · migrados: ${migrated}` : ''} · total: ${totalMatches} (${stored} en bruto) · jugadores: ${pubIds.length} con partidos, ${Object.keys(players).length} conocidos (${discovered} nuevos)`);
console.log(`Archivos escritos: ${out.files} (${Math.round(out.bytes / 1024)} KB) · borrados: ${out.removed} · perfiles: ${profiles} · días archivados: ${archivedNow.join(', ') || 'ninguno'}`);
console.log(`Tiempo: ${Math.round(crawlMs / 1000)} s rastreando, ${Math.round((Date.now() - started - crawlMs) / 1000)} s procesando`);
if (blocked) { console.log(`Parado: ${blocked}`); if (ok === 0) process.exit(1); }
