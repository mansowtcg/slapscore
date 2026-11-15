// Idioma de la web: inglés (por defecto), español, francés, alemán, portugués, turco o polaco. Los textos se escriben en
// español y se traducen con t(). El diccionario del idioma elegido solo se descarga si hace falta; en francés, alemán,
// portugués, turco y polaco, lo que aún no esté traducido sale en inglés.
import { langOfPath } from './routes.js';
import { pluralPL } from './core.js';
const KEY = 'slapscore-lang';
export const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['tr', 'Türkçe'], ['pl', 'Polski']];
const OK = new Set(LANGS.map(([k]) => k));
function detect() {
  // el que el visitante eligió (se recuerda en su navegador); si no eligió ninguno, el de la dirección que abre
  // (slapscore.app/jugador/123 sale en español, /joueurs en francés...); si no, inglés
  try { const s = localStorage.getItem(KEY); if (OK.has(s)) return s; } catch {}
  try { const l = langOfPath(location.pathname); if (OK.has(l)) return l; } catch {}
  return 'en';
}
export const LANG = detect();
export const LOC = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', tr: 'tr-TR', pl: 'pl-PL' }[LANG];
let DICT = null, FALL = null;
const PLURAL = LANG === 'pl';
const LOAD = { en: () => import('./en.js'), fr: () => import('./fr.js'), de: () => import('./de.js'), pt: () => import('./pt.js'), tr: () => import('./tr.js'), pl: () => import('./pl.js') };
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
  if (PLURAL && r.includes('[')) r = pluralPL(r, v && v.n);
  if (v) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  return r;
}
// En polaco la forma de la palabra depende del número: en pl.js va entre corchetes, «{n} [mecz|mecze|meczów]», y
// pluralPL (core.js) elige la que toca con {n}; sin número, la última.
export function setLang(l) { if (!OK.has(l)) return; try { localStorage.setItem(KEY, l); } catch {} location.reload(); }
// letras de los equipos (local / visitante) en cada idioma
export const TEAM_LETTER = { en: ['H', 'A'], es: ['L', 'V'], fr: ['D', 'E'], de: ['H', 'G'], pt: ['C', 'V'], tr: ['E', 'D'], pl: ['D', 'W'] }[LANG];
