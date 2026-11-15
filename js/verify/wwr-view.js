// Pure presentation helpers for where-we-reach.html (no DOM) so the page logic is testable.
import { oneMinusBeta } from '../physics/flight.js';

export const A_MIN = 0.1, A_MAX = 10;

// log-scale slider (0..1000) <-> acceleration in g, A_MIN..A_MAX
export const gOf = (v) => A_MIN * Math.pow(A_MAX / A_MIN, v / 1000);
export const vOf = (g) => Math.round(1000 * Math.log(g / A_MIN) / Math.log(A_MAX / A_MIN));

export function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  const x = Math.abs(n);
  if (x === 0) return '0';
  if (x >= 1e6) { const e = Math.floor(Math.log10(x)); return (n / Math.pow(10, e)).toFixed(2) + '·10^' + e; }
  if (x >= 1000) return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
  if (x >= 100) return n.toFixed(0);
  if (x >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

// Peak speed from rapidity x: plain beta while it is readable, else "1 - m.m*10^e".
export function fmtBeta(x) {
  const b = Math.tanh(x);
  if (b < 0.999) return b.toFixed(3) + ' c';
  const o = oneMinusBeta(x);
  let m = +o.mant.toFixed(1), e = o.exp10;
  if (m >= 10) { m = 1; e += 1; }
  return '1 − ' + m.toFixed(1) + '·10^' + e + ' (c)';
}

// log10 of the photon-rocket mass ratio: (gamma(1+beta))^2 -> e^{2x}
export const massLog10 = (x) => x * 2 / Math.LN10;

// "year" word agreeing with the number as the page DISPLAYS it (fmt rounds >=100 to integers).
export function yearWord(n, lang) {
  if (lang !== 'ru') return n === 1 ? 'year' : 'years';
  if (!Number.isFinite(n) || n >= 1e6) return 'лет';
  const k = n >= 100 ? Math.round(n) : n;
  if (!Number.isInteger(k)) return 'года';
  const m100 = k % 100, m10 = k % 10;
  if (m100 >= 11 && m100 <= 14) return 'лет';
  if (m10 === 1) return 'год';
  if (m10 >= 2 && m10 <= 4) return 'года';
  return 'лет';
}
