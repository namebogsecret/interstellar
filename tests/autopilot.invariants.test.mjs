// Autopilot · COMMAND INVARIANTS, degenerate inputs, determinism
// (ТЗ волна B · B1 §2.2 (i)–(vi), §7.3 «н», «о», «п», §9 fitness greps).
//
// This is the mutation-facing file: it asserts what the command MEANS on 500
// pseudo-random states, not that some code path ran. INV-PARSE-05 (totality on
// garbage input) and INV-PARSE-06 (determinism) applied to a physics core.
import * as THREE from 'three';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  PHASES, REASONS, MU_EARTH, A_MAX_TZ, A_MIN_TZ, C_LIGHT,
  conicState, makeObs, engageAutopilot, autopilotStep, runClosedLoop, fixedSchedule,
  assertCommandInvariants, lcg, logUniform, TERMINAL_PHASES,
} from './autopilot.harness.mjs';
import * as AP from '../js/physics/autopilot.js';

const mu = MU_EARTH;
const R_PERI = 8.0e6;
const GOAL_CIRC = { kind: 'circularize', bodyName: 'Earth' };
const st03 = conicState(mu, 0.3, R_PERI, 0);

// ═════════════════════════════════════════════════════════════════════════════
// FROZEN WIRE FORMAT — PHASES/REASONS are serialised as-is (§2.2), so their
// literal values are a contract, not an implementation detail.
// ═════════════════════════════════════════════════════════════════════════════
{
  const expectPhases = {
    IDLE: 'IDLE', WAIT: 'WAIT', BURN: 'BURN', TRIM: 'TRIM',
    DONE: 'DONE', CANCELLED: 'CANCELLED', REFUSED: 'REFUSED', FAILED: 'FAILED',
  };
  const expectReasons = {
    LANDED: 'landed', NO_BODY: 'no-body', RELATIVISTIC: 'relativistic',
    ATMOSPHERE: 'atmosphere', PERTURBED: 'perturbed', UNBOUND: 'unbound',
    TARGET_UNREACHABLE: 'target-unreachable', NO_FUEL: 'no-fuel',
    REF_CHANGED: 'ref-changed', NO_CONVERGENCE: 'no-convergence', TIMEOUT: 'timeout',
  };
  assert.deepEqual({ ...PHASES }, expectPhases, 'PHASES literals are a wire contract (§2.2)');
  assert.deepEqual({ ...REASONS }, expectReasons, 'REASONS literals are a wire contract (§2.2)');
  assert.ok(Object.isFrozen(PHASES), 'PHASES must be Object.freeze()d');
  assert.ok(Object.isFrozen(REASONS), 'REASONS must be Object.freeze()d');
}

// The thrust schedule's ceiling: if the module publishes it (ТЗ §10/R3 — a
// playtest knob), it must be the contracted 30 g, so the harness's assertions
// and the code cannot drift apart silently.
if (AP.A_MAX !== undefined) {
  assert.equal(AP.A_MAX, A_MAX_TZ, 'exported A_MAX must be 30·G0 (ТЗ §3.2)');
}
if (AP.A_MIN !== undefined) {
  assert.equal(AP.A_MIN, A_MIN_TZ, 'exported A_MIN must be 0.5·G0 (ТЗ §3.2)');
}

// ═════════════════════════════════════════════════════════════════════════════
// §9 fitness greps that guard THESE tests' premises (read as TEXT, not imported)
// ═════════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(new URL('../js/physics/autopilot.js', import.meta.url), 'utf8');
  // determinism (н) is only meaningful if the core has no clock and no RNG
  assert.equal(/Math\.random|Date\.now|performance\.now/.test(src), false,
    'autopilot core must contain no clock and no randomness (§9 grep 1)');
  // ГРАБЛИ #8: acos(dot) has a ~1.5e-8 rad floor — banned as a direction metric
  assert.equal(/Math\.acos/.test(src), false,
    'autopilot core must not use Math.acos (ГРАБЛИ #8 — use atan2(|a×b|, a·b))');
  // pure core: no DOM, no WebGL, no browser globals
  assert.equal(/document\.|window\.|localStorage|requestAnimationFrame/.test(src), false,
    'autopilot core must stay DOM-free (§9 grep 1)');
  // the core never writes simulation state — it returns a command
  assert.equal(/ship\.[a-zA-Z]+\s*=[^=]/.test(src), false,
    'autopilot core must not assign to ship.* (§9 grep 2)');
}

// ═════════════════════════════════════════════════════════════════════════════
// (п) PROPERTY TEST — 500 pseudo-random observations, deterministic LCG
//     (Math.random is forbidden: a flaky invariant test is a broken oracle)
// ═════════════════════════════════════════════════════════════════════════════
{
  const rnd = lcg(0x5EED1234);
  const dir = new THREE.Vector3();
  let live = 0, burning = 0, refused = 0;

  for (let i = 0; i < 500; i++) {
    const muI = logUniform(rnd, 1e12, 1e20);
    const rPeri = logUniform(rnd, 1e6, 1e11);
    const e = rnd() * 0.95;
    const nu = rnd() * 2 * Math.PI;
    const aAvail = logUniform(rnd, 1e-3, 1e4);
    const dt = logUniform(rnd, 1e-4, 60);
    const kFactor = 0.5 + rnd() * 2.5;

    const st = conicState(muI, e, rPeri, nu);
    const goal = (i % 2)
      ? { kind: 'hohmann', bodyName: 'Earth', targetRadius: rPeri * kFactor }
      : { kind: 'circularize', bodyName: 'Earth' };

    // A body scaled to the orbit, so most draws are LIVE manoeuvres rather than
    // "everything is inside the atmosphere" refusals.
    const obs = makeObs(st.r, st.v, {
      mu: muI,
      bodyRadius: rPeri * 0.045,
      safeRadius: rPeri * 0.05,
      maxThrustAccel: aAvail,
      dvBudget: Infinity,
      dominance: 1e6,
      dtReal: 1 / 60,
    });

    const label = `(п) draw ${i} [mu=${muI.toExponential(2)} rPeri=${rPeri.toExponential(2)} ` +
      `e=${e.toFixed(3)} nu=${nu.toFixed(3)} a=${aAvail.toExponential(2)} dt=${dt.toExponential(2)}]`;

    let state;
    try {
      state = engageAutopilot(goal, obs);
    } catch (err) {
      assert.fail(`${label}: engageAutopilot threw ${err && err.message}`);
    }
    assert.ok(state && typeof state === 'object', `${label}: engage returned ${state}`);
    if (state.phase === PHASES.REFUSED) {
      assert.ok(Object.values(REASONS).includes(state.reason),
        `${label}: REFUSED must carry a known reason, got '${state.reason}'`);
      refused++;
    }

    // first frame: dt === 0 by contract (§2.2)
    let cmd;
    try {
      cmd = autopilotStep(state, obs, 0, dir);
    } catch (err) {
      assert.fail(`${label}: autopilotStep(dt=0) threw ${err && err.message}`);
    }
    assertCommandInvariants(cmd, obs, 0, `${label} frame 0`);

    // second frame with the random dt — this is where (vi) has teeth
    let cmd2;
    try {
      cmd2 = autopilotStep(cmd.state, obs, dt, dir);
    } catch (err) {
      assert.fail(`${label}: autopilotStep(dt=${dt}) threw ${err && err.message}`);
    }
    assertCommandInvariants(cmd2, obs, dt, `${label} frame 1`);

    if (!cmd2.done) {
      live++;
      assert.ok(Number.isFinite(cmd2.state.info.dvRemaining) && cmd2.state.info.dvRemaining >= 0,
        `${label}: a live command must publish a finite dvRemaining >= 0, ` +
        `got ${cmd2.state.info.dvRemaining}`);
      if (cmd2.throttle > 0) {
        burning++;
        // (vi) restated in the sharpest form: the Δv this frame will apply can
        // never exceed what is left to apply. This is the one invariant that
        // makes "no overshoot at ANY dt" structural instead of hopeful.
        const applied = cmd2.throttle * aAvail * dt;
        assert.ok(applied <= cmd2.state.info.dvRemaining * (1 + 1e-9),
          `${label}: overshoot ${applied} > dvRemaining ${cmd2.state.info.dvRemaining}`);
        // and it never asks for more than the contracted ceiling
        assert.ok(cmd2.throttle * aAvail <= Math.min(aAvail, A_MAX_TZ) * (1 + 1e-9),
          `${label}: commanded accel ${cmd2.throttle * aAvail} above min(aAvail, A_MAX)`);
      }
    }

    // (н, per draw) identical input → identical output, in the same process
    if (i % 50 === 0) {
      const again = autopilotStep(cmd.state, obs, dt, new THREE.Vector3());
      assert.equal(JSON.stringify(again.state), JSON.stringify(cmd2.state),
        `${label}: autopilotStep is not deterministic`);
      assert.equal(again.throttle, cmd2.throttle, `${label}: throttle not deterministic`);
    }
  }

  // anti-vacuity: a property test that refused everything proves nothing
  assert.ok(live >= 250, `(п) only ${live}/500 draws produced a live command — test is vacuous`);
  assert.ok(burning >= 100, `(п) only ${burning}/500 draws actually commanded thrust`);
  assert.ok(refused <= 250, `(п) ${refused}/500 draws were refused — fixture is degenerate`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (о) DEGENERATE INPUTS — no NaN, no Infinity, no throw, ever
// ═════════════════════════════════════════════════════════════════════════════
{
  const nanVec = () => new THREE.Vector3(NaN, 1, 2);
  const infVec = () => new THREE.Vector3(Infinity, 0, 0);
  const cases = [
    ['rVec = 0', { rVec: new THREE.Vector3(0, 0, 0) }],
    ['vVec = 0', { vVec: new THREE.Vector3(0, 0, 0) }],
    ['rVec and vVec = 0', { rVec: new THREE.Vector3(0, 0, 0), vVec: new THREE.Vector3(0, 0, 0) }],
    ['rVec has NaN', { rVec: nanVec() }],
    ['vVec has NaN', { vVec: nanVec() }],
    ['rVec has Infinity', { rVec: infVec() }],
    ['mu = 0', { mu: 0 }],
    ['mu = NaN', { mu: NaN }],
    ['mu = Infinity', { mu: Infinity }],
    ['mu < 0', { mu: -1e14 }],
    ['maxThrustAccel = NaN', { maxThrustAccel: NaN }],
    ['maxThrustAccel = Infinity', { maxThrustAccel: Infinity }],
    ['maxThrustAccel < 0', { maxThrustAccel: -5 }],
    ['dvBudget = NaN', { dvBudget: NaN }],
    ['safeRadius = NaN', { safeRadius: NaN }],
    ['bodyRadius = NaN', { bodyRadius: NaN }],
    ['dominance = NaN', { dominance: NaN }],
    ['beta = NaN', { beta: NaN }],
    ['atmoDensity = NaN', { atmoDensity: NaN }],
    ['dtReal = 0', { dtReal: 0 }],
    ['dtReal = NaN', { dtReal: NaN }],
    ['dtReal = Infinity', { dtReal: Infinity }],
    ['refBodyName = undefined', { refBodyName: undefined }],
  ];
  const dts = [0, 0.05, NaN, 1e9, -1, Infinity];

  // a healthy live state to feed the garbage to (ТЗ: "и через engageAutopilot,
  // и через autopilotStep на живом состоянии")
  const healthy = engageAutopilot(GOAL_CIRC, makeObs(st03.r.clone(), st03.v.clone()));
  assert.ok(!TERMINAL_PHASES.has(healthy.phase),
    `(о) precondition: the baseline state must be live, got ${healthy.phase}`);

  for (const [name, over] of cases) {
    const obs = makeObs(st03.r.clone(), st03.v.clone(), over);

    // ── through engageAutopilot ──
    let st;
    try {
      st = engageAutopilot(GOAL_CIRC, obs);
    } catch (err) {
      assert.fail(`(о) engage[${name}] threw ${err && err.message}`);
    }
    assert.ok(st && typeof st === 'object', `(о) engage[${name}] returned ${st}`);
    assert.ok(typeof st.phase === 'string' && Object.values(PHASES).includes(st.phase),
      `(о) engage[${name}] produced an unknown phase '${st.phase}'`);

    // ── through autopilotStep, on both the fresh and the healthy state ──
    for (const base of [st, healthy]) {
      for (const dt of dts) {
        const dir = new THREE.Vector3(7, 7, 7);       // pre-dirtied on purpose
        let cmd;
        try {
          cmd = autopilotStep(base, obs, dt, dir);
        } catch (err) {
          assert.fail(`(о) step[${name}, dt=${dt}] threw ${err && err.message}`);
        }
        assertCommandInvariants(cmd, obs, dt, `(о) step[${name}, dt=${dt}]`);
        // the HUD payload must never carry NaN into fmt* (ГРАБЛИ #4/#5 class)
        const info = cmd.state.info;
        assert.ok(info && typeof info === 'object', `(о) step[${name}]: info missing`);
        for (const key of ['dvRemaining', 'targetRadius', 'e']) {
          assert.equal(Number.isNaN(info[key]), false,
            `(о) step[${name}, dt=${dt}]: info.${key} is NaN`);
        }
        assert.equal(Number.isNaN(info.tToIgnition), false,
          `(о) step[${name}, dt=${dt}]: info.tToIgnition is NaN`);
      }
    }
  }

  // and the inputs themselves were not mutated (the core is pure, §2.2)
  {
    const obs = makeObs(st03.r.clone(), st03.v.clone());
    const before = JSON.stringify(healthy);
    const rBefore = obs.rVec.clone(), vBefore = obs.vVec.clone();
    autopilotStep(healthy, obs, 0.05, new THREE.Vector3());
    assert.equal(JSON.stringify(healthy), before,
      '(о) autopilotStep must not mutate the state it was given');
    assert.equal(obs.rVec.equals(rBefore) && obs.vVec.equals(vBefore), true,
      '(о) autopilotStep must not mutate the observation it was given');
  }

  // outDir really is the only side effect: the returned thrustDir IS that vector
  {
    const obs = makeObs(st03.r.clone(), st03.v.clone());
    const dir = new THREE.Vector3();
    const cmd = autopilotStep(healthy, obs, 0.05, dir);
    if (cmd.thrustDir !== null) {
      assert.equal(cmd.thrustDir, dir,
        '(о) thrustDir must be the caller-provided outDir, not a fresh allocation (ГРАБЛИ #1)');
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// (н) DETERMINISM — same input, bit-for-bit same output
// ═════════════════════════════════════════════════════════════════════════════
{
  const runOnce = () => runClosedLoop({
    mu, r0: st03.r.clone(), v0: st03.v.clone(), goal: GOAL_CIRC,
    dtOf: fixedSchedule(0.05), maxSteps: 40000, label: 'determinism',
    checkInvariants: false,
  });
  const a = runOnce();
  const b = runOnce();

  assert.deepEqual(a.phases, b.phases, '(н) phase sequences differ between identical runs');
  assert.equal(a.states.length, b.states.length, '(н) step counts differ between identical runs');
  assert.equal(a.steps, b.steps, '(н) step counts differ between identical runs');
  for (const k of ['x', 'y', 'z']) {
    assert.strictEqual(a.r[k], b.r[k], `(н) final position component ${k} is not bit-identical`);
    assert.strictEqual(a.v[k], b.v[k], `(н) final velocity component ${k} is not bit-identical`);
  }
  for (let k = 0; k < a.states.length; k++) {
    assert.equal(JSON.stringify(a.states[k]), JSON.stringify(b.states[k]),
      `(н) state ${k} differs between identical runs`);
  }
  // the state really is the flat JSON-serialisable record the contract promises
  assert.ok(JSON.stringify(a.states[a.states.length - 1]).length > 2,
    '(н) AutopilotState must be JSON-serialisable and non-empty');
  // a NEW object every step — never mutated in place (§2.2)
  assert.notEqual(a.states[0], a.states[1], '(н) each step must return a NEW state object');
}

// ═════════════════════════════════════════════════════════════════════════════
// Sanity on the relativistic gate constant used above: BETA_MAX = 0.01 means
// 0.02c must refuse and 0.005c must not (a one-sided gate is not a gate).
// ═════════════════════════════════════════════════════════════════════════════
{
  const slow = engageAutopilot(GOAL_CIRC, makeObs(st03.r.clone(), st03.v.clone(), { beta: 0.005 }));
  assert.notEqual(slow.reason, REASONS.RELATIVISTIC,
    'β = 0.005 is below BETA_MAX = 0.01 and must be accepted');
  const fast = engageAutopilot(GOAL_CIRC, makeObs(st03.r.clone(), st03.v.clone(), { beta: 0.02 }));
  assert.equal(fast.reason, REASONS.RELATIVISTIC, 'β = 0.02 must be refused');
  assert.ok(C_LIGHT > 2.9e8, 'fixture: C imported from constants.js');
}

console.log('autopilot.invariants OK');
