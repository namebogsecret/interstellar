// Orbital-mechanics contract (orbits.js): circularizeVelocity + orbitFromState.
import * as THREE from 'three';
import { circularizeVelocity, orbitFromState } from '../js/physics/orbits.js';
import { approxAbs, approxRel } from './helpers.mjs';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;   // Earth GM
const r = 7.0e6;             // orbit radius (m)
const vCirc = Math.sqrt(mu / r);

// ── circularizeVelocity ─────────────────────────────────────────────────────
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, 8000, 1000);          // prograde + radial component
  const relV = circularizeVelocity(mu, rVec, vVec, new THREE.Vector3());

  approxRel(relV.length(), vCirc, 1e-9, 'circularize: |v| = √(μ/r)');
  approxAbs(relV.dot(rVec) / (r * relV.length()), 0, 1e-9, 'circularize: v ⟂ r');

  // prograde sense preserved: (r×relV)·(r×vVec) > 0
  const hOut = new THREE.Vector3().crossVectors(rVec, relV);
  const hIn = new THREE.Vector3().crossVectors(rVec, vVec);
  assert.ok(hOut.dot(hIn) > 0, 'circularize: prograde sense preserved');
}

// ── circularizeVelocity — radial-only degenerate state ──────────────────────
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(1000, 0, 0);             // purely radial → no plane
  const relV = circularizeVelocity(mu, rVec, vVec, new THREE.Vector3());
  approxRel(relV.length(), vCirc, 1e-9, 'circularize(radial): |v| = √(μ/r)');
  approxAbs(relV.dot(rVec) / (r * relV.length()), 0, 1e-9, 'circularize(radial): v ⟂ r');
}

// ── orbitFromState — circular ───────────────────────────────────────────────
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vCirc, 0);           // ⟂ r, exact circular speed
  const { a, e, rPeri, rApo } = orbitFromState(mu, rVec, vVec);
  approxAbs(e, 0, 1e-3, 'circular: e ≈ 0');
  approxRel(a, r, 1e-3, 'circular: a ≈ r');
  approxRel(rPeri, r, 1e-3, 'circular: rPeri ≈ r');
  approxRel(rApo, r, 1e-3, 'circular: rApo ≈ r');
}

// ── orbitFromState — chosen ellipse (perigee state) ─────────────────────────
{
  // Pick rPeri = r, a = 1e7 ⇒ e = 1 − rPeri/a = 0.3.
  const aWant = 1e7, eWant = 0.3;
  const vPeri = Math.sqrt(mu * (2 / r - 1 / aWant));      // vis-viva at perigee
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vPeri, 0);            // ⟂ r at perigee
  const { a, e, rPeri, rApo } = orbitFromState(mu, rVec, vVec);
  approxRel(a, aWant, 1e-3, 'ellipse: a');
  approxRel(e, eWant, 1e-3, 'ellipse: e');
  approxRel(rPeri, aWant * (1 - eWant), 1e-3, 'ellipse: rPeri');
  approxRel(rApo, aWant * (1 + eWant), 1e-3, 'ellipse: rApo');
}

// ── orbitFromState — hyperbolic (v > escape) ────────────────────────────────
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, 15000, 0);           // > escape √(2μ/r) ≈ 10672
  const { e, rApo } = orbitFromState(mu, rVec, vVec);
  assert.ok(e > 1, `hyperbolic: e must be > 1, got ${e}`);
  assert.equal(rApo, Infinity, 'hyperbolic: rApo = Infinity (unbound)');
}

console.log('orbits.test.mjs OK');
