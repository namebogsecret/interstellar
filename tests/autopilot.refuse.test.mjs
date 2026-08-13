// Autopilot · REFUSAL GATE and in-flight FAILURE contract
// (ТЗ волна B · B1 §4 + §7.3 «и», «к», «л», «м»).
//
// Every case is a separate assertion of an EXACT reason code, and the fixed
// priority order is tested on states that violate two rules at once: a refusal
// gate whose order drifts answers the wrong question ("orbit is not closed"
// instead of "I don't do relativistic speeds") — §4.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import {
  PHASES, REASONS, MU_EARTH, SAFE_R_EARTH, C_LIGHT,
  conicState, makeObs, engageAutopilot, autopilotStep, runClosedLoop, fixedSchedule,
  assertCommandInvariants,
} from './autopilot.harness.mjs';

const mu = MU_EARTH;
const R_PERI = 8.0e6;
const GOAL_CIRC = { kind: 'circularize', bodyName: 'Earth' };
const goalHohmann = (rt) => ({ kind: 'hohmann', bodyName: 'Earth', targetRadius: rt });

const st03 = conicState(mu, 0.3, R_PERI, 0);        // healthy baseline, e = 0.3
const stHyper = conicState(mu, 1.2, R_PERI, 0);     // unbound fixture

function engageWith(over, goal = GOAL_CIRC, st = st03, label = '') {
  const obs = makeObs(st.r.clone(), st.v.clone(), over);
  let state;
  try {
    state = engageAutopilot(goal, obs);
  } catch (err) {
    assert.fail(`${label}: engageAutopilot threw ${err && err.message}`);
  }
  assert.ok(state && typeof state === 'object',
    `${label}: engageAutopilot must never return null/undefined`);
  return { state, obs };
}

function assertRefused(over, reason, { goal = GOAL_CIRC, st = st03, label }) {
  const { state, obs } = engageWith(over, goal, st, label);
  assert.equal(state.phase, PHASES.REFUSED,
    `${label}: expected REFUSED, got ${state.phase} (reason=${state.reason})`);
  assert.equal(state.reason, reason,
    `${label}: expected reason '${reason}', got '${state.reason}'`);

  // A refusal is terminal: stepping it must stay put, silent and thrust-free.
  const cmd = autopilotStep(state, obs, 0.05, new THREE.Vector3());
  assertCommandInvariants(cmd, obs, 0.05, `${label} (post-refusal step)`);
  assert.equal(cmd.phase, PHASES.REFUSED, `${label}: refusal must be terminal`);
  assert.equal(cmd.done, true, `${label}: refusal must report done`);
  assert.equal(cmd.throttle, 0, `${label}: refusal must not thrust`);
  assert.equal(cmd.thrustDir, null, `${label}: refusal must not publish a thrust direction`);
  assert.equal(cmd.state.reason, reason, `${label}: reason must survive the step`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (и) every REFUSED case of the §4 table, one by one
// ═════════════════════════════════════════════════════════════════════════════

// 1 · on the surface
assertRefused({ landed: true }, REASONS.LANDED, { label: '(и) landed' });

// 2 · no reference body — three independent spellings of "there is nothing to orbit"
assertRefused({ refBodyName: null }, REASONS.NO_BODY, { label: '(и) no refBodyName' });
assertRefused({ mu: 0 }, REASONS.NO_BODY, { label: '(и) mu = 0' });
assertRefused({ rVec: new THREE.Vector3(0, 0, 0) }, REASONS.NO_BODY, { label: '(и) |r| = 0' });

// 3 · relativistic: 0.02c tangentially (β = 0.02 > BETA_MAX = 0.01)
{
  const vRel = st03.v.clone().normalize().multiplyScalar(0.02 * C_LIGHT);
  assertRefused({ vVec: vRel }, REASONS.RELATIVISTIC, { label: '(и) β = 0.02 from vVec' });
  // ...and the same via the heliocentric β channel, with a perfectly normal vVec
  assertRefused({ beta: 0.02 }, REASONS.RELATIVISTIC, { label: '(и) β = 0.02 heliocentric' });
}

// 4 · atmosphere, both channels (geometry and density are INDEPENDENT signals, §4/R6)
{
  const rLow = st03.r.clone().normalize().multiplyScalar(SAFE_R_EARTH * 0.98);
  const vLow = st03.v.clone();                      // magnitude is irrelevant to the gate
  assertRefused({ rVec: rLow, vVec: vLow }, REASONS.ATMOSPHERE,
    { label: '(и) |r| below safeRadius' });
  assertRefused({ atmoDensity: 1e-3 }, REASONS.ATMOSPHERE,
    { label: '(и) non-zero atmospheric density at 8e6 m' });
}

// 5 · perturbed: dominance below DOM_MIN_ENGAGE = 10
assertRefused({ dominance: 3 }, REASONS.PERTURBED, { label: '(и) dominance = 3' });
assertRefused({ dominance: 9.99 }, REASONS.PERTURBED, { label: '(и) dominance just under 10' });

// 6 · Hohmann from an unbound orbit
assertRefused({}, REASONS.UNBOUND,
  { goal: goalHohmann(2.0e7), st: stHyper, label: '(и) hohmann from e = 1.2' });

// 7 · target radius unreachable
assertRefused({}, REASONS.TARGET_UNREACHABLE,
  { goal: goalHohmann(5.0e6), label: '(и) target below the surface (5.0e6 < safeRadius)' });
for (const bad of [NaN, Infinity, -1, 0, undefined]) {
  assertRefused({}, REASONS.TARGET_UNREACHABLE,
    { goal: goalHohmann(bad), label: `(и) target radius = ${bad}` });
}

// 8 · fuel
assertRefused({ maxThrustAccel: 0.30, dvBudget: 100 }, REASONS.NO_FUEL,
  { label: '(и) realistic Δv budget 100 < required 989.5·1.1' });
assertRefused({ maxThrustAccel: 0 }, REASONS.NO_FUEL, { label: '(и) empty tank (aAvail = 0)' });

// A budget that clears the 1.1 margin must NOT be refused — otherwise the gate
// above would pass for the wrong reason (everything refused is not a gate).
{
  const { state } = engageWith({ maxThrustAccel: 0.30, dvBudget: 5000 }, GOAL_CIRC, st03,
    '(и) control: sufficient budget');
  assert.notEqual(state.phase, PHASES.REFUSED,
    `(и) control: a 5000 m/s budget must be accepted, got REFUSED(${state.reason})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (к) PRIORITY — a state breaking two rules must answer with the UPPER one
// ═════════════════════════════════════════════════════════════════════════════
{
  // 3 before 6: 0.02c is both relativistic and unbound → "relativistic"
  const vRel = st03.v.clone().normalize().multiplyScalar(0.02 * C_LIGHT);
  assertRefused({ vVec: vRel }, REASONS.RELATIVISTIC,
    { goal: goalHohmann(2.0e7), label: '(к) relativistic + unbound → relativistic' });

  // 1 before 4: landed inside the atmosphere → "landed"
  const rLow = st03.r.clone().normalize().multiplyScalar(SAFE_R_EARTH * 0.9);
  assertRefused({ landed: true, rVec: rLow, atmoDensity: 1.0 }, REASONS.LANDED,
    { label: '(к) landed + atmosphere → landed' });

  // 1 before 2: landed with no reference body → "landed"
  assertRefused({ landed: true, refBodyName: null }, REASONS.LANDED,
    { label: '(к) landed + no body → landed' });

  // 3 before 5: relativistic in a perturbed region → "relativistic"
  assertRefused({ beta: 0.02, dominance: 2 }, REASONS.RELATIVISTIC,
    { label: '(к) relativistic + perturbed → relativistic' });

  // 4 before 8: inside the atmosphere with an empty tank → "atmosphere"
  assertRefused({ atmoDensity: 1e-3, maxThrustAccel: 0 }, REASONS.ATMOSPHERE,
    { label: '(к) atmosphere + no fuel → atmosphere' });
}

// ═════════════════════════════════════════════════════════════════════════════
// (л) FAILED IN FLIGHT — the same conditions discovered mid-burn
// ═════════════════════════════════════════════════════════════════════════════
function failMidBurn(override, reason, label) {
  const res = runClosedLoop({
    mu, r0: st03.r.clone(), v0: st03.v.clone(), goal: GOAL_CIRC,
    dtOf: fixedSchedule(0.05), maxSteps: 40000, label,
    obsOverrides: (o, ctx) => (
      ctx.state && ctx.state.phase === PHASES.BURN && ctx.state.phaseElapsed >= 2
        ? override : undefined),
  });
  assert.equal(res.state.phase, PHASES.FAILED,
    `${label}: expected FAILED, got ${res.state.phase} (reason=${res.state.reason})`);
  assert.equal(res.state.reason, reason,
    `${label}: expected reason '${reason}', got '${res.state.reason}'`);
  assert.equal(res.lastCmd.throttle, 0, `${label}: failure must cut the throttle`);
  assert.equal(res.lastCmd.thrustDir, null, `${label}: failure must drop thrustDir`);
  assert.equal(res.lastCmd.done, true, `${label}: failure must report done`);
  // it really was mid-burn, not a refusal in disguise
  assert.ok(res.phases.includes(PHASES.BURN), `${label}: the run never burned at all`);
  assert.ok(res.simTime >= 2, `${label}: failed after only ${res.simTime} s of model time`);
  return res;
}

failMidBurn({ refBodyName: 'Moon' }, REASONS.REF_CHANGED, '(л) reference body swapped');
failMidBurn({ dominance: 3 }, REASONS.REF_CHANGED, '(л) dominance fell below DOM_MIN_HOLD');
failMidBurn({ beta: 0.02 }, REASONS.RELATIVISTIC, '(л) accelerated past BETA_MAX');
failMidBurn({ atmoDensity: 1e-3 }, REASONS.ATMOSPHERE, '(л) entered the atmosphere');
failMidBurn({ maxThrustAccel: 0 }, REASONS.NO_FUEL, '(л) tank ran dry mid-burn');

// Hysteresis: DOM_MIN_HOLD = 5 is LOOSER than DOM_MIN_ENGAGE = 10 — a dominance
// of 7 mid-burn must NOT abort (that is the whole point of two thresholds, R7).
{
  const label = '(л) control: dominance 7 keeps flying';
  const res = runClosedLoop({
    mu, r0: st03.r.clone(), v0: st03.v.clone(), goal: GOAL_CIRC,
    dtOf: fixedSchedule(0.05), maxSteps: 40000, label,
    obsOverrides: (o, ctx) => (
      ctx.state && ctx.state.phase === PHASES.BURN && ctx.state.phaseElapsed >= 2
        ? { dominance: 7 } : undefined),
  });
  assert.equal(res.state.phase, PHASES.DONE,
    `${label}: expected DONE (5 < 7 < 10), got ${res.state.phase} (reason=${res.state.reason})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (м) FAILED by timeout — an impossible manoeuvre must end, in FINITE steps
// ═════════════════════════════════════════════════════════════════════════════
{
  // Headroom for either reading of MANOEUVRE_TIMEOUT (§4 says min(1e6, 12·T0)
  // = 1.46e5 s here; a max() reading gives 1e6 s = 16 667 frames at dt = 60).
  const MAX_STEPS = 40000;
  const res = runClosedLoop({
    mu, r0: st03.r.clone(), v0: st03.v.clone(), goal: GOAL_CIRC,
    // 1e-4 m/s² needs 1.1e7 s for 989.5 m/s — far beyond MANOEUVRE_TIMEOUT
    // (12 · orbitPeriod0 ≈ 1.46e5 s). Budget is ample, so this is NOT a fuel case.
    obsBase: { maxThrustAccel: 1e-4, dvBudget: 1e5 },
    dtOf: fixedSchedule(60), maxSteps: MAX_STEPS, label: '(м) timeout',
  });
  assert.equal(res.state.phase, PHASES.FAILED,
    `(м) expected FAILED, got ${res.state.phase} (reason=${res.state.reason})`);
  assert.equal(res.state.reason, REASONS.TIMEOUT,
    `(м) expected reason 'timeout', got '${res.state.reason}'`);
  assert.ok(res.steps < MAX_STEPS,
    `(м) did not terminate on its own: ran the full ${MAX_STEPS} steps`);
  assert.equal(res.lastCmd.throttle, 0, '(м) timeout must cut the throttle');
  assert.equal(res.lastCmd.thrustDir, null, '(м) timeout must drop thrustDir');
}

console.log('autopilot.refuse OK');
