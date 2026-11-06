// Idioma de la web: inglés (por defecto), español, francés, alemán o portugués. Los textos se escriben en español
// y se traducen con t(). El diccionario del idioma elegido solo se descarga si hace falta; en francés, alemán y
// portugués, lo que aún no esté traducido sale en inglés.
const KEY = 'slapscore-lang';
export const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português']];
const OK = new Set(LANGS.map(([k]) => k));
function detect() {
  // inglés por defecto; los demás, si el visitante los elige (se recuerda en su navegador)
  try { const s = localStorage.getItem(KEY); if (OK.has(s)) return s; } catch {}
  return 'en';
}
export const LANG = detect();
export const LOC = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR' }[LANG];
let DICT = null, FALL = null;
const LOAD = { en: () => import('./en.js'), fr: () => import('./fr.js'), de: () => import('./de.js'), pt: () => import('./pt.js') };
if (LANG !== 'es') {
  try {
    const [d, e] = await Promise.all([LOAD[LANG](), LANG === 'en' ? null : LOAD.en().catch(() => null)]);
    DICT = d.default; FALL = e ? e.default : null;
  } catch { DICT = null; }
}
document.documentElement.lang = LANG;

// t('Hace {n} min', { n: 5 }) -> 'Hace 5 min' / '5 min ago'
export function t(s, v) {
  let r = s;
  if (DICT) {
    if (s in DICT) r = DICT[s];
    else { if (FALL && s in FALL) r = FALL[s]; if (s) (globalThis.__i18nMiss || (globalThis.__i18nMiss = new Set())).add(s); }
  }
  if (v) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  return r;
}
export function setLang(l) { if (!OK.has(l)) return; try { localStorage.setItem(KEY, l); } catch {} location.reload(); }
// letras de los equipos (local / visitante) en cada idioma
export const TEAM_LETTER = { en: ['H', 'A'], es: ['L', 'V'], fr: ['D', 'E'], de: ['H', 'G'], pt: ['C', 'V'] }[LANG];
