// Constant-proper-acceleration trips to a star: flip-and-burn vs flyby (no braking).
// Pure maths, no DOM. Units: years (Julian, YEAR), light-years, c = 1 ly/yr; acceleration is given
// in g (G0) and converted to ly/yr^2. Model: flat special relativity, straight line, hyperbolic
// motion; no gravity, no fuel/energy limits, no cruise phase, target at rest relative to Earth.
// Accelerating from rest over distance x with proper acceleration a (u = a x, c = 1):
//   gamma = 1 + u,  beta = sqrt(u(u+2))/(1+u),
//   tau = acosh(gamma)/a (ship clock),  t = sqrt(gamma^2 - 1)/a (Earth-frame clock).
// Written through u so that tiny a (gamma - 1 loses digits) and huge a (gamma^2 overflows
// nowhere near doubles' range) stay accurate: acosh(1+u) = log1p(u + sqrt(u(u+2))).
import { C, YEAR, G0 } from './constants.js';
import { STARS } from '../data/stars.js';

// 1 g in ly/yr^2 (= G0 * YEAR / C, about 1.0323).
export const G_LY_YR2 = G0 * YEAR / C;

// Targets: the two nearest stars from js/data/stars.js (parallax distances, light-years).
export const TARGETS = ['Proxima Centauri', "Barnard's Star"].map((name) => {
  const s = STARS.find((x) => x.name === name);
  if (!s) throw new Error('star missing in js/data/stars.js: ' + name);
  return { id: name === 'Proxima Centauri' ? 'proxima' : 'barnard', en: s.name, ru: s.ru, ly: s.ly };
});

// Acceleration slider range, in g, log scale.
export const ACCEL_MIN_G = 0.01;
export const ACCEL_MAX_G = 10;

function checkNum(v, name, unit) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new RangeError(name + ' must be a finite number > 0 (' + unit + ')');
  }
}
function checkFinite(v, name) {
  if (!Number.isFinite(v)) throw new RangeError(name + ' is not representable (overflow)');
  return v;
}

// One accelerating leg from rest over distance x (ly) at proper acceleration accelG (g).
export function accelSegment({ accelG, x } = {}) {
  checkNum(accelG, 'accelG', 'g');
  checkNum(x, 'x', 'ly');
  const a = accelG * G_LY_YR2;
  const u = a * x;
  const root = Math.sqrt(u * (u + 2)); // = sqrt(gamma^2 - 1) = gamma * beta
  const gamma = 1 + u;
  const out = {
    gamma: checkFinite(gamma, 'gamma'),
    beta: root / gamma,
    tau: checkFinite(Math.log1p(u + root) / a, 'tau'), // years, ship clock
    t: checkFinite(root / a, 't'),                       // years, Earth-frame clock
  };
  // beta in floating point can round to exactly 1 only for astronomically large u: keep it < 1.
  if (out.beta >= 1) out.beta = 1 - Number.EPSILON / 2;
  return out;
}

function profile(kind, seg, segments, d, accelG) {
  const t = segments * seg.t, tau = segments * seg.tau;
  return {
    kind, accelG, d,
    t,                    // Earth-frame (coordinate) trip time, years
    tau,                  // ship (proper) trip time, years
    peakBeta: seg.beta,
    peakGamma: seg.gamma,
    arrivalBeta: kind === 'flyby' ? seg.beta : 0,
    peakAtT: seg.t,       // Earth-frame time at which the peak speed is reached
  };
}

// Accelerate over the first half of the distance, turn over, brake over the second half.
export function flipAndBurn({ accelG, d } = {}) {
  checkNum(d, 'd', 'ly');
  return profile('flip', accelSegment({ accelG, x: d / 2 }), 2, d, accelG);
}

// Accelerate the whole way, no braking: maximum speed at the finish.
export function flyby({ accelG, d } = {}) {
  checkNum(d, 'd', 'ly');
  return profile('flyby', accelSegment({ accelG, x: d }), 1, d, accelG);
}

// Both profiles for one (a, d).
export function tripState({ accelG, d } = {}) {
  return { flip: flipAndBurn({ accelG, d }), flyby: flyby({ accelG, d }) };
}

// beta at Earth-frame time t (years) along a profile; 0 outside [0, trip.t]. beta = a t / sqrt(1 + (a t)^2).
export function betaAt(trip, t) {
  if (typeof t !== 'number' || !Number.isFinite(t)) throw new RangeError('t must be finite');
  if (t < 0 || t > trip.t) return 0;
  const a = trip.accelG * G_LY_YR2;
  const s = trip.kind === 'flip' && t > trip.t / 2 ? trip.t - t : t;
  const w = a * s;
  return w / Math.sqrt(1 + w * w);
}

// n+1 samples of (t, beta) over the whole trip, for the chart.
export function sampleBeta(trip, n = 200) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = trip.t * i / n; pts.push({ t, beta: betaAt(trip, t) }); }
  return pts;
}

// Log slider helpers: s in [0, 1000] <-> accelG in [ACCEL_MIN_G, ACCEL_MAX_G].
export function accelFromSlider(s) {
  if (!Number.isFinite(s)) throw new RangeError('slider must be finite');
  const f = Math.min(1, Math.max(0, s / 1000));
  return ACCEL_MIN_G * Math.pow(ACCEL_MAX_G / ACCEL_MIN_G, f);
}
export function sliderFromAccel(g) {
  checkNum(g, 'accelG', 'g');
  return Math.min(1000, Math.max(0, 1000 * Math.log(g / ACCEL_MIN_G) / Math.log(ACCEL_MAX_G / ACCEL_MIN_G)));
}
