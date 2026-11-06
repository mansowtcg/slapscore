// Ko-fi: insignia ♥ Supporter automática.
// Ko-fi avisa de cada apoyo con un webhook (POST a /api/kofi, formulario con un campo «data» en JSON). Se comprueba con la
// clave de verificación de Ko-fi, que el administrador pega en el panel (aquí solo se guarda su resumen SHA-256).
// Si el mensaje del apoyo lleva el ID o el enlace del perfil de slapshot.gg y ese jugador existe en SlapScore, pasa a ser
// supporter al momento; si no, el administrador lo asigna desde el panel. El robot baja la lista en cada pasada (con la
// API de Cloudflare) y la junta con la de los ajustes.
// Se guarda lo justo para eso: nombre que muestra Ko-fi, importe, tipo, mensaje y fecha (no el email). Se borra a los 2 años.

const CONF = 'sys:kofi', SUPS = 'sys:supporters';
const KEEP_S = 2 * 365 * 86400;
const MAX_BODY = 32768;

export async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const tidy = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '').trim().slice(0, max);

// ID de jugador en el mensaje: enlace de slapshot.gg o de SlapScore, «ID 12345», o un único número largo
export function findPid(text) {
  const s = String(text || '');
  const m = /slapshot\.gg\/(?:\w+\/)?players\/(\d{1,12})/i.exec(s) || /slapscore\.app\/(?:#j-|(?:j|player|jugador|joueur|spieler|jogador)\/)(\d{1,12})/i.exec(s)
    || /#j-(\d{1,12})\b/.exec(s) || /\bID\s*[:#=]?\s*(\d{3,12})\b/i.exec(s);
  if (m) return m[1];
  const nums = s.match(/\b\d{4,12}\b/g) || [];
  return nums.length === 1 ? nums[0] : '';
}

export async function getSupporters(KV) {
  try { const l = JSON.parse((await KV.get(SUPS)) || '[]'); return Array.isArray(l) ? l.map(String).filter((x) => /^\d{1,12}$/.test(x)) : []; } catch { return []; }
}
async function setSupporters(KV, list) { await KV.put(SUPS, JSON.stringify([...new Set(list.map(String))].slice(0, 5000))); }

// El webhook de Ko-fi. Siempre responde enseguida; solo guarda si la clave coincide.
export async function webhook(request, env, exists) {
  const KV = env.FEEDBACK;
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!KV) return new Response('unavailable', { status: 503 });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return new Response('too big', { status: 413 });
  const raw = (await request.text()).slice(0, MAX_BODY);
  let d = null;
  try { const f = new URLSearchParams(raw).get('data'); d = JSON.parse(f != null ? f : raw); } catch {}
  if (!d || typeof d !== 'object') return new Response('bad request', { status: 400 });
  let conf = {}; try { conf = JSON.parse((await KV.get(CONF)) || '{}') || {}; } catch {}
  if (!conf.hash || typeof d.verification_token !== 'string' || (await sha256(d.verification_token)) !== conf.hash) return new Response('forbidden', { status: 403 });
  // el mismo apoyo puede llegar dos veces si Ko-fi reintenta
  const tx = tidy(d.kofi_transaction_id || d.message_id, 80);
  if (tx) { if (await KV.get('kofitx:' + tx)) return new Response('ok'); await KV.put('kofitx:' + tx, '1', { expirationTtl: 30 * 86400 }); }
  const message = tidy(d.message, 500);
  const cand = findPid(message);
  let pid = '';
  if (cand) { try { if (await exists(cand)) pid = cand; } catch {} }
  const t = Date.parse(d.timestamp) || Date.now();
  const key = `kofi:${String(9999999999999 - t).padStart(13, '0')}-${crypto.randomUUID().slice(0, 8)}`;
  const item = {
    t, name: tidy(d.from_name, 80) || 'Anónimo', amount: tidy(d.amount, 12), cur: tidy(d.currency, 6), type: tidy(d.type, 20),
    tier: tidy(d.tier_name, 60), sub: d.is_subscription_payment ? 1 : 0, pub: d.is_public === false ? 0 : 1, msg: message, cand, pid,
  };
  await KV.put(key, JSON.stringify(item), { expirationTtl: KEEP_S });
  if (pid) await setSupporters(KV, [...(await getSupporters(KV)), pid]);
  return new Response('ok');
}

// Panel de administrador: estado, apoyos recibidos, asignar un jugador, quitar, clave de verificación
export async function admin(request, env, path, exists) {
  const KV = env.FEEDBACK;
  const out = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  let conf = {}; try { conf = JSON.parse((await KV.get(CONF)) || '{}') || {}; } catch {}
  if (request.method === 'GET') {
    const keys = []; let cursor;
    do { const page = await KV.list({ prefix: 'kofi:', cursor, limit: 1000 }); keys.push(...page.keys.map((k) => k.name)); cursor = page.list_complete ? null : page.cursor; } while (cursor && keys.length < 300);
    const items = (await Promise.all(keys.slice(0, 300).map(async (k) => { const v = await KV.get(k); try { return v ? { key: k, ...JSON.parse(v) } : null; } catch { return null; } }))).filter(Boolean);
    return out({ configured: !!conf.hash, since: conf.at || 0, items, supporters: await getSupporters(KV) });
  }
  if (request.method !== 'POST') return out({ error: 'method' }, 405);
  let b = null; try { b = JSON.parse((await request.text()).slice(0, 4096)); } catch {}
  if (!b || typeof b !== 'object') return out({ error: 'bad' }, 400);
  if (path === '/api/kofi/token') {
    const tk = String(b.token || '').trim();
    if (!/^[\w-]{8,200}$/.test(tk)) return out({ error: 'La clave no parece válida: cópiala entera de Ko-fi (Verification Token).' }, 400);
    await KV.put(CONF, JSON.stringify({ hash: await sha256(tk), at: Date.now() }));
    return out({ ok: true });
  }
  const pid = String(b.pid || '').trim();
  if (path === '/api/kofi/assign') {
    if (!/^kofi:\d{13}-[0-9a-f]{8}$/.test(String(b.key || ''))) return out({ error: 'bad' }, 400);
    if (!/^\d{1,12}$/.test(pid)) return out({ error: 'Escribe el número de jugador o pega el enlace de su perfil.' }, 400);
    if (!(await exists(pid))) return out({ error: 'Ese jugador no está en SlapScore (aún no tiene partidos guardados).' }, 404);
    const v = await KV.get(b.key); if (!v) return out({ error: 'Ese apoyo ya no está.' }, 404);
    const item = JSON.parse(v); item.pid = pid;
    await KV.put(b.key, JSON.stringify(item), { expirationTtl: KEEP_S });
    await setSupporters(KV, [...(await getSupporters(KV)), pid]);
    return out({ ok: true });
  }
  if (path === '/api/kofi/remove') {
    if (!/^\d{1,12}$/.test(pid)) return out({ error: 'bad' }, 400);
    await setSupporters(KV, (await getSupporters(KV)).filter((x) => x !== pid));
    return out({ ok: true });
  }
  if (path === '/api/kofi/delete') {
    if (!/^kofi:\d{13}-[0-9a-f]{8}$/.test(String(b.key || ''))) return out({ error: 'bad' }, 400);
    await KV.delete(b.key);
    return out({ ok: true });
  }
  return out({ error: 'not found' }, 404);
}
