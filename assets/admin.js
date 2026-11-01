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
// Los ocultos se guardan como "día/hora|id" para que el robot los encuentre sin buscar
const hidId = (h) => String(h).split('|').pop();
export async function toggleHidden(id, hide, ctx, key) {
  X = ctx;
  await writeSettings((s) => { s.hidden = (s.hidden || []).filter((x) => hidId(x) !== id); if (hide) s.hidden.push(key ? `${key}|${id}` : id); return s; }, `${hide ? 'Ocultar' : 'Mostrar'} partido ${id}`);
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
      <div class="card in"><div class="card-h"><h3>Jugadores seguidos</h3><small>destacados: si juegan, se revisan en cada pasada</small></div><div id="seeds"><div class="card-b"><div class="sk" style="height:100px"></div></div></div></div>
      <div class="card in"><div class="card-h"><h3>Fórmula de la nota</h3></div><div class="card-b" id="weights"><div class="sk" style="height:160px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Logos de rango</h3><small>se ven en toda la web</small></div><div class="card-b" id="ranks"><div class="sk" style="height:120px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Web, archivo y apoyo</h3></div><div class="card-b" id="extra"><div class="sk" style="height:120px"></div></div></div>
      <div class="card in"><div class="card-h"><h3>Partidos ocultos</h3></div><div id="hidden"><div class="card-b"><div class="sk" style="height:40px"></div></div></div></div>
    </div>
  </div>`;
  $('#logout').addEventListener('click', () => { setToken(null); X.renderChrome(); X.toast('Sesión de administrador cerrada'); login(root); });
  let minutes = 8;
  $$('[data-min]', root).forEach((b) => b.addEventListener('click', () => { minutes = Number(b.getAttribute('data-min')); $$('[data-min]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  $('#go-now').addEventListener('click', () => bringNow(minutes));
  drawProgress(null);
  loadWorkflow(); loadRuns(); drawRanks();
  try { const st = await readSettings(); X.applySettings(st.data); drawSeeds(st.data); drawWeights(st.data); drawHidden(st.data); drawExtra(st.data); }
  catch (e) { for (const id of ['seeds', 'hidden', 'extra']) { const el = $('#' + id); if (el) el.innerHTML = `<div class="card-b err">${X.esc(e.message)}</div>`; } const w = $('#weights'); if (w) w.innerHTML = `<p class="err">${X.esc(e.message)}</p>`; if (e.status === 401) { setToken(null); X.renderChrome(); } }
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
      try {
        await commitFiles([{ path: `assets/ranks/${file}`, remove: true }, { path: 'assets/ranks/index.json', b64: btoa(JSON.stringify(next, null, 2) + '\n') }], `Quitar logo de rango ${k}`);
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
