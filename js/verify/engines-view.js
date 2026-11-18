// Pure presentation helpers for engines.html (no DOM) so the page logic is testable.
import { fmt } from './wwr-view.js';

const DAY = 86400, YEAR = 365.25 * DAY;

// log slider (0..1000) <-> payload mass in kg, PAYLOAD_MIN..PAYLOAD_MAX
export const PAYLOAD_MIN = 100, PAYLOAD_MAX = 1e6;
export const SLIDER_MAX = 1000;
export const sliderToPayload = (v) => PAYLOAD_MIN * Math.pow(PAYLOAD_MAX / PAYLOAD_MIN, v / SLIDER_MAX);
export const payloadToSlider = (kg) => SLIDER_MAX * Math.log(kg / PAYLOAD_MIN) / Math.log(PAYLOAD_MAX / PAYLOAD_MIN);

// Position of `value` on a log axis [min, max] as a fraction in [0, 1]. Infinity -> 1 (unreachable).
export function barFraction(value, min, max) {
  if (value === Infinity) return 1;
  if (!Number.isFinite(value) || !(value > 0)) return 0;
  const f = Math.log(value / min) / Math.log(max / min);
  return Math.min(1, Math.max(0, f));
}

// Russian plural form: [one, few, many]
function ruPlural(n, forms) {
  const k = Math.round(n), m100 = k % 100, m10 = k % 10;
  if (m100 >= 11 && m100 <= 14) return forms[2];
  if (m10 === 1) return forms[0];
  if (m10 >= 2 && m10 <= 4) return forms[1];
  return forms[2];
}
// For a displayed non-integer ("1.5") Russian uses the genitive singular.
const ruWord = (shown, forms) => (Number.isInteger(+shown) ? ruPlural(+shown, forms) : forms[1]);

// seconds -> "5.3 days" / "3.2 тыс. лет": hours, days, years, thousand/million/billion years.
export function fmtTime(sec, lang = 'en') {
  if (!Number.isFinite(sec)) return '∞';
  const ru = lang === 'ru';
  const unit = (n, enOne, enMany, ruForms) => {
    const s = fmt(n);
    const shown = s.replace(/\s/g, '');
    return s + ' ' + (ru ? ruWord(shown, ruForms) : (shown === '1' ? enOne : enMany));
  };
  if (sec < DAY) return unit(sec / 3600, 'hour', 'hours', ['час', 'часа', 'часов']);
  if (sec < YEAR) return unit(sec / DAY, 'day', 'days', ['день', 'дня', 'дней']);
  const y = sec / YEAR;
  if (y < 1000) return unit(y, 'year', 'years', ['год', 'года', 'лет']);
  if (y < 1e6) return fmt(y / 1e3) + (ru ? ' тыс. лет' : ' thousand years');
  if (y < 1e9) return fmt(y / 1e6) + (ru ? ' млн лет' : ' million years');
  return fmt(y / 1e9) + (ru ? ' млрд лет' : ' billion years');
}

// m/s -> "850 m/s" below 1 km/s, else "8.37 km/s"
export function fmtDv(ms, lang = 'en') {
  if (!Number.isFinite(ms)) return '—';
  const ru = lang === 'ru';
  if (Math.abs(ms) < 1000) return fmt(ms) + (ru ? ' м/с' : ' m/s');
  return fmt(ms / 1000) + (ru ? ' км/с' : ' km/s');
}

// kg -> "250 kg" / "1.00·10^6 kg" style via fmt
export const fmtMass = (kg, lang = 'en') => fmt(kg) + (lang === 'ru' ? ' кг' : ' kg');

// log slider (-100..100) <-> thrust multiplier 0.1x..10x
export const THRUST_SLIDER_MAX = 100;
export const sliderToThrust = (v) => Math.pow(10, v / THRUST_SLIDER_MAX);
export const thrustToSlider = (k) => THRUST_SLIDER_MAX * Math.log10(k);

// small/large positive numbers: "4.62 m/s2" style mantissa, else "5.84·10^-4"; 0 -> "0"
export function fmtSci(x) {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const ax = Math.abs(x);
  if (ax >= 0.01 && ax < 1000) return String(+x.toPrecision(3));
  const e = Math.floor(Math.log10(ax)), m = x / Math.pow(10, e);
  return m.toFixed(2) + '·10^' + e;
}
export const fmtAccel = (a, lang = 'en') => fmtSci(a) + (lang === 'ru' ? ' м/с²' : ' m/s²');
export const fmtFlow = (f, lang = 'en') => fmtSci(f) + (lang === 'ru' ? ' кг/с' : ' kg/s');
