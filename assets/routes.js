// Direcciones de la web: sin # y en el idioma de cada visitante (slapscore.app/jugadores, /players, /joueurs...).
// Por dentro, cada página sigue teniendo su clave de siempre (#jugadores, #j-123, #m-..., #d-2026-11-05, #cmp-1-2):
// pathFor() pasa de la clave a la dirección y keyFor() al revés, aceptando cualquier idioma, las direcciones cortas
// /j/<id> y /m/<id> y las antiguas, que la web cambia sola por la buena (sin recargar).
// Lo usan la web (app.js) y el Worker de Cloudflare (que sirve la web en todas estas direcciones).

export const PAGES = {
  jugadores: { en: 'players', es: 'jugadores', fr: 'joueurs', de: 'spieler', pt: 'jogadores', tr: 'oyuncular' },
  rankings: { en: 'rankings', es: 'rankings', fr: 'classements', de: 'ranglisten', pt: 'rankings', tr: 'siralamalar' },
  records: { en: 'records', es: 'records', fr: 'records', de: 'rekorde', pt: 'recordes', tr: 'rekorlar' },
  premios: { en: 'awards', es: 'premios', fr: 'recompenses', de: 'auszeichnungen', pt: 'premios', tr: 'oduller' },
  eusl: { en: 'eusl', es: 'eusl', fr: 'eusl', de: 'eusl', pt: 'eusl', tr: 'eusl' },
  notas: { en: 'how-we-rate', es: 'como-puntuamos', fr: 'notation', de: 'bewertung', pt: 'como-avaliamos', tr: 'notlandirma' },
  novedades: { en: 'whats-new', es: 'novedades', fr: 'nouveautes', de: 'neuigkeiten', pt: 'novidades', tr: 'yenilikler' },
  legal: { en: 'legal', es: 'aviso-legal', fr: 'mentions-legales', de: 'impressum', pt: 'aviso-legal', tr: 'yasal' },
};
// páginas con un dato detrás: jugador, partido, día y comparación
export const PARAM = {
  j: { en: 'player', es: 'jugador', fr: 'joueur', de: 'spieler', pt: 'jogador', tr: 'oyuncu' },
  m: { en: 'match', es: 'partido', fr: 'match', de: 'spiel', pt: 'partida', tr: 'mac' },
  d: { en: 'matches', es: 'partidos', fr: 'matchs', de: 'spiele', pt: 'partidas', tr: 'maclar' },
  cmp: { en: 'compare', es: 'comparar', fr: 'comparer', de: 'vergleich', pt: 'comparar', tr: 'karsilastir' },
};
const VALID = { j: /^\d{1,12}$/, m: /^\d{10}-[0-9a-zA-Z-]{8,64}$/, d: /^\d{4}-\d{2}-\d{2}$/, cmp: /^\d{1,12}(-\d{1,12})?$/ };
// sin traducir: el panel de administrador y su entrada (que no se enlaza en ningún sitio)
export const FIXED = ['admin', 'entrada-ibai'];
// nombres antiguos o en otro idioma que también valen
const ALIAS = { 'récords': 'records', awards: 'premios', news: 'novedades', whatsnew: 'novedades', notas: 'notas', 'como-puntuamos': 'notas' };
const SHORT = { j: 'j', m: 'm', p: 'j' };

// clave interna (con o sin #) -> dirección en ese idioma; null si no es una página
export function pathFor(key, lang = 'en') {
  const h = String(key || '').replace(/^#/, '');
  if (!h || h === 'partidos' || h === 'matches') return '/';
  const p = PAGES[h]; if (p) return '/' + (p[lang] || p.en);
  if (FIXED.includes(h)) return '/' + h;
  const m = /^(cmp|j|m|d)-(.+)$/.exec(h);
  if (m && VALID[m[1]].test(m[2])) return `/${PARAM[m[1]][lang] || PARAM[m[1]].en}/${m[2]}`;
  return null;
}

// dirección -> clave interna ('' es la portada); null si no es ninguna página de la web
export function keyFor(path) {
  let p = String(path || '/').split(/[?#]/)[0];
  try { p = decodeURIComponent(p); } catch { return null; }
  const seg = p.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (!seg.length) return '';
  const s = seg[0].toLowerCase();
  if (seg.length === 1) {
    for (const [k, v] of Object.entries(PAGES)) if (Object.values(v).includes(s)) return k;
    if (FIXED.includes(s)) return s;
    if (ALIAS[s]) return ALIAS[s];
    if (Object.values(PARAM.d).includes(s) || s === 'index.html') return '';
    return null;
  }
  if (seg.length === 2) {
    const kind = SHORT[s] || Object.keys(PARAM).find((k) => Object.values(PARAM[k]).includes(s));
    if (kind && VALID[kind].test(seg[1])) return `${kind}-${seg[1]}`;
  }
  return null;
}

// idioma de una dirección, si su primera parte solo existe en uno (/jugador -> es, /joueurs -> fr; /rankings, ninguno)
export function langOfPath(path) {
  const s = String(path || '').split(/[?#]/)[0].replace(/^\/+/, '').split('/')[0].toLowerCase();
  if (!s) return null;
  const langs = new Set();
  for (const v of [...Object.values(PAGES), ...Object.values(PARAM)]) for (const [l, w] of Object.entries(v)) if (w === s) langs.add(l);
  return langs.size === 1 ? [...langs][0] : null;
}
