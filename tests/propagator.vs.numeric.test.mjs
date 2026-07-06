// ─────────────────────────────────────────────────────────────────────────────
// PROPAGATOR vs NUMERIC — analytic universal-variable step vs real integration.
// Locks ТЗ §8.4: (a) CIRCULAR orbit exact to 1e-9 (closed-form rotation);
// (b) ECCENTRIC orbit vs an inline RK4 reference (built here, NOT from unwritten
// code) to 1e-4 relative (ref-limited).
// Catalog: INV-PHYS-07 (closed form, circular) + INV-PHYS-04 (agreement with a
// convergent numeric integrator).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { propagateUniversal } from '../js/physics/orbits.js';
import { gravityAccel } from '../js/physics/gravity.js';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;      // Earth GM
const r0 = 7.0e6;

const relVecErr = (aVec, bVec) => aVec.distanceTo(bVec) / (bVec.length() || 1);

// ── (a) CIRCULAR: exact answer = rotate r0 by ωΔt, ω = √(μ/r0³) ──
{
  const vc = Math.sqrt(mu / r0);
  const omega = Math.sqrt(mu / (r0 * r0 * r0));
  const rV = new THREE.Vector3(r0, 0, 0);
  const vV = new THREE.Vector3(0, vc, 0);          // prograde about +z, in xy-plane

  const dt = (Math.PI / 2) / omega;                // quarter period ⇒ θ = π/2
  const rN = new THREE.Vector3(), vN = new THREE.Vector3();
  assert.ok(propagateUniversal(mu, rV, vV, dt, rN, vN), 'circular: converges');

  const th = omega * dt;
  const rExact = new THREE.Vector3(r0 * Math.cos(th), r0 * Math.sin(th), 0);
  const vExact = new THREE.Vector3(-vc * Math.sin(th), vc * Math.cos(th), 0);
  assert.ok(relVecErr(rN, rExact) <= 1e-9, `circular: |r−exact|/r0 = ${relVecErr(rN, rExact)} > 1e-9`);
  assert.ok(relVecErr(vN, vExact) <= 1e-9, `circular: |v−exact|/vc = ${relVecErr(vN, vExact)} > 1e-9`);
}

// ── (b) ECCENTRIC e=0.3: fine RK4 reference toward a single origin body ──
{
  const e = 0.3;
  const a = r0 / (1 - e);
  const vPeri = Math.sqrt(mu * (1 + e) / r0);
  const T = 2 * Math.PI * Math.sqrt(a * a * a / mu);
  const dt = T / 4;                                 // quarter period

  // Analytic result.
  const rV = new THREE.Vector3(r0, 0, 0);
  const vV = new THREE.Vector3(0, vPeri, 0);
  const rA = new THREE.Vector3(), vA = new THREE.Vector3();
  assert.ok(propagateUniversal(mu, rV, vV, dt, rA, vA), 'eccentric: analytic step converges');

  // Inline RK4 reference (NO dependency on cabotage/propagator code): a single body
  // of parameter μ fixed at the origin; acceleration via the shipped gravityAccel.
  const body = { name: 'C', GM: mu, radius: 1 };
  const bodies = [body];
  const positions = new Map([['C', new THREE.Vector3(0, 0, 0)]]);
  const accel = (rVec) => gravityAccel(rVec, bodies, positions, new THREE.Vector3());

  let r = new THREE.Vector3(r0, 0, 0);
  let v = new THREE.Vector3(0, vPeri, 0);
  const n = Math.round(dt / 0.5);                   // dt ≤ 0.5 s per RK4 step
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const k1r = v.clone();
    const k1v = accel(r);
    const k2r = v.clone().addScaledVector(k1v, h / 2);
    const k2v = accel(r.clone().addScaledVector(k1r, h / 2));
    const k3r = v.clone().addScaledVector(k2v, h / 2);
    const k3v = accel(r.clone().addScaledVector(k2r, h / 2));
    const k4r = v.clone().addScaledVector(k3v, h);
    const k4v = accel(r.clone().addScaledVector(k3r, h));
    r.addScaledVector(k1r, h / 6).addScaledVector(k2r, h / 3)
     .addScaledVector(k3r, h / 3).addScaledVector(k4r, h / 6);
    v.addScaledVector(k1v, h / 6).addScaledVector(k2v, h / 3)
     .addScaledVector(k3v, h / 3).addScaledVector(k4v, h / 6);
  }

  assert.ok(relVecErr(rA, r) <= 1e-4, `eccentric: |r_analytic − r_RK4|/r0 = ${relVecErr(rA, r)} > 1e-4`);
}

console.log('propagator.vs.numeric.test.mjs OK');
