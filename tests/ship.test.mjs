// Ship contract (ship.js) — fuel·dτ, transverse 4-force, drag-vs-rest-frame.
// Written from the ТЗ, not the impl.
import * as THREE from 'three';
import { Ship, MODES } from '../js/physics/ship.js';
import { gammaFromW, velocityFromW, momentumFromV } from '../js/physics/relativity.js';
import { surfaceRotationVelocity, spinAxis } from '../js/physics/orbits.js';
import { C, G0 } from '../js/physics/constants.js';
import { BODIES } from '../js/data/bodies.js';
import { approxAbs, approxRel } from './helpers.mjs';
import assert from 'node:assert/strict';

// helper: build a Ship at a given proper-momentum along +x.
function shipWithW(wx) {
  const s = new Ship();
  s.w.set(wx, 0, 0);
  velocityFromW(s.w, s.v);
  return s;
}

// γ=13 proper momentum: γ=√(1+(w/c)²)=13 ⇒ (w/c)²=168.
const W13 = C * Math.sqrt(168);

// ── TEST: fuel burns per PROPER time — Δmass(γ=13) ≈ Δmass(γ=1)/13 ──────────
{
  const dt = 1.0;
  const thrust = new THREE.Vector3(1, 0, 0);
  const bodies = [];                          // no gravity
  const positions = new Map();                // no atmosphere/drag

  const rest = new Ship();
  rest.mode = MODES[1];                        // 'realistic' (finite fuel)
  rest.throttle = 1;
  assert.equal(gammaFromW(rest.w), 1, 'rest ship γ must be 1');
  const restM0 = rest.fuelMass;
  rest.step(dt, bodies, positions, thrust);
  const dMassRest = restM0 - rest.fuelMass;
  assert.ok(dMassRest > 0, 'rest ship must burn fuel');

  const fast = shipWithW(W13);
  fast.mode = MODES[1];
  fast.throttle = 1;
  approxRel(gammaFromW(fast.w), 13, 1e-9, 'fast ship γ via gammaFromW');
  approxRel(fast.v.length() / C, 0.99705, 1e-3, 'fast ship β');
  const fastM0 = fast.fuelMass;
  fast.step(dt, bodies, positions, thrust);
  const dMassFast = fastM0 - fast.fuelMass;
  assert.ok(dMassFast > 0, 'fast ship must burn fuel');

  approxRel(dMassFast, dMassRest / 13, 0.08, 'fuel·dτ: Δmass(γ=13) ≈ Δmass(γ=1)/13');
}

// ── TEST: transverse 4-force — |Δw_perp| ≈ a·dt/γ ; |Δw_par| ≈ a·dt ──────────
{
  const dt = 1e-3;
  const a = 1000 * G0;                          // arcade maxAccel at full throttle
  const g = 13;

  const par = shipWithW(W13);
  par.mode = MODES[0];                          // 'arcade'
  par.throttle = 1;
  const wPar0 = par.w.clone();
  par.step(dt, [], new Map(), new THREE.Vector3(1, 0, 0)); // ∥ v
  const dwPar = par.w.clone().sub(wPar0).length();

  const perp = shipWithW(W13);
  perp.mode = MODES[0];
  perp.throttle = 1;
  const wPerp0 = perp.w.clone();
  perp.step(dt, [], new Map(), new THREE.Vector3(0, 1, 0)); // ⟂ v
  const dwPerp = perp.w.clone().sub(wPerp0).length();

  approxRel(dwPar, a * dt, 0.10, 'longitudinal felt: |Δw_par| ≈ a·dt');
  approxRel(dwPerp, (a * dt) / g, 0.10, 'transverse felt: |Δw_perp| ≈ a·dt/γ');
  approxRel(dwPerp / dwPar, 1 / g, 0.10, '4-force: transverse/longitudinal ratio ≈ 1/γ');
}

// ── TEST: drag ≈ 0 at rest relative to the co-rotating surface ───────────────
{
  const Earth = BODIES.find((b) => b.name === 'Earth');
  assert.ok(Earth && Earth.atmosphere, 'Earth must exist and have an atmosphere');
  const earthPos = new THREE.Vector3(0, 0, 0);
  const positions = new Map([[Earth.name, earthPos]]);

  // Equator point: earthCenter + radius · (unit ⟂ spin axis).
  const axis = spinAxis(Earth, new THREE.Vector3());
  const perpUnit = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0)).normalize();
  const equatorPoint = earthPos.clone().addScaledVector(perpUnit, Earth.radius);

  // Equatorial surface speed ≈ 465 m/s.
  const surfV = surfaceRotationVelocity(Earth, equatorPoint, earthPos, new THREE.Vector3());
  approxRel(surfV.length(), 465, 0.12, 'equatorial surface rotation speed ≈ 465 m/s');

  const bodyVel = new THREE.Vector3(30000, 0, 0);   // stand-in orbital velocity of Earth

  // (rest) ship co-moving with the co-rotating atmosphere ⇒ vRel = 0 ⇒ drag ≈ 0.
  const rest = new Ship();
  rest.pos.copy(equatorPoint);
  rest.throttle = 0;                                // thrust OFF
  rest.v.copy(bodyVel).add(surfV);
  momentumFromV(rest.v, rest.w);
  rest.step(1.0, [Earth], positions, new THREE.Vector3(1, 0, 0), bodyVel);
  approxAbs(rest.lastAccel.length(), 0, 0.05, 'rest-relative-surface: felt accel (drag) ≈ 0');

  // (wind) +1000 m/s relative to the atmosphere ⇒ real drag, felt accel large.
  const wind = new Ship();
  wind.pos.copy(equatorPoint);
  wind.throttle = 0;
  wind.v.copy(bodyVel).add(surfV).add(new THREE.Vector3(0, 0, 1000));
  momentumFromV(wind.v, wind.w);
  wind.step(1.0, [Earth], positions, new THREE.Vector3(1, 0, 0), bodyVel);
  assert.ok(wind.lastAccel.length() > 1.0,
    `wind case must show clear drag (>1 m/s²), got ${wind.lastAccel.length()}`);
  assert.ok(wind.lastAccel.length() > rest.lastAccel.length() * 100,
    'wind drag must dwarf the rest-frame case');
}

console.log('ship.test.mjs OK');
