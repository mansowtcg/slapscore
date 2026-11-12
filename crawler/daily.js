// Lo del día, para el aviso diario de Discord: jugador del día, partido del día y el ranking de palos.
// Se calcula con las fichas resumidas de los partidos de un día (data/days/<día>/…), solo partidas públicas.
//   · Jugador del día: mejor nota media, con un mínimo de partidos (MIN_DAY).
//   · Palos: quién más tiros al poste por partido (mismo mínimo).
//   · Partido del día: un 3 contra 3 que acabó jugando (sin abandonos ni cierre por goleada), el más disputado y de más
//     nivel: prórroga, un gol de diferencia, goles y el rango medio de los seis.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseRank } from '../assets/core.js';

export const DAILY_HOUR = 12;   // hora de Madrid a la que sale el resumen del día anterior
export const MIN_DAY = 8;       // partidos públicos en el día para entrar en los rankings

// Todas las fichas de un día (null si ese día no hay datos)
export async function loadDay(dataDir, day) {
  let meta; try { meta = JSON.parse(await fs.readFile(path.join(dataDir, 'days', `${day}.json`), 'utf8')); } catch { return null; }
  const out = [], seen = new Set();
  for (const c of meta.chunks || []) {
    let list; try { list = JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(dataDir, 'days', day, `${c.c}.json.gz`))).toString('utf8')); } catch { continue; }
    for (const e of list) if (e && e.i && !seen.has(e.i)) { seen.add(e.i); out.push(e); }
  }
  return out;
}

const r2 = (x) => Math.round(x * 100) / 100;
// Lo emocionante y el nivel de un partido, en puntos (para elegir el del día)
export function matchScore(e) {
  const goals = e.s[0] + e.s[1], margin = Math.abs(e.s[0] - e.s[1]);
  const lv = e.p.map((p) => parseRank(p[6])).filter((r) => r && r.order >= 0).map((r) => r.order / 10);
  const level = lv.length >= 4 ? lv.reduce((a, b) => a + b, 0) / lv.length : 0;
  return (e.o ? 3 : 0) + (margin <= 1 ? 2 : margin === 2 ? 0.5 : 0) + Math.min(goals, 10) * 0.4 + level * 1.5;
}
// entries: fichas del día; hidden: jugadores que no deben salir
export function computeDaily(entries, { hidden = new Set(), min = MIN_DAY } = {}) {
  const pub = (entries || []).filter((e) => e && e.y !== 'custom' && Array.isArray(e.p) && Array.isArray(e.s));
  const P = new Map();
  for (const e of pub) for (const p of e.p) {
    const id = String(p[0]); if (!/^\d{1,12}$/.test(id) || hidden.has(id)) continue;
    const x = P.get(id) || { id, n: p[1], rk: '', gp: 0, w: 0, mvp: 0, rs: 0, g: 0, as: 0, ph: 0, t: 0 };
    x.gp++; x.rs += Number(p[3]) || 0; x.g += p[4] || 0; x.as += p[5] || 0; x.ph += p[18] || 0;
    if (e.w === p[2]) x.w++;
    if (e.p[e.v] === p) x.mvp++;
    if ((e.t || 0) >= x.t) { x.t = e.t || 0; x.n = p[1]; x.rk = p[6] || x.rk; }   // nombre y rango del último partido
    P.set(id, x);
  }
  const ok = [...P.values()].filter((x) => x.gp >= min);
  const potd = ok.map((x) => ({ id: x.id, n: x.n, rk: x.rk, gp: x.gp, w: x.w, mvp: x.mvp, rt: r2(x.rs / x.gp), g: x.g, as: x.as }))
    .sort((a, b) => b.rt - a.rt || b.gp - a.gp || (a.id < b.id ? -1 : 1)).slice(0, 3);
  const posts = ok.filter((x) => x.ph > 0).map((x) => ({ id: x.id, n: x.n, gp: x.gp, ph: x.ph, per: r2(x.ph / x.gp) }))
    .sort((a, b) => b.per - a.per || b.ph - a.ph || (a.id < b.id ? -1 : 1)).slice(0, 5);
  // partido del día
  let best = null;
  for (const e of pub) {
    if (e.f !== '3v3' || e.p.length !== 6 || !['EndOfRegulation', 'Overtime'].includes(e.e) || !/^\d{4}-\d\d-\d\d\/\d\d$/.test(String(e.k))) continue;
    if (e.p.some((p) => hidden.has(String(p[0])))) continue;
    const sc = matchScore(e);
    if (!best || sc > best.sc || (sc === best.sc && e.t > best.e.t)) best = { sc, e };
  }
  let motd = null;
  if (best) {
    const e = best.e, pl = (tm) => e.p.filter((p) => p[2] === tm).sort((a, b) => b[3] - a[3]).map((p) => ({ id: String(p[0]), n: p[1], rt: p[3], g: p[4] || 0, a: p[5] || 0 }));
    const m = e.p[e.v];
    motd = { id: e.i, key: e.k, t: e.t, ot: !!e.o, score: [e.s[0], e.s[1]], arena: e.a || '', home: pl(0), away: pl(1),
      mvp: m ? { id: String(m[0]), n: m[1], rt: m[3], g: m[4] || 0, a: m[5] || 0, sv: m[9] || 0 } : null };
  }
  return { games: pub.length, players: P.size, min, potd, posts, motd };
}
