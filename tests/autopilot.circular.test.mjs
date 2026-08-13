// Autopilot · CIRCULARISATION contract (ТЗ волна B · B1 §7.1 «а»,«б»,«в»,«г»).
//
// Written from the ТЗ, NOT from js/physics/autopilot.js. Every claim is about the
// ORBITAL ELEMENTS AFTER the autopilot has finished — orbitFromState(mu, r, v) on
// the final state vector of a closed loop (INV-PHYS-10: integral elements, never
// "the function was called" and never the autopilot's own bookkeeping fields).
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { approxRel } from './helpers.mjs';
import {
  PHASES, MU_EARTH, SAFE_R_EARTH, A_MAX_TZ, EARTH,
  conicState, tiltState, runClosedLoop, fixedSchedule, orbitFromState,
  assertCircularOrbit, angleBetween, isFiniteVec,
} from './autopilot.harness.mjs';

const mu = MU_EARTH;
const R_PERI = 8.0e6;               // ТЗ §7.1: above safeRadius(Earth)
const GOAL = { kind: 'circularize', bodyName: 'Earth' };

// ── fixture self-check (по образцу periapsisState в missions.test.mjs) ─────────
// The ТЗ quotes safeRadius(Earth) = 6.6896e6 m; if orbits.js::safeRadius (§2.1)
// disagrees, every "above the atmosphere" premise below is void — say so loudly
// instead of failing later with a confusing REFUSED(atmosphere).
approxRel(SAFE_R_EARTH, 6.68955e6, 1e-4, 'fixture: safeRadius(Earth) per ТЗ §7.1');
assert.ok(R_PERI > SAFE_R_EARTH, 'fixture: rPeri must clear safeRadius');

const vCirc8 = Math.sqrt(mu / R_PERI);                       // 7058.7 m/s
const vPeri03 = Math.sqrt((mu * 1.3) / R_PERI);              // 8048.2 m/s
const vPeri09 = Math.sqrt((mu * 1.9) / R_PERI);              // 9729.7 m/s
approxRel(vCirc8, 7058.7, 1e-4, 'fixture: v_circ(8e6) per ТЗ');
approxRel(vPeri03, 8048.2, 1e-4, 'fixture: v_peri(e=0.3) per ТЗ');
approxRel(vPeri09, 9729.7, 1e-4, 'fixture: v_peri(e=0.9) per ТЗ');
const DV_E03 = vPeri03 - vCirc8;                             // 989.5 m/s (ТЗ)
const DV_E09 = vPeri09 - vCirc8;                             // 2671.0 m/s (ТЗ)
approxRel(DV_E03, 989.5, 2e-3, 'fixture: Δv(e=0.3) per ТЗ §7.1 (а)');
approxRel(DV_E09, 2671.0, 2e-3, 'fixture: Δv(e=0.9) per ТЗ §7.1 (б)');

// ═════════════════════════════════════════════════════════════════════════════
// (а) circular out of an ellipse, e = 0.3, start at periapsis, arcade
// ═════════════════════════════════════════════════════════════════════════════
const st03 = conicState(mu, 0.3, R_PERI, 0);
{
  // fixture self-check through the SAME reader the assertions use
  const el0 = orbitFromState(mu, st03.r, st03.v);
  approxRel(el0.e, 0.3, 1e-9, 'fixture (а): initial eccentricity');
  approxRel(el0.rPeri, R_PERI, 1e-9, 'fixture (а): initial periapsis radius');
  assert.equal(el0.bound, true, 'fixture (а): initial orbit is bound');
}
const fine = runClosedLoop({
  mu, r0: st03.r, v0: st03.v, goal: GOAL,
  dtOf: fixedSchedule(0.05), maxSteps: 40000, label: 'circ e=0.3 dt=0.05',
});

assert.equal(fine.state.phase, PHASES.DONE,
  `(а) must finish DONE, got ${fine.state.phase} (reason=${fine.state.reason})`);
assertCircularOrbit(fine, { eTol: 1e-3, aTol: 1e-3, label: '(а) e=0.3 arcade' });

// radius did not run away (ТЗ: |r| ∈ [7.9e6, 8.7e6])
{
  const rf = fine.r.length();
  assert.ok(rf >= 7.9e6 && rf <= 8.7e6, `(а) final radius ${rf} outside [7.9e6, 8.7e6]`);
}

// Δv actually spent matches the closed-form impulsive manoeuvre within 5 %
approxRel(fine.dvSpent, DV_E03, 0.05, '(а) Δv spent vs closed form (INV-PHYS-07)');

// phase sequence: burn starts at once, no WAIT for circularise (ТЗ §3.3)
assert.equal(fine.phases[0], PHASES.BURN,
  `(а) circularise must ignite immediately, first phase was ${fine.phases[0]}`);
assert.ok(!fine.phases.includes(PHASES.WAIT), `(а) WAIT must not appear: ${fine.phases}`);
assert.ok(fine.phases.length <= 6, `(а) phase sequence too long: ${fine.phases}`);
assert.ok(fine.simTime <= 600, `(а) simTime ${fine.simTime} s > 600 s`);

// ── (г-parent) the ARCADE 1000 g ceiling is never used ────────────────────────
assert.ok(fine.peakAccel <= A_MAX_TZ * (1 + 1e-9),
  `(а) peak acceleration ${fine.peakAccel} m/s² exceeds A_MAX = ${A_MAX_TZ} m/s² (30 g)`);
// ...and the burn is long enough to be visible (ТЗ: >= 3.0 s, from Δv/A_MAX = 3.36 s)
assert.ok(fine.burnTime >= 3.0,
  `(а) burn lasted ${fine.burnTime} s, must be >= 3.0 s (arcade full thrust would be ~0.1 s)`);

// ── orbital PLANE is untouched (ТЗ §4 «не умеет» п.5 · INV-PHYS-03) ───────────
// Angle measured as atan2(|a×b|, a·b) — acos(dot) has a ~1.5e-8 rad floor (ГРАБЛИ #8).
{
  const dPlane = angleBetween(fine.h0, fine.hFinal);
  assert.ok(dPlane <= 1e-8, `(а) orbital plane rotated by ${dPlane} rad (must stay in-plane)`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (б) large eccentricity, e = 0.9 — same tolerance, plus the no-overshoot law
// ═════════════════════════════════════════════════════════════════════════════
{
  const st = conicState(mu, 0.9, R_PERI, 0);
  const res = runClosedLoop({
    mu, r0: st.r, v0: st.v, goal: GOAL,
    dtOf: fixedSchedule(0.05), maxSteps: 60000, label: 'circ e=0.9',
  });
  assert.equal(res.state.phase, PHASES.DONE,
    `(б) e=0.9 must finish DONE, got ${res.state.phase} (reason=${res.state.reason})`);
  assertCircularOrbit(res, { eTol: 1e-3, aTol: 2e-3, label: '(б) e=0.9 arcade' });
  approxRel(res.dvSpent, DV_E09, 0.05, '(б) Δv spent vs closed form');
  assert.ok(res.peakAccel <= A_MAX_TZ * (1 + 1e-9), `(б) peak accel ${res.peakAccel} > A_MAX`);

  // ТЗ (б): invariant (vi) explicitly re-checked step by step. runClosedLoop already
  // asserts it on every command; assert here that the run was not vacuous.
  const burning = res.log.filter((e) => e.throttle > 0);
  assert.ok(burning.length >= 10, `(б) expected a real burn, got ${burning.length} thrusting steps`);
  for (const e of burning) {
    assert.ok(Number.isFinite(e.dvRemaining) && e.dvRemaining >= 0,
      `(б) info.dvRemaining must be finite and >= 0 while burning, got ${e.dvRemaining}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// (в) realistic mode — thrust honestly clamps to the SHIP's ceiling
//     (clamp(x, A_MIN, min(aAvail, A_MAX)) with lo > hi must yield hi, ТЗ §3.2)
// ═════════════════════════════════════════════════════════════════════════════
{
  const A_SHIP = 0.30;                       // 3.0e7 N / 1.0e6 kg
  const res = runClosedLoop({
    mu, r0: st03.r.clone(), v0: st03.v.clone(), goal: GOAL,
    obsBase: { maxThrustAccel: A_SHIP, dvBudget: 5000 },
    dtOf: fixedSchedule(1.0), maxSteps: 40000, label: 'circ realistic',
  });
  assert.equal(res.state.phase, PHASES.DONE,
    `(в) realistic must finish DONE, got ${res.state.phase} (reason=${res.state.reason})`);
  assertCircularOrbit(res, { eTol: 1e-3, aTol: 2e-3, label: '(в) realistic' });
  assert.ok(res.peakAccel <= A_SHIP * (1 + 1e-9),
    `(в) applied accel ${res.peakAccel} punched through the ship ceiling ${A_SHIP}`);
  // Δv/a = 989.5/0.30 = 3298 s of burning. The bound is deliberately loose (2500 s):
  // it exists to kill "A_MIN = 0.5 g ignores aAvail", which would finish in ~200 s,
  // not to pin the exact duration of a closed-loop chase.
  assert.ok(res.simTime >= 2500,
    `(в) finished in ${res.simTime} s — A_MIN must not punch through a 0.30 m/s² ship`);
  assert.ok(res.dvSpent >= 700, `(в) Δv spent ${res.dvSpent} implausibly small`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (г) circularisation AWAY from an apsis (ν = 60°) — the guidance law must kill
//     the radial component too, not just trim the tangential one
// ═════════════════════════════════════════════════════════════════════════════
{
  const st = conicState(mu, 0.3, R_PERI, Math.PI / 3);
  // fixture self-check: this state really has a radial component
  assert.ok(Math.abs(st.r.dot(st.v)) > 1e6, '(г) fixture must be off-apsis (r·v ≠ 0)');
  const res = runClosedLoop({
    mu, r0: st.r, v0: st.v, goal: GOAL,
    dtOf: fixedSchedule(0.05), maxSteps: 40000, label: 'circ nu=60',
  });
  assert.equal(res.state.phase, PHASES.DONE,
    `(г) off-apsis must finish DONE, got ${res.state.phase} (reason=${res.state.reason})`);
  assertCircularOrbit(res, { eTol: 1e-3, aTol: 2e-3, label: '(г) ν=60°' });
  const rdotv = res.r.dot(res.v) / (res.r.length() * res.v.length());
  assert.ok(Math.abs(rdotv) <= 1e-3,
    `(г) residual radial velocity: cos(r,v) = ${rdotv}, expected ~0 on a circle`);
}

// ═════════════════════════════════════════════════════════════════════════════
// (в-parent) DISCRETISATION ROBUSTNESS: dt = 60 s vs dt = 0.05 s, 1200× apart.
// The contract's whole point (§3.1, R2) is that there is no burn-duration counter:
// the target is rebuilt from the CURRENT state each frame, so a coarse step must
// not degrade the result — only spend more model time getting there.
// ═════════════════════════════════════════════════════════════════════════════
{
  const coarse = runClosedLoop({
    mu, r0: st03.r.clone(), v0: st03.v.clone(), goal: GOAL,
    dtOf: fixedSchedule(60), maxSteps: 20000, label: 'circ e=0.3 dt=60',
  });
  assert.equal(coarse.state.phase, PHASES.DONE,
    `(в-parent) dt=60 must still finish DONE, got ${coarse.state.phase} (reason=${coarse.state.reason})`);
  assertCircularOrbit(coarse, { eTol: 1e-3, aTol: 2e-3, label: '(в-parent) dt=60 s' });
  assert.ok(coarse.peakAccel <= A_MAX_TZ * (1 + 1e-9),
    `(в-parent) dt=60 peak accel ${coarse.peakAccel} > A_MAX`);
  // Fuel is NOT part of the dt-robustness contract: at a 60 s frame the thrust
  // direction is frozen for a 60 s arc, so the loop converges by re-correcting
  // and pays for it. (In the real sim a burning frame is <= 0.05 s — warp is
  // pinned to 1 while the throttle is open.) What must hold is: the impulsive
  // minimum cannot be beaten, and the loop must not diverge.
  assert.ok(coarse.dvSpent >= DV_E03 * 0.95,
    `(в-parent) dt=60 spent ${coarse.dvSpent} m/s, below the impulsive minimum ${DV_E03}`);
  assert.ok(coarse.dvSpent <= DV_E03 * 25,
    `(в-parent) dt=60 spent ${coarse.dvSpent} m/s — the loop is not converging`);
  // both schedules land on the same orbit; 5 % on `a` is the allowance for 1200×
  // coarser stepping (the ship coasts further before the loop converges).
  approxRel(coarse.elements.a, fine.elements.a, 0.05,
    '(в-parent) dt=60 vs dt=0.05 must reach the same orbit');
}

// ═════════════════════════════════════════════════════════════════════════════
// FRAME-AGNOSTICISM: the same manoeuvre in a tilted plane. The guidance law is
// built from r and v alone, so an implementation that hardcodes a world axis
// (e.g. "up" = +y) dies here while passing every equatorial case above.
// ═════════════════════════════════════════════════════════════════════════════
{
  const tilted = tiltState(st03, new THREE.Vector3(0.3, -0.5, 0.81), 1.05);
  const res = runClosedLoop({
    mu, r0: tilted.r, v0: tilted.v, goal: GOAL,
    dtOf: fixedSchedule(0.05), maxSteps: 40000, label: 'circ tilted',
  });
  assert.equal(res.state.phase, PHASES.DONE,
    `(tilted) must finish DONE, got ${res.state.phase} (reason=${res.state.reason})`);
  assertCircularOrbit(res, { eTol: 1e-3, aTol: 2e-3, label: '(tilted) e=0.3' });
  const dPlane = angleBetween(res.h0, res.hFinal);
  assert.ok(dPlane <= 1e-8, `(tilted) orbital plane rotated by ${dPlane} rad`);
  // same physical outcome as the equatorial run
  approxRel(res.elements.a, fine.elements.a, 1e-3, '(tilted) same semi-major axis as equatorial');
  approxRel(res.dvSpent, fine.dvSpent, 1e-2, '(tilted) same Δv as equatorial');
  assert.ok(isFiniteVec(res.r) && isFiniteVec(res.v), '(tilted) state stayed finite');
}

// The reference body's own data must not have been touched by any of this.
assert.equal(EARTH.GM, mu, 'BODIES entry must not be mutated by the autopilot');

console.log('autopilot.circular OK');
