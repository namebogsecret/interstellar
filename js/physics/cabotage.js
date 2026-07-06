// ─────────────────────────────────────────────────────────────────────────────
// KEPLER CABOTAGE ON WARP — advance a coasting ship ANALYTICALLY along its
// two-body conic about the dominant body, so time-warp injects zero secular
// drift, and hand back to the numeric N-body integrator on ANY boundary.
//
// «Горячо»-by-physics: correctness of shared mutable frame state + relativistic
// proper time. Two public predicates:
//   cabotageEngaged(...) — the §2 go/no-go gate (used by main.js).
//   tryAnalyticCoast(...) — all-or-nothing per-frame commit (used by main.js and
//                           the tests); on ANY rejection returns FALSE having
//                           mutated NOTHING (bit-identical numeric fallback).
//
// ГРАБЛИ #1 (главная грабля репо): this module uses ONLY its own dedicated
// `_cab*` scratch + its OWN private positions Map — NEVER main.js's shared
// per-frame scratch vectors (clobbered later in the frame by the floating-origin
// loop + HUD nav). `bodyVelocity` is read into cabotage-owned out-params; the
// shared body-velocity vector passed to ship.step is never mutated here.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { absolutePosition, propagateUniversal, bodyVelocity } from './orbits.js';
import { gravitationalPotential, dominantBody } from './gravity.js';
import { momentumFromV } from './relativity.js';
import { C2 } from './constants.js';

// Tuning defaults (flagged for Vladimir playtest — see ТЗ §7).
const DOM_RATIO = 10;          // dominant pull must exceed 2nd-strongest by ≥ this (SOI proxy)
const ATMO_MARGIN_FRAC = 0.05; // safe-radius margin as a fraction of body radius

// Safe radius: never engage/commit below the atmosphere top (or a margin above
// the surface for airless bodies).
function rSafe(b) {
  const atmoH = (b.atmosphere && b.atmosphere.height) || 0;
  return b.radius + Math.max(atmoH, ATMO_MARGIN_FRAC * b.radius);
}

// ── cabotage-private scratch (never main.js shared vectors) ──────────────────
const _cabBp0 = new THREE.Vector3();   // refBody position at t
const _cabBv0 = new THREE.Vector3();   // refBody velocity at t
const _cabBp1 = new THREE.Vector3();   // refBody position at t+Δt
const _cabBv1 = new THREE.Vector3();   // refBody velocity at t+Δt
const _cabR = new THREE.Vector3();     // rRel  = ship.pos − bodyPos0
const _cabV = new THREE.Vector3();     // vRel  = ship.v  − bodyVel0
const _cabREnd = new THREE.Vector3();  // rRel(Δt)
const _cabVEnd = new THREE.Vector3();  // vRel(Δt)
const _cabH = new THREE.Vector3();     // rRel × vRel (angular momentum)
const _cabShipEnd = new THREE.Vector3(); // heliocentric ship position at t+Δt
const _cabNode = new THREE.Vector3();  // rRel(s_k) for the dτ quadrature
const _cabNodeV = new THREE.Vector3(); // vRel(s_k)
const _cabHelio = new THREE.Vector3(); // heliocentric ship position at s_k
const _cabVhelio = new THREE.Vector3();// heliocentric ship velocity at s_k
const _cabTmp = new THREE.Vector3();   // transient
// Private positions Map for the all-body Φ at sub-sample times — so the shared
// `positions` Map is never left at a sub-sample time (main.js refreshes it after).
const _cabPositions = new Map();

// Fill `map` with every body's heliocentric position at time t (mirrors main.js
// computePositions but into a private Map). Allocates a Vector3 only the first
// time each body name is seen (cached across calls).
function fillPositions(bodies, t, byName, map) {
  for (const b of bodies) {
    let p = map.get(b.name);
    if (!p) { p = new THREE.Vector3(); map.set(b.name, p); }
    if (!b.parent) p.set(0, 0, 0);
    else absolutePosition(b, t, byName, p);
  }
  return map;
}

// pull_i = GM_i / max(|shipPos−bodyPos_i|², radius_i²). Ratio of refBody's pull
// to the strongest OTHER body's pull (∞ when refBody is the only massive body).
function dominanceRatio(shipPos, refBody, bodies, map) {
  let refPull = 0, secondPull = 0;
  for (const b of bodies) {
    if (!b.GM) continue;
    const bp = map.get(b.name);
    if (!bp) continue;
    const r2 = Math.max(bp.distanceToSquared(shipPos), b.radius * b.radius);
    const pull = b.GM / r2;
    if (b === refBody) refPull = pull;
    else if (pull > secondPull) secondPull = pull;
  }
  if (!(refPull > 0)) return 0;
  if (!(secondPull > 0)) return Infinity;
  return refPull / secondPull;
}

// §2 engagement predicate. TRUE iff coasting, above the atmosphere, under warp,
// and deep enough inside refBody's sphere of influence that a two-body conic is
// valid. Necessary but NOT sufficient — the per-frame look-ahead (§5) must pass.
export function cabotageEngaged(ship, refBody, refAlt, effWarp, bodies, byName, simTime) {
  if (ship.landed) return false;                                   // (1)
  if (ship.throttle !== 0) return false;                          // (2) coasting only
  if (!(effWarp > 1)) return false;                              // (3) no analytic gain at real-time
  if (!refBody || !(refBody.GM > 0)) return false;              // (4)
  if (!(refAlt + refBody.radius > rSafe(refBody) * (1 + 1e-6))) return false; // (5) above atmosphere+margin
  // (6) two-body dominance: refBody must out-pull the 2nd-strongest body by ≥ DOM_RATIO.
  fillPositions(bodies, simTime, byName, _cabPositions);
  if (dominanceRatio(ship.pos, refBody, bodies, _cabPositions) < DOM_RATIO) return false;
  return true;
}

// dτ integrand f(s) = √(max(0, 1 + 2Φ(s)/c² − |v_helio(s)|²/c²)) at proper-time
// node s, using the SAME all-body gravitationalPotential ship.step uses.
function dtauIntegrand(refBody, bodies, byName, tAbs, s, rRel, vRel, mu) {
  if (s === 0) {
    _cabNode.copy(rRel); _cabNodeV.copy(vRel);
  } else if (!propagateUniversal(mu, rRel, vRel, s, _cabNode, _cabNodeV)) {
    // Full-Δt step already validated to converge; guard anyway.
    _cabNode.copy(rRel); _cabNodeV.copy(vRel);
  }
  absolutePosition(refBody, tAbs, byName, _cabTmp);
  _cabHelio.addVectors(_cabTmp, _cabNode);            // shipPos_helio(s)
  bodyVelocity(refBody, tAbs, byName, _cabTmp);
  _cabVhelio.addVectors(_cabTmp, _cabNodeV);          // v_helio(s)
  fillPositions(bodies, tAbs, byName, _cabPositions); // all-body Φ (private Map)
  const phi = gravitationalPotential(_cabHelio, bodies, _cabPositions);
  const betaSq = _cabVhelio.lengthSq() / C2;
  return Math.sqrt(Math.max(0, 1 + 2 * phi / C2 - betaSq));
}

// Proper-time advance ∫₀^Δt f(s) ds via adaptive-K Simpson. Positions along the
// arc are analytic (cheap), so K is refined to keep dτ accurate even over a
// multi-revolution step where |v| and Φ oscillate.
function integrateDtau(refBody, bodies, byName, simTime, dt, rRel, vRel, r0, mu) {
  const tDyn = Math.sqrt((r0 * r0 * r0) / mu);
  let K = Math.ceil(Math.abs(dt) / (0.02 * tDyn));
  K = Math.max(4, Math.min(64, K));
  if (K % 2 === 1) K += 1;                             // Simpson needs an even interval count
  if (K > 64) K = 64;
  const hstep = dt / K;
  let sum = 0;
  for (let k = 0; k <= K; k++) {
    const s = k * hstep;
    const fval = dtauIntegrand(refBody, bodies, byName, simTime + s, s, rRel, vRel, mu);
    const wt = (k === 0 || k === K) ? 1 : (k % 2 === 1 ? 4 : 2);
    sum += wt * fval;
  }
  return (hstep / 3) * sum;
}

// §5 boundary look-ahead + all-or-nothing analytic commit. Returns TRUE only
// after committing a safe analytic step; returns FALSE (mutating NOTHING) so the
// caller runs the existing numeric substep loop → no overshoot possible.
//
// Called as the coast-warp path: derives refAlt internally and treats the frame
// as under warp (effWarp>1 by construction of the call site).
export function tryAnalyticCoast(ship, refBody, bodies, byName, simTime, dt) {
  if (!refBody || !(refBody.GM > 0)) return false;
  const mu = refBody.GM;

  // Detach at t using the integrator's OWN body functions (§3) — no jump injected.
  absolutePosition(refBody, simTime, byName, _cabBp0);
  bodyVelocity(refBody, simTime, byName, _cabBv0);
  const refAlt = ship.pos.distanceTo(_cabBp0) - refBody.radius;

  // (1) engagement predicate — coast-warp context ⇒ effWarp sentinel > 1.
  if (!cabotageEngaged(ship, refBody, refAlt, 2, bodies, byName, simTime)) return false;

  // (2) relative state.
  _cabR.subVectors(ship.pos, _cabBp0);
  _cabV.subVectors(ship.v, _cabBv0);
  const r0 = _cabR.length();
  if (!(r0 > 0)) return false;

  // (3) tentative propagation. Non-convergence ⇒ numeric fallback.
  if (!propagateUniversal(mu, _cabR, _cabV, dt, _cabREnd, _cabVEnd)) return false;

  // (4) min-radius guard (surface/atmosphere) from the accurate RELATIVE state.
  _cabH.crossVectors(_cabR, _cabV);
  const h = _cabH.length();
  const eps = 0.5 * _cabV.lengthSq() - mu / r0;
  const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (mu * mu)));
  const p = (h * h) / mu;
  const rPeri = p / (1 + e);
  const rEndMag = _cabREnd.length();
  const rvStart = _cabR.dot(_cabV);
  const rvEnd = _cabREnd.dot(_cabVEnd);
  let periapsisInArc = (rvStart < 0 && rvEnd > 0);    // radial-velocity sign flip
  if (eps < 0) {                                      // bound: does the step span ≥ one period?
    const a = -mu / (2 * eps);
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
    if (Math.abs(dt) >= period) periapsisInArc = true;
  }
  const minRad = periapsisInArc ? rPeri : Math.min(r0, rEndMag);
  if (minRad < rSafe(refBody)) return false;

  // (5) SOI / dominant-body change at the endpoint.
  absolutePosition(refBody, simTime + dt, byName, _cabBp1);
  _cabShipEnd.addVectors(_cabBp1, _cabREnd);
  fillPositions(bodies, simTime + dt, byName, _cabPositions);
  if (dominantBody(_cabShipEnd, bodies, _cabPositions) !== refBody) return false;
  if (dominanceRatio(_cabShipEnd, refBody, bodies, _cabPositions) < DOM_RATIO) return false;

  // ── all guards passed → COMMIT ──
  // dτ integral first (reads _cabR/_cabV; leaves _cabREnd/_cabVEnd untouched).
  const dtau = integrateDtau(refBody, bodies, byName, simTime, dt, _cabR, _cabV, r0, mu);

  // Reattach at t+Δt (§3).
  bodyVelocity(refBody, simTime + dt, byName, _cabBv1);
  ship.pos.addVectors(_cabBp1, _cabREnd);
  ship.v.addVectors(_cabBv1, _cabVEnd);
  momentumFromV(ship.v, ship.w);
  ship.properTime += dtau;

  // Housekeeping — mirror what ship.step leaves for the HUD (coast ⇒ felt accel 0).
  fillPositions(bodies, simTime + dt, byName, _cabPositions);
  ship.refBody = dominantBody(ship.pos, bodies, _cabPositions);
  if (ship.refBody) {
    const bp = _cabPositions.get(ship.refBody.name);
    ship.altitude = bp.distanceTo(ship.pos) - ship.refBody.radius;
  }
  ship.atmoDensity = 0;
  ship.lastAccel.set(0, 0, 0);
  return true;
}
