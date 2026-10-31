// Lectura y escritura de los datos del robot (JSON plano o comprimido con gzip).
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

function decode(buf) {
  if (buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return buf.toString('utf8');
}
export async function readText(file) { try { return decode(await fs.readFile(file)); } catch { return null; } }
export async function readJSON(file, dflt) {
  const s = await readText(file);
  if (s == null) return dflt;
  try { return JSON.parse(s); } catch { return dflt; }
}
export async function list(dir) { try { return (await fs.readdir(dir)).sort(); } catch { return []; } }
export async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

// Escribe solo si el contenido cambia; devuelve la versión (hash del JSON) para que la web sepa qué ha cambiado.
export class Writer {
  constructor() { this.files = 0; this.bytes = 0; this.removed = 0; }
  // old: contenido anterior si ya se ha leído (evita leerlo otra vez)
  async json(file, value, old) {
    const s = JSON.stringify(value);
    const v = hash(s);
    if ((old !== undefined ? old : await readText(file)) === s) return { changed: false, v };
    await fs.mkdir(path.dirname(file), { recursive: true });
    const out = file.endsWith('.gz') ? zlib.gzipSync(s, { level: s.length > 200_000 ? 6 : 9 }) : s;
    await fs.writeFile(file, out);
    this.files++; this.bytes += out.length;
    return { changed: true, v };
  }
  async rm(p) {
    if (!(await exists(p))) return;
    await fs.rm(p, { recursive: true, force: true }); this.removed++;
  }
}
