// ─────────────────────────────────────────────────────────────────────────────
// PROPAGATOR ALL-CONIC (e ≈ 1 guard) — universal-variable propagator (WI-1).
// Locks ТЗ INV-P5: parabolic (e=1), hyperbolic (e>1) and near-parabolic
// (e=0.9999, 1.0001) states stay FINITE and correct where the existing e<1
// `eccentricAnomaly` Newton (1−e·cosE → 0) would blow up.
// Catalog: INV-PHYS-07 (limiting case vs closed form — Barker parabolic solution).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { propagateUniversal } from '../js/physics/orbits.js';
import { approxRel, approxAbs } from './helpers.mjs';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;      // Earth GM
const q  = 7.0e6;               // perihelion distance (m)

const energy = (r, v) => 0.5 * v.lengthSq() - mu / r.length();
const angMom = (r, v) => new THREE.Vector3().crossVectors(r, v);
const finite = (...vs) => vs.every(u => Number.isFinite(u.x + u.y + u.z));

// ── Parabolic e=1: ε≈0, h conserved, radius matches Barker closed form to 1e-6 ──
// Barker: with q = perihelion, D = tan(ν/2) solves  D + D³/3 = √(μ/(2q³))·dt.
// Cardano real root of D³ + 3D − 3M = 0, then r = q·(1 + D²).
{
  const vPeri = Math.sqrt(2 * mu / q);            // parabolic escape speed at q
  const r = new THREE.Vector3(q, 0, 0);
  const v = new THREE.Vector3(0, vPeri, 0);
  const eps0 = energy(r, v);                      // ≈ 0
  const h0 = angMom(r, v);
  approxAbs(eps0, 0, 1e-3 * (mu / q), 'parabolic: ε_in ≈ 0 (setup sanity)');

  const dt = 400;
  const rN = new THREE.Vector3(), vN = new THREE.Vector3();
  const ok = propagateUniversal(mu, r, v, dt, rN, vN);
  assert.ok(ok, 'parabolic: propagateUniversal must converge (Stumpff series at ψ→0)');
  assert.ok(finite(rN, vN), 'parabolic: outputs finite (no 1/(1−e) blow-up)');

  const M = Math.sqrt(mu / (2 * q * q * q)) * dt;
  const A = 1.5 * M, disc = Math.sqrt(A * A + 1);
  const D = Math.cbrt(A + disc) + Math.cbrt(A - disc);
  const rBarker = q * (1 + D * D);
  approxRel(rN.length(), rBarker, 1e-6, 'parabolic: |r| matches Barker closed form');

  // ε stays ≈ 0 (absolute tol per ТЗ), h conserved as a vector.
  approxAbs(energy(rN, vN), 0, 1e-3 * (mu / q), 'parabolic INV-P5: ε stays ≈ 0');
  // NOTE: approxRel(x, 0, tol) silently collapses to an ABSOLUTE bound (helpers.mjs
  // divides by |expected|||1; expected=0 hits the ||1 fallback) — impossible
  // precision for |h0| of this magnitude. Normalize by |h0| ourselves so the
  // zero-comparison is already the RELATIVE quantity the ТЗ specifies.
  approxAbs(angMom(rN, vN).distanceTo(h0) / h0.length(), 0, 1e-8, 'parabolic INV-P5: |h_out−h_in|/|h_in| conserved');
}

// ── Hyperbolic e=1.5: ε>0 conserved, h conserved, radius monotone outbound ──
{
  const e = 1.5;
  const vPeri = Math.sqrt(mu * (1 + e) / q);
  const base = { r: new THREE.Vector3(q, 0, 0), v: new THREE.Vector3(0, vPeri, 0) };
  const eps0 = energy(base.r, base.v);
  const h0 = angMom(base.r, base.v);
  assert.ok(eps0 > 0, 'hyperbolic: ε > 0 (unbound)');

  let prev = q;   // radius at perigee (t=0)
  for (const dt of [200, 400, 800, 1600, 3200]) {
    const rN = new THREE.Vector3(), vN = new THREE.Vector3();
    const ok = propagateUniversal(mu, base.r, base.v, dt, rN, vN);   // fresh from perigee
    assert.ok(ok, `hyperbolic dt=${dt}: converges`);
    assert.ok(finite(rN, vN), `hyperbolic dt=${dt}: finite`);
    approxRel(energy(rN, vN), eps0, 1e-8, `hyperbolic dt=${dt}: INV-P5 ε conserved`);
    approxAbs(angMom(rN, vN).distanceTo(h0) / h0.length(), 0, 1e-8, `hyperbolic dt=${dt}: INV-P5 |h_out−h_in|/|h_in| conserved`);
    assert.ok(rN.length() > prev, `hyperbolic: radius monotonically increasing outbound (dt=${dt})`);
    prev = rN.length();
  }
}

// ── Near-parabolic e ∈ {0.9999, 1.0001}: the case eccentricAnomaly CANNOT handle ──
for (const e of [0.9999, 1.0001]) {
  const vPeri = Math.sqrt(mu * (1 + e) / q);
  const r = new THREE.Vector3(q, 0, 0);
  const v = new THREE.Vector3(0, vPeri, 0);
  const eps0 = energy(r, v);
  const h0 = angMom(r, v);
  const rN = new THREE.Vector3(), vN = new THREE.Vector3();
  const ok = propagateUniversal(mu, r, v, 500, rN, vN);
  assert.ok(ok, `near-parabolic e=${e}: converges (no e-specific branch)`);
  assert.ok(finite(rN, vN), `near-parabolic e=${e}: INV-P5 outputs finite`);
  // |ε| is tiny here ⇒ compare with the parabolic absolute tol (rel would be meaningless).
  approxAbs(energy(rN, vN), eps0, 1e-3 * (mu / q), `near-parabolic e=${e}: ε conserved (abs tol)`);
  approxAbs(angMom(rN, vN).distanceTo(h0) / h0.length(), 0, 1e-8, `near-parabolic e=${e}: |h_out−h_in|/|h_in| conserved`);
}

console.log('propagator.parabolic.test.mjs OK');
