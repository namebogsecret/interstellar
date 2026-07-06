// ─────────────────────────────────────────────────────────────────────────────
// INV-PHYS-11 — THROTTLE CALIBRATION (mode-aware log-ladder, honest clamp).
// Contract (ТЗ MAJOR #2): digit n∈1..9 must map to a FELT acceleration on the
// 1g..1000g ladder in BOTH modes — targetAccel(n) = 1000^((n-1)/8)·G0 — capped at
// the mode's real ceiling maxThrustAccel. The bug calibrates only for arcade;
// realistic '1' lands at ~0.003g and the '9'→1000g help text is a lie.
//
// Requires the NEW frozen symbols (do NOT exist on the un-fixed tree, so this file
// is RED at link time — "does not provide an export named 'powerToThrottle'"):
//   • powerToThrottle(n, ship)  EXPORTED from controls.js  (mode-aware)
//   • ship.maxThrustAccel        getter on Ship
// Written from the ТЗ contract, NOT the implementation.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { powerToThrottle } from '../js/render/controls.js';
import { Ship, MODES } from '../js/physics/ship.js';
import { C, G0 } from '../js/physics/constants.js';
import { approxRel, approxAbs } from './helpers.mjs';
import assert from 'node:assert/strict';

// Reference: the OLD arcade throttle formula, inline & frozen, so arcade is
// provably unchanged bit-for-bit.  powerToThrottle_old(n) = 1000^((n-1)/8)/1000.
function powerToThrottle_old(n) {
  return Math.pow(1000, (n - 1) / 8) / 1000;
}

// ── REALISTIC '1' ≈ 1g ───────────────────────────────────────────────────────
{
  const ship = new Ship();
  ship.mode = MODES[1];                     // 'realistic', full fuel (mass = 1e6 kg)
  assert.equal(ship.mass, ship.dryMass + ship.fuelMass, 'realistic mass includes fuel');
  const thr1 = powerToThrottle(1, ship);
  const felt1 = ship.thrustForce * thr1 / ship.mass;   // felt = F·throttle/m
  approxRel(felt1, G0, 0.02, 'realistic 1 → 1g felt acceleration');
}

// ── REALISTIC '9' → honest clamp at the ship's thrust ceiling (NOT 1000g) ─────
{
  const ship = new Ship();
  ship.mode = MODES[1];
  const thr9 = powerToThrottle(9, ship);
  approxAbs(thr9, 1, 1e-9, 'realistic 9 → throttle clamps to 1');
  const felt9 = ship.thrustForce / ship.mass;          // = full-throttle ceiling
  approxRel(felt9, ship.maxThrustAccel, 1e-9, 'ceiling = maxThrustAccel getter');
  assert.ok(felt9 < 100 * G0,
    `realistic ceiling must be the honest thrust limit, NOT 1000g; got ${felt9 / G0} g`);
}

// ── ARCADE unchanged bit-for-bit (regression) ────────────────────────────────
{
  const ship = new Ship();
  ship.mode = MODES[0];                     // 'arcade'
  for (let n = 1; n <= 9; n++) {
    approxRel(powerToThrottle(n, ship), powerToThrottle_old(n), 1e-12,
      `arcade throttle bit-identical to old formula (n=${n})`);
  }
}

// ── ARCADE '1' ≈ 1g and '9' ≈ 1000g (felt = maxAccelArcade·throttle) ──────────
{
  const ship = new Ship();
  ship.mode = MODES[0];
  const felt1 = ship.maxAccelArcade * powerToThrottle(1, ship);
  const felt9 = ship.maxAccelArcade * powerToThrottle(9, ship);
  approxRel(felt1, G0, 1e-9, 'arcade 1 → 1g');
  approxRel(felt9, 1000 * G0, 1e-9, 'arcade 9 → 1000g');
}

// ── (optional) END-TO-END: realistic ship, '1', thrust ∥ v, one step, no gravity
//    → the g-meter (lastAccel) reads ≈ 1g. ─────────────────────────────────────
{
  const ship = new Ship();
  ship.mode = MODES[1];
  ship.throttle = powerToThrottle(1, ship);
  ship.step(1e-3, [], new Map(), new THREE.Vector3(0, 0, -1)); // thrust dir, no field
  approxRel(ship.lastAccel.length(), G0, 0.02, 'realistic 1 end-to-end: g-meter ≈ 1g');
}

console.log('controls.throttle.test.mjs OK');
