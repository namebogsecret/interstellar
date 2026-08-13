// B4 — Jupiter-flyby mission arming threshold (js/missions.js::stepJupiterFlyby).
//
// Regression coverage for the ULP-unsafe `e >= 1` classifier that CLAUDE.md
// and ГРАБЛИ.md (2026-08-14, physics/orbits) forbid: bound/unbound MUST be
// read from `orbitFromState().bound` (specific orbital energy eps = v²/2 -
// mu/r, which hits its zero-crossing exactly), never from a second,
// independently-rounded `e >= 1` comparison. Also covers the new lower gate
// `rPeri > jupiter.radius`, which excludes a radial plunge into the planet
// (h≈0 ⇒ rPeri=0, which used to satisfy "rPeri < 20·R_J" and falsely arm).
//
// All fixtures are self-checked against orbitFromState before being fed to
// stepJupiterFlyby, so a wrong fixture fails loudly instead of silently
// mis-testing the mission predicate (house pattern from missions.test.mjs's
// periapsisState).
import * as THREE from 'three';
import { byName } from '../js/data/bodies.js';
import { absolutePosition, bodyVelocity, orbitFromState } from '../js/physics/orbits.js';
import { createJupiterFlybyState, stepJupiterFlyby } from '../js/missions.js';
import assert from 'node:assert/strict';

// Mirror of missions.js's internal (non-exported) JUPITER_RPERI_RADII, same
// convention as tests/missions.test.mjs's own mirror + comment.
const JUPITER_RPERI_RADII = 20;

const T = 1.5e9;                       // arbitrary fixed sim time, self-consistent within this file
const jupiter = byName('Jupiter');
const jupPos = absolutePosition(jupiter, T, byName);
const jupVel = bodyVelocity(jupiter, T, byName);

function armFrom(rVec, vVec) {
  const ship = { pos: jupPos.clone().add(rVec), v: jupVel.clone().add(vVec), refBody: jupiter };
  const ctx = { ship, sim: { time: T }, positions: new Map([['Jupiter', jupPos]]), byName };
  return stepJupiterFlyby(ctx, createJupiterFlybyState());
}

// ═══════════════════════════════════════════════════════════════════════════
// (1) armed just ABOVE escape energy: eps = +1e-9·mu/r at a close periapsis
// ═══════════════════════════════════════════════════════════════════════════
{
  const rPeri = 5 * jupiter.radius;
  const vesc = Math.sqrt(2 * jupiter.GM / rPeri);
  const rVec = new THREE.Vector3(rPeri, 0, 0);
  const vVec = new THREE.Vector3(0, vesc * Math.sqrt(1 + 1e-9), 0);   // |v| = sqrt(2mu/r)*sqrt(1+1e-9)

  const fixture = orbitFromState(jupiter.GM, rVec, vVec);
  assert.equal(fixture.bound, false, 'fixture self-check (1): eps=+1e-9·mu/r must be unbound');

  const { state } = armFrom(rVec, vVec);
  assert.equal(state.armed, true, '(1) eps just above escape energy at rPeri=5·R_J → armed');
}

// ═══════════════════════════════════════════════════════════════════════════
// (2) NOT armed just BELOW escape energy: eps = -1e-9·mu/r, same periapsis
// ═══════════════════════════════════════════════════════════════════════════
{
  const rPeri = 5 * jupiter.radius;
  const vesc = Math.sqrt(2 * jupiter.GM / rPeri);
  const rVec = new THREE.Vector3(rPeri, 0, 0);
  const vVec = new THREE.Vector3(0, vesc * Math.sqrt(1 - 1e-9), 0);   // |v| = sqrt(2mu/r)*sqrt(1-1e-9)

  const fixture = orbitFromState(jupiter.GM, rVec, vVec);
  assert.equal(fixture.bound, true, 'fixture self-check (2): eps=-1e-9·mu/r must be bound');

  const { state } = armFrom(rVec, vVec);
  assert.equal(state.armed, false, '(2) eps just below escape energy at rPeri=5·R_J → NOT armed');
}

// ═══════════════════════════════════════════════════════════════════════════
// (3) fitness function — no second opinion: armed ≡ !bound across 41 states
//     straddling the threshold. |v| = k·sqrt(2mu/r), k = 1 + j·1e-3, j=-20..20.
//     This is not a test of where the threshold sits — it is a test that
//     mission-arming and the canonical classifier can never disagree, which
//     is the whole point of the B4 alignment (ГРАБЛИ class #2: two
//     independent conditions for one fact eventually diverge).
// ═══════════════════════════════════════════════════════════════════════════
{
  const rPeri = 5 * jupiter.radius;
  const vesc = Math.sqrt(2 * jupiter.GM / rPeri);
  let checked = 0;
  for (let j = -20; j <= 20; j++) {
    const k = 1 + j * 1e-3;
    const rVec = new THREE.Vector3(rPeri, 0, 0);
    const vVec = new THREE.Vector3(0, k * vesc, 0);

    const bound = orbitFromState(jupiter.GM, rVec, vVec).bound;
    const { state } = armFrom(rVec, vVec);
    assert.equal(state.armed, !bound, `(3) j=${j} (k=${k.toFixed(6)}): armed must equal !bound`);
    checked++;
  }
  assert.equal(checked, 41, '(3) sweep must cover exactly 41 states (j=-20..20)');
}

// ═══════════════════════════════════════════════════════════════════════════
// (4) far pass at 25·R_J does NOT arm — the 20·R_J close-approach gate is untouched
// ═══════════════════════════════════════════════════════════════════════════
{
  const rPeri = 25 * jupiter.radius;
  const e = 1.3;
  const v = Math.sqrt(jupiter.GM * (1 + e) / rPeri);   // vis-viva-at-periapsis, holds for e>1 too
  const rVec = new THREE.Vector3(rPeri, 0, 0);
  const vVec = new THREE.Vector3(0, v, 0);

  const fixture = orbitFromState(jupiter.GM, rVec, vVec);
  assert.equal(fixture.bound, false, 'fixture self-check (4): must be unbound');
  assert.ok(fixture.rPeri > JUPITER_RPERI_RADII * jupiter.radius,
    'fixture self-check (4): rPeri must be beyond the 20·R_J gate');

  const { state } = armFrom(rVec, vVec);
  assert.equal(state.armed, false, '(4) unbound flyby at 25·R_J periapsis → NOT armed');
}

// ═══════════════════════════════════════════════════════════════════════════
// (5) radial plunge into Jupiter does NOT arm — new lower gate rPeri > radius
// ═══════════════════════════════════════════════════════════════════════════
{
  // (5a) genuinely radial approach: v collinear with r ⇒ h ≈ 0 ⇒ rPeri ≈ 0.
  const r0 = 10 * jupiter.radius;
  const vesc0 = Math.sqrt(2 * jupiter.GM / r0);
  const rVec = new THREE.Vector3(r0, 0, 0);
  const vVec = new THREE.Vector3(-1.1 * vesc0, 0, 0);   // inbound, purely radial, unbound

  const fixture = orbitFromState(jupiter.GM, rVec, vVec);
  assert.equal(fixture.bound, false, 'fixture self-check (5a): radial plunge must be unbound');
  assert.ok(fixture.rPeri < 1, 'fixture self-check (5a): rPeri must be ~0 (purely radial, h≈0)');

  const { state } = armFrom(rVec, vVec);
  assert.equal(state.armed, false, '(5a) radial plunge (rPeri≈0) → NOT armed despite being unbound');
}
{
  // (5b) explicit rPeri = 0.5·radius: inside the planet, would satisfy the
  // old "rPeri < 20·R_J" gate on its own — must be excluded by rPeri > radius.
  const rPeri = 0.5 * jupiter.radius;
  const e = 1.5;
  const v = Math.sqrt(jupiter.GM * (1 + e) / rPeri);
  const rVec = new THREE.Vector3(rPeri, 0, 0);
  const vVec = new THREE.Vector3(0, v, 0);

  const fixture = orbitFromState(jupiter.GM, rVec, vVec);
  assert.equal(fixture.bound, false, 'fixture self-check (5b): must be unbound');
  assert.ok(fixture.rPeri < jupiter.radius, 'fixture self-check (5b): rPeri must be below the planet surface');

  const { state } = armFrom(rVec, vVec);
  assert.equal(state.armed, false, '(5b) rPeri = 0.5·radius (below surface) → NOT armed');
}

console.log('missions.hyperbolic.test.mjs OK');
