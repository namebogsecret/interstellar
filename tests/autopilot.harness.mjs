// Closed-loop test bench for the orbital autopilot (ТЗ волна B · B1 §7.0).
//
// NOT a *.test.mjs file, so tests/run.sh ignores it (it only globs tests/*.test.mjs).
//
// Contains a deliberately SIMPLE Newtonian two-body integrator (velocity-Verlet,
// r'' = −mu·r̂/r² + a_thrust). No relativity, no ship.js, no THREE scene: this loop
// exists to exercise THE AUTOPILOT, not an integrator. Everything the tests assert
// about the resulting orbit is read back through orbits.js::orbitFromState on the
// FINAL state vector — never from the autopilot's own bookkeeping fields.
//
// Written from the contract (§2.2, §3, §4, §7) BEFORE the implementation existed.
// Until js/physics/autopilot.js lands, every importer of this file fails red at
// module resolution — that is the expected state, not a bug in the tests.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { BODIES, byName } from '../js/data/bodies.js';
import { orbitFromState, safeRadius } from '../js/physics/orbits.js';
import { C, G0 } from '../js/physics/constants.js';
import {
  PHASES, REASONS, engageAutopilot, autopilotStep, estimateManoeuvreDv,
} from '../js/physics/autopilot.js';

export { PHASES, REASONS, engageAutopilot, autopilotStep, estimateManoeuvreDv, orbitFromState };

// ── constants pulled from the source of truth, never copied ────────────────────
export const EARTH = byName('Earth');
export const MOON = byName('Moon');
export const MU_EARTH = EARTH.GM;                 // js/data/bodies.js
export const SAFE_R_EARTH = safeRadius(EARTH);    // js/physics/orbits.js (§2.1)
export const ARCADE_ACCEL = 1000 * G0;            // ship.js maxAccelArcade (arcade ceiling)
export const C_LIGHT = C;                         // js/physics/constants.js

// ТЗ §3.2: the autopilot never uses the arcade ceiling; its own cap is 30 g.
// G0 comes from constants.js; the factor 30 is the contract's number (ТЗ §3.2 table,
// §10/R3 says it is a playtest knob — one place here, one assertion in
// autopilot.invariants.test.mjs pins an exported A_MAX to it if the module exposes one).
export const A_MAX_TZ = 30 * G0;
export const A_MIN_TZ = 0.5 * G0;

export const TERMINAL_PHASES = new Set([
  PHASES.DONE, PHASES.CANCELLED, PHASES.REFUSED, PHASES.FAILED,
]);

// ── vector / angle helpers ─────────────────────────────────────────────────────

// Angle between two directions. atan2(|a×b|, a·b), NEVER acos(dot): acos has a
// ~1.5e-8 rad numerical floor near parallel vectors (ГРАБЛИ.md #8).
const _cx = new THREE.Vector3();
export function angleBetween(a, b) {
  _cx.crossVectors(a, b);
  return Math.atan2(_cx.length(), a.dot(b));
}

export function isFiniteVec(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

// Specific angular momentum h = r × v (its DIRECTION is the orbital plane normal).
export function angularMomentum(rVec, vVec) {
  return new THREE.Vector3().crossVectors(rVec, vVec);
}

// ── conic state builders (self-checking fixtures) ──────────────────────────────

/** State vector at true anomaly nu on the conic (rPeri, e) about mu.
 *  Orbit lies in the world x–y plane, periapsis along +x, prograde (+h along +z). */
export function conicState(mu, e, rPeri, nu = 0) {
  const p = rPeri * (1 + e);                     // semi-latus rectum
  const r = p / (1 + e * Math.cos(nu));
  const vr = Math.sqrt(mu / p) * e * Math.sin(nu);
  const vt = Math.sqrt(mu / p) * (1 + e * Math.cos(nu));
  const cn = Math.cos(nu), sn = Math.sin(nu);
  return {
    r: new THREE.Vector3(r * cn, r * sn, 0),
    v: new THREE.Vector3(vr * cn - vt * sn, vr * sn + vt * cn, 0),
  };
}

/** Circular state of radius r (prograde, x–y plane). */
export function circularState(mu, r) {
  return {
    r: new THREE.Vector3(r, 0, 0),
    v: new THREE.Vector3(0, Math.sqrt(mu / r), 0),
  };
}

/** Rotate a {r, v} pair rigidly — used to prove the guidance law is frame-agnostic
 *  and that the ORBITAL PLANE is preserved (ТЗ §4 «наклонение/узел НЕ меняются»). */
export function tiltState(st, axis, angle) {
  const q = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
  return { r: st.r.clone().applyQuaternion(q), v: st.v.clone().applyQuaternion(q) };
}

// ── deterministic pseudo-randomness (Math.random is FORBIDDEN, ТЗ §7.3 «п») ─────
export function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export const logUniform = (rnd, lo, hi) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));

// ── observation record (ТЗ §2.2 AutopilotObs) ──────────────────────────────────
export function makeObs(rVec, vVec, over = {}) {
  const o = Object.assign({
    mu: MU_EARTH,
    bodyRadius: EARTH.radius,
    safeRadius: SAFE_R_EARTH,
    rVec,
    vVec,
    maxThrustAccel: ARCADE_ACCEL,
    dvBudget: Infinity,
    landed: false,
    atmoDensity: 0,
    dominance: 1e6,
    refBodyName: 'Earth',
    inputSeq: 0,
    dtReal: 1 / 60,
  }, over);
  // β is DERIVED from the velocity that actually ends up in the observation
  // (an override of vVec must move β with it), unless β was set explicitly —
  // that channel exists for the heliocentric component the bench does not model.
  if (!('beta' in over)) {
    const s = o.vVec && typeof o.vVec.length === 'function' ? o.vVec.length() : NaN;
    o.beta = Number.isFinite(s) ? s / C : 0;
  }
  return o;
}

// ── command invariants (ТЗ §2.2 (i)–(vi)) ──────────────────────────────────────
/**
 * @param cmd   AutopilotCommand under test
 * @param obs   the observation it was produced from
 * @param dt    the dt that was PASSED to autopilotStep (invariant (vi) is stated
 *              against exactly that dt, because aTap = dvRem/max(TAPER_T, dt))
 */
export function assertCommandInvariants(cmd, obs, dt, label) {
  assert.ok(cmd && typeof cmd === 'object', `${label}: command must be an object`);

  // (i) throttle finite in [0,1]
  assert.ok(Number.isFinite(cmd.throttle),
    `${label}: (i) throttle must be finite, got ${cmd.throttle}`);
  assert.ok(cmd.throttle >= 0 && cmd.throttle <= 1,
    `${label}: (i) throttle out of [0,1]: ${cmd.throttle}`);

  // (ii) throttle > 0  <=>  thrustDir !== null   (main.js pushes NOSE-first otherwise)
  assert.equal(cmd.throttle > 0, cmd.thrustDir !== null && cmd.thrustDir !== undefined,
    `${label}: (ii) throttle>0 <=> thrustDir!==null violated ` +
    `(throttle=${cmd.throttle}, thrustDir=${cmd.thrustDir})`);

  // (iii) thrustDir, when present, is a finite UNIT vector
  if (cmd.thrustDir !== null && cmd.thrustDir !== undefined) {
    assert.ok(isFiniteVec(cmd.thrustDir),
      `${label}: (iii) thrustDir has non-finite components ` +
      `(${cmd.thrustDir.x}, ${cmd.thrustDir.y}, ${cmd.thrustDir.z})`);
    const len = cmd.thrustDir.length();
    assert.ok(Math.abs(len - 1) <= 1e-12,
      `${label}: (iii) |thrustDir| = ${len}, expected 1 ± 1e-12`);
  }

  // (iv) maxWarp >= 1, finite or exactly Infinity
  assert.ok(Number.isFinite(cmd.maxWarp) || cmd.maxWarp === Infinity,
    `${label}: (iv) maxWarp must be finite or Infinity, got ${cmd.maxWarp}`);
  assert.ok(cmd.maxWarp >= 1, `${label}: (iv) maxWarp must be >= 1, got ${cmd.maxWarp}`);

  // (v) done => no thrust at all
  assert.equal(cmd.done, TERMINAL_PHASES.has(cmd.phase),
    `${label}: done flag must mirror terminal phase (phase=${cmd.phase}, done=${cmd.done})`);
  if (cmd.done) {
    assert.equal(cmd.throttle, 0, `${label}: (v) done => throttle===0, got ${cmd.throttle}`);
    assert.equal(cmd.thrustDir, null, `${label}: (v) done => thrustDir===null`);
  }

  // phase mirror + state identity
  assert.equal(cmd.phase, cmd.state.phase, `${label}: cmd.phase must mirror state.phase`);

  // (vi) "never overshoot": applied Δv this frame can never exceed what is left.
  // Only meaningful when the inputs themselves are finite (the degenerate-input
  // matrix deliberately feeds NaN/Infinity and only contracts (i)–(v) there).
  const dvRem = cmd.state.info ? cmd.state.info.dvRemaining : undefined;
  if (Number.isFinite(obs.maxThrustAccel) && Number.isFinite(dt) && Number.isFinite(dvRem)) {
    const applied = cmd.throttle * obs.maxThrustAccel * dt;
    assert.ok(applied <= dvRem * (1 + 1e-9),
      `${label}: (vi) overshoot — throttle·aAvail·dt = ${applied} > dvRemaining = ${dvRem}`);
  }

  // The autopilot never changes the orbital PLANE (ТЗ §4 «не умеет» п.5, INV-PHYS-03):
  // thrust must lie in the plane spanned by r and v.
  if (cmd.thrustDir && isFiniteVec(obs.rVec) && isFiniteVec(obs.vVec)) {
    const h = angularMomentum(obs.rVec, obs.vVec);
    const scale = obs.rVec.length() * obs.vVec.length();
    if (h.length() > 1e-6 * scale) {
      const outOfPlane = Math.abs(cmd.thrustDir.dot(h.normalize()));
      assert.ok(outOfPlane <= 1e-7,
        `${label}: thrust left the orbital plane, |t̂·ĥ| = ${outOfPlane}`);
    }
  }
}

// ── the integrator ─────────────────────────────────────────────────────────────
const _a = new THREE.Vector3();
const _aNew = new THREE.Vector3();
function gravAccel(rVec, mu, aThrust, out) {
  const r2 = rVec.lengthSq();
  const r1 = Math.sqrt(r2);
  out.copy(rVec).multiplyScalar(-mu / (r2 * r1));
  if (aThrust) out.add(aThrust);
  return out;
}

/** Velocity-Verlet over ONE autopilot frame, with the commanded thrust held
 *  constant across it (exactly what a real frame does). The frame is internally
 *  sub-stepped to dt_sub <= subFrac·sqrt(r³/mu) so that a 60 s frame near
 *  periapsis is still integrated honestly: the tests must fail on autopilot bugs,
 *  not on discretisation of the bench. */
export function integrateFrame(r, v, mu, aThrust, dt, subFrac = 1 / 400, maxSub = 8192) {
  if (!(dt > 0)) return;
  const rr = r.length();
  const tDyn = Math.sqrt((rr * rr * rr) / mu);
  let n = Math.ceil(dt / Math.max(tDyn * subFrac, 1e-12));
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > maxSub) n = maxSub;
  const h = dt / n;
  gravAccel(r, mu, aThrust, _a);
  for (let i = 0; i < n; i++) {
    r.addScaledVector(v, h).addScaledVector(_a, 0.5 * h * h);
    gravAccel(r, mu, aThrust, _aNew);
    v.addScaledVector(_a, 0.5 * h).addScaledVector(_aNew, 0.5 * h);
    _a.copy(_aNew);
  }
}

// ── step schedules ─────────────────────────────────────────────────────────────

/** Fixed model step. */
export const fixedSchedule = (dt) => () => dt;

/** Burn fine / coast coarse, and — like the real main.js — HONOURING cmd.maxWarp
 *  during the wait. An implementation that hands back a too-generous maxWarp will
 *  step straight over its own ignition point and the Hohmann result will be junk:
 *  that is the point of wiring the cap into the bench instead of ignoring it. */
export function warpAwareSchedule({ burnDt = 0.05, coastMax = 60, dtReal = 1 / 60 } = {}) {
  return (cmd) => {
    if (cmd.phase === PHASES.BURN || cmd.phase === PHASES.TRIM) return burnDt;
    const w = Number.isFinite(cmd.maxWarp) ? cmd.maxWarp : 1e9;
    return Math.min(coastMax, Math.max(dtReal, w * dtReal));
  };
}

// ── the closed loop ────────────────────────────────────────────────────────────
/**
 * runClosedLoop({ mu, r0, v0, goal, obsBase, obsOverrides, dtOf, maxSteps, dtReal })
 *
 * obsBase      static field overrides merged into every observation
 * obsOverrides (obs, ctx) => partial|undefined — step-conditional overrides
 *              (β, dominance, refBodyName, inputSeq, atmoDensity, …); ctx carries
 *              { step, simTime, state (BEFORE this step), lastCmd }
 * dtOf         (cmd, ctx) => model seconds to integrate after this command
 *
 * Returns { engaged, state, phases, states, log, r, v, elements, dvSpent, simTime,
 *           steps, peakAccel, burnTime, lastCmd, h0, hFinal }.
 */
export function runClosedLoop(opts) {
  const {
    mu = MU_EARTH,
    r0, v0, goal,
    obsBase = {},
    obsOverrides = null,
    dtOf = fixedSchedule(0.05),
    maxSteps = 200000,
    dtReal = 1 / 60,
    checkInvariants = true,
    label = 'loop',
  } = opts;

  const r = r0.clone();
  const v = v0.clone();
  const h0 = angularMomentum(r0, v0);
  const outDir = new THREE.Vector3();

  let dvBudget = obsBase.dvBudget === undefined ? Infinity : obsBase.dvBudget;
  let dvSpent = 0, simTime = 0, lastDt = 0, steps = 0, peakAccel = 0, burnTime = 0;

  const states = [], log = [], phases = [];

  const build = (ctx) => {
    const o = makeObs(r.clone(), v.clone(), Object.assign({ dtReal }, obsBase));
    o.mu = mu;
    o.dvBudget = dvBudget;                 // tracked, not frozen at obsBase
    if (obsBase.beta === undefined) o.beta = v.length() / C;
    if (obsOverrides) Object.assign(o, obsOverrides(o, ctx) || {});
    return o;
  };

  const engageObs = build({ step: -1, simTime: 0, state: null, lastCmd: null });
  const engaged = engageAutopilot(goal, engageObs);
  assert.ok(engaged && typeof engaged === 'object',
    `${label}: engageAutopilot must never return null`);
  let state = engaged;
  states.push(state);
  phases.push(state.phase);

  let lastCmd = null;
  if (!TERMINAL_PHASES.has(state.phase)) {
    for (;;) {
      const obs = build({ step: steps, simTime, state, lastCmd });
      const cmd = autopilotStep(state, obs, lastDt, outDir);
      if (checkInvariants) assertCommandInvariants(cmd, obs, lastDt, `${label} step ${steps}`);

      state = cmd.state;
      lastCmd = cmd;
      states.push(state);
      if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);

      const aMag = cmd.throttle * obs.maxThrustAccel;
      log.push({
        step: steps,
        simTime,
        dtIn: lastDt,
        phase: cmd.phase,
        reason: state.reason,
        throttle: cmd.throttle,
        aAvail: obs.maxThrustAccel,
        accel: aMag,
        dvRemaining: state.info ? state.info.dvRemaining : undefined,
        tToIgnition: state.info ? state.info.tToIgnition : undefined,
        maxWarp: cmd.maxWarp,
        event: cmd.event,
        done: cmd.done,
        radius: r.length(),
        speed: v.length(),
        rdotv: r.dot(v),
        // cos(r,v): 0 at an apsis. Normalised here so tests never divide by a
        // magnitude they did not capture at the same instant.
        cosRV: r.dot(v) / (r.length() * v.length()),
        thrustDir: cmd.thrustDir ? cmd.thrustDir.clone() : null,
        phaseElapsed: state.phaseElapsed,
        elapsed: state.elapsed,
        trimCount: state.trimCount,
      });
      steps++;

      if (cmd.done || steps >= maxSteps) break;

      const dt = dtOf(cmd, { step: steps, simTime, state });
      assert.ok(Number.isFinite(dt) && dt > 0, `${label}: schedule produced dt=${dt}`);
      if (Number.isFinite(aMag) && aMag > 0 && cmd.thrustDir) {
        peakAccel = Math.max(peakAccel, aMag);
        burnTime += dt;
        dvSpent += aMag * dt;
        if (Number.isFinite(dvBudget)) dvBudget = Math.max(0, dvBudget - aMag * dt);
        // clone: cmd.thrustDir IS the caller-owned outDir and is overwritten next
        // step — reading it across the frame boundary is exactly ГРАБЛИ #1.
        integrateFrame(r, v, mu, cmd.thrustDir.clone().multiplyScalar(aMag), dt);
      } else {
        integrateFrame(r, v, mu, null, dt);
      }
      simTime += dt;
      lastDt = dt;
    }
  }

  // Peak applied acceleration over EVERY command, including the last one (which
  // never gets integrated): a ceiling breach must not be able to hide in the tail.
  for (const e of log) if (Number.isFinite(e.accel)) peakAccel = Math.max(peakAccel, e.accel);

  return {
    engaged, state, phases, states, log, lastCmd,
    r, v, mu,
    elements: orbitFromState(mu, r, v),
    h0, hFinal: angularMomentum(r, v),
    dvSpent, simTime, steps, peakAccel, burnTime,
  };
}

/** The compressed phase list must contain `sub` as a subsequence (order kept,
 *  gaps allowed) — used instead of exact equality so TRIM passes stay optional. */
export function hasSubsequence(seq, sub) {
  let i = 0;
  for (const s of seq) if (s === sub[i]) i++;
  return i === sub.length;
}

/** Standard "the resulting orbit really is what was asked for" assertion set.
 *  Elements ALWAYS come from orbitFromState on the final state vector. */
export function assertCircularOrbit(res, { eTol, aTol, targetRadius = null, label = '' }) {
  const el = res.elements;
  assert.equal(el.bound, true, `${label}: resulting orbit must be bound (a=${el.a}, e=${el.e})`);
  assert.ok(Number.isFinite(el.e) && el.e <= eTol,
    `${label}: eccentricity ${el.e} > ${eTol} (INV-PHYS-10 — elements, not coordinates)`);
  const aRef = targetRadius === null ? res.r.length() : targetRadius;
  const aErr = Math.abs(el.a - aRef) / aRef;
  assert.ok(aErr <= aTol,
    `${label}: |a − ${aRef}|/${aRef} = ${aErr} > ${aTol} (a=${el.a})`);
  assert.ok(isFiniteVec(res.r) && isFiniteVec(res.v),
    `${label}: final state vector must stay finite`);
}

export { BODIES };
