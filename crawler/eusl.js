// Liga EUSL (eusl.gg): clasificación, resultados, próximos partidos y máximos anotadores de la temporada.
// Usa la API pública de SportsPress de eusl.gg y escribe data/eusl.json. Como mucho una vez por hora.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, Writer, hash } from './io.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const OUT = path.join(DATA, 'eusl.json');
const BASE = 'https://www.eusl.gg/wp-json/sportspress/v2/';
const UA = 'SlapScoreBot/3.0 (+https://github.com/mansowtcg/slapscore)';
const EVERY = Number(process.env.EUSL_EVERY_MS ?? 60 * 60_000);

const prev = await readJSON(OUT, null);
if (prev && !process.env.FORCE_EUSL && Date.now() - Date.parse(prev.updated) < EVERY) { console.log('EUSL: actualizado hace poco'); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
async function get(q) {
  await sleep(calls++ ? 700 : 0);
  const r = await fetch(BASE + q, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`${q.split('?')[0]}: ${r.status}`);
  return { data: await r.json(), pages: Number(r.headers.get('x-wp-totalpages') || 1) };
}
async function all(q, max = 4) {
  const first = await get(q + '&page=1'); let out = first.data;
  for (let p = 2; p <= Math.min(first.pages, max); p++) out = out.concat((await get(`${q}&page=${p}`)).data);
  return out;
}
const txt = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&#8211;/g, '–').replace(/&#8217;/g, '’').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim();
const n = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };

try {
  const leagues = Object.fromEntries((await get('leagues?per_page=100')).data.map((l) => [l.id, txt(l.name)]));
  const seasons = (await get('seasons?per_page=100')).data.filter((s) => s.count > 0 && /season\s*\d+/i.test(s.name))
    .map((s) => ({ id: s.id, name: txt(s.name), num: Number(/(\d+)/.exec(s.name)[1]) })).sort((a, b) => b.num - a.num);
  const season = seasons[0];
  if (!season) throw new Error('sin temporadas');
  const leagueId = (name) => Number(Object.keys(leagues).find((k) => leagues[k].toLowerCase() === name));
  const PRO = leagueId('pro'), CHALL = leagueId('challenger');

  // clasificaciones de la temporada actual
  const tablesRaw = (await get(`tables?per_page=30&seasons=${season.id}`)).data;
  const tables = tablesRaw.map((t) => {
    const rows = Object.entries(t.data || {}).filter(([k]) => k !== '0').map(([id, r]) => ({
      id: Number(id), pos: n(r.pos), gp: n(r.gamesplayed), w: n(r.wins), l: n(r.losses), otw: n(r.otwins), otl: n(r.otlosses),
      gf: n(r.goalsfor), ga: n(r.goalsagainst), gd: n(r.goaldifference), pts: n(r.points), name: txt(r.name),
    })).sort((a, b) => a.pos - b.pos);
    return { id: t.id, title: txt(t.title && t.title.rendered), league: (t.leagues || [])[0] || 0, rows, link: t.link };
  }).filter((t) => t.rows.length).sort((a, b) => (a.league === PRO ? 0 : 1) - (b.league === PRO ? 0 : 1) || a.title.localeCompare(b.title));

  // partidos de la temporada (todas las competiciones)
  const evs = await all(`events?per_page=100&seasons=${season.id}&orderby=date&order=desc`, 6);
  const now = Date.now();
  const games = evs.map((e) => {
    const t = Date.parse((e.date_gmt || e.date) + 'Z');
    const teams = (e.teams || []).filter(Boolean).slice(0, 2);
    const sc = teams.map((id) => { const r = (e.results || {})[id]; return r && r.series !== '' && r.series != null ? n(r.series) : null; });
    const oc = teams.map((id) => [].concat((e.outcome || {})[id] || ((e.results || {})[id] || {}).outcome || [])[0] || '');
    return { id: e.id, t, league: (e.leagues || [])[0] || 0, teams, s: sc.every((x) => x != null) ? sc : null, ot: oc.some((o) => /overtime/i.test(o)) ? 1 : 0, link: e.link, perf: e.performance };
  });
  const results = games.filter((g) => g.s).sort((a, b) => b.t - a.t).slice(0, 30);
  const upcoming = games.filter((g) => !g.s && g.t > now - 3 * 3_600_000).sort((a, b) => a.t - b.t).slice(0, 20);

  // máximos anotadores por competición (Pro y Challenger) a partir de las estadísticas de cada partido
  const totals = new Map();
  for (const g of games) {
    if (!g.s || !g.perf || ![PRO, CHALL].includes(g.league)) continue;
    for (const [team, ps] of Object.entries(g.perf)) {
      if (team === '0' || !ps || typeof ps !== 'object') continue;
      for (const [pid, st] of Object.entries(ps)) {
        if (pid === '0' || !st || typeof st !== 'object') continue;
        const k = g.league + ':' + pid;
        const x = totals.get(k) || { pid: Number(pid), league: g.league, team: Number(team), gp: 0, g: 0, a: 0, sv: 0, sc: 0 };
        x.gp++; x.g += n(st.goals); x.a += n(st.primaryassists) + n(st.secondaryassists); x.sv += n(st.saves); x.sc += n(st.score);
        totals.set(k, x);
      }
    }
  }
  const pick = (league) => [...totals.values()].filter((x) => x.league === league).sort((a, b) => (b.g + b.a) - (a.g + a.a) || b.g - a.g).slice(0, 15);
  const scorers = { pro: pick(PRO), challenger: pick(CHALL) };
  // todos los que han jugado en Pro o Challenger (para poner su equipo en el perfil), no solo los máximos anotadores
  const pids = [...new Set([...totals.values()].map((x) => x.pid))];
  const names = {};
  for (let i = 0; i < pids.length; i += 100) for (const p of (await get(`players?per_page=100&include=${pids.slice(i, i + 100).join(',')}`)).data) names[p.id] = txt(p.title && p.title.rendered);

  // equipos: nombre, abreviatura y escudo
  const teamIds = [...new Set([...tables.flatMap((t) => t.rows.map((r) => r.id)), ...results.flatMap((g) => g.teams), ...upcoming.flatMap((g) => g.teams), ...scorers.pro.map((x) => x.team), ...scorers.challenger.map((x) => x.team)])];
  const teams = {};
  for (let i = 0; i < teamIds.length; i += 100) {
    for (const t of (await get(`teams?per_page=100&_embed=1&include=${teamIds.slice(i, i + 100).join(',')}`)).data) {
      const m = t._embedded && t._embedded['wp:featuredmedia'] && t._embedded['wp:featuredmedia'][0];
      const sz = (m && m.media_details && m.media_details.sizes) || {};
      const logo = (sz['sportspress-fit-icon'] || sz.thumbnail || {}).source_url || (m && m.source_url) || '';
      teams[t.id] = { n: txt(t.title && t.title.rendered), ab: t.abbreviation || '', logo: /^https:\/\//.test(logo) ? logo : '', link: t.link };
    }
  }
  for (const t of tables) for (const r of t.rows) if (!teams[r.id]) teams[r.id] = { n: r.name, ab: '', logo: '' };

  // enlazar con los perfiles de SlapScore cuando el nombre coincide con un solo jugador
  const search = await readJSON(path.join(DATA, 'search.json.gz'), []);
  const byName = new Map();
  for (const r of search) { const k = String(r[1]).toLowerCase(); byName.set(k, byName.has(k) ? null : r[0]); }
  const sidOf = (pid) => { const nm = (names[pid] || '').toLowerCase(); return nm.length >= 3 ? byName.get(nm) || null : null; };
  const row = (x) => ({ pid: x.pid, n: names[x.pid] || '?', sid: sidOf(x.pid), team: x.team, gp: x.gp, g: x.g, a: x.a, sv: x.sv });
  // plantillas: id de slapshot.gg -> [equipo, competición] (si jugó en las dos, donde más partidos tiene)
  const roster = {};
  for (const x of [...totals.values()].sort((a, b) => a.gp - b.gp)) { const sid = sidOf(x.pid); if (sid) roster[sid] = [x.team, x.league]; }
  for (const id of new Set(Object.values(roster).map((r) => r[0]))) if (!teams[id]) {
    try { const t = (await get(`teams/${id}`)).data; teams[id] = { n: txt(t.title && t.title.rendered), ab: t.abbreviation || '', logo: '', link: t.link }; } catch { /* sin datos del equipo */ }
  }

  const doc = {
    updated: new Date().toISOString(), source: 'https://www.eusl.gg', season: { id: season.id, name: season.name },
    leagues: Object.fromEntries([...new Set([...results, ...upcoming].map((g) => g.league))].concat([PRO, CHALL]).map((id) => [id, leagues[id] || ''])),
    tables: tables.map(({ perf, ...t }) => t),
    results: results.map(({ perf, ...g }) => g), upcoming: upcoming.map(({ perf, s, ...g }) => g),
    scorers: { pro: scorers.pro.map(row), challenger: scorers.challenger.map(row) }, teams, roster,
  };
  const { v } = await new Writer().json(OUT, doc);
  const idxFile = path.join(DATA, 'index.json');
  const idx = await readJSON(idxFile, null);
  if (idx) { idx.files = { ...(idx.files || {}), eusl: v }; await fs.writeFile(idxFile, JSON.stringify(idx)); }
  console.log(`EUSL: ${season.name} · ${tables.length} clasificaciones · ${results.length} resultados · ${upcoming.length} próximos · ${calls} peticiones`);
} catch (e) {
  console.log(`EUSL: no se pudo actualizar (${e.message}); se mantiene lo anterior`);
  if (prev) {
    const idx = await readJSON(path.join(DATA, 'index.json'), null);
    if (idx && !(idx.files || {}).eusl) { idx.files = { ...(idx.files || {}), eusl: hash(JSON.stringify(prev)) }; await fs.writeFile(path.join(DATA, 'index.json'), JSON.stringify(idx)); }
  }
}
