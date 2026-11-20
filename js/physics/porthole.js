// "View from the porthole": the pilot's sky at relativistic speed. Pure maths, no DOM, no THREE.
// The ship sits at the Sun (parallax / distances are ignored: only DIRECTIONS and light are transformed)
// and flies at speed beta = v/c straight towards a target direction (a catalogue star or an (RA, Dec)).
// Angles are measured from the FLIGHT direction, in the rest frame (theta) and in the ship frame (thetaP):
//   cos(thetaP) = (cos(theta) + beta) / (1 + beta cos(theta))     stars slide FORWARD (thetaP <= theta)
//   D = 1 / (gamma (1 - beta cos(theta)))                          Doppler factor, ship-frame f / rest-frame f
//   T' = D T                                                       colour temperature (blackbody approximation)
//   dm = -2.5 log10(D^4)                                           bolometric-flux approximation (see HONESTY below)
// SIGN NOTE: relativity.js aberratedCos(cp, beta) = (cp - beta)/(1 - beta cp) is the INVERSE map (ship -> rest);
// it is used here only to verify the round trip (tests), the forward map is written below. relativity.js is untouched.
// Projection: azimuthal equidistant about the VIEW axis (forward = flight direction, backward = its opposite):
// screen radius = the ship-frame angle from the view axis, the position angle about the axis is preserved.
// HONESTY: effective temperatures come from a coarse spectral-class table ("approximate"); the brightness shift is the
// bolometric D^4 law for a point source, not a band-pass (V) calculation, so real stars would shift in colour/band
// differently; no stellar proper motion, no light-travel-time, no relativistic beaming of extended objects.
import { C } from './constants.js';
import { gammaFromV } from './relativity.js';
import { NEIGHBORS } from '../data/neighbors.js';

const DEG = Math.PI / 180;
export const DEFAULT_TARGET = 'proxima';
export const BETA_MAX = 0.999999;

function checkBeta(beta) {
  if (typeof beta !== 'number' || !Number.isFinite(beta) || beta < 0 || beta >= 1) {
    throw new RangeError('beta must be in [0, 1)');
  }
}

export function gammaOfBeta(beta) { checkBeta(beta); return gammaFromV(beta * C); }

// Unit vector of an equatorial direction (degrees).
export function unitFromRaDec(raDeg, decDeg) {
  const a = raDeg * DEG, d = decDeg * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// Angle between two unit vectors (stable at 0 and pi).
export function angleBetween(a, b) { return Math.atan2(norm(cross(a, b)), dot(a, b)); }

// Ship-frame cosine for a rest-frame cosine (stars slide forward).
export function cosAberrated(cosTheta, beta) {
  checkBeta(beta);
  const v = (cosTheta + beta) / (1 + beta * cosTheta);
  return Math.max(-1, Math.min(1, v));
}

// Ship-frame angle for a rest-frame angle, both from the flight direction (radians). Half-angle form,
// tan(thetaP/2) = sqrt((1-beta)/(1+beta)) tan(theta/2), identical to cosAberrated but stable near 0 and pi.
export function aberratedAngle(theta, beta) {
  checkBeta(beta);
  const k = Math.sqrt((1 - beta) / (1 + beta));
  return 2 * Math.atan2(k * Math.sin(theta / 2), Math.cos(theta / 2));
}

// Doppler factor of light arriving from rest-frame angle theta (from the flight direction).
export function dopplerOfAngle(theta, beta) {
  checkBeta(beta);
  return 1 / (gammaFromV(beta * C) * (1 - beta * Math.cos(theta)));
}

// Brightness shift in magnitudes (negative = brighter), bolometric D^4 approximation.
export function magShift(D) { return -10 * Math.log10(D); }

// Coarse effective temperature (K) from a spectral type string such as 'M5.5Ve', 'sdM1', 'DA2', 'T6'. APPROXIMATE.
const T_CLASS = { O: 35000, B: 20000, A: 9500, F: 6700, G: 5600, K: 4500, D: 8000 };
export function teffOfSpectral(spectral) {
  const m = /^(?:sd)?([OBAFGKMLTYD])\s*(\d+(?:\.\d+)?)?/.exec(String(spectral || ''));
  if (!m) return NaN;
  const sub = m[2] === undefined ? 5 : parseFloat(m[2]);
  switch (m[1]) {
    case 'M': return 3800 - 160 * sub;      // M0 ~3800 K ... M9 ~2400 K
    case 'L': return 2400 - 100 * sub;      // L0 ~2400 K ... L9 ~1500 K
    case 'T': return 1300 - 90 * sub;       // T0 ~1300 K ... T9 ~500 K
    case 'Y': return 400;
    case 'K': return 5100 - 120 * sub;      // K0 ~5100 K ... K9 ~4000 K
    default: return T_CLASS[m[1]];
  }
}

// Flight direction: a catalogue star id, or {ra, dec} in degrees. Returns {unit, ra, dec, label}.
export function resolveTarget(target = DEFAULT_TARGET, stars = NEIGHBORS) {
  if (target && typeof target === 'object') {
    if (!Number.isFinite(target.ra) || !Number.isFinite(target.dec)) throw new RangeError('target needs finite ra, dec');
    return { unit: unitFromRaDec(target.ra, target.dec), ra: target.ra, dec: target.dec, id: null };
  }
  const s = stars.find((x) => x.id === target);
  if (!s) throw new RangeError('unknown target star: ' + target);
  return { unit: unitFromRaDec(s.ra, s.dec), ra: s.ra, dec: s.dec, id: s.id };
}

// Orthonormal screen basis for a view axis: up = celestial north projected on the plane, right = axis x up.
function screenBasis(axis) {
  let up = [-axis[2] * axis[0], -axis[2] * axis[1], 1 - axis[2] * axis[2]];
  if (norm(up) < 1e-9) up = [1, 0, 0]; // looking at a celestial pole: arbitrary but fixed
  up = scale(up, 1 / norm(up));
  if (Math.abs(dot(up, axis)) > 1e-9) { const k = dot(up, axis); up = [up[0] - k * axis[0], up[1] - k * axis[1], up[2] - k * axis[2]]; up = scale(up, 1 / norm(up)); }
  return { up, right: cross(axis, up) };
}

// Transform one star. flight = unit vector of the flight direction; mode = 'forward' | 'backward' (look aft).
export function transformStar(star, flight, beta, mode = 'forward') {
  checkBeta(beta);
  const dir = unitFromRaDec(star.ra, star.dec);
  const theta = angleBetween(dir, flight);
  const thetaP = aberratedAngle(theta, beta);
  const D = dopplerOfAngle(theta, beta);
  const T = teffOfSpectral(star.spectral);
  const back = mode === 'backward';
  const axis = back ? scale(flight, -1) : flight;
  const phi = back ? Math.PI - thetaP : thetaP;            // angle from the VIEW axis, ship frame
  const phi0 = back ? Math.PI - theta : theta;             // same, rest frame
  const { up, right } = screenBasis(axis);
  const px = dot(dir, right), py = dot(dir, up);
  const pr = Math.hypot(px, py);
  const psi = pr < 1e-12 ? 0 : Math.atan2(py, px);          // position angle, preserved
  const mag = star.vmag === null || star.vmag === undefined ? null : star.vmag + magShift(D);
  return {
    id: star.id, name: star.name, ru: star.ru,
    theta, thetaP, D, T, Tp: D * T, dMag: magShift(D), mag, vmag: star.vmag ?? null,
    phi0, phi, x: phi * Math.cos(psi), y: phi * Math.sin(psi), psi,
  };
}

// Whole sky: {beta, gamma, mode, target, stars:[transformed]}.
export function skyView({ beta = 0, target = DEFAULT_TARGET, mode = 'forward', stars = NEIGHBORS } = {}) {
  checkBeta(beta);
  if (mode !== 'forward' && mode !== 'backward') throw new RangeError("mode must be 'forward' or 'backward'");
  const tgt = resolveTarget(target, stars);
  return {
    beta, gamma: gammaFromV(beta * C), mode, target: tgt,
    stars: stars.map((s) => transformStar(s, tgt.unit, beta, mode)),
  };
}

// Slider (0..1) -> beta on a log-like scale in (1 - beta), so 0.9 / 0.99 / 0.999 are all reachable (about 0.9 at u=0.22, 0.99 at 0.44, 0.999 at 0.67).
export function betaFromSlider(u, maxNines = 4.5) {
  if (!Number.isFinite(u)) return 0;
  const x = Math.min(1, Math.max(0, u));
  const b = 1 - Math.pow(10, -maxNines * x); // 0 -> 0, 1 -> 1 - 10^-4.5
  return Math.min(BETA_MAX, Math.max(0, b));
}
export function sliderFromBeta(beta, maxNines = 4.5) {
  checkBeta(beta);
  return Math.min(1, Math.max(0, -Math.log10(1 - beta) / maxNines));
}
