// Student missions pure-predicate contract (js/missions.js): checkMarsCircularOrbit,
// checkMoonLanding, createJupiterFlybyState/stepJupiterFlyby, checkMission.
//
// Written BLIND from the missions.js doc-comment contract, not from reading how
// each predicate is implemented internally:
//   Mars   — ship.refBody === Mars AND relative orbit about Mars is bound with
//            eccentricity e < 0.05 (MARS_MAX_E).
//   Moon   — ship.landed === true && ship.landedBody === 'Moon' && !ship.crashed.
//   Jupiter— stateful reducer. SOI-ENTRY: refBody first becomes Jupiter while the
//            ship's relative orbit about Jupiter is hyperbolic (e >= 1) with
//            periapsis < 20 * Jupiter.radius (JUPITER_RPERI_RADII) -> arms,
//            recording heliocentric |ship.v| as entrySpeed. SOI-EXIT: refBody
//            stops being Jupiter while armed -> compares CURRENT heliocentric
//            speed to entrySpeed; |Δspeed| >= 1000 m/s (JUPITER_MIN_DELTAV)
//            completes the mission. The runtime record resets to
//            {armed:false, entrySpeed:null} on every exit, whether or not the
//            delta-v gate was met.
//
// Real Mars/Jupiter/Earth body records (GM, radius) come from js/data/bodies.js
// so thresholds are exercised against real, not fabricated, physics. Real
// heliocentric position/velocity for the reference body come from
// physics/orbits.js (absolutePosition/bodyVelocity) — the SAME pure functions
// checkMarsCircularOrbit/stepJupiterFlyby call internally, so a ship built as
// "body position/velocity + a controlled relative offset" reproduces an exact,
// analytically-known relative state (independent of the reference body's actual
// heliocentric motion, which orbitFromState's eccentricity does not depend on).
import * as THREE from 'three';
import {
  checkMarsCircularOrbit, checkMoonLanding,
  createJupiterFlybyState, stepJupiterFlyby, checkMission,
} from '../js/missions.js';
import { byName } from '../js/data/bodies.js';
import { absolutePosition, bodyVelocity, orbitFromState } from '../js/physics/orbits.js';
import { approxRel } from './helpers.mjs';
import assert from 'node:assert/strict';

const MARS_MAX_E = 0.05;             // ТЗ / doc-comment constant (missions.js)
const JUPITER_RPERI_RADII = 20;      // ditto
const JUPITER_MIN_DELTAV = 1000;     // m/s, ditto

const T = 1.5e9;                      // arbitrary fixed sim time (s); only needs
                                       // to be self-consistent across one test run
const mars = byName('Mars');
const jupiter = byName('Jupiter');
const earth = byName('Earth');

const marsPos = absolutePosition(mars, T, byName);
const marsVel = bodyVelocity(mars, T, byName);
const jupPos = absolutePosition(jupiter, T, byName);
const jupVel = bodyVelocity(jupiter, T, byName);

function makeCtx(ship, positionEntries) {
  return { ship, sim: { time: T }, positions: new Map(positionEntries), byName };
}

// Perifocal periapsis state (r ⟂ v) for a two-body conic of given (mu, e, rPeri).
// v_peri = sqrt(mu*(1+e)/rPeri) is the general vis-viva-at-periapsis speed and
// holds for BOTH ellipse (e<1) and hyperbola (e>1) — a = rPeri/(1-e) cancels
// out of vis-viva v^2 = mu*(2/r - 1/a) exactly at r = rPeri. Self-checked below
// against orbitFromState (physics/orbits.js) before use in each test so a wrong
// fixture fails loudly instead of silently mis-testing missions.js.
function periapsisState(mu, e, rPeri) {
  const v = Math.sqrt(mu * (1 + e) / rPeri);
  const r = new THREE.Vector3(rPeri, 0, 0);
  const vVec = new THREE.Vector3(0, v, 0);
  const got = orbitFromState(mu, r, vVec);
  approxRel(got.e, e, 1e-6, `periapsisState fixture: e (rPeri=${rPeri})`);
  approxRel(got.rPeri, rPeri, 1e-6, `periapsisState fixture: rPeri`);
  return { r, v: vVec };
}

// ═══════════════════════════════════════════════════════════════════════════
// checkMarsCircularOrbit — INV: bound (e<1) AND e < MARS_MAX_E, refBody===Mars
// ═══════════════════════════════════════════════════════════════════════════

// (a) genuine near-circular orbit about Mars → TRUE
{
  const r = 6.0e6; // > Mars radius (3.3895e6 m); real GM used for v_circ
  const vCirc = Math.sqrt(mars.GM / r);
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vCirc, 0);
  const ship = { pos: marsPos.clone().add(rVec), v: marsVel.clone().add(vVec), refBody: mars };
  const ctx = makeCtx(ship, [['Mars', marsPos]]);
  assert.equal(checkMarsCircularOrbit(ctx), true, '(a) circular Mars orbit e≈0 → true');
}

// (b) eccentric orbit e≈0.2 → FALSE
{
  const r = 6.0e6;
  const { r: rVec, v: vVec } = periapsisState(mars.GM, 0.2, r);
  const ship = { pos: marsPos.clone().add(rVec), v: marsVel.clone().add(vVec), refBody: mars };
  const ctx = makeCtx(ship, [['Mars', marsPos]]);
  assert.equal(checkMarsCircularOrbit(ctx), false, '(b) e≈0.2 eccentric Mars orbit → false');
}

// (c) boundary: e just below/above MARS_MAX_E
{
  const r = 6.0e6;
  {
    const { r: rVec, v: vVec } = periapsisState(mars.GM, MARS_MAX_E - 0.001, r);
    const ship = { pos: marsPos.clone().add(rVec), v: marsVel.clone().add(vVec), refBody: mars };
    const ctx = makeCtx(ship, [['Mars', marsPos]]);
    assert.equal(checkMarsCircularOrbit(ctx), true, `(c) e=${MARS_MAX_E - 0.001} (just below MARS_MAX_E) → true`);
  }
  {
    const { r: rVec, v: vVec } = periapsisState(mars.GM, MARS_MAX_E + 0.001, r);
    const ship = { pos: marsPos.clone().add(rVec), v: marsVel.clone().add(vVec), refBody: mars };
    const ctx = makeCtx(ship, [['Mars', marsPos]]);
    assert.equal(checkMarsCircularOrbit(ctx), false, `(c) e=${MARS_MAX_E + 0.001} (just above MARS_MAX_E) → false`);
  }
}

// (d) refBody ≠ Mars (Earth) but otherwise the same circular-about-"Mars" geometry → FALSE
{
  const r = 6.0e6;
  const vCirc = Math.sqrt(mars.GM / r);
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vCirc, 0);
  const ship = { pos: marsPos.clone().add(rVec), v: marsVel.clone().add(vVec), refBody: earth };
  const ctx = makeCtx(ship, [['Mars', marsPos]]);
  assert.equal(checkMarsCircularOrbit(ctx), false, '(d) refBody=Earth (not Mars) → false regardless of geometry');
}

// (e) degenerate (ship ~= Mars centre) and hyperbolic → FALSE, no throw
{
  // (e1) r_rel ≈ 0 (below the internal lengthSq()>1 guard)
  const ship = { pos: marsPos.clone().add(new THREE.Vector3(0.5, 0, 0)), v: marsVel.clone(), refBody: mars };
  const ctx = makeCtx(ship, [['Mars', marsPos]]);
  assert.doesNotThrow(() => checkMarsCircularOrbit(ctx), '(e1) degenerate r_rel≈0 must not throw');
  assert.equal(checkMarsCircularOrbit(ctx), false, '(e1) degenerate r_rel≈0 → false');
}
{
  // (e2) genuinely hyperbolic (e>=1) at a normal (non-degenerate) radius → false
  const r = 6.0e6;
  const { r: rVec, v: vVec } = periapsisState(mars.GM, 2.0, r);
  const ship = { pos: marsPos.clone().add(rVec), v: marsVel.clone().add(vVec), refBody: mars };
  const ctx = makeCtx(ship, [['Mars', marsPos]]);
  assert.doesNotThrow(() => checkMarsCircularOrbit(ctx), '(e2) hyperbolic must not throw');
  assert.equal(checkMarsCircularOrbit(ctx), false, '(e2) hyperbolic (e=2) about Mars → false');
}

console.log('missions.test.mjs: Mars circular orbit OK');

// ═══════════════════════════════════════════════════════════════════════════
// checkMoonLanding — INV: landed && landedBody==='Moon' && !crashed
// ═══════════════════════════════════════════════════════════════════════════

{
  const cases = [
    [{ landed: true, landedBody: 'Moon', crashed: false }, true, 'landed+Moon+not-crashed'],
    [{ landed: true, landedBody: 'Moon', crashed: true }, false, 'landed+Moon+crashed'],
    [{ landed: true, landedBody: 'Mars', crashed: false }, false, 'landed+other-body(Mars)'],
    [{ landed: true, landedBody: 'Earth', crashed: false }, false, 'landed+other-body(Earth)'],
    [{ landed: false, landedBody: 'Moon', crashed: false }, false, 'not-landed, landedBody=Moon'],
    [{ landed: true, landedBody: undefined, crashed: false }, false, 'landed but landedBody undefined'],
  ];
  for (const [ship, expected, label] of cases) {
    assert.equal(checkMoonLanding({ ship }), expected, `checkMoonLanding: ${label}`);
  }
}

console.log('missions.test.mjs: Moon landing OK');

// ═══════════════════════════════════════════════════════════════════════════
// stepJupiterFlyby — stateful reducer: SOI-entry arm, SOI-exit complete
// ═══════════════════════════════════════════════════════════════════════════

// (a) qualifying close hyperbolic pass: entry arms, exit with large Δhelio-speed completes
{
  const rPeri = 5 * jupiter.radius;                         // < 20*radius threshold
  assert.ok(rPeri < JUPITER_RPERI_RADII * jupiter.radius, 'sanity: rPeri below threshold');
  const { r: rVec, v: vVec } = periapsisState(jupiter.GM, 1.5, rPeri);

  const entryShip = { pos: jupPos.clone().add(rVec), v: jupVel.clone().add(vVec), refBody: jupiter };
  const entryCtx = makeCtx(entryShip, [['Jupiter', jupPos]]);
  const state0 = createJupiterFlybyState();
  assert.deepEqual(state0, { armed: false, entrySpeed: null }, 'sanity: fresh state shape');

  const r1 = stepJupiterFlyby(entryCtx, state0);
  assert.equal(r1.completed, false, '(a) entry frame never completes on its own');
  assert.equal(r1.state.armed, true, '(a) close hyperbolic entry → armed');
  const expectedEntrySpeed = entryShip.v.length();
  approxRel(r1.state.entrySpeed, expectedEntrySpeed, 1e-9, '(a) recorded entrySpeed = heliocentric |ship.v| at entry');
  // state0 itself must be untouched (reducer never mutates its input).
  assert.deepEqual(state0, { armed: false, entrySpeed: null }, '(a) input state not mutated by stepJupiterFlyby');

  // Exit: no longer dominant, heliocentric speed changed by well over threshold.
  const exitShip = {
    pos: jupPos.clone().add(new THREE.Vector3(1e12, 0, 0)),  // far away, irrelevant to the exit branch
    v: new THREE.Vector3(1, 0, 0).setLength(expectedEntrySpeed + 1500),
    refBody: earth,
  };
  const exitCtx = makeCtx(exitShip, [['Jupiter', jupPos]]);
  const r2 = stepJupiterFlyby(exitCtx, r1.state);
  assert.equal(r2.completed, true, '(a) exit with Δhelio-speed 1500 m/s ≥ 1000 m/s threshold → completes');
  assert.deepEqual(r2.state, { armed: false, entrySpeed: null }, '(a) state resets to fresh after a completed exit');
}

// (b) grazing / non-close pass — never arms, so it never completes
{
  // (b1) hyperbolic but periapsis beyond the 20·radius gate
  const rPeriFar = 25 * jupiter.radius;
  assert.ok(rPeriFar > JUPITER_RPERI_RADII * jupiter.radius, 'sanity: rPeri beyond threshold');
  const { r: rVec, v: vVec } = periapsisState(jupiter.GM, 1.3, rPeriFar);
  const entryShip = { pos: jupPos.clone().add(rVec), v: jupVel.clone().add(vVec), refBody: jupiter };
  const entryCtx = makeCtx(entryShip, [['Jupiter', jupPos]]);
  const r1 = stepJupiterFlyby(entryCtx, createJupiterFlybyState());
  assert.equal(r1.completed, false, '(b1) grazing pass (rPeri > 20·radius) never arms → not completed');
  assert.equal(r1.state.armed, false, '(b1) grazing pass never arms');

  // Even if refBody later stops being Jupiter with a huge Δv, it must not complete
  // (armed was never true — no entrySpeed was recorded to compare against).
  const exitShip = {
    pos: jupPos.clone().add(new THREE.Vector3(1e12, 0, 0)),
    v: new THREE.Vector3(0, 1, 0).setLength(1e5),
    refBody: earth,
  };
  const exitCtx = makeCtx(exitShip, [['Jupiter', jupPos]]);
  const r2 = stepJupiterFlyby(exitCtx, r1.state);
  assert.equal(r2.completed, false, '(b1) never-armed state can never complete on exit');
}
{
  // (b2) bound elliptical capture (e<1) at a close periapsis — hyperbolic-only gate excludes it
  const rPeri = 5 * jupiter.radius;
  const { r: rVec, v: vVec } = periapsisState(jupiter.GM, 0.5, rPeri);
  const entryShip = { pos: jupPos.clone().add(rVec), v: jupVel.clone().add(vVec), refBody: jupiter };
  const entryCtx = makeCtx(entryShip, [['Jupiter', jupPos]]);
  const r1 = stepJupiterFlyby(entryCtx, createJupiterFlybyState());
  assert.equal(r1.completed, false, '(b2) elliptical (e<1) capture → not completed');
  assert.equal(r1.state.armed, false, '(b2) elliptical (e<1) capture never arms (hyperbolic-only gate)');
}

// (c) close hyperbolic pass, but negligible heliocentric Δspeed at exit → does NOT complete
{
  const rPeri = 5 * jupiter.radius;
  const { r: rVec, v: vVec } = periapsisState(jupiter.GM, 1.5, rPeri);
  const entryShip = { pos: jupPos.clone().add(rVec), v: jupVel.clone().add(vVec), refBody: jupiter };
  const entryCtx = makeCtx(entryShip, [['Jupiter', jupPos]]);
  const r1 = stepJupiterFlyby(entryCtx, createJupiterFlybyState());
  assert.equal(r1.state.armed, true, 'sanity: (c) entry arms exactly as in (a)');
  const entrySpeed = r1.state.entrySpeed;

  const exitShip = {
    pos: jupPos.clone().add(new THREE.Vector3(1e12, 0, 0)),
    v: new THREE.Vector3(0, 0, 1).setLength(entrySpeed + 200),   // Δ=200 m/s < 1000 m/s
    refBody: null,   // no dominant body at all — also exercises isDominant=false via falsy refBody
  };
  const exitCtx = makeCtx(exitShip, [['Jupiter', jupPos]]);
  const r2 = stepJupiterFlyby(exitCtx, r1.state);
  assert.equal(r2.completed, false, '(c) Δhelio-speed 200 m/s < 1000 m/s threshold → does NOT complete');
  assert.deepEqual(r2.state, { armed: false, entrySpeed: null },
    '(c) runtime record still resets on exit even though the mission did not complete');
}

// (d) degenerate entry (ship ~= Jupiter centre) → no throw, stays unarmed
{
  const entryShip = { pos: jupPos.clone().add(new THREE.Vector3(0.5, 0, 0)), v: jupVel.clone(), refBody: jupiter };
  const entryCtx = makeCtx(entryShip, [['Jupiter', jupPos]]);
  assert.doesNotThrow(() => stepJupiterFlyby(entryCtx, createJupiterFlybyState()), '(d) degenerate entry must not throw');
  const r1 = stepJupiterFlyby(entryCtx, createJupiterFlybyState());
  assert.equal(r1.completed, false, '(d) degenerate entry → not completed');
  assert.equal(r1.state.armed, false, '(d) degenerate entry → never arms');
}

// (e) never-dominant ship (refBody never Jupiter) → always a no-op, never completes
{
  const ship = { pos: jupPos.clone().add(new THREE.Vector3(1e9, 0, 0)), v: jupVel.clone(), refBody: earth };
  const ctx = makeCtx(ship, [['Jupiter', jupPos]]);
  const r1 = stepJupiterFlyby(ctx, createJupiterFlybyState());
  assert.equal(r1.completed, false, '(e) refBody≠Jupiter, never armed → not completed');
  assert.equal(r1.state.armed, false, '(e) refBody≠Jupiter → stays unarmed');
}

console.log('missions.test.mjs: Jupiter flyby OK');

// ═══════════════════════════════════════════════════════════════════════════
// checkMission — uniform dispatcher
// ═══════════════════════════════════════════════════════════════════════════

// Mars: dispatcher result matches direct predicate result, state passed through unchanged
{
  const r = 6.0e6;
  const vCirc = Math.sqrt(mars.GM / r);
  const rVec = new THREE.Vector3(r, 0, 0);
  const vVec = new THREE.Vector3(0, vCirc, 0);
  const ship = { pos: marsPos.clone().add(rVec), v: marsVel.clone().add(vVec), refBody: mars };
  const ctx = makeCtx(ship, [['Mars', marsPos]]);
  const passthroughState = { some: 'opaque-state' };
  const result = checkMission('mars-circular-orbit', ctx, passthroughState);
  assert.equal(result.completed, true, 'checkMission(mars-circular-orbit) dispatches to checkMarsCircularOrbit');
  assert.equal(result.state, passthroughState, 'checkMission(mars-circular-orbit) passes state through unchanged (non-stateful mission)');
}

// Moon: dispatcher result matches direct predicate result
{
  const ship = { landed: true, landedBody: 'Moon', crashed: false };
  const result = checkMission('moon-landing', { ship }, 'unused-state');
  assert.equal(result.completed, true, 'checkMission(moon-landing) dispatches to checkMoonLanding');
}

// Jupiter: dispatcher defaults state via createJupiterFlybyState() when none is passed
{
  const rPeri = 5 * jupiter.radius;
  const { r: rVec, v: vVec } = periapsisState(jupiter.GM, 1.5, rPeri);
  const entryShip = { pos: jupPos.clone().add(rVec), v: jupVel.clone().add(vVec), refBody: jupiter };
  const entryCtx = makeCtx(entryShip, [['Jupiter', jupPos]]);
  const result = checkMission('jupiter-flyby', entryCtx, undefined);
  assert.equal(result.completed, false, 'checkMission(jupiter-flyby) entry: not completed on arming frame');
  assert.equal(result.state.armed, true, 'checkMission(jupiter-flyby) defaults to a fresh state and arms on a qualifying entry');
}

// Unknown mission id → not completed, state passed through unchanged, never throws
{
  const opaqueState = { x: 1 };
  assert.doesNotThrow(() => checkMission('not-a-real-mission-id', {}, opaqueState),
    'checkMission(unknown id) must not throw even with a garbage ctx');
  const result = checkMission('not-a-real-mission-id', {}, opaqueState);
  assert.equal(result.completed, false, 'checkMission(unknown id) → completed:false');
  assert.equal(result.state, opaqueState, 'checkMission(unknown id) → state passed through unchanged');
}

console.log('missions.test.mjs: checkMission dispatcher OK');

console.log('missions.test.mjs OK');
