// Autopilot · HOHMANN TRANSFER contract (ТЗ волна B · B1 §7.2 «д»,«е»,«ж»)
// + the warp contract §7.3 «р» (which only has anything to observe during a
// transfer's WAIT phase).
//
// From the ТЗ, not from the implementation. Success is measured as the orbital
// elements AFTER the loop finishes: orbitFromState(mu, r, v) — semi-major axis
// within 5e-3 relative of the requested radius and a circular finish.
import assert from 'node:assert/strict';
import { approxRel } from './helpers.mjs';
import {
  PHASES, MU_EARTH, MOON, A_MAX_TZ,
  circularState, runClosedLoop, warpAwareSchedule, makeObs, estimateManoeuvreDv,
  assertCircularOrbit, angleBetween, hasSubsequence,
} from './autopilot.harness.mjs';

const mu = MU_EARTH;
const DT_REAL = 1 / 60;

// ── closed-form Hohmann (INV-PHYS-07: compare against the analytic limit, not
//    against a snapshot of the code's own output) ──────────────────────────────
function hohmann(mu_, r1, r2) {
  const at = (r1 + r2) / 2;
  const v1 = Math.sqrt(mu_ / r1);
  const v2 = Math.sqrt(mu_ / r2);
  const vAtR1 = Math.sqrt((2 * mu_ * r2) / (r1 * (r1 + r2)));   // transfer speed at r1
  const vAtR2 = Math.sqrt((2 * mu_ * r1) / (r2 * (r1 + r2)));   // transfer speed at r2
  return {
    at,
    dv1: Math.abs(vAtR1 - v1),
    dv2: Math.abs(v2 - vAtR2),
    total: Math.abs(vAtR1 - v1) + Math.abs(v2 - vAtR2),
    tof: Math.PI * Math.sqrt((at * at * at) / mu_),
  };
}

// ── fixture self-check against the numbers written into the ТЗ ────────────────
const H = hohmann(mu, 8.0e6, 2.0e7);
approxRel(H.at, 1.4e7, 1e-12, 'fixture: transfer semi-major axis');
approxRel(H.dv1, 1378.0, 1e-3, 'fixture: dv1 per ТЗ §7.2 (д)');
approxRel(H.dv2, 1089.7, 1e-3, 'fixture: dv2 per ТЗ §7.2 (д)');
approxRel(H.total, 2467.7, 1e-3, 'fixture: Σ Δv per ТЗ §7.2 (д)');
approxRel(H.tof, 8243, 1e-3, 'fixture: transfer time per ТЗ §7.2 (д)');

// ═════════════════════════════════════════════════════════════════════════════
// (д) RAISE: circular 8.0e6 → 2.0e7
// ═════════════════════════════════════════════════════════════════════════════
const R1 = 8.0e6, R2 = 2.0e7;
const goalUp = { kind: 'hohmann', bodyName: 'Earth', targetRadius: R2 };
const st1 = circularState(mu, R1);

// estimateManoeuvreDv is the fuel gate's own oracle — it must agree with the
// classical formula, or REFUSED(no-fuel) fires at the wrong budget (ТЗ §2.2/§4·8).
{
  const obs0 = makeObs(st1.r.clone(), st1.v.clone(), { dtReal: DT_REAL });
  const est = estimateManoeuvreDv(goalUp, obs0);
  approxRel(est, H.total, 1e-3, '(д) estimateManoeuvreDv vs closed-form dv1+dv2');
}

const up = runClosedLoop({
  mu, r0: st1.r, v0: st1.v, goal: goalUp,
  dtOf: warpAwareSchedule({ burnDt: 0.05, coastMax: 60, dtReal: DT_REAL }),
  dtReal: DT_REAL, maxSteps: 200000, label: 'hohmann up',
});

assert.equal(up.state.phase, PHASES.DONE,
  `(д) must finish DONE, got ${up.state.phase} (reason=${up.state.reason})`);
assertCircularOrbit(up, { eTol: 2e-3, aTol: 5e-3, targetRadius: R2, label: '(д) raise 8e6→2e7' });
approxRel(up.dvSpent, H.total, 0.05, '(д) Δv spent vs closed-form Hohmann');
assert.ok(hasSubsequence(up.phases, [PHASES.BURN, PHASES.WAIT, PHASES.BURN]),
  `(д) phase sequence must contain BURN → WAIT → BURN, got ${up.phases}`);
// 0.999: the burn is CENTRED on the apsis (§3.3), so the coast can start a few
// seconds "late" — it can never be skipped, which is what this guards.
assert.ok(up.simTime >= H.tof * 0.999 && up.simTime <= 12000,
  `(д) simTime ${up.simTime} s outside [${H.tof}, 12000] — a Hohmann cannot beat its own coast`);
assert.ok(up.peakAccel <= A_MAX_TZ * (1 + 1e-9), `(д) peak accel ${up.peakAccel} > A_MAX`);
{
  const dPlane = angleBetween(up.h0, up.hFinal);
  assert.ok(dPlane <= 1e-8, `(д) orbital plane rotated by ${dPlane} rad`);
}
// the final radius really is the requested one, not just a circular orbit somewhere
approxRel(up.r.length(), R2, 5e-3, '(д) final radius vs requested target radius');

// ═════════════════════════════════════════════════════════════════════════════
// (е) LOWER: circular 2.0e7 → 8.0e6, first burn at APOAPSIS
// ═════════════════════════════════════════════════════════════════════════════
{
  const goalDown = { kind: 'hohmann', bodyName: 'Earth', targetRadius: R1 };
  const st = circularState(mu, R2);
  const res = runClosedLoop({
    mu, r0: st.r, v0: st.v, goal: goalDown,
    dtOf: warpAwareSchedule({ burnDt: 0.05, coastMax: 60, dtReal: DT_REAL }),
    dtReal: DT_REAL, maxSteps: 200000, label: 'hohmann down',
  });
  assert.equal(res.state.phase, PHASES.DONE,
    `(е) must finish DONE, got ${res.state.phase} (reason=${res.state.reason})`);
  assertCircularOrbit(res, { eTol: 2e-3, aTol: 5e-3, targetRadius: R1, label: '(е) lower 2e7→8e6' });
  approxRel(res.dvSpent, H.total, 0.05, '(е) Δv spent vs closed-form Hohmann (symmetric)');
  assert.ok(hasSubsequence(res.phases, [PHASES.BURN, PHASES.WAIT, PHASES.BURN]),
    `(е) phase sequence must contain BURN → WAIT → BURN, got ${res.phases}`);

  // first ignition happened at the apsis FAR from the target, i.e. at r ≈ r1 with r·v ≈ 0
  const ign = res.log.find((e) => e.throttle > 0);
  assert.ok(ign, '(е) no thrusting step recorded at all');
  approxRel(ign.radius, R2, 1e-3, '(е) first ignition radius must be the starting apsis');
  assert.ok(Math.abs(ign.cosRV) <= 1e-3,
    `(е) first ignition must be at an apsis: cos(r,v) = ${ign.cosRV}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (ж) real numbers: Earth → Moon's orbital radius, coarse/fine variable step.
//     r2 is IMPORTED from js/data/bodies.js — never a copy of 3.844e8 (ГРАБЛИ:
//     «тест хардкодил копию константы»).
// ═════════════════════════════════════════════════════════════════════════════
{
  const R_MOON = MOON.a;
  const HM = hohmann(mu, R1, R_MOON);
  const goalMoon = { kind: 'hohmann', bodyName: 'Earth', targetRadius: R_MOON };
  const st = circularState(mu, R1);
  const res = runClosedLoop({
    mu, r0: st.r, v0: st.v, goal: goalMoon,
    // 60 s while coasting (capped by the autopilot's own maxWarp), 0.05 s while
    // burning: the same run doubles as the large-variable-dt stress test (R2).
    dtOf: warpAwareSchedule({ burnDt: 0.05, coastMax: 60, dtReal: DT_REAL }),
    dtReal: DT_REAL, maxSteps: 400000, label: 'hohmann moon',
  });
  assert.equal(res.state.phase, PHASES.DONE,
    `(ж) must finish DONE, got ${res.state.phase} (reason=${res.state.reason})`);
  assertCircularOrbit(res, {
    eTol: 5e-3, aTol: 5e-3, targetRadius: R_MOON, label: '(ж) Earth → lunar radius',
  });
  // Δv band, NOT the ±5 % of (д)/(е): the ТЗ states a Δv criterion only for the
  // well-conditioned 8e6→2e7 case. This transfer ends near escape speed, where
  // d(rApo)/dv ≈ 4e6 m per m/s — hitting `a` to 5e-3 costs trim Δv that no
  // contract line budgets. What IS still contracted: you cannot beat the
  // impulsive minimum, and you must not diverge.
  assert.ok(res.dvSpent >= HM.total * 0.95,
    `(ж) spent ${res.dvSpent} m/s, below the impulsive minimum ${HM.total} — physics was cheated`);
  assert.ok(res.dvSpent <= HM.total * 20,
    `(ж) spent ${res.dvSpent} m/s vs a ${HM.total} m/s manoeuvre — guidance is in a limit cycle`);
  assert.ok(res.simTime >= HM.tof * 0.999,
    `(ж) simTime ${res.simTime} s < coast time ${HM.tof} s — the transfer cannot be skipped`);
  assert.ok(res.peakAccel <= A_MAX_TZ * (1 + 1e-9), `(ж) peak accel ${res.peakAccel} > A_MAX`);
  // the coarse coast must not have been faked by never coasting at all
  const coarseSteps = res.log.filter((e) => e.dtIn >= 30).length;
  assert.ok(coarseSteps >= 100,
    `(ж) expected a long coarse-step coast, only ${coarseSteps} steps with dt >= 30 s`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (р) WARP CONTRACT — the only reason the transfer above lands at all
// ═════════════════════════════════════════════════════════════════════════════
{
  const waits = up.log.filter((e) => e.phase === PHASES.WAIT);
  assert.ok(waits.length >= 5, `(р) expected a real WAIT phase, got ${waits.length} steps`);

  for (const e of waits) {
    assert.equal(e.throttle, 0, '(р) WAIT must not thrust');
    assert.equal(e.thrustDir, null, '(р) WAIT must report thrustDir === null');
    assert.ok(Number.isFinite(e.tToIgnition) && e.tToIgnition >= 0,
      `(р) WAIT must publish a finite tToIgnition, got ${e.tToIgnition}`);
    // never able to step OVER the ignition point
    const step = e.maxWarp * Math.max(DT_REAL, 1 / 240);
    assert.ok(step <= e.tToIgnition * (1 + 1e-9),
      `(р) maxWarp·dtReal = ${step} s would overshoot ignition at ${e.tToIgnition} s`);
  }

  // maxWarp never grows while tToIgnition shrinks, inside ONE continuous wait
  // (across two legs the countdown restarts, so runs are compared separately).
  let runs = 0, checks = 0, prev = null;
  for (const e of up.log) {
    if (e.phase !== PHASES.WAIT) { prev = null; continue; }
    if (prev === null) runs++;
    else if (e.tToIgnition <= prev.tToIgnition) {
      assert.ok(e.maxWarp <= prev.maxWarp * (1 + 1e-9),
        `(р) maxWarp grew (${prev.maxWarp} → ${e.maxWarp}) while tToIgnition fell ` +
        `(${prev.tToIgnition} → ${e.tToIgnition})`);
      checks++;
    }
    prev = e;
  }
  assert.ok(checks >= 5, `(р) monotonicity was never exercised (${checks} comparisons)`);
  assert.ok(runs >= 1, '(р) expected at least one continuous WAIT run');

  // BURN/TRIM pin the warp to 1; terminal phases lift the cap entirely (ТЗ §3.3)
  for (const e of up.log) {
    if (e.phase === PHASES.BURN || e.phase === PHASES.TRIM) {
      assert.equal(e.maxWarp, 1, `(р) ${e.phase} must pin maxWarp to 1, got ${e.maxWarp}`);
    }
  }
  assert.equal(up.lastCmd.maxWarp, Infinity,
    '(р) a terminal autopilot must stop capping warp (maxWarp === Infinity)');
}

console.log('autopilot.hohmann OK');
