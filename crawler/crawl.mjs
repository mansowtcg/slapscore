// Robot de rastreo de SlapScore.
// Consulta la API de slapshot.gg jugador a jugador (últimos 10 partidos + rango),
// guarda los partidos nuevos en data/matches/AAAA-MM.json y descubre a los jugadores
// que aparecen en ellos. Respeta el límite de slapshot.gg (10 peticiones por minuto).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const API = 'https://slapshot.gg/api/game/players/';
const UA = 'SlapScoreBot/1.0 (+https://github.com/mansowtcg/slapscore)';

const BUDGET_MS = Number(process.env.TIME_BUDGET_MS || 8 * 60_000); // tiempo máximo por ejecución
const MAX_REQ = Number(process.env.MAX_REQUESTS || 70);              // peticiones máximas por ejecución
const GAP_MS = Number(process.env.GAP_MS || 6700);                   // ~9 peticiones/min (límite: 10)
const RANKED_SHARE = 0.25;                                           // parte del presupuesto para rango/MMR
const H = 3_600_000, D = 24 * H;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = async (f, dflt) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return dflt; } };
const writeJSON = async (f, v) => { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(v)); };

const started = Date.now();
const seeds = (await readJSON(path.join(DATA, 'seeds.json'), [])).map(String);
const pdoc = await readJSON(path.join(DATA, 'players.json'), { players: {} });
const players = pdoc.players || {};
const index = await readJSON(path.join(DATA, 'index.json'), { shards: [] });

// Partidos ya guardados, por mes
const shards = new Map();
for (const s of index.shards || []) shards.set(s.month, await readJSON(path.join(DATA, s.file), []));
const known = new Set();
for (const arr of shards.values()) for (const m of arr) known.add(m.id);
const dirty = new Set();

for (const id of seeds) {
  if (!players[id]) players[id] = { n: null, found: started };
  players[id].seed = true;
}

// Cada cuánto se vuelve a mirar a un jugador según lo activo que esté
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
  if (!p.chk || p.gone) return -1;
  if (!p.seen || started - p.seen > 14 * D) return -1;
  if (p.rchk && Date.now() - p.rchk < 3 * D) return -1;
  return (p.rchk ? 0 : 1e9) + (p.hits || 0) * 1e3 + (p.seen || 0) / 1e9;
}
function pick(scoreFn) {
  let best = null, bestScore = -1;
  for (const [id, p] of Object.entries(players)) {
    const s = scoreFn(p);
    if (s > bestScore) { bestScore = s; best = id; }
  }
  return best;
}

let reqs = 0, nextAt = 0, fails = 0, ok = 0, blocked = null;
async function get(url) {
  const wait = nextAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextAt = Date.now() + GAP_MS;
  reqs++;
  let res;
  try { res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } }); }
  catch (e) { return { err: 'network', msg: String(e) }; }
  const rem = res.headers.get('x-ratelimit-remaining');
  const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
  if ((rem === '0' || res.status === 429) && reset) {
    const until = reset + 1000;
    if (until > nextAt && until - Date.now() < 90_000) nextAt = until;
  }
  if (res.status === 429) return { err: 'rate', status: 429 };
  if (res.status === 404) return { err: 'missing', status: 404 };
  if (!res.ok) return { err: 'http', status: res.status };
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) return { err: 'notjson', status: res.status };
  try { return { data: await res.json() }; } catch { return { err: 'badjson', status: res.status }; }
}

let newMatches = 0, checked = 0, rankedChecked = 0, discovered = 0;
const before = Object.keys(players).length;

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
    if (r.err === 'missing') { if (kind === 'history') { p.chk = Date.now(); p.gone = true; } else p.rchk = Date.now(); continue; }
    if (r.status === 403 || r.status === 503 || r.err === 'notjson') { blocked = `slapshot.gg respondió ${r.status || r.err}`; break; }
    if (kind === 'history') p.chk = Date.now(); else p.rchk = Date.now();
    if (++fails >= 5) { blocked = 'demasiados errores seguidos'; break; }
    continue;
  }
  fails = 0; ok++;

  if (kind === 'ranked') {
    rankedChecked++;
    const d = r.data || {};
    p.rchk = Date.now();
    if (d.rating != null) p.mmr = Number(d.rating);
    if (d.highest_rating != null) p.peak = Number(d.highest_rating);
    if (d.rank && d.rank.name) { p.rank = d.rank.name; p.rk = d.rank.key; }
    if (d.highest_rank && d.highest_rank.name) p.prank = d.highest_rank.name;
    if (d.season) p.season = d.season;
    if (d.matches_played != null) p.rmp = Number(d.matches_played);
    continue;
  }

  checked++;
  const d = r.data || {};
  p.chk = Date.now();
  delete p.gone;
  if (d.username) p.n = d.username;
  if (d.is_premium != null) p.prem = !!d.is_premium;
  for (const m of d.match_history || []) {
    if (!m || !m.id || !m.game_stats) continue;
    const t = Date.parse(m.created) || 0;
    const plist = Array.isArray(m.game_stats.players) ? m.game_stats.players : [];
    for (const pl of plist) {
      const pid = String(pl.game_user_id || '');
      if (!pid) continue;
      let q = players[pid];
      if (!q) { q = players[pid] = { n: pl.username || null, found: Date.now() }; discovered++; }
      if (pl.username && !q.chk && t >= (q.seen || 0)) q.n = pl.username;
      if (t > (q.seen || 0)) q.seen = t;
    }
    if (known.has(m.id)) continue;
    known.add(m.id);
    newMatches++;
    for (const pl of plist) { const q = players[String(pl.game_user_id || '')]; if (q) q.hits = (q.hits || 0) + 1; }
    const month = (m.created || '').slice(0, 7) || 'sin-fecha';
    if (!shards.has(month)) shards.set(month, []);
    shards.get(month).push(m);
    dirty.add(month);
  }
}

// Guardar
for (const month of dirty) {
  const arr = shards.get(month).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  await writeJSON(path.join(DATA, 'matches', `${month}.json`), arr);
}
const shardList = [...shards.entries()]
  .map(([month, arr]) => ({ month, file: `matches/${month}.json`, n: arr.length }))
  .sort((a, b) => b.month.localeCompare(a.month));
const total = shardList.reduce((a, s) => a + s.n, 0);
const tracked = Object.values(players).filter((p) => p.chk && !p.gone).length;
const now = new Date().toISOString();
await writeJSON(path.join(DATA, 'players.json'), { updated: now, players });
await writeJSON(path.join(DATA, 'index.json'), {
  updated: now,
  source: 'slapshot.gg',
  shards: shardList,
  totals: { matches: total, players: Object.keys(players).length, tracked },
  lastRun: { at: now, requests: reqs, ok, checked, ranked: rankedChecked, newMatches, discovered, seconds: Math.round((Date.now() - started) / 1000), blocked },
});

console.log(`Peticiones: ${reqs} (${ok} correctas) · jugadores mirados: ${checked} · rangos: ${rankedChecked}`);
console.log(`Partidos nuevos: ${newMatches} · total: ${total} · jugadores: ${Object.keys(players).length} (${before} antes, ${discovered} nuevos)`);
if (blocked) {
  console.log(`Parado: ${blocked}`);
  if (ok === 0) process.exit(1);
}
