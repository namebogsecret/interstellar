// Contract (ТЗ, wave-A adversarial finding on top of A2) for
// orbits.js::orbitFromState near-radial trajectories.
//
// A2 moved the conic computation to p = h²/μ, rApo = p/(1−e) to kill the old
// discontinuity AT the parabola (e flipping across 1 by ULP noise). That fix
// introduced a NEW discontinuity along a different axis: a near-radial BOUND
// trajectory drives BOTH h→0 and e→1 independently, and each is rounded to
// its nearest representable float on its own. `p = h²/μ` then underflows
// toward 0 while `(1−e)` also underflows toward 0, and `rApo = p/(1−e)`
// becomes an uncontrolled 0/0 race — NaN or Infinity, observed on the actual
// (pre-fix) code at μ=Earth, r=7e6, v=(−3000, vTang, 0):
//   vTang=0     bound=true  e=1                    rPeri=0        rApo=NaN
//   vTang=1e-9  bound=true  e=1                    rPeri=6.1e-20  rApo=Infinity
//   vTang=1e-3  bound=true  e=0.9999999999999838   rPeri=6.1e-8   rApo=7583945.77  (fine)
// `bound=true` next to `rApo=NaN`/`Infinity` violates the C1 contract already
// enforced in tests/orbits.classify.test.mjs (bound === Number.isFinite(rApo))
// — that file's ladder only ever varies TANGENTIAL speed at fixed radial
// speed 0, so it never actually drives h→0 on a BOUND state and never
// touched this bug. Consequence in the running sim: js/render/hud.js labels
// a captured, radially-infalling ship "escape" instead of showing a finite
// (huge but real) apoapsis.
//
// Written from the contract, NOT the implementation: R1/R3 are expected to
// fail red against the current code; R2 is an independent vis-viva check so
// a stub that merely clamps NaN→some finite number cannot pass it by luck.
import * as THREE from 'three';
import { orbitFromState } from '../js/physics/orbits.js';
import { approxRel } from './helpers.mjs';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;   // Earth GM
const r = 7.0e6;             // reference orbit radius (m)
const vr = -3000;            // purely radial (infalling) component, m/s

function stateAt(vTang) {
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(vr, vTang, 0);   // x ‖ r (radial), y ⟂ r (tangential)
  return { rVec, vVec };
}

// ═════════════════════════════════════════════════════════════════════════
// R1 — near-radial BOUND states must classify bound with a finite, sane
// apoapsis at every point on the ladder, including the fully-degenerate
// vTang=0 case (h exactly 0).
// ═════════════════════════════════════════════════════════════════════════
const r1VTangs = [0, 1e-12, 1e-9, 1e-6, 1e-3, 1, 100];
const r1Results = r1VTangs.map((vTang) => {
  const { rVec, vVec } = stateAt(vTang);
  return { vTang, ...orbitFromState(mu, rVec, vVec) };
});

for (const res of r1Results) {
  const ctx = `R1 vTang=${res.vTang}`;
  assert.equal(res.bound, true, `${ctx}: this state is well below escape speed, bound must be true, got ${res.bound}`);
  assert.ok(Number.isFinite(res.rApo), `${ctx}: rApo must be finite, got ${res.rApo}`);
  assert.ok(res.rApo > 0, `${ctx}: rApo must be > 0, got ${res.rApo}`);
  assert.ok(Number.isFinite(res.rPeri), `${ctx}: rPeri must be finite, got ${res.rPeri}`);
  assert.ok(res.rPeri >= 0, `${ctx}: rPeri must be >= 0, got ${res.rPeri}`);
  assert.ok(res.rApo >= res.rPeri, `${ctx}: rApo (${res.rApo}) must be >= rPeri (${res.rPeri})`);
}

// ═════════════════════════════════════════════════════════════════════════
// R2 — physical correctness (not just finiteness) at the fully-degenerate
// point: purely radial infall (vTang=0) is a vanishing-h limit ellipse whose
// apoapsis is exactly 2a, with `a` computed independently from vis-viva
// (a = −μ / (2·eps), eps = v²/2 − μ/r) — NOT via the implementation's own
// p/(1−e) path, so a stub that special-cases vTang===0 to "look right" by
// reusing the buggy formula's intermediate values cannot pass this by luck.
// ═════════════════════════════════════════════════════════════════════════
{
  const { rVec, vVec } = stateAt(0);
  const v2 = vr * vr;                      // tangential component is exactly 0
  const eps = v2 / 2 - mu / r;
  assert.ok(eps < 0, 'R2 setup: state must be bound (eps < 0)');
  const aWant = -mu / (2 * eps);
  const rApoWant = 2 * aWant;

  const { rApo } = orbitFromState(mu, rVec, vVec);
  approxRel(rApo, rApoWant, 1e-9, 'R2: radial-infall rApo must equal 2a from independent vis-viva');
}

// ═════════════════════════════════════════════════════════════════════════
// R3 — monotone continuity: walk vTang up a log ladder from 1e-12 to 1e3
// (>=12 points) and require rApo to change SMOOTHLY — no adjacent pair may
// differ by more than a factor of 1.5, and no NaN/Infinity may appear
// anywhere on the ladder. This is exactly the shape of the bug: a jump from
// some finite value to Infinity (or NaN) between two adjacent, physically
// near-identical states.
// ═════════════════════════════════════════════════════════════════════════
{
  const N = 12;
  const logMin = Math.log10(1e-12);
  const logMax = Math.log10(1e3);
  const vTangs = [];
  for (let k = 0; k < N; k++) {
    const t = logMin + (logMax - logMin) * (k / (N - 1));
    vTangs.push(Math.pow(10, t));
  }
  assert.ok(vTangs.length >= 12, `R3 setup: ladder must have >=12 points, got ${vTangs.length}`);

  const rApos = vTangs.map((vTang) => {
    const { rVec, vVec } = stateAt(vTang);
    const { rApo } = orbitFromState(mu, rVec, vVec);
    assert.ok(!Number.isNaN(rApo), `R3 vTang=${vTang}: rApo must never be NaN`);
    assert.ok(Number.isFinite(rApo), `R3 vTang=${vTang}: rApo must never be Infinity (state is bound, well below escape)`);
    return rApo;
  });

  for (let i = 1; i < rApos.length; i++) {
    const ratio = rApos[i] / rApos[i - 1];
    assert.ok(ratio <= 1.5 && ratio >= 1 / 1.5,
      `R3: rApo jumped by factor ${ratio} between vTang=${vTangs[i - 1]} (rApo=${rApos[i - 1]}) and ` +
      `vTang=${vTangs[i]} (rApo=${rApos[i]}) — adjacent ladder points must not differ by more than 1.5x`);
  }
}

console.log('orbits.radial.test.mjs OK');
