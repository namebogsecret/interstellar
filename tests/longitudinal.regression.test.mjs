// ─────────────────────────────────────────────────────────────────────────────
// LONGITUDINAL REGRESSION — NEVER DELETE, NEVER WEAKEN.
// Guards the 4-force change: with thrust PARALLEL to v the proper acceleration is
// undivided, so 1-D constant-proper-accel flight must reproduce the analytic
// relativistic rocket γ(t)=√(1+(αt/c)²). If a future refactor of the 4-force
// decomposition ever divides the longitudinal term by γ, this test goes red.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { gammaFromW, velocityFromW } from '../js/physics/relativity.js';
import { C, G0 } from '../js/physics/constants.js';
import { Ship, MODES } from '../js/physics/ship.js';
import { approxRel } from './helpers.mjs';

const alpha = 1000 * G0;                      // 1000 g proper acceleration
// t where analytic γ = √(1+(αt/c)²) = 13  ⇒  αt/c = √168.
const tTarget = (C * Math.sqrt(168)) / alpha;
const N = 2000;
const dt = tTarget / N;

// (a) Irreducible pure-integrator check using relativity.js only: w += α·dt.
{
  let w = 0;
  for (let i = 0; i < N; i++) w += alpha * dt;
  const g = gammaFromW(new THREE.Vector3(w, 0, 0));
  approxRel(g, 13, 0.02, 'pure integrator: γ at analytic-13 point');
  const v = velocityFromW(new THREE.Vector3(w, 0, 0), new THREE.Vector3());
  approxRel(v.length() / C, 0.997, 0.02, 'pure integrator: |v|/c');
}

// (b) Same drive through the REAL Ship in arcade mode, thrust ∥ v (1000 g), no
//     gravity/atmosphere. Must land on the identical γ — this is the actual
//     guard on the 4-force decomposition in ship.step.
{
  const ship = new Ship();
  ship.mode = MODES[0];                       // 'arcade' — infinite fuel, a = maxAccelArcade
  ship.throttle = 1;
  const thrust = new THREE.Vector3(1, 0, 0);  // parallel to +x motion
  const bodies = [];
  const positions = new Map();
  for (let i = 0; i < N; i++) ship.step(dt, bodies, positions, thrust);
  approxRel(gammaFromW(ship.w), 13, 0.02, 'ship arcade ∥-thrust: γ at analytic-13 point');
  approxRel(ship.v.length() / C, 0.997, 0.02, 'ship arcade ∥-thrust: |v|/c');
}

console.log('longitudinal.regression.test.mjs OK');
