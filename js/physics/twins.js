// Twin paradox in transit: the travelling twin's clock vs the stay-at-home clock.
// Pure maths, no DOM. Units: years (Julian, YEAR), light years, beta = v/c (so c = 1 ly/yr).
// Two modes: "cruise" (instant boost to beta, instant turnaround) and "accel"
// (four equal-duration phases of constant proper acceleration: hyperbolic motion).
import { C, YEAR, G0 } from './constants.js';

export function gammaOf(beta) {
  if (typeof beta !== 'number' || !Number.isFinite(beta) || beta < 0 || beta >= 1) return NaN;
  return 1 / Math.sqrt(1 - beta * beta);
}

function checkYears(earthYears) {
  if (typeof earthYears !== 'number' || !Number.isFinite(earthYears) || earthYears <= 0) {
    throw new RangeError('earthYears must be a finite number > 0');
  }
}

export function cruiseTrip({ beta, earthYears } = {}) {
  if (typeof beta !== 'number' || !Number.isFinite(beta) || beta < 0 || beta >= 1) {
    throw new RangeError('beta must be in [0, 1)');
  }
  checkYears(earthYears);
  const gamma = gammaOf(beta);
  const shipYears = earthYears / gamma;
  return {
    mode: 'cruise', beta, gamma, earthYears, shipYears,
    ageGapYears: earthYears - shipYears,
    turnaroundLy: beta * earthYears / 2,
    maxBeta: beta,
  };
}

// c/a in years for proper acceleration accelG (in g): c/a = C / (accelG*G0) seconds.
function caYears(accelG) { return C / (accelG * G0) / YEAR; }

// One accelerating leg from rest, w = a*t/c = t/(c/a): proper time, distance, beta.
function leg(ca, t) {
  const w = t / ca;
  const s = Math.sqrt(1 + w * w);
  return { tau: ca * Math.asinh(w), x: ca * (w * w / (s + 1)), beta: w / s };
}

export function accelTrip({ accelG, earthYears } = {}) {
  if (typeof accelG !== 'number' || !Number.isFinite(accelG) || accelG <= 0) {
    throw new RangeError('accelG must be a finite number > 0');
  }
  checkYears(earthYears);
  const ca = caYears(accelG);
  const tq = earthYears / 4;
  const q = leg(ca, tq);
  const shipYears = 4 * q.tau;
  const w = tq / ca;
  return {
    mode: 'accel', accelG, earthYears, shipYears,
    gamma: Math.sqrt(1 + w * w),
    ageGapYears: earthYears - shipYears,
    turnaroundLy: 2 * q.x,
    maxBeta: q.beta,
  };
}

export function clocksAt(trip, t) {
  const T = trip.earthYears;
  const tt = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), T);
  const phase = tt <= T / 2 ? 'out' : 'back';
  if (trip.mode === 'cruise') {
    const tau = tt / trip.gamma;
    const x = tt <= T / 2 ? trip.beta * tt : trip.beta * (T - tt);
    return { t: tt, tau, x: Math.max(0, x), beta: trip.beta, phase };
  }
  const ca = caYears(trip.accelG);
  const tq = T / 4;
  const q = leg(ca, tq);
  let tau, x, beta;
  if (tt <= tq) {
    const l = leg(ca, tt); tau = l.tau; x = l.x; beta = l.beta;
  } else if (tt <= 2 * tq) {
    const l = leg(ca, 2 * tq - tt); tau = 2 * q.tau - l.tau; x = 2 * q.x - l.x; beta = l.beta;
  } else if (tt <= 3 * tq) {
    const l = leg(ca, tt - 2 * tq); tau = 2 * q.tau + l.tau; x = 2 * q.x - l.x; beta = l.beta;
  } else {
    const l = leg(ca, 4 * tq - tt); tau = 4 * q.tau - l.tau; x = l.x; beta = l.beta;
  }
  return { t: tt, tau, x: Math.max(0, x), beta, phase };
}

export function sampleTrip(trip, n = 200) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(clocksAt(trip, trip.earthYears * i / n));
  return out;
}
