// Idioma de la web: inglés (por defecto) o español. Los textos se escriben en español y se traducen con t().
// El diccionario inglés (en.js) solo se descarga si hace falta.
const KEY = 'slapscore-lang';
function detect() {
  // inglés por defecto; el español, si el visitante lo elige (se recuerda en su navegador)
  try { const s = localStorage.getItem(KEY); if (s === 'es' || s === 'en') return s; } catch {}
  return 'en';
}
export const LANG = detect();
export const LOC = LANG === 'en' ? 'en-GB' : 'es-ES';
let DICT = null;
if (LANG === 'en') { try { DICT = (await import('./en.js')).default; } catch { DICT = null; } }
document.documentElement.lang = LANG;

// t('Hace {n} min', { n: 5 }) -> 'Hace 5 min' / '5 min ago'
export function t(s, v) {
  let r = s;
  if (DICT) { if (s in DICT) r = DICT[s]; else if (s) (globalThis.__i18nMiss || (globalThis.__i18nMiss = new Set())).add(s); }
  if (v) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  return r;
}
export function setLang(l) { try { localStorage.setItem(KEY, l); } catch {} location.reload(); }
