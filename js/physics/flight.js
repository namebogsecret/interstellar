// Flip-and-burn flight at CONSTANT PROPER ACCELERATION a (hyperbolic motion):
// accelerate for half the ship time, turn over, decelerate for the other half,
// arriving at rest. Pure functions, SI units (m, s, m/s^2); no DOM, no state.
//
// With rapidity x = a*tau/(2c), tau = total ship (proper) time:
//   D     = (4c^2/a) sinh^2(x/2)   distance covered (NOT 2c^2/a (cosh x - 1):
//                                  that cancels catastrophically for small x)
//   T     = (2c/a) sinh x          Earth-frame (coordinate) time
//   gamma = cosh x, beta = tanh x  peak speed, reached at the turnover
// Inverse: x = 2 asinh( sqrt(a D / (4 c^2)) ), tau = 2 c x / a.
// Model limits: no gravity, no fuel/energy budget, no drag; see the page notes.
import { C, YEAR, LY } from './constants.js';

export { LY };

// cosh(x) overflows a double near x ~ 710; stay well clear.
export const X_MAX = 700;

const okNum = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const refuse = (reason) => ({ valid: false, reason });

function fromX(a, x) {
  if (!(x <= X_MAX)) return refuse('rapidity too large (overflow guard)');
  const s2 = Math.sinh(x / 2);
  const out = {
    valid: true, a, x,
    tau: 2 * C * x / a,
    D: (4 * C * C / a) * s2 * s2,
    T: (2 * C / a) * Math.sinh(x),
    gammaMax: Math.cosh(x),
    betaMax: Math.tanh(x),
  };
  for (const k of ['tau', 'D', 'T', 'gammaMax', 'betaMax']) {
    if (!Number.isFinite(out[k])) return refuse('result not finite');
  }
  return out;
}

// 1 - tanh(x) = 2/(e^{2x}+1), as {mant, exp10} (value = mant * 10^exp10, 1 <= mant < 10).
// 1 - Math.tanh(x) is exactly 0 for x > ~19 (double rounding) and e^{2x} overflows near
// x ~ 355, so work in log10 using only exp(-2x), which never overflows for x >= 0.
export function oneMinusBeta(x) {
  if (!(typeof x === 'number' && Number.isFinite(x) && x >= 0)) return { mant: NaN, exp10: NaN };
  const L = Math.log10(2) - 2 * x / Math.LN10 - Math.log10(1 + Math.exp(-2 * x));
  let exp10 = Math.floor(L);
  let mant = Math.pow(10, L - exp10);
  if (mant >= 10) { mant /= 10; exp10 += 1; }
  return { mant, exp10 };
}

// Given acceleration a (m/s^2) and total ship time tau (s) -> distance reached.
export function flightForTau(a, tau) {
  if (!okNum(a)) return refuse('acceleration must be a finite number > 0');
  if (!okNum(tau)) return refuse('ship time must be a finite number > 0');
  return fromX(a, a * tau / (2 * C));
}

// Given acceleration a (m/s^2) and distance D (m) -> ship time, Earth time, peak speed.
export function flightForDistance(a, D) {
  if (!okNum(a)) return refuse('acceleration must be a finite number > 0');
  if (!okNum(D)) return refuse('distance must be a finite number > 0');
  const x = 2 * Math.asinh(Math.sqrt(a * D / (4 * C * C)));
  const r = fromX(a, x);
  if (r.valid) r.D = D; // exact input, not the round-tripped value
  return r;
}

// stars: [{name, ru, ly}] -> same list + {D, tau, T, gammaMax, betaMax, reachable}.
// reachable = ship time to arrive is within the traveller's tau (s). Bad input -> all false.
export function reachable(stars, a, tau) {
  return stars.map((s) => {
    const r = flightForDistance(a, s.ly * LY);
    if (!r.valid) {
      return { ...s, D: s.ly * LY, tau: NaN, T: NaN, gammaMax: NaN, betaMax: NaN, reachable: false };
    }
    const within = okNum(tau) && r.tau <= tau;
    return { ...s, D: r.D, tau: r.tau, T: r.T, gammaMax: r.gammaMax, betaMax: r.betaMax, reachable: within };
  });
}

export { YEAR };
