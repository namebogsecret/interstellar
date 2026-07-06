// ─────────────────────────────────────────────────────────────────────────────
// INV-PHYS-12 — TOUCHDOWN IMPACT RELATIVE TO CO-ROTATING GROUND.
// Contract (ТЗ MAJOR #3): touchdown() must measure impact speed against the ACTUAL
// ground velocity — bodyVelocity + surfaceRotationVelocity (ω×r) — the same frame
// the landed-block already uses. The bug measures |v − bodyVelocity|, ignoring ω×r:
//   • a ship perfectly co-rotating with the equatorial surface → false CRASH (465 m/s);
//   • a ship matched to bodyVelocity only → false SOFT landing (impact 0).
//
// touchdown() lives in main.js (DOM/scene side-effects, not node-importable), so we
// test the underlying frozen helper groundVelocity(...) and the impact relation
// impact = |v − groundVelocity|.  Requires the NEW export (does NOT exist on the
// un-fixed tree, so this file is RED at link time — "does not provide an export
// named 'groundVelocity'").  Written from the ТЗ contract, NOT the implementation.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { groundVelocity, surfaceRotationVelocity, spinAxis } from '../js/physics/orbits.js';
import { BODIES } from '../js/data/bodies.js';
import { approxAbs, approxRel } from './helpers.mjs';
import assert from 'node:assert/strict';

const Earth = BODIES.find((b) => b.name === 'Earth');
assert.ok(Earth && Earth.rotPeriod, 'Earth must exist with a rotation period');

const earthPos = new THREE.Vector3(0, 0, 0);

// Equatorial point (same construction as ship.test.mjs): center + radius·(unit ⟂ spin axis).
const axis = spinAxis(Earth, new THREE.Vector3());
const perpUnit = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0)).normalize();
const eqPoint = earthPos.clone().addScaledVector(perpUnit, Earth.radius);

// Equatorial surface rotation velocity ω×r ≈ 465 m/s — the term the bug drops.
const surfV = surfaceRotationVelocity(Earth, eqPoint, earthPos, new THREE.Vector3());
approxRel(surfV.length(), 465, 0.12, 'equatorial surface rotation speed ≈ 465 m/s');

// Stand-in heliocentric orbital velocity of the body.
const bodyVel = new THREE.Vector3(30000, 0, 0);

// Actual ground velocity = bodyVel + ω×r (fresh out; must NOT mutate bodyVel).
const gvel = groundVelocity(Earth, eqPoint, earthPos, bodyVel, new THREE.Vector3());
assert.deepEqual([bodyVel.x, bodyVel.y, bodyVel.z], [30000, 0, 0],
  'groundVelocity must not mutate the bodyVel argument when given a fresh out');
approxAbs(gvel.clone().sub(bodyVel).sub(surfV).length(), 0, 1e-9,
  'groundVelocity = bodyVelocity + ω×r');

// ── A — soft equatorial landing: ship co-rotates with the surface → impact ≈ 0 ──
const shipV_A = bodyVel.clone().add(surfV);
const impactA = shipV_A.clone().sub(gvel).length();
approxAbs(impactA, 0, 1.0, 'co-rotating soft landing → impact ≈ 0 (≪ crash threshold 50)');

// ── B — matched to bodyVel only, over spinning surface → impact ≈ |ω×r| (true) ──
const shipV_B = bodyVel.clone();
const impactB = shipV_B.clone().sub(gvel).length();
approxAbs(impactB, surfV.length(), 1e-9, 'bodyVel-only → impact ≈ |ω×r| ≈ 465 m/s (true crash)');

// ── guard: the honest ordering — co-rotating impact ≪ bodyVel-only impact ──────
assert.ok(impactA < impactB,
  `co-rotating soft landing (${impactA}) must be far below bodyVel-only impact (${impactB})`);

console.log('touchdown.impact.test.mjs OK');
