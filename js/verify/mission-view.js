// Pure presentation helpers for mission.html (no DOM) so the page logic is testable.
import { fmt as fmtBase } from './wwr-view.js';
import { fmtTime as fmtTimeBase, fmtSci as fmtSciBase } from './engines-view.js';

import * as LS from './lasersail-view.js';
import { fmtDv as fmtDvBase } from './engines-view.js';
export {
  sliderToPower, powerToSlider, sliderToArea, areaToSlider, POWER_MIN, POWER_MAX, AREA_MIN, AREA_MAX,
} from './lasersail-view.js';
export { A_MIN, A_MAX, gOf, vOf } from './wwr-view.js';

// Russian text needs a decimal comma where the shared formatters emit a point.
const dec = (s, lang) => (lang === 'ru' ? s.replace(/(\d)\.(\d)/g, '$1,$2') : s);
export const fmt = (n, lang = 'en') => dec(fmtBase(n), lang);
export const fmtTime = (sec, lang = 'en') => dec(fmtTimeBase(sec, lang), lang);
export const fmtMassKg = (x, lang = 'en') => dec(LS.fmtMassKg(x, lang), lang);
export const fmtPower = (x, lang = 'en') => dec(LS.fmtPower(x, lang), lang);
export const fmtArea = (x, lang = 'en') => dec(LS.fmtArea(x, lang), lang);
export const fmtBetaC = (x, lang = 'en') => dec(LS.fmtBetaC(x, lang), lang);
export const fmtGamma = (x, lang = 'en') => dec(LS.fmtGamma(x, lang), lang);
export const fmtDv = (x, lang = 'en') => dec(fmtDvBase(x, lang), lang);
export const fmtSci = (x, lang = 'en') => dec(fmtSciBase(x), lang);

// ---- log sliders (0..1000) <-> physical value ----
export const SLIDER_MAX = 1000;
export const PAYLOAD_MIN = 1, PAYLOAD_MAX = 1e6;        // kg
export const BUDGET_MIN = 1e10, BUDGET_MAX = 1e26;      // J
const toVal = (v, lo, hi) => lo * Math.pow(hi / lo, v / SLIDER_MAX);
const toSlider = (x, lo, hi) => SLIDER_MAX * Math.log(x / lo) / Math.log(hi / lo);
export const sliderToPayload = (v) => toVal(v, PAYLOAD_MIN, PAYLOAD_MAX);
export const payloadToSlider = (x) => toSlider(x, PAYLOAD_MIN, PAYLOAD_MAX);
export const sliderToBudget = (v) => toVal(v, BUDGET_MIN, BUDGET_MAX);
export const budgetToSlider = (x) => toSlider(x, BUDGET_MIN, BUDGET_MAX);

export const WORLD_ENERGY_PER_YEAR = 6e20;              // J, order of the world primary energy use per year

// J -> "2.08·10^11 J" (scientific through the shared formatter); 0 -> "0 J"
export const fmtEnergy = (J, lang = 'en') => (J === 0 ? '0' : fmtSci(J, lang)) + (lang === 'ru' ? ' Дж' : ' J');
export const fmtMassSci = (kg, lang = 'en') => (kg === 0 ? '0' : fmtSci(kg, lang)) + (lang === 'ru' ? ' кг' : ' kg');

const ruPlural = (n, forms) => {
  const k = Math.round(n), m100 = k % 100, m10 = k % 10;
  if (m100 >= 11 && m100 <= 14) return forms[2];
  if (m10 === 1) return forms[0];
  if (m10 >= 2 && m10 <= 4) return forms[1];
  return forms[2];
};
// energy -> years of world energy consumption: "0.35 years of world energy use"
export function fmtWorldYears(J, lang = 'en') {
  if (!Number.isFinite(J)) return '—';
  const y = J / WORLD_ENERGY_PER_YEAR;
  const num = y >= 0.01 || y === 0 ? fmt(y, lang) : fmtSci(y, lang);
  if (lang === 'ru') return num + ' ' + (Number.isInteger(+num.replace(/\s/g, '').replace(',', '.')) ? ruPlural(y, ['год', 'года', 'лет']) : 'года') + ' мирового потребления';
  return num + (num === '1.00' ? ' year' : ' years') + ' of world energy use';
}
// "within budget (using 3.4% of it)" / "over budget by ×3.4"
export function fmtBudgetVerdict(plan, lang = 'en') {
  const r = plan.budgetRatio, ru = lang === 'ru';
  const pct = r < 0.01 ? fmtSci(r * 100, lang) : fmt(r * 100, lang);
  if (plan.withinBudget) return ru ? 'в бюджете (' + pct + '% бюджета)' : 'within budget (' + pct + '% of it)';
  return ru ? 'превышение бюджета в ' + fmt(r, lang) + ' раз' : 'over budget ×' + fmt(r, lang);
}
// over-budget factor: "×2.6" (EN) / "в 2,6 раза" (RU); same number formatting as the budget row
export function fmtOverBy(r, lang = 'en') {
  const num = r >= 100 ? fmt(Math.round(r), lang) : fmt(r, lang);
  if (lang !== 'ru') return '×' + num;
  const plain = num.replace(/\s/g, '').replace(',', '.');
  const word = num.includes('·') ? 'раз' : Number.isInteger(+plain) ? ruPlural(+plain, ['раз', 'раза', 'раз']) : 'раза';
  return 'в ' + num + ' ' + word;
}
// fraction -> "15,3%"
export function fmtFrac(f, lang = 'en') {
  if (f == null || !Number.isFinite(f)) return '—';
  const p = f * 100, s = p >= 10 ? p.toFixed(1) : p >= 0.01 ? p.toFixed(2) : String(+p.toPrecision(2));
  return (lang === 'ru' ? s.replace('.', ',') : s) + '%';
}
export function fmtLY(ly, lang = 'en') { const s = String(+ly.toFixed(2)); return (lang === 'ru' ? s.replace('.', ',') : s) + (lang === 'ru' ? ' св. года' : ' ly'); }

export const ENGINE_LABELS = {
  laser: { en: 'Laser light sail (ground laser)', ru: 'Лазерный парус (лазер на Земле)' },
  photon: { en: 'Photon rocket (ideal, ve = c)', ru: 'Фотонная ракета (идеальная, ve = c)' },
};
