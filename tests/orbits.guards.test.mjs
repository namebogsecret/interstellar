// Guard contract (ТЗ, wave A) for orbits.js: circularizeVelocity + orbitFromState
// must stay finite at degenerate inputs (r≈0, e==1 exact parabola) without
// changing already-correct behavior on well-posed states. Written from the
// contract, NOT from the current implementation — several blocks below are
// EXPECTED to fail red against today's code (js/physics/orbits.js:130,151).
import * as THREE from 'three';
import { circularizeVelocity, orbitFromState } from '../js/physics/orbits.js';
import { approxAbs, approxRel } from './helpers.mjs';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;   // Earth GM
const r = 7.0e6;             // reference orbit radius (m)
const vCirc = Math.sqrt(mu / r);

function assertFiniteVec(v, msg) {
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
    `${msg}: expected finite vector, got (${v.x}, ${v.y}, ${v.z})`);
}

// ═════════════════════════════════════════════════════════════════════════
// A1 — circularizeVelocity: degenerate-radius guard
// ═════════════════════════════════════════════════════════════════════════

// ── r exactly (0,0,0): no-op, must return a COPY of vVec, no NaN/Infinity ──
{
  const rVec = new THREE.Vector3(0, 0, 0);
  const vVec = new THREE.Vector3(500, -300, 200);
  const relV = circularizeVelocity(mu, rVec, vVec, new THREE.Vector3());

  assertFiniteVec(relV, 'circularize(r=0 exact): result must be finite');
  assert.equal(relV.x, vVec.x, 'circularize(r=0 exact): no-op, x unchanged');
  assert.equal(relV.y, vVec.y, 'circularize(r=0 exact): no-op, y unchanged');
  assert.equal(relV.z, vVec.z, 'circularize(r=0 exact): no-op, z unchanged');
}

// ── r ≈ 0 (tiny but nonzero, all components ~1e-15): same no-op contract ──
{
  const rVec = new THREE.Vector3(1e-15, -1e-15, 2e-15);
  const vVec = new THREE.Vector3(500, -300, 200);
  const relV = circularizeVelocity(mu, rVec, vVec, new THREE.Vector3());

  assertFiniteVec(relV, 'circularize(r≈0): result must be finite');
  approxAbs(relV.x, vVec.x, 1e-6, 'circularize(r≈0): no-op, x unchanged');
  approxAbs(relV.y, vVec.y, 1e-6, 'circularize(r≈0): no-op, y unchanged');
  approxAbs(relV.z, vVec.z, 1e-6, 'circularize(r≈0): no-op, z unchanged');
}

// ── r microscopic but not the degenerate case (1e-9, 0, 0): only finiteness
//    is contracted, NOT the magnitude (circularizing at r=1e-9 legitimately
//    gives a huge but finite speed). Do not over-assert here. ──────────────
{
  const rVec = new THREE.Vector3(1e-9, 0, 0);
  const vVec = new THREE.Vector3(500, -300, 200);
  const relV = circularizeVelocity(mu, rVec, vVec, new THREE.Vector3());
  assertFiniteVec(relV, 'circularize(r=1e-9): result must be finite');
}

// ── regression (must already be GREEN): normal circular case ───────────────
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, 8000, 1000);          // prograde + radial component
  const relV = circularizeVelocity(mu, rVec, vVec, new THREE.Vector3());

  approxRel(relV.length(), vCirc, 1e-12, 'circularize(normal): |v| = √(μ/r)');
  approxAbs(relV.dot(rVec) / (r * relV.length()), 0, 1e-9, 'circularize(normal): v ⟂ r');
}

// ── regression (must already be GREEN): radial-only degenerate (h≈0, r≠0) ──
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(1000, 0, 0);             // purely radial → no plane
  const relV = circularizeVelocity(mu, rVec, vVec, new THREE.Vector3());
  assertFiniteVec(relV, 'circularize(radial, r≠0): result must be finite');
  approxRel(relV.length(), vCirc, 1e-9, 'circularize(radial, r≠0): |v| = √(μ/r)');
  approxAbs(relV.dot(rVec) / (r * relV.length()), 0, 1e-9, 'circularize(radial, r≠0): v ⟂ r');
}

// ═════════════════════════════════════════════════════════════════════════
// A2 — orbitFromState: rPeri finite & non-negative at ANY state, including
// exact parabola (e==1); rApo strictly Infinity for e>=1.
// ═════════════════════════════════════════════════════════════════════════

// ── exact parabola AT perigee: v = escape speed, ⟂ r ────────────────────────
{
  const vEsc = Math.sqrt(2 * mu / r);
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vEsc, 0);
  const { e, rPeri, rApo } = orbitFromState(mu, rVec, vVec);

  approxAbs(e, 1, 1e-9, 'parabola(perigee): e ≈ 1');
  assert.ok(Number.isFinite(rPeri), `parabola(perigee): rPeri must be finite, got ${rPeri}`);
  assert.ok(rPeri >= 0, `parabola(perigee): rPeri must be non-negative, got ${rPeri}`);
  // p = h²/μ = 2r for this state (h = r·vEsc since ⟂), so rPeri = p/2 = r.
  approxRel(rPeri, r, 1e-9, 'parabola(perigee): rPeri = p/2 = r (ship is AT perigee)');
  assert.equal(rApo, Infinity, 'parabola(perigee): rApo strictly Infinity');
}

// ── exact parabola NOT at perigee: same energy, v at 45° to r ──────────────
{
  const vEsc = Math.sqrt(2 * mu / r);
  const theta = Math.PI / 4;
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(vEsc * Math.cos(theta), vEsc * Math.sin(theta), 0);
  const h = new THREE.Vector3().crossVectors(rVec, vVec).length();
  const rPeriWant = (h * h) / (2 * mu);        // p/2, p = h²/μ

  const { e, rPeri, rApo } = orbitFromState(mu, rVec, vVec);

  approxAbs(e, 1, 1e-9, 'parabola(45°): e ≈ 1');
  assert.ok(Number.isFinite(rPeri), `parabola(45°): rPeri must be finite, got ${rPeri}`);
  assert.ok(rPeri >= 0, `parabola(45°): rPeri must be non-negative, got ${rPeri}`);
  approxRel(rPeri, rPeriWant, 1e-9, 'parabola(45°): rPeri = h²/(2μ)');
  assert.equal(rApo, Infinity, 'parabola(45°): rApo strictly Infinity');
}

// ── regression (must already be GREEN): circular ────────────────────────────
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vCirc, 0);
  const { e, rPeri, rApo } = orbitFromState(mu, rVec, vVec);
  approxAbs(e, 0, 1e-12, 'circular: e ≈ 0');
  approxRel(rPeri, r, 1e-9, 'circular: rPeri ≈ r');
  approxRel(rApo, r, 1e-9, 'circular: rApo ≈ r');
}

// ── regression (must already be GREEN): ellipse e≈0.5, rPeri/rApo vs a(1∓e) ─
{
  const aWant = 1.4e7, eWant = 0.5;               // rPeri = aWant*(1-eWant) = r
  const vPeri = Math.sqrt(mu * (2 / r - 1 / aWant));   // vis-viva at perigee
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vPeri, 0);
  const { a, e, rPeri, rApo } = orbitFromState(mu, rVec, vVec);

  approxRel(a, aWant, 1e-9, 'ellipse(e=0.5): a');
  approxRel(e, eWant, 1e-9, 'ellipse(e=0.5): e');
  approxRel(rPeri, aWant * (1 - eWant), 1e-12, 'ellipse(e=0.5): rPeri = a(1-e)');
  approxRel(rApo, aWant * (1 + eWant), 1e-12, 'ellipse(e=0.5): rApo = a(1+e)');
}

// ── regression (must already be GREEN): hyperbola ───────────────────────────
{
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, 15000, 0);     // > escape √(2μ/r) ≈ 10672
  const { e, rPeri, rApo } = orbitFromState(mu, rVec, vVec);
  assert.ok(e > 1, `hyperbolic: e must be > 1, got ${e}`);
  assert.ok(Number.isFinite(rPeri) && rPeri > 0, `hyperbolic: rPeri finite & > 0, got ${rPeri}`);
  assert.equal(rApo, Infinity, 'hyperbolic: rApo strictly Infinity');
}

console.log('orbits.guards.test.mjs OK');
