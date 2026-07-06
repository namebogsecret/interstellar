// ─────────────────────────────────────────────────────────────────────────────
// PROPAGATOR CONSERVATION — universal-variable Kepler propagator (WI-1, orbits.js).
// Locks ТЗ INV-P1 (specific energy ε), INV-P2 (angular-momentum VECTOR h),
// INV-P3 (Wronskian f·ġ − ḟ·g = 1). Catalog: INV-PHYS-01 (energy), INV-PHYS-03
// (angular momentum under central force), INV-PHYS-10 (Kepler integral elements).
// Written FROM the ТЗ contract, not from any implementation (none exists yet).
//
// Anti-pattern avoided: not "propagate once, assert no throw". Each step re-derives
// ε and h from the OUTPUT state and compares to the input — a broken propagator
// that drifts energy/momentum (a mutated conic) is caught.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { propagateUniversal, bodyVelocity } from '../js/physics/orbits.js';
import { BODIES, byName } from '../js/data/bodies.js';
import { approxRel, approxAbs } from './helpers.mjs';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;              // Earth GM (real value from bodies.js)

// Specific orbital energy ε = |v|²/2 − μ/|r|  and  h = r × v (vector).
function energy(r, v) { return 0.5 * v.lengthSq() - mu / r.length(); }
function angMom(r, v) { return new THREE.Vector3().crossVectors(r, v); }

// Perigee state of a bound ellipse: rPeri = r0, e given ⇒ vPeri = √(μ(1+e)/r0),
// perpendicular to r (perigee). a = r0/(1−e), T = 2π√(a³/μ).
const r0 = 7.0e6, e = 0.3;
const a = r0 / (1 - e);
const T = 2 * Math.PI * Math.sqrt(a * a * a / mu);
const vPeri = Math.sqrt(mu * (1 + e) / r0);

// ── (a) INV-P1/P2: 1000 stepwise propagations over ~50 periods (compounded) ──
{
  const r = new THREE.Vector3(r0, 0, 0);
  const v = new THREE.Vector3(0, vPeri, 0);
  const eps0 = energy(r, v);
  const h0 = angMom(r, v);

  const nSteps = 1000;
  const dt = (50 * T) / nSteps;         // ~T/20 per step
  for (let k = 0; k < nSteps; k++) {
    const ok = propagateUniversal(mu, r, v, dt, r, v);  // in-place (aliased)
    assert.ok(ok, `INV-P1/P2 step ${k}: propagateUniversal must converge on a bound ellipse`);
    approxRel(energy(r, v), eps0, 1e-8, `INV-P1 energy conserved @step ${k}`);
    const h = angMom(r, v);
    // NOTE: approxRel(x, 0, tol) would silently collapse to an ABSOLUTE bound
    // (helpers.mjs divides by |expected|||1, and expected=0 hits the ||1
    // fallback) — impossible precision for |h0|~5e10. Normalize by |h0|
    // ourselves so the comparison-to-zero is already the RELATIVE quantity
    // the ТЗ specifies: |h_out−h_in|/|h_in| ≤ 1e-8.
    approxAbs(h.distanceTo(h0) / h0.length(), 0, 1e-8, `INV-P2 |h_out−h_in|/|h_in| @step ${k}`);
    // guard against silent NaN corruption of the shared conic state
    assert.ok(Number.isFinite(r.x + r.y + r.z + v.x + v.y + v.z), `finite state @step ${k}`);
  }
  // |h0| itself is O(r0·vPeri); a rel bound is meaningful (h is not near zero).
  assert.ok(h0.length() > 1e9, 'sanity: |h0| large enough for a relative bound');
}

// ── (b) INV-P1/P2 multi-revolution: ONE single step spanning 50 periods ──
{
  const r = new THREE.Vector3(r0, 0, 0);
  const v = new THREE.Vector3(0, vPeri, 0);
  const eps0 = energy(r, v);
  const h0 = angMom(r, v);
  const rOut = new THREE.Vector3(), vOut = new THREE.Vector3();
  const ok = propagateUniversal(mu, r, v, 50 * T, rOut, vOut);
  assert.ok(ok, 'INV-P1 multi-rev: single 50-period step must converge');
  approxRel(energy(rOut, vOut), eps0, 1e-8, 'INV-P1 energy conserved over 50 periods (1 step)');
  approxAbs(angMom(rOut, vOut).distanceTo(h0) / h0.length(), 0, 1e-8, 'INV-P2 |h_out−h_in|/|h_in| over 50 periods (1 step)');
}

// ── (c) INV-P3 Wronskian f·ġ − ḟ·g = 1, recomputed from the OUTPUT vectors ──
// rNew = f·r0 + g·v0 ; vNew = ḟ·r0 + ġ·v0. With r0,v0 spanning the orbital plane,
// solve each scalar by the cross-product projection onto the plane normal:
//   f = (rNew×v0)·n / |n|² , g = (rNew×r0)·(v0×r0)/|n|² , etc., n = r0×v0.
{
  const r = new THREE.Vector3(r0, 0, 0);
  const v = new THREE.Vector3(0, vPeri, 0);
  const rN = new THREE.Vector3(), vN = new THREE.Vector3();
  const ok = propagateUniversal(mu, r, v, T / 7, rN, vN);   // arbitrary partial arc
  assert.ok(ok, 'INV-P3: propagateUniversal must converge');

  const n = new THREE.Vector3().crossVectors(r, v);
  const n2 = n.lengthSq();
  const proj = (X, Y) => new THREE.Vector3().crossVectors(X, Y).dot(n) / n2;
  const f  = proj(rN, v);          // rNew×v0 = f (r0×v0)
  const g  = -proj(rN, r);         // rNew×r0 = −g (r0×v0)  ⇒ g = −(rNew×r0)·n/|n|²
  const fd =  proj(vN, v);         // vNew×v0 = ḟ (r0×v0)
  const gd = -proj(vN, r);         // vNew×r0 = −ġ (r0×v0)
  approxAbs(f * gd - fd * g, 1, 1e-9, 'INV-P3 Wronskian f·ġ − ḟ·g = 1');
}

// ── retrograde h: v0 sign flipped ⇒ h reversed; direction + magnitude conserved ──
{
  const r = new THREE.Vector3(r0, 0, 0);
  const v = new THREE.Vector3(0, -vPeri, 0);   // retrograde
  const eps0 = energy(r, v);
  const h0 = angMom(r, v);
  assert.ok(h0.z < 0, 'sanity: retrograde ⇒ h_z < 0');
  const rN = new THREE.Vector3(), vN = new THREE.Vector3();
  const ok = propagateUniversal(mu, r, v, T / 5, rN, vN);
  assert.ok(ok, 'retrograde: must converge (no prograde assumption in universal vars)');
  approxRel(energy(rN, vN), eps0, 1e-8, 'retrograde INV-P1 energy conserved');
  approxAbs(angMom(rN, vN).distanceTo(h0) / h0.length(), 0, 1e-8, 'retrograde INV-P2 |h_out−h_in|/|h_in| (direction kept)');
}

// ── bodyVelocity relocation (orbits.js) — pure central finite diff, must be exported ──
// Locks the WI-1 relocation of bodyVelocity from main.js and its correctness:
// Earth's heliocentric orbital speed is ~29.78 km/s.
{
  const earth = byName('Earth');
  const vb = bodyVelocity(earth, 0, byName);
  assert.ok(vb instanceof THREE.Vector3, 'bodyVelocity returns a THREE.Vector3');
  approxRel(vb.length(), 29780, 0.05, 'bodyVelocity(Earth): |v| ≈ 29.78 km/s');
  assert.ok(Number.isFinite(vb.x + vb.y + vb.z), 'bodyVelocity finite');
}

console.log('propagator.conservation.test.mjs OK');
