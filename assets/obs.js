// Configuradores de los overlays para OBS (se cargan al abrirlos):
//   · playerSheet: el de un jugador (sus últimas notas), con más jugadores que rotan si se añaden;
//   · matchSheet: el de un partido (marcador, notas y MVP) y el de dos equipos frente a frente.
// Los dos pueden guardar lo configurado en un «enlace fijo» (/overlay/s/<clave>): se pega una vez en OBS y, al guardar
// cambios aquí, el overlay se actualiza solo. La clave para cambiarlo se queda en este navegador.
// El dibujo y las direcciones de cada overlay están en overlay.js.
import * as O from './overlay.js';

let X;   // ayudas de la web (app.js las pasa al abrir)
const LS = 'slapscore-ovlinks', MAX_TEAM = 8;
const myLinks = () => { try { const l = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(l) ? l.filter((x) => x && /^[a-z0-9]{8}$/.test(x.id) && typeof x.key === 'string') : []; } catch { return []; } };
const saveLinks = (l) => { try { localStorage.setItem(LS, JSON.stringify(l.slice(0, 40))); } catch {} };
async function api(path, method, body) {
  const r = await fetch(X.apiBase() + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'http'), { status: r.status });
  return j;
}
function cssReady() {
  let css = X.$('#ov-css');
  if (!css) { css = document.createElement('link'); css.id = 'ov-css'; css.rel = 'stylesheet'; css.href = '/assets/overlay.css' + X.BUILD_Q; document.head.appendChild(css); }
  return css.sheet ? Promise.resolve() : new Promise((ok) => { css.addEventListener('load', ok, { once: true }); css.addEventListener('error', ok, { once: true }); setTimeout(ok, 3000); });
}
const row = (label, html, id = '') => `<div class="obs-r"${id ? ` id="${id}"` : ''}><span class="lbl">${X.esc(label)}</span>${html}</div>`;
const segOf = (attr, k, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" ${attr}="${k}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${X.esc(l)}</button>`).join('')}</div>`;
const press = (ovl, attr, k, v) => X.$$(`[${attr}="${k}"]`, ovl).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));

// La hoja: vista previa, opciones, enlace y cómo ponerlo en OBS
function shell({ intro, opts, extra = '' }) {
  const { esc, t } = X;
  return `<div class="sheet-h" style="grid-template-columns:minmax(0,1fr) auto"><div class="nm" id="sheet-title"><span>${esc(t('Overlay para OBS'))}</span></div><button class="ibtn" type="button" data-close aria-label="${esc(t('Cerrar'))}" style="color:var(--muted);font-size:22px">×</button></div>
    <div class="obs-b"><p class="muted">${esc(intro)}</p>
      <div class="obs-pv" id="obs-pv"><div class="obs-sc" id="obs-sc"></div></div>
      <p class="muted obs-cap" id="obs-cap" hidden></p>
      <div class="obs-opts">${opts}</div>
      <div class="obs-url"><input class="input" id="obs-u" readonly aria-label="${esc(t('Enlace del overlay'))}"><button type="button" class="btn primary" id="obs-copy">${esc(t('Copiar enlace'))}</button></div>
      <div class="obs-fix" id="obs-fix"></div>
      ${extra}
      <ol class="tour-kofi obs-how">
        <li>${esc(t('En OBS, añade una fuente nueva: «+» → «Navegador».'))}</li>
        <li id="obs-size"></li>
        <li>${esc(t('Listo: se actualiza solo y el fondo es transparente. Muévelo y escálalo como quieras.'))}</li>
      </ol>
      <p class="muted obs-note">${esc(t('Consejo: los partidos de los supporters de Ko-fi se cargan antes, también en el overlay.'))} <button type="button" class="tbtn" data-kofi-how>${esc(t('¿Cómo funciona?'))}</button></p>
    </div>`;
}
function preview(ovl, html) {
  const sc = X.$('#obs-sc', ovl); if (!sc) return;
  sc.innerHTML = html;
  const pv = X.$('#obs-pv', ovl), el = sc.firstElementChild; if (!el) return;
  const k = Math.min(1, (pv.clientWidth - 24) / (el.offsetWidth || 1));
  sc.style.transform = k < 1 ? `scale(${k})` : ''; pv.style.height = Math.ceil(el.offsetHeight * k + 24) + 'px';
}
function finish(ovl, draw, fix) {
  const { $ } = X;
  $('#obs-copy', ovl).addEventListener('click', () => { const i = $('#obs-u', ovl); i.select(); X.copyText(i.value, i); X.trackEvent('obs'); });
  $('#obs-u', ovl).addEventListener('focus', (e) => e.target.select());
  draw(); cssReady().then(() => { draw(); requestAnimationFrame(draw); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw).catch(() => {});
  const onR = () => { if (!$('#obs-sc') || !ovl.isConnected) { removeEventListener('resize', onR); return; } draw(); };
  addEventListener('resize', onR, { passive: true });
  fix.draw();
}

// ---------- enlace fijo ----------
// group: de qué son los enlaces que se listan aquí; href(): la dirección de lo configurado ahora; label(): cómo llamarlo;
// onUse(link): si la hoja sabe cargar lo guardado (la de jugador), lo hace ella; si no, el enlace se usa tal cual.
function fixBox(ovl, { group, href, label, active = null, onUse = null, redraw }) {
  const { $, $$, esc, t, toast } = X;
  const box = $('#obs-fix', ovl);
  const state = { active };
  const full = () => (state.active ? `${location.origin}/overlay/s/${state.active.id}` : location.origin + href());
  const dirty = () => !!state.active && state.active.u !== href();
  const when = (ms) => X.shortDate(ms);
  const fail = (e) => toast(e && e.status === 429 ? t('Demasiados cambios seguidos: espera un momento.') : e && e.status === 404 ? t('Ese enlace fijo ya no existe.') : e && e.status === 403 ? t('Este navegador no puede cambiar ese enlace.') : t('No se pudo guardar. Prueba otra vez.'));
  function draw() {
    if (!box.isConnected) return;
    const a = state.active, mine = myLinks().filter((x) => x.g === group && (!a || x.id !== a.id));
    $('#obs-u', ovl).value = full();
    box.innerHTML = a
      ? `<div class="obs-fx-h"><b>${esc(t('Enlace fijo'))}</b><span class="st ${dirty() ? 'dirty' : 'ok'}">${esc(dirty() ? t('Cambios sin guardar') : t('Guardado'))}</span></div>
         <p class="muted">${esc(t('Este enlace no cambia. Cuando cambies algo aquí, pulsa «Guardar cambios» y OBS lo recoge solo en unos minutos (o al refrescar la fuente).'))}</p>
         <div class="obs-fx-acts"><button type="button" class="btn sm primary" id="fx-save"${dirty() ? '' : ' disabled'}>${esc(t('Guardar cambios'))}</button><button type="button" class="tbtn" id="fx-off">${esc(t('Volver al enlace normal'))}</button><button type="button" class="tbtn" id="fx-del">${esc(t('Borrar enlace fijo'))}</button></div>`
      : `<div class="obs-fx-h"><b>${esc(t('Enlace fijo'))}</b><button type="button" class="btn sm" id="fx-new">${esc(t('Crear enlace fijo'))}</button></div>
         <p class="muted">${esc(t('Un enlace que no cambia: lo pegas una vez en OBS y, cuando cambies opciones o partidos aquí, se actualiza solo al guardar.'))}</p>
         ${mine.length ? `<div class="obs-fx-l">${mine.map((x) => `<div class="obs-fx-it"><span><b>${esc(x.label || x.id)}</b> · ${esc(t('guardado el {d}', { d: when(x.t) }))}</span><button type="button" class="tbtn" data-fx-use="${esc(x.id)}">${esc(t('Usar'))}</button></div>`).join('')}</div>` : ''}`;
  }
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const all = myLinks();
    if (b.id === 'fx-new') {
      b.disabled = true;
      try { const u = href(), r = await api('/api/ov', 'POST', { u }); const it = { id: r.id, key: r.key, u, g: group, label: label(), t: Date.now() }; saveLinks([it, ...all]); state.active = it; toast(t('Enlace fijo creado: cópialo y pégalo en OBS.')); X.trackEvent('obs'); }
      catch (err) { fail(err); }
      draw(); return;
    }
    if (b.id === 'fx-save' && state.active) {
      b.disabled = true;
      try { const u = href(); await api('/api/ov/' + state.active.id, 'PUT', { u, key: state.active.key }); state.active = { ...state.active, u, label: label(), t: Date.now() }; saveLinks([state.active, ...all.filter((x) => x.id !== state.active.id)]); toast(t('Guardado: el overlay se actualiza solo en unos minutos.')); }
      catch (err) { fail(err); if (err.status === 404) { saveLinks(all.filter((x) => x.id !== state.active.id)); state.active = null; } }
      draw(); return;
    }
    if (b.id === 'fx-off') { state.active = null; draw(); return; }
    if (b.id === 'fx-del' && state.active) {
      // dos pasos: el primer clic pide confirmación en el propio botón
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = t('¿Seguro? Dejará de funcionar en OBS'); setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = t('Borrar enlace fijo'); } }, 4000); return; }
      b.disabled = true;
      try { await api('/api/ov/' + state.active.id, 'DELETE', { key: state.active.key }); saveLinks(all.filter((x) => x.id !== state.active.id)); state.active = null; toast(t('Enlace fijo borrado.')); }
      catch (err) { fail(err); }
      draw(); return;
    }
    const use = b.getAttribute('data-fx-use'), it = use && all.find((x) => x.id === use);
    if (it) { if (onUse) onUse(it); else { state.active = it; draw(); redraw(); } }
  });
  return { draw, full, get active() { return state.active; } };
}

// ---------- buscador pequeño de jugadores ----------
async function miniSearch(box, { exclude, onPick }) {
  const { esc, t, fold } = X;
  box.innerHTML = `<input class="input" type="search" placeholder="${esc(t('Nombre, ID o enlace'))}" autocomplete="off" aria-label="${esc(t('Buscar jugador'))}"><div class="obs-ms-l" hidden></div>`;
  const inp = box.firstElementChild, L = box.lastElementChild;
  let rows = null;
  const find = async () => {
    if (!rows) { try { rows = await X.loadSearch(); } catch { rows = []; } }
    const raw = inp.value.trim(), q = fold(raw), ex = exclude(), idm = /(?:^|\/)(\d{3,12})\/?$/.exec(raw);
    if (!q) { L.hidden = true; return; }
    const out = [];
    for (const r of rows) { const id = String(r[0]); if (ex.has(id)) continue; if ((idm && id === idm[1]) || fold(r[1]).includes(q)) out.push(r); if (out.length >= 6) break; }
    L.innerHTML = out.length ? out.map((r) => `<button type="button" data-ms="${esc(r[0])}" data-n="${esc(r[1])}"><span>${esc(r[1])}</span>${r[2] ? X.rank(r[2], 16) : ''}</button>`).join('') : `<p class="muted">${esc(t('Ningún jugador con ese nombre todavía.'))}</p>`;
    L.hidden = false;
  };
  let ti; inp.addEventListener('input', () => { clearTimeout(ti); ti = setTimeout(find, 80); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = L.querySelector('[data-ms]'); if (b) { e.preventDefault(); b.click(); } } });
  L.addEventListener('click', (e) => { const b = e.target.closest('[data-ms]'); if (!b) return; inp.value = ''; L.hidden = true; onPick(b.getAttribute('data-ms'), b.getAttribute('data-n')); });
}
const chipsOf = (list, attr) => list.map((p) => `<span class="obs-chip"><span>${X.esc(p.n)}</span><button type="button" ${attr}="${X.esc(p.id)}" aria-label="${X.esc(X.t('Quitar a {n}', { n: p.n }))}">×</button></span>`).join('');

// =====================================================================
// Un jugador (o varios que rotan)
// =====================================================================
// init: { u, link } para abrirlo con lo que hay guardado en un enlace fijo
export async function playerSheet(ctx, P, mode, init = null) {
  X = ctx;
  const { $, $$, esc, t, toast } = X;
  const o = { ...O.OV_DEFAULTS, l: X.LANG, m: mode === 'cus' ? 'cus' : 'pub', x: [], k: [], a: 0 };
  // Qué partidos cuentan: los marcados (sel; null = sin tocar: los últimos n) y si los nuevos se añaden solos (auto)
  let sel = null, auto = true, pkRows = 30, team = [], r = O.OV_ROT;
  if (init && init.u) {
    const i = init.u.indexOf('?'), sp = O.ovSpec(i < 0 ? init.u : init.u.slice(0, i), i < 0 ? '' : init.u.slice(i));
    Object.assign(o, sp.o, { x: [] });
    if (sp.kind === 'team') {
      r = sp.r; let rows = []; try { rows = await X.loadSearch(); } catch {}
      const byId = new Map(rows.map((x) => [String(x[0]), x[1]]));
      team = sp.ids.filter((id) => id !== String(P.id)).map((id) => ({ id, n: byId.get(id) || id }));
      o.k = []; o.a = 0;
    } else if (o.k.length || o.a) {
      // lo guardado: los elegidos y, si los nuevos se añadían solos, los que han llegado desde entonces
      auto = !!o.a; const since = o.a * 1000;
      sel = new Set([...o.k, ...(auto ? O.ovGames(P, o.m).filter((g) => g.t > since).map(O.ovKey) : [])].slice(0, O.OV_MAX_PICK));
    }
  }
  const defKeys = () => O.ovGames(P, o.m).slice(0, o.n).map(O.ovKey);
  const touched = () => { if (!sel) return false; const d = defKeys(); return !(sel.size === d.length && d.every((k) => sel.has(k))); };
  // de ahí salen las opciones del enlace: nada (lo normal), k (selección fija) o k + a (selección y, además, los nuevos)
  const sync = () => { o.x = []; if (team.length || (auto && !touched())) { o.k = []; o.a = 0; } else { o.k = [...(sel || defKeys())]; o.a = auto ? O.ovNewest(P) : 0; } };
  sync();
  const seg = (k, opts) => segOf('data-ov', k, o[k], opts);
  const chk = (k, label) => `<label class="obs-chk"><input type="checkbox" data-ovc="${k}"${o[k] ? ' checked' : ''}> ${esc(label)}</label>`;
  const ovl = X.openSheet(shell({
    intro: t('Pon en tu directo las notas de los últimos partidos de {n} y su nota media. Se actualiza solo cada minuto.', { n: P.n }),
    opts: `${row(t('Partidos'), seg('n', [[5, '5'], [10, '10'], [20, '20']]))}
        ${row(t('Tipo de partida'), seg('m', [['pub', t('Pública')], ['cus', t('Custom')], ['all', t('Todas')]]))}
        <details class="obs-pick" id="obs-pick"${sel || !auto ? ' open' : ''}><summary><span>${esc(t('Elegir qué partidos cuentan'))}</span><span class="n" id="obs-pk-n"></span></summary>
          <div class="obs-pk-b">
            <label class="obs-chk obs-pk-auto"><input type="checkbox" id="obs-pk-auto" checked><span>${esc(t('Añadir solos los partidos nuevos'))}</span></label>
            <p class="muted" id="obs-pk-help"></p>
            <div class="obs-pk-list" id="obs-pk-list"></div>
            <div class="obs-pk-acts"><button type="button" class="tbtn" id="obs-pk-none">${esc(t('Desmarcar todos'))}</button><button type="button" class="tbtn" id="obs-pk-reset">${esc(t('Restablecer'))}</button><button type="button" class="tbtn" id="obs-pk-more">${esc(t('Ver más partidos'))}</button></div>
          </div></details>
        ${row(t('Más jugadores'), `<div class="obs-team"><div class="obs-chips" id="obs-tm"></div><div class="obs-ms" id="obs-ms"></div><small class="muted">${esc(t('Añade compañeros y el overlay va pasando de uno a otro.'))}</small></div>`)}
        ${row(t('Cambio cada'), segOf('data-rot', 'r', r, [[8, '8 s'], [10, '10 s'], [15, '15 s'], [20, '20 s']]), 'obs-rot')}
        ${row(t('Diseño'), seg('v', [['full', t('Completo')], ['compact', t('Compacto')]]))}
        ${row(t('Fondo'), seg('th', [['dark', t('Oscuro')], ['light', t('Claro')], ['clear', t('Transparente')]]))}
        ${row(t('Mostrar'), `<div class="obs-chks">${chk('rk', t('Rango y MMR'))}${chk('st', t('Estadísticas'))}${chk('d', t('Fechas'))}</div>`)}
        ${row(t('Idioma'), `<select class="select" id="obs-l" aria-label="${esc(t('Idioma'))}">${X.LANGS.map(([k, n]) => `<option value="${k}"${k === o.l ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}`,
    extra: X.floatOk() ? `<div class="obs-float" id="obs-floatbox"><span class="t"><b>${esc(t('¿Solo para ti?'))}</b> ${esc(t('Ábrelo en una ventana flotante que se queda encima del juego.'))}</span><button type="button" class="btn sm" id="obs-float">${X.ICON.float}${esc(t('Ventana flotante'))}</button></div>` : '',
  }), 'obs-sheet');
  const href = () => (team.length ? O.ovHref({ kind: 'team', ids: [String(P.id), ...team.map((x) => x.id)], r, o }) : O.ovHref({ kind: 'player', pid: P.id, o }));
  const fix = fixBox(ovl, { group: 'p:' + P.id, href, label: () => P.n + (team.length ? ` +${team.length}` : ''), active: (init && init.link) || null, redraw: () => draw(),
    onUse: (link) => playerSheet(ctx, P, mode, { u: link.u, link }) });
  function draw() {
    if (!$('#obs-sc', ovl)) return;
    preview(ovl, O.renderOverlay(P, o));
    const cap = $('#obs-cap', ovl); cap.hidden = !team.length; if (team.length) cap.textContent = t('Rotan cada {s} s:', { s: r }) + ' ' + [P.n, ...team.map((x) => x.n)].join(' → ');
    const z = O.ovSize(o); $('#obs-size', ovl).textContent = t('Pega el enlace y pon de tamaño {w} × {h}.', { w: z.w, h: z.h });
    $$('[data-ovc="st"]', ovl).forEach((c) => { c.disabled = o.v === 'compact'; c.closest('label').classList.toggle('off', o.v === 'compact'); });
    // con selección fija no hay «últimos N»
    const noN = !team.length && !auto && touched(); $$('[data-ov="n"]', ovl).forEach((b) => { b.disabled = noN; }); const ns = $('[data-ov="n"]', ovl); if (ns) ns.parentElement.classList.toggle('off', noN);
    // con varios jugadores no se eligen partidos (cada uno tiene los suyos) ni hay ventana flotante
    $('#obs-pick', ovl).hidden = team.length > 0; $('#obs-rot', ovl).hidden = !team.length;
    const fb = $('#obs-floatbox', ovl); if (fb) fb.hidden = team.length > 0;
    fix.draw();
  }
  function drawTeam() {
    $('#obs-tm', ovl).innerHTML = chipsOf(team, 'data-tm-del');
    $('#obs-ms', ovl).hidden = team.length >= MAX_TEAM - 1;
  }
  // textos del selector (sin rehacer la lista: al marcar una casilla no se pierde el foco ni el sitio)
  function pickInfo() {
    if (!$('#obs-pk-help', ovl)) return;
    const custom = touched(), none = !!sel && sel.size === 0;
    $('#obs-pk-help', ovl).textContent = auto
      ? t('Cuentan los partidos marcados y los nuevos que se vayan jugando: como mucho, los últimos {n}.', { n: o.n }) + (none ? ' ' + t('Sin ninguno marcado, empieza vacío y se va llenando.') : '')
      : t('Solo cuentan los partidos que marques; los nuevos no se añaden. Para enseñar los de una liga o un torneo.') + (none ? ' ' + t('Marca al menos un partido.') : '');
    $('#obs-pk-n', ovl).textContent = custom ? t(auto ? '{n} elegidos + nuevos' : '{n} elegidos', { n: sel.size }) : auto ? '' : t('Sin partidos nuevos');
    $('#obs-pk-auto', ovl).checked = auto;
    $('#obs-pk-none', ovl).hidden = none; $('#obs-pk-reset', ovl).hidden = !custom && auto;
  }
  function drawPick() {
    const box = $('#obs-pk-list', ovl); if (!box) return;
    const all = O.ovGames(P, o.m), on = sel || new Set(defKeys());
    // los marcados que no caben en la lista (más viejos) también se enseñan, para poder quitarlos
    const rows = Math.max(pkRows, sel ? all.reduce((mx, g, i) => (sel.has(O.ovKey(g)) ? i + 1 : mx), 0) : 0);
    box.innerHTML = all.slice(0, rows).map((g) => `<label class="obs-pk-it"><input type="checkbox" data-pk="${esc(O.ovKey(g))}"${on.has(O.ovKey(g)) ? ' checked' : ''}><span class="d">${esc(X.shortDate(g.t))} · ${esc(X.DF_TIME.format(new Date(g.t)))}</span><span class="y">${esc(X.typeLabel(g.y))}${g.f ? ' ' + esc(g.f) : ''}</span><span class="s ${g.r === 'W' ? 'w' : g.r === 'L' ? 'l' : ''}">${esc(X.resLetter(g.r))} ${esc(g.gf)}–${esc(g.ga)}</span>${X.badge(g.rt)}</label>`).join('') || `<p class="muted obs-pk-none">${esc(t('Sin partidos todavía'))}</p>`;
    $('#obs-pk-more', ovl).hidden = all.length <= rows;
    pkRows = rows;
    pickInfo();
  }
  ovl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ov]');
    if (b) {
      const k = b.dataset.ov, v = b.dataset.v; o[k] = k === 'n' ? Number(v) : v; press(ovl, 'data-ov', k, v);
      if (k === 'm') { sel = null; pkRows = 30; }   // otro tipo de partida: otra lista
      sync(); draw(); drawPick(); return;
    }
    const rb = e.target.closest('[data-rot]'); if (rb) { r = Number(rb.dataset.v); press(ovl, 'data-rot', 'r', r); draw(); return; }
    const del = e.target.closest('[data-tm-del]'); if (del) { team = team.filter((x) => x.id !== del.getAttribute('data-tm-del')); sync(); drawTeam(); draw(); return; }
    if (e.target.closest('#obs-pk-none')) { sel = new Set(); sync(); draw(); drawPick(); return; }
    if (e.target.closest('#obs-pk-reset')) { sel = null; auto = true; sync(); draw(); drawPick(); return; }
    if (e.target.closest('#obs-pk-more')) { pkRows += 30; drawPick(); }
  });
  ovl.addEventListener('change', (e) => {
    const c = e.target.closest('[data-ovc]'); if (c) { o[c.dataset.ovc] = c.checked ? 1 : 0; draw(); return; }
    if (e.target.id === 'obs-l') { o.l = e.target.value; draw(); return; }
    if (e.target.id === 'obs-pk-auto') { auto = e.target.checked; sync(); draw(); pickInfo(); return; }
    const p = e.target.closest('[data-pk]');
    if (p) {
      if (!sel) sel = new Set(defKeys());
      if (p.checked && sel.size >= O.OV_MAX_PICK) { p.checked = false; toast(t('Como mucho {n} partidos.', { n: O.OV_MAX_PICK })); return; }
      if (p.checked) sel.add(p.dataset.pk); else sel.delete(p.dataset.pk);
      sync(); draw(); pickInfo();
    }
  });
  miniSearch($('#obs-ms', ovl), { exclude: () => new Set([String(P.id), ...team.map((x) => x.id)]), onPick: (id, n) => { if (team.length < MAX_TEAM - 1) { team.push({ id: String(id), n }); sync(); drawTeam(); draw(); } } });
  const fb = $('#obs-float', ovl); if (fb) fb.addEventListener('click', () => X.floatOverlay(P, { ...o }, O.ovQuery(o)));
  drawTeam(); drawPick();
  finish(ovl, draw, fix);
}

// =====================================================================
// Un partido: resultado con notas y MVP, o los dos equipos frente a frente
// =====================================================================
export async function matchSheet(ctx, m) {
  X = ctx;
  const { $, esc, t } = X;
  const o = { ...O.OV_DEFAULTS, l: X.LANG, m: m.type === 'custom' ? 'cus' : 'pub', x: [], k: [], a: 0 };
  // el partido tal como lo dibuja el overlay
  const M = { id: m.id, t: m.t, type: m.type, format: m.format, ot: !!m.ot, score: [m.score.home, m.score.away], winner: m.winner === 'home' ? 0 : m.winner === 'away' ? 1 : -1, mvp: m.mvp,
    players: m.players.map((p) => ({ pid: String(p.pid), name: p.name, team: p.team === 'home' ? 0 : 1, rating: p.rating, g: (p.st && p.st.goals) || 0, a: (p.st && p.st.assists) || 0, rk: p.rk || '' })) };
  const st = { kind: 'res', follow: '', fm: 'all', n1: '', n2: '',
    t1: M.players.filter((p) => p.team === 0).map((p) => ({ id: p.pid, n: p.name })), t2: M.players.filter((p) => p.team === 1).map((p) => ({ id: p.pid, n: p.name })) };
  const cache = new Map();   // jugadores ya cargados, para la vista previa de «frente a frente»
  const seg = (k, opts) => segOf('data-ov', k, o[k], opts);
  const types = [['pub', t('Pública')], ['cus', t('Custom')], ['all', t('Todas')]];
  const ovl = X.openSheet(shell({
    intro: t('Para retransmitir un partido: el resultado con las notas y el MVP, o los dos equipos frente a frente con la nota media de cada jugador.'),
    opts: `${row(t('Qué enseña'), segOf('data-mk', 'kind', st.kind, [['res', t('Resultado y notas')], ['vs', t('Equipos frente a frente')]]))}
        <div class="obs-opts" id="obs-res">
          ${row(t('Partido'), `<select class="select" id="obs-follow" aria-label="${esc(t('Partido'))}"><option value="">${esc(t('Este partido'))}</option>${M.players.map((p) => `<option value="${esc(p.pid)}">${esc(t('El último de {n}', { n: p.name }))}</option>`).join('')}</select>`)}
          <p class="muted obs-hint" id="obs-fhint" hidden>${esc(t('Se actualiza solo: en cuanto ese jugador termina un partido, sale su resultado. Ideal para dejarlo puesto toda la retransmisión.'))}</p>
          ${row(t('Tipo de partida'), segOf('data-fm', 'fm', st.fm, [['all', t('Todas')], ['cus', t('Custom')], ['pub', t('Pública')]]), 'obs-fm')}
        </div>
        <div class="obs-opts" id="obs-vs" hidden>
          ${row(t('Partidos'), seg('n', [[5, '5'], [10, '10'], [20, '20']]))}
          ${row(t('Tipo de partida'), seg('m', types))}
          ${[1, 2].map((k) => row(t('Equipo {n}', { n: k }), `<div class="obs-team"><div class="obs-chips" id="obs-t${k}"></div><div class="obs-ms" id="obs-ms${k}"></div></div>`)).join('')}
        </div>
        ${row(t('Nombres'), `<div class="obs-names"><input class="input" id="obs-n1" maxlength="24" placeholder="${esc(X.HOME())}" aria-label="${esc(t('Equipo {n}', { n: 1 }))}"><input class="input" id="obs-n2" maxlength="24" placeholder="${esc(X.AWAY())}" aria-label="${esc(t('Equipo {n}', { n: 2 }))}"></div>`)}
        ${row(t('Fondo'), seg('th', [['dark', t('Oscuro')], ['light', t('Claro')], ['clear', t('Transparente')]]))}
        ${row(t('Idioma'), `<select class="select" id="obs-l" aria-label="${esc(t('Idioma'))}">${X.LANGS.map(([k, n]) => `<option value="${k}"${k === o.l ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}`,
  }), 'obs-sheet');
  const spec = () => (st.kind === 'vs' ? { kind: 'vs', t1: st.t1.map((x) => x.id), t2: st.t2.map((x) => x.id), n1: st.n1, n2: st.n2, o }
    : st.follow ? { kind: 'match', pid: st.follow, n1: st.n1, n2: st.n2, o: { ...o, m: st.fm } } : { kind: 'match', key: m.key, mid: m.id, n1: st.n1, n2: st.n2, o });
  const href = () => O.ovHref(spec());
  const fix = fixBox(ovl, { group: 'm', href, label: () => `${st.n1 || X.HOME()} – ${st.n2 || X.AWAY()}`, redraw: () => draw() });
  let turn = 0;
  async function draw() {
    if (!$('#obs-sc', ovl)) return;
    const vs = st.kind === 'vs', my = ++turn;
    $('#obs-res', ovl).hidden = vs; $('#obs-vs', ovl).hidden = !vs;
    $('#obs-fm', ovl).hidden = !st.follow; $('#obs-fhint', ovl).hidden = !st.follow;
    const cap = $('#obs-cap', ovl); cap.hidden = vs || !st.follow; cap.textContent = t('Vista previa con este partido.');
    const rows = vs ? Math.max(st.t1.length, st.t2.length) : Math.max(M.players.filter((p) => p.team === 0).length, M.players.filter((p) => p.team === 1).length);
    const z = O.ovSizeOf(spec(), rows); $('#obs-size', ovl).textContent = t('Pega el enlace y pon de tamaño {w} × {h}.', { w: z.w, h: z.h });
    fix.draw();
    if (!vs) { preview(ovl, O.renderMatch(M, o, st)); return; }
    const ids = [...st.t1, ...st.t2].map((x) => x.id), miss = ids.filter((id) => !cache.has(id));
    if (miss.length) { await Promise.all(miss.map((id) => X.loadP(id).then((P) => cache.set(id, P), () => cache.set(id, null)))); if (my !== turn || !ovl.isConnected) return; }
    preview(ovl, O.renderVs(st.t1.map((x) => cache.get(x.id)), st.t2.map((x) => cache.get(x.id)), o, st));
  }
  const drawTeams = () => { for (const k of [1, 2]) { $('#obs-t' + k, ovl).innerHTML = chipsOf(st['t' + k], `data-t${k}-del`); $('#obs-ms' + k, ovl).hidden = st['t' + k].length >= MAX_TEAM; } };
  ovl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ov]'); if (b) { const k = b.dataset.ov, v = b.dataset.v; o[k] = k === 'n' ? Number(v) : v; press(ovl, 'data-ov', k, v); draw(); return; }
    const mk = e.target.closest('[data-mk]'); if (mk) { st.kind = mk.dataset.v; press(ovl, 'data-mk', 'kind', st.kind); draw(); return; }
    const fm = e.target.closest('[data-fm]'); if (fm) { st.fm = fm.dataset.v; press(ovl, 'data-fm', 'fm', st.fm); draw(); return; }
    for (const k of [1, 2]) { const d = e.target.closest(`[data-t${k}-del]`); if (d) { st['t' + k] = st['t' + k].filter((x) => x.id !== d.getAttribute(`data-t${k}-del`)); drawTeams(); draw(); return; } }
  });
  ovl.addEventListener('change', (e) => {
    if (e.target.id === 'obs-l') { o.l = e.target.value; draw(); }
    if (e.target.id === 'obs-follow') { st.follow = e.target.value; draw(); }
  });
  ovl.addEventListener('input', (e) => { if (e.target.id === 'obs-n1' || e.target.id === 'obs-n2') { st[e.target.id.slice(4)] = O.ovName(e.target.value); draw(); } });
  const taken = () => new Set([...st.t1, ...st.t2].map((x) => x.id));
  for (const k of [1, 2]) miniSearch($('#obs-ms' + k, ovl), { exclude: taken, onPick: (id, n) => { if (st['t' + k].length < MAX_TEAM) { st['t' + k].push({ id: String(id), n }); drawTeams(); draw(); } } });
  drawTeams();
  finish(ovl, draw, fix);
}
