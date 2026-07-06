// Special-relativistic kinematics. We integrate in the solar-system rest frame
// using "specific momentum" w = gamma * v (a.k.a. proper velocity / celerity),
// which makes the dynamics clean and keeps |v| < c automatically:
//
//   gamma = sqrt(1 + |w|^2 / c^2)        (exact, vector form)
//   v     = w / gamma
//   dw/dt = a_total   (specific force: gravity + thrust + drag)
//   dx/dt = v
//   dtau  = dt / gamma                   (proper time aboard the ship)
//
// Gravity is treated Newtonian (no GR) — standard and adequate for a sim.
import { C, C2 } from './constants.js';

export function gammaFromW(w) {
  return Math.sqrt(1 + w.lengthSq() / C2);
}

export function gammaFromV(speed) {
  const b = speed / C;
  return 1 / Math.sqrt(Math.max(1e-300, 1 - b * b));
}

// Coordinate velocity from specific momentum, written into `out`.
export function velocityFromW(w, out) {
  const g = gammaFromW(w);
  return out.copy(w).multiplyScalar(1 / g);
}

// Specific momentum w = gamma * v from a coordinate velocity, written into
// `out`. The exact inverse of velocityFromW — use it whenever the ship's
// velocity is set directly (spawn, brake-match, touchdown) so w stays the true
// proper velocity, not a low-speed approximation. (gamma ~= 1 below ~0.01c, so
// for the body-matched speeds in this sim the correction is tiny but exact.)
export function momentumFromV(v, out) {
  const g = gammaFromV(v.length());
  return out.copy(v).multiplyScalar(g);
}

// Relativistic Doppler factor for light from a source, given the component of
// closing speed along the line of sight (vRadial > 0 = approaching).
// Returned factor multiplies observed frequency (>1 blueshift, <1 redshift).
export function dopplerFactor(vRadial) {
  const b = Math.max(-0.999999999, Math.min(0.999999999, vRadial / C));
  return Math.sqrt((1 + b) / (1 - b));
}

// Relativistic aberration of light — maps a ship-frame cosine cosThetaPrime to
// the rest-frame cosine, given the closing speed fraction beta. Pure (three-free)
// so it runs under node tests as the mirror of the shader aberration.
// GLSL mirror in js/render/relativisticPass.js — keep byte-identical: (cp - beta)/(1.0 - beta*cp)
export function aberratedCos(cosThetaPrime, beta) {
  return (cosThetaPrime - beta) / (1 - beta * cosThetaPrime);
}

// Tsiolkovsky (relativistic) — final speed for a given mass ratio and exhaust
// velocity ve. Used to show remaining delta-v budget in finite-fuel mode.
export function relativisticDeltaV(massRatio, ve) {
  // v/c = tanh( (ve/c) * ln(massRatio) )
  return C * Math.tanh((ve / C) * Math.log(massRatio));
}
