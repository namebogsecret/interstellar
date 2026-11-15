// "Check it yourself" — live verification logic for physics-verification.html.
//
// Pure functions, NO DOM. Each check runs the REAL simulator modules
// (relativity.js, gravity.js, orbits.js, ship.js) on user-chosen inputs and
// compares the result with a closed-form analytic value written independently
// here. Output shape (the contract tests/verify-live.test.mjs locks):
//
//   { id, valid, reason?, rows:[{ key, sim, analytic, relErr, tol, pass }], pass }
//
// Invalid / degenerate input is REFUSED (valid:false, reason, rows:[]) — a row
// never carries NaN/Infinity. What this proves: the implementation matches the
// textbook formula. It does NOT prove the formula describes the real world.
import * as THREE from 'three';
import { C, G0 } from '../physics/constants.js';
import { gammaFromV, dopplerFactor, aberratedCos } from '../physics/relativity.js';
import { gravityAccel } from '../physics/gravity.js';
import { circularizeVelocity, orbitFromState, propagateUniversal } from '../physics/orbits.js';
import { Ship } from '../physics/ship.js';

// Tolerances, each with the reason it is that size (shown on the page).
export const TOL = {
  closedForm: {
    value: 1e-9,
    why: 'Both sides are double-precision closed forms; rounding is ~1e-16, amplified to ~5e-12 (measured) by the 1-beta^2 cancellation at the edge of the allowed beta range. 1e-9 leaves a >100x margin.',
  },
  orbit: {
    value: 1e-9,
    why: 'Measured error on circular orbits is ~1e-16; the universal-variable Newton iteration stops at ~1e-12 and the period is recovered from a swept angle (acos costs a few digits). 1e-9 keeps 3+ digits of headroom without hiding a real defect.',
  },
  integrated: {
    value: 1e-3,
    why: 'Proper time is accumulated by the ship integrator step by step (first-order in dt), so it is an integration error, not rounding. 1e-3 on 20000 geometric steps (measured error ~2e-4); gamma itself is exact in w-space and is held to 1e-9.',
  },
  gravity: {
    value: 1e-12,
    why: 'Single division and square root in double precision; 1e-12 is ~4 orders above rounding.',
  },
};

const BETA_MAX = 1 - 1e-6;      // beyond this 1-beta^2 < 2e-6 and double rounding eats the margin
const TAU_OVER_C_MAX = 20;      // a*tau/c <= 20 -> gamma <= ~2.4e8, w stays far from overflow
const STEPS = 20000;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// Pure comparator. relErr = |sim-analytic| / max(|analytic|, floor). `floor`
// turns it into an absolute error for bounded quantities near zero (cosines).
export function verdict(sim, analytic, tol, floor = 0) {
  if (!isNum(sim) || !isNum(analytic) || !isNum(tol)) return { relErr: NaN, pass: false };
  const denom = Math.max(Math.abs(analytic), floor);
  const err = Math.abs(sim - analytic);
  const relErr = denom > 0 ? err / denom : (err === 0 ? 0 : Infinity);
  return { relErr, pass: relErr <= tol };
}

const refuse = (id, reason) => ({ id, valid: false, reason, rows: [], pass: false });

// Build a row; `perturb` is a test seam (mutation check) applied to the sim value.
function makeRow(key, sim, analytic, tol, floor, perturb) {
  const s = perturb ? perturb(key, sim) : sim;
  const v = verdict(s, analytic, tol, floor);
  return { key, sim: s, analytic, relErr: v.relErr, tol, pass: v.pass };
}

// Final guard: a check whose rows came out non-finite is refused, never shown.
function finish(id, rows) {
  const clean = rows.every((r) => isNum(r.sim) && isNum(r.analytic) && isNum(r.relErr) && isNum(r.tol));
  if (!clean) return refuse(id, 'result not finite for these inputs (numerical range exceeded)');
  return { id, valid: true, rows, pass: rows.every((r) => r.pass) };
}

// ── 1a. gamma(beta) and time dilation ─────────────────────────────────────────
export function checkGammaBeta(input, hooks = {}) {
  const id = 'gamma';
  const beta = input && input.beta;
  if (!isNum(beta) || beta < 0 || beta > BETA_MAX) {
    return refuse(id, `beta must be a number in [0, ${BETA_MAX}] (beyond it double precision cannot resolve 1-beta^2)`);
  }
  const t = TOL.closedForm.value;
  const sim = gammaFromV(beta * C);
  const analytic = 1 / Math.sqrt((1 - beta) * (1 + beta));
  return finish(id, [
    makeRow('gamma', sim, analytic, t, 0, hooks.perturb),
    // time dilation: proper seconds per coordinate second = 1/gamma = sqrt(1-beta^2)
    makeRow('dilation', 1 / sim, Math.sqrt((1 - beta) * (1 + beta)), t, 0, hooks.perturb),
  ]);
}

// ── 1b. constant proper acceleration (hyperbolic motion), run on the real Ship ─
// Input: a in g, proper time tau in seconds. Analytic: gamma = cosh(a*tau/c),
// coordinate time T = (c/a) sinh(a*tau/c) (used only to say how long to burn).
export function checkConstantAccel(input, hooks = {}) {
  const id = 'accel';
  const aG = input && input.aG;
  const tauS = input && input.tauS;
  const ship0 = new Ship();
  const aMax = ship0.maxAccelArcade;
  if (!isNum(aG) || aG <= 0 || aG * G0 > aMax) return refuse(id, 'a must be in (0, 1000] g (the simulator arcade maximum)');
  if (!isNum(tauS) || tauS <= 0) return refuse(id, 'proper time tau must be > 0 seconds');
  const a = aG * G0;
  const x = (a * tauS) / C;
  if (!(x <= TAU_OVER_C_MAX)) return refuse(id, `a*tau/c must be <= ${TAU_OVER_C_MAX} (gamma beyond ~2e8 is out of numeric range)`);

  const T = (C / a) * Math.sinh(x);           // coordinate time to burn
  const ship = ship0;
  ship.mode = 'arcade';
  ship.throttle = a / aMax;
  const dir = new THREE.Vector3(1, 0, 0);
  const none = new Map();
  // Geometric time grid: gamma changes fastest early, so refine there.
  const t1 = Math.min(T, (C / a) * 1e-4);
  const ratio = T > t1 ? Math.pow(T / t1, 1 / (STEPS - 1)) : 1;
  let tPrev = 0;
  for (let k = 0; k < STEPS; k++) {
    const tk = k === 0 ? t1 : (k === STEPS - 1 ? T : tPrev * ratio);
    const dt = tk - tPrev;
    if (dt > 0) ship.step(dt, [], none, dir);
    tPrev = tk;
  }
  const analyticGamma = Math.cosh(x);
  return finish(id, [
    makeRow('gamma', ship.gamma, analyticGamma, TOL.closedForm.value, 0, hooks.perturb),
    makeRow('properTime', ship.properTime, tauS, TOL.integrated.value, 0, hooks.perturb),
  ]);
}

// ── 2. circular orbit ─────────────────────────────────────────────────────────
// Input: radius r (m), mu = GM (m^3/s^2).
export function checkCircularOrbit(input, hooks = {}) {
  const id = 'orbit';
  const r = input && input.r;
  const mu = input && input.mu;
  if (!isNum(mu) || mu <= 0) return refuse(id, 'mu (GM) must be a positive number');
  if (!isNum(r) || r < 1) return refuse(id, 'radius must be a finite number >= 1 m');

  const rVec = new THREE.Vector3(r, 0, 0);
  // Start from a deliberately NON-circular velocity (30% too fast, tilted) so
  // circularizeVelocity has real work to do and the plane is not trivial.
  const vTilt = new THREE.Vector3(0, 1, 0.3).normalize().multiplyScalar(1.3 * Math.sqrt(mu / r));
  const vc = circularizeVelocity(mu, rVec, vTilt, new THREE.Vector3());
  const vAn = Math.sqrt(mu / r);
  const aAn = r;
  const TAn = 2 * Math.PI * Math.sqrt((r * r * r) / mu);

  const el = orbitFromState(mu, rVec, vc);

  // Period measured by the universal propagator: advance a quarter analytic
  // period, read the swept angle, scale to a full turn.
  const dt = TAn / 4;
  const rOut = new THREE.Vector3();
  const vOut = new THREE.Vector3();
  const ok = propagateUniversal(mu, rVec, vc, dt, rOut, vOut);
  if (!ok) return refuse(id, 'propagator did not converge for these inputs');
  const cosA = rVec.dot(rOut) / (r * rOut.length());
  const theta = Math.acos(Math.max(-1, Math.min(1, cosA)));
  if (!(theta > 0)) return refuse(id, 'swept angle degenerate for these inputs');
  const TSim = (2 * Math.PI * dt) / theta;

  return finish(id, [
    makeRow('speed', vc.length(), vAn, TOL.closedForm.value, 0, hooks.perturb),
    makeRow('semiMajor', el.a, aAn, TOL.orbit.value, 0, hooks.perturb),
    makeRow('period', TSim, TAn, TOL.orbit.value, 0, hooks.perturb),
  ]);
}

// ── 3. Doppler + aberration ───────────────────────────────────────────────────
// Analytic side = Lorentz boost of a photon 4-vector (E, px, py) = (1, cos, sin),
// boost velocity beta along +x: E' = g(E - b px), px' = g(px - b E).
//  - Doppler (head-on photon, cos = -1): E'/E = sqrt((1+b)/(1-b)), beta>0 = approaching.
//  - Aberration: cos' = px'/E'.
export function checkDopplerAberration(input, hooks = {}) {
  const id = 'doppler';
  const beta = input && input.beta;
  const cosT = input && input.cosTheta;
  if (!isNum(beta) || Math.abs(beta) > BETA_MAX) return refuse(id, `beta must be a number with |beta| <= ${BETA_MAX}`);
  if (!isNum(cosT) || cosT < -1 || cosT > 1) return refuse(id, 'cos(theta) must be a number in [-1, 1]');

  const g = 1 / Math.sqrt((1 - beta) * (1 + beta));
  const eHeadOn = g * (1 + beta);                 // photon (1,-1,0) boosted
  const eP = g * (1 - beta * cosT);
  const pxP = g * (cosT - beta);
  return finish(id, [
    makeRow('doppler', dopplerFactor(beta * C), eHeadOn, TOL.closedForm.value, 0, hooks.perturb),
    // cosines are bounded in [-1,1]: floor 1 makes this an absolute error
    makeRow('aberration', aberratedCos(cosT, beta), pxP / eP, TOL.closedForm.value, 1, hooks.perturb),
  ]);
}

// ── 4. Newtonian gravity magnitude + direction ────────────────────────────────
export function checkGravityAccel(input, hooks = {}) {
  const id = 'gravity';
  const mu = input && input.mu;
  const r = input && input.r;
  if (!isNum(mu) || mu <= 0) return refuse(id, 'mu (GM) must be a positive number');
  if (!isNum(r) || r < 1) return refuse(id, 'distance must be a finite number >= 1 m');
  const body = { name: 'X', GM: mu, radius: 0 };
  const shipPos = new THREE.Vector3(r * 0.6, r * 0.8, 0);       // |pos| = r, off-axis on purpose
  const positions = new Map([['X', new THREE.Vector3(0, 0, 0)]]);
  const acc = gravityAccel(shipPos, [body], positions, new THREE.Vector3());
  const toward = shipPos.clone().multiplyScalar(-1 / r);
  return finish(id, [
    makeRow('magnitude', acc.length(), mu / (r * r), TOL.gravity.value, 0, hooks.perturb),
    makeRow('direction', acc.dot(toward) / acc.length(), 1, TOL.gravity.value, 0, hooks.perturb),
  ]);
}

// Presets: first entry of each list is the default; all must PASS (locked by tests).
export const PRESETS = {
  gamma: [
    { id: 'beta-0p5', input: { beta: 0.5 } },
    { id: 'beta-0p99', input: { beta: 0.99 } },
    { id: 'beta-near-1', input: { beta: 1 - 1e-6 } },
  ],
  accel: [
    // 1000 g (simulator arcade max) for the proper time that gives gamma = 13:
    // tau = acosh(13) * c / a  (the INV-PHYS-01 regression, now interactive)
    { id: 'regress-1000g-gamma13', input: { aG: 1000, tauS: Math.acosh(13) * C / (1000 * G0) } },
    { id: '1g-one-year', input: { aG: 1, tauS: 365.25 * 86400 } },
    { id: '10g-one-day', input: { aG: 10, tauS: 86400 } },
  ],
  orbit: [
    { id: 'earth-leo', input: { r: 6.771e6, mu: 3.986004418e14 } },
    { id: 'earth-geo', input: { r: 4.2164e7, mu: 3.986004418e14 } },
    { id: 'sun-1au', input: { r: 1.495978707e11, mu: 1.32712440018e20 } },
  ],
  doppler: [
    { id: 'beta-0p6-side', input: { beta: 0.6, cosTheta: 0 } },
    { id: 'beta-minus-0p9', input: { beta: -0.9, cosTheta: 0.5 } },
    { id: 'beta-0p99', input: { beta: 0.99, cosTheta: 0.95 } },
  ],
  gravity: [
    { id: 'earth-surface', input: { r: 6.371e6, mu: 3.986004418e14 } },
    { id: 'moon-distance', input: { r: 3.844e8, mu: 3.986004418e14 } },
  ],
};
