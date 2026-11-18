// "Neighbours in the galaxy": travel times to the nearest stars + table sort/filter. Pure, no DOM.
// Flip-and-burn comes from flight.js (flightForDistance), flyby (accelerate all the way, no braking)
// from accel.js; nothing is re-derived here. Units: years, light-years, g.
import { G0, LY, YEAR } from './constants.js';
import { flightForDistance } from './flight.js';
import { flyby } from './accel.js';
import { NEIGHBORS } from '../data/neighbors.js';

export const GROUPS = ['O', 'B', 'A', 'F', 'G', 'K', 'M', 'L', 'T', 'D'];
export const MODES = ['flip', 'flyby'];
export const ACCEL_MIN_G = 0.1;
export const ACCEL_MAX_G = 10;
export const ACCEL_DEFAULT_G = 1;

// Spectral type string -> group letter ('D' = white dwarf), or null if unknown.
// Handles "M5.5Ve", "DA2", "DQZ", "F5IV-V", "sdM1" (subdwarf prefix), "T0.5".
export function spectralGroup(spectral) {
  if (typeof spectral !== 'string') return null;
  const s = spectral.replace(/^sd/, '');
  const g = s.charAt(0);
  return GROUPS.includes(g) ? g : null;
}

// Numeric subclass: "M5.5Ve" -> 5.5, "DA2" -> 2, "DQZ" -> 0 (none given).
export function spectralSubclass(spectral) {
  const s = String(spectral).replace(/^sd/, '');
  const m = s.charAt(0) === 'D' ? s.match(/^D[A-Z]*(\d+(?:\.\d+)?)/) : s.match(/^[A-Z](\d+(?:\.\d+)?)/);
  const n = m ? parseFloat(m[1]) : 0;
  return Number.isFinite(n) ? n : 0;
}

// Total order key for sorting by spectral class: group first, then subclass.
export function spectralKey(spectral) {
  const g = spectralGroup(spectral);
  return (g === null ? GROUPS.length : GROUPS.indexOf(g)) * 100 + spectralSubclass(spectral);
}

// Time to a star at distance ly (light-years) for proper acceleration accelG (g).
// Returns {tau, t, peakGamma, peakBeta} in years, or null if not representable.
export function tripTo(ly, accelG, mode = 'flip') {
  if (!MODES.includes(mode)) throw new RangeError('unknown mode: ' + mode);
  if (!(Number.isFinite(accelG) && accelG > 0)) throw new RangeError('accelG must be finite and > 0');
  if (!(Number.isFinite(ly) && ly > 0)) throw new RangeError('ly must be finite and > 0');
  if (mode === 'flyby') {
    const r = flyby({ accelG, d: ly });
    return { tau: r.tau, t: r.t, peakGamma: r.peakGamma, peakBeta: r.peakBeta };
  }
  const r = flightForDistance(accelG * G0, ly * LY);
  if (!r.valid) return null;
  return { tau: r.tau / YEAR, t: r.T / YEAR, peakGamma: r.gammaMax, peakBeta: r.betaMax };
}

// Catalogue -> table rows. `no` = fixed catalogue number (1 = nearest), independent of sorting.
export function buildRows(stars = NEIGHBORS, accelG = ACCEL_DEFAULT_G, mode = 'flip') {
  return stars.map((s, i) => {
    const group = spectralGroup(s.spectral);
    const r = tripTo(s.ly, accelG, mode) || { tau: NaN, t: NaN, peakGamma: NaN, peakBeta: NaN };
    return { ...s, no: i + 1, group, key: spectralKey(s.spectral), ...r };
  });
}

export const SORT_KEYS = ['no', 'name', 'spectral', 'ly', 'tau', 't'];

// Returns a NEW array sorted by key ('name' | 'spectral' | 'ly' | 'tau' | 't' | 'no'), dir 'asc'|'desc'.
// Stable: ties fall back to catalogue number (always ascending). NaN sorts last either way.
export function sortRows(rows, key, dir = 'asc', lang = 'en') {
  if (!SORT_KEYS.includes(key)) throw new RangeError('unknown sort key: ' + key);
  if (dir !== 'asc' && dir !== 'desc') throw new RangeError('dir must be asc or desc');
  const sign = dir === 'asc' ? 1 : -1;
  const val = (r) => (key === 'name' ? (lang === 'ru' && r.ru ? r.ru : r.name) : key === 'spectral' ? r.key : r[key]);
  return rows.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    if (typeof x === 'number' || typeof y === 'number') {
      const nx = Number.isNaN(x), ny = Number.isNaN(y);
      if (nx || ny) return nx && ny ? a.no - b.no : nx ? 1 : -1;
      if (x !== y) return (x < y ? -1 : 1) * sign;
    } else {
      const c = String(x).localeCompare(String(y), lang);
      if (c !== 0) return c * sign;
    }
    return a.no - b.no;
  });
}

// filter: { groups: iterable of group letters allowed (undefined = all), maxLy: number|null|undefined
// (no limit), query: string (case-insensitive substring of name/ru/system) }. Returns a NEW array.
export function filterRows(rows, { groups, maxLy, query } = {}) {
  const allowed = groups === undefined ? null : new Set(groups);
  const q = (query || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (allowed && !allowed.has(r.group)) return false;
    if (typeof maxLy === 'number' && Number.isFinite(maxLy) && !(r.ly <= maxLy)) return false;
    if (q && !(r.name + ' ' + (r.ru || '') + ' ' + r.system).toLowerCase().includes(q)) return false;
    return true;
  });
}

// Parse ?a= (accel in g). Missing / not a number / out of range -> default or clamp.
export function parseAccelParam(search) {
  const raw = new URLSearchParams(search || '').get('a');
  if (raw === null || raw.trim() === '') return ACCEL_DEFAULT_G;
  const v = Number(raw.replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return ACCEL_DEFAULT_G;
  return Math.min(ACCEL_MAX_G, Math.max(ACCEL_MIN_G, v));
}

// Log slider helpers: s in [0, 1000] <-> accelG in [ACCEL_MIN_G, ACCEL_MAX_G].
export function accelFromSlider(s) {
  const f = Math.min(1, Math.max(0, Number.isFinite(s) ? s / 1000 : 0));
  return ACCEL_MIN_G * Math.pow(ACCEL_MAX_G / ACCEL_MIN_G, f);
}
export function sliderFromAccel(g) {
  const v = Math.min(ACCEL_MAX_G, Math.max(ACCEL_MIN_G, g));
  return 1000 * Math.log(v / ACCEL_MIN_G) / Math.log(ACCEL_MAX_G / ACCEL_MIN_G);
}
