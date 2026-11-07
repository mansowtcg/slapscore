// Tutorial de bienvenida: la primera vez que alguien entra desde un navegador, un repaso corto de la web que se
// puede saltar. Ilumina cada parte (la lista de partidos, los filtros, el buscador...) con una tarjeta al lado.
// Se carga solo cuando hace falta; app.js decide cuándo (y lo guarda para no repetirlo). Se puede volver a ver
// desde Novedades. Los textos van en español y se traducen con X.t().

const PAD = 6, GAP = 12, EDGE = 12;

function steps(X) {
  const L = [
    { id: 'hi', center: true, icon: 'brand', title: 'Te damos la bienvenida a SlapScore', text: 'Resultados, estadísticas y notas de todos los partidos de Slapshot: Rebound. ¿Te enseñamos lo básico? Es menos de un minuto.' },
    { id: 'list', target: ['#m-list .grp'], maxH: 230, title: 'Partidos al momento', text: 'Todas las partidas públicas y custom, con el resultado y la nota de 3 a 10 de cada jugador. Se actualizan solas cada 3-4 minutos: pulsa una para ver el partido completo.' },
    { id: 'days', target: ['#main section.col > .card'], title: 'Días y filtros', text: 'Cambia de día en la tira o en el calendario y filtra por tipo, región, arena o jugador. También puedes ver solo los destacados o tus favoritos.' },
    { id: 'search', target: ['.hdr .search'], title: 'Busca a cualquier jugador', text: 'Por su nombre, su ID o el enlace de su perfil. En su perfil tienes su rango, su MMR, su forma y sus mejores partidos, y puedes compararlo con otro jugador.' },
    { id: 'fav', target: ['#fav-card'], icon: 'star', title: 'Favoritos y avisos', text: 'Marca jugadores con la estrella de su perfil para tener sus partidos a mano. Con la campana te avisamos en el móvil cuando terminen un partido o suban de rango.' },
    { id: 'nav', target: ['.bnav', '.hdr .nav'], title: 'Rankings, récords y premios', text: 'Los mejores en cada estadística, las mejores marcas, el equipo de la semana, el jugador del mes y la liga EUSL.' },
    { id: 'tools', target: ['.hdr-actions'], title: 'Idioma, tema y sugerencias', text: 'Cambia el idioma (hay 6) o el tema claro u oscuro, y mándanos ideas o fallos con el buzón: lo leemos todo.' },
    { id: 'kofi', center: true, icon: 'coffee', kofi: true, title: 'Apoya SlapScore y ten prioridad', text: 'SlapScore es gratis y sin anuncios. Si lo apoyas en Ko-fi con cualquier cantidad, aunque sea simbólica, tus partidos se cargarán antes.' },
    { id: 'end', center: true, icon: 'check', title: '¡Listo!', text: 'Ya puedes usar SlapScore. Si quieres repasar este tutorial, lo tienes en Novedades.' },
  ];
  return L.filter((s) => !s.kofi || X.supportUrl());
}

// el primer elemento visible de la lista (en el móvil y en el ordenador cambian de sitio)
function findTarget(sels) {
  for (const s of sels || []) {
    const el = document.querySelector(s);
    if (el) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el; }
  }
  return null;
}

export function start(X, onEnd) {
  if (document.querySelector('.tour')) return;
  const { t, esc, ICON } = X;
  const S = steps(X);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prevFocus = document.activeElement;
  let i = 0, el = null, raf = 0, ended = false;

  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `<div class="tour-hole"></div><div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-d" tabindex="-1"></div>`;
  document.body.appendChild(root);
  const hole = root.querySelector('.tour-hole'), card = root.querySelector('.tour-card');
  document.documentElement.classList.add('touring');

  const icon = (k) => k === 'brand' ? '<span class="brand-mark"><i></i></span>' : `<span class="tour-ic">${ICON[k] || ICON.info}</span>`;
  const kofiBox = () => `<ol class="tour-kofi">
      <li>${esc(t('Dona en Ko-fi lo que quieras: no hay mínimo, vale cualquier cantidad.'))}</li>
      <li>${esc(t('En el mensaje de la donación, escribe tu ID de jugador o pega el enlace de tu perfil (de SlapScore o de slapshot.gg). Tu ID sale en tu perfil, debajo de tu nombre.'))}</li>
      <li>${esc(t('En unos minutos llevarás la insignia ♥ Supporter y el robot revisará tus partidos antes que los de los demás, así que saldrán antes en la web.'))}</li>
    </ol><a class="btn kofi sm" href="${esc(X.supportUrl())}" target="_blank" rel="noopener">${ICON.coffee}${esc(t('Apoyar en Ko-fi'))}</a>`;

  function draw() {
    const s = S[i], first = i === 0, last = i === S.length - 1;
    card.classList.toggle('center', !el);
    card.innerHTML = `${s.icon && !el ? `<div class="tour-hero">${icon(s.icon)}</div>` : ''}
      <div class="tour-top"><span class="tour-n">${first ? esc(t('Tutorial')) : esc(t('{n} de {m}', { n: i, m: S.length - 1 }))}</span>${last ? '' : `<button type="button" class="tour-skip" data-tour-skip>${esc(t('Saltar'))}</button>`}</div>
      <h3 id="tour-t">${esc(t(s.title))}</h3>
      <p id="tour-d">${esc(t(s.text))}</p>
      ${s.kofi ? kofiBox() : ''}
      <div class="tour-f">
        <div class="tour-dots" aria-hidden="true">${S.slice(1).map((_, k) => `<i class="${k + 1 === i ? 'on' : k + 1 < i ? 'done' : ''}"></i>`).join('')}</div>
        <div class="tour-btns">${!first && !last ? `<button type="button" class="btn sm" data-tour-back>${esc(t('Atrás'))}</button>` : ''}<button type="button" class="btn sm primary" data-tour-next>${esc(first ? t('Empezar el tutorial') : last ? t('Terminar') : t('Siguiente'))}</button></div>
      </div>`;
    card.querySelector('[data-tour-next]').focus({ preventScroll: true });
  }

  // agujero sobre el elemento y la tarjeta al lado (debajo, encima o, si no cabe, abajo del todo)
  function place() {
    const vw = document.documentElement.clientWidth, vh = innerHeight;
    const cw = Math.min(380, vw - EDGE * 2);
    card.style.width = cw + 'px';
    const ch = card.offsetHeight;
    if (!el || !el.isConnected) {
      Object.assign(hole.style, { top: vh / 2 + 'px', left: vw / 2 + 'px', width: '0px', height: '0px', borderRadius: '50%' });
      hole.classList.add('none');
      Object.assign(card.style, { top: Math.max(EDGE, (vh - ch) / 2) + 'px', left: (vw - cw) / 2 + 'px' });
      return;
    }
    hole.classList.remove('none');
    const r = el.getBoundingClientRect(), s = S[i];
    const h = s.maxH ? Math.min(r.height, s.maxH) : r.height;
    const top = r.top - PAD, left = Math.max(4, r.left - PAD), width = Math.min(vw - 8, r.right + PAD) - left, height = h + PAD * 2;
    const rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    Object.assign(hole.style, { top: top + 'px', left: left + 'px', width: width + 'px', height: height + 'px', borderRadius: Math.min(24, rad + PAD) + 'px' });
    let y;
    if (top + height + GAP + ch <= vh - EDGE) y = top + height + GAP;
    else if (top - GAP - ch >= EDGE) y = top - GAP - ch;
    else y = vh - ch - EDGE;
    const x = Math.min(Math.max(EDGE, left + width / 2 - cw / 2), vw - cw - EDGE);
    Object.assign(card.style, { top: Math.max(EDGE, y) + 'px', left: x + 'px' });
  }
  const queue = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };

  // lleva el elemento a la vista (por debajo de la cabecera fija) y espera a que acabe el desplazamiento
  async function bring(target) {
    if (!target) return;
    if (target.closest('.hdr, .bnav')) return;
    const hdr = document.querySelector('.hdr'), hh = hdr ? hdr.getBoundingClientRect().bottom : 0;
    const r = target.getBoundingClientRect(), s = S[i];
    const h = s.maxH ? Math.min(r.height, s.maxH) : r.height;
    const free = innerHeight - hh;
    if (r.top >= hh + 12 && r.top + h <= innerHeight - Math.min(240, free / 2)) return;
    const y = Math.max(0, scrollY + r.top - hh - 16);
    scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
    let last = -1, same = 0;
    for (let k = 0; k < 40 && same < 3; k++) { await new Promise((ok) => setTimeout(ok, 40)); if (Math.abs(scrollY - last) < 1) same++; else same = 0; last = scrollY; }
  }

  async function show(n) {
    i = Math.max(0, Math.min(S.length - 1, n));
    el = S[i].center ? null : findTarget(S[i].target);
    draw();
    await bring(el);
    if (ended) return;
    place();
  }

  function end(done) {
    if (ended) return; ended = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', queue); removeEventListener('scroll', queue, true); removeEventListener('popstate', onPop);
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('touring');
    root.classList.add('out');
    setTimeout(() => root.remove(), reduced ? 0 : 200);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    if (onEnd) onEnd(done);
  }
  const next = () => (i >= S.length - 1 ? end(true) : show(i + 1));
  const back = () => show(i - 1);

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); return; }
    if (e.key === 'ArrowRight' && !e.target.closest('input,textarea')) { e.preventDefault(); next(); return; }
    if (e.key === 'ArrowLeft' && i > 0 && i < S.length - 1) { e.preventDefault(); back(); return; }
    if (e.key === 'Tab') {   // el foco no sale de la tarjeta
      const f = [...card.querySelectorAll('button, a[href]')]; if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      else if (!card.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
    }
  }
  const onPop = () => end(true);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-tour-next]')) next();
    else if (e.target.closest('[data-tour-back]')) back();
    else if (e.target.closest('[data-tour-skip]')) end(false);
  });
  addEventListener('resize', queue); addEventListener('scroll', queue, true); addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey, true);
  show(0);
  return { end };
}
