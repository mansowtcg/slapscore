// Panel de tráfico de SlapScore: la pestaña «Tráfico» del administrador.
// Los datos los da el Worker de Cloudflare (/api/stats), que comprueba con GitHub el token del administrador.
// Cómo se cuentan las visitas: cloudflare/stats.js.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const RANGE_KEY = 'slapscore-traffic-range';
const RANGES = [['today', 'Hoy'], ['yesterday', 'Ayer'], ['7d', '7 días'], ['30d', '30 días'], ['90d', '90 días'], ['12m', '12 meses']];
const VS = { today: 'ayer a esta hora', yesterday: 'el día anterior', '7d': 'los 7 días anteriores', '30d': 'los 30 días anteriores', '90d': 'los 90 días anteriores', '12m': 'los 12 meses anteriores' };
const RANGE_TXT = { today: 'hoy', yesterday: 'ayer', '7d': 'los últimos 7 días', '30d': 'los últimos 30 días', '90d': 'los últimos 90 días', '12m': 'los últimos 12 meses' };
const METRICS = { uv: 'Visitantes', ss: 'Visitas', pv: 'Páginas vistas' };
const PAGE = { home: 'Portada (partidos de hoy)', dia: 'Partidos de otros días', partido: 'Partido', jugador: 'Perfil de jugador', tabla: 'Tabla de jugadores', rankings: 'Rankings', records: 'Récords', premios: 'Premios', novedades: 'Novedades', eusl: 'EUSL', notas: 'Cómo puntuamos', cmp: 'Comparar jugadores', '?': 'Otra página' };
const SRC = { '': 'Directo o desconocido', discord: 'Discord', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', yandex: 'Yandex', ecosia: 'Ecosia', brave: 'Brave Search', youtube: 'YouTube', twitch: 'Twitch', reddit: 'Reddit', x: 'X (Twitter)', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', steam: 'Steam', slapshot: 'slapshot.gg', eusl: 'EUSL (eusl.gg)', github: 'GitHub', whatsapp: 'WhatsApp', telegram: 'Telegram', chatgpt: 'ChatGPT', perplexity: 'Perplexity', linkedin: 'LinkedIn' };
const DEV = { m: 'Móvil', t: 'Tablet', d: 'Ordenador', '?': 'Desconocido' };
const EV = [['share', 'Imágenes compartidas o descargadas'], ['fav', 'Jugadores añadidos a favoritos'], ['feedback', 'Sugerencias enviadas'], ['install', 'Instalaciones de la app']];
const PPS = ['1 página', '2 páginas', '3 o 4 páginas', 'De 5 a 9 páginas', '10 páginas o más'];
const WD = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const LIST_N = 8;

let X = null, root = null, getToken = null;
const ST = { range: '7d', data: null, metric: 'uv', table: false, heatTable: false, open: {}, names: null, err: '', at: 0, timers: [], hover: null };

// ---------- formato ----------
const NF1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NFC = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const DF_D = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DF_WD = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DF_M = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });
const DF_ML = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dd = (d) => new Date(d.length === 7 ? d + '-15T12:00:00Z' : d + 'T12:00:00Z');
const clean = (s) => s.replace(/\./g, '');
const fmtDay = (d) => clean(DF_D.format(dd(d)));
const fmtDayLong = (d) => { const s = DF_WD.format(dd(d)); return s[0].toUpperCase() + s.slice(1); };
const fmtMonthLong = (m) => { const s = DF_ML.format(dd(m)); return s[0].toUpperCase() + s.slice(1); };
const hh = (h) => String(h).padStart(2, '0') + ':00';
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// el panel va siempre en español, aunque la web esté en inglés
const NF0 = new Intl.NumberFormat('es-ES');
const int = (n) => NF0.format(n || 0);
const RTF = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function ago(ms) { const s = Math.round((Date.now() - ms) / 1000); if (s < 45) return 'hace un momento'; const m = Math.round(s / 60); return m < 60 ? RTF.format(-m, 'minute') : RTF.format(-Math.round(m / 60), 'hour'); }
const pctTxt = (x) => (x == null || !isFinite(x) ? '–' : Math.round(x * 100) + ' %');
function dur(s) {
  s = Math.round(s || 0);
  if (s < 60) return `${s} s`;
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return m >= 10 || !r ? `${m} min` : `${m} min ${r} s`; }
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return m ? `${h} h ${m} min` : `${h} h`;
}
const flag = (cc) => /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';
let DN_R = null, DN_L = null;
try { DN_R = new Intl.DisplayNames(['es'], { type: 'region' }); DN_L = new Intl.DisplayNames(['es'], { type: 'language' }); } catch {}
const country = (cc) => { try { return DN_R ? DN_R.of(cc) : cc; } catch { return cc; } };
const language = (l) => { try { const s = DN_L ? DN_L.of(l) : l; return s ? s[0].toUpperCase() + s.slice(1) : l; } catch { return l; } };
const srcLabel = (k) => (Object.prototype.hasOwnProperty.call(SRC, k) ? SRC[k] : k.startsWith('tag:') ? `«${k.slice(4)}» (enlace con ?ref=)` : k);

// ---------- datos ----------
async function api(range) {
  let r;
  try { r = await fetch(`${X.apiBase()}/api/stats?range=${encodeURIComponent(range)}`, { cache: 'no-store', headers: { Authorization: `Bearer ${getToken()}` } }); }
  catch { throw new Error('No se pudo conectar con el servidor de estadísticas (Cloudflare).'); }
  if (r.status === 401) throw new Error('El servidor no ha aceptado tu token: tiene que ser de una cuenta con permiso de escritura en el repositorio.');
  if (r.status === 503) throw new Error('Las estadísticas aún no están activas en Cloudflare. Se activan solas con la siguiente pasada del robot (unos minutos).');
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok || !j || j.error) throw new Error(`El servidor de estadísticas respondió con un error ${r.status}.`);
  return j;
}
async function names() {
  if (ST.names) return ST.names;
  try { const rows = await X.loadSearch(); ST.names = new Map(rows.map((r) => [String(r[0]), { n: r[1], rk: r[2] }])); }
  catch { ST.names = new Map(); }
  return ST.names;
}
const needNames = (d) => (d.dims && d.dims.pl.length) || (d.live && d.live.pages.some(([p]) => String(p).startsWith('j:')));

export function mount(el, ctx, tokenFn) {
  X = ctx; root = el; getToken = tokenFn;
  try { const r = localStorage.getItem(RANGE_KEY); if (RANGES.some(([k]) => k === r)) ST.range = r; } catch {}
  el.innerHTML = `<div class="tr-bar">
      <div class="seg tr-range" role="group" aria-label="Periodo">${RANGES.map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${k === ST.range}"><span class="lg">${l}</span><span class="sh" aria-hidden="true">${l.replace(/ días$/, ' d').replace(/ meses$/, ' m')}</span></button>`).join('')}</div>
      <div class="tr-upd"><span class="muted" id="tr-at" aria-live="polite"></span><button class="btn sm" type="button" id="tr-reload">Actualizar</button></div>
    </div>
    <div id="tr-body"><div class="tr-top"><div class="card"><div class="card-b" style="padding-top:16px"><div class="sk" style="height:150px"></div></div></div><div class="tr-kpis">${'<div class="tr-kpi"><div class="sk" style="height:62px"></div></div>'.repeat(6)}</div></div>
      <div class="card"><div class="card-b" style="padding-top:16px"><div class="sk" style="height:250px"></div></div></div></div>`;
  $$('[data-range]', el).forEach((b) => b.addEventListener('click', () => {
    ST.range = b.getAttribute('data-range'); ST.open = {};
    try { localStorage.setItem(RANGE_KEY, ST.range); } catch {}
    $$('[data-range]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  }));
  $('#tr-reload', el).addEventListener('click', () => load());
  const body = $('#tr-body', el);
  body.addEventListener('click', (e) => {
    if (!ST.data) return;
    const m = e.target.closest('[data-more]');
    if (m) { const k = m.getAttribute('data-more'); ST.open[k] = !ST.open[k]; const card = m.closest('[data-card]'); card.outerHTML = cardByKey(k); const b = $(`[data-more="${k}"]`, body); if (b) b.focus({ preventScroll: true }); return; }
    if (e.target.closest('#tr-heat-t')) { ST.heatTable = !ST.heatTable; $('#tr-heat', body).outerHTML = heatCard(); wireHeat(); const b = $('#tr-heat-t', body); if (b) b.focus({ preventScroll: true }); return; }
    if (e.target.closest('#tr-csv')) csv();
    const fg = e.target.closest('#tr-forget');
    if (fg) {
      if (fg.dataset.sure !== '1') { fg.dataset.sure = '1'; fg.textContent = '¿Seguro? Quitar'; return; }
      fg.disabled = true;
      fetch(`${X.apiBase()}/api/stats`, { method: 'DELETE', cache: 'no-store', headers: { Authorization: `Bearer ${getToken()}` } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => { X.toast(j.removed ? `Quitadas ${j.removed === 1 ? '1 visita o acción' : `${int(j.removed)} visitas y acciones`} de este navegador` : 'No había visitas de este navegador hoy'); load(); })
        .catch(() => { X.toast('No se pudieron quitar. Vuelve a intentarlo.'); fg.disabled = false; });
    }
  });
  if (!ST.docTap) { ST.docTap = true; document.addEventListener('pointerdown', (e) => { if (ST.hideTip && !(e.target.closest && e.target.closest('.tr-svg'))) ST.hideTip(); }, true); }
  for (const t of ST.timers) clearInterval(t);
  // "ahora mismo" cada 30 s y el resto cada 5 min, solo con la pestaña a la vista (cada lectura gasta del plan gratuito)
  const visible = () => root && root.isConnected && !root.closest('[hidden]') && !document.hidden;
  const stopIfGone = () => { if (!root || !root.isConnected) { for (const t of ST.timers) clearInterval(t); ST.timers = []; return true; } return false; };
  ST.timers = [
    setInterval(() => { if (stopIfGone() || !visible() || !ST.data) return; refreshLive(); }, 30_000),
    setInterval(() => { if (stopIfGone() || !visible() || !ST.data || !['today', '7d', '30d'].includes(ST.range)) return; load(true); }, 300_000),
    setInterval(() => { if (!stopIfGone()) drawAt(); }, 20_000),
  ];
  load();
}

async function load(quiet) {
  const body = $('#tr-body', root); if (!body) return;
  const range = ST.range;
  if (ST.data) body.classList.add('ld');
  try {
    const d = await api(range);
    if (needNames(d)) await names();
    if (range !== ST.range || !root.isConnected) return;
    ST.data = d; ST.err = ''; ST.at = Date.now();
    render();
  } catch (e) {
    if (range !== ST.range) return;
    if (quiet && ST.data) return;
    ST.err = e.message;
    body.innerHTML = `<div class="card"><div class="card-b err" style="padding-top:16px">${X.esc(e.message)}</div></div>`;
  } finally { body.classList.remove('ld'); drawAt(); }
}
async function refreshLive() {
  try { const d = await api('live'); if (!ST.data || !root.isConnected) return; if (d.live.pages.some(([p]) => String(p).startsWith('j:'))) await names(); ST.data.live = d.live; const el = $('#tr-live', root); if (el) el.outerHTML = liveCard(); }
  catch {}
}
function drawAt() { const el = $('#tr-at', root); if (el) el.textContent = ST.at ? `Actualizado ${ago(ST.at)}` : ''; }

// ---------- dibujo ----------
function render() {
  const d = ST.data, body = $('#tr-body', root);
  const empty = !d.kpi.pv && !(d.prev && d.prev.pv);
  body.innerHTML = `<div class="tr-top">${liveCard()}<div class="tr-kpis">${kpis()}</div></div>
    ${chartCard(empty)}
    <div class="tr-grid">
      ${pagesCard()}${playersCard()}${sourcesCard()}
      ${countriesCard()}${devicesCard()}${listCard('Navegadores', 'visitas', d.dims.br.map(([k, n]) => ({ label: X.esc(k === 'Otro' ? 'Otro o desconocido' : k), n })), 'br')}
      ${listCard('Sistemas', 'visitas', d.dims.os.map(([k, n]) => ({ label: X.esc(k === 'Otro' ? 'Otro o desconocido' : k), n })), 'os')}
      ${languagesCard()}${listCard('Páginas de entrada', 'por dónde empiezan las visitas', d.dims.ent.map(([k, n]) => ({ label: X.esc(PAGE[k] || k), n })), 'ent')}
      ${loyaltyCard()}${actionsCard()}
    </div>
    ${heatCard()}
    ${aboutCard()}`;
  wire();
}
function wire() {
  const body = $('#tr-body', root);
  $$('[data-metric]', body).forEach((b) => b.addEventListener('click', () => { ST.metric = b.getAttribute('data-metric'); $$('[data-metric]', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#tr-chart-card', body).outerHTML = chartCard(!ST.data.kpi.pv && !(ST.data.prev && ST.data.prev.pv)); wireChart(); }));
  const nt = $('#tr-notrack', body);
  if (nt) nt.addEventListener('change', () => { try { if (nt.checked) localStorage.setItem(X.NOTRACK_KEY, '1'); else localStorage.removeItem(X.NOTRACK_KEY); } catch {} X.toast(nt.checked ? 'Tus visitas desde este navegador no cuentan' : 'Tus visitas desde este navegador cuentan cuando cierres la sesión de administrador'); });
  wireChart(); wireHeat();
}
function cardByKey(k) {
  const d = ST.data;
  if (k === 'pg') return pagesCard(); if (k === 'pl') return playersCard(); if (k === 'src') return sourcesCard(); if (k === 'cc') return countriesCard(); if (k === 'lang') return languagesCard();
  if (k === 'br') return listCard('Navegadores', 'visitas', d.dims.br.map(([x, n]) => ({ label: X.esc(x === 'Otro' ? 'Otro o desconocido' : x), n })), 'br');
  if (k === 'os') return listCard('Sistemas', 'visitas', d.dims.os.map(([x, n]) => ({ label: X.esc(x === 'Otro' ? 'Otro o desconocido' : x), n })), 'os');
  if (k === 'dev') return devicesCard();
  if (k === 'ent') return listCard('Páginas de entrada', 'por dónde empiezan las visitas', d.dims.ent.map(([x, n]) => ({ label: X.esc(PAGE[x] || x), n })), 'ent');
  return '';
}

// ---------- ahora mismo ----------
function pageName(p) {
  p = String(p || '?');
  if (p.startsWith('j:')) { const o = ST.names && ST.names.get(p.slice(2)); return o ? `Perfil de ${o.n}` : `Perfil del jugador ${p.slice(2)}`; }
  return PAGE[p] || p;
}
function liveCard() {
  const L = ST.data.live || { n: 0, pages: [], mins: Array(30).fill(0) };
  const max = Math.max(1, ...L.mins);
  const total = L.mins.reduce((a, b) => a + b, 0);
  return `<div class="card tr-live" id="tr-live"><div class="card-h"><h2><span class="tr-dot${L.n ? ' on' : ''}" aria-hidden="true"></span>Ahora mismo</h2><small>últimos 5 minutos</small></div>
    <div class="card-b"><div class="tr-live-n"><b>${int(L.n)}</b><span>${L.n === 1 ? 'persona en la web' : 'personas en la web'}</span></div>
      <div class="tr-mins" role="img" aria-label="Páginas vistas por minuto en la última media hora: ${int(total)} en total">${L.mins.map((n, i) => `<span title="${29 - i === 0 ? 'Este minuto' : `Hace ${29 - i} min`}: ${int(n)} ${n === 1 ? 'página' : 'páginas'}"><i style="height:${n ? Math.max(8, Math.round((n / max) * 100)) : 0}%"></i></span>`).join('')}</div>
      <div class="tr-mins-ax" aria-hidden="true"><span>hace 30 min</span><span>${int(total)} páginas vistas</span><span>ahora</span></div>
      ${L.pages.length ? `<ul class="tr-lp">${L.pages.map(([p, n]) => `<li><span>${X.esc(pageName(p))}</span><b>${int(n)}</b></li>`).join('')}</ul>` : '<p class="muted tr-none">Nadie en este momento.</p>'}
    </div></div>`;
}

// ---------- cifras principales ----------
function delta(cur, prev, goodUp = true) {
  if (!ST.data.prev || prev == null) return `<span class="tr-d none">sin datos anteriores</span>`;
  if (!prev) return cur ? `<span class="tr-d good"><span aria-hidden="true">▲</span> nuevo <span class="vs">vs ${VS[ST.range]}</span></span>` : `<span class="tr-d flat">= <span class="vs">vs ${VS[ST.range]}</span></span>`;
  const p = (cur - prev) / Math.abs(prev);
  if (Math.abs(p) < 0.005) return `<span class="tr-d flat">= 0 % <span class="vs">vs ${VS[ST.range]}</span></span>`;
  const up = p > 0, good = up === goodUp;
  const txt = `${up ? '+' : '−'}${Math.abs(p) >= 10 ? int(Math.round(Math.abs(p) * 100)) : Math.round(Math.abs(p) * 100)} %`;
  return `<span class="tr-d ${good ? 'good' : 'bad'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${txt}<span class="sr"> ${up ? 'más' : 'menos'}</span> <span class="vs">vs ${VS[ST.range]}</span></span>`;
}
function kpis() {
  const a = ST.data.kpi, b = ST.data.prev || {};
  const ratio = (x, y) => (y ? x / y : 0);
  const tile = (k, label, value, d, help) => `<button class="tr-kpi" type="button" data-metric="${k}" aria-pressed="${ST.metric === k}" title="${help}"><span class="l">${label}</span><span class="v">${value}</span>${d}</button>`;
  const fixed = (label, value, d, help) => `<div class="tr-kpi" title="${help}"><span class="l">${label}</span><span class="v">${value}</span>${d}</div>`;
  return tile('uv', 'Visitantes', int(a.uv), delta(a.uv, b.uv), 'Personas distintas (aproximado: mismo dispositivo y conexión). Pulsa para verlo en el gráfico.')
    + tile('ss', 'Visitas', int(a.ss), delta(a.ss, b.ss), 'Sesiones: una visita termina tras 30 minutos sin actividad. Pulsa para verlo en el gráfico.')
    + tile('pv', 'Páginas vistas', int(a.pv), delta(a.pv, b.pv), 'Cada página o perfil que se abre. Pulsa para verlo en el gráfico.')
    + fixed('Páginas por visita', NF1.format(ratio(a.pv, a.ss)), delta(ratio(a.pv, a.ss), b.ss ? ratio(b.pv, b.ss) : null), 'Media de páginas que se ven en cada visita')
    + fixed('Tiempo medio por visita', dur(ratio(a.es, a.ss)), delta(ratio(a.es, a.ss), b.ss ? ratio(b.es, b.ss) : null), 'Tiempo con la web a la vista en cada visita')
    + fixed('Rebote', pctTxt(a.ss ? (a.ss - a.en) / a.ss : null), delta(a.ss ? (a.ss - a.en) / a.ss : 0, b.ss ? (b.ss - b.en) / b.ss : null, false), 'Visitas que se van en menos de 10 segundos sin ver otra página. Cuanto más bajo, mejor.');
}

// ---------- gráfico principal ----------
function niceTicks(max) {
  if (max <= 4) return [0, 1, 2, 3, 4].slice(0, Math.max(2, Math.ceil(max) + 1));
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  const out = []; for (let v = 0; v < max + step; v += step) out.push(v);
  return out;
}
const axisNum = (v, top) => (top >= 10000 ? clean(NFC.format(v)) : int(v));
function chartCard(empty) {
  const s = ST.data.series, m = ST.metric;
  const hasPrev = s[`p${m}`] && s[`p${m}`].some((x) => x > 0);
  const total = m === 'uv' ? ST.data.kpi.uv : ST.data.kpi[m];
  const live = ST.data.to === ST.data.today && s.unit !== 'hour';
  const sub = `${int(total)} en ${RANGE_TXT[ST.range]}${s.unit === 'hour' ? ' · por horas' : s.unit === 'day' ? ' · por días' : ' · por meses'}${live ? (s.unit === 'day' ? ' · hoy, hasta ahora' : ' · este mes, hasta hoy') : ''}`;
  return `<div class="card tr-chart-card" id="tr-chart-card"><div class="card-h"><div><h2>${METRICS[m]}</h2><small>${sub}</small></div>
    <div class="tr-ch-r">${hasPrev ? `<div class="tr-leg" aria-hidden="true"><span><i class="k cur"></i>${s.unit === 'hour' && ST.range === 'today' ? 'Hoy' : 'Este periodo'}</span><span><i class="k prev"></i>${ST.range === 'today' ? 'Ayer' : 'Periodo anterior'}</span></div>` : ''}
    <button class="btn sm" type="button" id="tr-tbl-t" aria-pressed="${ST.table}">${ST.table ? 'Ver gráfico' : 'Ver tabla'}</button></div></div>
    <div class="card-b">${empty ? '<p class="muted tr-empty">Todavía no hay visitas en este periodo. Se cuentan desde que se activó el panel.</p>' : ''}${ST.table ? chartTable(hasPrev) : '<div class="tr-ch" id="tr-ch"><div class="tr-tip" id="tr-tip" hidden></div></div>'}</div></div>`;
}
function inProgress(i) {
  const s = ST.data.series;
  if (ST.data.to !== ST.data.today) return false;
  const last = s[ST.metric].reduce((a, v, k) => (v != null ? k : a), -1);
  return i === last;
}
function xLabel(i, long) {
  const s = ST.data.series, v = s.labels[i];
  const tail = long && inProgress(i) ? (s.unit === 'day' ? ' (hasta ahora)' : ' (en curso)') : '';
  if (s.unit === 'hour') return long ? `${hh(v)} – ${hh((v + 1) % 24)}${tail}` : String(v).padStart(2, '0');
  if (s.unit === 'day') return long ? fmtDayLong(v) + tail : fmtDay(v);
  if (long) return fmtMonthLong(v) + tail;
  const base = clean(DF_M.format(dd(v)));
  return v.endsWith('-01') || i === 0 ? `${base} ${v.slice(2, 4)}` : base;
}
function prevLabel(i) {
  const s = ST.data.series;
  if (s.unit === 'hour') return ST.range === 'today' ? 'Ayer' : 'El día anterior';
  if (s.unit === 'day') return fmtDay(addDays(s.labels[i], -s.labels.length));
  return 'Periodo anterior';
}
function chartTable(hasPrev) {
  const s = ST.data.series, m = ST.metric, cur = s[m], prev = s[`p${m}`];
  return `<div class="tscroll"><table class="tbl"><thead><tr><th>${s.unit === 'hour' ? 'Hora' : s.unit === 'day' ? 'Día' : 'Mes'}</th><th>${METRICS[m]}</th>${hasPrev ? `<th>${ST.range === 'today' ? 'Ayer' : 'Periodo anterior'}</th>` : ''}</tr></thead><tbody>
    ${s.labels.map((_, i) => `<tr><td>${X.esc(xLabel(i, true))}</td><td>${cur[i] == null ? '–' : int(cur[i])}</td>${hasPrev ? `<td>${int(prev[i])}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; }
let chartRO = null;
function wireChart() {
  const b = $('#tr-tbl-t', root); if (b) b.addEventListener('click', () => { ST.table = !ST.table; $('#tr-chart-card', root).outerHTML = chartCard(!ST.data.kpi.pv && !(ST.data.prev && ST.data.prev.pv)); wireChart(); });
  const wrap = $('#tr-ch', root); if (!wrap) return;
  drawChart(wrap);
  if (chartRO) chartRO.disconnect();
  let raf = 0, lastW = wrap.clientWidth;
  chartRO = new ResizeObserver(() => { if (Math.abs(wrap.clientWidth - lastW) < 2) return; lastW = wrap.clientWidth; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (wrap.isConnected) drawChart(wrap); }); });
  chartRO.observe(wrap);
}
function drawChart(wrap) {
  const s = ST.data.series, m = ST.metric, cur = s[m], prevRaw = s[`p${m}`];
  const prev = prevRaw && prevRaw.some((x) => x > 0) ? prevRaw : null;
  const n = cur.length, bars = s.unit === 'month';
  const W = Math.max(280, wrap.clientWidth), H = W < 520 ? 210 : 250;
  const vals = [...cur.filter((x) => x != null), ...(prev || [])];
  const ticks = niceTicks(Math.max(1, ...vals)), top = ticks[ticks.length - 1];
  const left = Math.max(...ticks.map((t) => axisNum(t, top).length)) * 7.5 + 14, right = 14, tpad = 10, bottom = 26;
  const pw = W - left - right, ph = H - tpad - bottom;
  const band = pw / n;
  const x = (i) => (bars ? left + band * (i + 0.5) : left + (n === 1 ? pw / 2 : (i * pw) / (n - 1)));
  const y = (v) => tpad + ph - (v / top) * ph;
  wrap.querySelectorAll('svg').forEach((e) => e.remove());
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tr-svg', tabindex: '0', role: 'img',
    'aria-label': `${METRICS[m]} en ${RANGE_TXT[ST.range]}: ${int(m === 'uv' ? ST.data.kpi.uv : ST.data.kpi[m])}. Usa las flechas para recorrer los valores o «Ver tabla».` });
  // rejilla y eje
  for (const t of ticks) {
    svgEl('line', { x1: left, x2: W - right, y1: y(t), y2: y(t), class: t === 0 ? 'tr-base' : 'tr-gl' }, svg);
    const tx = svgEl('text', { x: left - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tr-ax' }, svg); tx.textContent = axisNum(t, top);
  }
  const maxLabels = Math.max(2, Math.floor(pw / (s.unit === 'day' ? 58 : 40)));
  let step = Math.ceil(n / maxLabels);
  if (s.unit === 'hour') step = [1, 2, 3, 4, 6, 12].find((k) => k >= step) || 12;
  for (let i = 0; i < n; i++) {
    const show = s.unit === 'day' ? (n - 1 - i) % step === 0 : i % step === 0;
    if (!show) continue;
    const tx = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'tr-ax' }, svg); tx.textContent = xLabel(i);
  }
  const pts = (arr) => arr.map((v, i) => (v == null ? null : [x(i), y(v)]));
  const path = (p) => { let d = '', on = false; for (const q of p) { if (!q) { on = false; continue; } d += (on ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); on = true; } return d; };
  if (bars) {
    const bw = Math.min(24, band * 0.6), r = Math.min(4, bw / 2);
    cur.forEach((v, i) => {
      if (!v) return;
      const x0 = x(i) - bw / 2, y0 = y(v), h = tpad + ph - y0, rr = Math.min(r, h);
      svgEl('path', { d: `M${x0} ${tpad + ph}V${y0 + rr}Q${x0} ${y0} ${x0 + rr} ${y0}H${x0 + bw - rr}Q${x0 + bw} ${y0} ${x0 + bw} ${y0 + rr}V${tpad + ph}Z`, class: 'tr-bar' + (inProgress(i) ? ' part' : ''), 'data-i': i }, svg);
    });
  } else {
    const pc = pts(cur), lastI = pc.reduce((a, q, i) => (q ? i : a), -1);
    const live = lastI > 0 && inProgress(lastI);
    // el periodo anterior también se corta a la misma hora en su último día (salvo la línea de ayer, que va entera)
    const prevLive = live && s.unit === 'day';
    const line = (p, cls, cut) => {
      if (!cut) { svgEl('path', { d: path(p), class: cls }, svg); return; }
      svgEl('path', { d: path(p.slice(0, -1)), class: cls }, svg);
      const a = p[p.length - 2], b = p[p.length - 1];
      if (a && b) svgEl('path', { d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`, class: cls + ' part' }, svg);
    };
    if (prev) line(pts(prev), 'tr-l prev', prevLive);
    if (lastI > 0) svgEl('path', { d: `${path(pc.slice(0, lastI + 1))}L${pc[lastI][0].toFixed(1)} ${tpad + ph}L${pc[0][0].toFixed(1)} ${tpad + ph}Z`, class: 'tr-area' }, svg);
    line(pc.slice(0, lastI + 1), 'tr-l cur', live);
    if (n <= 14) pc.forEach((q) => { if (q) svgEl('circle', { cx: q[0], cy: q[1], r: 4, class: 'tr-dotm' }, svg); });
    else if (lastI >= 0) svgEl('circle', { cx: pc[lastI][0], cy: pc[lastI][1], r: 4, class: 'tr-dotm' }, svg);
  }
  // capa de lectura: línea vertical que sigue al puntero (o a las flechas del teclado) y un cuadro con los valores
  const hl = svgEl('g', { class: 'tr-hl', visibility: 'hidden' }, svg);
  const vline = bars ? null : svgEl('line', { y1: tpad, y2: tpad + ph, class: 'tr-cross' }, hl);
  const dPrev = prev && !bars ? svgEl('circle', { r: 4, class: 'tr-dotp' }, hl) : null;
  const dCur = bars ? null : svgEl('circle', { r: 4, class: 'tr-dotm' }, hl);
  wrap.appendChild(svg);
  const tip = $('#tr-tip', wrap);
  const lastData = cur.reduce((a, v, i) => (v != null ? i : a), 0);
  const show = (i) => {
    if (i == null) { hl.setAttribute('visibility', 'hidden'); tip.hidden = true; $$('.tr-bar.on', svg).forEach((b) => b.classList.remove('on')); ST.hover = null; return; }
    i = Math.max(0, Math.min(n - 1, i)); ST.hover = i;
    hl.setAttribute('visibility', 'visible');
    if (vline) { vline.setAttribute('x1', x(i)); vline.setAttribute('x2', x(i)); }
    if (dCur) { if (cur[i] == null) dCur.setAttribute('visibility', 'hidden'); else { dCur.setAttribute('visibility', 'visible'); dCur.setAttribute('cx', x(i)); dCur.setAttribute('cy', y(cur[i])); } }
    if (dPrev) { dPrev.setAttribute('cx', x(i)); dPrev.setAttribute('cy', y(prev[i] || 0)); }
    $$('.tr-bar', svg).forEach((b) => b.classList.toggle('on', Number(b.getAttribute('data-i')) === i));
    tip.textContent = '';
    const h = document.createElement('div'); h.className = 'h'; h.textContent = xLabel(i, true); tip.appendChild(h);
    const row = (cls, val, name) => { const r = document.createElement('div'); r.className = 'r'; const k = document.createElement('i'); k.className = 'k ' + cls; const b = document.createElement('b'); b.textContent = val; const sp = document.createElement('span'); sp.textContent = name; r.append(k, b, sp); tip.appendChild(r); };
    row('cur', cur[i] == null ? '–' : int(cur[i]), METRICS[m].toLowerCase());
    if (prev) row('prev', int(prev[i]), prevLabel(i));
    tip.hidden = false;
    const tw = tip.offsetWidth, px = x(i);
    tip.style.left = Math.max(0, Math.min(W - tw, px - tw / 2)) + 'px';
    tip.style.top = Math.max(0, (cur[i] != null ? y(cur[i]) : tpad) - tip.offsetHeight - 12) + 'px';
  };
  const idxAt = (ev) => { const r = svg.getBoundingClientRect(); const px = ev.clientX - r.left; return bars ? Math.floor((px - left) / band) : Math.round(((px - left) / pw) * (n - 1)); };
  svg.addEventListener('pointermove', (ev) => { const i = idxAt(ev); if (bars && (i < 0 || i >= n)) return show(null); show(i); });
  svg.addEventListener('pointerdown', (ev) => { const i = idxAt(ev); if (!bars || (i >= 0 && i < n)) show(i); });
  svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') show(null); });
  ST.hideTip = () => show(null);
  svg.addEventListener('focus', () => show(ST.hover ?? lastData));
  svg.addEventListener('blur', () => show(null));
  svg.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'Home' && ev.key !== 'End') return;
    ev.preventDefault();
    const i = ST.hover ?? lastData;
    show(ev.key === 'Home' ? 0 : ev.key === 'End' ? lastData : i + (ev.key === 'ArrowLeft' ? -1 : 1));
  });
}

// ---------- listas ----------
function listCard(title, sub, rows, key, extra = '') {
  const total = rows.reduce((a, r) => a + r.n, 0), max = Math.max(1, ...rows.map((r) => r.n));
  const open = ST.open[key], list = open ? rows : rows.slice(0, LIST_N);
  const body = rows.length ? `<ul class="tr-list">${list.map((r) => `<li><div class="tr-li"><span class="nm">${r.label}</span><span class="val"><b>${int(r.n)}</b><small>${total ? Math.round((r.n / total) * 100) : 0} %</small></span></div><div class="tr-track" aria-hidden="true"><i style="width:${Math.max(1.5, (r.n / max) * 100)}%"></i></div></li>`).join('')}</ul>
    ${rows.length > LIST_N ? `<button class="linkbtn tr-more" type="button" data-more="${key}" aria-expanded="${!!open}">${open ? 'Ver menos' : `Ver todos (${rows.length})`}</button>` : ''}` : '<p class="muted tr-none">Sin datos en este periodo.</p>';
  return `<div class="card tr-card" data-card="${key}"><div class="card-h"><h2>${title}</h2><small>${sub}</small></div><div class="card-b">${body}${extra}</div></div>`;
}
function pagesCard() { return listCard('Páginas más vistas', 'páginas vistas', ST.data.dims.pg.map(([k, n]) => ({ label: X.esc(PAGE[k] || k), n })), 'pg'); }
function playersCard() {
  const rows = ST.data.dims.pl.map(([id, n]) => {
    const o = ST.names && ST.names.get(String(id));
    return { label: `<a href="#j-${encodeURIComponent(id)}">${o && o.rk ? X.rank(o.rk, 16) : ''}${X.esc(o ? o.n : 'Jugador ' + id)}</a>`, n };
  });
  return listCard('Jugadores más vistos', 'visitas a su perfil', rows, 'pl');
}
function sourcesCard() {
  const extra = `<p class="tr-foot">«Directo» incluye enlaces guardados, escritos a mano y los que se abren desde apps que no dicen de dónde vienen (Discord de escritorio, WhatsApp…). Para saber cuántos llegan desde un enlace concreto, añádele <span class="code">?ref=nombre</span>.</p>`;
  return listCard('De dónde vienen', 'visitas', ST.data.dims.src.map(([k, n]) => ({ label: X.esc(srcLabel(k)), n })), 'src', extra);
}
function countriesCard() { return listCard('Países', 'visitas', ST.data.dims.cc.map(([k, n]) => ({ label: `<span class="tr-flag" aria-hidden="true">${flag(k)}</span>${X.esc(country(k))}`, n })), 'cc'); }
function devicesCard() {
  const d = ST.data.dims, ss = ST.data.kpi.ss;
  const extra = ss ? `<p class="tr-foot">Desde la app instalada: <b>${int(d.app)}</b> ${d.app === 1 ? 'visita' : 'visitas'} (${pctTxt(d.app / ss)}).</p>` : '';
  return listCard('Dispositivos', 'visitas', d.dev.map(([k, n]) => ({ label: X.esc(DEV[k] || k), n })), 'dev', extra);
}
function languagesCard() {
  // idioma en que ven la web (el elegido en el menú o el de la dirección)
  const d = ST.data.dims, NM = { en: 'inglés', es: 'español', fr: 'francés', de: 'alemán', pt: 'portugués', tr: 'turco' };
  const sl = (d.sl || []).filter(([k]) => NM[k]), t = sl.reduce((s, [, n]) => s + n, 0);
  const extra = t ? `<p class="tr-foot">Ven la web en ${sl.map(([k, n]) => `${NM[k]} el <b>${pctTxt(n / t)}</b>`).join(', ').replace(/, ([^,]*)$/, ' y $1')} de las visitas.</p>` : '';
  return listCard('Idioma del navegador', 'visitas', d.lang.map(([k, n]) => ({ label: X.esc(language(k)), n })), 'lang', extra);
}
function loyaltyCard() {
  const k = ST.data.kpi, pps = ST.data.dims.pps || [], tot = pps.reduce((a, b) => a + b, 0), max = Math.max(1, ...pps);
  const ret = k.duv ? k.nr / k.duv : null;
  return `<div class="card tr-card"><div class="card-h"><h2>Fidelidad</h2><small>cuánto se quedan</small></div><div class="card-b">
    <div class="tr-figs"><div><b>${pctTxt(ret)}</b><span>de los visitantes de cada día ya habían entrado antes ese mes</span></div><div><b>${pctTxt(k.ss ? k.en / k.ss : null)}</b><span>de las visitas ven más de una página o se quedan más de 10 s</span></div></div>
    <ul class="tr-list">${PPS.map((l, i) => `<li><div class="tr-li"><span class="nm">${l}</span><span class="val"><b>${int(pps[i])}</b><small>${tot ? Math.round(((pps[i] || 0) / tot) * 100) : 0} %</small></span></div><div class="tr-track" aria-hidden="true"><i style="width:${pps[i] ? Math.max(1.5, (pps[i] / max) * 100) : 0}%"></i></div></li>`).join('')}</ul>
    <p class="tr-foot">Visitas según cuántas páginas ven.</p></div></div>`;
}
function actionsCard() {
  const ev = Object.fromEntries(ST.data.dims.ev);
  return `<div class="card tr-card"><div class="card-h"><h2>Acciones</h2><small>lo que hace la gente</small></div><div class="card-b"><ul class="tr-acts">
    ${EV.map(([k, l]) => `<li><span>${l}</span><b>${int(ev[k])}</b></li>`).join('')}</ul></div></div>`;
}

// ---------- cuándo entra la gente ----------
function heatCard() {
  const hm = ST.data.heat;
  if (!hm) return '';
  const flat = hm.flat(), max = Math.max(0, ...flat), tot = flat.reduce((a, b) => a + b, 0);
  const lvl = (v) => (!v ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
  let best = [0, 0]; hm.forEach((r, d) => r.forEach((v, h) => { if (v > hm[best[0]][best[1]]) best = [d, h]; }));
  const head = `<div class="card-h"><div><h2>Cuándo entra la gente</h2><small>visitas por día de la semana y hora · hora de Madrid</small></div><button class="btn sm" type="button" id="tr-heat-t" aria-pressed="${ST.heatTable}">${ST.heatTable ? 'Ver mapa' : 'Ver tabla'}</button></div>`;
  if (ST.heatTable) {
    return `<div class="card tr-heat" id="tr-heat">${head}<div class="card-b"><div class="tscroll"><table class="tbl"><thead><tr><th>Día</th>${Array.from({ length: 24 }, (_, h) => `<th>${String(h).padStart(2, '0')}</th>`).join('')}</tr></thead><tbody>
      ${hm.map((r, d) => `<tr><td>${WD[d]}</td>${r.map((v) => `<td>${v ? int(v) : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></div>`;
  }
  return `<div class="card tr-heat" id="tr-heat">${head}<div class="card-b">
    ${tot ? `<p class="tr-foot" style="margin:0 0 10px">Hora con más visitas: <b>${WD[best[0]].toLowerCase()} de ${hh(best[1])} a ${hh((best[1] + 1) % 24)}</b>.</p>` : ''}
    <div class="tr-hm" role="img" aria-label="Mapa de calor de visitas por día y hora. Usa «Ver tabla» para leer los valores.">
      <span></span>${Array.from({ length: 24 }, (_, h) => `<span class="hx">${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>`).join('')}
      ${hm.map((r, d) => `<span class="hy">${WD[d].slice(0, 3)}</span>${r.map((v, h) => `<span class="c l${lvl(v)}" data-tip="${WD[d]} ${hh(h)}–${hh((h + 1) % 24)}: ${int(v)} ${v === 1 ? 'visita' : 'visitas'}"></span>`).join('')}`).join('')}
    </div>
    <div class="tr-scale" aria-hidden="true"><span>Menos</span>${[0, 1, 2, 3, 4, 5].map((i) => `<i class="c l${i}"></i>`).join('')}<span>Más</span></div>
    <div class="tr-tip" id="tr-htip" hidden></div></div></div>`;
}
function wireHeat() {
  const g = $('.tr-hm', root), tip = $('#tr-htip', root); if (!g || !tip) return;
  const card = g.closest('.card-b');
  g.addEventListener('pointermove', (e) => {
    const c = e.target.closest('.c'); if (!c) { tip.hidden = true; return; }
    $$('.c.on', g).forEach((x) => x.classList.remove('on')); c.classList.add('on');
    tip.textContent = c.getAttribute('data-tip'); tip.hidden = false;
    const cr = card.getBoundingClientRect(), r = c.getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(cr.width - tip.offsetWidth, r.left - cr.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
    tip.style.top = (r.top - cr.top - tip.offsetHeight - 8) + 'px';
  });
  g.addEventListener('pointerleave', () => { tip.hidden = true; $$('.c.on', g).forEach((x) => x.classList.remove('on')); });
}

// ---------- cómo se cuenta ----------
function aboutCard() {
  let off = false; try { off = !!localStorage.getItem(X.NOTRACK_KEY); } catch {}
  const first = ST.data.first;
  const home = location.origin + '/';
  return `<div class="card tr-about"><div class="card-h"><h2>Cómo se cuenta</h2>${first ? `<small>contando desde el ${fmtDay(first)}</small>` : ''}</div><div class="card-b">
    <ul class="tr-how">
      <li><b>Visitantes</b>: personas distintas. Sin cookies, así que es aproximado: el mismo móvil con otra conexión cuenta como otra persona. Se reinicia cada mes.</li>
      <li><b>Visitas</b>: cada vez que alguien entra; termina tras 30 minutos sin actividad. <b>Tiempo medio</b>: con la web a la vista.</li>
      <li>No cuentan los robots ni los navegadores automáticos, ni tus visitas mientras tengas la sesión de administrador abierta. Todo en hora de Madrid.</li>
      <li>Enlace con etiqueta para saber de dónde llega la gente: <span class="code">${X.esc(home)}?ref=discord</span></li>
    </ul>
    <div class="tr-acts-row"><label class="tr-check"><input type="checkbox" id="tr-notrack"${off ? ' checked' : ''}> No contar nunca mis visitas desde este navegador</label>
    <span class="tr-btns"><button class="btn sm" type="button" id="tr-forget" title="Por si has entrado hoy desde este navegador sin la sesión de administrador">Quitar mis visitas de hoy</button><button class="btn sm" type="button" id="tr-csv">Descargar CSV</button></span></div>
  </div></div>`;
}
function csv() {
  const d = ST.data;
  const rows = d.days
    ? [['día', 'visitantes', 'visitas', 'páginas vistas', 'visitas con interacción', 'segundos con la web a la vista'], ...d.days]
    : [['hora', 'visitantes', 'visitas', 'páginas vistas'], ...d.series.labels.map((h, i) => [hh(h), d.series.uv[i] ?? '', d.series.ss[i] ?? '', d.series.pv[i] ?? ''])];
  const blob = new Blob(['﻿' + rows.map((r) => r.join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `slapscore-trafico-${d.from}${d.to !== d.from ? '_' + d.to : ''}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
