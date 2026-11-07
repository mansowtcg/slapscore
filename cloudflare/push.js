// Avisos en el móvil (Web Push) de los jugadores favoritos: termina un partido o sube de rango.
// Todo vive en el Durable Object "Push" (SQLite): las suscripciones de los navegadores (con los IDs de sus favoritos),
// las claves VAPID (las genera él mismo la primera vez; la privada nunca sale de aquí) y qué avisos ya se mandaron.
// Cada 3 minutos el reloj del Worker le pasa los sucesos que deja el robot en data/events.json y él manda los avisos,
// cifrados como pide el estándar (RFC 8291, aes128gcm) y firmados con VAPID (RFC 8292).
// No se guarda nada de la persona: solo la dirección de envío que da su navegador, sus claves de cifrado y los IDs que sigue.

const enc = new TextEncoder();
export const b64u = (buf) => { let s = ''; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
async function hmac(key, data) { const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)); }

// Servicios de envío de los navegadores (solo a estos se manda nada)
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/];
export function okEndpoint(ep) {
  try { const u = new URL(ep); return u.protocol === 'https:' && !u.port && ep.length < 1000 && PUSH_HOSTS.some((r) => r.test(u.hostname)); } catch { return false; }
}

// Cifrado del mensaje para un navegador (RFC 8291)
export async function encrypt(payload, p256dh, auth) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || secret.length < 16) throw new Error('bad keys');
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hmac(await hmac(secret, shared), cat(enc.encode('WebPush: info\0'), ua, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// Firma VAPID (RFC 8292): un JWT ES256 por servicio de envío
export async function vapidAuth(endpoint, keys, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: 'mailto:contact@slapscore.app' })));
  const k = await crypto.subtle.importKey('jwk', keys.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.pub}`;
}

// Textos de los avisos
const TXT = {
  es: { W: 'Victoria', L: 'Derrota', D: 'Empate', rt: 'nota', up: '{n} sube a {r}', upb: 'Nuevo rango en Slapshot: Rebound', also: 'también {n}', pub: 'Pública', cus: 'Custom', dec: ',' },
  en: { W: 'Win', L: 'Loss', D: 'Draw', rt: 'rating', up: '{n} ranked up to {r}', upb: 'New rank in Slapshot: Rebound', also: 'also {n}', pub: 'Public', cus: 'Custom', dec: '.' },
  fr: { W: 'Victoire', L: 'Défaite', D: 'Nul', rt: 'note', up: '{n} passe {r}', upb: 'Nouveau rang dans Slapshot: Rebound', also: 'aussi {n}', pub: 'Publique', cus: 'Custom', dec: ',' },
  de: { W: 'Sieg', L: 'Niederlage', D: 'Unentschieden', rt: 'Note', up: '{n} steigt auf {r} auf', upb: 'Neuer Rang in Slapshot: Rebound', also: 'auch {n}', pub: 'Öffentlich', cus: 'Custom', dec: ',' },
  pt: { W: 'Vitória', L: 'Derrota', D: 'Empate', rt: 'nota', up: '{n} subiu para {r}', upb: 'Novo rank no Slapshot: Rebound', also: 'também {n}', pub: 'Pública', cus: 'Custom', dec: ',' },
  tr: { W: 'Galibiyet', L: 'Mağlubiyet', D: 'Beraberlik', rt: 'not', up: '{n} {r} rütbesine yükseldi', upb: "Slapshot: Rebound'da yeni rütbe", also: 'ayrıca {n}', pub: 'Açık', cus: 'Özel', dec: ',' },
};
const TIER = { BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold', PLAT: 'Platinum', DIAMOND: 'Diamond', LEGEND: 'Legend' };
const rankName = (rk) => { const [t, n] = String(rk || '').split('_'); return (TIER[t] || t || '') + (n ? ' ' + n : ''); };
const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');
const short = (s, n = 40) => String(s || '').replace(/[\u0000-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '').slice(0, n);
const matchUrl = (e) => `/m/${String(e.k).replace(/[-/]/g, '')}-${e.i}`;

export function matchNote(e, followed, lang) {
  const T = TXT[lang] || TXT.en;
  const p = followed[0], score = (s, tm) => (tm === 0 ? `${s[0]}-${s[1]}` : `${s[1]}-${s[0]}`);
  const res = e.w === -1 ? 'D' : e.w === p[2] ? 'W' : 'L';
  const rt = (Math.round(p[3] * 10) / 10).toFixed(1).replace('.', T.dec);
  const bits = [`${T.rt} ${rt}`, `${p[4]} G · ${p[5]} A`, e.y === 'custom' ? T.cus : T.pub, e.a].filter(Boolean);
  if (followed.length > 1) bits.push(fill(T.also, { n: followed.slice(1).map((x) => short(x[1], 24)).join(', ') }));
  return { title: `${short(p[1])} · ${T[res]} ${score(e.s, p[2])}`, body: bits.join(' · '), url: matchUrl(e), tag: 'm' + e.i };
}
export function rankNote(r, lang) {
  const T = TXT[lang] || TXT.en;
  return { title: fill(T.up, { n: short(r.n), r: rankName(r.to) }), body: T.upb, url: `/j/${r.id}`, tag: 'r' + r.id };
}

const MAX_SUBS = 20000, MAX_IDS = 50, MAX_SEND = 60;

export class Push {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql; this.lim = new Map();
    this.sql.exec(`CREATE TABLE IF NOT EXISTS subs (ep TEXT PRIMARY KEY, p256dh TEXT, auth TEXT, lang TEXT, ids TEXT, created INTEGER, ok INTEGER, fails INTEGER DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS fol (pid TEXT, ep TEXT, PRIMARY KEY (pid, ep))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sent (id TEXT PRIMARY KEY, t INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
  }
  async keys() {
    if (this._keys) return this._keys;
    const row = this.sql.exec(`SELECT v FROM kv WHERE k = 'vapid'`).toArray()[0];
    if (row) return (this._keys = JSON.parse(row.v));
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const keys = { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    this.sql.exec(`INSERT OR IGNORE INTO kv (k, v) VALUES ('vapid', ?)`, JSON.stringify(keys));
    return (this._keys = JSON.parse(this.sql.exec(`SELECT v FROM kv WHERE k = 'vapid'`).toArray()[0].v));
  }
  limited(ip) {
    const now = Date.now(), w = this.lim.get(ip);
    if (!w || now - w[1] > 3600_000) { this.lim.set(ip, [1, now]); if (this.lim.size > 5000) this.lim.clear(); return false; }
    return ++w[0] > 30;
  }
  async fetch(request) {
    const url = new URL(request.url), out = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/key') return out({ key: (await this.keys()).pub });
    if (url.pathname === '/count') return out({ subs: this.sql.exec('SELECT COUNT(*) AS n FROM subs').one().n, follows: this.sql.exec('SELECT COUNT(*) AS n FROM fol').one().n });
    let b = null; try { b = await request.json(); } catch {}
    if (!b || typeof b !== 'object') return out({ error: 'bad' }, 400);
    if (url.pathname === '/sub') {
      if (this.limited(String(b.ip || ''))) return out({ error: 'wait' }, 429);
      const s = b.sub || {}, ep = String(s.endpoint || ''), k = s.keys || {};
      if (!okEndpoint(ep) || !/^[\w-]{80,100}$/.test(String(k.p256dh || '')) || !/^[\w-]{16,30}$/.test(String(k.auth || ''))) return out({ error: 'bad' }, 400);
      const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String).filter((x) => /^\d{1,12}$/.test(x)))].slice(0, MAX_IDS);
      const lang = TXT[b.lang] ? b.lang : 'en';
      const exists = this.sql.exec('SELECT 1 FROM subs WHERE ep = ?', ep).toArray().length;
      if (!exists && this.sql.exec('SELECT COUNT(*) AS n FROM subs').one().n >= MAX_SUBS) return out({ error: 'full' }, 503);
      this.sql.exec(`INSERT INTO subs (ep, p256dh, auth, lang, ids, created, ok, fails) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(ep) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang, ids = excluded.ids, fails = 0`, ep, k.p256dh, k.auth, lang, JSON.stringify(ids), Date.now(), Date.now());
      this.sql.exec('DELETE FROM fol WHERE ep = ?', ep);
      for (const id of ids) this.sql.exec('INSERT OR IGNORE INTO fol (pid, ep) VALUES (?, ?)', id, ep);
      return out({ ok: true, ids: ids.length });
    }
    if (url.pathname === '/unsub') {
      const ep = String(b.endpoint || '');
      this.sql.exec('DELETE FROM subs WHERE ep = ?', ep); this.sql.exec('DELETE FROM fol WHERE ep = ?', ep);
      return out({ ok: true });
    }
    if (url.pathname === '/tick') return out(await this.tick(b));
    if (url.pathname === '/test') {
      // aviso de prueba a un navegador (lo pide el propio navegador al activar los avisos)
      const ep = String(b.endpoint || ''), row = this.sql.exec('SELECT * FROM subs WHERE ep = ?', ep).toArray()[0];
      if (!row) return out({ error: 'no sub' }, 404);
      const T = { es: ['Avisos activados', 'Te avisaremos cuando tus favoritos terminen un partido o suban de rango.'], en: ['Notifications on', "We'll let you know when your favourites finish a match or rank up."], fr: ['Notifications activées', 'On te prévient quand tes favoris terminent un match ou montent de rang.'], de: ['Benachrichtigungen an', 'Wir melden uns, wenn deine Favoriten ein Spiel beenden oder aufsteigen.'], pt: ['Avisos ativados', 'Vamos avisar quando seus favoritos terminarem uma partida ou subirem de rank.'], tr: ['Bildirimler açık', 'Favorilerin bir maçı bitirdiğinde veya rütbe atladığında sana haber vereceğiz.'] }[row.lang] || ['Notifications on', ''];
      const r = await this.send(row, { title: T[0], body: T[1], url: '/', tag: 'test' }, await this.keys());
      return out({ ok: r === 'ok', status: r });
    }
    return out({ error: 'not found' }, 404);
  }
  // Manda un aviso; devuelve 'ok', 'gone' (suscripción caducada: se borra) o 'fail'
  async send(row, note, keys) {
    let r;
    try {
      const body = await encrypt(JSON.stringify(note), row.p256dh, row.auth);
      r = await fetch(row.ep, { method: 'POST', body, headers: { 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '3600', urgency: 'normal', topic: String(note.tag || '').replace(/[^\w-]/g, '').slice(0, 32), authorization: await vapidAuth(row.ep, keys) } });
    } catch { return 'fail'; }
    if (r.status === 404 || r.status === 410) { this.sql.exec('DELETE FROM subs WHERE ep = ?', row.ep); this.sql.exec('DELETE FROM fol WHERE ep = ?', row.ep); return 'gone'; }
    if (r.ok) { this.sql.exec('UPDATE subs SET ok = ?, fails = 0 WHERE ep = ?', Date.now(), row.ep); return 'ok'; }
    this.sql.exec('UPDATE subs SET fails = fails + 1 WHERE ep = ?', row.ep);
    if ((this.sql.exec('SELECT fails FROM subs WHERE ep = ?', row.ep).toArray()[0] || {}).fails > 20) { this.sql.exec('DELETE FROM subs WHERE ep = ?', row.ep); this.sql.exec('DELETE FROM fol WHERE ep = ?', row.ep); }
    return 'fail';
  }
  // Sucesos nuevos del robot -> avisos a quien sigue a esos jugadores
  async tick(ev) {
    const now = Date.now(), keys = await this.keys();
    this.sql.exec('DELETE FROM sent WHERE t < ?', now - 3 * 86400_000);
    const done = (id) => this.sql.exec('SELECT 1 FROM sent WHERE id = ?', id).toArray().length > 0;
    const jobs = [];   // [ep, note]
    for (const e of Array.isArray(ev.m) ? ev.m.slice(0, 300) : []) {
      if (!e || !e.i || !Array.isArray(e.p) || done('m' + e.i)) continue;
      if (now - (e.t || 0) > 2 * 3600_000) { this.sql.exec('INSERT OR IGNORE INTO sent (id, t) VALUES (?, ?)', 'm' + e.i, now); continue; }   // demasiado antiguo
      const pids = e.p.map((p) => String(p[0])).filter((x) => /^\d{1,12}$/.test(x));
      if (pids.length) {
        const rows = this.sql.exec(`SELECT f.ep AS ep, f.pid AS pid FROM fol f WHERE f.pid IN (${pids.map(() => '?').join(',')})`, ...pids).toArray();
        const byEp = new Map(); for (const r of rows) { if (!byEp.has(r.ep)) byEp.set(r.ep, []); byEp.get(r.ep).push(r.pid); }
        for (const [ep, mine] of byEp) jobs.push([ep, (lang) => matchNote(e, e.p.filter((p) => mine.includes(String(p[0]))), lang)]);
      }
      this.sql.exec('INSERT OR IGNORE INTO sent (id, t) VALUES (?, ?)', 'm' + e.i, now);
    }
    for (const r of Array.isArray(ev.r) ? ev.r.slice(0, 300) : []) {
      if (!r || !/^\d{1,12}$/.test(String(r.id))) continue;
      const id = `r${r.id}:${r.to}:${r.t}`; if (done(id)) continue;
      if (now - (r.t || 0) <= 6 * 3600_000) for (const row of this.sql.exec('SELECT ep FROM fol WHERE pid = ?', String(r.id)).toArray()) jobs.push([row.ep, (lang) => rankNote(r, lang)]);
      this.sql.exec('INSERT OR IGNORE INTO sent (id, t) VALUES (?, ?)', id, now);
    }
    const stats = { jobs: jobs.length, ok: 0, gone: 0, fail: 0 };
    for (const [ep, make] of jobs.slice(0, MAX_SEND)) {
      const row = this.sql.exec('SELECT * FROM subs WHERE ep = ?', ep).toArray()[0]; if (!row) continue;
      stats[await this.send(row, make(row.lang), keys)]++;
    }
    return stats;
  }
}
