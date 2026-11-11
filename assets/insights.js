// Resúmenes y logros de un jugador, calculados con lo que ya trae su perfil (sin pedir nada más):
// la última sesión de juego, los últimos 7 días, cuánto ha cambiado su MMR y sus logros.
// Son funciones puras (las usa app.js para pintar y share.js para las imágenes); los partidos llegan como los
// devuelve gameObj() de core.js, del más nuevo al más viejo.
import { parseRank } from './core.js';

const MIN = 60_000, DAY = 86_400_000;
// Una sesión son partidos seguidos con menos de 75 minutos entre uno y el siguiente
export const SESSION_GAP = 75 * MIN;

export function lastSession(games, now = Date.now()) {
  if (!games || !games.length) return null;
  const L = [games[0]];
  for (let i = 1; i < games.length; i++) { if (games[i - 1].t - games[i].t > SESSION_GAP) break; L.push(games[i]); }
  return { games: L, from: L[L.length - 1].t, to: L[0].t, live: now - L[0].t < 45 * MIN };
}
export const lastDays = (games, days, now = Date.now()) => (games || []).filter((g) => g.t >= now - days * DAY && g.t <= now);

// Totales de una lista de partidos
export function sumGames(L) {
  const o = { k: L.length, w: 0, l: 0, d: 0, rs: 0, g: 0, as: 0, sv: 0, mvp: 0, best: null, avg: null, streak: 0 };
  for (const g of L) {
    if (g.r === 'W') o.w++; else if (g.r === 'L') o.l++; else o.d++;
    o.rs += g.rt || 0; o.g += g.st.goals || 0; o.as += g.st.assists || 0; o.sv += g.st.saves || 0; if (g.mv) o.mvp++;
    if (!o.best || g.rt > o.best.rt || (g.rt === o.best.rt && (g.st.goals || 0) + (g.st.assists || 0) > (o.best.st.goals || 0) + (o.best.st.assists || 0))) o.best = g;
  }
  if (o.k) o.avg = o.rs / o.k;
  const r0 = L[0] && L[0].r;
  if (r0 === 'W' || r0 === 'L') { let n = 0; for (const g of L) { if (g.r === r0) n++; else break; } o.streak = r0 === 'W' ? n : -n; }
  return o;
}

// Cambio de MMR desde un momento (historial de rango del robot: [[t, mmr, rango], ...] en orden).
// null si no se sabe (sin rango o sin historial); 0 si no ha cambiado.
export function mmrDelta(meta, from) {
  const rh = meta && Array.isArray(meta.rh) ? meta.rh : [];
  if (!meta || meta.mmr == null || !rh.length) return null;
  let base = null;
  for (const e of rh) { if (e[0] <= from) base = e[1]; else break; }
  if (base == null) base = rh[0][1];   // se le empezó a seguir después: desde el primer dato que hay
  return meta.mmr - base;
}

// MMR en un momento dado (el último dato de antes; si se le empezó a seguir después, el primero que hay)
function mmrAt(meta, at) {
  const rh = meta && Array.isArray(meta.rh) ? meta.rh : []; if (!rh.length) return null;
  let v = rh[0][1]; for (const e of rh) { if (e[0] <= at) v = e[1]; else break; }
  return v;
}
// Resumen de un mes (ym: 'AAAA-MM'; dayOf(t): el día de un partido, 'AAAA-MM-DD' en hora de Madrid).
// Devuelve null si ese mes no hay partidos; si no: la lista, sus totales, los días jugados, la mejor racha de
// victorias, el mejor día (por nota media, con 3 partidos o más si los hay) y cuánto cambió el MMR en el mes.
export function monthRecap(games, ym, dayOf, meta, now = Date.now()) {
  const list = (games || []).filter((g) => dayOf(g.t).startsWith(ym));
  if (!list.length) return null;
  const sum = sumGames(list), days = new Map();
  for (const g of list) { const d = dayOf(g.t), x = days.get(d) || { d, k: 0, w: 0, l: 0, rs: 0 }; x.k++; x.rs += g.rt || 0; if (g.r === 'W') x.w++; else if (g.r === 'L') x.l++; days.set(d, x); }
  const all = [...days.values()].map((x) => ({ ...x, avg: x.rs / x.k })), min = all.some((x) => x.k >= 3) ? 3 : 1;
  const bestDay = all.filter((x) => x.k >= min).sort((a, b) => b.avg - a.avg || b.k - a.k)[0];
  // mejor racha de victorias (los partidos van del más nuevo al más viejo)
  let run = 0, best = { n: 0, from: 0, to: 0 }, end = 0;
  for (const g of list) { if (g.r === 'W') { if (!run) end = g.t; run++; if (run > best.n) best = { n: run, from: g.t, to: end }; } else run = 0; }
  const from = list[list.length - 1].t, to = Math.min(now, list[0].t + 3_600_000);
  const m0 = mmrAt(meta, from), m1 = mmrAt(meta, to);
  return { ym, list, sum, days: days.size, bestDay, streak: best, dm: meta && meta.mmr != null && m0 != null && m1 != null ? m1 - m0 : null };
}

// Puesto por nota media entre los jugadores con un mínimo de partidos (rows: tabla de 7 días, { id, a: { gp, rs } })
export function rankAmong(rows, pid, min = 10) {
  const me = rows.find((r) => String(r.id) === String(pid));
  if (!me || me.a.gp < min) return null;
  const mine = me.a.rs / me.a.gp; let pos = 1, total = 0;
  for (const r of rows) { if (r.a.gp < min) continue; total++; if (r.a.rs / r.a.gp > mine + 1e-9) pos++; }
  return { pos, total, min, avg: mine, gp: me.a.gp };
}

// ---------- logros ----------
// Mejores marcas en un partido público: [nota, goles, asistencias, paradas, racha de victorias]. El robot las guarda
// en el perfil (P.mx) aunque el partido ya no esté en su lista; aquí se juntan con las de los partidos que sí están.
export function bestMarks(P) {
  const m = Array.isArray(P.mx) ? P.mx.slice(0, 5) : [];
  for (let i = 0; i < 5; i++) m[i] = Number(m[i]) || 0;
  const pub = (P._g || []).filter((g) => g.y !== 'custom');
  let run = 0;
  for (let i = pub.length - 1; i >= 0; i--) {
    const g = pub[i];
    if (g.rt > m[0]) m[0] = g.rt; if ((g.st.goals || 0) > m[1]) m[1] = g.st.goals; if ((g.st.assists || 0) > m[2]) m[2] = g.st.assists; if ((g.st.saves || 0) > m[3]) m[3] = g.st.saves;
    if (g.r === 'W') { run++; if (run > m[4]) m[4] = run; } else run = 0;
  }
  if ((P.bs || 0) > m[4]) m[4] = P.bs;
  return m;
}
const RANK_STEPS = ['GOLD', 'PLAT', 'DIAMOND', 'LEGEND'], RANK_ORDER = ['BRONZE', 'SILVER', 'GOLD', 'PLAT', 'DIAMOND', 'LEGEND'];
// Familias de logros: cada una tiene escalones; se enseña el más alto conseguido y cuánto falta para el siguiente.
// name lleva {n} (el escalón) o {r} (el rango). Los textos se traducen con t() en app.js.
export const ACH = [
  { id: 'gp', icon: 'games', steps: [10, 50, 100, 250, 500, 1000], name: '{n} partidos' },
  { id: 'w', icon: 'trophy', steps: [10, 50, 100, 250, 500], name: '{n} victorias' },
  { id: 'g', icon: 'goal', steps: [10, 50, 100, 250, 500, 1000], name: '{n} goles' },
  { id: 'as', icon: 'assist', steps: [10, 50, 100, 250, 500], name: '{n} asistencias' },
  { id: 'sv', icon: 'shield', steps: [25, 100, 250, 500, 1000], name: '{n} paradas' },
  { id: 'mvp', icon: 'star', steps: [1, 10, 25, 50, 100], name: 'MVP ×{n}' },
  { id: 'bs', icon: 'flame', steps: [3, 5, 8, 10], name: 'Racha de {n} victorias' },
  { id: 'rt', icon: 'bolt', steps: [8, 9, 9.5, 10], name: 'Partido de {n}', rating: true },
  { id: 'mg', icon: 'goal', steps: [3, 5, 7], name: '{n} goles en un partido' },
  { id: 'ms', icon: 'shield', steps: [5, 10, 15], name: '{n} paradas en un partido' },
  { id: 'rank', icon: 'rank', steps: RANK_STEPS, name: 'Llegó a {r}' },
  { id: 'tw', icon: 'trophy', steps: [1, 3, 5, 10], name: 'Equipo de la semana ×{n}' },
  { id: 'pm', icon: 'trophy', steps: [1, 2, 3], name: 'Jugador del mes ×{n}' },
  { id: 'sup', icon: 'heart', steps: [1], name: 'Supporter' },
];
// ext: { weeks, months, sup } (premios y supporter, que no van en el perfil)
export function achievements(P, ext = {}) {
  const a = P._a || {}, mx = bestMarks(P), meta = P.meta || {};
  const pk = parseRank(meta.prk) || parseRank(meta.rk), tierIdx = pk ? RANK_ORDER.indexOf(pk.tier) : -1;
  const val = { gp: a.gp || 0, w: a.w || 0, g: a.g || 0, as: a.as || 0, sv: a.sv || 0, mvp: a.mvp || 0, bs: mx[4], rt: Math.round(mx[0] * 10) / 10, mg: mx[1], ms: mx[3],
    tw: ext.weeks || 0, pm: ext.months || 0, sup: ext.sup ? 1 : 0 };
  return ACH.map((f) => {
    let lvl = -1, value, next = null, prog = 0;
    if (f.id === 'rank') {
      value = tierIdx; for (let i = 0; i < f.steps.length; i++) if (tierIdx >= RANK_ORDER.indexOf(f.steps[i])) lvl = i;
      next = lvl + 1 < f.steps.length ? f.steps[lvl + 1] : null;
    } else {
      value = val[f.id]; for (let i = 0; i < f.steps.length; i++) if (value >= f.steps[i]) lvl = i;
      next = lvl + 1 < f.steps.length ? f.steps[lvl + 1] : null;
      if (next != null) { const from = lvl >= 0 ? f.steps[lvl] : 0; prog = Math.max(0, Math.min(1, (value - from) / (next - from))); }
    }
    // color del escalón: 1 bronce, 2 plata, 3 oro, 4 diamante (según lo lejos que llega dentro de su familia)
    const tier = lvl < 0 ? 0 : f.steps.length === 1 ? 4 : Math.max(1, Math.ceil(((lvl + 1) / f.steps.length) * 4));
    return { id: f.id, icon: f.icon, name: f.name, rating: !!f.rating, lvl, tier, got: lvl >= 0 ? f.steps[lvl] : null, value, next, prog, max: next == null && lvl >= 0, total: f.steps.length };
  });
}
