// SlapScore — núcleo compartido por la web y el robot de rastreo.
// Normaliza los partidos de slapshot.gg, calcula la nota de cada jugador y maneja rangos.

export const DEFAULT_WEIGHTS = {
  base: 6.0, goals: 0.55, gwg: 0.25, pa: 0.40, sa: 0.20, assists: 0.32, shots: 0.07, saves: 0.14,
  passes: 0.035, blocks: 0.12, takeaways: 0.09, turnovers: -0.11, fw: 0.04, fl: -0.025, post: 0.03,
  poss: 0.006, possCap: 0.45, win: 0.30, loss: -0.25, ga: -0.08, fmt1: 0.6, fmt2: 0.8,
};

// Etiquetas de cada peso para el panel de administración: [clave, texto, paso]
export const WEIGHT_FIELDS = [
  ['base', 'Nota de partida', 0.1], ['goals', 'Gol', 0.05], ['gwg', 'Gol de la victoria (extra)', 0.05],
  ['pa', 'Asistencia primaria', 0.05], ['sa', 'Asistencia secundaria', 0.05], ['shots', 'Tiro', 0.01],
  ['saves', 'Parada', 0.01], ['passes', 'Pase', 0.005], ['blocks', 'Bloqueo', 0.01], ['takeaways', 'Robo', 0.01],
  ['turnovers', 'Pérdida', 0.01], ['fw', 'Faceoff ganado', 0.005], ['fl', 'Faceoff perdido', 0.005],
  ['post', 'Poste', 0.01], ['poss', 'Posesión, por segundo', 0.001], ['possCap', 'Máximo por posesión', 0.05],
  ['win', 'Victoria', 0.05], ['loss', 'Derrota', 0.05], ['ga', 'Cada gol encajado', 0.01],
  ['fmt2', 'Peso de las acciones en 2v2', 0.05], ['fmt1', 'Peso de las acciones en 1v1', 0.05],
];

export const META_STATS = new Set(['games_played', 'periods_played', 'wins', 'losses', 'ties', 'overtime_wins',
  'overtime_losses', 'shutouts_against', 'was_mercy_ruled', 'has_mercy_ruled']);
export const FILL = ['goals', 'assists', 'primary_assists', 'secondary_assists', 'shots', 'saves', 'passes', 'blocks',
  'takeaways', 'turnovers', 'faceoffs_won', 'faceoffs_lost', 'post_hits', 'game_winning_goals', 'possession_time_sec', 'score'];
export const STAT_ORDER = ['goals', 'assists', 'primary_assists', 'secondary_assists', 'shots', 'saves', 'passes', 'blocks',
  'takeaways', 'turnovers', 'faceoffs_won', 'faceoffs_lost', 'post_hits', 'game_winning_goals', 'overtime_goals',
  'possession_time_sec', 'contributed_goals', 'conceded_goals', 'shutouts', 'score'];
export const LABELS = {
  goals: ['Goles', 'G'], assists: ['Asistencias', 'A'], primary_assists: ['Asist. primarias', 'A1'],
  secondary_assists: ['Asist. secundarias', 'A2'], shots: ['Tiros', 'TIR'], saves: ['Paradas', 'PAR'],
  passes: ['Pases', 'PAS'], blocks: ['Bloqueos', 'BLQ'], takeaways: ['Robos', 'ROB'], turnovers: ['Pérdidas', 'PÉR'],
  faceoffs_won: ['Faceoffs ganados', 'FO+'], faceoffs_lost: ['Faceoffs perdidos', 'FO−'], post_hits: ['Postes', 'PST'],
  game_winning_goals: ['Goles de la victoria', 'GWG'], overtime_goals: ['Goles en prórroga', 'GPR'],
  possession_time_sec: ['Posesión', 'POS'], contributed_goals: ['Goles en los que participa', 'GPA'],
  conceded_goals: ['Goles encajados', 'GE'], shutouts: ['Porterías a cero', 'P0'], score: ['Puntos de juego', 'PTS'],
};
export const TYPE_LABEL = { casual: 'Casual', ranked: 'Clasificatoria', custom: 'Personalizada', private: 'Privada', tournament: 'Torneo', league: 'Liga' };
export const END_LABEL = {
  EndOfRegulation: 'Final', Overtime: 'Final en prórroga', MercyRule: 'Regla de piedad', Forfeit: 'Rendición',
  Tie: 'Empate', AwayTeamLeft: 'Abandono visitante', HomeTeamLeft: 'Abandono local',
};

export function num(v) {
  if (v == null || v === '' || typeof v === 'object') return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
export function bool(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return null;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return null;
}
const r1 = (x) => Math.round(x * 10) / 10;
export const weightsFrom = (w) => Object.assign({}, DEFAULT_WEIGHTS, w || {});

export function fmtPoss(s) {
  s = Math.round(s || 0);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

// Nota de 3 a 10 con desglose
export function rate(st, res, ga, size, W) {
  W = W || DEFAULT_WEIGHTS;
  let r = W.base; const parts = [];
  const add = (label, n, w) => { if (!n) return; const c = n * w; r += c; parts.push({ label, n, c }); };
  add('Goles', st.goals, W.goals);
  add('Goles de la victoria', st.game_winning_goals, W.gwg);
  if (st.primary_assists || st.secondary_assists) { add('Asist. primarias', st.primary_assists, W.pa); add('Asist. secundarias', st.secondary_assists, W.sa); }
  else add('Asistencias', st.assists, W.assists);
  add('Tiros', st.shots, W.shots);
  add('Paradas', st.saves, W.saves);
  add('Pases', st.passes, W.passes);
  add('Bloqueos', st.blocks, W.blocks);
  add('Robos', st.takeaways, W.takeaways);
  add('Pérdidas', st.turnovers, W.turnovers);
  add('Faceoffs ganados', st.faceoffs_won, W.fw);
  add('Faceoffs perdidos', st.faceoffs_lost, W.fl);
  add('Postes', st.post_hits, W.post);
  const pc = Math.min(W.possCap, (st.possession_time_sec || 0) * W.poss);
  if (pc) { r += pc; parts.push({ label: 'Posesión', n: fmtPoss(st.possession_time_sec), c: pc }); }
  const f = size === 1 ? W.fmt1 : size === 2 ? W.fmt2 : 1;
  if (f !== 1) { const acts = r - W.base; if (acts) { r += acts * (f - 1); parts.push({ label: `Ajuste ${size}v${size}`, n: '×' + String(f).replace('.', ','), c: acts * (f - 1) }); } }
  if (res === 'W') { r += W.win; parts.push({ label: 'Victoria', n: '', c: W.win }); }
  else if (res === 'L') { r += W.loss; parts.push({ label: 'Derrota', n: '', c: W.loss }); }
  add('Goles encajados', ga, W.ga);
  const fin = soft(r);
  if (Math.abs(fin - r) >= 0.05) parts.push({ label: fin < r ? 'Ajuste de escala (nota muy alta)' : 'Ajuste de escala (nota muy baja)', n: '', c: fin - r });
  return { rating: Math.max(3, Math.min(10, r1(fin))), raw: r, parts };
}
// Compresión suave de los extremos: el 10 y el 3 quedan para actuaciones excepcionales
function soft(r) {
  if (r > 8.5) return 8.5 + 1.5 * (1 - Math.exp(-(r - 8.5) / 1.5));
  if (r < 4.5) return 4.5 - 1.5 * (1 - Math.exp(-(4.5 - r) / 1.5));
  return r;
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function teamOf(v) { const s = fold(v); return (s === 'away' || s === '1' || s === 'orange' || s === 'red') ? 'away' : 'home'; }

// Partido de la API de slapshot.gg -> objeto normalizado con notas
export function normalize(raw, W) {
  W = W || DEFAULT_WEIGHTS;
  const gs = (raw && raw.game_stats && typeof raw.game_stats === 'object') ? raw.game_stats : (raw || {});
  const plist = Array.isArray(gs.players) ? gs.players : [];
  if (!plist.length) return null;
  const sc = gs.score && typeof gs.score === 'object' ? gs.score : {};
  const players = plist.map((pl) => {
    const src = (pl.stats && typeof pl.stats === 'object') ? pl.stats : {};
    const st = {};
    for (const k of Object.keys(src)) { const n = num(src[k]); if (n != null) st[k] = n; }
    if (st.assists == null && (st.primary_assists != null || st.secondary_assists != null)) st.assists = (st.primary_assists || 0) + (st.secondary_assists || 0);
    for (const k of FILL) if (st[k] == null) st[k] = 0;
    return { pid: String(pl.game_user_id ?? pl.username ?? ''), name: String(pl.username || 'Jugador'), team: teamOf(pl.team), st };
  });
  const score = { home: num(sc.home), away: num(sc.away) };
  for (const tm of ['home', 'away']) if (score[tm] == null) score[tm] = players.filter((p) => p.team === tm).reduce((a, p) => a + (p.st.goals || 0), 0);
  const endReason = gs.end_reason || '';
  let winner = fold(gs.winner);
  if (winner !== 'home' && winner !== 'away') winner = score.home > score.away ? 'home' : score.away > score.home ? 'away' : null;
  if (endReason === 'Tie') winner = null;
  const size = { home: players.filter((p) => p.team === 'home').length, away: 0 };
  size.away = players.length - size.home;
  const ot = /overtime/i.test(endReason) || players.some((p) => p.st.overtime_wins || p.st.overtime_losses || p.st.overtime_goals);
  for (const p of players) {
    p.res = !winner ? 'D' : (p.team === winner ? 'W' : 'L');
    p.ga = p.st.conceded_goals != null ? p.st.conceded_goals : (p.team === 'home' ? score.away : score.home);
    const r = rate(p.st, p.res, p.ga, size[p.team], W);
    p.rating = r.rating; p.rawRating = r.raw; p.parts = r.parts;
  }
  const order = players.map((p, i) => i).sort((a, b) => players[b].rating - players[a].rating || players[b].rawRating - players[a].rawRating || (players[b].st.goals - players[a].st.goals));
  const tot = { home: {}, away: {} };
  for (const p of players) for (const k of Object.keys(p.st)) tot[p.team][k] = (tot[p.team][k] || 0) + p.st[k];
  return {
    id: String(raw.id || gs.match_id || ''), t: Date.parse(raw.created || '') || 0,
    type: fold(raw.match_type || ''), mode: fold(raw.gamemode || 'hockey'), region: raw.region || '',
    arena: gs.arena || '', endReason, ot, length: num(gs.match_length), periods: bool(gs.periods_enabled),
    score, winner, players, mvp: order[0] ?? -1, size, tot,
    format: size.home === size.away ? `${size.home}v${size.away}` : `${size.home}v${size.away}`,
  };
}

// ---------- rangos ----------
export const TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLAT', 'DIAMOND', 'LEGEND'];
export const TIER_NAME = { BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold', PLAT: 'Platinum', DIAMOND: 'Diamond', LEGEND: 'Legend' };
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
export function parseRank(rk) {
  if (!rk) return null;
  const m = /^([A-Z]+?)(?:_(I{1,3}|IV|V))?$/.exec(String(rk).toUpperCase());
  if (!m) return null;
  let tier = m[1];
  if (tier === 'PLATINUM') tier = 'PLAT';
  const ti = TIERS.indexOf(tier);
  const div = m[2] ? ROMAN[m[2]] : 0;
  return { key: rk, tier, div, order: ti < 0 ? -1 : ti * 10 + div, name: (TIER_NAME[tier] || tier) + (m[2] ? ' ' + m[2] : '') };
}
// "Platinum II" -> "PLAT_II"
export function rankKeyFromName(name) {
  const m = /^\s*([A-Za-z]+)(?:\s+(I{1,3}|IV|V))?\s*$/.exec(String(name || ''));
  if (!m) return '';
  const tier = { BRONZE: 'BRONZE', SILVER: 'SILVER', GOLD: 'GOLD', PLATINUM: 'PLAT', PLAT: 'PLAT', DIAMOND: 'DIAMOND', LEGEND: 'LEGEND' }[m[1].toUpperCase()];
  return tier ? tier + (m[2] ? '_' + m[2].toUpperCase() : '') : '';
}
// Rango en un momento dado a partir del historial [[t, mmr, rk], ...] ordenado por t
export function rankAt(rh, t) {
  if (!rh || !rh.length) return null;
  let best = null;
  for (const s of rh) { if (s[0] <= t) best = s; else break; }
  if (best) return { mmr: best[1], rk: best[2], approx: false };
  return { mmr: rh[0][1], rk: rh[0][2], approx: true };
}

// Día y hora en horario de Madrid (los días de SlapScore van de 00:00 a 24:00 hora española)
const MADRID = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
export function madrid(t) {
  const p = {}; for (const x of MADRID.formatToParts(new Date(t))) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: p.hour };
}

// Nombre de archivo seguro para un jugador
export const fileId = (pid) => String(pid).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || '_';

// ---------- formato de datos v3 ----------
// Los perfiles van agrupados en 4096 archivos (data/p/<bucket>.json.gz) para no tener decenas de miles de archivos.
export const BUCKETS = 4096;
export function hash32(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export const bucketOf = (pid) => (hash32(pid) % BUCKETS).toString(16).padStart(3, '0');

// Totales de un jugador como array compacto (en este orden)
export const AGG_KEYS = ['gp', 'w', 'l', 'd', 'mvp', 'rs', 'g', 'as', 'sh', 'sv', 'ps', 'tk', 'bl', 'to', 'po', 'fw', 'fl', 'ph', 'pt'];
export function aggObj(arr) { const o = {}; AGG_KEYS.forEach((k, i) => { o[k] = (arr && arr[i]) || 0; }); return o; }

// Resumen de cada jugador en un partido (data/days/<día>/<hora>.json.gz):
// [id, nombre, equipo, nota, G, A, rango, aprox, tiros, paradas, pases, puntos, robos, bloqueos, pérdidas, posesión, FO+, FO−, postes]
export const SP = { id: 0, name: 1, team: 2, rating: 3, g: 4, a: 5, rk: 6, approx: 7, sh: 8, sv: 9, ps: 10, pts: 11, tk: 12, bl: 13, to: 14, po: 15, fw: 16, fl: 17, ph: 18 };
// Aportación de un jugador (posición i del resumen e) a sus totales
export function contrib(e, i) {
  const p = e.p[i];
  const n = (k) => p[SP[k]] || 0;
  return [1, e.w === p[2] ? 1 : 0, e.w !== -1 && e.w !== p[2] ? 1 : 0, e.w === -1 ? 1 : 0, e.v === i ? 1 : 0, n('rating'),
    n('g'), n('a'), n('sh'), n('sv'), n('ps'), n('tk'), n('bl'), n('to'), n('po'), n('fw'), n('fl'), n('ph'), n('pts')];
}

// Partido de un perfil como array compacto:
// [clave día/hora, id, t, equipo, GF, GC, resultado, nota, mvp, rango, tipo, formato, arena, compañeros, rivales, estadísticas (orden STAT_ORDER)]
export function gamePack(g) {
  const st = STAT_ORDER.map((k) => g.st[k] || 0);
  while (st.length && !st[st.length - 1]) st.pop();
  return [g.k, g.i, g.t, g.tm, g.gf, g.ga, g.r, g.rt, g.mv, g.rk || '', g.y, g.f, g.ar, g.mt, g.op, st];
}
export function gameObj(a) {
  const st = {}; (a[15] || []).forEach((v, i) => { if (v) st[STAT_ORDER[i]] = v; });
  return { k: a[0], i: a[1], t: a[2], tm: a[3], gf: a[4], ga: a[5], r: a[6], rt: a[7], mv: a[8], rk: a[9], y: a[10], f: a[11], ar: a[12], mt: a[13] || [], op: a[14] || [], st };
}

// Atributos (ataque, creación, defensa, control, faceoffs) a partir de los totales
export const ATTRS = [['atk', 'Ataque'], ['cre', 'Creación'], ['def', 'Defensa'], ['ctl', 'Control'], ['fo', 'Faceoffs']];
export function attrRaw(a) {
  if (!a || !a.gp) return null;
  return {
    atk: (a.g + 0.3 * a.sh + 0.2 * a.ph) / a.gp, cre: (a.as + 0.12 * a.ps) / a.gp, def: (0.5 * a.tk + 0.6 * a.bl + 0.6 * a.sv) / a.gp,
    ctl: (0.02 * a.po - 0.5 * a.to) / a.gp, fo: (a.fw + a.fl) >= 5 ? a.fw / (a.fw + a.fl) : null,
  };
}
// Percentil (0-100) de un valor frente a los cortes publicados en data/attr.json
export function percentile(q, v) {
  if (!q || !q.length || v == null) return null;
  let lo = 0, hi = q.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (q[mid] <= v + 1e-9) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return Math.round(ans / (q.length - 1) * 100);
}
