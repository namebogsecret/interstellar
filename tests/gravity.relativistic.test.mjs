// ─────────────────────────────────────────────────────────────────────────────
// INV-PHYS-10 — RELATIVISTIC GRAVITY (weak-field geodesic 3-acceleration).
// Contract (ТЗ MAJOR #1): the coordinate 3-acceleration of a FAST test particle
// in a weak static field is
//     a = (1+β²)·g_perp  +  (1−3β²)·g_par        (g ≡ −∇Φ)
// NOT the current bug, where gravity is added to w=γv UNDIVIDED, which suppresses
// the transverse coordinate acceleration by 1/γ (at β=0.99 → ×0.141 instead of
// ×1.98). Written from the ТЗ contract, NOT the implementation.
//
// This test is RED on the un-fixed tree: the transverse ratio (a) asserts the
// observed a_perp/g ≈ 1+β² and hard-guards ratio > 1.5, while the bug yields
// ratio ≈ 1/γ ≈ 0.141.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Ship, MODES } from '../js/physics/ship.js';
import { gammaFromW, velocityFromW, momentumFromV } from '../js/physics/relativity.js';
import { C, G0 } from '../js/physics/constants.js';
import { approxRel } from './helpers.mjs';
import assert from 'node:assert/strict';

// A bare attractor with NO atmosphere → the drag path is inert; only gravity acts.
// Earth's GM/radius so the magnitude is realistic; distance keeps us well outside.
const ATTRACTOR = { name: 'Attractor', GM: 3.986004418e14, radius: 6.371e6 };
const D = 1.0e8;                       // body distance from ship (m), r ≫ radius
const G_NEWTON = ATTRACTOR.GM / (D * D); // Newtonian |g| at the ship

// Run a single throttle-off step for a ship at speed β·c along +x, with the body
// placed at `bodyOffset` (so gravityAccel points along that offset). Returns the
// ship's coordinate-velocity delta components and the Newtonian g magnitude.
function stepUnderGravity(beta, bodyOffset, dt) {
  const s = new Ship();
  const v = new THREE.Vector3(beta * C, 0, 0);
  s.v.copy(v);
  momentumFromV(v, s.w);              // exact w = γv for the requested β
  s.throttle = 0;                     // NO thrust — pure gravity + kinematics
  const bodyPos = bodyOffset.clone().multiplyScalar(D); // unit offset → D metres
  const positions = new Map([[ATTRACTOR.name, bodyPos]]);
  const vx0 = s.v.x;
  const vy0 = s.v.y;
  // thrustDir is ignored (throttle 0); refBodyVel omitted → drag path fully off.
  s.step(dt, [ATTRACTOR], positions, new THREE.Vector3(1, 0, 0));
  return { dvPar: s.v.x - vx0, dvPerp: s.v.y - vy0, g: G_NEWTON };
}

// ── PROBE: with gravity = 0, the FELT longitudinal path is UNCHANGED (undivided).
//    A #1 fix that accidentally touches the felt decomposition trips this. Holds
//    on both the buggy and the fixed tree (gravity=0 ⇒ dwGrav ≡ 0). ───────────────
{
  const dt = 1e-3;
  const a = 1000 * G0;                 // arcade full-throttle proper accel
  const W13 = C * Math.sqrt(168);      // γ = 13
  const s = new Ship();
  s.w.set(W13, 0, 0);
  velocityFromW(s.w, s.v);
  s.mode = MODES[0];                   // 'arcade'
  s.throttle = 1;
  const w0 = s.w.clone();
  s.step(dt, [], new Map(), new THREE.Vector3(1, 0, 0)); // thrust ∥ v, no gravity
  const dw = s.w.clone().sub(w0).length();
  approxRel(dw, a * dt, 0.05,
    'felt-path intact: thrust ∥ v gives |Δw| ≈ a·dt undivided (gravity=0)');
}

// ── (b) LOW β = 1e-3: reduces to Newtonian, ratio ≈ 1 (holds on buggy AND fixed;
//    it is the Newtonian-limit correctness guard, not the bug discriminator). ─────
{
  const beta = 1e-3;
  const dt = 1e-3;
  const { dvPerp, g } = stepUnderGravity(beta, new THREE.Vector3(0, 1, 0), dt);
  const ratio = (dvPerp / dt) / g;
  approxRel(ratio, 1 + beta * beta, 1e-3, 'low-β transverse reduces to Newtonian g');
}

// ── (a) HIGH β = 0.99: transverse coordinate acceleration = (1+β²)·g ≈ 1.98·g.
//    RED on the bug (which gives ratio ≈ 1/γ ≈ 0.141). ────────────────────────────
{
  const beta = 0.99;
  const dt = 1e-3;
  const { dvPerp, g } = stepUnderGravity(beta, new THREE.Vector3(0, 1, 0), dt);
  const ratio = (dvPerp / dt) / g;
  const expected = 1 + beta * beta;    // 1.9801
  // Hard anti-regression guard FIRST: the 1/γ bug (≈0.141) fails here loudly.
  assert.ok(ratio > 1.5,
    `transverse gravity must NOT be 1/γ-suppressed (bug gives ~0.141); got ratio=${ratio}`);
  approxRel(ratio, expected, 0.03, '(1+β²) transverse coordinate acceleration');
}

// ── (c) LONGITUDINAL (1−3β²) — RECOMMENDED / non-fatal (Vladimir escalation:
//    strict geodesic (1−3β²) vs conservative Newtonian 1). Never throws; reports
//    only, so the required gate above is not made brittle by the design choice. ───
try {
  const beta = 0.5;
  const dt = 1e-3;
  const { dvPar, g } = stepUnderGravity(beta, new THREE.Vector3(1, 0, 0), dt);
  const ratio = (dvPar / dt) / g;
  const strict = 1 - 3 * beta * beta;  // 0.25 (sign-flip for β>1/√3 is correct)
  if (Math.abs(ratio - strict) / Math.abs(strict) <= 0.03) {
    console.log(`  [recommended] longitudinal (1−3β²)=${strict} confirmed (ratio=${ratio.toFixed(4)})`);
  } else {
    console.log(`  [recommended] longitudinal ratio=${ratio.toFixed(4)} vs strict (1−3β²)=${strict} ` +
      `— non-fatal (conservative '1' may have been chosen; see ТЗ escalation)`);
  }
} catch (e) {
  console.log(`  [recommended] longitudinal check skipped: ${e.message}`);
}

console.log('gravity.relativistic.test.mjs OK');
