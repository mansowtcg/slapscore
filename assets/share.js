// Imágenes para compartir (partido o perfil), dibujadas en un canvas de 1080×1350.
// Se carga solo cuando alguien pulsa «Compartir imagen».
const W = 1080, H = 1350;
const COL = { bg: '#0F1320', bg2: '#171C2E', line: 'rgba(255,255,255,.08)', fg: '#FFFFFF', muted: '#9AA3B8', primary: '#374DF5', home: '#1E88E5', away: '#F2761B', win: '#1DA93C', loss: '#D7261B' };
const RT = [[9, '#374DF5', '#fff'], [8, '#00A3BB', '#fff'], [7, '#1DA93C', '#fff'], [6.5, '#D3A600', '#251D00'], [6, '#EA7A09', '#fff'], [-1, '#D7261B', '#fff']];
const rtCol = (r) => RT.find(([m]) => r >= m) || RT[RT.length - 1];
const F = (w, s, cond) => `${w} ${s}px ${cond ? '"Sofia Sans Condensed", ' : ''}"Sofia Sans", system-ui, sans-serif`;

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
  await Promise.all([document.fonts.load(F(800, 40)), document.fonts.load(F(800, 40, true)), document.fonts.load(F(600, 30))]).catch(() => {});
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  frame(c, X, X.date(m.t));
  fit(c, `${X.typeLabel(m.type)} · ${X.region(m.region)} · ${m.arena}`, W / 2, 196, 900, 700, 34, 'center', 'rgba(255,255,255,.8)');
  // marcador
  const win = m.winner;
  crest(c, 140, 250, 150, COL.home, X.lang === 'en' ? 'H' : 'L'); crest(c, W - 290, 250, 150, COL.away, X.lang === 'en' ? 'A' : 'V');
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
    crest(c, 78, y + 12, 32, tm === 'home' ? COL.home : COL.away, X.lang === 'en' ? (tm === 'home' ? 'H' : 'A') : (tm === 'home' ? 'L' : 'V'));
    c.font = F(800, 30); c.textAlign = 'left'; c.fillStyle = '#fff'; c.fillText(`${tm === 'home' ? X.t('Local') : X.t('Visitante')} · ${m.score[tm]}`, 124, y + 39);
    if (win === tm) { c.font = F(800, 24); c.fillStyle = COL.win; c.textAlign = 'right'; c.fillText(X.t('Ganador').toUpperCase(), W - 84, y + 37); }
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
  await Promise.all([document.fonts.load(F(800, 40)), document.fonts.load(F(800, 40, true)), document.fonts.load(F(600, 30))]).catch(() => {});
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const meta = P.meta || {}, a = P._a, games = P._g || [];
  frame(c, X, X.t('Perfil de jugador'));
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
  if (peak && meta.prk) { c.drawImage(peak, W - 60 - 150, 470, 150, 150); c.font = F(700, 22); c.textAlign = 'center'; c.fillStyle = COL.muted; c.fillText(X.t('Mejor rango').toUpperCase(), W - 60 - 75, 636); }
  // estadísticas
  const pct = (x) => Math.round(x * 100) + '%';
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
