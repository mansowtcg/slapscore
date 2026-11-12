// Avisos automáticos en el servidor de Discord de SlapScore, con webhooks (sin bot):
//   · equipo de la semana (lunes por la tarde) y jugador del mes (día 1 por la tarde), con la imagen de la web
//   · novedades de la web, cuando sube NEWS_DATE (assets/news.js)
// Cada webhook es la dirección secreta de un canal: van en los secretos del repositorio (DISCORD_WEBHOOK_TOTW y
// DISCORD_WEBHOOK_NEWS) y nunca se escriben en el registro. Lo ya publicado se apunta en data/_int/discord.json.
//
//   node crawler/discord.js plan     qué toca publicar ahora (una palabra por línea: totw, month, news)
//   node crawler/discord.js render   imágenes de lo que toca (necesita Playwright: PW_DIR = carpeta con node_modules)
//   node crawler/discord.js post     publica y apunta lo publicado
// Variables: DATA_DIR, DISCORD_IMG_DIR, DISCORD_FORCE (totw|month|news: publica aunque no toque), DRY_RUN=1, NOW.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DAILY_HOUR, loadDay, computeDaily } from './daily.js';
import { withSite, weekLabel, monthLabel } from './lib.js';
export { withSite, weekLabel, monthLabel };
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const IMG = path.resolve(process.env.DISCORD_IMG_DIR || path.join(process.env.RUNNER_TEMP || '/tmp', 'slapscore-discord'));
const STATE = path.join(DATA, '_int', 'discord.json');
const SITE = 'https://slapscore.app';
export const POST_HOUR = 18;        // hora de Madrid a la que se publican los premios (tarde en Europa, mediodía en América)
export const FRESH_DAYS = 6;        // pasado este plazo, un premio sin publicar ya no se publica (se da por visto)
const COLOR = 0x374df5;

const readJSON = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const dayAdd = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// «AAAA-MM-DDTHH» en hora de Madrid: se compara como texto
export function madridStamp(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}
export const hookOk = (u) => typeof u === 'string' && /^https:\/\/(?:(?:canary\.|ptb\.)?discord\.com|discordapp\.com)\/api\/webhooks\/\d{5,25}\/[\w-]{20,200}$/.test(u.trim());
const roleOk = (id) => typeof id === 'string' && /^\d{5,25}$/.test(id);
const md = (s) => String(s).replace(/([\\*_~`|>\[\]()#-])/g, '\\$1').replace(/@/g, '@\u200b').slice(0, 80);   // nombres de jugadores: sin formato ni menciones
const rating = (x) => Number(x).toFixed(2);


// Qué toca publicar. Devuelve { due: [...], state } con el estado ya puesto al día en lo que se da por visto sin publicar.
export function plan({ awards, newsDate, state, now, hooks, force }) {
  const st = { ...(state || {}) }, due = [], stamp = madridStamp(now);
  // resumen diario: el de ayer, desde las 12:00 (si un día no sale, al siguiente ya toca el nuevo)
  if (hooks.daily) {
    const yday = dayAdd(stamp.slice(0, 10), -1);
    if (force === 'daily') due.push('daily');
    else if (st.daily == null) st.daily = yday;   // la primera vez no se publica: empieza con el del día siguiente
    else if (st.daily !== yday && stamp >= stamp.slice(0, 10) + 'T' + String(DAILY_HOUR).padStart(2, '0')) due.push('daily');
  }
  const W = awards && awards.week && awards.week.last, M = awards && awards.month && awards.month.last;
  if (hooks.totw && W && W.f && Array.isArray(W.list) && W.list.length >= 3) {
    const from = dayAdd(W.f, 7) + 'T' + String(POST_HOUR).padStart(2, '0'), until = dayAdd(W.f, 7 + FRESH_DAYS) + 'T23';
    if (force === 'totw') due.push('totw');
    else if (st.totw !== W.f) { if (stamp > until) st.totw = W.f; else if (stamp >= from) due.push('totw'); }
  }
  if (hooks.totw && M && M.m && Array.isArray(M.list) && M.list.length >= 1) {
    const first = dayAdd(M.m + '-28', 4).slice(0, 7) + '-01';   // día 1 del mes siguiente
    const from = first + 'T' + String(POST_HOUR).padStart(2, '0'), until = dayAdd(first, FRESH_DAYS) + 'T23';
    if (force === 'month') due.push('month');
    else if (st.month !== M.m) { if (stamp > until) st.month = M.m; else if (stamp >= from) due.push('month'); }
  }
  if (hooks.news && newsDate) {
    if (force === 'news') due.push('news');
    else if (st.news == null) st.news = newsDate;   // la primera vez no se publica: solo lo que llegue a partir de ahora
    else if (String(newsDate) > String(st.news)) due.push('news');
  }
  return { due, state: st };
}

// El día del que habla el resumen diario que toca ahora (ayer, en hora de Madrid)
export const dailyDay = (now) => dayAdd(madridStamp(now).slice(0, 10), -1);
const DAY_LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
export const DAILY_FILES = { potd: 'player-of-the-day.jpg', motd: 'match-of-the-day.jpg', posts: 'post-magnets.jpg' };
const DAY_PILL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
// Las imágenes del resumen diario (1200×675, plantilla crawler/video/daily.html). Devuelve qué se ha dibujado.
export async function renderDaily(day, D, dir = IMG) {
  const kinds = [D.potd.length ? 'potd' : '', D.motd ? 'motd' : '', D.posts.length ? 'posts' : ''].filter(Boolean), made = [];
  if (!kinds.length) return made;
  await withSite(async ({ browser, base }) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1.5, serviceWorkers: 'block' });
    await ctx.addInitScript((d) => { window.__DATA = d; }, { label: DAY_PILL.format(new Date(day + 'T12:00:00Z')).replace(',', ''), D });
    const page = await ctx.newPage();
    await page.goto(base + '/crawler/video/daily.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.show === 'function', null, { timeout: 30000 });
    await fs.mkdir(dir, { recursive: true });
    for (const k of kinds) {
      await page.evaluate((x) => window.show(x), k);
      const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
      if (buf.length < 5000) throw new Error('imagen vacía');
      await fs.writeFile(path.join(dir, DAILY_FILES[k]), buf); made.push(k);
      console.log(`Imagen de ${k}: ${Math.round(buf.length / 1024)} KB`);
    }
  });
  return made;
}
// Resumen diario: tres tarjetas en un mensaje (null si ese día no hay nada que contar). has: qué imágenes van adjuntas.
export function dailyMessage(day, D, roles = {}, has = {}) {
  if (!D || (!D.potd.length && !D.motd && !D.posts.length)) return null;
  const base = { username: 'SlapScore', avatar_url: `${SITE}/assets/icons/icon-512.png` };
  const ping = roleOk(roles.daily) ? { content: `<@&${roles.daily}>`, allowed_mentions: { parse: [], roles: [roles.daily] } } : { allowed_mentions: { parse: [] } };
  const who = (p) => `[${md(p.n)}](${SITE}/player/${p.id})`, when = DAY_LONG.format(new Date(day + 'T12:00:00Z')), embeds = [];
  const pic = (k) => (has[k] ? { image: { url: `attachment://${DAILY_FILES[k]}` } } : {});
  if (D.potd.length) embeds.push({ title: `⭐ Player of the Day · ${when}`, color: COLOR, description: D.potd.map(line).join('\n'), ...pic('potd'),
    footer: { text: `Best average rating in public matches (min. ${D.min}) · ${D.games.toLocaleString('en-GB')} matches played` } });
  if (D.motd) {
    const m = D.motd, names = (l) => l.map((p) => `${md(p.n)} ${Number(p.rt).toFixed(1)}`).join(' · ');
    embeds.push({ title: `🔥 Match of the Day · ${m.score[0]}–${m.score[1]}${m.ot ? ' (OT)' : ''}`, url: `${SITE}/m/${String(m.key).replace(/[-/]/g, '')}-${m.id}`, color: 0xd86a00,
      ...pic('motd'), description: `**Home** · ${names(m.home)}\n**Away** · ${names(m.away)}${m.mvp ? `\n\nMVP: **${who(m.mvp)}** · ${Number(m.mvp.rt).toFixed(1)} · ${m.mvp.g}G ${m.mvp.a}A${m.mvp.sv ? ` ${m.mvp.sv}SV` : ''}` : ''}`,
      footer: { text: `The closest, highest-level 3v3 of the day${m.arena ? ` · ${m.arena}` : ''}` } });
  }
  if (D.posts.length) embeds.push({ title: '🥅 Post magnets', color: 0x8a94a6, ...pic('posts'),
    description: D.posts.map((x, i) => `**${i + 1}. ${who(x)}** · ${x.per.toFixed(2)} per match · ${x.ph} posts in ${x.gp} matches`).join('\n'),
    footer: { text: `Most shots off the post per match (min. ${D.min} matches) · slapscore.app` } });
  return { ...base, ...ping, embeds };
}

const line = (x, i) => `**${i + 1}. [${md(x.n)}](${SITE}/player/${x.id})** · ${rating(x.rt)} avg · ${x.gp} matches · ${x.w} W${x.mvp ? ` · ${x.mvp} MVP` : ''}`;
// Mensajes de Discord (webhook). file: nombre de la imagen que se adjunta, si la hay.
export function buildMessage(kind, { awards, headline, roles = {}, hasImage }) {
  const base = { username: 'SlapScore', avatar_url: `${SITE}/assets/icons/icon-512.png` };
  const ping = (id) => (roleOk(id) ? { content: `<@&${id}>`, allowed_mentions: { parse: [], roles: [id] } } : { allowed_mentions: { parse: [] } });
  if (kind === 'totw') {
    const W = awards.week.last, top = W.list.slice(0, 3);
    return { ...base, ...ping(roles.totw), embeds: [{ title: `🏆 Team of the week · ${weekLabel(W.f, W.t)}`, url: `${SITE}/awards`, color: COLOR,
      description: top.map(line).join('\n'), ...(hasImage ? { image: { url: 'attachment://team-of-the-week.png' } } : {}),
      footer: { text: `Best average rating in public matches (min. ${awards.minW || 20}) · slapscore.app` } }] };
  }
  if (kind === 'month') {
    const M = awards.month.last, top = M.list.slice(0, 3);
    return { ...base, ...ping(roles.totw), embeds: [{ title: `⭐ Player of the month · ${monthLabel(M.m)}`, url: `${SITE}/awards`, color: COLOR,
      description: top.map(line).join('\n'), ...(hasImage ? { image: { url: 'attachment://player-of-the-month.png' } } : {}),
      footer: { text: `Best average rating in public matches (min. ${awards.minM || 60}) · slapscore.app` } }] };
  }
  return { ...base, ...ping(roles.news), embeds: [{ title: '📢 What’s new on SlapScore', url: `${SITE}/whats-new`, color: COLOR,
    description: `${String(headline || '').slice(0, 1500)}\n\n[See everything that’s new](${SITE}/whats-new)` }] };
}
export const FILES = { totw: 'team-of-the-week.png', month: 'player-of-the-month.png' };

// Envía un mensaje a un webhook; con imagen va como formulario. Devuelve true si Discord lo acepta.
// file: un archivo { name, data } o varios (la imagen y el vídeo)
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4' };
export async function send(url, payload, file) {
  let body, headers = {};
  const files = (Array.isArray(file) ? file : [file]).filter(Boolean);
  if (files.length) {
    const fd = new FormData();
    fd.append('payload_json', JSON.stringify({ ...payload, attachments: files.map((f, i) => ({ id: i, filename: f.name })) }));
    files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.data], { type: MIME[path.extname(f.name).toLowerCase()] || 'application/octet-stream' }), f.name));
    body = fd;
  } else { body = JSON.stringify(payload); headers = { 'content-type': 'application/json' }; }
  for (let i = 0; i < 3; i++) {
    let res; try { res = await fetch(url + '?wait=true', { method: 'POST', body, headers, signal: AbortSignal.timeout(60000) }); } catch (e) { console.log(`Discord: sin respuesta (${e.name})`); await new Promise((r) => setTimeout(r, 3000)); continue; }
    if (res.ok) return true;
    if (res.status === 429 || res.status >= 500) { const wait = Math.min(15, Number(res.headers.get('retry-after')) || 3); console.log(`Discord: respuesta ${res.status}, reintento en ${wait} s`); await new Promise((r) => setTimeout(r, wait * 1000)); continue; }
    console.log(`Discord: respuesta ${res.status}`); return false;   // 4xx: no se reintenta (webhook borrado, mensaje no válido...)
  }
  return false;
}

// Titular de las novedades, en inglés (assets/en.js); si falta la traducción, sale el original
export async function newsInfo() {
  try {
    const N = await import(pathToFileURL(path.join(ROOT, 'assets', 'news.js')).href);
    let en = {}; try { en = (await import(pathToFileURL(path.join(ROOT, 'assets', 'en.js')).href)).default || {}; } catch {}
    return { date: N.NEWS_DATE, headline: en[N.NEWS_HEADLINE] || N.NEWS_HEADLINE };
  } catch { return { date: null, headline: '' }; }
}
async function context() {
  const hooks = { totw: hookOk(process.env.DISCORD_WEBHOOK_TOTW) ? process.env.DISCORD_WEBHOOK_TOTW.trim() : '', news: hookOk(process.env.DISCORD_WEBHOOK_NEWS) ? process.env.DISCORD_WEBHOOK_NEWS.trim() : '' };
  for (const [k, v] of [['DISCORD_WEBHOOK_TOTW', hooks.totw], ['DISCORD_WEBHOOK_NEWS', hooks.news], ['DISCORD_WEBHOOK_DAILY', hookOk(process.env.DISCORD_WEBHOOK_DAILY)]]) if (process.env[k] && !v) console.error(`::warning::${k} no parece la dirección de un webhook de Discord: se ignora.`);
  const settings = await readJSON(path.join(ROOT, 'config', 'settings.json'), {});
  const roles = settings.discordRoles && typeof settings.discordRoles === 'object' ? settings.discordRoles : {};
  const force = ['totw', 'month', 'news', 'daily'].includes(process.env.DISCORD_FORCE) ? process.env.DISCORD_FORCE : '';
  // resumen diario: en su propio canal si hay webhook para él (DISCORD_WEBHOOK_DAILY); si no, en el de los premios.
  // Se apaga con "discordDaily": false en los ajustes.
  hooks.daily = settings.discordDaily === false ? '' : hookOk(process.env.DISCORD_WEBHOOK_DAILY) ? process.env.DISCORD_WEBHOOK_DAILY.trim() : hooks.totw;
  const hidden = new Set((Array.isArray(settings.hiddenPlayers) ? settings.hiddenPlayers : []).map((x) => String(x).trim()));
  const now = process.env.NOW ? Date.parse(process.env.NOW) : Date.now();
  const [awards, state, news] = [await readJSON(path.join(DATA, 'awards.json'), null), await readJSON(STATE, {}), await newsInfo()];
  // el vídeo vertical se puede apagar en los ajustes: "social": { "video": false }
  const video = !(settings.social && settings.social.video === false);
  return { hooks, roles, force, now, awards, state, news, video, hidden };
}

// Imágenes: las mismas que hace la web con «Compartir imagen» en Premios, sacadas con un navegador sin ventana.
// dir y names: dónde y con qué nombre se guardan; jpeg: en JPEG (lo que piden Instagram y TikTok) en vez de PNG.
export async function render(kinds, { dir = IMG, names = FILES, jpeg = false } = {}) {
  await withSite(async ({ browser, base }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { localStorage.setItem('slapscore-lang', 'en'); localStorage.setItem('slapscore-tour', 'done'); localStorage.setItem('slapscore-kofi-note', '1'); localStorage.setItem('slapscore-dc-note', '1'); } catch {} });
    const page = await ctx.newPage();
    await page.goto(base + '/awards', { waitUntil: 'domcontentloaded' });
    await fs.mkdir(dir, { recursive: true });
    for (const k of kinds) {
      const btn = `[data-aw-share="${k === 'totw' ? 'week' : 'month'}"]`;
      await page.waitForSelector(btn, { timeout: 30000 });
      await page.click(btn);
      await page.waitForSelector('#sh-pv img', { timeout: 30000 });
      const b64 = await page.$eval('#sh-pv img', async (img, asJpeg) => {
        let blob = await (await fetch(img.src)).blob();
        if (asJpeg) {
          const bmp = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
          const g = c.getContext('2d'); g.fillStyle = '#0b1020'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0);
          blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
        }
        const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s);
      }, jpeg);
      const buf = Buffer.from(b64, 'base64');
      if (buf.length < 5000) throw new Error('imagen vacía');
      await fs.writeFile(path.join(dir, names[k]), buf);
      console.log(`Imagen de ${k}: ${Math.round(buf.length / 1024)} KB`);
      await page.keyboard.press('Escape'); await page.waitForSelector('#ovl', { state: 'detached', timeout: 5000 }).catch(() => {});
    }
  });
}

async function main() {
  const cmd = process.argv[2];
  const C = await context();
  if (!C.hooks.totw && !C.hooks.news && !C.hooks.daily) { if (cmd !== 'plan') console.log('Discord: sin webhooks configurados.'); return; }
  const P = plan({ awards: C.awards, newsDate: C.news.date, state: C.state, now: C.now, hooks: C.hooks, force: C.force });
  if (cmd === 'plan') { if (P.due.length) console.log(P.due.join('\n')); return; }
  if (cmd === 'render') {
    // resumen diario: sus tres imágenes
    if (P.due.includes('daily')) {
      try { const day = dailyDay(C.now); await renderDaily(day, computeDaily(await loadDay(DATA, day), { hidden: C.hidden })); }
      catch (e) { console.log(`::warning::No se pudieron hacer las imágenes del resumen diario: ${e.message}`); }
    }
    const k = P.due.filter((x) => FILES[x]); if (!k.length) return;
    await render(k);
    // y el vídeo vertical (si se puede: hace falta ffmpeg); sin él, el mensaje sale solo con la imagen
    if (C.video) for (const x of k) { try { const V = await import('./video.js'); await V.renderVideo(x, C.awards, path.join(IMG, V.VIDEO_NAMES[x])); } catch (e) { console.log(`::warning::No se pudo hacer el vídeo de ${x}: ${e.message}`); } }
    return;
  }
  if (cmd !== 'post') { console.error('Uso: node crawler/discord.js plan|render|post'); process.exitCode = 2; return; }
  const st = P.state; let failed = 0;
  for (const k of P.due) {
    let file = null, video = null;
    if (FILES[k]) { try { file = { name: FILES[k], data: await fs.readFile(path.join(IMG, FILES[k])) }; } catch {} }
    if (FILES[k] && C.video) { try { const V = await import('./video.js'), data = await fs.readFile(path.join(IMG, V.VIDEO_NAMES[k])); if (data.length <= V.VIDEO_MAX) video = { name: V.VIDEO_NAMES[k], data }; } catch {} }
    let msg;
    if (k === 'daily') {
      // el resumen de ayer se calcula ahora, con los partidos de ese día
      const day = dailyDay(C.now), D = computeDaily(await loadDay(DATA, day), { hidden: C.hidden });
      const pics = [];
      for (const [x, name] of Object.entries(DAILY_FILES)) { try { pics.push({ k: x, name, data: await fs.readFile(path.join(IMG, name)) }); } catch {} }
      msg = dailyMessage(day, D, C.roles, Object.fromEntries(pics.map((x) => [x.k, true])));
      if (msg && pics.length) file = pics.map(({ name, data }) => ({ name, data }));
      if (!msg) { console.log(`Discord: daily sin nada que contar (${day})`); if (C.force !== k) st.daily = day; continue; }
    } else msg = buildMessage(k, { awards: C.awards, headline: C.news.headline, roles: C.roles, hasImage: !!file });
    if (process.env.DRY_RUN === '1') { console.log(`[prueba] ${k}${Array.isArray(file) ? ` (con ${file.length} imágenes)` : file ? ` (con imagen de ${Math.round(file.data.length / 1024)} KB)` : ''}${video ? ` (con vídeo de ${(video.data.length / 1048576).toFixed(1)} MB)` : ''}:\n${JSON.stringify(msg, null, 2)}`); continue; }
    let ok = await send(k === 'news' ? C.hooks.news : k === 'daily' ? C.hooks.daily : C.hooks.totw, msg, [...(Array.isArray(file) ? file : [file]), video]);
    // si Discord no acepta el mensaje con el vídeo, se manda sin él
    if (!ok && video) { video = null; ok = await send(C.hooks.totw, msg, file); }
    console.log(`Discord: ${k} ${ok ? 'publicado' : 'NO publicado'}${Array.isArray(file) ? ` (con ${file.length} imágenes)` : file ? ' (con imagen)' : ''}${ok && video ? ' (con vídeo)' : ''}`);
    if (!ok) { failed++; continue; }
    if (C.force === k) continue;   // forzado a mano: no cambia lo apuntado
    if (k === 'daily') st.daily = dailyDay(C.now); else if (k === 'totw') st.totw = C.awards.week.last.f; else if (k === 'month') st.month = C.awards.month.last.m; else st.news = C.news.date;
  }
  if (process.env.DRY_RUN !== '1' && JSON.stringify(st) !== JSON.stringify(C.state || {})) { await fs.mkdir(path.dirname(STATE), { recursive: true }); await fs.writeFile(STATE, JSON.stringify(st)); }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
