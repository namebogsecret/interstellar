// Pure presentation helpers for laser-sail.html (no DOM) so the page logic is testable.
import { fmt as fmtBase } from './wwr-view.js';
import { fmtTime as fmtTimeBase, fmtSci as fmtSciBase } from './engines-view.js';

// Local locale wrappers: the shared formatters emit a decimal point; Russian text needs a decimal comma.
const dec = (s, lang) => (lang === 'ru' ? s.replace(/(\d)\.(\d)/g, '$1,$2') : s);
const fmt = (n, lang = 'en') => dec(fmtBase(n), lang);
const fmtTime = (sec, lang = 'en') => dec(fmtTimeBase(sec, lang), lang);
const fmtSci = (x, lang = 'en') => dec(fmtSciBase(x), lang);

// ---- log sliders (0..1000) <-> physical value ----
export const SLIDER_MAX = 1000;
export const MASS_MIN = 1e-3, MASS_MAX = 1e3;         // kg  (1 g .. 1000 kg)
export const POWER_MIN = 1e6, POWER_MAX = 1e13;       // W   (1 MW .. 10 TW)
export const AREA_MIN = 0.1, AREA_MAX = 1e6;          // m^2
const toVal = (v, lo, hi) => lo * Math.pow(hi / lo, v / SLIDER_MAX);
const toSlider = (x, lo, hi) => SLIDER_MAX * Math.log(x / lo) / Math.log(hi / lo);
export const sliderToMass = (v) => toVal(v, MASS_MIN, MASS_MAX);
export const massToSlider = (x) => toSlider(x, MASS_MIN, MASS_MAX);
export const sliderToPower = (v) => toVal(v, POWER_MIN, POWER_MAX);
export const powerToSlider = (x) => toSlider(x, POWER_MIN, POWER_MAX);
export const sliderToArea = (v) => toVal(v, AREA_MIN, AREA_MAX);
export const areaToSlider = (x) => toSlider(x, AREA_MIN, AREA_MAX);

export const PRESETS = [
  { id: 'starshot', mass: 1e-3, area: 10, power: 1e11, name: { en: 'Starshot', ru: 'Starshot' } },
  { id: 'fast', mass: 1e-3, area: 1, power: 1e13, name: { en: 'Relativistic chip', ru: 'Релятивистский чип' } },
  { id: 'cubesat', mass: 1, area: 100, power: 1e9, name: { en: 'CubeSat (1 kg)', ru: 'Кубсат (1 кг)' } },
  { id: 'heavy', mass: 1e3, area: 1e5, power: 1e13, name: { en: 'Heavy probe', ru: 'Тяжёлый зонд' } },
];

// "1.00 g" / "250 kg" etc; mass in kg
export function fmtMassKg(kg, lang = 'en') {
  if (!Number.isFinite(kg)) return '—';
  const ru = lang === 'ru';
  if (kg < 1) return fmt(kg * 1000, lang) + (ru ? ' г' : ' g');
  return fmt(kg, lang) + (ru ? ' кг' : ' kg');
}
// W -> "100 GW"
export function fmtPower(W, lang = 'en') {
  if (!Number.isFinite(W)) return '—';
  const ru = lang === 'ru';
  const u = ru ? ['Вт', 'кВт', 'МВт', 'ГВт', 'ТВт'] : ['W', 'kW', 'MW', 'GW', 'TW'];
  let i = 0, x = W;
  while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
  return fmt(x, lang) + ' ' + u[i];
}
export const fmtArea = (a, lang = 'en') => fmt(a, lang) + (lang === 'ru' ? ' м²' : ' m²');
export function fmtIntensity(x, lang = 'en') {
  if (!Number.isFinite(x)) return '—';
  const ru = lang === 'ru';
  const u = ru ? ['Вт', 'кВт', 'МВт', 'ГВт', 'ТВт', 'ПВт'] : ['W', 'kW', 'MW', 'GW', 'TW', 'PW'];
  let i = 0, v = x;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return fmt(v, lang) + ' ' + u[i] + (ru ? '/м²' : '/m²');
}
// distance in m -> km / thousand km / light-seconds is unnecessary: km, million km, AU-free
export function fmtLen(m, lang = 'en') {
  if (!Number.isFinite(m)) return '—';
  const ru = lang === 'ru';
  if (m < 1000) return fmt(m, lang) + (ru ? ' м' : ' m');
  const km = m / 1000;
  if (km < 1e6) return fmt(km, lang) + (ru ? ' км' : ' km');
  return fmt(km / 1e6, lang) + (ru ? ' млн км' : ' million km');
}
// beta -> "0.0419 c"; "<0.0001 c" for tiny; decimal comma in Russian
export function fmtBetaC(b, lang = 'en') {
  if (!Number.isFinite(b)) return '—';
  const ru = lang === 'ru';
  let s;
  if (b >= 0.001) s = b.toFixed(3); else if (b > 0) s = b < 1e-4 ? '<0.0001' : b.toFixed(4); else s = '0';
  return (ru ? s.replace('.', ',') : s) + ' c';
}
export const fmtGamma = (g, lang = 'en') => { const s = g < 1.0001 ? g.toFixed(6) : g.toFixed(4); return lang === 'ru' ? s.replace('.', ',') : s; };
// proper acceleration in g
export const fmtG = (g, lang = 'en') => fmtSci(g, lang) + (lang === 'ru' ? ' g' : ' g');
export const fmtPct = (p, lang = 'en') => {
  if (p == null || !Number.isFinite(p)) return '—';
  const a = Math.abs(p), s = a >= 100 ? p.toFixed(0) : a >= 10 ? p.toFixed(1) : a >= 0.01 ? p.toFixed(2) : String(+p.toPrecision(2));
  return (p > 0 ? '+' : '') + (lang === 'ru' ? s.replace('.', ',') : s) + '%';
};
// flight time; non-finite -> explicit "will not arrive" text supplied by the caller
export const fmtFlight = (sec, lang, never) => (Number.isFinite(sec) ? fmtTime(sec, lang) : never);

// ---- inline SVG charts (no libraries) ----
// Position of v on a log axis [min, max] as a fraction in [0, 1].
export function logFrac(v, min, max) {
  if (!Number.isFinite(v) || !(v > 0)) return 0;
  return Math.min(1, Math.max(0, Math.log(v / min) / Math.log(max / min)));
}
// Ticks of a decade axis between min and max (powers of ten)
export function decadeTicks(min, max) {
  const out = [];
  for (let e = Math.ceil(Math.log10(min)); e <= Math.floor(Math.log10(max)); e++) out.push(Math.pow(10, e));
  return out;
}
// Polyline points ("x,y x,y ...") in a W x H viewBox: x = log time, y = linear value in [0, yMax].
export function curvePoints(pts, key, tMin, tMax, yMax, W = 1000, H = 100) {
  const out = [];
  for (const p of pts) {
    if (!(p.t > 0)) continue;
    const y = p[key];
    if (!Number.isFinite(y)) continue;
    out.push((logFrac(p.t, tMin, tMax) * W).toFixed(2) + ',' + ((1 - Math.min(1, Math.max(0, y / yMax))) * H).toFixed(2));
  }
  return out.join(' ');
}
// Polyline for a log-log chart (y positive only, log axis [yMin, yMax])
export function curvePointsLog(pts, key, tMin, tMax, yMin, yMax, W = 1000, H = 100) {
  const out = [];
  for (const p of pts) {
    if (!(p.t > 0) || !(p[key] > 0)) continue;
    out.push((logFrac(p.t, tMin, tMax) * W).toFixed(2) + ',' + ((1 - logFrac(p[key], yMin, yMax)) * H).toFixed(2));
  }
  return out.join(' ');
}

// beam duration etc: seconds under an hour in s/min, else the shared long-time formatter
export function fmtDur(sec, lang = 'en') {
  if (!Number.isFinite(sec)) return '—';
  const ru = lang === 'ru';
  if (sec < 60) return fmt(sec, lang) + (ru ? ' с' : ' s');
  if (sec < 3600) return fmt(sec / 60, lang) + (ru ? ' мин' : ' min');
  return fmtTime(sec, lang);
}
// nice time-axis ticks (seconds) inside [tMin, tMax]
export const TIME_TICKS = [[1, '1 s', '1 с'], [60, '1 min', '1 мин'], [3600, '1 h', '1 ч'], [86400, '1 day', '1 сут'],
  [3.15576e7, '1 yr', '1 год'], [3.15576e9, '100 yr', '100 лет'], [3.15576e13, '1 Myr', '1 млн лет']];
