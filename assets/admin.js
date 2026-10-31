// Panel de administración de SlapScore.
// Usa un token de GitHub (solo en este navegador) para lanzar el robot y cambiar config/settings.json.
const API = 'https://api.github.com';
const WF = 'crawl.yml';
const RUN_KEY = 'slapscore-run';
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
      for (const k of ['seeds', 'hidden']) if (!Array.isArray(next[k])) next[k] = [];
      if (!next.weights || typeof next.weights !== 'object') next.weights = {};
      await gh('/contents/config/settings.json', { method: 'PUT', body: JSON.stringify({ message, content: encodeB64(JSON.stringify(next, null, 2) + '\n'), sha, branch: 'main' }) });
      X.applySettings(next);
      startTracking({ since: Date.now() - 5000, minutes: 1, kind: 'push', label: 'Aplicando los cambios' });
      return next;
    } catch (e) { lastErr = e; if (e.status !== 409) break; }
  }
  throw lastErr;
}
export async function toggleHidden(id, hide, ctx) {
  X = ctx;
  await writeSettings((s) => { s.hidden = (s.hidden || []).filter((x) => x !== id); if (hide) s.hidden.push(id); return s; }, `${hide ? 'Ocultar' : 'Mostrar'} partido ${id}`);
  X.toast(hide ? 'Partido oculto. Desaparece de las listas al momento y de los rankings en unos minutos.' : 'Partido visible de nuevo.');
  X.go({ keepScroll: true, instant: true });
}

// ---------- montar ----------
export async function mount(root, ctx) {
  X = ctx;
  if (!token()) return login(root);
  const { esc } = X;
  root.innerHTML = `<h1 class="h1 in">Administrador</h1><p class="lead">Repositorio <b>${esc(REPO)}</b>. Los cambios los hace GitHub con tu token, que solo está guardado en este navegador. <button class="btn sm" type="button" id="logout" style="margin-left:6px">Cerrar sesión</button></p>
  <div class="adm-grid">
    <div class="col">
      <div class="card in"><div class="card-h"><h3>Traer partidos ahora</h3></div><div class="card-b">
        <p class="muted" style="margin-top:0">Lanza una pasada del robot sin esperar a la siguiente. Cuanto más dure, más jugadores revisa (unos 9 por minuto).</p>
        <div class="toolbar"><div class="seg" role="group" aria-label="Duración">${[[3, 'Rápida · 3 min'], [8, 'Normal · 8 min'], [15, 'Larga · 15 min']].map(([v, l]) => `<button type="button" data-min="${v}" aria-pressed="${v === 8}">${l}</button>`).join('')}</div>
        <button class="btn primary" type="button" id="go-now">Traer partidos ahora</button></div>
        <div id="prog"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Estado del robot</h3><span id="wf-pill"></span></div><div class="card-b" id="wf"><div class="sk" style="height:90px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Últimas pasadas</h3><a href="https://github.com/${esc(REPO)}/actions" target="_blank" rel="noopener">Ver en GitHub</a></div><div class="runs" id="runs"><div class="card-b"><div class="sk" style="height:120px"></div></div></div></div>
    </div>
    <div class="col">
      <div class="card in"><div class="card-h"><h3>Jugadores seguidos</h3><small>se revisan primero</small></div><div id="seeds"><div class="card-b"><div class="sk" style="height:100px"></div></div></div></div>
      <div class="card in"><div class="card-h"><h3>Fórmula de la nota</h3></div><div class="card-b" id="weights"><div class="sk" style="height:160px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Partidos ocultos</h3></div><div id="hidden"><div class="card-b"><div class="sk" style="height:40px"></div></div></div></div>
    </div>
  </div>`;
  $('#logout').addEventListener('click', () => { setToken(null); X.renderChrome(); X.toast('Sesión de administrador cerrada'); login(root); });
  let minutes = 8;
  $$('[data-min]', root).forEach((b) => b.addEventListener('click', () => { minutes = Number(b.getAttribute('data-min')); $$('[data-min]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  $('#go-now').addEventListener('click', () => bringNow(minutes));
  drawProgress(null);
  loadWorkflow(); loadRuns();
  try { const st = await readSettings(); X.applySettings(st.data); drawSeeds(st.data); drawWeights(st.data); drawHidden(st.data); }
  catch (e) { for (const id of ['seeds', 'hidden']) { const el = $('#' + id); if (el) el.innerHTML = `<div class="card-b err">${X.esc(e.message)}</div>`; } const w = $('#weights'); if (w) w.innerHTML = `<p class="err">${X.esc(e.message)}</p>`; if (e.status === 401) { setToken(null); X.renderChrome(); } }
  if (sessionStorage.getItem(RUN_KEY)) track();
}

function login(root) {
  const { esc } = X;
  root.innerHTML = `<h1 class="h1 in">Administrador</h1><p class="lead">Trae partidos al momento, pausa el robot y cambia los ajustes de SlapScore.</p>
  <div class="adm-grid">
    <div class="card in"><div class="card-h"><h3>Entrar</h3></div><div class="card-b">
      <p style="margin-top:0">El panel funciona con un token de GitHub con permiso sobre <b>${esc(REPO)}</b>. Se guarda solo en este navegador y solo se envía a GitHub.</p>
      <form id="login" style="display:flex;flex-direction:column;gap:12px"><div class="field"><label for="tk">Token de GitHub</label><input class="input" id="tk" type="password" autocomplete="off" placeholder="github_pat_…" required></div>
      <p class="err" id="lerr" hidden></p><div><button class="btn primary" type="submit" id="lbtn">Entrar</button></div></form>
    </div></div>
    <div class="card in"><div class="card-h"><h3>Cómo crear el token</h3></div><div class="card-b"><ol class="steps">
      <li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub › Fine-grained tokens › Generate new token</a>.</li>
      <li>Ponle un nombre, por ejemplo «SlapScore admin», y la caducidad que quieras.</li>
      <li>En <b>Repository access</b> elige <b>Only select repositories</b> y marca <span class="code">${esc(REPO.split('/')[1])}</span>.</li>
      <li>En <b>Permissions</b>, dentro de <b>Repository permissions</b>, pon <b>Actions</b> y <b>Contents</b> en <b>Read and write</b>.</li>
      <li>Pulsa <b>Generate token</b>, cópialo y pégalo aquí.</li>
    </ol><p class="muted" style="margin-bottom:0">No lo compartas: quien lo tenga puede cambiar el repositorio.</p></div></div>
  </div>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = $('#tk').value.trim(), err = $('#lerr'), btn = $('#lbtn');
    if (!t) return;
    btn.disabled = true; btn.textContent = 'Comprobando…'; err.hidden = true;
    try {
      await gh(`/actions/workflows/${WF}`, {}, t);
      await gh('/contents/config/settings.json?ref=main', {}, t);
      setToken(t); X.renderChrome(); X.toast('Sesión de administrador iniciada'); mount(root, X);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Entrar'; }
  });
}

// ---------- robot ----------
function nextRun() {
  const d = new Date(); d.setUTCSeconds(0, 0);
  for (let i = 1; i <= 61; i++) { const t = new Date(d.getTime() + i * 60000); if (t.getUTCMinutes() === 7 || t.getUTCMinutes() === 37) return t; }
  return null;
}
async function loadWorkflow() {
  const el = $('#wf'), pill = $('#wf-pill'); if (!el) return;
  const { esc, int, ago, S } = X;
  try {
    const wf = await gh(`/actions/workflows/${WF}`);
    wfState = wf.state;
    const on = wf.state === 'active';
    const t = (S.index && S.index.totals) || {}, lr = (S.index && S.index.lastRun) || {};
    const nr = nextRun();
    pill.innerHTML = `<span class="pill ${on ? 'live' : 'warn'}"><span class="dot ${on ? 'pulse' : ''}"></span>${on ? 'Activo' : 'En pausa'}</span>`;
    el.innerHTML = `<dl class="kv"><dt>Pasadas automáticas</dt><dd>${on ? 'cada 30 minutos' : 'paradas'}</dd>
      ${on && nr ? `<dt>Próxima pasada</dt><dd>hacia las ${nr.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</dd>` : ''}
      <dt>Última pasada</dt><dd>${lr.at ? esc(ago(Date.parse(lr.at))) + ` · ${int(lr.newMatches)} nuevos` : '–'}</dd>
      <dt>Partidos guardados</dt><dd>${int(t.matches)}</dd><dt>Jugadores conocidos</dt><dd>${int(t.known)} (${int(t.tracked)} revisados)</dd><dt>Con rango</dt><dd>${int(t.ranked)}</dd></dl>
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn ${on ? 'danger' : 'primary'}" type="button" id="wf-toggle">${on ? 'Pausar robot' : 'Reanudar robot'}</button></div>`;
    $('#wf-toggle').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await gh(`/actions/workflows/${WF}/${on ? 'disable' : 'enable'}`, { method: 'PUT' }); X.toast(on ? 'Robot en pausa: no habrá pasadas automáticas' : 'Robot reanudado'); loadWorkflow(); }
      catch (ex) { X.toast(ex.message); b.disabled = false; }
    });
  } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; if (e.status === 401) { setToken(null); X.renderChrome(); } }
}
const EVENT = { schedule: 'Automática', workflow_dispatch: 'Manual', push: 'Cambio de ajustes' };
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
      return `<div class="row">${status}<span><b>${EVENT[r.event] || esc(r.event)}</b> · ${new Date(st).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${dur ? ' · ' + dur : ''}</span><span class="muted">${info ? `+${info.newMatches} partidos` : ''}</span><a href="${esc(r.html_url)}" target="_blank" rel="noopener">Ver</a></div>`;
    });
    el.innerHTML = rows.length ? rows.join('') : '<div class="empty">Todavía no hay pasadas.</div>';
  } catch (e) { el.innerHTML = `<div class="card-b err">${esc(e.message)}</div>`; }
}

// ---------- traer ahora + seguimiento ----------
async function bringNow(minutes) {
  if (tracking) { X.toast('Ya hay una pasada en marcha'); return; }
  if (wfState && wfState !== 'active') { X.toast('El robot está en pausa: reanúdalo para traer partidos.'); return; }
  const btn = $('#go-now'); if (btn) btn.disabled = true;
  try {
    await gh(`/actions/workflows/${WF}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { minutes: String(minutes) } }) });
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
    let run = null;
    for (let i = 0; i < 40 && !run; i++) {
      const j = await gh(`/actions/workflows/${WF}/runs?per_page=10&event=${st.kind}`);
      run = (j.workflow_runs || []).find((r) => Date.parse(r.created_at) >= st.since - 20000);
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
      if (run.status === 'completed') break;
      drawProgress({ pct, stage, title, time });
      await sleep(4000);
    }
    if (run.conclusion !== 'success') { drawProgress({ pct: 100, stage: 1, title, error: run.conclusion === 'cancelled' ? 'La pasada se canceló.' : 'La pasada falló.', url: run.html_url }); loadRuns(); return finish(); }
    drawProgress({ pct: 96, stage: 3, title, time: 'esperando a GitHub Pages' });
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
async function drawSeeds(set) {
  const el = $('#seeds'); if (!el) return;
  const { esc, int } = X;
  let P = {}; try { P = await X.loadPlayers(); } catch {}
  const seeds = (set.seeds || []).map(String);
  el.innerHTML = `${seeds.length ? seeds.map((id) => { const p = P[id]; return `<div class="seedrow">${X.avatar(p ? p.n : id, id, 'sm')}<span class="nm">${esc(p ? p.n : 'Jugador ' + id)}<small>ID ${esc(id)}${p ? ` · ${int(p.a.gp)} partidos` : ' · aún sin partidos'}</small></span>${p ? X.rank(p.rk, 20) : ''}<button class="btn sm" type="button" data-rm="${esc(id)}">Quitar</button></div>`; }).join('') : '<div class="card-b muted">Nadie en la lista.</div>'}
    <form class="card-b" id="seed-add" style="display:flex;gap:10px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--line)"><input class="input" style="flex:1 1 200px" id="seed-in" placeholder="ID o enlace de slapshot.gg" autocomplete="off" aria-label="ID o enlace de slapshot.gg"><button class="btn primary" type="submit">Añadir</button></form>`;
  $$('[data-rm]', el).forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-rm'); b.disabled = true;
    try { const s = await writeSettings((x) => { x.seeds = (x.seeds || []).map(String).filter((y) => y !== id); return x; }, `Dejar de seguir ${id}`); X.toast('Jugador quitado de la lista'); drawSeeds(s); }
    catch (e) { X.toast(e.message); b.disabled = false; }
  }));
  $('#seed-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#seed-in').value.trim(); const m = /players\/(\d+)/.exec(v) || /^(\d{4,10})$/.exec(v);
    if (!m) { X.toast('Escribe el número de jugador o pega el enlace de su perfil.'); return; }
    const id = m[1];
    if (seeds.includes(id)) { X.toast('Ese jugador ya está en la lista'); return; }
    try { const s = await writeSettings((x) => { x.seeds = [...new Set([...(x.seeds || []).map(String), id])]; return x; }, `Seguir jugador ${id}`); X.toast('Añadido: se revisará en la próxima pasada'); drawSeeds(s); }
    catch (ex) { X.toast(ex.message); }
  });
}

// ---------- partidos ocultos ----------
function drawHidden(set) {
  const el = $('#hidden'); if (!el) return;
  const { esc } = X;
  const list = set.hidden || [];
  el.innerHTML = list.length ? list.map((id) => `<div class="seedrow"><span class="nm"><span class="code">${esc(id)}</span></span><button class="btn sm" type="button" data-un="${esc(id)}">Mostrar</button></div>`).join('')
    : '<div class="card-b muted">Ninguno. Para ocultar un partido, ábrelo y pulsa «Ocultar partido».</div>';
  $$('[data-un]', el).forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-un'); b.disabled = true;
    try { const s = await writeSettings((x) => { x.hidden = (x.hidden || []).filter((y) => y !== id); return x; }, `Mostrar partido ${id}`); X.toast('Partido visible de nuevo'); drawHidden(s); }
    catch (e) { X.toast(e.message); b.disabled = false; }
  }));
}

// ---------- fórmula ----------
const SAMPLE = { goals: 1, primary_assists: 1, assists: 1, shots: 4, saves: 2, passes: 9, blocks: 1, takeaways: 2, turnovers: 2, faceoffs_won: 2, faceoffs_lost: 1, possession_time_sec: 35 };
function drawWeights(set) {
  const el = $('#weights'); if (!el) return;
  const { C, esc, dec } = X;
  const cur = C.weightsFrom(set.weights);
  el.innerHTML = `<p class="muted" style="margin-top:0">Los cambios recalculan las notas de todos los partidos. Tardan unos 3 minutos en verse en la web.</p>
    <form id="wform"><div class="wgrid">${C.WEIGHT_FIELDS.map(([k, l, step]) => `<div class="field"><label for="w-${k}">${esc(l)}</label><input class="input" id="w-${k}" name="${k}" type="number" step="${step}" value="${cur[k]}" inputmode="decimal"></div>`).join('')}</div>
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
