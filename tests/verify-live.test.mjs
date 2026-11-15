// Live "Check it yourself" logic (js/verify/live.js) — pure functions that run the
// REAL simulator modules against closed-form analytics and return a verdict.
// Contract: every check returns { id, valid, reason?, rows:[{key,sim,analytic,relErr,tol,pass}], pass }.
//  - every preset PASSES;
//  - mutation: a wrong sim value must FAIL (verdict is not always-true);
//  - degenerate inputs are REFUSED (valid:false + reason) — never NaN in a row.
import assert from 'node:assert/strict';
import { C, G0 } from '../js/physics/constants.js';
import {
  verdict, checkGammaBeta, checkConstantAccel, checkCircularOrbit,
  checkAberration, checkGravityAccel, PRESETS, TOL, TAU_OVER_C_MAX, A_MIN_G,
} from '../js/verify/live.js';

const CHECKS = {
  gamma: checkGammaBeta, accel: checkConstantAccel, orbit: checkCircularOrbit,
  aberration: checkAberration, gravity: checkGravityAccel,
};

const rowsFinite = (res) => res.rows.every((r) =>
  [r.sim, r.analytic, r.relErr, r.tol].every((x) => typeof x === 'number' && Number.isFinite(x)));

// ── verdict(): pure comparator, not always-true ────────────────────────────────
{
  assert.equal(verdict(1, 1, 1e-9).pass, true, 'identical passes');
  assert.equal(verdict(1.0000001, 1, 1e-9).pass, false, 'off by 1e-7 vs tol 1e-9 fails');
  assert.equal(verdict(1.01, 1, 1e-9).pass, false, '1% off fails');
  assert.equal(verdict(NaN, 1, 1e-9).pass, false, 'NaN sim never passes');
  assert.equal(verdict(1, NaN, 1e-9).pass, false, 'NaN analytic never passes');
  assert.equal(verdict(Infinity, Infinity, 1e-9).pass, false, 'Infinity never passes');
  const v = verdict(1.1, 1, 0.2);
  assert.ok(Math.abs(v.relErr - 0.1) < 1e-12, 'relErr = |s-a|/|a|');
  assert.equal(v.pass, true, 'within tol passes');
  // floor: for bounded quantities near 0 the error is absolute, not blown up
  assert.equal(verdict(1e-12, 0, 1e-9, 1).pass, true, 'abs error with floor 1');
  assert.equal(verdict(1e-3, 0, 1e-9).pass, false, 'zero analytic with real error still fails');
}

// ── every preset PASSES (each row, and overall) ────────────────────────────────
for (const [name, list] of Object.entries(PRESETS)) {
  assert.ok(list.length >= 2, `${name}: has >=2 presets`);
  for (const p of list) {
    const res = CHECKS[name](p.input);
    assert.equal(res.valid, true, `${name}/${p.id}: valid (${res.reason})`);
    assert.ok(res.rows.length >= 1, `${name}/${p.id}: has rows`);
    assert.ok(rowsFinite(res), `${name}/${p.id}: all row numbers finite`);
    for (const r of res.rows) assert.equal(r.pass, true, `${name}/${p.id}/${r.key}: relErr ${r.relErr} > tol ${r.tol}`);
    assert.equal(res.pass, true, `${name}/${p.id}: overall pass`);
  }
}

// ── the sacred regression preset: 1000 g -> gamma ~ 13 ─────────────────────────
{
  const p = PRESETS.accel.find((x) => x.id === 'regress-1000g-gamma13');
  assert.ok(p, 'regression preset exists');
  const res = checkConstantAccel(p.input);
  const g = res.rows.find((r) => r.key === 'gamma');
  assert.ok(Math.abs(g.sim - 13) / 13 < 0.02, `1000g preset gamma_sim ~13, got ${g.sim}`);
  assert.ok(Math.abs(g.analytic - 13) < 1e-6, `analytic cosh(a tau/c) = 13, got ${g.analytic}`);
}

// ── mutation: perturbing the sim value (test seam) must flip to FAIL ───────────
for (const [name, list] of Object.entries(PRESETS)) {
  const p = list[0];
  const clean = CHECKS[name](p.input);
  for (const row of clean.rows) {
    const mutated = CHECKS[name](p.input, { perturb: (key, v) => (key === row.key ? v * 1.01 + 1e-3 : v) });
    const mr = mutated.rows.find((r) => r.key === row.key);
    assert.equal(mr.pass, false, `${name}/${row.key}: 1% wrong sim must FAIL`);
    assert.equal(mutated.pass, false, `${name}/${row.key}: overall must FAIL`);
  }
}

// ── degenerate inputs: refused with a reason, no NaN leaks ─────────────────────
function refused(fn, input, label) {
  const res = fn(input);
  assert.equal(res.valid, false, `${label}: must be refused`);
  assert.equal(res.pass, false, `${label}: refusal is not a pass`);
  assert.equal(typeof res.reason, 'string', `${label}: has reason`);
  assert.ok(res.reason.length > 3, `${label}: reason non-empty`);
  assert.deepEqual(res.rows, [], `${label}: no rows (so no NaN) on refusal`);
}
for (const beta of [NaN, -0.1, 1, 1.5, 1 - 1e-12, Infinity, undefined, '0.5x']) {
  refused(checkGammaBeta, { beta }, `gamma beta=${beta}`);
}
for (const mu of [0, -1, NaN]) refused(checkCircularOrbit, { r: 7e6, mu }, `orbit mu=${mu}`);
for (const r of [0, -5, NaN, Infinity, 1e-9]) refused(checkCircularOrbit, { r, mu: 3.986004418e14 }, `orbit r=${r}`);
for (const [aG, tauS] of [[0, 10], [-1, 10], [NaN, 10], [10, 0], [10, -3], [10, NaN], [1000, 1e9], [2000, 10], [1e-320, 10], [1e-7, 1e9], [5e-324, 1]]) {
  refused(checkConstantAccel, { aG, tauS }, `accel a=${aG} tau=${tauS}`);
}
refused(checkAberration, { beta: 1, cosTheta: 0 }, 'aberration beta=1');
refused(checkAberration, { beta: NaN, cosTheta: 0 }, 'aberration beta NaN');
refused(checkAberration, { beta: 0.5, cosTheta: 2 }, 'aberration cos>1');
refused(checkAberration, { beta: 0.5, cosTheta: NaN }, 'aberration cos NaN');
refused(checkGravityAccel, { mu: 3.986e14, r: 0 }, 'gravity r=0');
refused(checkGravityAccel, { mu: -1, r: 7e6 }, 'gravity mu<0');
refused(checkGammaBeta, undefined, 'no input');
// F6: r / mu so extreme that |a| underflows to denormals -> refused, never a false FAIL
refused(checkGravityAccel, { r: 1e103, mu: 1e50 }, 'gravity r=1e103');
refused(checkGravityAccel, { r: 1e30, mu: 1 }, 'gravity r=1e30');
refused(checkGravityAccel, { r: 7e6, mu: 1e60 }, 'gravity mu=1e60');
// F7: beta refusal states the real bound, not a misleading 'cannot resolve'
{
  const r = checkGammaBeta({ beta: 1 });
  assert.ok(!/cannot resolve/i.test(r.reason), 'no misleading wording');
  assert.ok(/1e-6|0\.999999/.test(r.reason), 'states the bound');
}
// F3: the dilation row was a tautology (1/gamma) -> gone
assert.deepEqual(checkGammaBeta({ beta: 0.5 }).rows.map((r) => r.key), ['gamma'], 'gamma card has only the gamma row');
// F1: dopplerFactor is dead code in the simulator -> not checked here
assert.deepEqual(checkAberration({ beta: 0.5, cosTheta: 0.2 }).rows.map((r) => r.key), ['aberration']);
{
  // aberration must depend on the cos slider
  const a = checkAberration({ beta: 0.6, cosTheta: 0 }).rows[0].analytic;
  const b = checkAberration({ beta: 0.6, cosTheta: 0.5 }).rows[0].analytic;
  assert.notEqual(a, b, 'analytic aberration depends on cosTheta');
}
// F2: limit a*tau/c <= 15 (proper-time precision loss in ship.js 1-beta^2 at gamma>~1e7), >=2x margin
assert.equal(TAU_OVER_C_MAX, 15);
assert.ok(A_MIN_G >= 1e-6);
{
  const tolI = TOL.integrated.value;
  for (const aG of [0.01, 1, 1000]) {
    for (const x of [0.1, 1, 5, 10, 14, 15]) {
      const res = checkConstantAccel({ aG, tauS: x * C / (aG * G0) });
      assert.equal(res.valid, true, `boundary a=${aG} x=${x} valid`);
      const pt = res.rows.find((r) => r.key === 'properTime');
      assert.ok(pt.relErr * 1.5 < tolI, `a=${aG} x=${x}: relErr ${pt.relErr} keeps margin vs ${tolI}`);
      assert.equal(res.pass, true, `boundary a=${aG} x=${x} passes`);
    }
    // just beyond the limit -> refused (where ship.js 1-beta^2 loses precision)
    refused(checkConstantAccel, { aG, tauS: 15.5 * C / (aG * G0) }, `accel x=15.5 a=${aG}`);
    refused(checkConstantAccel, { aG, tauS: 19 * C / (aG * G0) }, `accel x=19 a=${aG}`);
  }
}

// ── extremes that ARE allowed stay finite and PASS ─────────────────────────────
for (const beta of [0, 1e-12, 1e-6, 0.5, 0.999, 1 - 1e-6]) {
  const res = checkGammaBeta({ beta });
  assert.equal(res.valid, true, `beta=${beta} valid`);
  assert.ok(rowsFinite(res), `beta=${beta} finite`);
  assert.equal(res.pass, true, `beta=${beta} passes (${JSON.stringify(res.rows)})`);
}
{
  const g0 = checkGammaBeta({ beta: 0 }).rows.find((r) => r.key === 'gamma');
  assert.equal(g0.sim, 1, 'beta=0 -> gamma exactly 1');
  const res = checkAberration({ beta: 0, cosTheta: 0.3 });
  assert.equal(res.pass, true, 'beta=0 aberration/aberration identity passes');
  for (const beta of [-0.999999, 0.999999, 0.9]) {
    for (const cosTheta of [-1, -0.5, 0, beta, 0.7, 1]) {
      const r = checkAberration({ beta, cosTheta });
      assert.equal(r.valid, true, `aberration beta=${beta} cos=${cosTheta} valid (${r.reason})`);
      assert.ok(rowsFinite(r), `aberration beta=${beta} cos=${cosTheta} finite`);
      assert.equal(r.pass, true, `aberration beta=${beta} cos=${cosTheta}: ${JSON.stringify(r.rows)}`);
    }
  }
}
for (const [r, mu] of [[6.771e6, 3.986004418e14], [1e3, 1e5], [1.495978707e11, 1.32712440018e20], [4.2164e7, 3.986004418e14]]) {
  const res = checkCircularOrbit({ r, mu });
  assert.equal(res.valid, true, `orbit r=${r} valid (${res.reason})`);
  assert.ok(rowsFinite(res), `orbit r=${r} finite`);
  assert.equal(res.pass, true, `orbit r=${r}: ${JSON.stringify(res.rows)}`);
}
for (const [aG, tauS] of [[1, 1], [1, 3.156e7], [0.001, 1e3], [1000, 1e5]]) {
  const res = checkConstantAccel({ aG, tauS });
  assert.equal(res.valid, true, `accel a=${aG} tau=${tauS} valid (${res.reason})`);
  assert.ok(rowsFinite(res), `accel finite`);
  assert.equal(res.pass, true, `accel a=${aG} tau=${tauS}: ${JSON.stringify(res.rows)}`);
}

// tolerances are exported with a stated rationale string
for (const [k, t] of Object.entries(TOL)) {
  assert.ok(t.value > 0 && t.value < 0.1, `TOL.${k}.value sane`);
  assert.ok(typeof t.why === 'string' && t.why.length > 10, `TOL.${k}.why documented`);
}
console.log('verify-live OK');
