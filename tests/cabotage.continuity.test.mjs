// ─────────────────────────────────────────────────────────────────────────────
// CABOTAGE STATE CONTINUITY — the крепёж across an integ↔analytic switch (WI-2/3).
// Locks ТЗ INV-C1 (pos/v/properTime continuous — reattach injects no jump),
// INV-C2 (γ(w) ≈ γ(v) to 1e-12 after reattach), and INV-B2 (on FALSE cabotage
// mutates NOTHING → numeric path is byte-identical to the pre-cabotage baseline).
//
// Single Earth body fixed at the origin (hermetic; bodyVelocity = 0).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { tryAnalyticCoast } from '../js/physics/cabotage.js';
import { Ship } from '../js/physics/ship.js';
import { gammaFromW, gammaFromV, momentumFromV } from '../js/physics/relativity.js';
import { approxRel } from './helpers.mjs';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;      // Earth GM
const earth = {
  name: 'Earth', GM: mu, radius: 6.371e6,
  atmosphere: { height: 1.0e5, color: 0, density0: 1.225, scaleHeight: 8.5e3 },
};
const bodies = [earth];
const byName = (n) => bodies.find(b => b.name === n);
const positions = new Map([['Earth', new THREE.Vector3(0, 0, 0)]]);

const r0 = 7.5e6;
const vc = Math.sqrt(mu / r0);

function coastShip() {
  const s = new Ship();
  s.mode = 'arcade';
  s.throttle = 0;
  s.landed = false;
  s.pos.set(r0, 0, 0);
  s.v.set(0, vc, 0);
  momentumFromV(s.v, s.w);
  s.altitude = r0 - earth.radius;
  s.properTime = 0;
  return s;
}

// ── (a) INV-C1/C2: one analytic frame — reattach is finite & w stays consistent ──
{
  const s = coastShip();
  const pt0 = s.properTime;
  const ok = tryAnalyticCoast(s, earth, bodies, byName, 0, 300);
  assert.ok(ok, 'INV-C1: tryAnalyticCoast must engage a clean coasting orbit');

  assert.ok(Number.isFinite(s.pos.x + s.pos.y + s.pos.z), 'INV-C1: pos finite after reattach');
  assert.ok(Number.isFinite(s.v.x + s.v.y + s.v.z), 'INV-C1: v finite after reattach');
  assert.ok(s.properTime > pt0 && Number.isFinite(s.properTime), 'INV-C1: properTime advanced, finite');

  // Radius essentially preserved on a (near-)circular arc — no spurious jump.
  approxRel(s.pos.length(), r0, 1e-6, 'INV-C1: circular radius continuous (no reattach jump)');

  // INV-C2: momentumFromV(ship.v, ship.w) ⇒ gammaFromW(w) == gammaFromV(|v|) exactly.
  approxRel(gammaFromW(s.w), gammaFromV(s.v.length()), 1e-12, 'INV-C2: γ(w) ≈ γ(v) to 1e-12');
}

// ── (b) INV-B2: on FALSE, cabotage mutates NOTHING → baseline is untouched ──
// Force a FALSE outcome (throttle>0 ⇒ predicate clause 2 fails), then assert the
// ship state is byte-identical to before the call, and a subsequent numeric coast
// matches a pristine baseline that never saw cabotage (cabotage-off == baseline).
{
  const s = coastShip();
  s.throttle = 0.5;                       // guarantees FALSE (still coasting geometry)
  const posSnap = s.pos.clone(), vSnap = s.v.clone(), wSnap = s.w.clone(), ptSnap = s.properTime;

  const ok = tryAnalyticCoast(s, earth, bodies, byName, 0, 300);
  assert.equal(ok, false, 'INV-B2: throttle>0 ⇒ tryAnalyticCoast returns FALSE');
  assert.ok(s.pos.equals(posSnap) && s.v.equals(vSnap) && s.w.equals(wSnap) && s.properTime === ptSnap,
    'INV-B2: FALSE ⇒ pos/v/w/properTime byte-identical (cabotage touched no state)');

  // Now run the numeric loop the caller would run, on this ship and on a pristine
  // baseline with the SAME throttle — identical, since cabotage changed nothing.
  const thrust = new THREE.Vector3(1, 0, 0);
  const base = coastShip(); base.throttle = 0.5;
  const dt = 300, sub = 30;
  for (let i = 0; i < dt / sub; i++) {
    s.step(sub, bodies, positions, thrust, null);
    base.step(sub, bodies, positions, thrust, null);
  }
  assert.ok(s.pos.equals(base.pos) && s.v.equals(base.v) && s.properTime === base.properTime,
    'INV-B2: cabotage-off numeric run == pristine baseline (bit-identical)');
}

console.log('cabotage.continuity.test.mjs OK');
