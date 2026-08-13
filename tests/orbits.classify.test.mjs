// Contract (ТЗ, consequence of A2) for orbits.js::orbitFromState classifier
// output. A2 switched bound/unbound classification from `e >= 1` (which lands
// a few ULPs on either side of 1 in floating point right at exact escape
// speed) to specific orbital energy `eps = v²/2 − μ/r < 0`, and the returned
// object is expected to gain an explicit `bound` field (`eps < 0`) alongside
// the existing {a, e, rPeri, rApo}. This file is written from that contract,
// NOT from the implementation: if `bound` hasn't landed yet, every block
// below fails red on the first `bound`-touching assert — that is the point,
// not a bug in this test.
//
// The bug this guards against: the HUD picked its bound/unbound BRANCH from
// one field (old `e`-based classification) and read its DISPLAYED VALUE from
// another (`rApo`). When those two disagreed near escape speed, the HUD could
// show "elliptical" next to a huge/near-Infinity apoapsis, or vice versa.
// `bound` and `Number.isFinite(rApo)` are contractually required to be the
// SAME statement, never two independently-computed ones.
import * as THREE from 'three';
import { orbitFromState } from '../js/physics/orbits.js';
import { approxAbs, approxRel } from './helpers.mjs';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;   // Earth GM
const r = 7.0e6;             // reference orbit radius (m)
const vEsc = Math.sqrt(2 * mu / r);
const vCirc = Math.sqrt(mu / r);

// ── Dense ladder of speeds straddling the escape boundary: 0.99·vEsc to
//    1.01·vEsc, at least 15 points, INCLUDING vEsc exactly. Built as 14
//    evenly-spaced fractions plus the exact fraction 1.0 inserted and
//    sorted, rather than relying on a stepped loop to land on 1.0 by luck.
const N = 14;
const fractions = [];
for (let k = 0; k < N; k++) {
  fractions.push(0.99 + (k / (N - 1)) * 0.02);   // 0.99 .. 1.01 inclusive
}
fractions.push(1.0);
fractions.sort((a, b) => a - b);
assert.ok(fractions.length >= 15, `ladder must have >=15 points, got ${fractions.length}`);
assert.ok(fractions.some((f) => f === 1.0), 'ladder must include the exact escape fraction 1.0');

// State at each ladder point: tangential velocity at radius r (mirrors the
// perigee-style states used elsewhere in this suite), so |v| = fraction·vEsc
// exactly and the only thing varying is speed relative to escape.
function stateAt(fraction) {
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, fraction * vEsc, 0);
  return { rVec, vVec };
}

const results = fractions.map((f) => {
  const { rVec, vVec } = stateAt(f);
  return { f, ...orbitFromState(mu, rVec, vVec) };
});

// ═════════════════════════════════════════════════════════════════════════
// C1 — equivalence: bound === Number.isFinite(rApo) at every ladder point.
// ═════════════════════════════════════════════════════════════════════════
for (const res of results) {
  assert.equal(
    res.bound, Number.isFinite(res.rApo),
    `C1 @ v=${res.f}·vEsc: bound=${res.bound} but Number.isFinite(rApo)=${Number.isFinite(res.rApo)} ` +
    `(rApo=${res.rApo}) — these must be the SAME statement`
  );
}

// ═════════════════════════════════════════════════════════════════════════
// C2 — no non-numbers/negatives on the boundary; unbound rApo is EXACTLY
// Infinity, never a large finite stand-in.
// ═════════════════════════════════════════════════════════════════════════
for (const res of results) {
  assert.ok(Number.isFinite(res.rPeri), `C2 @ v=${res.f}·vEsc: rPeri must be finite, got ${res.rPeri}`);
  assert.ok(res.rPeri >= 0, `C2 @ v=${res.f}·vEsc: rPeri must be >= 0, got ${res.rPeri}`);
  assert.ok(!Number.isNaN(res.rApo), `C2 @ v=${res.f}·vEsc: rApo must never be NaN`);
  assert.ok(res.rApo >= 0 || res.rApo === Infinity,
    `C2 @ v=${res.f}·vEsc: rApo must never be negative, got ${res.rApo}`);
  if (res.bound === false) {
    assert.equal(res.rApo, Infinity,
      `C2 @ v=${res.f}·vEsc: unbound state must report rApo === Infinity exactly, ` +
      `got ${res.rApo} (a large-but-finite stand-in is the old bug this guards against)`);
  } else {
    assert.ok(Number.isFinite(res.rApo) && res.rApo > 0,
      `C2 @ v=${res.f}·vEsc: bound state must report a finite, positive rApo, got ${res.rApo}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// C3 — monotonicity: `bound` flips true→false exactly once as speed rises
// across the ladder (no flicker around the boundary).
// ═════════════════════════════════════════════════════════════════════════
{
  let flips = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].bound !== results[i - 1].bound) flips++;
  }
  assert.equal(flips, 1,
    `C3: bound must flip exactly once across the escape-speed ladder, got ${flips} flips ` +
    `(sequence: ${results.map((res) => (res.bound ? 'T' : 'F')).join('')})`);
  assert.equal(results[0].bound, true, 'C3: slowest ladder point (0.99·vEsc) must be bound');
  assert.equal(results[results.length - 1].bound, false, 'C3: fastest ladder point (1.01·vEsc) must be unbound');
}

// ═════════════════════════════════════════════════════════════════════════
// C4 — regression: normal circular/elliptical/hyperbolic states classify as
// before, now via the explicit `bound` field.
// ═════════════════════════════════════════════════════════════════════════

// circular
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vCirc, 0);
  const { bound, rApo } = orbitFromState(mu, rVec, vVec);
  assert.equal(bound, true, 'C4 circular: bound must be true');
  assert.ok(Number.isFinite(rApo) && rApo > 0, `C4 circular: rApo must be finite & > 0, got ${rApo}`);
  approxRel(rApo, r, 1e-9, 'C4 circular: rApo ≈ r');
}

// elliptical, e ≈ 0.5
{
  const aWant = 1.4e7, eWant = 0.5;               // rPeri = aWant*(1-eWant) = r
  const vPeri = Math.sqrt(mu * (2 / r - 1 / aWant));   // vis-viva at perigee
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vPeri, 0);
  const { bound, e, rApo } = orbitFromState(mu, rVec, vVec);
  approxAbs(e, eWant, 1e-9, 'C4 ellipse: e ≈ 0.5');
  assert.equal(bound, true, 'C4 ellipse(e≈0.5): bound must be true');
  assert.ok(Number.isFinite(rApo) && rApo > 0, `C4 ellipse: rApo must be finite & > 0, got ${rApo}`);
  approxRel(rApo, aWant * (1 + eWant), 1e-9, 'C4 ellipse: rApo = a(1+e)');
}

// hyperbolic, v = 15000 at r = 7e6 (> escape ≈ 10672)
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, 15000, 0);
  const { bound, rPeri, rApo } = orbitFromState(mu, rVec, vVec);
  assert.equal(bound, false, 'C4 hyperbolic: bound must be false');
  assert.equal(rApo, Infinity, 'C4 hyperbolic: rApo must be exactly Infinity');
  assert.ok(Number.isFinite(rPeri) && rPeri > 0, `C4 hyperbolic: rPeri finite & > 0, got ${rPeri}`);
}

console.log('orbits.classify.test.mjs OK');
