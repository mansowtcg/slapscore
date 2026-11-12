// Piezas que comparten los avisos de Discord, las redes y el vídeo (aparte para que ninguno dependa de otro en círculo):
// los textos de fechas y el servidor local con navegador sin ventana para sacar imágenes y vídeos de la web.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
const DAY_MON = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MON_YEAR = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export function weekLabel(f, t) {
  const a = new Date(f + 'T12:00:00Z'), b = new Date(t + 'T12:00:00Z');
  return `${a.getUTCMonth() === b.getUTCMonth() ? DAY.format(a) : DAY_MON.format(a)}–${DAY_MON.format(b)} ${b.getUTCFullYear()}`;
}
export const monthLabel = (ym) => MON_YEAR.format(new Date(ym + '-15T12:00:00Z'));

// Un servidor local con la web y los datos, y un navegador sin ventana para abrirla: fn({ browser, base })
export async function withSite(fn) {
  const { chromium } = createRequire(path.join(path.resolve(process.env.PW_DIR || ROOT), 'x.js'))('playwright');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip' };
  const srv = http.createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.includes('..')) throw 0;
      let file = p.startsWith('/data/') ? path.join(DATA, p.slice(6)) : path.join(ROOT, p);
      if (p.startsWith('/data/_int') || p.startsWith('/api/')) { res.writeHead(404).end(); return; }
      let buf; try { buf = await fs.readFile(file); } catch { if (path.extname(p)) { res.writeHead(404).end(); return; } file = path.join(ROOT, 'index.html'); buf = await fs.readFile(file); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(buf);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try { return await fn({ browser, base }); } finally { await browser.close(); srv.close(); }
}
