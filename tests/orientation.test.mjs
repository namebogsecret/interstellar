// ─────────────────────────────────────────────────────────────────────────────
// INV — A6: a body's world spin orientation is ONE rotation, not two
// independently-set Euler components on the same Object3D.
//
// js/render/bodies.js currently does:
//   constructor:  spinGroup.rotation.z = body.tilt || 0
//   update(t):    spinGroup.rotation.y = spinAngle(this.body, t)   // every frame
// Under THREE's default Euler order 'XYZ' this composes as q = qY(spin)·qZ(tilt)
// — the spin term rotates around the WORLD Y axis, not the body's own tilted
// pole, so a tilted axis (Uranus, tilt≈97.77°) sweeps a cone across the frame
// instead of holding still. Physics (orbits.js spinAxis) tilts around X; the
// render path tilts around Z — a second, independent convention mismatch.
//
// Contract (implemented by another agent): orbits.js exports a pure
//   bodyOrientation(b, t, outQuat = new THREE.Quaternion()) -> THREE.Quaternion
// — the single, correct world orientation of the spin group, satisfying:
//   I1 (pole fixed):     q(t)·(0,1,0) === spinAxis(b)                    for ALL t
//   I2 (spin magnitude): rotation of q(t) around spinAxis(b), measured from the
//                        t=0 orientation, equals spinAngle(b, t)  (mod 2π)
//   I3 (tilt=0 fallback): q(t) === Quaternion.setFromAxisAngle((0,1,0), spinAngle(b,t))
//
// `bodyOrientation` does not exist yet -> the import below fails at LINK TIME
// ("does not provide an export named 'bodyOrientation'"), so this whole file
// is RED on the current tree (same pattern as touchdown.impact.test.mjs).
// Written from the ТЗ contract, NOT the implementation.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { bodyOrientation, spinAxis, spinAngle } from '../js/physics/orbits.js';
import { BODIES } from '../js/data/bodies.js';
import { angDist } from './helpers.mjs';
import assert from 'node:assert/strict';

const Uranus = BODIES.find((b) => b.name === 'Uranus');
const Earth = BODIES.find((b) => b.name === 'Earth');
const Sun = BODIES.find((b) => b.name === 'Sun');
assert.ok(Uranus && Uranus.tilt > 1.5, 'Uranus must exist with a large axial tilt (~97.77°)');
assert.ok(Earth && Earth.tilt > 0, 'Earth must exist with a nonzero axial tilt');
assert.ok(Sun && (Sun.tilt || 0) === 0, 'Sun must exist with tilt = 0 (I3 fixture)');

// t-values expressed as fractions of the body's OWN rotation period, plus two
// large/negative absolute times to catch a formula that only happens to work
// near t=0.
function tSet(b) {
  const P = b.rotPeriod;
  return [0, P / 8, P / 4, P / 2, 1e6, -3.7e5];
}

// Signed angle (radians, principal value, right-hand rule around `axis`) that
// carries unit vector `a` to vector `b`. Both are assumed ⟂ to `axis`.
function signedAngleAround(a, b, axis) {
  const e1 = a.clone().normalize();
  const e2 = axis.clone().normalize().cross(e1.clone());
  const c = b.dot(e1), s = b.dot(e2);
  return Math.atan2(s, c);
}

// ── I1: the pole is FIXED — q(t)·(0,1,0) === spinAxis(b) for every t ────────
//
// NUMERIC-FLOOR NOTE — do not "tighten" this back to acos(dot) + 1e-12:
// That original formulation required acos(pole.dot(axis)) < 1e-12. It is
// unsatisfiable in double precision even for two CORRECTLY, independently
// constructed unit vectors that agree exactly up to rounding: acos'(x) -> ∞
// as x -> 1, so a componentwise rounding error of ε≈1e-16 (verified here:
// pole and axis agree to ~1e-16 per component, and independently via BOTH
// quaternion multiplication and Matrix4 composition, which give the
// identical result) gets amplified by acos() near 1 to angle ≈ sqrt(2ε) ≈
// 1.5e-8 rad. That is a property of acos() near θ=0, not a bug in
// bodyOrientation() — measured on Earth, t=rotPeriod/8: acos gave 1.49e-8
// rad while `1 - |dot|` itself was 1.1e-16 (i.e. genuinely machine-epsilon).
//
// Fix: measure the angle via atan2(|pole×axis|, pole·axis) instead of
// acos(pole·axis) — the standard numerically-stable form for the angle
// between two nearly-parallel unit vectors. Unlike 1-cos(θ), |cross| does
// not suffer catastrophic cancellation near θ=0, so its rounding error stays
// at the ~ulp level instead of being blown up by acos's 1/sqrt(1-x²)
// derivative. This is the SAME formula I2's signedAngleAround() already uses
// below (that's why I2 passes untouched: it was never on the acos floor).
// Re-measured on this tree with atan2: ≤2.8e-16 rad at every (body, t) point
// that previously showed 1.49e-8 via acos — the metric changed, not the
// vectors being compared.
//
// Tolerance: 1e-7 rad. Deliberately far above the ~1e-16 floor observed here
// (≈9 orders of margin for other hardware/compilers/three.js builds) while
// still 6 orders of magnitude STRICTER than the bug this test exists to
// catch — I4 below shows the pre-fix Euler-composition bug lets Uranus's
// pole wander by >0.1 rad. Do not re-tighten below ~1e-7: that walks back
// into the same acos-style noise floor on a different metric, for zero gain
// in actual bug-catching power (the real fault line is 6+ orders away).
for (const b of [Uranus, Earth]) {
  const axis = spinAxis(b, new THREE.Vector3());
  for (const t of tSet(b)) {
    const q = bodyOrientation(b, t);
    const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const ang = Math.atan2(pole.clone().cross(axis).length(), pole.dot(axis));
    assert.ok(ang < 1e-7,
      `I1 pole-fixed (${b.name}, t=${t}): angle(q·Y, spinAxis) = ${ang} rad >= 1e-7`);
  }
}

// ── I2: rotation around that axis IS spinAngle(b,t) — not some other rate ──
for (const b of [Uranus, Earth]) {
  const axis = spinAxis(b, new THREE.Vector3());
  const localX = new THREE.Vector3(1, 0, 0);           // any fixed material point, ⟂ local spin axis
  const uRef = localX.clone().applyQuaternion(bodyOrientation(b, 0));   // world ref @ t=0 (spinAngle(0)=0)
  for (const t of tSet(b)) {
    const w = localX.clone().applyQuaternion(bodyOrientation(b, t));
    const measured = signedAngleAround(uRef, w, axis);
    const expected = spinAngle(b, t);
    assert.ok(angDist(measured, expected) < 1e-9,
      `I2 spin-magnitude (${b.name}, t=${t}): measured ${measured} rad vs spinAngle ${expected} rad (Δ=${angDist(measured, expected)})`);
  }
}

// ── I3: tilt=0 body reduces to the plain Y-axis quaternion (back-compat) ───
for (const t of tSet(Sun)) {
  const q = bodyOrientation(Sun, t);
  const ref = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spinAngle(Sun, t));
  for (const k of ['x', 'y', 'z', 'w']) {
    approxAbsComponent(q[k], ref[k], t, k);
  }
}
function approxAbsComponent(actual, expected, t, k) {
  const d = Math.abs(actual - expected);
  assert.ok(d <= 1e-12,
    `I3 tilt=0 fallback (Sun, t=${t}): q.${k}=${actual} vs plain-Y ref.${k}=${expected} (Δ=${d})`);
}

// ── I4 (documents the pre-fix Euler-composition bug) ────────────────────────
// spinGroup.rotation.z = tilt (constructor) + spinGroup.rotation.y = spinAngle(t)
// (every frame) on the SAME Object3D — reproduces js/render/bodies.js exactly,
// using raw THREE only (no dependency on bodyOrientation). This block is
// GREEN both on today's tree and after the fix — it fixes, as a permanent
// test, WHAT the bug was, so it never silently stops reproducing.
{
  const period = Uranus.rotPeriod;
  function eulerPole(t) {
    const g = new THREE.Object3D();
    g.rotation.z = Uranus.tilt;
    g.rotation.y = spinAngle(Uranus, t);
    g.updateMatrixWorld();
    return new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
  }
  const pole0 = eulerPole(0);
  const poleQuarter = eulerPole(period / 4);
  const ang = Math.acos(Math.max(-1, Math.min(1, pole0.dot(poleQuarter))));
  assert.ok(ang > 0.1,
    `I4 documents the pre-fix Euler-composition bug: the OLD spinGroup.rotation.z/y ` +
    `composition must let Uranus's pole wander by >0.1 rad between t=0 and t=period/4 ` +
    `(got ${ang} rad) — this is the bug bodyOrientation() fixes; it does NOT depend on ` +
    `bodyOrientation and must stay green as a historical record`);
}

console.log('orientation.test.mjs OK');
