// Idioma de la web (español / inglés). Los textos se escriben en español y t() los traduce si hace falta.
const KEY = 'slapscore-lang';
function detect() {
  try { const s = localStorage.getItem(KEY); if (s === 'es' || s === 'en') return s; } catch {}
  const l = (navigator.languages && navigator.languages[0]) || navigator.language || 'es';
  return /^es\b/i.test(l) ? 'es' : 'en';
}
export const LANG = detect();
export const LOCALE = LANG === 'es' ? 'es-ES' : 'en-GB';
let DICT = null;
export function setDict(d) { DICT = d; }
// t('Texto con {n} cosas', { n: 3 })
export function t(s, vars) {
  let r = (DICT && DICT[s] != null) ? DICT[s] : s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  return r;
}
// tp(3, '{n} partido', '{n} partidos')
export const tp = (n, one, many, vars = {}) => t(n === 1 ? one : many, { n, ...vars });
export function setLang(l) { try { localStorage.setItem(KEY, l); } catch {} location.reload(); }
