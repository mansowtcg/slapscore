// Vídeo vertical (MP4, 1080×1920) del equipo de la semana y del jugador del mes, para Discord, TikTok y Reels.
// La plantilla es crawler/video/awards.html: aquí se abre con un navegador sin ventana, se le pide cada fotograma
// (renderAt) y se juntan con ffmpeg (H.264 con una pista de audio en silencio, que es lo que mejor aceptan las redes).
// Hace falta Playwright (PW_DIR) y ffmpeg: el del sistema, el de la variable FFMPEG o el paquete ffmpeg-static.
//
//   node crawler/video.js totw|month salida.mp4      (DATA_DIR: de dónde se leen los premios)
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { withSite, weekLabel, monthLabel } from './discord.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VIDEO_MAX = 9 * 1024 * 1024;   // Discord admite 10 MB por archivo
export const VIDEO_NAMES = { totw: 'team-of-the-week.mp4', month: 'player-of-the-month.mp4' };

export function ffmpegPath() {
  const list = [process.env.FFMPEG, 'ffmpeg'];
  try { list.push(createRequire(path.join(path.resolve(process.env.PW_DIR || ROOT), 'x.js'))('ffmpeg-static')); } catch {}
  for (const f of list) { if (!f) continue; try { if (spawnSync(f, ['-version'], { stdio: 'ignore', timeout: 15000 }).status === 0) return f; } catch {} }
  return null;
}
// Lo que enseña el vídeo: los tres primeros, con el texto de la semana o del mes
export function videoData(kind, awards) {
  const isW = kind === 'totw', L = awards && (isW ? awards.week : awards.month) && (isW ? awards.week.last : awards.month.last);
  if (!L || !Array.isArray(L.list) || L.list.length < (isW ? 3 : 1)) return null;
  return { kind, label: isW ? weekLabel(L.f, L.t) : monthLabel(L.m), min: isW ? awards.minW || 20 : awards.minM || 60,
    players: L.list.slice(0, 3).map((p) => ({ id: String(p.id), n: String(p.n), rk: p.rk || '', rt: Number(p.rt) || 0, gp: p.gp || 0, w: p.w || 0, mvp: p.mvp || 0 })) };
}
export async function renderVideo(kind, awards, outFile, { fps = 30 } = {}) {
  const data = videoData(kind, awards); if (!data) throw new Error('no hay datos para el vídeo');
  const ff = ffmpegPath(); if (!ff) throw new Error('no hay ffmpeg');
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const tmp = outFile.replace(/\.mp4$/, '') + '.part.mp4';
  await withSite(async ({ browser, base }) => {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await ctx.addInitScript((d) => { window.__DATA = d; }, data);
    const page = await ctx.newPage();
    await page.goto(base + '/crawler/video/awards.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.ready, null, { timeout: 30000 });
    await page.evaluate(() => window.ready);
    const total = Math.round((await page.evaluate(() => window.DURATION)) / 1000 * fps);
    const ffp = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', tmp], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; ffp.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    const done = new Promise((ok) => ffp.on('close', ok)); ffp.stdin.on('error', () => {});
    let last = '', buf = null, shots = 0;
    for (let i = 0; i < total; i++) {
      // los fotogramas iguales al anterior (cuando ya está todo quieto) no se vuelven a capturar
      const sig = await page.evaluate((t) => window.renderAt(t), Math.round(i * 1000 / fps));
      if (sig !== last || !buf) { buf = await page.screenshot({ type: 'jpeg', quality: 92 }); last = sig; shots++; }
      if (!ffp.stdin.write(buf)) await once(ffp.stdin, 'drain');
    }
    ffp.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error(`ffmpeg terminó con ${code}: ${err.trim().split('\n').pop() || ''}`);
    const size = (await fs.stat(tmp)).size;
    if (size < 20000) throw new Error('vídeo vacío');
    await fs.rename(tmp, outFile);
    console.log(`Vídeo de ${kind}: ${(size / 1048576).toFixed(1)} MB, ${total} fotogramas (${shots} capturados)`);
  }).catch(async (e) => { await fs.rm(tmp, { force: true }); throw e; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kind = process.argv[2], out = process.argv[3];
  if (!VIDEO_NAMES[kind] || !out) { console.error('Uso: node crawler/video.js totw|month salida.mp4'); process.exit(2); }
  const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
  const awards = JSON.parse(await fs.readFile(path.join(DATA, 'awards.json'), 'utf8'));
  await renderVideo(kind, awards, path.resolve(out));
}
