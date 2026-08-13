// ─────────────────────────────────────────────────────────────────────────────
// NEWTONIAN ORBIT-INSERTION AUTOPILOT — a closed loop on the INSTANTANEOUS
// orbital elements, NOT the playback of a pre-computed manoeuvre plan.
//
// Every frame it rebuilds the TARGET VELOCITY vTgt(r, v) in the current orbital
// plane and commands thrust along dv = vTgt − v, tapering as |dv| shrinks. The
// properties that fall out of that (instead of needing their own crutches):
//   • no error accumulation over a long burn — there is nothing to accumulate,
//     the target is recomputed from the state each step;
//   • indifference to variable dt, to time-warp, and to the radius changing
//     mid-burn;
//   • burn cutoff is decided by the ACHIEVED STATE, not by an integrated Δv
//     counter (see R2/R8 of the ТЗ red-team);
//   • the SAME circularizeVelocity() that already sits behind the K key is the
//     target for the circularization leg — "circular orbit" has exactly one
//     definition in this project, not two that drift apart (ГРАБЛИ #2).
// The difference from K: K teleports ship.v into vTgt with one assignment; the
// autopilot walks into vTgt via thrustDir + throttle and a real ship.step().
//
// PURITY (house pattern: js/render/renderPolicy.js). No DOM, no WebGL, no
// THREE scene, no clock, no randomness — importable under the plain node gate.
// THREE is imported for Vector3 only, exactly as orbits.js does. This module
// NEVER writes to simulation state: it returns a command and (its single side
// effect) writes the thrust direction into the caller-owned `outDir`.
//
// ГРАБЛИ #1 (scratch aliasing): all scratch here is module-private `_ap*`,
// never main.js's shared per-frame vectors. buildObs()'s result is valid ONLY
// until the next buildObs() call — main.js must consume it the same frame and
// never store it.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { C, G0 } from './constants.js';
import { circularizeVelocity, orbitFromState, timeToPeriapsis, timeToApoapsis,
         safeRadius, dominanceRatio, bodyVelocity } from './orbits.js';
import { dominantBody } from './gravity.js';

// ── enumerations (frozen string literals; serialized as-is) ──────────────────
export const PHASES = Object.freeze({
  IDLE: 'IDLE',            // not engaged (state === null is equivalent)
  WAIT: 'WAIT',            // waiting for the burn point (an apsis) — no thrust
  BURN: 'BURN',            // main burn
  TRIM: 'TRIM',            // final low-thrust correction
  DONE: 'DONE',            // terminal: elements within tolerance
  CANCELLED: 'CANCELLED',  // terminal: the pilot intervened
  REFUSED: 'REFUSED',      // terminal: wouldn't take it (checked AT engage)
  FAILED: 'FAILED',        // terminal: took it and honestly couldn't (checked IN FLIGHT)
});

export const REASONS = Object.freeze({
  LANDED: 'landed', NO_BODY: 'no-body', RELATIVISTIC: 'relativistic',
  ATMOSPHERE: 'atmosphere', PERTURBED: 'perturbed', UNBOUND: 'unbound',
  TARGET_UNREACHABLE: 'target-unreachable', NO_FUEL: 'no-fuel',
  REF_CHANGED: 'ref-changed', NO_CONVERGENCE: 'no-convergence', TIMEOUT: 'timeout',
});

// ── tuning constants (playtest knobs — exported so they can be turned) ───────
export const BETA_MAX = 0.01;            // above this the Newtonian guidance law stops being honest
export const DOM_MIN_ENGAGE = 10;        // refBody must out-pull everything else by this to ENGAGE
export const DOM_MIN_HOLD = 5;           // ...and by this to KEEP going (hysteresis vs SOI-edge flicker)
export const T_BURN_TARGET = 8;          // s — aim for a burn the player can SEE (≈480 frames @60fps)
export const A_MAX = 30 * G0;            // m/s² — ceiling; cuts arcade's 1000 g by ×33
export const A_MIN = 0.5 * G0;           // m/s² — floor, so a huge Δv isn't a half-hour burn
export const TAPER_T = 0.5;              // s — terminal cone: ≥30 frames of thrust on the tail @60fps
export const A_TRIM_MAX = 1 * G0;        // m/s² — TRIM is a gentle nudge, not a second main burn
export const T_TRIM_TARGET = 2;          // s
export const DV_MARGIN = 1.1;            // fuel gate: need 10% more budget than the estimate
export const TRIM_MAX = 3;               // trim passes before FAILED(no-convergence)
export const E_TOL = 1e-3;               // eccentricity tolerance for "circular"
export const R_TOL = 0.05;               // apsis must match the target radius within 5% to circularize
export const WAIT_LEAD_FRAMES = 4;       // warp cap keeps ≥ this many frames before ignition
export const LATE_FRAC = 0.02;           // ignite up to 2% of a period LATE rather than wait a lap
export const BURN_TIMEOUT_MIN = 120;     // s
export const BURN_TIMEOUT_FRAMES = 8;    // ...and never fewer than this many caller frames
export const MANOEUVRE_TIMEOUT_MAX = 1e6;// s
export const MAX_WARP_CAP = 1e9;

// ── module-private scratch (ГРАБЛИ #1: never a caller's vector) ──────────────
const _apVTgt = new THREE.Vector3();   // target velocity of the guidance law
const _apDv = new THREE.Vector3();     // vTgt − v
const _apH = new THREE.Vector3();      // r × v
const _apTan = new THREE.Vector3();    // prograde tangential unit
const _apRad = new THREE.Vector3();    // radial unit
// buildObs-owned scratch: the observation it returns POINTS AT THESE, so the
// result is valid only until the next buildObs() call (documented contract).
const _apR = new THREE.Vector3();
const _apV = new THREE.Vector3();
const _apBVel = new THREE.Vector3();
const _apZeroR = new THREE.Vector3();
const _apZeroV = new THREE.Vector3();

// clamp with the ТЗ's deliberate lo>hi behaviour: when the floor is above the
// ceiling (realistic mode, aAvail = 0.3 m/s² < A_MIN) it returns the CEILING —
// an honest clamp to the ship's real limit rather than a floor that pretends.
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function fin(x, fallback) { return Number.isFinite(x) ? x : fallback; }

// Prograde tangential unit vector of the current orbital plane, written to
// `out`. ONE function shared by both guidance cases (circularize/transfer) —
// two copies of the plane geometry would drift. Same degeneracy guards as
// circularizeVelocity (which is where this geometry already lives): a radial
// state has no defined plane, so any perpendicular direction is picked.
// Returns FALSE (out untouched-but-zeroed) if rVec itself is degenerate.
function _tangentialUnit(rVec, vVec, out) {
  _apH.crossVectors(rVec, vVec);
  if (_apH.lengthSq() > 1e-12) {
    out.crossVectors(_apH, rVec);
  } else {
    out.set(-rVec.y, rVec.x, 0);
    if (out.lengthSq() < 1e-12) out.set(0, -rVec.z, rVec.y);
  }
  if (!(out.lengthSq() > 0) || !Number.isFinite(out.lengthSq())) { out.set(0, 0, 0); return false; }
  out.normalize();
  return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
}

// Speed on a transfer ellipse with apsides r and rT, evaluated at r (vis-viva
// for a = (r + rT)/2). NaN-safe: callers check finiteness.
function _transferSpeed(mu, r, rT) {
  return Math.sqrt((2 * mu * rT) / (r * (r + rT)));
}

// Δv cutoff: 0.02 m/s leaves δe ≈ 2·δv/v ≈ 5e-6 in LEO — two orders below
// E_TOL — while the relative term keeps the threshold sane near the Sun.
function dvEps(mu, r) {
  const vc = Math.sqrt(Math.abs(mu / r));
  return Math.max(0.02, Number.isFinite(vc) ? 1e-6 * vc : 0);
}

// The two-body state the guidance law works from, plus the elements. Pure.
function _elements(obs) {
  const r = obs.rVec.length();
  const el = orbitFromState(obs.mu, obs.rVec, obs.vVec);
  return { r, a: el.a, e: el.e, rPeri: el.rPeri, rApo: el.rApo, bound: el.bound };
}

// Orbital period (s) of the current conic, or 0 when unbound/degenerate.
function _period(mu, a, bound) {
  if (!bound || !(a > 0) || !Number.isFinite(a)) return 0;
  const T = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
  return Number.isFinite(T) && T > 0 ? T : 0;
}

// ── the guidance law ─────────────────────────────────────────────────────────
// Target velocity for the given leg, written to _apVTgt; returns TRUE on
// success. BOTH legs aim at a purely tangential velocity in the CURRENT plane,
// which is why dv also kills the radial component for free — circularization
// works away from an apsis too (ТЗ §3.1).
function _targetVelocity(obs, leg, targetRadius) {
  if (leg === 'transfer') {
    const r = obs.rVec.length();
    const rT = targetRadius;
    if (!_tangentialUnit(obs.rVec, obs.vVec, _apTan)) return false;
    // The target is the ORBIT (far apsis = rT), not a fixed velocity vector.
    //
    // ТЗ §3.1 writes the target as the purely TANGENTIAL vis-viva speed
    // sqrt(2·mu·rT/(r·(r+rT))). That is right only AT the departure apsis, where
    // the radial speed is zero: the moment the burn lifts the ship off the
    // apsis it acquires radial velocity, a purely-tangential target then asks
    // for that radial component to be cancelled too, the demanded Δv bottoms
    // out around |v_radial| instead of reaching DV_EPS, and the burn never cuts
    // off — the transfer degenerates into a continuous-thrust spiral and dies
    // on BURN_TIMEOUT. (Observed: a = 1.40e7 instead of 2.0e7, e = 0.43.)
    //
    // So we KEEP the current radial component and solve for the tangential
    // speed that puts the far apsis exactly at rT. With v_r fixed, angular
    // momentum h = r·v_t and energy conservation to the apsis (where v_r = 0):
    //   (v_r² + v_t²)/2 − mu/r = (r·v_t)²/(2·rT²) − mu/rT
    //   ⇒ v_t² = [2·(mu/r − mu/rT) − v_r²] / (1 − r²/rT²)
    // At v_r = 0 this reduces ALGEBRAICALLY to §3.1's formula, so the contract
    // is generalized, not replaced — and now the target IS a fixed point of the
    // dynamics (dv → 0 exactly when the far apsis reaches rT), which is what
    // makes the state-based cutoff of §3.1 achievable. Works unchanged for
    // lowering (rT < r: both numerator and denominator flip sign).
    if (!(r > 0) || !(rT > 0) || !(obs.mu > 0)) return false;
    _apRad.copy(obs.rVec).multiplyScalar(1 / r);
    const vr = obs.vVec.dot(_apRad);
    const den = 1 - (r * r) / (rT * rT);
    const vt2 = (2 * (obs.mu / r - obs.mu / rT) - vr * vr) / den;
    if (Math.abs(den) > 1e-9 && vt2 > 0 && Number.isFinite(vt2)) {
      _apVTgt.copy(_apTan).multiplyScalar(Math.sqrt(vt2)).addScaledVector(_apRad, vr);
    } else {
      // Degenerate (already at rT, or the radial energy alone overshoots it):
      // fall back to the apsis form so the command stays finite.
      const sp = _transferSpeed(obs.mu, r, rT);
      if (!Number.isFinite(sp)) return false;
      _apVTgt.copy(_apTan).multiplyScalar(sp);
    }
    return Number.isFinite(_apVTgt.x) && Number.isFinite(_apVTgt.y) && Number.isFinite(_apVTgt.z);
  }
  // circularize: the K key's own function — one definition of "circular orbit".
  circularizeVelocity(obs.mu, obs.rVec, obs.vVec, _apVTgt);
  return Number.isFinite(_apVTgt.x) && Number.isFinite(_apVTgt.y) && Number.isFinite(_apVTgt.z);
}

// dv = vTgt − v into _apDv; returns |dv| (NaN-safe: 0 when undefined).
function _deltaV(obs, leg, targetRadius) {
  if (!_targetVelocity(obs, leg, targetRadius)) { _apDv.set(0, 0, 0); return 0; }
  _apDv.subVectors(_apVTgt, obs.vVec);
  const m = _apDv.length();
  return Number.isFinite(m) ? m : 0;
}

// Classic Δv of one leg from apsis radius r1 to radius r2 (the burn AT r1).
function _legDv(mu, r1, r2, vAtR1) {
  const sp = _transferSpeed(mu, r1, r2);
  return Math.abs(sp - vAtR1);
}

// Speed on the current conic at radius rr (vis-viva). NaN when undefined.
function _speedAt(mu, rr, a) {
  return Math.sqrt(Math.max(0, mu * (2 / rr - 1 / a)));
}

/** Total Δv (m/s) of the manoeuvre by the classic formulae — for the fuel gate
 *  and for the tests. 'circularize' = |vTgt − v| now. 'hohmann' = dv1 + dv2. */
export function estimateManoeuvreDv(goal, obs) {
  if (!goal || !obs) return Infinity;
  const el = _elements(obs);
  if (goal.kind === 'circularize') {
    return _deltaV(obs, 'circularize', el.r);
  }
  const rT = goal.targetRadius;
  if (!Number.isFinite(rT) || !(rT > 0) || !(el.r > 0) || !(obs.mu > 0)) return Infinity;
  // Depart from the apsis on the OPPOSITE side of the target (raise ⇒ periapsis,
  // lower ⇒ apoapsis); fall back to the current radius when that apsis is not
  // usable (unbound/degenerate — which the refusal gate rejects earlier anyway).
  const raising = rT > el.r;
  let r1 = raising ? el.rPeri : el.rApo;
  if (!Number.isFinite(r1) || !(r1 > 0)) r1 = el.r;
  const v1 = Number.isFinite(el.a) && el.a !== 0 ? _speedAt(obs.mu, r1, el.a) : Math.sqrt(obs.mu / r1);
  const dv1 = _legDv(obs.mu, r1, rT, v1);
  const dv2 = Math.abs(Math.sqrt(obs.mu / rT) - _transferSpeed(obs.mu, rT, r1));
  const total = dv1 + dv2;
  return Number.isFinite(total) ? total : Infinity;
}

// Working acceleration for a frame of length dtEff (ТЗ §3.2). Three limiters;
// the terminal cone aTap is what bounds the Δv one frame can apply:
//   applied Δv = a·dtEff ≤ dvRem·dtEff/max(TAPER_T,dtEff) ≤ dvRem.
function _workingAccel(dvRemaining, aAvail, dtEff, trim) {
  const tTarget = trim ? T_TRIM_TARGET : T_BURN_TARGET;
  const aCeil = Math.min(aAvail, trim ? A_TRIM_MAX : A_MAX);
  const aNom = clamp(dvRemaining / tTarget, trim ? 0 : A_MIN, aCeil);
  const aTap = dvRemaining / Math.max(TAPER_T, dtEff);
  return Math.min(aNom, aTap);
}

// Throttle for this frame.
//
// THE ENGINE DOES NOT LIGHT UNTIL A MODEL STEP HAS BEEN MEASURED (dt > 0).
// §3.5 hands the FIRST step dt = 0 ("nothing integrated yet"), and the fatal
// reading of that is "the next step is infinitely short", which lets the taper
// authorise full nominal thrust for a frame of unknown length. A caller then
// integrating a coarse frame (60 s under warp) applies aNom·60 — measured at
// 7.4 km/s of Δv on a 989 m/s manoeuvre, which throws the ship onto an escape
// trajectory the loop then spends the whole manoeuvre deadline chasing. It also
// made invariant (vi) vacuous rather than protective: it is stated against the
// dt passed IN (0), not the dt about to be integrated.
// Unknown frame length ⇒ spend one frame measuring instead of guessing. Costs
// ~16 ms in the real sim; makes the bound hold for any caller.
//
// dtEff = max(dt, dtReal): the previous MODEL step, but never less than the real
// frame it was measured over (a caller reporting a long real frame is believed).
function _throttleFor(dvRemaining, aAvail, dt, dtReal, trim) {
  if (!(aAvail > 0) || !Number.isFinite(aAvail)) return 0;
  if (!(dt > 0)) return 0;
  const dtEff = Math.max(dt, Number.isFinite(dtReal) && dtReal > 0 ? dtReal : 0);
  const th = clamp(_workingAccel(dvRemaining, aAvail, dtEff, trim) / aAvail, 0, 1);
  return Number.isFinite(th) ? th : 0;
}

// ── refusal / failure gates ─────────────────────────────────────────────────
// FIXED PRIORITY ORDER (ТЗ §4). A state violating two conditions MUST report
// the upper one — e.g. v = 0.02c on an unbound orbit answers "relativistic",
// not "unbound", because the honest complaint is about the guidance law's
// premise, not about the conic.
function _gateAtEngage(goal, obs, el) {
  if (obs.landed) return REASONS.LANDED;                                     // 1
  if (!obs.refBodyName || !(obs.mu > 0) || !(el.r > 0)) return REASONS.NO_BODY; // 2
  if (!(obs.beta <= BETA_MAX)) return REASONS.RELATIVISTIC;                  // 3
  if (el.r < obs.safeRadius || obs.atmoDensity > 0) return REASONS.ATMOSPHERE; // 4
  if (!(obs.dominance >= DOM_MIN_ENGAGE)) return REASONS.PERTURBED;          // 5
  if (goal.kind === 'hohmann' && el.bound === false) return REASONS.UNBOUND; // 6
  if (goal.kind === 'hohmann') {                                             // 7
    const rT = goal.targetRadius;
    if (!Number.isFinite(rT) || !(rT > 0) || rT < obs.safeRadius) return REASONS.TARGET_UNREACHABLE;
  }
  const need = estimateManoeuvreDv(goal, obs) * DV_MARGIN;                   // 8
  if (!(obs.maxThrustAccel > 0)) return REASONS.NO_FUEL;
  if (!(obs.dvBudget >= need)) return REASONS.NO_FUEL;
  return null;
}

// Continuous checks, same relative order. `dvRemaining` is the CURRENT leg's
// remaining Δv: the in-flight fuel test asks "can I still finish THIS burn",
// not "could I still start the whole manoeuvre from scratch" — the latter
// would fail itself halfway through every honest realistic burn.
function _gateInFlight(state, obs, el, dvRemaining) {
  if (!(obs.beta <= BETA_MAX)) return REASONS.RELATIVISTIC;
  if (el.r < obs.safeRadius || obs.atmoDensity > 0) return REASONS.ATMOSPHERE;
  if (obs.refBodyName !== state.goal.bodyName || !(obs.dominance >= DOM_MIN_HOLD)) return REASONS.REF_CHANGED;
  if (!(obs.maxThrustAccel > 0)) return REASONS.NO_FUEL;
  if (!(obs.dvBudget >= dvRemaining)) return REASONS.NO_FUEL;
  return null;
}

// ── state construction ──────────────────────────────────────────────────────
function _info(dvRemaining, tToIgnition, targetRadius, e, a) {
  return {
    dvRemaining: fin(dvRemaining, 0),
    tToIgnition: Number.isNaN(tToIgnition) ? Infinity : tToIgnition,
    targetRadius: fin(targetRadius, 0),
    e: fin(e, 0),
    a: Number.isNaN(a) ? 0 : a,
  };
}

function _terminal(state, phase, reason, info) {
  return {
    phase, goal: state.goal, leg: state.leg, trimCount: state.trimCount,
    elapsed: state.elapsed, phaseElapsed: state.phaseElapsed,
    armedInputSeq: state.armedInputSeq, orbitPeriod0: state.orbitPeriod0,
    manoeuvreTimeout: state.manoeuvreTimeout, burnEst0: state.burnEst0, lastTIgn: state.lastTIgn,
    reason: reason || null, announced: true, info: info || state.info,
  };
}

/** Engage. Runs the WHOLE refusal gate (§4) in fixed priority order. Returns
 *  either a working state (phase WAIT|BURN) or a state with phase REFUSED and
 *  `reason` filled in. Never throws, never returns null. */
export function engageAutopilot(goal, obs) {
  const g = Object.freeze({
    kind: goal && goal.kind === 'hohmann' ? 'hohmann' : 'circularize',
    bodyName: goal ? goal.bodyName : null,
    targetRadius: goal ? goal.targetRadius : undefined,
  });
  const safeObs = obs || _blankObs();
  const el = _elements(safeObs);
  const base = {
    phase: PHASES.IDLE, goal: g, leg: g.kind === 'hohmann' ? 'transfer' : 'circularize',
    trimCount: 0, elapsed: 0, phaseElapsed: 0,
    armedInputSeq: fin(safeObs.inputSeq, 0),
    orbitPeriod0: _period(safeObs.mu, el.a, el.bound),
    manoeuvreTimeout: MANOEUVRE_TIMEOUT_MAX,
    burnEst0: 0, lastTIgn: Infinity, reason: null, announced: false,
    info: _info(0, Infinity, g.kind === 'hohmann' ? g.targetRadius : el.r, el.e, el.a),
  };

  const bad = _gateAtEngage(g, safeObs, el);
  if (bad) {
    const st = _terminal(base, PHASES.REFUSED, bad, base.info);
    st.announced = false;                 // the first step announces ev.apRefused
    return st;
  }

  // Whole-manoeuvre deadline, frozen at engage. 12 revolutions of the STARTING
  // orbit is the right scale for a circularization, but NOT for a transfer:
  // Earth→Moon is a ~5-day coast from a ~2-hour parking orbit, so a deadline
  // built only from the parking period would abort every real transfer long
  // before it arrived. The transfer's own half-ellipse time is the honest
  // second scale; the 1e6 s cap of ТЗ §4 still bounds both.
  base.manoeuvreTimeout = _deadline(g, safeObs, el, base.orbitPeriod0);

  // Circularization burns HERE and NOW — the current radius is the target, so
  // there is no burn point to wait for. A transfer burns at an apsis.
  if (g.kind === 'circularize') {
    const dvRem = _deltaV(safeObs, 'circularize', el.r);
    base.phase = PHASES.BURN;
    base.burnEst0 = _burnEstimate(dvRem, safeObs.maxThrustAccel);
    base.info = _info(dvRem, Infinity, el.r, el.e, el.a);
  } else {
    // WAIT from the very first frame publishes a REAL countdown: the HUD must
    // never show "waiting · ∞" for a manoeuvre whose ignition time is known.
    base.phase = PHASES.WAIT;
    const plan = _ignitionPlan(base, safeObs, el, base.orbitPeriod0);
    base.info = _info(0, plan.fail ? Infinity : plan.tIgn, g.targetRadius, el.e, el.a);
  }
  return base;
}

// Whole-manoeuvre deadline (s of model time since engage).
function _deadline(goal, obs, el, period0) {
  let mt = period0 > 0 ? 12 * period0 : MANOEUVRE_TIMEOUT_MAX;
  if (goal.kind === 'hohmann' && Number.isFinite(goal.targetRadius) && el.r > 0 && obs.mu > 0) {
    const raising = goal.targetRadius > el.r;
    let r1 = raising ? el.rPeri : el.rApo;
    if (!Number.isFinite(r1) || !(r1 > 0)) r1 = el.r;
    const aT = 0.5 * (r1 + goal.targetRadius);
    const tTrans = Math.PI * Math.sqrt((aT * aT * aT) / obs.mu);
    if (Number.isFinite(tTrans)) mt = Math.max(mt, 3 * tTrans);
  }
  return Math.min(MANOEUVRE_TIMEOUT_MAX, mt);
}

// Rough burn duration for centring the ignition and for BURN_TIMEOUT. Uses the
// NOMINAL schedule (a short frame, so TAPER_T governs) — this is a plan, not a
// command, so the measure-a-step-first rule of _throttleFor does not apply.
function _burnEstimate(dv, aAvail) {
  if (!(aAvail > 0) || !Number.isFinite(aAvail)) return 0;
  const a = _workingAccel(dv, aAvail, 0, false);
  if (!(a > 0) || !Number.isFinite(a)) return 0;
  const t = dv / a;
  return Number.isFinite(t) ? t : 0;
}

function _blankObs() {
  return {
    mu: 0, bodyRadius: 0, safeRadius: 0, rVec: _apZeroR.set(0, 0, 0), vVec: _apZeroV.set(0, 0, 0),
    maxThrustAccel: 0, dvBudget: 0, beta: 0, landed: false, atmoDensity: 0,
    dominance: 0, refBodyName: null, inputSeq: 0, dtReal: 1 / 60,
  };
}

// ── ignition planning (the ONE place that answers "which apsis, and when") ───
// Shared by engageAutopilot and every entry into WAIT, so a WAIT command can
// never publish a countdown nobody computed. `st` supplies .leg and .goal.
// Returns { tToApsis, rApsis, burnEst, tIgn, noApsis, fail } — `fail` set only
// when the circularization apsis cannot be reconciled with the target radius.
function _ignitionPlan(st, o, el, T) {
  const rdotv = o.rVec.dot(o.vVec);
  const h = _apH.crossVectors(o.rVec, o.vVec).length();
  const eps = 0.5 * o.vVec.lengthSq() - o.mu / el.r;
  let tToApsis, rApsis;

  if (st.leg === 'transfer') {
    // Burn at the apsis OPPOSITE the target: raising ⇒ periapsis, lowering ⇒ apoapsis.
    const raising = st.goal.targetRadius > el.r;
    rApsis = raising ? el.rPeri : el.rApo;
    tToApsis = raising ? timeToPeriapsis(o.mu, el.r, rdotv, h, eps)
                       : timeToApoapsis(o.mu, el.r, rdotv, h, eps);
  } else {
    // Circularization leg: the apsis whose radius is closest to the target. If
    // NEITHER lands within R_TOL the transfer came out wrong — say so rather
    // than wait forever.
    const dPeri = Math.abs(el.rPeri - st.goal.targetRadius) / st.goal.targetRadius;
    const dApo = Math.abs(el.rApo - st.goal.targetRadius) / st.goal.targetRadius;
    if (!(Math.min(dPeri, dApo) <= R_TOL)) return { fail: REASONS.NO_CONVERGENCE };
    const usePeri = dPeri <= dApo;
    rApsis = usePeri ? el.rPeri : el.rApo;
    tToApsis = usePeri ? timeToPeriapsis(o.mu, el.r, rdotv, h, eps)
                       : timeToApoapsis(o.mu, el.r, rdotv, h, eps);
  }

  // Burn length at that apsis, so ignition is CENTRED on it (halves the
  // end-of-burn timing error compared with starting AT the apsis).
  const vApsis = Number.isFinite(rApsis) && rApsis > 0 && Number.isFinite(el.a) && el.a !== 0
    ? _speedAt(o.mu, rApsis, el.a) : NaN;
  const dvLeg = Number.isFinite(vApsis)
    ? (st.leg === 'transfer' ? _legDv(o.mu, rApsis, st.goal.targetRadius, vApsis)
                             : Math.abs(Math.sqrt(o.mu / rApsis) - vApsis))
    : 0;
  const burnEst = _burnEstimate(dvLeg, o.maxThrustAccel);

  // A (near-)circular orbit has no distinguishable apsis (timeToPeriapsis
  // returns Infinity) — but EVERY point is one, so the countdown is zero.
  const noApsis = !Number.isFinite(tToApsis);
  const tIgn = noApsis ? 0 : Math.max(0, tToApsis - 0.5 * burnEst);
  return { tToApsis, rApsis, burnEst, tIgn, noApsis, fail: null };
}

// One step of WAIT. Reached from the WAIT phase AND from the transfer-leg
// cutoff, so both go through the same countdown — the leg switch used to hand
// back a WAIT command with a placeholder tToIgnition of Infinity, i.e. a number
// nobody had computed, straight into the HUD.
function _waitStep(st, o, el, T, dtS, outDir, prevTIgn) {
  const plan = _ignitionPlan(st, o, el, T);
  if (plan.fail) {
    const bad = _terminal(st, PHASES.FAILED, plan.fail,
                          _info(0, Infinity, st.goal.targetRadius, el.e, el.a));
    return _cmd(bad, 0, null, Infinity, 'ev.apFailed');
  }
  const sinceApsis = (!plan.noApsis && T > 0) ? T - plan.tToApsis : Infinity;
  // Ignition is a WINDOW, never an equality on a discrete grid; and an apsis
  // just missed is burnt LATE rather than waited out for a whole extra lap.
  const ignite = plan.noApsis || plan.tIgn <= Math.max(0, dtS) ||
                 (T > 0 && sinceApsis <= LATE_FRAC * T);
  if (ignite) {
    st.phase = PHASES.BURN;
    st.phaseElapsed = 0;
    st.burnEst0 = plan.burnEst;
    st.lastTIgn = Infinity;
    const targetRadius = st.leg === 'transfer' ? st.goal.targetRadius : el.r;
    const dvNow = _deltaV(o, st.leg, targetRadius);
    st.info = _info(dvNow, Infinity, targetRadius, el.e, el.a);
    const th = _throttleFor(dvNow, o.maxThrustAccel, dtS, o.dtReal, false);
    const ok = dvNow > 0 && th > 0 && _dirFromDv(outDir);
    return _cmd(st, ok ? th : 0, ok ? outDir : null, 1, null);
  }

  // Still waiting. Cap the effective warp so at least WAIT_LEAD_FRAMES frames
  // remain before ignition — the analytic coast still runs (throttle is 0) and
  // advances EXACTLY along the conic, so waiting costs no accuracy.
  const frame = Math.max(fin(o.dtReal, 1 / 60), 1 / 240);
  const maxWarp = clamp(plan.tIgn / (WAIT_LEAD_FRAMES * frame), 1, MAX_WARP_CAP);
  // A lap went by without igniting (frame freeze, or the warp cap lost the
  // race): announce it rather than silently orbiting again.
  const lapped = Number.isFinite(prevTIgn) && plan.tIgn > prevTIgn + 0.5 * (T || Infinity);
  st.lastTIgn = plan.tIgn;
  st.info = _info(0, plan.tIgn, st.goal.targetRadius, el.e, el.a);
  return _cmd(st, 0, null, maxWarp, lapped ? 'ev.apEngaged' : null);
}

const TERMINAL = { DONE: 1, CANCELLED: 1, REFUSED: 1, FAILED: 1 };
const _isTerminal = (phase) => TERMINAL[phase] === 1;

// i18n key announced once when a phase becomes terminal (or on engage).
function _eventKey(phase) {
  switch (phase) {
    case PHASES.DONE: return 'ev.apDone';
    case PHASES.CANCELLED: return 'ev.apCancelled';
    case PHASES.REFUSED: return 'ev.apRefused';
    case PHASES.FAILED: return 'ev.apFailed';
    default: return 'ev.apEngaged';
  }
}

function _cmd(state, throttle, dir, maxWarp, event) {
  const done = _isTerminal(state.phase);
  const th = done ? 0 : (Number.isFinite(throttle) ? clamp(throttle, 0, 1) : 0);
  const useDir = !done && th > 0 && dir !== null;
  // maxWarp: >= 1 always; Infinity is allowed (means "no cap"), anything else
  // non-finite (NaN) degrades to 1 rather than leaking into main.js's min().
  let mw;
  if (done || maxWarp === Infinity) mw = Infinity;
  else mw = Number.isFinite(maxWarp) ? Math.max(1, maxWarp) : 1;
  return {
    state, phase: state.phase, thrustDir: useDir ? dir : null,
    throttle: useDir ? th : 0, maxWarp: mw, event: event || null, done,
  };
}

/** ONE step. PURE: `state` and `obs` are not mutated; the single side effect is
 *  writing the thrust direction into the caller-provided `outDir` (main.js's
 *  DEDICATED `_apDir`, ГРАБЛИ #1).
 *  @param dt seconds of MODEL time actually integrated since the previous step
 *            (0 on the first step — see ТЗ §3.5 on the causality break).
 *  Output invariants (i)–(vi) of ТЗ §2.2 hold for every input, including
 *  degenerate ones: finite throttle in [0,1]; throttle>0 ⟺ thrustDir≠null;
 *  a non-null thrustDir is finite and unit; maxWarp ≥ 1; done ⇒ no thrust;
 *  and throttle·maxThrustAccel·dt ≤ dvRemaining (never overshoot). */
export function autopilotStep(state, obs, dt, outDir) {
  if (!state) {
    const idle = { phase: PHASES.IDLE, goal: null, leg: 'circularize', trimCount: 0,
                   elapsed: 0, phaseElapsed: 0, armedInputSeq: 0, orbitPeriod0: 0,
                   burnEst0: 0, lastTIgn: Infinity, reason: null, announced: true,
                   info: _info(0, Infinity, 0, 0, 0) };
    return _cmd(idle, 0, null, Infinity, null);
  }
  const o = obs || _blankObs();

  // Already terminal: idempotent. The announcement fires exactly once — the
  // step that CAUSED the transition normally carries it, but an engage-time
  // REFUSED has no such step, so the flag is what makes both paths identical.
  if (_isTerminal(state.phase)) {
    if (!state.announced) {
      const st = _terminal(state, state.phase, state.reason, state.info);
      return _cmd(st, 0, null, Infinity, _eventKey(state.phase));
    }
    return _cmd(state, 0, null, Infinity, null);
  }

  const dtS = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const elapsed = state.elapsed + dtS;
  const phaseElapsed = state.phaseElapsed + dtS;
  const el = _elements(o);
  const T = _period(o.mu, el.a, el.bound);

  // --- pilot override: ONE counter, ONE condition, ONE reader (ТЗ §5) -------
  // Read here and nowhere else; main.js never compares input counters.
  if (o.inputSeq !== state.armedInputSeq) {
    const st = _terminal({ ...state, elapsed, phaseElapsed }, PHASES.CANCELLED, null,
                         _info(0, Infinity, state.info.targetRadius, el.e, el.a));
    return _cmd(st, 0, null, Infinity, 'ev.apCancelled');
  }

  const targetRadius = state.goal.kind === 'hohmann' && state.leg === 'transfer'
    ? state.goal.targetRadius : el.r;
  const burning = state.phase === PHASES.BURN || state.phase === PHASES.TRIM;
  const dvRemaining = burning ? _deltaV(o, state.leg, targetRadius) : 0;

  // --- continuous honesty checks -------------------------------------------
  const bad = _gateInFlight(state, o, el, dvRemaining);
  if (bad) {
    const st = _terminal({ ...state, elapsed, phaseElapsed }, PHASES.FAILED, bad,
                         _info(0, Infinity, state.info.targetRadius, el.e, el.a));
    return _cmd(st, 0, null, Infinity, 'ev.apFailed');
  }
  // Timeouts. BURN_TIMEOUT is per-burn; MANOEUVRE_TIMEOUT bounds the whole job
  // (12 orbits, or 1e6 s when the starting orbit was unbound).
  //
  // SUCCESS IS JUDGED BEFORE THE CLOCK. A step that has already met its cutoff
  // is progress, not stagnation — reading the clock first lets a manoeuvre that
  // has ACHIEVED its target be reported FAILED(timeout) (measured at dt = 60 s:
  // e = 9.8e-5, a = 8.0099e6, target reached in 3 frames, killed on frame 3
  // because 3 × 60 s > the 120 s burn deadline). A timeout must mean "this is
  // not converging", never "it converged and I looked at my watch first".
  //
  // The deadline also can never be shorter than a handful of the CALLER's own
  // frames: at a 60 s frame a 120 s deadline resolves to two samples, so it
  // would be measuring the caller's granularity rather than non-convergence.
  const eps0 = burning ? dvEps(o.mu, el.r) : 0;
  const cutoffReached = burning && dvRemaining <= eps0;
  const burnTimeout = Math.max(BURN_TIMEOUT_MIN, 8 * state.burnEst0, BURN_TIMEOUT_FRAMES * dtS);
  const manoeuvreTimeout = fin(state.manoeuvreTimeout, MANOEUVRE_TIMEOUT_MAX);
  if (!cutoffReached && ((burning && phaseElapsed > burnTimeout) || elapsed > manoeuvreTimeout)) {
    const st = _terminal({ ...state, elapsed, phaseElapsed }, PHASES.FAILED, REASONS.TIMEOUT,
                         _info(0, Infinity, state.info.targetRadius, el.e, el.a));
    return _cmd(st, 0, null, Infinity, 'ev.apFailed');
  }

  const next = { ...state, elapsed, phaseElapsed };

  // ── WAIT ────────────────────────────────────────────────────────────────
  if (state.phase === PHASES.WAIT) {
    return _waitStep(next, o, el, T, dtS, outDir, state.lastTIgn);
  }

  // ── BURN / TRIM: one law, two thrust budgets ─────────────────────────────
  if (cutoffReached) {
    // Cutoff reached — decided by the ACHIEVED STATE, not by a Δv counter.
    if (state.leg === 'transfer') {
      // First leg done: coast to the far apsis, then circularize there. Routed
      // through the SAME _waitStep as any other entry into WAIT so the published
      // countdown is a computed number, not a placeholder.
      next.leg = 'circularize';
      next.phase = PHASES.WAIT;
      next.phaseElapsed = 0;
      next.lastTIgn = Infinity;
      return _waitStep(next, o, el, T, dtS, outDir, Infinity);
    }
    if (el.e <= E_TOL && el.bound === true) {
      next.phase = PHASES.DONE;
      next.phaseElapsed = 0;
      next.announced = true;
      next.info = _info(0, Infinity, el.r, el.e, el.a);
      return _cmd(next, 0, null, Infinity, 'ev.apDone');
    }
    // Out of tolerance: trim, up to TRIM_MAX passes, then admit it.
    if (state.trimCount >= TRIM_MAX) {
      const st = _terminal(next, PHASES.FAILED, REASONS.NO_CONVERGENCE,
                           _info(0, Infinity, el.r, el.e, el.a));
      return _cmd(st, 0, null, Infinity, 'ev.apFailed');
    }
    next.phase = PHASES.TRIM;
    next.trimCount = state.trimCount + 1;
    next.phaseElapsed = 0;
    next.info = _info(dvRemaining, Infinity, el.r, el.e, el.a);
    return _cmd(next, 0, null, 1, null);
  }

  const trim = state.phase === PHASES.TRIM;
  const th = _throttleFor(dvRemaining, o.maxThrustAccel, dtS, o.dtReal, trim);
  const ok = th > 0 && _dirFromDv(outDir);
  next.info = _info(dvRemaining, Infinity, state.leg === 'transfer' ? state.goal.targetRadius : el.r, el.e, el.a);
  return _cmd(next, ok ? th : 0, ok ? outDir : null, 1, null);
}

// Normalize _apDv into the caller's outDir. FALSE (⇒ no thrust this frame) if
// the direction is degenerate — invariant (ii) is kept by the caller then
// commanding zero throttle, never a NaN direction.
function _dirFromDv(outDir) {
  if (!outDir) return false;
  const m = _apDv.length();
  if (!(m > 0) || !Number.isFinite(m)) return false;
  outDir.copy(_apDv).multiplyScalar(1 / m);
  if (!Number.isFinite(outDir.x) || !Number.isFinite(outDir.y) || !Number.isFinite(outDir.z)) return false;
  return Math.abs(outDir.lengthSq() - 1) < 1e-9;
}

/** The i18n key for this state's HUD line — the ONE phase/reason → key table in
 *  the project. hud.js calls it instead of repeating the mapping. */
export function autopilotHudKey(state) {
  const phase = state && state.phase ? state.phase : PHASES.IDLE;
  switch (phase) {
    case PHASES.WAIT: return 'ap.phase.wait';
    case PHASES.BURN: return 'ap.phase.burn';
    case PHASES.TRIM: return 'ap.phase.trim';
    case PHASES.DONE: return 'ap.phase.done';
    case PHASES.CANCELLED: return 'ap.phase.cancelled';
    case PHASES.REFUSED: return 'ap.phase.refused';
    case PHASES.FAILED: return 'ap.phase.failed';
    default: return 'ap.phase.idle';
  }
}

/** Impure adapter (live objects → a flat observation). It lives HERE, not in
 *  main.js, so that it is covered by the node gate.
 *  Writes into MODULE-PRIVATE scratch (_apR/_apV/_apBVel): the result is valid
 *  ONLY until the next buildObs() call — main.js must consume it the same frame
 *  and never store it (ГРАБЛИ #1). */
export function buildObs(ship, bodies, positions, byName, simTime, inputSeq, dtReal) {
  const refB = ship.refBody || dominantBody(ship.pos, bodies, positions);
  const bp = refB ? positions.get(refB.name) : null;
  if (!refB || !bp) {
    const blank = _blankObs();
    blank.inputSeq = fin(inputSeq, 0);
    blank.dtReal = fin(dtReal, 1 / 60);
    blank.landed = !!(ship.landed || ship.crashed);
    blank.maxThrustAccel = ship.maxThrustAccel;
    blank.dvBudget = ship.mode === 'realistic' ? ship.deltaVBudget() : Infinity;
    blank.beta = ship.beta;
    return blank;
  }
  _apR.subVectors(ship.pos, bp);
  bodyVelocity(refB, simTime, byName, _apBVel);
  _apV.subVectors(ship.v, _apBVel);
  const vRelBeta = _apV.length() / C;
  return {
    mu: refB.GM,
    bodyRadius: refB.radius,
    safeRadius: safeRadius(refB),
    rVec: _apR,
    vVec: _apV,
    maxThrustAccel: ship.maxThrustAccel,
    dvBudget: ship.mode === 'realistic' ? ship.deltaVBudget() : Infinity,
    beta: Math.max(ship.beta, Number.isFinite(vRelBeta) ? vRelBeta : 0),
    landed: !!(ship.landed || ship.crashed),
    atmoDensity: ship.atmoDensity,
    dominance: dominanceRatio(ship.pos, refB, bodies, positions),
    refBodyName: refB.name,
    inputSeq: fin(inputSeq, 0),
    dtReal: fin(dtReal, 1 / 60),
  };
}
