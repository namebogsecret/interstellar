// Pure presentation helpers for dust.html (no DOM) so the page logic is testable.
import { fmt, fmtSci, fmtEnergy, fmtMassKg, fmtMassSci, fmtBetaC, fmtGamma } from './mission-view.js';
import { BETA_MIN, BETA_MAX, MATERIAL_IDS, N_H_DEFAULT, DEFAULTS, NEIGHBORS, clampBeta } from '../physics/dust.js';

export { fmt, fmtSci, fmtEnergy, fmtMassKg, fmtMassSci, fmtBetaC, fmtGamma };

const dec = (s, lang) => (lang === 'ru' ? s.replace(/(\d)\.(\d)/g, '$1,$2') : s);

// ---- log sliders (0..1000) <-> physical value ----
export const SLIDER_MAX = 1000;
export const RADIUS_MIN = 0.01e-6, RADIUS_MAX = 10e-6;   // m
export const NH_MIN = 0.01, NH_MAX = 10;                 // cm^-3
export const PAYLOAD_MIN = 1, PAYLOAD_MAX = 1e6;         // kg
export const AREA_MIN = 0.01, AREA_MAX = 1e4;            // m^2
const toVal = (v, lo, hi) => lo * Math.pow(hi / lo, v / SLIDER_MAX);
const toSlider = (x, lo, hi) => SLIDER_MAX * Math.log(x / lo) / Math.log(hi / lo);
export const sliderToRadius = (v) => toVal(v, RADIUS_MIN, RADIUS_MAX);
export const radiusToSlider = (x) => toSlider(x, RADIUS_MIN, RADIUS_MAX);
export const sliderToNH = (v) => toVal(v, NH_MIN, NH_MAX);
export const nhToSlider = (x) => toSlider(x, NH_MIN, NH_MAX);
export const sliderToPayload = (v) => toVal(v, PAYLOAD_MIN, PAYLOAD_MAX);
export const payloadToSlider = (x) => toSlider(x, PAYLOAD_MIN, PAYLOAD_MAX);
export const sliderToArea = (v) => toVal(v, AREA_MIN, AREA_MAX);
export const areaToSlider = (x) => toSlider(x, AREA_MIN, AREA_MAX);

export const NH_PRESETS = [
  { id: 'lic', n: 0.1, name: { en: 'Local cloud ~0.1', ru: 'Местное облако ~0,1' } },
  { id: 'wnm', n: 0.5, name: { en: 'Warm medium ~0.5', ru: 'Тёплая среда ~0,5' } },
  { id: 'dense', n: 10, name: { en: 'Dense cloud ~10', ru: 'Плотное облако ~10' } },
];
export const MATERIAL_LABELS = {
  graphite: { en: 'Graphite', ru: 'Графит' },
  beryllium: { en: 'Beryllium', ru: 'Бериллий' },
  aluminium: { en: 'Aluminium', ru: 'Алюминий' },
};

// ---- URL parameters: ?star=<id>&beta=&payload=&n=&mat=&clamped=below|above&bm=<mission beta>; invalid -> default ----
const num = (s) => (s === null || s === undefined || String(s).trim() === '' ? NaN : Number(s));
export function parseParams(search) {
  const q = new URLSearchParams(search || '');
  const star = NEIGHBORS.some((n) => n.id === q.get('star')) ? q.get('star') : 'proxima';
  const b = num(q.get('beta'));
  const beta = Number.isFinite(b) && b >= BETA_MIN && b <= BETA_MAX ? b : 0.2;
  const pl = num(q.get('payload'));
  const payload = Number.isFinite(pl) && pl >= PAYLOAD_MIN && pl <= PAYLOAD_MAX ? pl : DEFAULTS.payload_kg;
  const n = num(q.get('n'));
  const nH = Number.isFinite(n) && n >= NH_MIN && n <= NH_MAX ? n : N_H_DEFAULT;
  const mat = MATERIAL_IDS.includes(q.get('mat')) ? q.get('mat') : 'graphite';
  const cl = q.get('clamped');
  const clamped = cl === 'below' || cl === 'above' ? cl : null;
  const bm = num(q.get('bm'));
  return { star, beta, payload, nH, mat, clamped, betaMission: clamped && Number.isFinite(bm) && bm >= 0 ? bm : null };
}

// round for a URL: 4 significant digits, no exponent noise for ordinary values
const urlNum = (x) => String(+x.toPrecision(4));

/** dust.html link for a mission: beta clamped into the model range, the clamp side and raw beta passed along. */
export function dustHref({ starId, payload, beta }) {
  const q = new URLSearchParams();
  if (starId) q.set('star', starId);
  const c = clampBeta(beta);
  if (Number.isFinite(c.beta)) q.set('beta', urlNum(c.beta));
  if (Number.isFinite(payload) && payload > 0) q.set('payload', urlNum(Math.min(Math.max(payload, PAYLOAD_MIN), PAYLOAD_MAX)));
  if (c.clamped) { q.set('clamped', c.clamped); q.set('bm', urlNum(beta)); }
  return 'dust.html?' + q.toString();
}
/** mission.html link back: star id + payload. */
export function missionHref({ starId, payload }) {
  const q = new URLSearchParams();
  if (starId) q.set('star', starId);
  if (Number.isFinite(payload) && payload > 0) q.set('payload', urlNum(payload));
  return 'mission.html?' + q.toString();
}

// ---- formatters ----
export const fmtMeV = (x, lang = 'en') => (Number.isFinite(x) ? dec(x >= 100 ? x.toFixed(1) : x >= 1 ? x.toFixed(3) : String(+x.toPrecision(3)), lang) : '—') + (lang === 'ru' ? ' МэВ' : ' MeV');
export const fmtTNT = (kg, lang = 'en') => fmtMassSciOrPlain(kg, lang) + (lang === 'ru' ? ' тротила' : ' of TNT');
function fmtMassSciOrPlain(kg, lang) {
  if (!Number.isFinite(kg)) return '—';
  if (kg >= 1e-3 && kg < 1e3) return fmtMassKg(kg, lang);
  return fmtMassSci(kg, lang);
}
export const fmtRadius = (m, lang = 'en') => dec(String(+(m * 1e6).toPrecision(3)), lang) + (lang === 'ru' ? ' мкм' : ' µm');
export const fmtNH = (n, lang = 'en') => dec(String(+n.toPrecision(2)), lang) + (lang === 'ru' ? ' см⁻³' : ' cm⁻³');
export const fmtPerM2 = (x, lang = 'en') => fmtSci(x, lang) + (lang === 'ru' ? ' /м²' : ' /m²');
export const fmtKgM2 = (x, lang = 'en') => (x === 0 ? '0' : fmtSci(x, lang)) + (lang === 'ru' ? ' кг/м²' : ' kg/m²');
export const fmtJM2 = (x, lang = 'en') => (x === 0 ? '0' : fmtSci(x, lang)) + (lang === 'ru' ? ' Дж/м²' : ' J/m²');
// m -> µm / mm / cm / m, 3 significant digits
export function fmtDepth(m, lang = 'en') {
  if (!Number.isFinite(m)) return '—';
  const ru = lang === 'ru';
  if (m === 0) return '0' + (ru ? ' мм' : ' mm');
  const [k, u] = m < 1e-3 ? [1e6, ru ? 'мкм' : 'µm'] : m < 1e-2 ? [1e3, ru ? 'мм' : 'mm'] : m < 1 ? [1e2, ru ? 'см' : 'cm'] : [1, ru ? 'м' : 'm'];
  const v = m * k;
  return (v < 1e-2 || v >= 1e4 ? fmtSci(v, lang) : dec(String(+v.toPrecision(3)), lang)) + ' ' + u;
}
export const fmtRatio = (r, lang = 'en') => (r >= 0.01 && r < 1e4 ? dec(String(+r.toPrecision(3)), lang) : fmtSci(r, lang)) + '×';

// Honest everyday comparison for an energy: only when a reference lies within half a decade (×3.16).
export const ENERGY_REFS = [
  { J: 1e-6, en: 'a flying mosquito (~10⁻⁶ J)', ru: 'летящий комар (~10⁻⁶ Дж)' },
  { J: 1e-3, en: 'a 1 g paperclip dropped from 10 cm', ru: 'скрепка 1 г, упавшая с 10 см' },
  { J: 1e-2, en: 'a 1 g paperclip dropped from 1 m', ru: 'скрепка 1 г, упавшая с 1 м' },
  { J: 0.1, en: 'a 10 g coin dropped from 1 m', ru: 'монета 10 г, упавшая с 1 м' },
  { J: 1, en: 'a 100 g apple dropped from 1 m', ru: 'яблоко 100 г, упавшее с 1 м' },
  { J: 11, en: 'a tennis ball thrown by hand (57 g at 20 m/s)', ru: 'теннисный мяч, брошенный рукой (57 г, 20 м/с)' },
  { J: 116, en: 'a baseball pitch (145 g at 40 m/s)', ru: 'подача в бейсболе (145 г, 40 м/с)' },
  { J: 500, en: 'a 9 mm pistol bullet (~500 J)', ru: 'пистолетная пуля 9 мм (~500 Дж)' },
  { J: 3.5e3, en: 'a 7.62 mm rifle bullet (~3.5 kJ)', ru: 'винтовочная пуля 7,62 мм (~3,5 кДж)' },
  { J: 1.8e4, en: 'a 12.7 mm heavy machine-gun bullet (~18 kJ)', ru: 'пуля крупнокалиберного пулемёта 12,7 мм (~18 кДж)' },
  { J: 4e5, en: 'a hand grenade (~0.1 kg of TNT)', ru: 'ручная граната (~0,1 кг тротила)' },
  { J: 4.2e6, en: '1 kg of TNT', ru: '1 кг тротила' },
];
export function compareEnergy(J, lang = 'en') {
  if (!Number.isFinite(J) || J <= 0) return null;
  let best = null, bd = Infinity;
  for (const r of ENERGY_REFS) {
    const d = Math.abs(Math.log10(J / r.J));
    if (d < bd) { bd = d; best = r; }
  }
  if (bd > 0.5) return null;
  return lang === 'ru' ? best.ru : best.en;
}
