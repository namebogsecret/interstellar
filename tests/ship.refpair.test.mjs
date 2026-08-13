// ─────────────────────────────────────────────────────────────────────────────
// INV — A3: atomicity of the (refBody, refBodyVel) pair fed to Ship.step().
//
// Contract (ТЗ, implemented by another agent): Ship.step() gains a 6th,
// OPTIONAL argument `refBody`:
//
//   ship.step(dt, bodies, positions, thrustDir, refBodyVel, refBody)
//
//   • refBody PASSED (not null/undefined): this.refBody MUST become exactly
//     that object, and BOTH the atmosphere/altitude lookup AND the
//     surfaceRotationVelocity() used for drag MUST be computed from THAT same
//     body — dominantBody() must NOT be consulted to pick the ref in this case.
//     The pair (refBody, refBodyVel) is then atomic by construction: whoever
//     chose refBodyVel (main.js, once per frame) also gets to choose refBody,
//     so the two can never disagree about which body's atmosphere is moving
//     at which velocity.
//   • refBody OMITTED: unchanged fallback — this.refBody = dominantBody(...),
//     exactly today's behaviour (backward compatible).
//
// On the CURRENT (un-fixed) ship.js, step() only declares 5 parameters and
// unconditionally recomputes `this.refBody = dominantBody(...)` — a 6th
// argument is silently ignored by JS call semantics. So passing an explicit
// refBody that DISAGREES with the dominant body is exactly the scenario that
// exposes the bug: today, refBody keeps being the dominant body regardless of
// what's passed, and (per this test) atmospheric drag keeps being pulled from
// the DOMINANT body's atmosphere even when the caller explicitly asked for a
// different, atmosphere-less reference. Written from the ТЗ contract, NOT the
// implementation.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Ship } from '../js/physics/ship.js';
import { momentumFromV } from '../js/physics/relativity.js';
import { surfaceRotationVelocity, spinAxis } from '../js/physics/orbits.js';
import { BODIES } from '../js/data/bodies.js';
import { approxAbs } from './helpers.mjs';
import assert from 'node:assert/strict';

const Earth = BODIES.find((b) => b.name === 'Earth');
assert.ok(Earth && Earth.atmosphere, 'Earth must exist and have an atmosphere');

// DOM = real Earth: overwhelmingly the physically dominant body at the ship
// position below (surface gravity ~9.8 m/s² vs FAR's ~3e-5 m/s²), WITH a real
// atmosphere. FAR = a synthetic body, positioned far enough away that its
// gravity is negligible at the ship's position, and with atmosphere: null.
const FAR = { name: 'FarBody', GM: 4.9048695e12, radius: 1.7374e6, atmosphere: null };

const earthPos = new THREE.Vector3(0, 0, 0);
const farPos = new THREE.Vector3(3.844e8, 0, 0); // ~lunar distance; negligible pull here
const positions = new Map([[Earth.name, earthPos], [FAR.name, farPos]]);
const bodies = [Earth, FAR];

// Equatorial point 1 km above Earth's surface — well inside its atmosphere
// (scaleHeight 8.5 km), so if Earth's atmosphere leaks into the drag
// computation the effect is large and unmistakable.
const axis = spinAxis(Earth, new THREE.Vector3());
const perpUnit = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0)).normalize();
const lowShipPos = earthPos.clone().addScaledVector(perpUnit, Earth.radius + 1000);

// refBodyVel argument: deliberately WILD relative to Earth's own frame (not
// just "another body's orbital velocity" — chosen large so that if the buggy
// path pairs it with Earth's real atmosphere, the resulting drag is enormous
// and trivially distinguishable from the "no drag" expectation).
const velOfFAR = new THREE.Vector3(30000, 0, 5000);

const dt = 1e-3;

function buildRestShipAt(pos) {
  const s = new Ship();
  s.pos.copy(pos);
  s.throttle = 0;                 // thrust OFF: lastAccel == aDrag alone (aFelt = aThrust(0) + aDrag)
  s.v.set(0, 0, 0);               // at rest in the world (heliocentric) frame
  momentumFromV(s.v, s.w);
  return s;
}

// ── TEST 1 — RED on current code: explicit refBody must win atomically ─────
{
  const ship = buildRestShipAt(lowShipPos);
  ship.step(dt, bodies, positions, null, velOfFAR, FAR);

  assert.equal(ship.refBody, FAR,
    `A3 atomicity: ship.step(..., refBody=FAR) must set ship.refBody to that ` +
    `EXACT object; got ${ship.refBody && ship.refBody.name} — dominantBody() ` +
    `recompute is still overriding the explicit argument`);

  // FAR has no atmosphere -> with throttle 0, the ENTIRE felt acceleration
  // (lastAccel = aThrust + aDrag) must be ~0. Any nonzero magnitude here is
  // Earth's atmosphere leaking in via the stale dominantBody() ref.
  approxAbs(ship.lastAccel.length(), 0, 0.05,
    'A3 atomicity: felt accel must be ~0 (no drag) when the explicit refBody ' +
    'has no atmosphere, regardless of which body is physically dominant');

  // Cross-check against an independent "Earth's atmosphere disabled" reference
  // run, built ONLY from today's already-working 5-arg contract (no assumption
  // about internal fields) — same gravity (GM/radius unchanged), guaranteed
  // zero drag by construction. The two must be indistinguishable.
  const EarthNoAtmo = { ...Earth, atmosphere: null };
  const refShip = buildRestShipAt(lowShipPos);
  refShip.step(dt, [EarthNoAtmo, FAR], positions, null, velOfFAR);

  approxAbs(ship.lastAccel.length(), refShip.lastAccel.length(), 0.05,
    'A3 atomicity: felt accel with explicit refBody=FAR must match the ' +
    'atmosphere-disabled reference run (no drag leaking in from Earth)');
  approxAbs(ship.v.clone().sub(refShip.v).length(), 0, 1e-9,
    'A3 atomicity: resulting velocity must match the atmosphere-disabled ' +
    'reference run to numeric precision (identical gravity, zero drag both sides)');
}

// ── TEST 2 — GREEN today AND after the fix: backward compatibility ─────────
{
  const ship = buildRestShipAt(lowShipPos);
  ship.step(dt, bodies, positions, null, velOfFAR);   // no 6th arg at all

  assert.equal(ship.refBody, Earth,
    'A3 backward-compat: omitting refBody must keep the dominantBody() fallback');
}

// ── TEST 3 — GREEN today AND after the fix: explicit ref == the dominant ───
// body must reproduce ship.test.mjs's own "rest ⇒ drag≈0" / "wind ⇒ drag>0"
// scenarios bit-for-bit against the un-parameterized (5-arg) call — the fix
// must be a no-op whenever the caller's explicit choice agrees with what
// dominantBody() would have picked anyway.
{
  const bodyVel = new THREE.Vector3(30000, 0, 0);      // stand-in orbital velocity of Earth
  const equatorPoint = earthPos.clone().addScaledVector(perpUnit, Earth.radius);
  const surfV = surfaceRotationVelocity(Earth, equatorPoint, earthPos, new THREE.Vector3());

  function buildCase(extraV) {
    const s = new Ship();
    s.pos.copy(equatorPoint);
    s.throttle = 0;
    s.v.copy(bodyVel).add(surfV);
    if (extraV) s.v.add(extraV);
    momentumFromV(s.v, s.w);
    return s;
  }

  const cases = [
    ['rest (co-rotating, drag≈0)', null],
    ['wind (+1000 m/s relative to atmosphere, drag>0)', new THREE.Vector3(0, 0, 1000)],
  ];
  for (const [label, extraV] of cases) {
    const baseline = buildCase(extraV);
    baseline.step(1.0, [Earth], positions, new THREE.Vector3(1, 0, 0), bodyVel);            // old 5-arg call

    const explicitRef = buildCase(extraV);
    explicitRef.step(1.0, [Earth], positions, new THREE.Vector3(1, 0, 0), bodyVel, Earth);  // new 6-arg call, ref==dominant

    approxAbs(explicitRef.lastAccel.length(), baseline.lastAccel.length(), 1e-9,
      `A3 not-break (${label}): explicit refBody=Earth (== dominant) must match the un-parameterized call`);
    approxAbs(explicitRef.v.clone().sub(baseline.v).length(), 0, 1e-9,
      `A3 not-break (${label}): resulting velocity must match the un-parameterized call`);
  }
}

console.log('ship.refpair.test.mjs OK');
