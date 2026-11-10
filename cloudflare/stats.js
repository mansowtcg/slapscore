// Estadísticas de visitas de SlapScore: un Durable Object con SQLite (incluido en el plan gratuito de Cloudflare).
//
// Por cada página vista se guarda: el momento, la página (sección y, en los perfiles, el ID del jugador), de dónde viene
// (solo el dominio o la etiqueta ?ref=), el país (lo da Cloudflare), el tipo de dispositivo, el navegador, el sistema,
// el idioma y si es la app instalada. Nada de cookies ni identificadores en el navegador: para contar personas se usa
// un resumen cifrado de IP + navegador con una sal aleatoria que cambia cada mes y se borra. La IP no se guarda nunca y,
// pasado el mes, el resumen ya no se puede relacionar con nadie (como hace Umami).
//
// Tablas
//   hits(id, vh, k, p, n, ref, cc, dev, br, os, lang, sl, app)  un evento por fila; id = ms·1000 + contador (orden temporal,
//        sin índice aparte: cada evento es una sola fila escrita). k: 0 página vista, 1 tiempo activo (n = segundos),
//        2 acción (p = nombre). Se guardan 400 días.
//   days(day, v, data)   resumen de cada día cerrado (hora de Madrid), una fila por día
//   dayvis(day, vis)     visitantes de ese día (resúmenes cortos), para contar personas en varios días del mismo mes
//   months(month, uv)    visitantes únicos de cada mes cerrado
//   meta(k, v)           sal del mes en curso y último día resumido
//
// Límites del plan gratuito (al día): 100.000 filas escritas y 5 millones leídas. Cada evento escribe una fila;
// abrir el panel lee los eventos de hoy y una fila por día del periodo.

export const TZ = 'Europe/Madrid';
const GAP = 30 * 60_000;          // una visita termina tras 30 minutos sin actividad
const LIVE = 5 * 60_000;          // "ahora mismo": actividad en los últimos 5 minutos
const KEEP_DAYS = 400;
const SUM_V = 1;                  // versión del resumen diario (si cambia, se rehacen los días que aún tienen eventos)
const PER_IP = 300;               // eventos como mucho por conexión (IP; en IPv6, su red /64) cada 10 minutos
const DAY_CAP = 60000;            // eventos guardados como mucho al día (el plan gratuito permite 100.000 filas escritas)
const FB_GAP = 60_000, FB_PER_IP = 5, FB_DAY = 200;   // buzón: 1 mensaje por minuto y 5 al día por conexión, 200 al día en total
const TOP = { pl: 300, src: 100, ent: 40, pg: 40, cc: 120, br: 30, os: 30, lang: 60, ev: 30 };

// ---------- fechas en hora de Madrid ----------
const DTF = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function parts(ms) { const o = {}; for (const x of DTF.formatToParts(new Date(ms))) o[x.type] = x.value; return o; }
export function dayOf(ms) { const p = parts(ms); return `${p.year}-${p.month}-${p.day}`; }
function offsetAt(ms) { const p = parts(ms); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(ms / 60_000) * 60_000; }
export function dayStart(day) { const [y, m, d] = day.split('-').map(Number); const u = Date.UTC(y, m - 1, d); return u - offsetAt(u); }
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const weekday = (day) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;   // 0 = lunes
function hourFn(day) {
  const a = dayStart(day), b = dayStart(addDays(day, 1));
  if (b - a === 864e5) return (ts) => Math.max(0, Math.min(23, Math.floor((ts - a) / 36e5)));
  return (ts) => +parts(ts).hour;    // días de cambio de hora
}

// ---------- de dónde viene ----------
const SRC = [
  [/(^|\.)discord(app)?\.(com|gg)$/, 'discord'], [/(^|\.)google\.[a-z.]+$|googlequicksearchbox|^news\.google/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo'], [/(^|\.)yahoo\.[a-z.]+$/, 'yahoo'],
  [/(^|\.)yandex\.[a-z.]+$|^ya\.ru$/, 'yandex'], [/(^|\.)ecosia\.org$/, 'ecosia'], [/^search\.brave\.com$/, 'brave'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'], [/(^|\.)twitch\.tv$/, 'twitch'], [/(^|\.)reddit\.com$|^redd\.it$/, 'reddit'],
  [/^(t\.co|x\.com|twitter\.com|mobile\.twitter\.com)$/, 'x'], [/(^|\.)facebook\.com$|^fb\.me$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)tiktok\.com$/, 'tiktok'], [/(^|\.)(steamcommunity|steampowered)\.com$/, 'steam'],
  [/(^|\.)slapshot\.gg$/, 'slapshot'], [/(^|\.)eusl\.gg$/, 'eusl'], [/(^|\.)github\.com$/, 'github'],
  [/(^|\.)whatsapp\.(com|net)$|^wa\.me$/, 'whatsapp'], [/^(t\.me|web\.telegram\.org|telegram\.org)$/, 'telegram'],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, 'chatgpt'], [/(^|\.)perplexity\.ai$/, 'perplexity'], [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'],
];
const SRC_KEYS = new Set([...SRC.map((x) => x[1]), 'twitter']);
export function source(host, tag) {
  if (tag) {
    let s = String(tag).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
    if (s === 'twitter') s = 'x';
    if (s) return SRC_KEYS.has(s) ? s : 'tag:' + s;
  }
  let h = String(host || '').toLowerCase().trim().replace(/^android-app:\/\//, '').replace(/^https?:\/\//, '').split(/[/?#:]/)[0];
  h = h.replace(/^(www|m|l|lm|mobile)\./, '');
  if (!h || !/^[a-z0-9.-]+$/.test(h)) return '';
  for (const [re, k] of SRC) if (re.test(h)) return k;
  return h.slice(0, 60);
}

// ---------- navegador y sistema (solo el nombre, nunca el texto completo) ----------
export function browser(ua) {
  if (/Valve Steam|SteamWebHelper|GameOverlay/i.test(ua)) return 'Steam';
  if (/ Discord\//.test(ua)) return 'Discord';
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/YaBrowser/.test(ua)) return 'Yandex';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/CriOS|Chrome\/|Chromium/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Otro';
}
export function system(ua) {
  if (/Windows/.test(ua)) return 'Windows';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Otro';
}
export const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|preview|facebookexternalhit|embedly|whatsapp\/|telegrambot|discordbot|python|curl\/|wget|httpclient|okhttp|axios|node-fetch|phantom|puppeteer|playwright|selenium|scrapy|monitor|uptime/i;

// ---------- validación de lo que manda la web ----------
const PAGES = new Set(['home', 'dia', 'partido', 'tabla', 'rankings', 'records', 'premios', 'novedades', 'eusl', 'notas', 'cmp', 'legal']);
const EVENTS = new Set(['share', 'fav', 'install', 'feedback', 'push', 'tour', 'tourskip', 'obs', 'float']);
export function cleanHit(b, { ip, ua, cc }) {
  if (!b || typeof b !== 'object') return null;
  const k = Number(b.k);
  const out = { k, id: ip + '|' + ua };
  if (k === 0) {
    const p = String(b.p || '');
    if (!PAGES.has(p) && !/^j:\d{1,12}$/.test(p)) return null;
    out.p = p;
    out.ref = source(b.r, b.q) || null;
    out.cc = /^[A-Z]{2}$/.test(cc || '') && cc !== 'XX' && cc !== 'T1' ? cc : null;
    out.dev = ['m', 't', 'd'].includes(b.d) ? b.d : null;
    out.br = browser(ua); out.os = system(ua);
    out.lang = /^[a-z]{2,3}$/.test(b.l || '') ? b.l : null;
    out.sl = ['es', 'en', 'fr', 'de', 'pt', 'tr'].includes(b.s) ? b.s : null;   // idioma en que ve la web
    out.app = b.a ? 1 : 0;
  } else if (k === 1) {
    const n = Math.round(Number(b.n));
    if (!(n >= 1)) return null;
    out.n = Math.min(n, 1800);
  } else if (k === 2) {
    if (!EVENTS.has(b.p)) return null;
    out.p = b.p;
  } else return null;
  return out;
}

// ---------- resumen de un conjunto de eventos (un día o parte de él) ----------
// claves que vienen de las visitas ("constructor", "toString"…): solo las propias del objeto
const inc = (o, k, n = 1) => { o[k] = (Object.prototype.hasOwnProperty.call(o, k) ? Number(o[k]) || 0 : 0) + n; };
const sec = (p) => (p && p.startsWith('j:') ? 'jugador' : p || '?');
function trim(o, n) { const e = Object.entries(o); if (e.length <= n) return o; return Object.fromEntries(e.sort((a, b) => b[1] - a[1]).slice(0, n)); }
export function emptySummary() {
  return { v: SUM_V, pv: 0, ss: 0, en: 0, es: 0, uv: 0, nr: 0, h: Array(24).fill(0), hs: Array(24).fill(0), uh: Array(24).fill(0), pg: {}, pl: {}, ent: {}, src: {}, cc: {}, dev: {}, br: {}, os: {}, lang: {}, sl: {}, app: 0, ev: {}, pps: [0, 0, 0, 0, 0] };
}
// rows ordenadas por id; hour(ts) = hora local; seen = visitantes ya vistos antes en el mes (para "vuelven")
export function summarize(rows, hour, seen = new Set()) {
  const S = emptySummary(), vis = new Set();
  const byV = new Map();
  for (const r of rows) { let a = byV.get(r.vh); if (!a) byV.set(r.vh, (a = [])); a.push(r); }
  const uh = Array.from({ length: 24 }, () => new Set());
  const close = (s) => {
    if (!s || !s.d) return;      // sin página vista no cuenta como visita
    const d = s.d;
    S.ss++; S.es += s.es;
    if (s.pv >= 2 || s.es >= 10) S.en++;
    S.hs[hour(s.first)]++;
    inc(S.ent, sec(d.p)); inc(S.src, d.ref || '');
    if (d.cc) inc(S.cc, d.cc);
    inc(S.dev, d.dev || '?'); inc(S.br, d.br || 'Otro'); inc(S.os, d.os || 'Otro');
    if (d.lang) inc(S.lang, d.lang);
    if (d.sl) inc(S.sl, d.sl);
    if (d.app) S.app++;
    S.pps[s.pv >= 10 ? 4 : s.pv >= 5 ? 3 : s.pv >= 3 ? 2 : s.pv - 1]++;
  };
  for (const [vh, list] of byV) {
    let s = null, any = false;
    for (const r of list) {
      const ts = Math.floor(r.id / 1000);
      if (!s || ts - s.last > GAP) { close(s); s = { first: ts, last: ts, pv: 0, es: 0, d: null }; }
      s.last = ts;
      if (r.k === 0) {
        S.pv++; const h = hour(ts); S.h[h]++; uh[h].add(vh);
        inc(S.pg, sec(r.p)); if (r.p && r.p.startsWith('j:')) inc(S.pl, r.p.slice(2));
        s.pv++; if (!s.d) s.d = r; any = true;
      } else if (r.k === 1) s.es += r.n || 0;
      else if (r.k === 2 && r.p) inc(S.ev, r.p);
    }
    close(s);
    if (any) { const v = vh.slice(0, 10); vis.add(v); if (seen.has(v)) S.nr++; }
  }
  S.uv = vis.size;
  S.uh = uh.map((x) => x.size);
  for (const [k, n] of Object.entries(TOP)) S[k] = trim(S[k], n);
  return { sum: S, vis };
}
const MAPS = ['pg', 'pl', 'ent', 'src', 'cc', 'dev', 'br', 'os', 'lang', 'sl', 'ev'];
export function addSummary(a, b) {
  for (const k of ['pv', 'ss', 'en', 'es', 'nr', 'app']) a[k] += b[k] || 0;
  for (const k of ['h', 'hs', 'pps']) (b[k] || []).forEach((x, i) => { a[k][i] = (a[k][i] || 0) + x; });
  for (const k of MAPS) for (const [x, n] of Object.entries(b[k] || {})) inc(a[k], x, n);
  return a;
}
const topList = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

const RANGES = { today: 1, yesterday: 1, '7d': 7, '30d': 30, '90d': 90, '12m': 365 };

export class Stats {
  constructor(state, env) {
    this.state = state; this.env = env; this.sql = state.storage.sql;
    this.lastId = 0; this.salt = null; this.rl = new Map(); this.rlAt = 0;
    this.dayN = null;   // { day, n }: eventos guardados hoy
    this.fb = new Map(); this.fbDay = '';   // buzón: conexión -> { last, n }
    this.now = () => Date.now();
    state.blockConcurrencyWhile(async () => this.init());
  }
  init() {
    const x = (q) => this.sql.exec(q);
    x('CREATE TABLE IF NOT EXISTS hits (id INTEGER PRIMARY KEY, vh TEXT NOT NULL, k INTEGER NOT NULL, p TEXT, n INTEGER, ref TEXT, cc TEXT, dev TEXT, br TEXT, os TEXT, lang TEXT, sl TEXT, app INTEGER)');
    x('CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, v INTEGER NOT NULL, data TEXT NOT NULL)');
    x('CREATE TABLE IF NOT EXISTS dayvis (day TEXT PRIMARY KEY, vis TEXT NOT NULL)');
    x('CREATE TABLE IF NOT EXISTS months (month TEXT PRIMARY KEY, uv INTEGER NOT NULL)');
    x('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
  }
  q(sql, ...args) { return this.sql.exec(sql, ...args).toArray(); }
  meta(k) { const r = this.q('SELECT v FROM meta WHERE k = ?', k)[0]; return r ? r.v : null; }
  setMeta(k, v) { this.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, v); }

  async fetch(request) {
    const u = new URL(request.url);
    try {
      if (request.method === 'POST' && u.pathname === '/hit') { await this.hit(await request.json()); return new Response(null, { status: 204 }); }
      if (request.method === 'POST' && u.pathname === '/forget') return Response.json(await this.forget(String((await request.json()).id || '')));
      if (request.method === 'POST' && u.pathname === '/fb') return Response.json(this.fbAllow(String((await request.json()).ip || '')));
      if (request.method === 'GET' && u.pathname === '/stats') return Response.json(this.stats(u.searchParams.get('range') || '7d'));
    } catch (e) { return Response.json({ error: String(e && e.message || e) }, { status: 500 }); }
    return new Response('not found', { status: 404 });
  }

  // ---------- guardar un evento ----------
  async visitor(raw, now) {
    const month = dayOf(now).slice(0, 7);
    if (!this.salt || this.salt.month !== month) {
      let v = this.meta('salt:' + month);
      if (!v) {
        v = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
        this.setMeta('salt:' + month, v);
        this.sql.exec("DELETE FROM meta WHERE k LIKE 'salt:%' AND k <> ?", 'salt:' + month);   // la del mes anterior se borra
      }
      this.salt = { month, v };
    }
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.salt.v + '|' + raw));
    return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async hit(d) {
    if (!d || ![0, 1, 2].includes(d.k)) return false;
    const now = this.now();
    // límite por conexión (no por navegador: el navegador lo elige quien manda la petición)
    if (now - this.rlAt > 600_000 || this.rl.size > 50000) { this.rl.clear(); this.rlAt = now; }
    const rk = String(d.rk || d.id || '').slice(0, 64);
    const c = (this.rl.get(rk) || 0) + 1; this.rl.set(rk, c);
    if (c > PER_IP) return false;
    // tope diario: así nunca se pasa del plan gratuito aunque alguien mande eventos falsos desde muchas conexiones
    const today = dayOf(now);
    if (!this.dayN || this.dayN.day !== today) this.dayN = { day: today, n: this.q('SELECT COUNT(*) AS n FROM hits WHERE id >= ?', dayStart(today) * 1000)[0].n };
    if (this.dayN.n >= DAY_CAP) return false;
    this.dayN.n++;
    const vh = await this.visitor(String(d.id || ''), now);
    const id = this.lastId = Math.max(this.lastId + 1, now * 1000);
    if (d.k === 0) {
      this.sql.exec('INSERT INTO hits (id, vh, k, p, ref, cc, dev, br, os, lang, sl, app) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, vh, d.p, d.ref ?? null, d.cc ?? null, d.dev ?? null, d.br ?? null, d.os ?? null, d.lang ?? null, d.sl ?? null, d.app ? 1 : 0);
      if (!this.first) { this.first = this.meta('first') || dayOf(now); if (!this.meta('first')) this.setMeta('first', this.first); }
    } else {
      this.sql.exec('INSERT INTO hits (id, vh, k, p, n) VALUES (?, ?, ?, ?, ?)', id, vh, d.k, d.p ?? null, d.n ?? null);
    }
    return true;
  }

  // buzón de sugerencias: ¿se puede guardar otro mensaje de esta conexión? (de uno en uno, sin carreras)
  fbAllow(ip) {
    const now = this.now(), day = dayOf(now);
    if (this.fbDay !== day) { this.fb.clear(); this.fbDay = day; }
    const total = Number(this.meta('fb:' + day)) || 0;
    if (total >= FB_DAY) return { ok: false, error: 'full' };
    const x = this.fb.get(ip) || { last: 0, n: 0 };
    if (now - x.last < FB_GAP || x.n >= FB_PER_IP) return { ok: false, error: 'wait' };
    x.last = now; x.n++; this.fb.set(ip, x);
    if (this.fb.size > 20000) this.fb.clear();
    this.setMeta('fb:' + day, String(total + 1));
    this.sql.exec("DELETE FROM meta WHERE k LIKE 'fb:%' AND k < ?", 'fb:' + addDays(day, -3));
    return { ok: true };
  }

  // quita los eventos de hoy de una persona (el administrador, para borrar sus propias visitas)
  async forget(raw) {
    const now = this.now(), vh = await this.visitor(raw, now), from = dayStart(dayOf(now)) * 1000;
    const n = this.q('SELECT COUNT(*) AS n FROM hits WHERE vh = ? AND id >= ?', vh, from)[0].n;
    if (n) this.sql.exec('DELETE FROM hits WHERE vh = ? AND id >= ?', vh, from);
    return { removed: n };
  }

  // ---------- resúmenes diarios ----------
  rawRows(fromMs, toMs) {
    return this.q('SELECT id, vh, k, p, n, ref, cc, dev, br, os, lang, sl, app FROM hits WHERE id >= ? AND id < ? ORDER BY id', fromMs * 1000, toMs * 1000);
  }
  seenBefore(day) {
    const m = day.slice(0, 7) + '-01', set = new Set();
    if (day > m) for (const r of this.q('SELECT vis FROM dayvis WHERE day >= ? AND day < ?', m, day)) for (const v of JSON.parse(r.vis)) set.add(v);
    return set;
  }
  rollDay(day) {
    const { sum, vis } = summarize(this.rawRows(dayStart(day), dayStart(addDays(day, 1))), hourFn(day), this.seenBefore(day));
    this.sql.exec('INSERT OR REPLACE INTO days (day, v, data) VALUES (?, ?, ?)', day, SUM_V, JSON.stringify(sum));
    this.sql.exec('INSERT OR REPLACE INTO dayvis (day, vis) VALUES (?, ?)', day, JSON.stringify([...vis]));
    return sum;
  }
  rollup(today) {
    let last = this.meta('rolled');
    if (!last) {
      const r = this.q('SELECT MIN(id) AS m FROM hits')[0];
      if (!r || r.m == null) return;
      last = addDays(dayOf(Math.floor(r.m / 1000)), -1);
      this.setMeta('rolled', last);
    }
    let d = addDays(last, 1), n = 0;
    while (d < today && n < 62) { this.rollDay(d); this.setMeta('rolled', d); d = addDays(d, 1); n++; }
    // los eventos de hace más de 400 días se borran poco a poco (borrar también cuenta como escribir)
    this.sql.exec('DELETE FROM hits WHERE id IN (SELECT id FROM hits WHERE id < ? LIMIT 3000)', dayStart(addDays(today, -KEEP_DAYS)) * 1000);
  }
  // resúmenes de los días [from, to]: guardados (días cerrados) o calculados al momento (hoy, o un día cortado a cierta hora)
  daySums(from, to, today, cut = {}) {
    const stored = new Map(this.q('SELECT day, v, data FROM days WHERE day >= ? AND day <= ?', from, to).map((r) => [r.day, r]));
    const rolled = this.meta('rolled') || '', keepFrom = addDays(today, -KEEP_DAYS + 1), out = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (day === today || cut[day]) {
        const end = cut[day] || dayStart(addDays(day, 1));
        out.push({ day, ...summarize(this.rawRows(dayStart(day), end), hourFn(day), this.seenBefore(day)) });
        continue;
      }
      const r = stored.get(day);
      if (r && r.v === SUM_V) out.push({ day, sum: JSON.parse(r.data), vis: null });
      else if (day < today && ((r && day >= keepFrom) || (!r && day > rolled))) out.push({ day, sum: this.rollDay(day), vis: null });   // versión antigua o aún sin resumir
      else if (r) out.push({ day, sum: { ...emptySummary(), ...JSON.parse(r.data) }, vis: null });
      else out.push({ day, sum: emptySummary(), vis: null });          // antes de empezar a contar
    }
    return out;
  }
  // visitantes únicos de un periodo: se cuentan por meses (la sal cambia cada mes) y se suman
  uniques(entries, today) {
    const byM = new Map();
    for (const e of entries) { const m = e.day.slice(0, 7); if (!byM.has(m)) byM.set(m, []); byM.get(m).push(e); }
    let total = 0;
    const curM = today.slice(0, 7);
    for (const [m, list] of byM) {
      const first = m + '-01', lastD = addDays(addDays(first, 32).slice(0, 7) + '-01', -1);
      const full = m < curM && list.length === Math.round((Date.parse(lastD) - Date.parse(first)) / 864e5) + 1 && list.every((e) => !e.vis);
      if (full) { const r = this.q('SELECT uv FROM months WHERE month = ?', m)[0]; if (r) { total += r.uv; continue; } }
      const set = new Set();
      const stored = list.filter((e) => !e.vis).map((e) => e.day);
      if (stored.length) {
        const lo = stored.reduce((a, b) => (a < b ? a : b)), hi = stored.reduce((a, b) => (a > b ? a : b));
        const want = new Set(stored);
        for (const r of this.q('SELECT day, vis FROM dayvis WHERE day >= ? AND day <= ?', lo, hi)) if (want.has(r.day)) for (const v of JSON.parse(r.vis)) set.add(v);
      }
      for (const e of list) if (e.vis) for (const v of e.vis) set.add(v);
      if (full) this.sql.exec('INSERT OR REPLACE INTO months (month, uv) VALUES (?, ?)', m, set.size);
      total += set.size;
    }
    return total;
  }

  // ---------- lo que pide el panel ----------
  // personas en los últimos 5 minutos (y en qué página están) y páginas vistas por minuto en la última media hora
  live(now) {
    const recent = this.q('SELECT id, vh, k, p FROM hits WHERE id >= ? ORDER BY id', (now - 30 * 60_000) * 1000);
    const last = new Map(), mins = Array(30).fill(0);
    for (const r of recent) {
      const ts = Math.floor(r.id / 1000);
      if (r.k === 0) { const i = 29 - Math.floor((now - ts) / 60_000); if (i >= 0) mins[i]++; }
      if (now - ts <= LIVE) { const o = last.get(r.vh) || { p: null }; if (r.k === 0) o.p = r.p; last.set(r.vh, o); }
    }
    const pages = {};
    for (const o of last.values()) inc(pages, o.p || '?');
    return { n: last.size, pages: topList(pages, 12), mins };
  }
  stats(range) {
    const now = this.now(), today = dayOf(now);
    if (range === 'live') return { now, live: this.live(now) };
    if (!RANGES[range]) range = '7d';
    this.rollup(today);
    const L = RANGES[range];
    const to = range === 'yesterday' ? addDays(today, -1) : today;
    const from = addDays(to, -(L - 1));
    const tod = now - dayStart(today);                 // hora del día ahora mismo (para comparar a la misma hora)
    const cur = this.daySums(from, to, today);
    const pFrom = addDays(from, -L), pTo = addDays(to, -L);
    // si el periodo llega hasta ahora, el último día del anterior se corta a la misma hora para comparar igual con igual
    const prev = this.daySums(pFrom, pTo, today, to === today ? { [pTo]: dayStart(pTo) + tod } : {});
    const total = (list) => list.reduce((a, e) => addSummary(a, e.sum), emptySummary());
    const A = total(cur), B = total(prev);
    // duv: suma de los visitantes de cada día (para el % de los que vuelven)
    const kpi = (S, list) => ({ uv: this.uniques(list, today), ss: S.ss, pv: S.pv, en: S.en, es: S.es, nr: S.nr, duv: list.reduce((a, e) => a + (e.sum.uv || 0), 0) });

    // serie: por horas (un día), por días (hasta 90) o por meses (12 meses)
    let series;
    if (L === 1) {
      const nowH = range === 'today' ? hourFn(today)(now) : 23;
      const c = cur[0].sum, p = range === 'today' ? this.daySums(prev[0].day, prev[0].day, today)[0].sum : prev[0].sum;   // ayer entero, como referencia
      series = { unit: 'hour', labels: Array.from({ length: 24 }, (_, i) => i), uv: c.uh.map((x, i) => (i <= nowH ? x : null)), ss: c.hs.map((x, i) => (i <= nowH ? x : null)), pv: c.h.map((x, i) => (i <= nowH ? x : null)), puv: p.uh, pss: p.hs, ppv: p.h };
    } else if (L <= 90) {
      series = { unit: 'day', labels: cur.map((e) => e.day), uv: cur.map((e) => e.sum.uv), ss: cur.map((e) => e.sum.ss), pv: cur.map((e) => e.sum.pv), puv: prev.map((e) => e.sum.uv), pss: prev.map((e) => e.sum.ss), ppv: prev.map((e) => e.sum.pv) };
    } else {
      const months = [...new Set(cur.map((e) => e.day.slice(0, 7)))];
      const by = (m) => cur.filter((e) => e.day.slice(0, 7) === m);
      series = { unit: 'month', labels: months, uv: months.map((m) => this.uniques(by(m), today)), ss: months.map((m) => by(m).reduce((a, e) => a + e.sum.ss, 0)), pv: months.map((m) => by(m).reduce((a, e) => a + e.sum.pv, 0)) };
    }
    // actividad por día de la semana y hora (visitas)
    let heat = null;
    if (L >= 7) { heat = Array.from({ length: 7 }, () => Array(24).fill(0)); for (const e of cur) e.sum.hs.forEach((x, i) => { heat[weekday(e.day)][i] += x; }); }

    return {
      range, from, to, today, now, tz: TZ, first: this.meta('first'),
      kpi: kpi(A, cur), prev: prev.some((e) => e.sum.pv) ? kpi(B, prev) : null,
      series, heat,
      live: this.live(now),
      dims: {
        pg: topList(A.pg, 40), pl: topList(A.pl, 50), ent: topList(A.ent, 20), src: topList(A.src, 50), cc: topList(A.cc, 60),
        dev: topList(A.dev, 5), br: topList(A.br, 20), os: topList(A.os, 20), lang: topList(A.lang, 40), sl: topList(A.sl, 5), ev: topList(A.ev, 10),
        pps: A.pps, app: A.app,
      },
      days: L > 1 ? cur.map((e) => [e.day, e.sum.uv, e.sum.ss, e.sum.pv, e.sum.en, e.sum.es]) : null,
    };
  }
}
