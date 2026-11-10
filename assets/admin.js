// Panel de administración de SlapScore.
// Usa un token de GitHub (solo en este navegador) para lanzar el robot y cambiar config/settings.json.
// El buzón de sugerencias vive en el Worker de Cloudflare: el mismo token sirve para leerlo (el Worker lo comprueba con GitHub).
const API = 'https://api.github.com';
const WF = 'crawl.yml';
const RUN_KEY = 'slapscore-run';
const TAB_KEY = 'slapscore-admtab';
const REPO = (() => {
  const h = location.hostname, seg = location.pathname.split('/').filter(Boolean);
  return h.endsWith('.github.io') && seg[0] ? `${h.split('.')[0]}/${seg[0]}` : 'mansowtcg/slapscore';
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let X = null;          // contexto de la app
let tracking = false;  // seguimiento de una pasada en curso
let wfState = null;

const encodeB64 = (s) => { let bin = ''; new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
const decodeB64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\s/g, '')), (c) => c.charCodeAt(0)));
function token() { try { return JSON.parse(localStorage.getItem(X.ADMIN_KEY) || 'null')?.token || null; } catch { return null; } }
function setToken(t) { try { if (t) localStorage.setItem(X.ADMIN_KEY, JSON.stringify({ token: t, at: Date.now() })); else localStorage.removeItem(X.ADMIN_KEY); } catch {} }
function ghMessage(status, j) {
  if (status === 401) return 'El token no es válido o ha caducado. Crea uno nuevo.';
  if (status === 403) return 'Al token le falta permiso: necesita Actions y Contents en «Read and write».';
  if (status === 404) return `El token no tiene acceso al repositorio ${REPO}.`;
  if (status === 409) return 'Los ajustes cambiaron mientras guardabas. Vuelve a intentarlo.';
  return j && j.message ? `GitHub: ${j.message}` : `GitHub respondió con un error ${status}.`;
}
async function gh(path, opts = {}, tk) {
  const t = tk || token();
  if (!t) throw new Error('Inicia sesión de administrador.');
  let r;
  try {
    r = await fetch(`${API}/repos/${REPO}${path}`, { ...opts, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${t}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch { throw new Error('No hay conexión con GitHub.'); }
  if (r.status === 204) return null;
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(ghMessage(r.status, j)); e.status = r.status; throw e; }
  return j;
}

// ---------- ajustes (config/settings.json) ----------
async function readSettings() {
  const j = await gh('/contents/config/settings.json?ref=main');
  return { sha: j.sha, data: JSON.parse(decodeB64(j.content)) };
}
async function writeSettings(mutate, message) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const { sha, data } = await readSettings();
      const next = mutate(JSON.parse(JSON.stringify(data))) || data;
      for (const k of ['seeds', 'hidden', 'hiddenPlayers', 'supporters']) if (!Array.isArray(next[k])) next[k] = [];
      if (!next.weights || typeof next.weights !== 'object') next.weights = {};
      await gh('/contents/config/settings.json', { method: 'PUT', body: JSON.stringify({ message, content: encodeB64(JSON.stringify(next, null, 2) + '\n'), sha, branch: 'main' }) });
      X.applySettings(next);
      startTracking({ since: Date.now() - 5000, minutes: 1, kind: 'push', label: 'Aplicando los cambios' });
      return next;
    } catch (e) { lastErr = e; if (e.status !== 409) break; }
  }
  throw lastErr;
}
// Los ocultos se guardan como "día/hora|id" para que el robot los encuentre sin buscar
const hidId = (h) => String(h).split('|').pop();
export async function toggleHidden(id, hide, ctx, key) {
  X = ctx;
  await writeSettings((s) => { s.hidden = (s.hidden || []).filter((x) => hidId(x) !== id); if (hide) s.hidden.push(key ? `${key}|${id}` : id); return s; }, `${hide ? 'Ocultar' : 'Mostrar'} partido ${id}`);
  X.toast(hide ? 'Partido oculto. Desaparece de las listas al momento y de los rankings en unos minutos.' : 'Partido visible de nuevo.');
  X.go({ keepScroll: true, instant: true });
}

// Seguir / dejar de seguir a un jugador desde su perfil (los seguidos son destacados: van los primeros)
export async function followPlayer(id, follow, ctx) {
  X = ctx;
  await writeSettings((s) => { const cur = (s.seeds || []).map(String).filter((x) => x !== id); s.seeds = follow ? [...cur, id] : cur; return s; }, `${follow ? 'Seguir' : 'Dejar de seguir'} jugador ${id}`);
  X.toast(follow ? 'Jugador seguido: se revisará en cada pasada mientras juegue' : 'Ya no se sigue a este jugador');
  X.go({ keepScroll: true, instant: true });
}

// ---------- montar ----------
export async function mount(root, ctx) {
  X = ctx;
  if (!token()) return login(root);
  const { esc } = X;
  let tab = 'traffic'; try { if (localStorage.getItem(TAB_KEY) === 'robot') tab = 'robot'; } catch {}
  root.innerHTML = `<h1 class="h1 in">Administrador</h1><p class="lead">Repositorio <b>${esc(REPO)}</b>. Los cambios los hace GitHub con tu token, que solo está guardado en este navegador. <button class="btn sm" type="button" id="logout" style="margin-left:6px">Cerrar sesión</button></p>
  <div class="seg adm-tabs" role="tablist" aria-label="Secciones del panel">${[['traffic', 'Tráfico'], ['robot', 'Robot y ajustes']].map(([k, l]) => `<button type="button" role="tab" id="tab-${k}" aria-controls="pane-${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-tab="${k}">${l}</button>`).join('')}</div>
  <section id="pane-traffic" role="tabpanel" aria-labelledby="tab-traffic"${tab === 'traffic' ? '' : ' hidden'}></section>
  <section id="pane-robot" role="tabpanel" aria-labelledby="tab-robot"${tab === 'robot' ? '' : ' hidden'}>
  <div class="adm-grid">
    <div class="col">
      <div class="card in"><div class="card-h"><h3>Traer partidos ahora</h3></div><div class="card-b">
        <p class="muted" style="margin-top:0">Lanza una pasada del robot sin esperar a la siguiente. Cuanto más dure, más jugadores revisa (unos 9 por minuto).</p>
        <div class="toolbar"><div class="seg" role="group" aria-label="Duración">${[[3, 'Rápida · 3 min'], [8, 'Normal · 8 min'], [15, 'Larga · 15 min']].map(([v, l]) => `<button type="button" data-min="${v}" aria-pressed="${v === 8}">${l}</button>`).join('')}</div>
        <button class="btn primary" type="button" id="go-now">Traer partidos ahora</button></div>
        <div id="prog"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Estado del robot</h3><span id="wf-pill"></span></div><div class="card-b" id="wf"><div class="sk" style="height:90px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Avisos por email</h3><small>si la web deja de actualizarse</small></div><div class="card-b" id="alerts"><div class="sk" style="height:60px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Últimas pasadas</h3><a href="https://github.com/${esc(REPO)}/actions" target="_blank" rel="noopener">Ver en GitHub</a></div><div class="runs" id="runs"><div class="card-b"><div class="sk" style="height:120px"></div></div></div></div>
    </div>
    <div class="col">
      <div class="card in" id="inbox-card"><div class="card-h"><h3>Buzón de sugerencias</h3><button class="btn sm" type="button" id="inbox-reload">Actualizar</button></div><div id="inbox"><div class="card-b"><div class="sk" style="height:90px"></div></div></div></div>
      <div class="card in"><div class="card-h"><h3>Ko-fi</h3><small>insignia ♥ automática al apoyar</small></div><div id="kofi"><div class="card-b"><div class="sk" style="height:80px"></div></div></div></div>
      <div class="card in"><div class="card-h"><h3>Supporters</h3><small>apoyan el proyecto: insignia ♥ y sus partidos al momento</small></div><div id="sups"><div class="card-b"><div class="sk" style="height:60px"></div></div></div></div>
      <div class="card in"><div class="card-h"><h3>Jugadores seguidos</h3><small>destacados: si juegan, se revisan en cada pasada</small></div><div id="seeds"><div class="card-b"><div class="sk" style="height:100px"></div></div></div></div>
      <div class="card in"><div class="card-h"><h3>Fórmula de la nota</h3></div><div class="card-b" id="weights"><div class="sk" style="height:160px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Logos de rango</h3><small>se ven en toda la web</small></div><div class="card-b" id="ranks"><div class="sk" style="height:120px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Web, archivo y apoyo</h3></div><div class="card-b" id="extra"><div class="sk" style="height:120px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Partidos ocultos</h3></div><div id="hidden"><div class="card-b"><div class="sk" style="height:40px"></div></div></div></div>
      <div class="card in"><div class="card-h"><h3>Jugadores ocultos</h3><small>han pedido no aparecer (privacidad)</small></div><div id="hidplayers"><div class="card-b"><div class="sk" style="height:40px"></div></div></div></div>
    </div>
  </div></section>`;
  // pestañas: Tráfico (se carga al abrirla por primera vez) y Robot y ajustes
  let trafficOn = false;
  const showTab = (k, focus) => {
    $$('[data-tab]', root).forEach((b) => { const on = b.getAttribute('data-tab') === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    $('#pane-traffic', root).hidden = k !== 'traffic'; $('#pane-robot', root).hidden = k !== 'robot';
    try { localStorage.setItem(TAB_KEY, k); } catch {}
    if (k === 'traffic' && !trafficOn) {
      trafficOn = true;
      import('./traffic.js').then((T) => T.mount($('#pane-traffic', root), X, token)).catch((e) => { trafficOn = false; $('#pane-traffic', root).innerHTML = `<div class="card"><div class="card-b err" style="padding-top:16px">${X.esc(e.message || 'No se pudo cargar el panel de tráfico.')}</div></div>`; });
    }
  };
  $$('[data-tab]', root).forEach((b) => {
    b.addEventListener('click', () => showTab(b.getAttribute('data-tab')));
    b.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); showTab(b.getAttribute('data-tab') === 'traffic' ? 'robot' : 'traffic', true); } });
  });
  showTab(tab);
  $('#logout').addEventListener('click', () => { setToken(null); X.renderChrome(); X.toast('Sesión de administrador cerrada'); X.navTo('#partidos', true); });
  let minutes = 8;
  $$('[data-min]', root).forEach((b) => b.addEventListener('click', () => { minutes = Number(b.getAttribute('data-min')); $$('[data-min]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  $('#go-now').addEventListener('click', () => bringNow(minutes));
  drawProgress(null);
  loadWorkflow(); loadRuns(); drawRanks(); loadInbox(); loadAlerts(); loadKofi();
  $('#inbox-reload').addEventListener('click', () => loadInbox());
  try { const st = await readSettings(); X.applySettings(st.data); drawSeeds(st.data); drawWeights(st.data); drawHidden(st.data); drawHidPlayers(st.data); drawSups(st.data); drawExtra(st.data); }
  catch (e) { for (const id of ['seeds', 'hidden', 'hidplayers', 'sups', 'extra']) { const el = $('#' + id); if (el) el.innerHTML = `<div class="card-b err">${X.esc(e.message)}</div>`; } const w = $('#weights'); if (w) w.innerHTML = `<p class="err">${X.esc(e.message)}</p>`; if (e.status === 401) { setToken(null); X.renderChrome(); } }
  if (sessionStorage.getItem(RUN_KEY)) track();
}

function login(root) {
  root.innerHTML = `<div class="card in" style="max-width:420px;margin:24px auto"><div class="card-b">
    <form id="login" style="display:flex;flex-direction:column;gap:12px" autocomplete="off"><input class="input" id="tk" type="password" autocomplete="off" aria-label="Token" required>
    <p class="err" id="lerr" hidden></p><div><button class="btn primary" type="submit" id="lbtn">Entrar</button></div></form>
  </div></div>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = $('#tk').value.trim(), err = $('#lerr'), btn = $('#lbtn');
    if (!t) return;
    btn.disabled = true; btn.textContent = 'Comprobando…'; err.hidden = true;
    try {
      await gh(`/actions/workflows/${WF}`, {}, t);
      await gh('/contents/config/settings.json?ref=main', {}, t);
      setToken(t); try { localStorage.setItem(X.NOTRACK_KEY, '1'); } catch {}   // tus visitas no cuentan en las estadísticas
      X.renderChrome(); X.toast('Sesión de administrador iniciada');
      if (X.curHash() === '#admin') mount(root, X); else X.navTo('#admin', true);   // la dirección de entrada no se queda en la barra
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Entrar'; }
  });
}

// ---------- Worker de Cloudflare (rutas del administrador) ----------
async function workerApi(path, opts = {}) {
  let r;
  try { r = await fetch(X.apiBase() + path, { ...opts, cache: 'no-store', headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } }); }
  catch { throw new Error('No se pudo conectar con el servidor de Cloudflare.'); }
  let j = null; try { j = await r.json(); } catch {}
  if (r.status === 401) throw new Error('Cloudflare no ha aceptado tu token: tiene que ser de una cuenta con permiso de escritura en el repositorio.');
  if (r.status === 503) throw new Error('Aún no está activo en Cloudflare. Se activa solo con la siguiente pasada del robot.');
  if (!r.ok) throw new Error((j && typeof j.error === 'string' && j.error.length > 8 ? j.error : `El servidor respondió con un error ${r.status}.`));
  return j;
}

// ---------- avisos por email ----------
async function loadAlerts() {
  const el = $('#alerts'); if (!el) return;
  const { esc, ago } = X;
  let a;
  try { a = await workerApi('/api/alerts'); } catch (e) { el.innerHTML = `<p class="err" style="margin:0">${esc(e.message)}</p>`; return; }
  const status = a.problem ? `<b class="err">Problema:</b> ${esc(a.problem)}` : a.checked ? `Todo bien · última comprobación ${esc(ago(a.checked))}` : 'Se comprueba dos veces por hora.';
  el.innerHTML = `<p class="muted" style="margin-top:0">Te escribe si los partidos llevan más de 45 minutos sin actualizarse, te lo recuerda cada 12 horas y te avisa cuando se arregla. La dirección tiene que estar verificada en el reenvío de correo de Cloudflare.</p>
    <form id="al-form" class="al-form"><input class="input" id="al-email" type="email" inputmode="email" autocomplete="email" aria-label="Email para los avisos" placeholder="tu@email.com" value="${esc(a.email)}">
    <button class="btn primary" type="submit">Guardar</button><button class="btn" type="button" id="al-test"${a.email ? '' : ' disabled'}>Enviar prueba</button></form>
    <p class="muted" id="al-st" style="margin:10px 0 0">${status}</p>
    ${!a.mail ? '<p class="err" style="margin:6px 0 0">El envío de emails aún no está activo en Cloudflare: se activa con la siguiente pasada del robot.</p>' : a.err ? `<p class="err" style="margin:6px 0 0">Último intento de envío: ${esc(a.err)}</p>` : ''}`;
  $('#al-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('#al-form button[type=submit]'); btn.disabled = true;
    try { await workerApi('/api/alerts', { method: 'POST', body: JSON.stringify({ email: $('#al-email').value.trim() }) }); X.toast('Dirección guardada'); loadAlerts(); }
    catch (ex) { X.toast(ex.message); btn.disabled = false; }
  });
  $('#al-test').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Enviando…';
    try { await workerApi('/api/alerts/test', { method: 'POST' }); X.toast('Email de prueba enviado: mira tu bandeja de entrada (y Spam)'); }
    catch (ex) { X.toast(ex.message); }
    b.disabled = false; b.textContent = 'Enviar prueba';
  });
}

// ---------- Ko-fi ----------
const KOFI_HOOK = 'https://slapscore.app/api/kofi';
async function loadKofi() {
  const el = $('#kofi'); if (!el) return;
  const { esc, ago, int } = X;
  let k;
  try { k = await workerApi('/api/kofi'); } catch (e) { el.innerHTML = `<div class="card-b err">${esc(e.message)}</div>`; return; }
  let P = {}; try { P = await X.loadPlayers(); } catch {}
  const pname = (id) => (P[id] ? P[id].n : 'Jugador ' + id);
  const pidIn = (v) => { const m = /#j-(\d{1,12})\b/.exec(v) || /\/j\/(\d{1,12})\b/.exec(v) || /players\/(\d{1,12})/.exec(v) || /^(\d{1,12})$/.exec(v.trim()); return m ? m[1] : ''; };
  const setup = `<div class="card-b kofi-setup"><p class="muted" style="margin-top:0">${k.configured ? '<b class="ok-t">Conectado.</b> Cada apoyo aparece aquí. Si el mensaje lleva el ID o el enlace del perfil de slapshot.gg, la insignia ♥ se pone sola; si no, asígnala tú.' : 'Para que la insignia ♥ se ponga sola cuando alguien apoya:'}</p>
    ${k.configured ? '' : `<ol class="steps"><li>En Ko-fi, abre <a href="https://ko-fi.com/manage/webhooks" target="_blank" rel="noopener">Ajustes → API (webhooks)</a>.</li><li>En «Webhook URL» pega esta dirección y pulsa «Update»: <code class="kofi-url">${esc(KOFI_HOOK)}</code> <button class="btn sm" type="button" data-copy="${esc(KOFI_HOOK)}">Copiar</button></li><li>Abre «Advanced», copia el «Verification Token» y pégalo aquí abajo.</li><li>Prueba con «Send Single Donation Test»: el apoyo de prueba aparece en esta lista.</li></ol>`}
    <form id="kofi-tk" class="al-form"${k.configured ? ' hidden' : ''}><input class="input" id="kofi-tk-in" type="password" autocomplete="off" aria-label="Verification Token de Ko-fi" placeholder="Verification Token de Ko-fi"><button class="btn primary" type="submit">Guardar</button></form>
    ${k.configured ? '<button class="btn sm" type="button" id="kofi-tk-show">Cambiar la clave de Ko-fi</button>' : ''}</div>`;
  const items = k.items || [];
  const list = items.length ? `<div class="kofi-list">${items.map((x) => `<div class="kofi-it" data-key="${esc(x.key)}">
      <div class="kofi-h"><b>${esc(x.name)}</b><span class="kofi-amt">${esc(x.amount)} ${esc(x.cur)}</span><span class="muted">${esc(x.tier || (x.sub ? 'Suscripción' : x.type || 'Apoyo'))} · ${esc(ago(x.t))}</span><button class="ibtn-s" type="button" data-kofi-del="${esc(x.key)}" aria-label="Borrar este apoyo" title="Borrar">✕</button></div>
      ${x.msg ? `<p class="kofi-msg">${esc(x.msg)}</p>` : ''}
      ${x.pid ? `<p class="kofi-pid"><span class="sup">♥</span> ${esc(pname(x.pid))} <small>ID ${esc(x.pid)}</small></p>`
        : `<form class="al-form" data-kofi-as="${esc(x.key)}"><input class="input" aria-label="Jugador" placeholder="ID o enlace del perfil${x.cand ? ' (en el mensaje: ' + esc(x.cand) + ', no está en SlapScore)' : ''}"><button class="btn sm primary" type="submit">Dar insignia</button></form>`}
    </div>`).join('')}</div>` : `<div class="card-b muted">${k.configured ? 'Aún no ha llegado ningún apoyo.' : ''}</div>`;
  const sups = (k.supporters || []);
  const supl = sups.length ? `<div class="card-b" style="border-top:1px solid var(--line);padding-top:12px"><b style="font-size:13px">Supporters por Ko-fi (${int(sups.length)})</b>${sups.map((id) => `<div class="seedrow">${X.avatar(pname(id), id, 'sm')}<span class="nm">${esc(pname(id))} <span class="sup">♥</span><small>ID ${esc(id)}</small></span><button class="btn sm" type="button" data-kofi-rm="${esc(id)}">Quitar</button></div>`).join('')}</div>` : '';
  el.innerHTML = setup + list + supl;
  const post = async (path, body, okMsg) => { try { await workerApi(path, { method: 'POST', body: JSON.stringify(body) }); X.toast(okMsg); loadKofi(); } catch (e) { X.toast(e.message); } };
  const tk = $('#kofi-tk', el);
  tk.addEventListener('submit', (e) => { e.preventDefault(); const v = $('#kofi-tk-in', el).value.trim(); if (v) post('/api/kofi/token', { token: v }, 'Clave de Ko-fi guardada'); });
  const show = $('#kofi-tk-show', el); if (show) show.addEventListener('click', () => { tk.hidden = false; show.hidden = true; $('#kofi-tk-in', el).focus(); });
  $$('[data-kofi-as]', el).forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault(); const pid = pidIn($('input', f).value);
    if (!pid) { X.toast('Escribe el número de jugador o pega el enlace de su perfil.'); return; }
    post('/api/kofi/assign', { key: f.getAttribute('data-kofi-as'), pid }, 'Insignia ♥ dada: sale en la web en unos minutos');
  }));
  $$('[data-kofi-rm]', el).forEach((b) => b.addEventListener('click', () => post('/api/kofi/remove', { pid: b.getAttribute('data-kofi-rm') }, 'Quitado de supporters')));
  $$('[data-kofi-del]', el).forEach((b) => b.addEventListener('click', () => post('/api/kofi/delete', { key: b.getAttribute('data-kofi-del') }, 'Apoyo borrado de la lista')));
}

// ---------- buzón de sugerencias ----------
const FB_LABEL = { idea: 'Idea', bug: 'Error', other: 'Otro' };
let inboxFilter = '';
async function inboxApi(path = '', opts = {}) {
  let r;
  try { r = await fetch(X.apiBase() + '/api/feedback' + path, { ...opts, cache: 'no-store', headers: { Authorization: `Bearer ${token()}` } }); }
  catch { throw new Error('No se pudo conectar con el buzón (servidor de Cloudflare).'); }
  let j = null; try { j = await r.json(); } catch {}
  if (r.status === 401) throw new Error('El buzón no ha aceptado tu token: tiene que ser de una cuenta con permiso de escritura en el repositorio.');
  if (r.status === 503) throw new Error('El buzón aún no está activo en Cloudflare. Se activa solo con la siguiente pasada del robot.');
  if (!r.ok) throw new Error(`El buzón respondió con un error ${r.status}.`);
  return j;
}
async function loadInbox() {
  const el = $('#inbox'); if (!el) return;
  const { esc, ago } = X;
  el.innerHTML = '<div class="card-b"><div class="sk" style="height:90px"></div></div>';
  let items;
  try { items = (await inboxApi()).items || []; }
  catch (e) { el.innerHTML = `<div class="card-b err">${esc(e.message)}</div>`; return; }
  const draw = () => {
    const n = (k) => items.filter((x) => !k || x.type === k).length;
    const list = items.filter((x) => !inboxFilter || x.type === inboxFilter);
    el.innerHTML = `<div class="card-b" style="padding-bottom:6px"><div class="chips">${[['', 'Todos'], ['idea', 'Ideas'], ['bug', 'Errores'], ['other', 'Otros']].map(([k, l]) => `<button type="button" class="chip" data-ibf="${k}" aria-pressed="${inboxFilter === k}">${l} <span class="n">${n(k)}</span></button>`).join('')}</div></div>
      ${list.length ? `<div class="fb-list">${list.map((x) => `<div class="fb-it" data-id="${esc(x.id)}">
        <div class="fb-it-h"><span class="pill ${x.type === 'bug' ? 'ot' : x.type === 'idea' ? 'live' : ''}">${esc(FB_LABEL[x.type] || x.type)}</span><span class="muted">${esc(ago(x.t))} · ${new Date(x.t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${x.lang === 'en' ? ' · EN' : ''}</span>
          <button class="btn sm" type="button" data-del="${esc(x.id)}">Borrar</button></div>
        <p class="fb-tx">${esc(x.text)}</p>
        ${x.contact || x.page ? `<p class="muted fb-meta">${x.contact ? `Contacto: <b>${esc(x.contact)}</b>` : ''}${x.contact && x.page ? ' · ' : ''}${x.page ? `Página: ${/^#[\w\-:.%/]*$/.test(x.page) ? `<a href="${esc(x.page)}">${esc(x.page)}</a>` : esc(x.page)}` : ''}</p>` : ''}
      </div>`).join('')}</div>` : `<div class="empty">${items.length ? 'Ningún mensaje de este tipo.' : 'Todavía no ha llegado ningún mensaje.'}</div>`}`;
    $$('[data-ibf]', el).forEach((b) => b.addEventListener('click', () => { inboxFilter = b.getAttribute('data-ibf'); draw(); }));
    $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
      // dos pasos: el primer clic pide confirmación en el propio botón
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '¿Seguro? Borrar'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = 'Borrar'; b.classList.remove('danger'); } }, 4000); return; }
      b.disabled = true;
      try { await inboxApi('/' + b.getAttribute('data-del'), { method: 'DELETE' }); items = items.filter((x) => x.id !== b.getAttribute('data-del')); draw(); X.toast('Mensaje borrado'); }
      catch (e) { X.toast(e.message); b.disabled = false; }
    }));
  };
  draw();
}

// ---------- robot ----------
async function loadWorkflow() {
  const el = $('#wf'), pill = $('#wf-pill'); if (!el) return;
  const { esc, int, ago, S } = X;
  try {
    const [wf, rj] = await Promise.all([gh(`/actions/workflows/${WF}`), gh(`/actions/workflows/${WF}/runs?per_page=5`).catch(() => ({}))]);
    wfState = wf.state;
    const on = wf.state === 'active';
    const t = (S.index && S.index.totals) || {}, lr = (S.index && S.index.lastRun) || {};
    const runs = rj.workflow_runs || [];
    const live = runs.find((r) => r.status === 'in_progress'), queued = runs.find((r) => r.status !== 'completed' && r.status !== 'in_progress');
    const now = live ? `en marcha desde hace ${Math.max(1, Math.round((Date.now() - Date.parse(live.run_started_at || live.created_at)) / 60000))} min` : queued ? 'en cola, empieza enseguida' : on ? 'parada: pulsa «Traer partidos ahora» para relanzarla' : '–';
    pill.innerHTML = `<span class="pill ${on ? 'live' : 'warn'}"><span class="dot ${on ? 'pulse' : ''}"></span>${on ? 'Activo' : 'En pausa'}</span>`;
    el.innerHTML = `<dl class="kv"><dt>Pasadas automáticas</dt><dd>${on ? 'seguidas, la web se actualiza cada 3-4 min' : 'paradas'}</dd>
      <dt>Ahora</dt><dd>${esc(now)}</dd>
      <dt>Última pasada</dt><dd>${lr.at ? esc(ago(Date.parse(lr.at))) + ` · ${int(lr.newMatches)} nuevos` : '–'}</dd>
      <dt>Partidos guardados</dt><dd>${int(t.matches)}</dd><dt>Jugadores conocidos</dt><dd>${int(t.known)} (${int(t.tracked)} revisados)</dd><dt>Con rango</dt><dd>${int(t.ranked)}${t.rankBacklog ? ` · ${int(t.rankBacklog)} por consultar` : ''}</dd>${lr.prio != null ? `<dt>Destacados</dt><dd>${int(lr.prio)} revisados en la última pasada · ${int(lr.prioNew || 0)} partidos nuevos</dd>` : ''}</dl>
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn ${on ? 'danger' : 'primary'}" type="button" id="wf-toggle">${on ? 'Pausar robot' : 'Reanudar robot'}</button></div>`;
    $('#wf-toggle').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try {
        await gh(`/actions/workflows/${WF}/${on ? 'disable' : 'enable'}`, { method: 'PUT' });
        // al reanudar, se relanza la cadena de pasadas automáticas
        if (!on) await gh(`/actions/workflows/${WF}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { minutes: '3', chain: '1' } }) }).catch(() => {});
        X.toast(on ? 'Robot en pausa: la pasada en marcha termina y no habrá más' : 'Robot reanudado: la primera pasada empieza ya'); loadWorkflow(); loadRuns();
      }
      catch (ex) { X.toast(ex.message); b.disabled = false; }
    });
  } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; if (e.status === 401) { setToken(null); X.renderChrome(); } }
}
const EVENT = { schedule: 'Automática', workflow_dispatch: 'Manual', push: 'Cambio de ajustes' };
const eventLabel = (r) => (r.display_title === AUTO ? 'Automática' : EVENT[r.event] || r.event);
async function loadRuns() {
  const el = $('#runs'); if (!el) return;
  const { esc } = X;
  try {
    const j = await gh(`/actions/workflows/${WF}/runs?per_page=8`);
    const idxRuns = (X.S.index && X.S.index.runs) || [];
    const rows = (j.workflow_runs || []).map((r) => {
      const st = Date.parse(r.run_started_at || r.created_at), en = Date.parse(r.updated_at);
      const info = idxRuns.find((x) => { const t = Date.parse(x.at); return t >= st - 60000 && t <= en + 120000; });
      const status = r.status !== 'completed' ? '<span class="pill live"><span class="dot pulse"></span>En marcha</span>'
        : r.conclusion === 'success' ? '<span class="pill">Hecha</span>' : `<span class="pill ot">${r.conclusion === 'cancelled' ? 'Cancelada' : 'Falló'}</span>`;
      const dur = r.status === 'completed' ? Math.max(1, Math.round((en - st) / 60000)) + ' min' : '';
      return `<div class="row">${status}<span><b>${esc(eventLabel(r))}</b> · ${new Date(st).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${dur ? ' · ' + dur : ''}</span><span class="muted">${info ? `+${info.newMatches} partidos` : ''}</span><a href="${esc(r.html_url)}" target="_blank" rel="noopener">Ver</a></div>`;
    });
    el.innerHTML = rows.length ? rows.join('') : '<div class="empty">Todavía no hay pasadas.</div>';
  } catch (e) { el.innerHTML = `<div class="card-b err">${esc(e.message)}</div>`; }
}

// ---------- traer ahora + seguimiento ----------
const AUTO = 'Pasada automática';
const runMinutes = (r) => (r.display_title === AUTO ? 3 : r.event === 'push' ? 1 : 8);
async function bringNow(minutes) {
  if (tracking) { X.toast('Ya hay una pasada en marcha'); return; }
  if (wfState && wfState !== 'active') { X.toast('El robot está en pausa: reanúdalo para traer partidos.'); return; }
  const btn = $('#go-now'); if (btn) btn.disabled = true;
  try {
    // si ya hay una pasada en marcha, se sigue esa en vez de poner otra en cola detrás
    const cur = ((await gh(`/actions/workflows/${WF}/runs?per_page=5`)).workflow_runs || []).find((r) => r.status === 'in_progress');
    if (cur) { X.toast('Ya hay una pasada en marcha: te enseño cómo va'); startTracking({ runId: cur.id, since: Date.parse(cur.created_at), minutes: runMinutes(cur), kind: cur.event, label: 'Pasada en marcha' }); return; }
    await gh(`/actions/workflows/${WF}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { minutes: String(minutes), chain: '0' } }) });
    startTracking({ since: Date.now() - 5000, minutes, kind: 'workflow_dispatch', label: 'Trayendo partidos' });
  } catch (e) { X.toast(e.message); if (btn) btn.disabled = false; }
}
function startTracking(st) { try { sessionStorage.setItem(RUN_KEY, JSON.stringify(st)); } catch {} track(); }
const STAGES = ['En cola en GitHub', 'Rastreando slapshot.gg', 'Guardando datos', 'Publicando la web', 'Listo en la web'];
function drawProgress(p) {
  const el = $('#prog'); if (!el) return;
  const btn = $('#go-now'); if (btn) btn.disabled = !!(p && !p.done);
  if (!p) { el.innerHTML = ''; return; }
  const { esc } = X;
  el.innerHTML = `<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct)}"><i style="width:${p.pct.toFixed(1)}%"></i></div>
    <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;font-weight:700"><span>${esc(p.title)}</span><span class="muted">${esc(p.time || '')}</span></div>
    <div class="stage">${STAGES.map((s, i) => `<div class="${i < p.stage ? 'done' : i === p.stage && !p.done && !p.error ? 'on' : ''}${p.done && i <= p.stage ? ' done' : ''}"><i></i>${s}</div>`).join('')}</div>
    ${p.error ? `<p class="err">${esc(p.error)} ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">Ver detalles</a>` : ''}</p>` : ''}
    ${p.done && p.result ? `<p style="font-weight:700;color:var(--win)">${esc(p.result)}</p>` : ''}`;
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
async function track() {
  if (tracking) return;
  let st; try { st = JSON.parse(sessionStorage.getItem(RUN_KEY) || 'null'); } catch {}
  if (!st) return;
  tracking = true;
  const prevVer = X.S.ver, title = st.label || 'Trayendo partidos';
  const finish = () => { tracking = false; try { sessionStorage.removeItem(RUN_KEY); } catch {} };
  try {
    drawProgress({ pct: 3, stage: 0, title, time: '' });
    let run = st.runId ? await gh(`/actions/runs/${st.runId}`) : null;
    for (let i = 0; i < 40 && !run; i++) {
      const j = await gh(`/actions/workflows/${WF}/runs?per_page=10&event=${st.kind}`);
      run = (j.workflow_runs || []).find((r) => Date.parse(r.created_at) >= st.since - 20000 && r.display_title !== AUTO);
      if (!run) await sleep(3000);
    }
    if (!run) { drawProgress({ pct: 3, stage: 0, title, error: 'GitHub aún no ha arrancado la pasada. Mírala en la pestaña Actions.', url: `https://github.com/${REPO}/actions` }); return finish(); }
    const expected = (Number(st.minutes) || 8) * 60 + 20;
    for (;;) {
      run = await gh(`/actions/runs/${run.id}`);
      let stage = 0, pct = 4, time = '';
      if (run.status !== 'queued') {
        const jobs = await gh(`/actions/runs/${run.id}/jobs`);
        const steps = (jobs.jobs && jobs.jobs[0] && jobs.jobs[0].steps) || [];
        const step = (n) => steps.find((s) => s.name === n);
        const crawl = step('Rastrear slapshot.gg'), save = step('Guardar datos'), pub = step('Publicar la web');
        stage = 1; pct = 8;
        if (crawl && crawl.started_at) {
          const el = (Date.now() - Date.parse(crawl.started_at)) / 1000;
          pct = 10 + 62 * Math.min(1, el / expected);
          time = crawl.status === 'completed' ? '' : `${mmss(el)} · quedan unos ${Math.max(1, Math.ceil((expected - el) / 60))} min`;
        }
        if (crawl && crawl.status === 'completed') { stage = 2; pct = 76; }
        if (save && save.status === 'completed') { stage = 3; pct = 84; }
        if (pub && pub.status === 'completed') { stage = 3; pct = 94; }
      }
      if (run.status === 'completed') {
        if (run.conclusion === 'cancelled') {
          const j = await gh(`/actions/workflows/${WF}/runs?per_page=10&event=${st.kind}`);
          const newer = (j.workflow_runs || []).find((r) => r.id !== run.id && r.display_title !== AUTO && Date.parse(r.created_at) >= st.since - 20000 && Date.parse(r.created_at) >= Date.parse(run.created_at));
          if (newer) { run = newer; continue; }
        }
        break;
      }
      drawProgress({ pct, stage, title, time });
      await sleep(4000);
    }
    if (run.conclusion !== 'success') { drawProgress({ pct: 100, stage: 1, title, error: run.conclusion === 'cancelled' ? 'La pasada se canceló.' : 'La pasada falló.', url: run.html_url }); loadRuns(); return finish(); }
    drawProgress({ pct: 96, stage: 3, title, time: 'publicando la web' });
    let idx = null;
    for (let i = 0; i < 30; i++) {
      try { idx = await X.getJSON('data/index.json', true); if (idx.updated !== prevVer) break; } catch {}
      await sleep(6000);
    }
    await X.refreshData(false);
    const n = idx && idx.lastRun ? idx.lastRun.newMatches : 0;
    const msg = st.kind === 'push' ? 'Cambios aplicados en la web' : `${n} ${n === 1 ? 'partido nuevo' : 'partidos nuevos'}`;
    X.toast(msg);
    drawProgress({ pct: 100, stage: 4, title, done: true, result: msg });
    loadRuns(); loadWorkflow();
    finish();
  } catch (e) { drawProgress({ pct: 100, stage: 0, title, error: e.message }); finish(); }
}

// ---------- jugadores seguidos ----------
const pendingSeeds = new Set();
async function drawSeeds(set) {
  const el = $('#seeds'); if (!el) return;
  const { esc, int } = X;
  let P = {}; try { P = await X.loadPlayers(); } catch {}
  const seeds = (set.seeds || []).map(String);
  el.innerHTML = `${seeds.length ? seeds.map((id) => { const p = P[id]; return `<div class="seedrow">${X.avatar(p ? p.n : id, id, 'sm')}<span class="nm">${esc(p ? p.n : 'Jugador ' + id)}<small>ID ${esc(id)}${p ? ` · ${int(p.a.gp)} partidos` : ' · aún sin partidos'}</small></span>${p ? X.rank(p.rk, 20) : ''}<button class="btn sm" type="button" data-rm="${esc(id)}" ${pendingSeeds.has(id) ? 'disabled' : ''}>Quitar</button></div>`; }).join('') : '<div class="card-b muted">Nadie en la lista.</div>'}
    <form class="card-b" id="seed-add" style="display:flex;gap:10px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--line)"><input class="input" style="flex:1 1 200px" id="seed-in" placeholder="ID o enlace de slapshot.gg" autocomplete="off" aria-label="ID o enlace de slapshot.gg"><button class="btn primary" type="submit">Añadir</button></form>`;
  $$('[data-rm]', el).forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-rm'); if (pendingSeeds.has(id)) return; b.disabled = true; pendingSeeds.add(id);
    try { const s = await writeSettings((x) => { x.seeds = (x.seeds || []).map(String).filter((y) => y !== id); return x; }, `Dejar de seguir ${id}`); pendingSeeds.delete(id); X.toast('Jugador quitado de la lista'); drawSeeds(s); }
    catch (e) { pendingSeeds.delete(id); X.toast(e.message); b.disabled = false; }
  }));
  $('#seed-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#seed-in').value.trim(); const m = /players\/(\d+)/.exec(v) || /^(\d{4,10})$/.exec(v);
    if (!m) { X.toast('Escribe el número de jugador o pega el enlace de su perfil.'); return; }
    const id = m[1];
    if (seeds.includes(id)) { X.toast('Ese jugador ya está en la lista'); return; }
    const sb = $('#seed-add button'); if (sb.disabled) return; sb.disabled = true;
    try { const s = await writeSettings((x) => { x.seeds = [...new Set([...(x.seeds || []).map(String), id])]; return x; }, `Seguir jugador ${id}`); X.toast('Añadido: se revisará en la próxima pasada'); drawSeeds(s); }
    catch (ex) { X.toast(ex.message); sb.disabled = false; }
  });
}

// ---------- supporters ----------
// Quien apoya el proyecto (Ko-fi) y nos pasa su perfil: insignia ♥ en toda la web y el robot sigue sus partidos en
// cada pasada (como los «seguidos»). No cambia su nota ni su sitio en tablas y rankings.
async function drawSups(set) {
  const el = $('#sups'); if (!el) return;
  const { esc, int } = X;
  let P = {}; try { P = await X.loadPlayers(); } catch {}
  const list = (set.supporters || []).map(String);
  el.innerHTML = `${list.length ? list.map((id) => { const p = P[id]; return `<div class="seedrow">${X.avatar(p ? p.n : id, id, 'sm')}<span class="nm">${esc(p ? p.n : 'Jugador ' + id)} <span class="sup">♥</span><small>ID ${esc(id)}${p ? ` · ${int(p.a.gp)} partidos` : ' · aún sin partidos'}</small></span><button class="btn sm" type="button" data-sup-rm="${esc(id)}">Quitar</button></div>`; }).join('')
    : '<div class="card-b muted">Nadie todavía. Cuando alguien apoye el proyecto y te pase su perfil, añádelo aquí.</div>'}
    <form class="card-b" id="sup-add" style="display:flex;gap:10px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--line)"><input class="input" style="flex:1 1 200px" id="sup-in" placeholder="ID o enlace del perfil" autocomplete="off" aria-label="ID o enlace del perfil del supporter"><button class="btn" type="submit">Añadir supporter</button></form>`;
  $$('[data-sup-rm]', el).forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-sup-rm'); b.disabled = true;
    try { const s = await writeSettings((x) => { x.supporters = (x.supporters || []).map(String).filter((y) => y !== id); return x; }, `Quitar supporter ${id}`); X.toast('Quitado de supporters'); drawSups(s); }
    catch (e) { X.toast(e.message); b.disabled = false; }
  }));
  $('#sup-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#sup-in').value.trim();
    const m = /#j-(\d{1,15})\b/.exec(v) || /players\/(\d{1,15})/.exec(v) || /^(\d{1,15})$/.exec(v);
    if (!m) { X.toast('Escribe el número de jugador o pega el enlace de su perfil.'); return; }
    const id = m[1];
    if (list.includes(id)) { X.toast('Ya es supporter'); return; }
    if ((set.hiddenPlayers || []).map(String).includes(id)) { X.toast('Ese jugador está oculto por privacidad'); return; }
    const sb = $('#sup-add button'); if (sb.disabled) return; sb.disabled = true;
    try { const s = await writeSettings((x) => { x.supporters = [...new Set([...(x.supporters || []).map(String), id])]; return x; }, `Añadir supporter ${id}`); X.toast('Añadido: insignia ♥ y seguimiento prioritario'); drawSups(s); }
    catch (ex) { X.toast(ex.message); sb.disabled = false; }
  });
}

// ---------- jugadores ocultos (privacidad) ----------
// Al añadir uno, el robot quita su nombre e ID de todos los partidos publicados, borra su perfil y sus totales
// y no lo vuelve a mostrar (sale «—»). Quitarlo de la lista no recupera lo borrado: solo vuelve a salir en los partidos nuevos.
function drawHidPlayers(set) {
  const el = $('#hidplayers'); if (!el) return;
  const { esc } = X;
  const list = (set.hiddenPlayers || []).map(String);
  el.innerHTML = `${list.length ? list.map((id) => `<div class="seedrow"><span class="nm">Jugador oculto<small>ID ${esc(id)}</small></span><button class="btn sm" type="button" data-hp-rm="${esc(id)}">Quitar</button></div>`).join('')
    : '<div class="card-b muted">Ninguno. Si un jugador pide no aparecer (por correo a contact@slapscore.app), pega aquí su ID o el enlace a su perfil.</div>'}
    <form class="card-b" id="hp-add" style="display:flex;gap:10px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--line)"><input class="input" style="flex:1 1 200px" id="hp-in" placeholder="ID o enlace del perfil" autocomplete="off" aria-label="ID o enlace del perfil del jugador"><button class="btn" type="submit">Ocultar jugador</button></form>
    <p class="card-b muted" style="margin:0;padding-top:0;font-size:12.5px">Se quitan su nombre y su ID de todos los partidos publicados, su perfil y sus estadísticas en la siguiente pasada. Los archivos de partidos de hace más de 60 días que ya están en el archivo de GitHub no se tocan.</p>`;
  $$('[data-hp-rm]', el).forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-hp-rm'); b.disabled = true;
    try { const s = await writeSettings((x) => { x.hiddenPlayers = (x.hiddenPlayers || []).map(String).filter((y) => y !== id); return x; }, `Dejar de ocultar jugador ${id}`); X.toast('Quitado: volverá a salir en los partidos nuevos'); drawHidPlayers(s); }
    catch (e) { X.toast(e.message); b.disabled = false; }
  }));
  $('#hp-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#hp-in').value.trim();
    const m = /#j-(\d{1,15})\b/.exec(v) || /players\/(\d{1,15})/.exec(v) || /^(\d{1,15})$/.exec(v);
    if (!m) { X.toast('Escribe el número de jugador o pega el enlace de su perfil.'); return; }
    const id = m[1];
    if (list.includes(id)) { X.toast('Ese jugador ya está oculto'); return; }
    const sb = $('#hp-add button'); if (sb.disabled) return;
    if (sb.dataset.sure !== '1') { sb.dataset.sure = '1'; sb.textContent = '¿Seguro? Ocultar'; return; }
    sb.disabled = true;
    try { const s = await writeSettings((x) => { x.hiddenPlayers = [...new Set([...(x.hiddenPlayers || []).map(String), id])]; x.seeds = (x.seeds || []).map(String).filter((y) => y !== id); return x; }, `Ocultar jugador ${id} (privacidad)`); X.toast('Oculto: desaparece en la próxima pasada'); drawHidPlayers(s); }
    catch (ex) { X.toast(ex.message); sb.disabled = false; }
  });
}

// ---------- partidos ocultos ----------
function drawHidden(set) {
  const el = $('#hidden'); if (!el) return;
  const { esc } = X;
  const list = (set.hidden || []).map((h) => { const s2 = String(h), i = s2.indexOf('|'); return i > 0 ? { id: s2.slice(i + 1), key: s2.slice(0, i) } : { id: hidId(s2), key: '' }; });
  el.innerHTML = list.length ? list.map(({ id, key }) => `<div class="seedrow"><span class="nm">${key ? `<a href="#m-${esc(key.replace(/[-/]/g, ''))}-${esc(id)}">Partido del ${esc(key.slice(8, 10) + '/' + key.slice(5, 7) + ' a las ' + key.slice(11) + ' h')}</a>` : 'Partido'}<small class="code">${esc(id)}</small></span><button class="btn sm" type="button" data-un="${esc(id)}">Mostrar</button></div>`).join('')
    : '<div class="card-b muted">Ninguno. Para ocultar un partido, ábrelo y pulsa «Ocultar partido».</div>';
  $$('[data-un]', el).forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-un'); b.disabled = true;
    try { const s = await writeSettings((x) => { x.hidden = (x.hidden || []).filter((y) => hidId(y) !== id); return x; }, `Mostrar partido ${id}`); X.toast('Partido visible de nuevo'); drawHidden(s); }
    catch (e) { X.toast(e.message); b.disabled = false; }
  }));
}

// ---------- archivo y apoyo ----------
function drawExtra(set) {
  const el = $('#extra'); if (!el) return;
  const { esc, int } = X;
  const ret = Number(set.retainDays) || 60;
  const idx = X.S.index || {}, t = idx.totals || {};
  el.innerHTML = `<form id="x-ret"><div class="field"><label for="x-days">Días con el detalle completo en la web</label>
      <div style="display:flex;gap:10px"><input class="input" id="x-days" type="number" min="35" max="400" step="1" value="${ret}" inputmode="numeric" style="max-width:120px"><button class="btn" type="submit">Guardar</button></div></div>
      <p class="muted" style="margin:8px 0 0;font-size:13px">Los partidos más antiguos pasan al <a href="https://github.com/${esc(REPO)}/releases" target="_blank" rel="noopener">archivo de GitHub</a> (un archivo por día). Sus notas, los perfiles y las estadísticas de carrera se quedan en la web. Ahora: ${int(t.stored)} partidos con detalle de ${int(t.matches)} en total.</p></form>
    <form id="x-sup" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)"><div class="field"><label for="x-url">Enlace de apoyo (Ko-fi, Patreon…)</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><input class="input" id="x-url" type="url" placeholder="https://ko-fi.com/tu-usuario" value="${esc(set.support || '')}" style="flex:1 1 220px"><button class="btn" type="submit">Guardar</button></div></div>
      <p class="muted" style="margin:8px 0 0;font-size:13px">Si lo rellenas, aparece un recuadro discreto en la portada y un enlace en el pie. Vacío, no se muestra nada.</p></form>
    <form id="x-dc" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)"><div class="field"><label for="x-dcurl">Invitación al servidor de Discord</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><input class="input" id="x-dcurl" type="url" placeholder="https://discord.gg/abc123" value="${esc(set.discord || '')}" style="flex:1 1 220px"><button class="btn" type="submit">Guardar</button></div></div>
      <p class="muted" style="margin:8px 0 0;font-size:13px">Usa una invitación que no caduque. Si lo rellenas, sale un recuadro en la portada, un enlace en el pie y en el buzón de sugerencias. Vacío, no se muestra nada.</p></form>
    <form id="x-home" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)"><div class="field"><label for="x-hurl">Dirección principal de la web</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><input class="input" id="x-hurl" type="url" placeholder="https://slapscore.tu-nombre.workers.dev" value="${esc(set.home || '')}" style="flex:1 1 220px"><button class="btn" type="submit">Guardar</button></div></div>
      <p class="muted" style="margin:8px 0 0;font-size:13px">Si la web se muda (por ejemplo a Cloudflare o a un dominio propio), escribe aquí la dirección nueva: quien entre por ${esc(location.host)} irá allí automáticamente. Ábrela antes para comprobar que funciona.</p></form>`;
  $('#x-ret').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Math.round(Number($('#x-days').value));
    if (!(v >= 35 && v <= 400)) { X.toast('Elige entre 35 y 400 días.'); return; }
    const b = $('#x-ret button'); b.disabled = true;
    try { await writeSettings((x) => { if (v === 60) delete x.retainDays; else x.retainDays = v; return x; }, `Guardar ${v} días de partidos completos`); X.toast('Guardado. Se aplica en la próxima pasada.'); }
    catch (ex) { X.toast(ex.message); }
    b.disabled = false;
  });
  $('#x-home').addEventListener('submit', async (e) => {
    e.preventDefault();
    let u = $('#x-hurl').value.trim();
    if (u && !/^https:\/\/[^\s"'<>/]+(\/[^\s"'<>]*)?$/.test(u)) { X.toast('Pega una dirección que empiece por https://'); return; }
    if (u && !u.endsWith('/')) u += '/';
    try { if (u && new URL(u).origin === location.origin) { X.toast('Esa es la dirección en la que ya estás.'); return; } } catch { X.toast('Esa dirección no es válida.'); return; }
    const b = $('#x-home button'); b.disabled = true;
    try { await writeSettings((x) => { if (u) x.home = u; else delete x.home; return x; }, u ? `Dirección principal: ${u}` : 'Quitar la dirección principal'); X.toast(u ? 'Guardado: en unos minutos esta dirección llevará a la nueva.' : 'Quitado: ya no se redirige.'); }
    catch (ex) { X.toast(ex.message); }
    b.disabled = false;
  });
  $('#x-dc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = $('#x-dcurl').value.trim();
    if (u && !/^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]{2,40}$/.test(u)) { X.toast('Pega una invitación como https://discord.gg/abc123'); return; }
    const b = $('#x-dc button'); b.disabled = true;
    try { await writeSettings((x) => { if (u) x.discord = u; else delete x.discord; return x; }, u ? 'Añadir enlace de Discord' : 'Quitar enlace de Discord'); X.renderChrome(); X.toast(u ? 'Enlace guardado: ya se ve en la web.' : 'Enlace quitado.'); }
    catch (ex) { X.toast(ex.message); }
    b.disabled = false;
  });
  $('#x-sup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = $('#x-url').value.trim();
    if (u && !/^https:\/\/[^\s"'<>]+$/.test(u)) { X.toast('Pega un enlace que empiece por https://'); return; }
    const b = $('#x-sup button'); b.disabled = true;
    try { await writeSettings((x) => { if (u) x.support = u; else delete x.support; return x; }, u ? 'Añadir enlace de apoyo' : 'Quitar enlace de apoyo'); X.renderChrome(); X.toast(u ? 'Enlace guardado: ya se ve en la web.' : 'Enlace quitado.'); }
    catch (ex) { X.toast(ex.message); }
    b.disabled = false;
  });
}

// ---------- fórmula ----------
const SAMPLE = { goals: 1, primary_assists: 1, assists: 1, shots: 4, saves: 2, passes: 9, blocks: 1, takeaways: 2, turnovers: 2, faceoffs_won: 2, faceoffs_lost: 1, possession_time_sec: 35 };
function drawWeights(set) {
  const el = $('#weights'); if (!el) return;
  const { C, esc, dec } = X;
  const cur = C.weightsFrom(set.weights);
  el.innerHTML = `<p class="muted" style="margin-top:0">Los cambios recalculan las notas de los partidos de los últimos ${X.int((X.S.index && X.S.index.retain) || 60)} días (los archivados conservan la suya). Tardan unos minutos en verse en la web.</p>
    <form id="wform"><div class="wgrid">${C.WEIGHT_FIELDS.map(([k, l, step]) => `<div class="field"><label for="w-${k}">${esc(l)}</label><input class="input" id="w-${k}" name="${k}" type="number" step="${step}" value="${esc(cur[k])}" inputmode="decimal"></div>`).join('')}</div>
    <div style="display:flex;align-items:center;gap:12px;margin:16px 0;padding:12px;border-radius:12px;background:var(--surface-2)"><span style="flex:1;font-size:13px"><b>Ejemplo:</b> 1 gol, 1 asistencia, 4 tiros, 2 paradas, 9 pases, 2 robos, 2 pérdidas y victoria en 3v3 encajando 2.</span><span id="w-prev"></span></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" type="submit">Guardar fórmula</button><button class="btn" type="button" id="w-reset">Restaurar valores por defecto</button></div></form>`;
  const form = $('#wform');
  const read = () => { const w = {}; for (const [k] of C.WEIGHT_FIELDS) { const v = Number(form.elements[k].value); if (Number.isFinite(v)) w[k] = v; } return C.weightsFrom(w); };
  const preview = () => { const w = read(); const r = C.rate(SAMPLE, 'W', 2, 3, w).rating; const d = C.rate(SAMPLE, 'W', 2, 3, C.DEFAULT_WEIGHTS).rating; $('#w-prev').innerHTML = `${X.badge(r, 'md')}${r !== d ? ` <span class="muted" style="font-size:12px">antes ${dec(d)}</span>` : ''}`; };
  form.addEventListener('input', preview); preview();
  $('#w-reset').addEventListener('click', () => { for (const [k] of C.WEIGHT_FIELDS) form.elements[k].value = C.DEFAULT_WEIGHTS[k]; preview(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const w = read(), diff = {};
    for (const [k] of C.WEIGHT_FIELDS) if (w[k] !== C.DEFAULT_WEIGHTS[k]) diff[k] = w[k];
    const b = $('button[type="submit"]', form); b.disabled = true;
    try { await writeSettings((x) => { x.weights = diff; return x; }, 'Cambiar la fórmula de la nota'); X.toast('Fórmula guardada. Las notas se recalculan en unos minutos.'); }
    catch (ex) { X.toast(ex.message); }
    b.disabled = false;
  });
}

// ---------- logos de rango ----------
// Un solo commit con varios archivos (API de datos de Git)
async function commitFiles(changes, message) {
  const ref = await gh('/git/ref/heads/main');
  const base = ref.object.sha;
  const commit = await gh(`/git/commits/${base}`);
  const tree = [];
  for (const c of changes) {
    if (c.remove) { tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: c.b64, encoding: 'base64' }) });
    tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const t = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree }) });
  const nc = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [base] }) });
  await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: nc.sha }) });
}
const readFileB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ b64: String(r.result).split(',')[1], url: String(r.result) }); r.onerror = () => rej(new Error('No se pudo leer ' + f.name)); r.readAsDataURL(f); });
const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg' };
function keyFromFile(name) {
  let s = name.replace(/\.[a-z0-9]+$/i, '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  s = s.replace(/^PLATINUM/, 'PLAT').replace(/_?([123])$/, (m, d) => '_' + ['I', 'II', 'III'][d - 1]);
  if (X.RANK_KEYS.includes(s)) return s;
  const k = X.C.rankKeyFromName(name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '));
  return X.RANK_KEYS.includes(k) ? k : null;
}
async function drawRanks() {
  const el = $('#ranks'); if (!el) return;
  const { esc, C } = X;
  let manifest = {};
  try { const j = await gh('/contents/assets/ranks/index.json?ref=main'); manifest = JSON.parse(decodeB64(j.content)) || {}; }
  catch (e) { if (e.status !== 404) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; } }
  const pending = {};
  const draw = () => {
    el.innerHTML = `<p class="muted" style="margin-top:0">Sube los logos oficiales de cada rango: PNG, WebP o SVG, cuadrados y de 128 px o más. Mientras no haya logo se usa el emblema de SlapScore.</p>
      <div class="rk-up">${X.RANK_KEYS.map((k) => {
        const name = C.parseRank(k).name, has = !!manifest[k], pv = pending[k] ? `<img src="${pending[k].url}" alt="">` : X.rank(k, 36);
        return `<div class="rk-item"><span class="pv">${pv}</span><span class="nm">${esc(name)}<small>${pending[k] ? 'Nuevo, sin guardar' : has ? 'Logo oficial' : 'Emblema SlapScore'}</small></span><span class="acts"><label>${has || pending[k] ? 'Cambiar' : 'Subir'}<input type="file" accept="image/png,image/webp,image/svg+xml" data-up="${k}" hidden></label>${has && !pending[k] ? `<button type="button" class="rm" data-rm="${k}">Quitar</button>` : ''}</span></div>`;
      }).join('')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;align-items:center">
        <label class="btn">Subir varios a la vez<input type="file" accept="image/png,image/webp,image/svg+xml" multiple id="rk-multi" hidden></label>
        <button class="btn primary" type="button" id="rk-save" ${Object.keys(pending).length ? '' : 'disabled'}>Guardar ${Object.keys(pending).length || ''} logos</button>
        <span class="muted" style="font-size:12.5px">Para subir varios, nombra cada archivo como el rango: <span class="code">PLAT_III.png</span>, <span class="code">Gold 2.png</span>, <span class="code">Legend.png</span>…</span>
      </div>`;
    $$('[data-up]', el).forEach((inp) => inp.addEventListener('change', async () => { const f = inp.files[0]; if (f) await addFile(inp.getAttribute('data-up'), f); }));
    $('#rk-multi').addEventListener('change', async (e) => {
      const miss = [];
      for (const f of e.target.files) { const k = keyFromFile(f.name); if (k) await addFile(k, f, true); else miss.push(f.name); }
      if (miss.length) X.toast(`No sé a qué rango corresponden: ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? '…' : ''}`);
      draw();
    });
    $$('[data-rm]', el).forEach((b) => b.addEventListener('click', async () => {
      const k = b.getAttribute('data-rm'); b.disabled = true;
      const next = { ...manifest }; const file = next[k]; delete next[k];
      const small = next._small && next._small[k]; if (small) { next._small = { ...next._small }; delete next._small[k]; }
      try {
        await commitFiles([{ path: `assets/ranks/${file}`, remove: true }, ...(small ? [{ path: `assets/ranks/${small}`, remove: true }] : []), { path: 'assets/ranks/index.json', b64: btoa(JSON.stringify(next, null, 2) + '\n') }], `Quitar logo de rango ${k}`);
        manifest = next; X.toast('Logo quitado. La web se actualiza en unos 2 minutos.'); startTracking({ since: Date.now() - 5000, minutes: 1, kind: 'push', label: 'Aplicando los cambios' }); draw();
      } catch (ex) { X.toast(ex.message); b.disabled = false; }
    }));
    const save = $('#rk-save');
    if (save) save.addEventListener('click', async () => {
      save.disabled = true; save.textContent = 'Guardando…';
      const next = { ...manifest }, changes = [];
      for (const [k, f] of Object.entries(pending)) {
        const file = `${k}.${f.ext}`;
        if (next[k] && next[k] !== file) changes.push({ path: `assets/ranks/${next[k]}`, remove: true });
        // la versión pequeña anterior ya no vale para el logo nuevo
        if (next._small && next._small[k]) { changes.push({ path: `assets/ranks/${next._small[k]}`, remove: true }); next._small = { ...next._small }; delete next._small[k]; }
        changes.push({ path: `assets/ranks/${file}`, b64: f.b64 }); next[k] = file;
      }
      changes.push({ path: 'assets/ranks/index.json', b64: btoa(JSON.stringify(next, null, 2) + '\n') });
      try {
        await commitFiles(changes, `Logos de rango: ${Object.keys(pending).join(', ')}`);
        manifest = next; for (const k of Object.keys(pending)) delete pending[k];
        X.toast('Logos guardados. Se verán en la web en unos 2 minutos.');
        startTracking({ since: Date.now() - 5000, minutes: 1, kind: 'push', label: 'Publicando los logos' }); draw();
      } catch (ex) { X.toast(ex.message); save.disabled = false; save.textContent = 'Guardar logos'; }
    });
  };
  async function addFile(k, f, quiet) {
    const ext = EXT[f.type]; if (!ext) { X.toast(`${f.name}: usa PNG, WebP o SVG.`); return; }
    if (f.size > 600 * 1024) { X.toast(`${f.name} pesa más de 600 KB. Usa una versión más ligera.`); return; }
    try { const r = await readFileB64(f); pending[k] = { ...r, ext }; if (!quiet) draw(); } catch (e) { X.toast(e.message); }
  }
  draw();
}
