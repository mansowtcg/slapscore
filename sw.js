// Service worker de SlapScore: carga instantánea y uso sin conexión.
const BUILD = '__BUILD__';
const SHELL = `slapscore-shell-${BUILD}`;
const DATA = 'slapscore-data-v3';
const FONTS = 'slapscore-fonts';
const SHELL_FILES = ['./', 'index.html', 'manifest.webmanifest', 'assets/icons/icon-192.png', 'assets/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if ((k.startsWith('slapscore-shell-') && k !== SHELL) || k === 'slapscore-data') await caches.delete(k);
    await self.clients.claim();
  })());
});

let trimming = false;
async function trimData() {
  if (trimming) return; trimming = true;
  try { const c = await caches.open(DATA); const keys = await c.keys(); if (keys.length > 700) for (const k of keys.slice(0, keys.length - 600)) await c.delete(k); }
  finally { trimming = false; }
}
async function networkFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const u = new URL(req.url); const key = req.mode === 'navigate' ? req : u.origin + u.pathname;
  try { const r = await fetch(req); if (r.ok) c.put(key, r.clone()); return r; }
  catch { const hit = await c.match(key, { ignoreSearch: true }); if (hit) return hit; throw new Error('offline'); }
}
async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req); if (hit) return hit;
  const r = await fetch(req); if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); if (cacheName === DATA) trimData(); } return r;
}
async function staleWhileRevalidate(req, e) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req);
  const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { e.respondWith(cacheFirst(req, FONTS)); return; }
  if (url.origin !== location.origin) return;
  const path = url.pathname;
  // la API (buzón, estadísticas del administrador) nunca se guarda en la copia sin conexión
  if (path.startsWith('/api/')) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, SHELL).catch(() => caches.match('index.html'))); return; }
  // Datos que cambian: siempre de la red (con copia para usar sin conexión)
  if (/\/data\/index\.json$|\/config\/settings\.json$|\/assets\/ranks\/index\.json$/.test(path) || url.searchParams.has('v') && /^\d+$/.test(url.searchParams.get('v'))) {
    e.respondWith(networkFirst(req, DATA)); return;
  }
  // Datos versionados (?v=huella del contenido): una misma dirección nunca cambia
  if (path.includes('/data/')) { e.respondWith(cacheFirst(req, DATA)); return; }
  // Código y estilos marcados con la versión publicada (?b=...): tampoco cambian
  if (url.searchParams.has('b')) { e.respondWith(cacheFirst(req, SHELL)); return; }
  // Logos de rango: al momento desde la copia y se renuevan por detrás
  if (path.includes('/assets/ranks/') && path.endsWith('.png')) { e.respondWith(staleWhileRevalidate(req, e)); return; }
  // Todo lo demás (iconos...): red primero, copia para usar sin conexión
  e.respondWith(networkFirst(req, SHELL));
});

// Avisos de los favoritos (los manda el Worker cifrados; aquí llegan ya descifrados)
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch {}
  const url = typeof d.url === 'string' && d.url.startsWith('/') && !d.url.startsWith('//') ? d.url : '/';
  e.waitUntil(self.registration.showNotification(String(d.title || 'SlapScore').slice(0, 120), {
    body: String(d.body || '').slice(0, 300), icon: '/assets/icons/icon-192.png', badge: '/assets/icons/badge-96.png',
    tag: typeof d.tag === 'string' ? d.tag.slice(0, 64) : undefined, data: { url },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => new URL(c.url).origin === self.location.origin);
    if (w) { await w.focus(); if ('navigate' in w) { try { await w.navigate(url); } catch {} } return; }
    await self.clients.openWindow(url);
  })());
});

