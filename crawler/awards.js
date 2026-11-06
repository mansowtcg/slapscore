// Premios de SlapScore: equipo de la semana (los 3 mejores) y jugador del mes.
// Mejor nota media en partidas públicas (las custom no cuentan), con un mínimo de partidos en el periodo.
// Semanas de lunes a domingo y meses naturales, en hora de Madrid. Se calculan con los totales por día del robot
// (_int/agg/d) y, en los meses ya cerrados, con el total del mes (_int/agg/m).
// Devuelve el archivo data/awards.json y actualiza el historial (state.aw).

export const MIN_WEEK = 20, MIN_MONTH = 60;
const KEEP_W = 26, KEEP_M = 12, BACKFILL_W = 12, BACKFILL_M = 6;

const add = (map, obj) => { for (const [pid, a] of Object.entries(obj || {})) { const s = map.get(pid); if (!s) map.set(pid, a.slice()); else for (let k = 0; k < a.length; k++) s[k] += a[k] || 0; } };

// io: { dayAdd, today, dayTotals(day) -> {pid: agg} | null, monthTotals(ym) -> {pid: agg} | null, info(pid) -> { n, rk }, hidden: Set }
export async function computeAwards(io, state = {}) {
  const { dayAdd, today } = io;
  const monday = (day) => dayAdd(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const prevMonth = (ym) => dayAdd(ym + '-01', -1).slice(0, 7);
  const cache = new Map();
  const day = async (d) => { if (!cache.has(d)) cache.set(d, await io.dayTotals(d)); return cache.get(d); };
  async function sumDays(from, to) { const t = new Map(); for (let d = from; d <= to; d = dayAdd(d, 1)) add(t, await day(d)); return t; }
  async function sumMonth(ym, upTo) {
    const t = new Map(); add(t, await io.monthTotals(ym));
    const end = lastDay(ym) < upTo ? lastDay(ym) : upTo;
    for (let d = ym + '-01'; d <= end; d = dayAdd(d, 1)) add(t, await day(d));
    return t;
  }
  const row = (pid, a) => { const i = io.info(pid) || {}; return { id: pid, n: i.n || pid, rk: i.rk || '', gp: a[0], w: a[1], mvp: a[4], rt: Math.round((a[5] / a[0]) * 100) / 100, g: a[6], as: a[7] }; };
  const ranked = (t, min, n = 10) => [...t.entries()]
    .filter(([pid, a]) => a[0] >= min && /^\d{1,12}$/.test(pid) && !io.hidden.has(pid))
    .map(([pid, a]) => row(pid, a)).sort((x, y) => y.rt - x.rt || y.gp - x.gp || (x.id < y.id ? -1 : 1)).slice(0, n);
  const compact = (l) => l.map((x) => [x.id, x.n, x.rk, x.rt, x.gp]);

  const aw = state.aw && typeof state.aw === 'object' ? state.aw : { w: {}, m: {} };
  aw.w = aw.w || {}; aw.m = aw.m || {};
  const wk = monday(today), lastW = dayAdd(wk, -7);
  const ym = today.slice(0, 7), lastM = prevMonth(ym);

  // historial: la última semana y el último mes se recalculan siempre (pueden llegar partidos tarde); los anteriores, solo si faltan
  for (let i = 1; i <= BACKFILL_W; i++) {
    const f = dayAdd(wk, -7 * i);
    if (i > 1 && aw.w[f]) continue;
    const top = ranked(await sumDays(f, dayAdd(f, 6)), MIN_WEEK, 3);
    if (top.length) aw.w[f] = compact(top); else delete aw.w[f];
  }
  for (let i = 1, m = lastM; i <= BACKFILL_M; i++, m = prevMonth(m)) {
    if (i > 1 && aw.m[m]) continue;
    const top = ranked(await sumMonth(m, today), MIN_MONTH, 3);
    if (top.length) aw.m[m] = compact(top); else delete aw.m[m];
  }
  for (const k of Object.keys(aw.w).sort().reverse().slice(KEEP_W)) delete aw.w[k];
  for (const k of Object.keys(aw.m).sort().reverse().slice(KEEP_M)) delete aw.m[k];
  state.aw = aw;

  // nombres y rangos al día en el historial
  const fresh = (top) => top.map(([id, n, rk, rt, gp]) => { const i = io.info(id) || {}; return [id, i.n || n, i.rk || rk, rt, gp]; });
  return {
    v: 1, minW: MIN_WEEK, minM: MIN_MONTH,
    week: {
      cur: { f: wk, t: dayAdd(wk, 6), list: ranked(await sumDays(wk, today), MIN_WEEK) },
      last: { f: lastW, t: dayAdd(lastW, 6), list: ranked(await sumDays(lastW, dayAdd(lastW, 6)), MIN_WEEK) },
    },
    month: {
      cur: { m: ym, list: ranked(await sumMonth(ym, today), MIN_MONTH) },
      last: { m: lastM, list: ranked(await sumMonth(lastM, today), MIN_MONTH) },
    },
    hist: {
      w: Object.keys(aw.w).sort().reverse().map((f) => ({ f, t: dayAdd(f, 6), top: fresh(aw.w[f]) })),
      m: Object.keys(aw.m).sort().reverse().map((m) => ({ m, top: fresh(aw.m[m]) })),
    },
  };
}
