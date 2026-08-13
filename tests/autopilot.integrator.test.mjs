// Autopilot · over the REAL integrator (ТЗ волна B · B1 §7.4 «т»).
//
// Everything else in this suite drives the autopilot through the bench's own
// Verlet loop. This file drives it through js/physics/ship.js — the explicit
// Euler + relativistic 4-force decomposition the game actually uses — via
// buildObs(), the impure adapter that also lives under the node gate.
// Tolerances are deliberately looser than §7.1: this tests that the guidance law
// survives a REAL integrator, not the accuracy of that integrator.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { approxRel } from './helpers.mjs';
import { Ship } from '../js/physics/ship.js';
import { orbitFromState, safeRadius, absolutePosition, bodyVelocity } from '../js/physics/orbits.js';
import { byName as BODY } from '../js/data/bodies.js';
import { PHASES, A_MAX_TZ, conicState, isFiniteVec, angleBetween } from './autopilot.harness.mjs';
import { buildObs, autopilotStep, engageAutopilot } from '../js/physics/autopilot.js';

// Single-body universe. `parent: null` matters: orbitalPosition() short-circuits
// to (0,0,0) for a parentless body, so the body is genuinely at rest at the origin
// and positions.get() / absolutePosition() / bodyVelocity() all agree. A body that
// still orbited the Sun would give buildObs a 29.8 km/s reference velocity that the
// fixture does not have.
const EARTH = Object.assign({}, BODY('Earth'), { parent: null });
const bodies = [EARTH];
const positions = new Map([['Earth', new THREE.Vector3(0, 0, 0)]]);
const byName = (n) => bodies.find((b) => b.name === n);
const refVel = new THREE.Vector3(0, 0, 0);
const ZERO = new THREE.Vector3(0, 0, 0);

const mu = EARTH.GM;
const R_PERI = 8.0e6;
const st = conicState(mu, 0.3, R_PERI, 0);

// fixture self-checks
assert.ok(R_PERI > safeRadius(EARTH), 'fixture: start above safeRadius');
assert.ok(R_PERI - EARTH.radius > (EARTH.atmosphere ? EARTH.atmosphere.height : 0),
  'fixture: start above the modelled atmosphere, so ship.step applies no drag');
{
  const el0 = orbitFromState(mu, st.r, st.v);
  approxRel(el0.e, 0.3, 1e-9, 'fixture: initial eccentricity');
}

const ship = new Ship();
ship.mode = 'arcade';
ship.pos.copy(st.r);
ship.v.copy(st.v);
ship.w.copy(st.v);            // gamma ~= 1 at 8 km/s; ship.step re-derives v from w
ship.throttle = 0;

const DT = 0.02;              // realDt is clamped to 0.05 and warp pins to 1 while burning
const MAX_STEPS = 100000;
const dir = new THREE.Vector3();

let obs = buildObs(ship, bodies, positions, byName, 0, 0, 1 / 60);
// buildObs must hand the autopilot the BODY-RELATIVE state, which here equals the
// heliocentric one (the body is at rest at the origin).
approxRel(obs.mu, mu, 1e-15, '(т) buildObs must report the reference body GM');
approxRel(obs.rVec.length(), R_PERI, 1e-9, '(т) buildObs radius vs fixture');
approxRel(obs.vVec.length(), st.v.length(), 1e-9, '(т) buildObs relative speed vs fixture');
approxRel(obs.safeRadius, safeRadius(EARTH), 1e-15, '(т) buildObs must use orbits.js::safeRadius');
assert.equal(obs.landed, false, '(т) fixture must not start landed');

// ── buildObs adapter contract: the observation is BODY-RELATIVE (§2.2) ────────
// Same check on a MOVING body — the single-body loop below cannot see a missing
// "− bodyVelocity", because its Earth is parked at the origin.
{
  const earthMoving = BODY('Earth');            // the real one: parent 'Sun', 29.8 km/s
  const sun = BODY('Sun');
  const bs = [sun, earthMoving];
  const bn = (n) => bs.find((b) => b.name === n);
  const T = 12345.0;
  const ePos = absolutePosition(earthMoving, T, bn, new THREE.Vector3());
  const eVel = bodyVelocity(earthMoving, T, bn, new THREE.Vector3());
  assert.ok(eVel.length() > 2e4, 'fixture: the reference body must really be moving');

  const pos2 = new Map([['Sun', new THREE.Vector3(0, 0, 0)], ['Earth', ePos]]);
  const probe = new Ship();
  probe.mode = 'arcade';
  probe.pos.addVectors(ePos, st.r);
  probe.v.addVectors(eVel, st.v);
  probe.w.copy(probe.v);

  const o = buildObs(probe, bs, pos2, bn, T, 0, 1 / 60);
  assert.equal(o.refBodyName, 'Earth',
    `(т) buildObs must pick the dominant body, got '${o.refBodyName}'`);
  approxRel(o.rVec.length(), st.r.length(), 1e-6,
    '(т) buildObs.rVec must be ship.pos − bodyPos');
  approxRel(o.vVec.length(), st.v.length(), 1e-4,
    '(т) buildObs.vVec must be ship.v − bodyVel (heliocentric leak is 29.8 km/s)');
  assert.ok(o.beta < 1e-3,
    `(т) β must come from the RELATIVE speed, got ${o.beta}`);
}

let state = engageAutopilot({ kind: 'circularize', bodyName: 'Earth' }, obs);
assert.notEqual(state.phase, PHASES.REFUSED,
  `(т) engage must accept this state, got REFUSED(${state.reason})`);

let steps = 0, lastDt = 0, peakAccel = 0, simTime = 0;
const h0 = new THREE.Vector3().crossVectors(ship.pos, ship.v);

for (;;) {
  obs = buildObs(ship, bodies, positions, byName, simTime, 0, 1 / 60);
  const cmd = autopilotStep(state, obs, lastDt, dir);
  state = cmd.state;
  peakAccel = Math.max(peakAccel, cmd.throttle * ship.maxThrustAccel);
  if (cmd.done) break;

  ship.throttle = cmd.throttle;
  ship.step(DT, bodies, positions, cmd.thrustDir ?? ZERO, refVel, EARTH);
  simTime += DT;
  lastDt = DT;
  if (++steps >= MAX_STEPS) break;
}

assert.ok(steps < MAX_STEPS, `(т) did not terminate within ${MAX_STEPS} steps`);
assert.equal(state.phase, PHASES.DONE,
  `(т) expected DONE over ship.step, got ${state.phase} (reason=${state.reason})`);

// ── the orbit, read back the same way the HUD reads it ────────────────────────
const el = orbitFromState(mu, ship.pos, ship.v);
assert.equal(el.bound, true, `(т) resulting orbit must be bound (a=${el.a}, e=${el.e})`);
assert.ok(el.e <= 2e-3, `(т) eccentricity ${el.e} > 2e-3 over the real integrator`);
{
  const r = ship.pos.length();
  approxRel(el.a, r, 5e-3, '(т) circular orbit: a must equal |r|');
  assert.ok(r >= 7.5e6 && r <= 9.0e6, `(т) final radius ${r} ran away`);
}
assert.ok(peakAccel <= A_MAX_TZ * (1 + 1e-9),
  `(т) peak commanded accel ${peakAccel} exceeded A_MAX — the arcade 1000 g was used`);

// ── ГРАБЛИ #5 regression: nothing non-finite may reach simulation state ────────
assert.ok(isFiniteVec(ship.pos), '(т) ship.pos must stay finite');
assert.ok(isFiniteVec(ship.v), '(т) ship.v must stay finite');
assert.ok(isFiniteVec(ship.w), '(т) ship.w must stay finite');
assert.ok(Number.isFinite(ship.v.length()), '(т) |ship.v| must stay finite');
assert.equal(ship.landed, false, '(т) the autopilot must not fly the ship into the ground');
assert.equal(ship.crashed, false, '(т) the autopilot must not crash the ship');

// plane preserved through the relativistic decomposition too (INV-PHYS-03)
{
  const hF = new THREE.Vector3().crossVectors(ship.pos, ship.v);
  const dPlane = angleBetween(h0, hF);
  assert.ok(dPlane <= 1e-6, `(т) orbital plane rotated by ${dPlane} rad over ship.step`);
}

// after a terminal command the core stops asking for thrust — main.js is then
// free to zero ship.throttle (§3.4); the core must never leave a live command behind
assert.equal(state.phase, PHASES.DONE, '(т) terminal phase must be stable');

console.log('autopilot.integrator OK');
