// Laser light sail to the nearest star: relativistic flight under a ground-based laser, with a
// diffraction-limited beam range and a Newtonian comparison next to it.
// Pure functions, SI units; no DOM, no state. Flat special relativity along one axis, no gravity.
//
// Physics (Earth frame, laser at the SOURCE, sail receding at beta = v/c, w = gamma*beta):
//   In the sail's instantaneous rest frame the plane wave has intensity P' = P * (1 - beta)/(1 + beta)
//   (Doppler factor squared: photon energy and photon arrival rate are each reduced by sqrt((1-beta)/(1+beta))).
//   A perfect mirror (R = 1) at rest feels F' = 2 P'/c. A force along the motion on a body momentarily at rest
//   in the primed frame is the same in the Earth frame (F_parallel is invariant), so
//        F = (2 P eta / c) * (1 - beta)/(1 + beta)
//   It equals 2P/c at rest and tends to zero as beta -> 1: the sail outruns the light.
//   Textbook result (Einstein 1905; Marx 1966; Forward 1984; Kulkarni et al. 2018 for the sail case).
//
// Dynamics: d(gamma m v)/dt = F with constant rest mass m  =>  p = m c w, so
//        dw/dt = F / (m c),   beta = w/sqrt(1 + w^2) < 1 always.
//   Proper acceleration (felt by the craft): a_proper = gamma^3 * c * d(beta)/dt = c * dw/dt = F/m
//   (since d(beta)/dw = (1 + w^2)^(-3/2) = gamma^-3).  In g it is a_proper / G0.
//   Time of the craft: d(tau)/dt = 1/gamma.  Position: dx/dt = c beta.
//
// Beam range (diffraction-limited spot equals the sail):  L = D_tx * D_sail / (2.44 * lambda),
//   D_sail = sqrt(4 A / pi). The beam is on while x < L (Earth frame), then the craft coasts at constant beta.
//   If L >= distance to the star the laser never switches off: the craft only accelerates until it arrives.
//
// Integration: RK4 on (w, x, tau) over Earth time with geometrically growing step h = FRAC * (t + t0) —
// deterministic, ~4000 steps; the end of the beam (x = L or the star) is hit exactly by bisection on the last step.
import { C, G0, LY, YEAR } from './constants.js';
import { STARS } from '../data/stars.js';

export { C, G0, LY, YEAR };

// ---- model constants (assumptions are stated on the page) ----
export const PROXIMA = STARS.find((s) => s.name === 'Proxima Centauri');
export const D_PROXIMA = PROXIMA.ly * LY;       // m
export const WAVELENGTH = 1064e-9;              // m — Nd:YAG / fibre-laser line; Breakthrough Starshot proposed 1.06 um (Parkin 2018, arXiv:1805.01306)
export const TX_APERTURE = 1000;                // m — transmitter aperture, 1 km (Starshot baseline: a 1 km phased array)
export const AIRY = 2.44;                       // first Airy zero 1.22 * 2: spot diameter = 2.44 lambda L / D
export const AREAL_DENSITY = 1e-3;              // kg/m^2 — sail areal density sigma = 1 g/m^2 (assumption; Starshot targets ~1 g/m^2 class meta-materials)
export const REFLECTIVITY = 1;                  // R = 1, ideal mirror (assumption; real dielectric sails ~0.99+)
export const ETA = 1;                           // coupling / beam-pointing efficiency (assumption)
export const HEAT_LIMIT = 1e9;                  // W/m^2 — assumed thermal tolerance of the sail (assumption; flag only, not a refusal)
export const RELATIVISTIC_BETA = 0.1;           // above this the Newtonian estimate is flagged inaccurate
export const BETA_MAX = 1 - Number.EPSILON;     // guard: beta is strictly below 1 even if w overflows the float mantissa
export const FRAC = 0.004;                      // RK4 step as a fraction of elapsed time
const MAX_STEPS = 400000;
const SAMPLE_RATIO = 1.06;                      // profile samples are log-spaced in time

const okNum = (v) => typeof v === 'number' && Number.isFinite(v);
const need = (v, name, strict) => {
  if (!okNum(v) || (strict ? v <= 0 : v < 0)) throw new RangeError(name + ' must be a finite number ' + (strict ? '> 0' : '>= 0'));
};

// beta from w = gamma*beta, strictly < 1
export const betaOfW = (w) => Math.min(w / Math.hypot(1, w), BETA_MAX);
export const gammaOfW = (w) => Math.hypot(1, w);

// (1 - beta)/(1 + beta) written through w:  exp(-2 asinh w) = (gamma - w)^2  (no cancellation near beta -> 1)
export const dopplerFactor = (w) => Math.exp(-2 * Math.asinh(w));

// Force on an ideal reflecting sail at speed beta (Earth frame, laser at the source).
export function sailForce(P, beta, eta = ETA, doppler = true) {
  need(P, 'power');
  if (!(okNum(beta) && beta >= 0 && beta < 1)) throw new RangeError('beta must be in [0, 1)');
  return 2 * P * eta * REFLECTIVITY / C * (doppler ? (1 - beta) / (1 + beta) : 1);
}

export const sailMass = (payload, area) => { need(payload, 'payload', true); need(area, 'area'); return payload + AREAL_DENSITY * area; };
export const sailDiameter = (area) => { need(area, 'area'); return Math.sqrt(4 * area / Math.PI); };
export function beamLength(area, aperture = TX_APERTURE, lambda = WAVELENGTH) {
  need(aperture, 'aperture', true); need(lambda, 'wavelength', true);
  return aperture * sailDiameter(area) / (AIRY * lambda);
}

// Newtonian reference: constant F = 2 P eta / c (no Doppler, no gamma), v = a t over the same beam range.
export function newtonianFlight(m, F, Lbeam, D) {
  const Xend = Math.min(Lbeam, D);
  if (!(F > 0) || !(Xend > 0)) return { aBeam: F > 0 ? F / m : 0, tBeam: Infinity, vBeam: 0, betaBeam: 0, tFlight: Infinity, noFlight: true };
  const a = F / m, tBeam = Math.sqrt(2 * Xend / a), vBeam = a * tBeam;
  const tFlight = tBeam + (D > Xend ? (D - Xend) / vBeam : 0);
  return { aBeam: a, tBeam, vBeam, betaBeam: vBeam / C, tFlight, noFlight: false };
}

/**
 * Fly a laser sail to a star.
 * @param {{payload:number, power:number, area:number}} p  kg, W (emitted by the laser), m^2
 * @param {{distance?:number, eta?:number, aperture?:number, wavelength?:number, doppler?:boolean,
 *          beamLength?:number, heatLimit?:number}} [o]  doppler:false = constant-force reference (tests);
 *          beamLength overrides the diffraction range (tests)
 */
export function launch({ payload, power, area }, o = {}) {
  need(payload, 'payload', true); need(power, 'power'); need(area, 'area');
  const D = o.distance ?? D_PROXIMA, eta = o.eta ?? ETA, doppler = o.doppler ?? true, heatLimit = o.heatLimit ?? HEAT_LIMIT;
  need(D, 'distance', true); need(eta, 'eta');
  const m = payload + AREAL_DENSITY * area;
  const Lbeam = o.beamLength ?? beamLength(area, o.aperture, o.wavelength);
  const F0 = 2 * power * eta * REFLECTIVITY / C;
  const flags = [];
  const intensity = area > 0 ? power / area : Infinity;
  const overheat = power > 0 && intensity > heatLimit;
  if (overheat) flags.push('overheat');
  const newt = newtonianFlight(m, F0, Lbeam, D);

  const base = {
    payload, power, area, mass: m, distance: D, beamLength: Lbeam, sailDiameter: sailDiameter(area),
    beamNeverStops: Lbeam >= D, intensity, overheat, heatLimit, F0, aProper0: F0 / m, gPeak: F0 / m / G0,
    newtonian: { ...newt, exceedsC: newt.betaBeam >= 1 },
  };
  const stalled = !(F0 > 0) || !(Lbeam > 0);
  // Newtonian time scale of the beam phase: the first-step scale t0
  const Xend = Math.min(Lbeam, D);
  const t0 = stalled ? 0 : 1e-3 * Math.sqrt(2 * Xend * m / F0);
  if (stalled || !(t0 > 0) || !Number.isFinite(t0)) {
    flags.push('noFlight');
    return { ...base, flights: false, tBeam: 0, xBeam: 0, wMax: 0, betaMax: 0, gammaMax: 1, gEnd: 0,
      tFlight: Infinity, tau: Infinity, flags, relativistic: false, timeDiffPct: null, dilation: 1,
      profile: [{ t: 0, beta: 0, w: 0, x: 0, tau: 0, g: F0 / m / G0 }] };
  }

  const dop = (w) => (doppler ? dopplerFactor(w) : 1);
  // state y = [w, x, tau]; autonomous in time
  const f = (y) => { const w = y[0], g = Math.hypot(1, w);
    return [F0 * dop(w) / (m * C), C * betaOfW(w), 1 / g]; };
  const step = (y, h) => {
    const k1 = f(y);
    const k2 = f([y[0] + h / 2 * k1[0], y[1] + h / 2 * k1[1], y[2] + h / 2 * k1[2]]);
    const k3 = f([y[0] + h / 2 * k2[0], y[1] + h / 2 * k2[1], y[2] + h / 2 * k2[2]]);
    const k4 = f([y[0] + h * k3[0], y[1] + h * k3[1], y[2] + h * k3[2]]);
    return [0, 1, 2].map((i) => y[i] + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  };
  const pt = (t, y) => ({ t, beta: betaOfW(y[0]), w: y[0], x: y[1], tau: y[2], g: F0 * dop(y[0]) / m / G0 });

  let t = 0, y = [0, 0, 0];
  const profile = [pt(0, y)];
  let nextSample = t0;
  let steps = 0;
  while (y[1] < Xend) {
    if (++steps > MAX_STEPS) throw new Error('lasersail: step budget exceeded');
    const h = FRAC * (t + t0);
    let y2 = step(y, h);
    if (y2[1] >= Xend) {
      // hit x = Xend exactly: bisection on the sub-step (x is monotone in h)
      let lo = 0, hi = h;
      for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (step(y, mid)[1] < Xend) lo = mid; else hi = mid; }
      const hh = (lo + hi) / 2;
      y2 = step(y, hh); y2[1] = Xend;
      t += hh; y = y2;
      break;
    }
    t += h; y = y2;
    if (t >= nextSample) { profile.push(pt(t, y)); nextSample = t * SAMPLE_RATIO; }
  }
  const tBeam = t;
  const wMax = y[0], beta = betaOfW(wMax), gamma = gammaOfW(wMax);
  const endPt = pt(tBeam, y);
  profile.push(endPt);
  let tFlight = tBeam, tau = y[2];
  if (D > Xend) {
    // beam off: coast at constant beta
    const dt = (D - Xend) / (C * beta);
    tFlight += dt; tau += dt / gamma;
    profile.push({ t: tFlight, beta, w: wMax, x: D, tau, g: 0 });
  }
  if (!Number.isFinite(tFlight) || !Number.isFinite(tau)) { tFlight = Infinity; tau = Infinity; flags.push('noFlight'); }
  const relativistic = beta > RELATIVISTIC_BETA;
  if (relativistic) flags.push('relativistic');
  if (Lbeam >= D) flags.push('beamNeverStops');
  if (newt.betaBeam >= 1) flags.push('newtonExceedsC');
  const timeDiffPct = Number.isFinite(tFlight) && Number.isFinite(newt.tFlight) && newt.tFlight > 0
    ? 100 * (tFlight - newt.tFlight) / newt.tFlight : null;
  return {
    ...base, flights: Number.isFinite(tFlight), tBeam, xBeam: Xend, wMax, betaMax: beta, gammaMax: gamma,
    gEnd: endPt.g, tFlight, tau, flags, relativistic, timeDiffPct,
    dilation: Number.isFinite(tFlight) && tFlight > 0 ? tau / tFlight : 1, profile, steps,
  };
}
