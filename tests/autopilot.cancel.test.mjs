// Autopilot · PILOT-CANCELLATION contract (ТЗ волна B · B1 §5 + §7.3 «з»).
//
// One counter, one condition, one reader: obs.inputSeq !== state.armedInputSeq
// is evaluated INSIDE the pure core. These tests therefore never touch
// controls.js — they prove the core reacts, which is what makes "N reporters"
// safe to add later.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import {
  PHASES, REASONS, MU_EARTH,
  conicState, circularState, makeObs, engageAutopilot, autopilotStep,
  runClosedLoop, fixedSchedule, warpAwareSchedule, assertCommandInvariants,
} from './autopilot.harness.mjs';

const mu = MU_EARTH;
const R_PERI = 8.0e6;
const GOAL_CIRC = { kind: 'circularize', bodyName: 'Earth' };
const st03 = conicState(mu, 0.3, R_PERI, 0);

const midBurnBump = (o, ctx) => (
  ctx.state && ctx.state.phase === PHASES.BURN && ctx.state.phaseElapsed >= 2
    ? { inputSeq: o.inputSeq + 1 } : undefined);

// ═════════════════════════════════════════════════════════════════════════════
// (з) cancellation in the middle of a burn
// ═════════════════════════════════════════════════════════════════════════════
const cancelled = runClosedLoop({
  mu, r0: st03.r.clone(), v0: st03.v.clone(), goal: GOAL_CIRC,
  dtOf: fixedSchedule(0.05), maxSteps: 40000, label: '(з) cancel mid-burn',
  obsOverrides: midBurnBump,
});

assert.ok(cancelled.phases.includes(PHASES.BURN), '(з) the run must actually have burned');
assert.equal(cancelled.state.phase, PHASES.CANCELLED,
  `(з) expected CANCELLED, got ${cancelled.state.phase} (reason=${cancelled.state.reason})`);
assert.equal(cancelled.lastCmd.throttle, 0, '(з) cancellation must cut the throttle');
assert.equal(cancelled.lastCmd.thrustDir, null, '(з) cancellation must drop thrustDir');
assert.equal(cancelled.lastCmd.done, true, '(з) cancellation is terminal → done');
assert.equal(cancelled.lastCmd.event, 'ev.apCancelled',
  `(з) expected the one-shot event 'ev.apCancelled', got '${cancelled.lastCmd.event}'`);
// it stopped where the pilot intervened, not at the end of the manoeuvre
assert.ok(cancelled.simTime < 60,
  `(з) cancellation should be immediate, but ${cancelled.simTime} s of model time elapsed`);
assert.ok(cancelled.elements.e > 1e-3,
  `(з) the orbit must NOT be finished after a cancellation (e = ${cancelled.elements.e})`);

// ── idempotence: three more steps change nothing and stay silent ──────────────
{
  let state = cancelled.state;
  const dir = new THREE.Vector3();
  for (let k = 0; k < 3; k++) {
    const obs = makeObs(cancelled.r.clone(), cancelled.v.clone(),
      { inputSeq: 1 + cancelled.lastCmd.state.armedInputSeq });
    const cmd = autopilotStep(state, obs, 0.05, dir);
    assertCommandInvariants(cmd, obs, 0.05, `(з) idempotence step ${k}`);
    assert.equal(cmd.phase, PHASES.CANCELLED, `(з) step ${k}: must stay CANCELLED`);
    assert.equal(cmd.throttle, 0, `(з) step ${k}: must stay thrust-free`);
    assert.equal(cmd.thrustDir, null, `(з) step ${k}: thrustDir must stay null`);
    assert.equal(cmd.done, true, `(з) step ${k}: must stay done`);
    assert.equal(cmd.event, null,
      `(з) step ${k}: the cancellation event must fire ONCE, got '${cmd.event}'`);
    assert.equal(cmd.state.reason, cancelled.state.reason,
      `(з) step ${k}: reason must not drift`);
    state = cmd.state;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// (з-2) DONE is NOT downgraded to CANCELLED by the same trick
// ═════════════════════════════════════════════════════════════════════════════
{
  const done = runClosedLoop({
    mu, r0: st03.r.clone(), v0: st03.v.clone(), goal: GOAL_CIRC,
    dtOf: fixedSchedule(0.05), maxSteps: 40000, label: '(з-2) finish first',
  });
  assert.equal(done.state.phase, PHASES.DONE, '(з-2) precondition: the run must reach DONE');

  const obs = makeObs(done.r.clone(), done.v.clone(), { inputSeq: 999 });
  const cmd = autopilotStep(done.state, obs, 0.05, new THREE.Vector3());
  assertCommandInvariants(cmd, obs, 0.05, '(з-2) post-DONE input');
  assert.equal(cmd.phase, PHASES.DONE,
    `(з-2) a finished manoeuvre must stay DONE, got ${cmd.phase}`);
  assert.equal(cmd.throttle, 0, '(з-2) DONE must stay thrust-free');
  assert.equal(cmd.thrustDir, null, '(з-2) DONE must keep thrustDir null');
}

// ═════════════════════════════════════════════════════════════════════════════
// (з-3) armedInputSeq is frozen AT ENGAGE, not at the first step
//       (a counter that starts non-zero must not read as "already cancelled")
// ═════════════════════════════════════════════════════════════════════════════
{
  const obs0 = makeObs(st03.r.clone(), st03.v.clone(), { inputSeq: 42 });
  const state = engageAutopilot(GOAL_CIRC, obs0);
  assert.notEqual(state.phase, PHASES.REFUSED,
    `(з-3) a healthy state must engage, got REFUSED(${state.reason})`);
  assert.equal(state.armedInputSeq, 42,
    `(з-3) armedInputSeq must be captured at engage, got ${state.armedInputSeq}`);

  // same counter → no cancellation, even several steps in
  let s = state;
  for (let k = 0; k < 5; k++) {
    const obs = makeObs(st03.r.clone(), st03.v.clone(), { inputSeq: 42 });
    const cmd = autopilotStep(s, obs, 0.05, new THREE.Vector3());
    assertCommandInvariants(cmd, obs, 0.05, `(з-3) unchanged counter step ${k}`);
    assert.notEqual(cmd.phase, PHASES.CANCELLED,
      `(з-3) step ${k}: an unchanged inputSeq must not cancel anything`);
    s = cmd.state;
  }

  // counter moves → cancelled on the very next command
  const obsBump = makeObs(st03.r.clone(), st03.v.clone(), { inputSeq: 43 });
  const cmd = autopilotStep(s, obsBump, 0.05, new THREE.Vector3());
  assert.equal(cmd.phase, PHASES.CANCELLED,
    `(з-3) inputSeq 42 → 43 must cancel, got ${cmd.phase}`);
  assert.equal(cmd.event, 'ev.apCancelled', '(з-3) cancellation announces itself once');
}

// ═════════════════════════════════════════════════════════════════════════════
// (з-4) cancellation outranks everything except an already-terminal phase (§5)
// ═════════════════════════════════════════════════════════════════════════════
{
  // pilot input AND an atmosphere breach discovered on the same frame → CANCELLED,
  // not FAILED(atmosphere): the pilot asked for control back and got it.
  const res = runClosedLoop({
    mu, r0: st03.r.clone(), v0: st03.v.clone(), goal: GOAL_CIRC,
    dtOf: fixedSchedule(0.05), maxSteps: 40000, label: '(з-4) cancel outranks failure',
    obsOverrides: (o, ctx) => (
      ctx.state && ctx.state.phase === PHASES.BURN && ctx.state.phaseElapsed >= 2
        ? { inputSeq: o.inputSeq + 1, atmoDensity: 1e-3, dominance: 3 } : undefined),
  });
  assert.equal(res.state.phase, PHASES.CANCELLED,
    `(з-4) expected CANCELLED to win, got ${res.state.phase} (reason=${res.state.reason})`);
  assert.equal(res.lastCmd.throttle, 0, '(з-4) no thrust after cancellation');
  assert.equal(res.lastCmd.thrustDir, null, '(з-4) no thrust direction after cancellation');
}

// ═════════════════════════════════════════════════════════════════════════════
// (з-5) cancellation during the WAIT of a Hohmann transfer (no burn in progress)
// ═════════════════════════════════════════════════════════════════════════════
{
  const st = circularState(mu, 8.0e6);
  const res = runClosedLoop({
    mu, r0: st.r, v0: st.v, goal: { kind: 'hohmann', bodyName: 'Earth', targetRadius: 2.0e7 },
    dtOf: warpAwareSchedule({ burnDt: 0.05, coastMax: 60, dtReal: 1 / 60 }),
    maxSteps: 200000, label: '(з-5) cancel while waiting',
    obsOverrides: (o, ctx) => (
      ctx.state && ctx.state.phase === PHASES.WAIT && ctx.state.phaseElapsed >= 100
        ? { inputSeq: o.inputSeq + 1 } : undefined),
  });
  assert.equal(res.state.phase, PHASES.CANCELLED,
    `(з-5) expected CANCELLED during WAIT, got ${res.state.phase} (reason=${res.state.reason})`);
  assert.equal(res.lastCmd.done, true, '(з-5) cancellation is terminal');
  assert.equal(res.lastCmd.maxWarp, Infinity,
    '(з-5) a cancelled autopilot must stop capping the warp (§3.3)');
  assert.ok(res.phases.includes(PHASES.WAIT), '(з-5) the run must really have waited');
  // and the transfer was NOT silently completed after the pilot took over
  assert.ok(Math.abs(res.elements.a - 2.0e7) / 2.0e7 > 1e-2,
    `(з-5) a cancelled transfer must not reach its target (a = ${res.elements.a})`);
}

// A cancellation is not a failure: `reason` belongs to REFUSED/FAILED only (§2.2).
assert.ok(cancelled.state.reason === null || cancelled.state.reason === undefined
  || !Object.values(REASONS).includes(cancelled.state.reason),
  `(з) CANCELLED must not carry a failure reason, got '${cancelled.state.reason}'`);

console.log('autopilot.cancel OK');
