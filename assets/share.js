// Imágenes para compartir (partido o perfil), dibujadas en un canvas de 1080×1350.
// Se carga solo cuando alguien pulsa «Compartir imagen».
const W = 1080, H = 1350;
const COL = { bg: '#0F1320', bg2: '#171C2E', line: 'rgba(255,255,255,.08)', fg: '#FFFFFF', muted: '#9AA3B8', primary: '#374DF5', home: '#1E88E5', away: '#F2761B', win: '#189335', loss: '#D7261B' };
const RT = [[9, '#374DF5', '#fff'], [8, '#008EA3', '#fff'], [7, '#189335', '#fff'], [6.5, '#D3A600', '#251D00'], [6, '#D86A00', '#fff'], [-1, '#D7261B', '#fff']];
const rtCol = (r) => RT.find(([m]) => r >= m) || RT[RT.length - 1];
const F = (w, s, cond) => `${w} ${s}px ${cond ? '"Sofia Sans Condensed", ' : ''}"Sofia Sans", system-ui, sans-serif`;
// también las letras de otros alfabetos latinos (ğ ş İ ı ő ł…), que van en otro archivo de la fuente
const SAMPLE = 'AaĞğŞşİıŁłŐő';
const loadFonts = () => Promise.all([document.fonts.load(F(800, 40), SAMPLE), document.fonts.load(F(800, 40, true), SAMPLE), document.fonts.load(F(600, 30), SAMPLE)]).catch(() => {});

function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
// texto que se encoge hasta caber en el ancho
function fit(c, txt, x, y, maxW, weight, size, align = 'left', color = COL.fg, cond) {
  let s = size; c.font = F(weight, s, cond);
  while (s > 12 && c.measureText(txt).width > maxW) { s -= 2; c.font = F(weight, s, cond); }
  c.fillStyle = color; c.textAlign = align; c.fillText(txt, x, y); return s;
}
function hue(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 360; }
function avatar(c, name, id, x, y, d) {
  c.fillStyle = `hsl(${hue(id || name)} 55% 46%)`; c.beginPath(); c.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); c.fill();
  const s = String(name || '?').replace(/[^\p{L}\p{N}]/gu, ''); const ini = ((s[0] || '?') + (s[1] || '')).toUpperCase();
  c.fillStyle = '#fff'; c.font = F(800, Math.round(d * 0.4)); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ini, x + d / 2, y + d / 2 + 1); c.textBaseline = 'alphabetic';
}
function badge(c, r, x, y, w, h, fmt) {
  const [, bg, ink] = rtCol(r); c.fillStyle = bg; rr(c, x, y, w, h, Math.round(h * 0.22)); c.fill();
  c.fillStyle = ink; c.font = F(800, Math.round(h * 0.62), true); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(fmt(r), x + w / 2, y + h / 2 + 2); c.textBaseline = 'alphabetic';
}
const imgCache = new Map();
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) imgCache.set(src, new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  return imgCache.get(src);
}
function crest(c, x, y, s, col, letter) {
  c.save(); c.translate(x, y); c.scale(s / 24, s / 24);
  c.fillStyle = col; c.fill(new Path2D('M12 1.8 21 5v6.4c0 5.3-3.7 9.4-9 11-5.3-1.6-9-5.7-9-11V5Z'));
  c.fillStyle = 'rgba(255,255,255,.14)'; c.fill(new Path2D('M12 3.6 19.3 6.2v5.2c0 4.3-2.9 7.7-7.3 9.1Z'));
  c.fillStyle = '#fff'; c.font = F(800, 10); c.textAlign = 'center'; c.fillText(letter, 12, 15.6); c.restore();
}
function frame(c, X, sub) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1B2A7A'); g.addColorStop(0.32, COL.bg); g.addColorStop(1, COL.bg);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // marca
  c.fillStyle = 'rgba(255,255,255,.18)'; rr(c, 60, 56, 64, 64, 18); c.fill();
  c.fillStyle = '#fff'; c.beginPath(); c.ellipse(92, 88, 18, 10, 0, 0, Math.PI * 2); c.fill();
  c.font = F(800, 46); c.textAlign = 'left'; c.fillStyle = '#fff'; c.fillText('SlapScore', 142, 104);
  if (sub) fit(c, sub, W - 60, 102, 520, 600, 30, 'right', 'rgba(255,255,255,.75)');
  // pie
  c.fillStyle = COL.line; c.fillRect(60, H - 110, W - 120, 2);
  c.font = F(600, 28); c.fillStyle = COL.muted; c.textAlign = 'left'; c.fillText(X.t('Notas y estadísticas de Slapshot: Rebound'), 60, H - 56);
  c.textAlign = 'right'; c.fillStyle = '#fff'; c.font = F(700, 28); c.fillText(X.host, W - 60, H - 56);
}

export async function matchImage(m, X) {
  await loadFonts();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  frame(c, X, X.date(m.t));
  fit(c, `${X.typeLabel(m.type)} · ${X.region(m.region)} · ${m.arena}`, W / 2, 196, 900, 700, 34, 'center', 'rgba(255,255,255,.8)');
  // marcador
  const win = m.winner;
  crest(c, 140, 250, 150, COL.home, X.teamL[0]); crest(c, W - 290, 250, 150, COL.away, X.teamL[1]);
  c.textAlign = 'center'; c.font = F(win === 'home' ? 800 : 600, 36); c.fillStyle = win === 'away' ? COL.muted : '#fff'; c.fillText(X.t('Local'), 215, 450);
  c.font = F(win === 'away' ? 800 : 600, 36); c.fillStyle = win === 'home' ? COL.muted : '#fff'; c.fillText(X.t('Visitante'), W - 215, 450);
  c.font = F(800, 200, true);
  c.fillStyle = win === 'away' ? 'rgba(255,255,255,.45)' : '#fff'; c.textAlign = 'right'; c.fillText(String(m.score.home), W / 2 - 50, 400);
  c.fillStyle = win === 'home' ? 'rgba(255,255,255,.45)' : '#fff'; c.textAlign = 'left'; c.fillText(String(m.score.away), W / 2 + 50, 400);
  c.fillStyle = 'rgba(255,255,255,.35)'; c.textAlign = 'center'; c.fillText('-', W / 2, 390);
  const pill = X.endLabel; c.font = F(700, 28); const pw = c.measureText(pill).width + 44;
  c.fillStyle = 'rgba(255,255,255,.12)'; rr(c, W / 2 - pw / 2, 432, pw, 48, 24); c.fill(); c.fillStyle = '#fff'; c.fillText(pill, W / 2, 466);
  // jugadores
  const teams = ['home', 'away'].map((tm) => m.players.map((p, i) => [p, i]).filter(([p]) => p.team === tm).sort((a, b) => b[0].rating - a[0].rating));
  const n = teams[0].length + teams[1].length, top = 520, avail = H - 140 - top - 2 * 64;
  const rowH = Math.max(64, Math.min(104, Math.floor(avail / Math.max(1, n))));
  const logos = await Promise.all(m.players.map((p) => loadImg(X.rankSrc(p.rk))));
  let y = top;
  for (const [k, tm] of ['home', 'away'].entries()) {
    c.fillStyle = 'rgba(255,255,255,.06)'; rr(c, 60, y, W - 120, 56, 14); c.fill();
    crest(c, 78, y + 12, 32, tm === 'home' ? COL.home : COL.away, tm === 'home' ? X.teamL[0] : X.teamL[1]);
    c.font = F(800, 30); c.textAlign = 'left'; c.fillStyle = '#fff'; c.fillText(`${tm === 'home' ? X.t('Local') : X.t('Visitante')} · ${m.score[tm]}`, 124, y + 39);
    if (win === tm) { c.font = F(800, 24); c.fillStyle = COL.win; c.textAlign = 'right'; c.fillText(X.t('Ganador').toLocaleUpperCase(X.loc), W - 84, y + 37); }
    y += 64;
    for (const [p, i] of teams[k]) {
      const d = Math.round(rowH * 0.62), cy = y + rowH / 2;
      avatar(c, p.name, p.pid, 72, cy - d / 2, d);
      let x = 72 + d + 22;
      const nameMax = 470;
      const sz = fit(c, p.name, x, cy + (rowH > 80 ? -4 : 10), nameMax, 800, Math.round(rowH * 0.36));
      c.font = F(800, sz); const nw = Math.min(nameMax, c.measureText(p.name).width);
      const lg = logos[i]; if (lg) { const ls = Math.round(rowH * 0.5); c.globalAlpha = p.rkApprox ? 0.6 : 1; c.drawImage(lg, x + nw + 12, cy - ls / 2 + (rowH > 80 ? -12 : 0), ls, ls); c.globalAlpha = 1; }
      if (i === m.mvp) { const tx = x + nw + (lg ? Math.round(rowH * 0.5) + 22 : 14); c.font = F(800, 22); const tw = c.measureText('MVP').width + 20; c.fillStyle = 'rgba(55,77,245,.35)'; rr(c, tx, cy - 32 + (rowH > 80 ? -2 : 12), tw, 34, 8); c.fill(); c.fillStyle = '#C7CEFF'; c.textAlign = 'left'; c.fillText('MVP', tx + 10, cy - 7 + (rowH > 80 ? -2 : 12)); }
      if (rowH > 80) { c.font = F(600, 26); c.fillStyle = COL.muted; c.textAlign = 'left'; c.fillText(X.statLine(p.st), x, cy + 30); }
      badge(c, p.rating, W - 60 - 112, cy - 30, 112, 60, X.fmtR);
      y += rowH;
    }
    y += 10;
  }
  return cv;
}

export async function profileImage(P, X) {
  await loadFonts();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const meta = P.meta || {}, a = P._a, games = P._g || [];
  frame(c, X, X.t('Perfil de jugador') + (P._mode === 'cus' ? ' · Custom' : ''));
  avatar(c, P.n, P.id, 60, 190, 200);
  fit(c, P.n, 290, 278, 560, 800, 84);
  const [cur, peak] = await Promise.all([loadImg(X.rankSrc(meta.rk)), loadImg(X.rankSrc(meta.prk))]);
  c.font = F(600, 32); c.fillStyle = COL.muted; c.textAlign = 'left';
  c.fillText(meta.rk ? `${meta.rank || X.rankName(meta.rk)} · ${X.int(meta.mmr)} MMR` : X.t('Sin rango'), 290, 336);
  c.fillText(`ID ${P.id}`, 290, 382);
  if (cur) c.drawImage(cur, W - 60 - 170, 180, 170, 170);
  // nota media
  const avgR = a.gp ? a.rs / a.gp : 0;
  c.fillStyle = 'rgba(255,255,255,.06)'; rr(c, 60, 440, W - 120, 210, 28); c.fill();
  badge(c, avgR, 96, 478, 230, 134, X.fmtR);
  c.font = F(800, 44); c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(X.t('Nota media'), 364, 532);
  c.font = F(600, 30); c.fillStyle = COL.muted; c.fillText(X.t('{n} partidos analizados', { n: X.int(a.gp) }), 364, 580);
  if (peak && meta.prk) { c.drawImage(peak, W - 60 - 150, 470, 150, 150); c.font = F(700, 22); c.textAlign = 'center'; c.fillStyle = COL.muted; c.fillText(X.t('Mejor rango').toLocaleUpperCase(X.loc), W - 60 - 75, 636); }
  // estadísticas
  const pct = (x) => X.pct(x);
  const cells = [[X.int(a.gp), X.t('Partidos')], [pct(a.gp ? a.w / a.gp : 0), X.t('Victorias')], [X.int(a.mvp), 'MVP'], [X.int(a.g), X.t('Goles')], [X.int(a.as), X.t('Asistencias')], [X.int(a.sv), X.t('Paradas')]];
  const cw = (W - 120 - 2 * 24) / 3;
  cells.forEach(([v, l], i) => {
    const x = 60 + (i % 3) * (cw + 24), y = 690 + Math.floor(i / 3) * 170;
    c.fillStyle = 'rgba(255,255,255,.06)'; rr(c, x, y, cw, 150, 22); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.font = F(800, 72, true); c.fillText(v, x + 28, y + 86);
    c.fillStyle = COL.muted; c.font = F(600, 28); c.fillText(l, x + 28, y + 126);
  });
  // forma: últimos 10
  const last = games.slice(0, 10).reverse();
  c.font = F(800, 32); c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(X.t('Últimos partidos'), 60, 1070);
  const bw = (W - 120 - 9 * 12) / 10;
  last.forEach((g, i) => {
    const x = 60 + i * (bw + 12);
    badge(c, g.rt, x, 1094, bw, 62, X.fmtR);
    c.fillStyle = g.r === 'W' ? COL.win : g.r === 'L' ? COL.loss : '#6E7385'; rr(c, x + bw / 2 - 20, 1168, 40, 40, 9); c.fill();
    c.fillStyle = '#fff'; c.font = F(800, 24); c.textAlign = 'center'; c.fillText(X.resLetter(g.r), x + bw / 2, 1197);
  });
  return cv;
}

// Premios: equipo de la semana (los 3 mejores) o jugador del mes (con el 2.º y el 3.º)
const MEDAL = ['#E0A800', '#B0B7C3', '#C27C4A'];
export async function awardImage(kind, A, X) {
  await loadFonts();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const L = A.list || [];
  frame(c, X, A.label);
  const pct = (x) => X.pct(x.w / (x.gp || 1));
  const medal = (i, x, y, d) => { c.fillStyle = MEDAL[i]; c.beginPath(); c.arc(x, y, d / 2, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.font = F(800, Math.round(d * 0.55)); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), x, y + 2); c.textBaseline = 'alphabetic'; };
  const ranks = await Promise.all(L.map((x) => loadImg(X.rankSrc(x.rk))));
  fit(c, (kind === 'week' ? X.t('Equipo de la semana') : X.t('Jugador del mes')).toLocaleUpperCase(X.loc), W / 2, 236, W - 120, 800, 76, 'center');
  if (kind === 'week') {
    // en la pista, como una alineación: dos delante y atrás el que más defiende
    const W3 = L.slice(0, 3);
    const def = (x) => ((x.sv || 0) + (x.bl || 0) * 0.5) / (x.gp || 1);
    const back = W3.length === 3 ? W3.reduce((b, x) => (def(x) > def(b) ? x : b), W3[0]) : null;
    const order = back ? [...W3.filter((x) => x !== back), back] : W3;
    const RX = 90, RY = 290, RW = W - 180, RH = 960;
    c.save();
    c.beginPath(); c.moveTo(RX, RY); c.lineTo(RX + RW, RY); c.lineTo(RX + RW, RY + RH - 200); c.arcTo(RX + RW, RY + RH, RX + RW - 200, RY + RH, 200); c.lineTo(RX + 200, RY + RH); c.arcTo(RX, RY + RH, RX, RY + RH - 200, 200); c.closePath();
    c.fillStyle = '#EEF3FB'; c.fill(); c.lineWidth = 6; c.strokeStyle = '#C9D6EA'; c.stroke(); c.clip();
    const ln = (y, col, w) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(RX, y); c.lineTo(RX + RW, y); c.stroke(); };
    ln(RY + 10, 'rgba(229,57,53,.75)', 10); ln(RY + 220, 'rgba(55,77,245,.6)', 12); ln(RY + RH - 90, 'rgba(229,57,53,.55)', 5);
    c.strokeStyle = 'rgba(229,57,53,.4)'; c.lineWidth = 4;
    for (const fx of [0.27, 0.73]) { c.beginPath(); c.arc(RX + RW * fx, RY + 650, 85, 0, Math.PI * 2); c.stroke(); }
    c.fillStyle = 'rgba(55,77,245,.16)'; c.beginPath(); c.ellipse(W / 2, RY + RH - 90, 80, 40, 0, Math.PI, 0); c.fill(); c.strokeStyle = 'rgba(229,57,53,.55)'; c.stroke();
    c.restore();
    const slots = order.length === 3 ? [[0.27, 0.28], [0.73, 0.28], [0.5, 0.62]] : [[0.3, 0.4], [0.7, 0.4]];
    order.forEach((x, k) => {
      const cx = RX + RW * slots[k][0], cy = RY + RH * slots[k][1], i = W3.indexOf(x);
      const d = 190;
      c.save(); c.shadowColor = 'rgba(0,0,0,.25)'; c.shadowBlur = 24; c.shadowOffsetY = 8;
      c.fillStyle = i === 0 ? '#F5B400' : '#fff'; c.beginPath(); c.arc(cx, cy, d / 2 + 9, 0, Math.PI * 2); c.fill(); c.restore();
      avatar(c, x.n, x.id, cx - d / 2, cy - d / 2, d);
      badge(c, x.rt, cx + 34, cy - d / 2 - 14, 130, 74, X.fmtR);
      if (i === 0) medal(0, cx - d / 2 + 10, cy - d / 2 + 10, 52);
      const name = x.n; c.font = F(800, 40); const tw = Math.min(330, c.measureText(name).width) + (ranks[i] ? 58 : 0) + 44;
      c.fillStyle = '#fff'; rr(c, cx - tw / 2, cy + d / 2 + 18, tw, 62, 31); c.fill();
      if (ranks[i]) c.drawImage(ranks[i], cx - tw / 2 + 16, cy + d / 2 + 26, 46, 46);
      fit(c, name, cx + (ranks[i] ? 29 : 0), cy + d / 2 + 63, 330, 800, 40, 'center', '#121A33');
      c.font = F(700, 26); c.fillStyle = '#5B6785'; c.textAlign = 'center';
      c.fillText(X.t('{n} partidos', { n: X.int(x.gp) }) + ` · ${pct(x)} ` + X.t('victorias'), cx, cy + d / 2 + 118);
    });
  } else {
    const x = L[0];
    if (x) {
      c.fillStyle = 'rgba(224,168,0,.14)'; rr(c, 60, 296, W - 120, 560, 34); c.fill();
      avatar(c, x.n, x.id, W / 2 - 110, 330, 220);
      medal(0, W / 2 + 84, 350, 60);
      fit(c, x.n, W / 2, 630, W - 220, 800, 84, 'center');
      const sub = (ranks[0] ? '     ' : '') + (X.rankName(x.rk) || '');
      c.font = F(600, 32); c.fillStyle = COL.muted; c.textAlign = 'center';
      const tw = c.measureText(sub).width;
      if (ranks[0]) c.drawImage(ranks[0], W / 2 - tw / 2 - 10, 650, 56, 56);
      c.fillText(sub, W / 2 + (ranks[0] ? 24 : 0), 690);
      const cells = [[X.fmtR(x.rt), X.t('Nota media'), true], [X.int(x.gp), X.t('Partidos')], [pct(x), X.t('Victorias')], [X.int(x.g), X.t('Goles')], [X.int(x.as), X.t('Asistencias')]];
      const cw = (W - 120 - 72 - 4 * 14) / 5;
      cells.forEach(([v, l, big], i) => {
        const cx = 96 + i * (cw + 14);
        if (big) badge(c, x.rt, cx, 724, cw, 76, X.fmtR);
        else { c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = F(800, 52, true); c.fillText(v, cx + cw / 2, 780); }
        c.fillStyle = COL.muted; c.font = F(600, 22); c.textAlign = 'center'; c.fillText(l, cx + cw / 2, 834);
      });
    }
    L.slice(1, 3).forEach((p, j) => {
      const i = j + 1, y = 890 + j * 150;
      c.fillStyle = 'rgba(255,255,255,.06)'; rr(c, 60, y, W - 120, 130, 24); c.fill();
      medal(i, 112, y + 65, 46);
      avatar(c, p.n, p.id, 150, y + 25, 80);
      fit(c, p.n, 252, y + 62, 520, 800, 40);
      c.font = F(600, 24); c.fillStyle = COL.muted; c.textAlign = 'left'; c.fillText(X.t('{n} partidos', { n: X.int(p.gp) }) + ` · ${pct(p)} ` + X.t('victorias'), 252, y + 100);
      badge(c, p.rt, W - 60 - 30 - 140, y + 28, 140, 74, X.fmtR);
    });
  }
  return cv;
}

// Resumen de una sesión de juego o de los últimos 7 días: nota media, V-D, MMR, goles, mejor partido y últimas notas.
// o: { kind: 'session' | 'week', P, list (partidos, del más nuevo al más viejo), sum, dm (cambio de MMR o null), pos (puesto o null), label, cus }
export async function summaryImage(o, X) {
  await loadFonts();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const { P, sum: s, list } = o, meta = P.meta || {};
  frame(c, X, (o.kind === 'session' ? X.t('Resumen de sesión') : X.t('Mi semana')) + (o.cus ? ' · Custom' : ''));
  avatar(c, P.n, P.id, 60, 184, 170);
  fit(c, P.n, 262, 262, 560, 800, 76);
  const cur = await loadImg(X.rankSrc(meta.rk));
  c.font = F(600, 30); c.fillStyle = COL.muted; c.textAlign = 'left';
  c.fillText(meta.rk ? `${meta.rank || X.rankName(meta.rk)} · ${X.int(meta.mmr)} MMR` : X.t('Sin rango'), 262, 312);
  fit(c, o.label, 262, 354, 560, 600, 30, 'left', COL.muted);
  if (cur) c.drawImage(cur, W - 60 - 160, 184, 160, 160);
  // nota media (y, a la derecha, el puesto de la semana o el cambio de MMR)
  c.fillStyle = 'rgba(255,255,255,.06)'; rr(c, 60, 410, W - 120, 210, 28); c.fill();
  badge(c, s.avg, 96, 448, 230, 134, X.fmtR);
  c.font = F(800, 44); c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(X.t('Nota media'), 364, 502);
  c.font = F(600, 30); c.fillStyle = COL.muted; c.fillText(X.t('{n} partidos', { n: X.int(s.k) }), 364, 550);
  const sign = (d) => `${d > 0 ? '+' : '−'}${X.int(Math.abs(d))}`;
  if (o.pos) {
    c.textAlign = 'right'; c.fillStyle = '#fff'; c.font = F(800, 84, true); c.fillText('#' + X.int(o.pos.pos), W - 96, 528);
    fit(c, X.t('de {n} por nota media', { n: X.int(o.pos.total) }), W - 96, 576, 380, 600, 26, 'right', COL.muted);
  } else if (o.dm) {
    c.textAlign = 'right'; c.fillStyle = o.dm > 0 ? '#3DDC6E' : '#FF5A50'; c.font = F(800, 84, true); c.fillText(sign(o.dm), W - 96, 528);
    c.fillStyle = COL.muted; c.font = F(600, 26); c.fillText('MMR', W - 96, 576);
  }
  // cifras
  const third = o.pos && o.dm ? [sign(o.dm), 'MMR', o.dm > 0 ? '#3DDC6E' : '#FF5A50'] : [X.int(s.mvp), 'MVP'];
  const cells = [[`${s.w}-${s.l}`, X.t('V-D')], [X.pct(s.k ? s.w / s.k : 0), X.t('Victorias')], third, [X.int(s.g), X.t('Goles')], [X.int(s.as), X.t('Asistencias')], [X.int(s.sv), X.t('Paradas')]];
  const cw = (W - 120 - 2 * 24) / 3;
  cells.forEach(([v, l, col], i) => {
    const x = 60 + (i % 3) * (cw + 24), y = 650 + Math.floor(i / 3) * 166;
    c.fillStyle = 'rgba(255,255,255,.06)'; rr(c, x, y, cw, 146, 22); c.fill();
    c.fillStyle = col || '#fff'; c.textAlign = 'left'; c.font = F(800, 70, true); c.fillText(v, x + 28, y + 84);
    c.fillStyle = COL.muted; c.font = F(600, 28); c.fillText(l, x + 28, y + 124);
  });
  // mejor partido
  const b = s.best;
  if (b) {
    c.fillStyle = 'rgba(255,255,255,.06)'; rr(c, 60, 990, W - 120, 104, 22); c.fill();
    c.font = F(800, 32); c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(X.t('Mejor partido'), 92, 1038);
    fit(c, `${b.gf}-${b.ga} · ${b.st.goals || 0} ${X.t('G')} · ${b.st.assists || 0} ${X.t('A')}${b.mv ? ' · MVP' : ''} · ${X.date(b.t)}`, 92, 1074, W - 400, 600, 26, 'left', COL.muted);
    badge(c, b.rt, W - 96 - 130, 1008, 130, 68, X.fmtR);
  }
  // últimas notas (las 10 más recientes, de la más antigua a la más nueva)
  const last = list.slice(0, 10).reverse(), bw = (W - 120 - 9 * 12) / 10;
  last.forEach((g, i) => {
    const x = 60 + i * (bw + 12);
    badge(c, g.rt, x, 1124, bw, 60, X.fmtR);
    c.fillStyle = g.r === 'W' ? COL.win : g.r === 'L' ? COL.loss : '#6E7385'; rr(c, x, 1194, bw, 8, 4); c.fill();
  });
  return cv;
}

