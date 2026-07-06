// ─────────────────────────────────────────────────────────────────────────────
// PROPAGATOR ROUND-TRIP + ALIASING — universal-variable propagator (WI-1).
// Locks ТЗ INV-P4 (propagate(+Δt) ∘ propagate(−Δt) ≈ identity) across ALL conics,
// and INV-P6 (aliasing-safe: outs may === inputs, identical result).
// Catalog: INV-PHYS-05 (time reversibility of a symmetric map).
//
// State is built directly from the perigee (rPeri=r0, e) with vPeri=√(μ(1+e)/r0),
// valid for e<1, e=1 (parabola), e>1 (hyperbola) WITHOUT ever forming `a` or
// 1/(1−e) — the exact reason universal variables are used.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { propagateUniversal } from '../js/physics/orbits.js';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;      // Earth GM
const r0 = 7.0e6;
const dt = 200;                 // short step (s)

const relVecErr = (aVec, bVec) => aVec.distanceTo(bVec) / (bVec.length() || 1);

for (const e of [0, 0.3, 0.9999, 1.0, 1.0001, 1.5]) {
  const vPeri = Math.sqrt(mu * (1 + e) / r0);       // all-conic perigee speed
  const r0Vec = new THREE.Vector3(r0, 0, 0);
  const v0Vec = new THREE.Vector3(0, vPeri, 0);

  // ── INV-P4 round-trip: forward +dt then back −dt ⇒ identity ──
  const r1 = new THREE.Vector3(), v1 = new THREE.Vector3();
  const r2 = new THREE.Vector3(), v2 = new THREE.Vector3();
  assert.ok(propagateUniversal(mu, r0Vec, v0Vec, dt, r1, v1), `e=${e}: forward step converges`);
  assert.ok(propagateUniversal(mu, r1, v1, -dt, r2, v2), `e=${e}: backward step converges`);
  // Elliptic short step: tighten to 1e-9; e≥1 large-χ precision loss: 1e-7.
  const tol = e < 1 ? 1e-9 : 1e-7;
  assert.ok(relVecErr(r2, r0Vec) <= tol, `e=${e}: INV-P4 |Δr|/|r0| = ${relVecErr(r2, r0Vec)} > ${tol}`);
  assert.ok(relVecErr(v2, v0Vec) <= tol, `e=${e}: INV-P4 |Δv|/|v0| = ${relVecErr(v2, v0Vec)} > ${tol}`);

  // ── INV-P6 aliasing: repeat the forward step with outs ALIASING the inputs ──
  const rA = r0Vec.clone(), vA = v0Vec.clone();
  assert.ok(propagateUniversal(mu, rA, vA, dt, rA, vA), `e=${e}: aliased step converges`);
  // Must match the non-aliased forward result bit-for-bit (allow only fp noise).
  assert.ok(relVecErr(rA, r1) <= 1e-12, `e=${e}: INV-P6 aliased r differs from distinct-out r (${relVecErr(rA, r1)})`);
  assert.ok(relVecErr(vA, v1) <= 1e-12, `e=${e}: INV-P6 aliased v differs from distinct-out v (${relVecErr(vA, v1)})`);

  // Aliasing must not have corrupted anything into NaN.
  assert.ok(Number.isFinite(rA.x + rA.y + rA.z + vA.x + vA.y + vA.z), `e=${e}: aliased state finite`);
}

// ── POST(false): on non-convergence rOut/vOut are UNMODIFIED (degenerate input) ──
// |r0Vec| == 0 is a documented PRE violation ⇒ must return FALSE and touch nothing.
{
  const rBad = new THREE.Vector3(0, 0, 0);
  const vBad = new THREE.Vector3(0, 0, 0);
  const rOut = new THREE.Vector3(123, 456, 789);
  const vOut = new THREE.Vector3(-1, -2, -3);
  const rSnap = rOut.clone(), vSnap = vOut.clone();
  const ok = propagateUniversal(mu, rBad, vBad, dt, rOut, vOut);
  assert.equal(ok, false, 'degenerate |r0|==0 ⇒ returns FALSE');
  assert.ok(rOut.equals(rSnap) && vOut.equals(vSnap), 'FALSE ⇒ rOut/vOut left UNMODIFIED');
}

console.log('propagator.roundtrip.test.mjs OK');
