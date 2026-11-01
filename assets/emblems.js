// Emblemas de rango de SlapScore (diseño propio, no son los del juego).
import { parseRank } from './core.js';

const TIER = {
  BRONZE: ['#F0B48A', '#9A5428', '#5A2E14'],
  SILVER: ['#F1F5F9', '#8D9AAB', '#465363'],
  GOLD: ['#FFE38F', '#D0901A', '#6E4705'],
  PLAT: ['#B8F5EC', '#239A97', '#0B4A4D'],
  DIAMOND: ['#D6DEFF', '#5260E8', '#1E2585'],
  LEGEND: ['#FFC2CD', '#C81E44', '#5C0619'],
};

// Degradados compartidos: se insertan una vez en el documento
export function emblemDefs() {
  const grads = Object.entries(TIER).map(([k, [a, b]]) =>
    `<linearGradient id="emg-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${grads}</defs></svg>`;
}

const HEX = 'M20 2.5 35.5 11.5v17L20 37.5 4.5 28.5v-17Z';
const HEX_IN = 'M20 7.5 31 13.8v12.4L20 32.5 9 26.2V13.8Z';

function chevrons(n, ink) {
  const ys = n === 1 ? [21] : n === 2 ? [17.5, 24] : [14.5, 20.5, 26.5];
  return ys.map((y) => `<path d="M13.5 ${y - 3}l6.5 4.6 6.5-4.6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M13.5 ${y - 3}l6.5 4.6 6.5-4.6" fill="none" stroke="${ink}" stroke-opacity=".35" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 1.2)"/>`).join('');
}

export function emblemSVG(rk, size = 20) {
  const r = parseRank(rk);
  if (!r || !TIER[r.tier]) return '';
  const [, , ink] = TIER[r.tier];
  const fill = `url(#emg-${r.tier})`;
  let body = '';
  if (r.tier === 'DIAMOND') {
    body = `<path d="M20 2.5 37 17 20 37.5 3 17Z" fill="${fill}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<path d="M3 17h34M12 17l8 20.5 8-20.5M12 17l8-14.5 8 14.5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>`;
  } else {
    body = `<path d="${HEX}" fill="${fill}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<path d="${HEX_IN}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>`;
    if (r.tier === 'GOLD') body += `<path d="M4.5 15 0.8 12.5 2 20Zm31 0 3.7-2.5L38 20Z" fill="${fill}" stroke="${ink}" stroke-width="1.1" stroke-linejoin="round"/>`;
    if (r.tier === 'PLAT') body += `<path d="M15.5 4.6 20 0.8l4.5 3.8" fill="${fill}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
    if (r.tier === 'LEGEND') {
      body = `<path d="M8 9.5 12 3l4.5 4.2L20 1.5l3.5 5.7L28 3l4 6.5Z" fill="#FFD25E" stroke="#7A4A00" stroke-width="1.1" stroke-linejoin="round"/>` + body +
        `<path d="m20 12.5 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.7 5.2-.8Z" fill="#fff" stroke="${ink}" stroke-opacity=".5" stroke-width=".8" stroke-linejoin="round"/>`;
    } else if (r.div) body += chevrons(Math.min(3, r.div), ink);
    else body += `<circle cx="20" cy="20" r="4.2" fill="#fff"/>`;
  }
  return `<svg class="emb" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">${body}</svg>`;
}

// Logos oficiales subidos desde el panel (assets/ranks/index.json: { "PLAT_III": "PLAT_III.png", "GOLD": "GOLD.png", ... })
let OFFICIAL = {};
export function setOfficial(map) { OFFICIAL = map && typeof map === 'object' ? map : {}; }
export const hasOfficial = () => Object.keys(OFFICIAL).length > 0;
export function officialSrc(rk) {
  const r = parseRank(rk); if (!r) return null;
  const f = OFFICIAL[r.key] || OFFICIAL[r.tier];
  return f ? 'assets/ranks/' + encodeURI(f) : null;
}

// Emblema con título accesible (nombre del rango)
export function emblem(rk, size = 20, opts = {}) {
  const r = parseRank(rk);
  if (!r) return '';
  const label = r.name + (opts.mmr != null ? ` · ${opts.mmr} MMR` : '') + (opts.approx ? ` (${opts.approxLabel || 'aproximado'})` : '');
  const src = officialSrc(rk);
  const inner = src ? `<img class="emb-img" src="${src}" width="${size}" height="${size}" alt="" loading="lazy" decoding="async">` : emblemSVG(rk, size);
  return `<span class="emb-wrap${opts.approx ? ' approx' : ''}" role="img" aria-label="${label}" title="${label}">${inner}</span>`;
}
export const RANK_KEYS = ['BRONZE_I', 'BRONZE_II', 'BRONZE_III', 'SILVER_I', 'SILVER_II', 'SILVER_III', 'GOLD_I', 'GOLD_II', 'GOLD_III', 'PLAT_I', 'PLAT_II', 'PLAT_III', 'DIAMOND', 'LEGEND'];
