// Robot de SlapScore.
// 1) Rastrea slapshot.gg jugador a jugador (últimos 10 partidos + rango/MMR) respetando su límite.
// 2) Guarda los partidos en bruto por día y hora (data/full/AAAA-MM-DD/HH.json, hora de Madrid).
// 3) Reconstruye todo lo que lee la web: días, jugadores, perfiles, rankings e índice.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../assets/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const SETTINGS = path.join(ROOT, 'config', 'settings.json');
const API = 'https://slapshot.gg/api/game/players/';
const UA = 'SlapScoreBot/2.0 (+https://github.com/mansowtcg/slapscore)';

const BUDGET_MS = Number(process.env.TIME_BUDGET_MS ?? 8 * 60_000);
const MAX_REQ = Number(process.env.MAX_REQUESTS ?? 150);
const GAP_MS = Number(process.env.GAP_MS ?? 6700);       // ≤ 9 peticiones/min (límite de slapshot.gg: 10)
const RANKED_SHARE = 0.35;
const H = 3_600_000, D = 24 * H;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = async (f, dflt) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return dflt; } };
let written = 0;
async function writeIfChanged(file, value) {
  const s = JSON.stringify(value);
  let old = null; try { old = await fs.readFile(file, 'utf8'); } catch {}
  if (old === s) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, s); written++;
  return true;
}
async function listJSON(dir) {
  try { return (await fs.readdir(dir)).filter((f) => f.endsWith('.json')); } catch { return []; }
}

const started = Date.now();
const settings = await readJSON(SETTINGS, {});
const W = C.weightsFrom(settings.weights);
const hidden = new Set((settings.hidden || []).map(String));
const seeds = [...new Set([...(settings.seeds || []), ...(await readJSON(path.join(DATA, 'seeds.json'), []))].map(String))];

// ---------- estado del robot ----------
const stateDoc = await readJSON(path.join(DATA, 'state.json'), null);
const players = (stateDoc && stateDoc.players) || {};
if (!stateDoc) {
  // migración desde el formato anterior (data/players.json con datos internos)
  const old = await readJSON(path.join(DATA, 'players.json'), null);
  if (old && old.players) for (const [id, p] of Object.entries(old.players)) {
    if (!('found' in p) && !('chk' in p)) continue;
    players[id] = p;
    if (p.mmr != null && p.rk && !p.rh) p.rh = [[p.rchk || started, p.mmr, p.rk]];
  }
}
for (const p of Object.values(players)) {
  if (!p.prk && p.prank) p.prk = C.rankKeyFromName(p.prank) || undefined;
  if (!p.rk && p.rank) p.rk = C.rankKeyFromName(p.rank) || undefined;
}
for (const id of seeds) { if (!players[id]) players[id] = { n: null, found: started }; players[id].seed = true; }
for (const [id, p] of Object.entries(players)) if (p.seed && !seeds.includes(id)) delete p.seed;

// ---------- almacén de partidos en bruto ----------
const store = new Map();            // id -> { raw, key }
const dirty = new Set();
const shardKey = (raw) => { const m = C.madrid(Date.parse(raw.created) || 0); return `${m.day}/${m.hour}`; };
function addRaw(raw) {
  if (!raw || !raw.id || !raw.game_stats || !Array.isArray(raw.game_stats.players)) return false;
  if (store.has(raw.id)) return false;
  const key = shardKey(raw);
  store.set(raw.id, { raw, key }); dirty.add(key);
  return true;
}
const FULL = path.join(DATA, 'full');
for (const day of (await fs.readdir(FULL).catch(() => []))) {
  for (const f of await listJSON(path.join(FULL, day))) {
    const key = `${day}/${f.slice(0, -5)}`;
    for (const raw of await readJSON(path.join(FULL, day, f), [])) if (raw && raw.id && !store.has(raw.id)) store.set(raw.id, { raw, key });
  }
}
// migración: formato anterior por meses
let legacy = 0;
for (const f of await listJSON(path.join(DATA, 'matches'))) for (const raw of await readJSON(path.join(DATA, 'matches', f), [])) if (addRaw(raw)) legacy++;

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
function snapshot(p, mmr, rk, t) {
  p.rh = p.rh || [];
  const last = p.rh[p.rh.length - 1];
  if (last && last[1] === mmr && last[2] === rk) return;
  p.rh.push([t, mmr, rk]);
  if (p.rh.length > 80) p.rh.splice(0, p.rh.length - 80);
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
    if (d.rating != null && d.rank && d.rank.key) {
      p.mmr = Number(d.rating); p.rk = d.rank.key; p.rank = d.rank.name; delete p.unr;
      snapshot(p, p.mmr, p.rk, Date.now());
    } else p.unr = true;
    if (d.highest_rating != null) p.peak = Number(d.highest_rating);
    if (d.highest_rank && d.highest_rank.key) { p.prk = d.highest_rank.key; p.prank = d.highest_rank.name; }
    if (d.season) p.season = d.season;
    if (d.matches_played != null) p.rmp = Number(d.matches_played);
    continue;
  }
  checked++;
  p.chk = Date.now(); delete p.gone;
  if (d.username) p.n = d.username;
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
    if (addRaw(m)) {
      newMatches++;
      for (const pl of plist) { const q = players[String(pl.game_user_id || '')]; if (q) q.hits = (q.hits || 0) + 1; }
    }
  }
}

// ---------- guardar partidos en bruto ----------
const byShard = new Map();
for (const v of store.values()) { if (!byShard.has(v.key)) byShard.set(v.key, []); byShard.get(v.key).push(v.raw); }
for (const key of dirty) {
  const arr = (byShard.get(key) || []).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  const [day, hour] = key.split('/');
  await writeIfChanged(path.join(FULL, day, `${hour}.json`), arr);
}
if (legacy) await fs.rm(path.join(DATA, 'matches'), { recursive: true, force: true });
await fs.rm(path.join(DATA, 'seeds.json'), { force: true });

// ---------- reconstruir lo que lee la web ----------
const now = Date.now();
const norms = [];
for (const { raw, key } of store.values()) {
  if (hidden.has(String(raw.id))) continue;
  const m = C.normalize(raw, W);
  if (!m || !m.id) continue;
  m.key = key; norms.push(m);
}
norms.sort((a, b) => b.t - a.t);

const nameOf = new Map();
for (const m of norms) for (const p of m.players) if (p.pid && !nameOf.has(p.pid)) nameOf.set(p.pid, p.name);
const displayName = (pid) => (players[pid] && players[pid].chk && players[pid].n) || nameOf.get(pid) || (players[pid] && players[pid].n) || pid;
for (const m of norms) for (const p of m.players) {
  const st = players[p.pid];
  const ra = st && st.rh ? C.rankAt(st.rh, m.t) : null;
  p.rk = ra ? ra.rk : ''; p.rkApprox = ra ? ra.approx : false;
}

const stats = (st) => { const o = {}; for (const [k, v] of Object.entries(st)) if (v && !C.META_STATS.has(k)) o[k] = v; return o; };
const days = new Map(), games = new Map();
for (const m of norms) {
  const day = m.key.slice(0, 10);
  if (!days.has(day)) days.set(day, []);
  days.get(day).push({
    i: m.id, k: m.key, t: m.t, y: m.type, r: m.region, a: m.arena, e: m.endReason, o: m.ot ? 1 : 0,
    s: [m.score.home, m.score.away], w: m.winner === 'home' ? 0 : m.winner === 'away' ? 1 : -1, v: m.mvp, f: m.format,
    p: m.players.map((p) => [p.pid, p.name, p.team === 'home' ? 0 : 1, p.rating, p.st.goals || 0, p.st.assists || 0, p.rk, p.rkApprox ? 1 : 0]),
  });
  m.players.forEach((p, idx) => {
    if (!p.pid) return;
    const other = p.team === 'home' ? 'away' : 'home';
    if (!games.has(p.pid)) games.set(p.pid, []);
    games.get(p.pid).push({
      k: m.key, i: m.id, t: m.t, tm: p.team === 'home' ? 0 : 1, gf: m.score[p.team], ga: m.score[other], r: p.res, rt: p.rating,
      mv: idx === m.mvp ? 1 : 0, st: stats(p.st), rk: p.rk, y: m.type, f: m.format, ar: m.arena,
      mt: m.players.filter((o) => o.team === p.team && o !== p).map((o) => o.pid),
      op: m.players.filter((o) => o.team === other).map((o) => o.pid),
    });
  });
}

function agg(list) {
  const a = { gp: 0, w: 0, l: 0, d: 0, mvp: 0, rs: 0, g: 0, as: 0, sh: 0, sv: 0, ps: 0, tk: 0, bl: 0, to: 0, po: 0, fw: 0, fl: 0, ph: 0 };
  for (const g of list) {
    const s = g.st; a.gp++; a[g.r === 'W' ? 'w' : g.r === 'L' ? 'l' : 'd']++; a.mvp += g.mv; a.rs += g.rt;
    a.g += s.goals || 0; a.as += s.assists || 0; a.sh += s.shots || 0; a.sv += s.saves || 0; a.ps += s.passes || 0;
    a.tk += s.takeaways || 0; a.bl += s.blocks || 0; a.to += s.turnovers || 0; a.po += s.possession_time_sec || 0;
    a.fw += s.faceoffs_won || 0; a.fl += s.faceoffs_lost || 0; a.ph += s.post_hits || 0;
  }
  a.rs = Math.round(a.rs * 10) / 10;
  return a;
}
const meta = (pid) => {
  const s = players[pid] || {};
  const o = {};
  for (const k of ['rk', 'rank', 'mmr', 'prk', 'prank', 'peak', 'season', 'rmp', 'unr']) if (s[k] != null) o[k] = s[k];
  return o;
};

// atributos (percentiles entre jugadores con 5+ partidos)
const pop = [];
for (const [pid, list] of games) {
  const a = agg(list); if (a.gp < 5) continue;
  pop.push({ pid, atk: (a.g + 0.3 * a.sh + 0.2 * a.ph) / a.gp, cre: (a.as + 0.12 * a.ps) / a.gp, def: (0.5 * a.tk + 0.6 * a.bl + 0.6 * a.sv) / a.gp,
    ctl: (0.02 * a.po - 0.5 * a.to) / a.gp, fo: (a.fw + a.fl) >= 5 ? a.fw / (a.fw + a.fl) : null });
}
const attrs = new Map();
for (const key of ['atk', 'cre', 'def', 'ctl', 'fo']) {
  const vals = pop.filter((x) => x[key] != null).sort((a, b) => a[key] - b[key]);
  vals.forEach((x, i) => { if (!attrs.has(x.pid)) attrs.set(x.pid, {}); attrs.get(x.pid)[key] = vals.length > 1 ? Math.round(i / (vals.length - 1) * 100) : 50; });
}

const DAYS30 = now - 30 * D, DAYS7 = now - 7 * D;
const pubPlayers = {}, generated = new Set();
for (const [pid, list] of games) {
  const a = agg(list), m30 = agg(list.filter((g) => g.t >= DAYS30)), k7 = agg(list.filter((g) => g.t >= DAYS7));
  const entry = { n: displayName(pid), ...meta(pid), seen: list[0].t, a };
  if (m30.gp) entry.m = m30;
  if (k7.gp) entry.k = k7;
  pubPlayers[pid] = entry;
  const ref = new Set(); for (const g of list.slice(0, 400)) { g.mt.forEach((x) => ref.add(x)); g.op.forEach((x) => ref.add(x)); }
  const names = {}; for (const x of ref) names[x] = displayName(x);
  const fid = C.fileId(pid); generated.add(fid + '.json');
  await writeIfChanged(path.join(DATA, 'p', fid + '.json'), {
    id: pid, n: entry.n, meta: { ...meta(pid), rh: (players[pid] && players[pid].rh) || [] }, attr: attrs.get(pid) || null, pop: pop.length,
    a, m: entry.m || null, k: entry.k || null, total: list.length, names, games: list.slice(0, 400),
  });
}
for (const f of await listJSON(path.join(DATA, 'p'))) if (!generated.has(f)) { await fs.rm(path.join(DATA, 'p', f)); written++; }

const dayFiles = new Set();
for (const [day, list] of days) { dayFiles.add(day + '.json'); await writeIfChanged(path.join(DATA, 'days', day + '.json'), list); }
for (const f of await listJSON(path.join(DATA, 'days'))) if (!dayFiles.has(f)) { await fs.rm(path.join(DATA, 'days', f)); written++; }

await writeIfChanged(path.join(DATA, 'players.json'), { players: pubPlayers });

// rankings rápidos para la portada
const withMMR = Object.entries(pubPlayers).filter(([, p]) => p.mmr != null).sort((a, b) => b[1].mmr - a[1].mmr);
const avgPool = (win, min) => Object.entries(pubPlayers).map(([id, p]) => [id, p, p[win]]).filter(([, , a]) => a && a.gp >= min)
  .sort((x, y) => y[2].rs / y[2].gp - x[2].rs / x[2].gp);
let avgList = avgPool('m', 5); if (avgList.length < 5) avgList = avgPool('a', 3);
const perf = [];
for (const m of norms) { if (m.t < DAYS7) break; m.players.forEach((p) => perf.push({ m, p })); }
perf.sort((a, b) => b.p.rating - a.p.rating || b.p.rawRating - a.p.rawRating);
const active = Object.entries(pubPlayers).filter(([, p]) => p.k).sort((a, b) => b[1].k.gp - a[1].k.gp);
await writeIfChanged(path.join(DATA, 'top.json'), {
  mmr: withMMR.slice(0, 10).map(([id, p]) => ({ id, n: p.n, rk: p.rk, rank: p.rank, mmr: p.mmr })),
  avg: avgList.slice(0, 10).map(([id, p, a]) => ({ id, n: p.n, rk: p.rk || '', avg: Math.round(a.rs / a.gp * 100) / 100, gp: a.gp })),
  perf: perf.slice(0, 10).map(({ m, p }) => ({ i: m.id, k: m.key, id: p.pid, n: p.name, rk: p.rk, rt: p.rating, g: p.st.goals || 0, as: p.st.assists || 0, s: [m.score.home, m.score.away], tm: p.team === 'home' ? 0 : 1 })),
  active: active.slice(0, 10).map(([id, p]) => ({ id, n: p.n, rk: p.rk || '', gp: p.k.gp, avg: Math.round(p.k.rs / p.k.gp * 100) / 100 })),
});

const dayList = [...days.entries()].map(([d, list]) => ({ d, n: list.length })).sort((a, b) => b.d.localeCompare(a.d));
const stateOut = { players };
await fs.writeFile(path.join(DATA, 'state.json'), JSON.stringify(stateOut));
const nowIso = new Date().toISOString();
const lastRun = { at: nowIso, requests: reqs, ok, checked, ranked: rankedChecked, newMatches, discovered, seconds: Math.round((Date.now() - started) / 1000), blocked, files: written };
const prevIdx = await readJSON(path.join(DATA, 'index.json'), {});
const runs = [lastRun, ...((prevIdx.runs || []).filter((r) => r.at !== nowIso))].slice(0, 20);
await fs.writeFile(path.join(DATA, 'index.json'), JSON.stringify({
  updated: nowIso, source: 'slapshot.gg',
  totals: {
    matches: norms.length, stored: store.size, hidden: hidden.size, players: games.size, known: Object.keys(players).length,
    tracked: Object.values(players).filter((p) => p.chk && !p.gone).length, ranked: Object.values(players).filter((p) => p.mmr != null).length,
  },
  lastRun, runs, days: dayList,
}));

console.log(`Peticiones: ${reqs} (${ok} correctas) · perfiles: ${checked} · rangos: ${rankedChecked}`);
console.log(`Partidos nuevos: ${newMatches}${legacy ? ` · migrados: ${legacy}` : ''} · total: ${norms.length} · jugadores: ${games.size} con partidos, ${Object.keys(players).length} conocidos (${discovered} nuevos)`);
console.log(`Archivos escritos: ${written}`);
if (blocked) { console.log(`Parado: ${blocked}`); if (ok === 0) process.exit(1); }
